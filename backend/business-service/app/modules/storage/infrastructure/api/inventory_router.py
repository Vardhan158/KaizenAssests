"""
Inventory Control & Authoritative Stock Ledger API Router.

Provides unified endpoints for:
- Authoritative warehouse-wide and store-scoped inventory summary (Material -> Store -> Zone).
- Unified chronological stock ledger combining Receipts, Putaways, Issues, Quarantine, and Dispositions.
- Strict store-level RBAC & IDOR protection (Store Managers / Keepers are scoped strictly to their assigned store).
- Authoritative inventory statistics and stock reconciliation.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select

from app.database.session import UnitOfWork, get_uow
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialModel,
    MaterialRequestModel,
    MaterialStockModel,
)
from app.modules.quarantine.infrastructure.persistence.models import (
    QuarantineAuditModel,
    QuarantineRecordModel,
)
from app.modules.receiving.infrastructure.persistence.models import (
    GrnBatchQrModel,
    InventoryReceiptPostingModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionModel,
    HandlingUnitModel,
    InventoryIssueTransactionModel,
    InventoryLocationBalanceModel,
    InventoryMovementHistoryModel,
    PickupTaskModel,
    PutawayMovementModel,
    PutawayTaskModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreBinModel,
    StoreManagerUserModel,
    StoreModel,
    StoreZoneModel,
)
from app.security.dependencies import CurrentUser, get_current_user, require_permission

inventory_router = APIRouter(prefix="/api/storage/inventory", tags=["inventory"])


async def _resolve_user_store_context(uow: UnitOfWork, user: CurrentUser) -> tuple[Optional[uuid.UUID], Optional[str]]:
    """Resolve store_id and store_code for Store Manager or Store Keeper."""
    claims = getattr(user, "raw_claims", {}) or {}
    store_id_str = claims.get("store_id")
    store_code = claims.get("store_code")

    if store_id_str:
        try:
            return uuid.UUID(str(store_id_str)), store_code
        except ValueError:
            pass

    username = user.username or ""
    stmt = (
        select(StoreManagerUserModel)
        .where(
            or_(
                func.lower(StoreManagerUserModel.username) == username.lower(),
                func.lower(StoreManagerUserModel.employee_id) == username.lower(),
            )
        )
    )
    res = await uow.session.execute(stmt)
    mgr = res.scalars().first()
    if mgr:
        store_code_val = store_code
        if not store_code_val and mgr.store_id:
            store_res = await uow.session.execute(select(StoreModel.store_code).where(StoreModel.id == mgr.store_id))
            store_code_val = store_res.scalar_one_or_none()
        return mgr.store_id, store_code_val

    if store_code:
        store_res = await uow.session.execute(
            select(StoreModel.id).where(
                or_(
                    func.lower(StoreModel.store_code) == store_code.lower(),
                    func.lower(StoreModel.store_name).like(f"%{store_code.lower()}%"),
                )
            )
        )
        s_id = store_res.scalar_one_or_none()
        if s_id:
            return s_id, store_code

    return None, store_code


def _is_store_scoped_role(user: CurrentUser) -> bool:
    roles = getattr(user, "roles", []) or []
    return any(r in ["STORE_MANAGER", "STORE_KEEPER"] for r in roles) and not any(
        r in ["WAREHOUSE", "ADMIN", "SUPERADMIN", "SUPER_ADMIN"] for r in roles
    )


@inventory_router.get("/warehouse-summary")
async def get_warehouse_inventory_summary(
    material_code: Optional[str] = None,
    store_id: Optional[str] = None,
    zone_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> List[Dict[str, Any]]:
    """
    Returns authoritative inventory breakdown: Material -> Store -> Zone.
    Calculates Available, Quarantined, and Total physical quantities.
    Enforces store-level authorization (Store Managers/Keepers only see own store).
    """
    user_store_id, _ = await _resolve_user_store_context(uow, user)
    if _is_store_scoped_role(user):
        if not user_store_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Store user context not assigned to an active Store.",
            )
        if store_id and str(user_store_id) != store_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access forbidden: You cannot view inventory belonging to another Store.",
            )
        target_store_id = user_store_id
    else:
        target_store_id = uuid.UUID(store_id) if store_id else None

    # 1. Fetch Store, Zone, and Bin lookup maps
    stores_res = await uow.session.execute(select(StoreModel))
    store_map = {s.id: s for s in stores_res.scalars().all()}
    zones_res = await uow.session.execute(select(StoreZoneModel))
    zone_map = {z.id: z for z in zones_res.scalars().all()}
    bins_res = await uow.session.execute(select(StoreBinModel))
    bin_map = {b.id: b for b in bins_res.scalars().all()}

    # 2. Fetch Material Master lookup
    mat_res = await uow.session.execute(select(MaterialModel))
    mat_map = {m.material_code: m for m in mat_res.scalars().all()}

    # 3. Fetch canonical stock
    stock_res = await uow.session.execute(select(MaterialStockModel))
    stock_map = {s.material_code: s for s in stock_res.scalars().all()}

    # 4. Fetch Quarantined stock grouped by material and store
    quar_res = await uow.session.execute(
        select(QuarantineRecordModel).where(
            QuarantineRecordModel.status.in_(["PENDING_REVIEW", "QUARANTINED"])
        )
    )
    quarantine_records = quar_res.scalars().all()
    quar_by_mat: Dict[str, Decimal] = {}
    for q in quarantine_records:
        m_code = q.item_code
        quar_by_mat[m_code] = quar_by_mat.get(m_code, Decimal("0.0")) + Decimal(str(q.damaged_quantity))

    # 5. Fetch location balances
    loc_bal_query = (
        select(InventoryLocationBalanceModel, StorageLocationModel)
        .join(StorageLocationModel, StorageLocationModel.id == InventoryLocationBalanceModel.storage_location_id)
    )
    if target_store_id:
        loc_bal_query = loc_bal_query.where(StorageLocationModel.store_id == target_store_id)
    if zone_id:
        try:
            loc_bal_query = loc_bal_query.where(StorageLocationModel.zone_id == uuid.UUID(zone_id))
        except ValueError:
            pass
    if material_code:
        loc_bal_query = loc_bal_query.where(
            func.lower(InventoryLocationBalanceModel.material_code) == material_code.lower()
        )

    loc_bal_res = await uow.session.execute(loc_bal_query)
    balances = loc_bal_res.all()

    output: List[Dict[str, Any]] = []
    seen_mat_codes = set()

    for bal, loc in balances:
        m_code = bal.material_code
        seen_mat_codes.add(m_code)
        mat_obj = mat_map.get(m_code)
        stk_obj = stock_map.get(m_code)
        s_obj = store_map.get(loc.store_id) if loc.store_id else None
        z_obj = zone_map.get(loc.zone_id) if loc.zone_id else None
        b_obj = bin_map.get(loc.bin_id) if loc.bin_id else None

        avail_qty = float(bal.available_quantity)
        quar_qty = float(quar_by_mat.get(m_code, Decimal("0.0")))
        tot_qty = avail_qty + quar_qty
        alloc_qty = float(stk_obj.allocated) if stk_obj else 0.0

        stat = "HEALTHY"
        if tot_qty == 0:
            stat = "OUT_OF_STOCK"
        elif stk_obj and avail_qty < float(stk_obj.reorder_point):
            stat = "LOW_STOCK"
        elif alloc_qty > 0 and avail_qty == 0:
            stat = "ALLOCATED"

        rec = {
            "id": str(bal.id),
            "material_code": m_code,
            "material_name": bal.material_name or (mat_obj.material_name if mat_obj else m_code),
            "category": mat_obj.category if mat_obj else (stk_obj.category if stk_obj else "GENERAL"),
            "store_id": str(loc.store_id) if loc.store_id else None,
            "store_code": s_obj.store_code if s_obj else "MAIN",
            "store_name": s_obj.store_name if s_obj else "Main Store",
            "zone_id": str(loc.zone_id) if loc.zone_id else None,
            "zone_code": z_obj.zone_code if z_obj else loc.zone,
            "zone_name": z_obj.zone_name if z_obj else loc.zone,
            "bin_id": str(b_obj.id) if b_obj else (str(loc.bin_id) if loc.bin_id else None),
            "bin_code": b_obj.bin_code if b_obj else (loc.bin if loc.bin and loc.bin != "DEFAULT" else None),
            "bin_name": b_obj.bin_name if b_obj else (f"Bin {loc.bin}" if loc.bin and loc.bin != "DEFAULT" else None),
            "rack": b_obj.rack if b_obj else (loc.rack if loc.rack and loc.rack != "DEFAULT" else None),
            "shelf": b_obj.shelf if b_obj else None,
            "storage_location_id": str(loc.id),
            "location_code": loc.location_code,
            "warehouse_id": loc.warehouse_id or (s_obj.warehouse_id if s_obj else "Main Warehouse"),
            "available_quantity": avail_qty,
            "allocated_quantity": alloc_qty,
            "quarantined_quantity": quar_qty,
            "total_quantity": tot_qty,
            "on_hand_quantity": float(stk_obj.on_hand) if stk_obj else tot_qty,
            "uom": bal.uom,
            "reorder_point": float(stk_obj.reorder_point) if stk_obj else 10.0,
            "status": stat,
            "last_grn_number": bal.last_grn_number,
            "updated_at": bal.updated_at.isoformat() if bal.updated_at else datetime.now(timezone.utc).isoformat(),
        }
        output.append(rec)

    # For warehouse users with no store filter, also include materials in stock table that might not yet be put away
    if not target_store_id:
        for m_code, stk in stock_map.items():
            if m_code not in seen_mat_codes:
                mat_obj = mat_map.get(m_code)
                quar_qty = float(quar_by_mat.get(m_code, Decimal("0.0")))
                avail_qty = float(stk.available)
                tot_qty = avail_qty + quar_qty

                stat = "ACTIVE"
                if tot_qty == 0:
                    stat = "OUT_OF_STOCK"
                elif avail_qty < float(stk.reorder_point):
                    stat = "LOW_STOCK"

                output.append({
                    "id": str(stk.id),
                    "material_code": m_code,
                    "material_name": stk.material_name,
                    "category": stk.category,
                    "store_id": None,
                    "store_code": "UNASSIGNED",
                    "store_name": "Awaiting Putaway / Central",
                    "zone_id": None,
                    "zone_code": "RECEIVING_AREA",
                    "zone_name": "Receiving Dock",
                    "storage_location_id": None,
                    "location_code": "RECEIVING_AREA",
                    "available_quantity": avail_qty,
                    "quarantined_quantity": quar_qty,
                    "total_quantity": tot_qty,
                    "uom": stk.uom,
                    "reorder_point": float(stk.reorder_point),
                    "status": stat,
                    "last_grn_number": None,
                    "updated_at": stk.updated_at.isoformat() if stk.updated_at else datetime.now(timezone.utc).isoformat(),
                })

    # Apply optional text search
    if search:
        s_lower = search.strip().lower()
        output = [
            r for r in output
            if s_lower in r["material_code"].lower()
            or s_lower in r["material_name"].lower()
            or s_lower in (r["store_code"] or "").lower()
            or s_lower in (r["zone_code"] or "").lower()
        ]

    if status_filter and status_filter != "ALL":
        output = [r for r in output if r["status"].upper() == status_filter.upper()]

    return output


@inventory_router.get("/ledger")
async def get_stock_ledger(
    material_code: Optional[str] = None,
    store_id: Optional[str] = None,
    zone_id: Optional[str] = None,
    transaction_type: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> List[Dict[str, Any]]:
    """
    Returns the single authoritative chronological stock ledger across:
    - RECEIPT (GRN Postings)
    - PUTAWAY (Movements into Stores & Zones)
    - ISSUE (Assembly Outbound Handovers)
    - QUARANTINE (QC Damaged Stock Quarantine)
    - SCRAP / ACCEPTED_WITH_DEVIATION (Quarantine Dispositions)
    """
    user_store_id, _ = await _resolve_user_store_context(uow, user)
    if _is_store_scoped_role(user):
        if not user_store_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Store user context not assigned to an active Store.",
            )
        if store_id and str(user_store_id) != store_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access forbidden: You cannot view stock ledger of another Store.",
            )
        target_store_id = user_store_id
    else:
        target_store_id = uuid.UUID(store_id) if store_id else None

    # Fetch store & zone lookup maps
    stores_res = await uow.session.execute(select(StoreModel))
    store_map = {s.id: s for s in stores_res.scalars().all()}
    zones_res = await uow.session.execute(select(StoreZoneModel))
    zone_map = {z.id: z for z in zones_res.scalars().all()}

    ledger_entries: List[Dict[str, Any]] = []

    # 1. GRN Receipt Postings (RECEIPT)
    if not target_store_id: # GRN receipts occur at central dock before store putaway
        rcpt_query = select(InventoryReceiptPostingModel)
        if material_code:
            rcpt_query = rcpt_query.where(
                func.lower(InventoryReceiptPostingModel.item_code) == material_code.lower()
            )
        rcpt_res = await uow.session.execute(rcpt_query)
        for r in rcpt_res.scalars().all():
            ledger_entries.append({
                "id": str(r.id),
                "timestamp": r.posted_at.isoformat() if r.posted_at else datetime.now(timezone.utc).isoformat(),
                "transaction_type": "RECEIPT",
                "material_code": r.item_code,
                "material_name": r.material_name or r.item_code,
                "quantity": float(r.posted_quantity),
                "uom": r.uom or "PCS",
                "store_id": None,
                "store_code": None,
                "store_name": "Receiving Dock",
                "zone_id": None,
                "zone_code": "RECEIVING_AREA",
                "zone_name": "Dock Area",
                "reference_number": r.grn_number,
                "source": r.supplier_name or "Supplier",
                "destination": "RECEIVING_AREA",
                "stock_before": float(r.on_hand_before),
                "stock_after": float(r.on_hand_after),
                "performed_by": r.posted_by,
                "notes": f"PO: {r.po_number or 'N/A'} · ASN: {r.asn_number or 'N/A'}",
            })

    # 2. Putaway Movements (PUTAWAY)
    put_query = (
        select(PutawayMovementModel, PutawayTaskModel, StorageLocationModel)
        .join(PutawayTaskModel, PutawayTaskModel.id == PutawayMovementModel.putaway_task_id)
        .outerjoin(StorageLocationModel, StorageLocationModel.id == PutawayTaskModel.destination_location_id)
    )
    if target_store_id:
        put_query = put_query.where(
            or_(
                PutawayTaskModel.destination_store_id == target_store_id,
                StorageLocationModel.store_id == target_store_id,
            )
        )
    if material_code:
        put_query = put_query.where(
            func.lower(PutawayTaskModel.item_code) == material_code.lower()
        )
    put_res = await uow.session.execute(put_query)
    for mov, task, loc in put_res.all():
        s_id = task.destination_store_id or (loc.store_id if loc else None)
        z_id = task.destination_zone_id or (loc.zone_id if loc else None)
        s_obj = store_map.get(s_id) if s_id else None
        z_obj = zone_map.get(z_id) if z_id else None

        ledger_entries.append({
            "id": str(mov.id),
            "timestamp": mov.confirmed_at.isoformat() if mov.confirmed_at else datetime.now(timezone.utc).isoformat(),
            "transaction_type": "PUTAWAY",
            "material_code": task.item_code,
            "material_name": task.material_name,
            "quantity": float(mov.confirmed_quantity),
            "uom": mov.uom,
            "store_id": str(s_id) if s_id else None,
            "store_code": s_obj.store_code if s_obj else None,
            "store_name": s_obj.store_name if s_obj else "Store",
            "zone_id": str(z_id) if z_id else None,
            "zone_code": z_obj.zone_code if z_obj else (loc.zone if loc else "ZONE"),
            "zone_name": z_obj.zone_name if z_obj else (loc.zone if loc else "Zone"),
            "reference_number": task.task_number,
            "source": task.source_location,
            "destination": loc.location_code if loc else (z_obj.zone_code if z_obj else "STORE"),
            "stock_before": float(mov.inventory_available_before),
            "stock_after": float(mov.inventory_available_after),
            "performed_by": mov.confirmed_by,
            "notes": f"GRN: {task.grn_number}",
        })

    # 3. Outbound Issue Transactions (ISSUE)
    iss_query = select(InventoryIssueTransactionModel)
    if target_store_id:
        iss_query = iss_query.where(InventoryIssueTransactionModel.store_id == target_store_id)
    if material_code:
        iss_query = iss_query.where(
            func.lower(InventoryIssueTransactionModel.material_code) == material_code.lower()
        )
    iss_res = await uow.session.execute(iss_query)
    for iss in iss_res.scalars().all():
        s_obj = store_map.get(iss.store_id) if iss.store_id else None
        z_obj = zone_map.get(iss.zone_id) if iss.zone_id else None

        ledger_entries.append({
            "id": str(iss.id),
            "timestamp": iss.issued_at.isoformat() if iss.issued_at else datetime.now(timezone.utc).isoformat(),
            "transaction_type": "ISSUE",
            "material_code": iss.material_code,
            "material_name": iss.material_name,
            "quantity": -float(iss.quantity),
            "uom": iss.uom,
            "store_id": str(iss.store_id),
            "store_code": iss.store_code,
            "store_name": s_obj.store_name if s_obj else iss.store_code,
            "zone_id": str(iss.zone_id) if iss.zone_id else None,
            "zone_code": iss.zone_code or (z_obj.zone_code if z_obj else "ZONE"),
            "zone_name": z_obj.zone_name if z_obj else (iss.zone_code or "Zone"),
            "reference_number": iss.issue_number,
            "source": iss.store_code,
            "destination": iss.recipient_department,
            "stock_before": float(iss.stock_before),
            "stock_after": float(iss.stock_after),
            "performed_by": iss.issued_by,
            "notes": f"Requisition: {iss.requisition_number or 'N/A'}",
        })

    # 4. Quarantine Records (QUARANTINE)
    if not target_store_id:
        q_query = select(QuarantineRecordModel)
        if material_code:
            q_query = q_query.where(
                func.lower(QuarantineRecordModel.item_code) == material_code.lower()
            )
        q_res = await uow.session.execute(q_query)
        for q in q_res.scalars().all():
            ledger_entries.append({
                "id": str(q.id),
                "timestamp": q.created_at.isoformat() if q.created_at else datetime.now(timezone.utc).isoformat(),
                "transaction_type": "QUARANTINE",
                "material_code": q.item_code,
                "material_name": q.material_name,
                "quantity": float(q.damaged_quantity),
                "uom": q.uom,
                "store_id": None,
                "store_code": "QUARANTINE",
                "store_name": "Quarantine Area",
                "zone_id": None,
                "zone_code": "QC-HOLD",
                "zone_name": "QC Hold Area",
                "reference_number": q.quarantine_number,
                "source": "RECEIVING_INSPECTION",
                "destination": "QUARANTINE",
                "stock_before": 0.0,
                "stock_after": 0.0,
                "performed_by": q.created_by,
                "notes": f"Reason: {q.reason or 'Damaged on arrival'} · Status: {q.status}",
            })

    # 5. Quarantine Audits / Dispositions (SCRAP / ACCEPTED_WITH_DEVIATION)
    if not target_store_id:
        qa_query = select(QuarantineAuditModel)
        qa_res = await uow.session.execute(qa_query)
        for qa in qa_res.scalars().all():
            tx_type = "SCRAP" if (qa.disposition or "").upper() in ["SCRAP", "SCRAPPED"] else "ACCEPTED_WITH_DEVIATION"
            ledger_entries.append({
                "id": str(qa.id),
                "timestamp": qa.performed_at.isoformat() if qa.performed_at else datetime.now(timezone.utc).isoformat(),
                "transaction_type": tx_type,
                "material_code": "QUARANTINE-ITEM",
                "material_name": f"Disposition: {qa.disposition}",
                "quantity": 0.0,
                "uom": "PCS",
                "store_id": None,
                "store_code": "QUARANTINE",
                "store_name": "Quarantine Area",
                "zone_id": None,
                "zone_code": "QC-DISPOSAL",
                "zone_name": "QC Disposal",
                "reference_number": str(qa.quarantine_id),
                "source": "QUARANTINE",
                "destination": "SCRAP_DISPOSAL" if tx_type == "SCRAP" else "STORE_AVAILABLE",
                "stock_before": None,
                "stock_after": None,
                "performed_by": qa.performed_by,
                "notes": qa.remarks or f"Disposition applied: {qa.disposition}",
            })

    # Filter by transaction type if specified
    if transaction_type and transaction_type != "ALL":
        ledger_entries = [e for e in ledger_entries if e["transaction_type"].upper() == transaction_type.upper()]

    # Filter by date range if specified
    if start_date:
        s_date = start_date.strip()
        ledger_entries = [e for e in ledger_entries if e["timestamp"][:10] >= s_date[:10]]
    if end_date:
        e_date = end_date.strip()
        ledger_entries = [e for e in ledger_entries if e["timestamp"][:10] <= e_date[:10]]

    # Filter by search string
    if search:
        s_term = search.strip().lower()
        ledger_entries = [
            e for e in ledger_entries
            if s_term in (e["material_code"] or "").lower()
            or s_term in (e["material_name"] or "").lower()
            or s_term in (e["reference_number"] or "").lower()
            or s_term in (e["performed_by"] or "").lower()
            or s_term in (e["source"] or "").lower()
            or s_term in (e["destination"] or "").lower()
            or s_term in (e["store_name"] or "").lower()
            or s_term in (e["zone_name"] or "").lower()
        ]

    # Sort descending by timestamp
    ledger_entries.sort(key=lambda x: x["timestamp"], reverse=True)
    return ledger_entries


@inventory_router.get("/stats")
async def get_inventory_stats(
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> Dict[str, Any]:
    """
    Returns high-level authoritative inventory statistics.
    """
    user_store_id, _ = await _resolve_user_store_context(uow, user)
    is_store_user = _is_store_scoped_role(user)

    if is_store_user:
        if not user_store_id:
            raise HTTPException(status_code=403, detail="Store user context not assigned.")
        # Store level balances
        bal_query = (
            select(InventoryLocationBalanceModel, StorageLocationModel)
            .join(StorageLocationModel, StorageLocationModel.id == InventoryLocationBalanceModel.storage_location_id)
            .where(StorageLocationModel.store_id == user_store_id)
        )
        bal_res = await uow.session.execute(bal_query)
        bals = bal_res.all()

        total_skus = len(set(b[0].material_code for b in bals))
        total_available = sum(float(b[0].available_quantity) for b in bals)
        stock_codes = {b[0].material_code for b in bals}
        stock_res = await uow.session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code.in_(stock_codes))) if stock_codes else None
        stock_by_code = {s.material_code: s for s in (stock_res.scalars().all() if stock_res else [])}
        by_material = {}
        for bal, loc in bals:
            by_material.setdefault(bal.material_code, 0.0)
            by_material[bal.material_code] += float(bal.available_quantity or 0)
        low_codes = [code for code, qty in by_material.items() if qty < float(getattr(stock_by_code.get(code), "reorder_point", 10.0))]
        out_codes = [code for code, qty in by_material.items() if qty <= 0]
        return {
            "total_skus": total_skus,
            "total_available_units": total_available,
            "total_quarantined_units": 0.0,
            "total_units": total_available,
            "low_stock_skus": len(low_codes),
            "out_of_stock_skus": len(out_codes),
        }

    # Warehouse level
    stock_res = await uow.session.execute(select(MaterialStockModel))
    all_stocks = stock_res.scalars().all()

    quar_res = await uow.session.execute(
        select(QuarantineRecordModel).where(
            QuarantineRecordModel.status.in_(["PENDING_REVIEW", "QUARANTINED"])
        )
    )
    total_quar = sum(float(q.damaged_quantity) for q in quar_res.scalars().all())
    total_avail = sum(float(s.available) for s in all_stocks)

    low_stock_count = sum(1 for s in all_stocks if float(s.on_hand) < float(s.reorder_point) and float(s.on_hand) > 0)
    out_of_stock_count = sum(1 for s in all_stocks if float(s.on_hand) == 0)

    return {
        "total_skus": len(all_stocks),
        "total_available_units": total_avail,
        "total_quarantined_units": total_quar,
        "total_units": total_avail + total_quar,
        "low_stock_skus": low_stock_count,
        "out_of_stock_skus": out_of_stock_count,
    }


@inventory_router.get("/dashboard-metrics")
async def get_warehouse_dashboard_metrics(
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> Dict[str, Any]:
    """
    Returns authoritative real-time warehouse dashboard metrics:
    - Action Required (Pending putaways, pending store pickups, active quarantine segregations, low stock alerts, unassigned putaway bins)
    - Inventory Snapshot (Total SKUs, On Hand, Available, Allocated, Quarantined)
    - Putaway Summary (Pending, In Progress, Completed, recent putaways)
    - Storage Overview (Stores, Zones, Bins, Occupancy)
    - Recent Warehouse Activity feed
    """
    # 1. Putaway tasks
    pt_res = await uow.session.execute(
        select(PutawayTaskModel).order_by(PutawayTaskModel.created_at.desc())
    )
    all_putaways = pt_res.scalars().all()
    pending_putaway_list = [p for p in all_putaways if (p.status or "").upper() in ("PUTAWAY_PENDING", "PENDING", "LOCATION_ASSIGNED", "OPEN", "READY_FOR_PUTAWAY", "ASSIGNED_TO_STORE")]
    in_progress_putaway_list = [p for p in all_putaways if (p.status or "").upper() in ("IN_PROGRESS", "PUTAWAY_IN_PROGRESS")]
    completed_putaway_list = [p for p in all_putaways if (p.status or "").upper() in ("PUTAWAY_COMPLETED", "COMPLETED")]
    unassigned_putaway_count = sum(1 for p in pending_putaway_list if not p.destination_bin_id and not p.destination_location_id)

    # 2. Store pickup tasks (from Assembly Requisitions)
    pickup_res = await uow.session.execute(
        select(PickupTaskModel).order_by(PickupTaskModel.created_at.desc())
    )
    all_pickups = pickup_res.scalars().all()
    pending_pickups = [p for p in all_pickups if (p.status or "").upper() in ("ASSIGNED_TO_STORE", "PENDING", "IN_PROGRESS")]

    # 3. Assembly Requisitions
    req_res = await uow.session.execute(
        select(AssemblyRequisitionModel).order_by(AssemblyRequisitionModel.created_at.desc())
    )
    all_reqs = req_res.scalars().all()
    pending_req_count = sum(1 for r in all_reqs if (r.status or "").upper() in ("SUBMITTED", "PENDING"))

    # 4. Material Requests (Procurement)
    mr_res = await uow.session.execute(
        select(MaterialRequestModel).order_by(MaterialRequestModel.created_at.desc())
    )
    all_mrs = mr_res.scalars().all()
    pending_mr_count = sum(1 for mr in all_mrs if (mr.status or "").upper() in ("SUBMITTED", "PENDING"))

    # 5. Quarantine Records
    quar_res = await uow.session.execute(
        select(QuarantineRecordModel).order_by(QuarantineRecordModel.created_at.desc())
    )
    all_quar = quar_res.scalars().all()
    active_quar = [q for q in all_quar if (q.status or "").upper() in ("PENDING_REVIEW", "QUARANTINED")]
    total_quar_qty = sum(float(q.damaged_quantity) for q in active_quar)

    # 6. Material Stock
    stock_res = await uow.session.execute(select(MaterialStockModel))
    all_stocks = stock_res.scalars().all()
    total_skus = len(all_stocks)
    total_on_hand = sum(float(s.on_hand) for s in all_stocks)
    total_available = sum(float(s.available) for s in all_stocks)
    total_allocated = sum(float(s.allocated) for s in all_stocks)
    # Count each affected store/material once. Global MaterialStock is not
    # sufficient because a material can be healthy globally but low in one
    # store.
    loc_stock_res = await uow.session.execute(
        select(InventoryLocationBalanceModel, StorageLocationModel, MaterialStockModel)
        .join(StorageLocationModel, StorageLocationModel.id == InventoryLocationBalanceModel.storage_location_id)
        .join(MaterialStockModel, MaterialStockModel.material_code == InventoryLocationBalanceModel.material_code)
    )
    store_material_totals = {}
    store_material_meta = {}
    for bal, loc, stock in loc_stock_res.all():
        key = (loc.store_id, bal.material_code)
        store_material_totals[key] = store_material_totals.get(key, 0.0) + float(bal.available_quantity or 0)
        store_material_meta[key] = (bal, loc, stock)
    low_store_items = [key for key, qty in store_material_totals.items() if qty < float(store_material_meta[key][2].reorder_point)]
    out_store_items = [key for key, qty in store_material_totals.items() if qty <= 0]

    # 7. Stores, Zones, Bins
    stores_count_res = await uow.session.execute(select(func.count(StoreModel.id)))
    total_stores = stores_count_res.scalar() or 0

    zones_count_res = await uow.session.execute(select(func.count(StoreZoneModel.id)))
    total_zones = zones_count_res.scalar() or 0

    bins_res = await uow.session.execute(select(StoreBinModel))
    all_bins = bins_res.scalars().all()
    total_bins = len(all_bins)
    occupied_bins = sum(1 for b in all_bins if float(b.occupied_quantity or 0) > 0)
    available_bins = sum(1 for b in all_bins if float(b.occupied_quantity or 0) == 0 and (b.status or "").upper() == "ACTIVE")

    # 7b. Docks & Gate Overview
    from app.modules.dock.infrastructure.persistence.models import DockMasterModel, DockAllocationRequestModel
    from app.modules.gate.infrastructure.persistence.models import GateEntryModel

    docks_res = await uow.session.execute(select(DockMasterModel).where(DockMasterModel.is_active.is_(True)))
    all_docks = docks_res.scalars().all()
    total_docks = len(all_docks)
    occupied_docks = sum(1 for d in all_docks if (d.status or "").upper() in ("OCCUPIED", "IN_USE"))
    available_docks = sum(1 for d in all_docks if (d.status or "").upper() in ("AVAILABLE", "ACTIVE"))

    ge_res = await uow.session.execute(select(GateEntryModel).order_by(GateEntryModel.created_at.desc()))
    all_ges = ge_res.scalars().all()
    total_gate_entries = len(all_ges)
    awaiting_dock_count = sum(1 for ge in all_ges if (ge.status or "").upper() in ("AWAITING_DOCK", "REGISTERED", "APPROVED", "PO_VERIFIED"))

    # 8. Unified Warehouse Activity Feed
    activity: List[Dict[str, Any]] = []

    # Recent Putaways
    for p in all_putaways[:5]:
        is_done = (p.status or "").upper() == "PUTAWAY_COMPLETED"
        activity.append({
            "id": f"pt-{p.id}",
            "timestamp": (p.completed_at or p.created_at).isoformat(),
            "type": "PUTAWAY",
            "title": f"Putaway {'Completed' if is_done else 'Pending'} · {p.task_number}",
            "detail": f"{p.material_name} ({p.item_code}) · Qty: {float(p.quantity)} {p.uom} · GRN: {p.grn_number}",
            "tone": "success" if is_done else "primary",
        })

    # Recent Pickups
    for p in all_pickups[:5]:
        activity.append({
            "id": f"pck-{p.id}",
            "timestamp": p.created_at.isoformat(),
            "type": "PICKUP",
            "title": f"Store Pickup · {p.task_number}",
            "detail": f"{p.material_name} ({p.material_code}) · Qty: {float(p.requested_quantity)} {p.uom} · Store: {p.store_name}",
            "tone": "purple" if (p.status or "").upper() == "ASSIGNED_TO_STORE" else "success",
        })

    # Recent Quarantine
    for q in active_quar[:5]:
        activity.append({
            "id": f"qr-{q.id}",
            "timestamp": q.created_at.isoformat(),
            "type": "QUARANTINE",
            "title": f"Quarantine Segregation · {q.quarantine_number}",
            "detail": f"{q.material_name} ({q.item_code}) · Damaged Qty: {float(q.damaged_quantity)} {q.uom} · GRN: {q.grn_number}",
            "tone": "warning",
        })

    # Sort activity descending by timestamp
    activity.sort(key=lambda x: x["timestamp"], reverse=True)
    activity = activity[:8]

    return {
        "action_required": {
            "pending_putaway_count": len(pending_putaway_list),
            "pending_putaways": [
                {
                    "id": str(p.id),
                    "task_number": p.task_number,
                    "item_code": p.item_code,
                    "material_name": p.material_name,
                    "quantity": float(p.quantity),
                    "uom": p.uom,
                    "grn_number": p.grn_number,
                    "status": p.status,
                    "created_at": p.created_at.isoformat(),
                }
                for p in pending_putaway_list[:5]
            ],
            "pending_pickup_count": len(pending_pickups),
            "pending_pickups": [
                {
                    "id": str(p.id),
                    "task_number": p.task_number,
                    "requisition_number": p.requisition_number,
                    "material_code": p.material_code,
                    "material_name": p.material_name,
                    "quantity": float(p.requested_quantity),
                    "uom": p.uom,
                    "store_name": p.store_name,
                    "department": p.department,
                    "priority": p.priority,
                    "status": p.status,
                    "created_at": p.created_at.isoformat(),
                }
                for p in pending_pickups[:5]
            ],
            "pending_requisition_count": pending_req_count,
            "pending_material_request_count": pending_mr_count,
            "active_quarantine_count": len(active_quar),
            "active_quarantine_qty": total_quar_qty,
            "quarantine_records": [
                {
                    "id": str(q.id),
                    "quarantine_number": q.quarantine_number,
                    "item_code": q.item_code,
                    "material_name": q.material_name,
                    "damaged_quantity": float(q.damaged_quantity),
                    "uom": q.uom,
                    "grn_number": q.grn_number,
                    "reason": q.reason,
                    "status": q.status,
                    "created_at": q.created_at.isoformat(),
                }
                for q in active_quar[:5]
            ],
            "low_stock_count": len(low_store_items),
            "low_stock_items": [
                {
                    "id": str(store_material_meta[key][0].id),
                    "material_code": key[1],
                    "material_name": store_material_meta[key][0].material_name,
                    "category": store_material_meta[key][2].category,
                    "on_hand": store_material_totals[key],
                    "available": store_material_totals[key],
                    "reorder_point": float(store_material_meta[key][2].reorder_point),
                    "uom": store_material_meta[key][0].uom,
                    "store_id": str(key[0]) if key[0] else None,
                }
                for key in low_store_items[:5]
            ],
            "out_of_stock_count": len(out_store_items),
            "unassigned_locations_count": unassigned_putaway_count,
        },
        "inventory_snapshot": {
            "total_skus": total_skus,
            "total_on_hand": total_on_hand,
            "total_available": total_available,
            "total_allocated": total_allocated,
            "total_quarantined": total_quar_qty,
            "low_stock_count": len(low_store_items),
            "out_of_stock_count": len(out_store_items),
        },
        "putaway_summary": {
            "pending_count": len(pending_putaway_list),
            "in_progress_count": len(in_progress_putaway_list),
            "completed_count": len(completed_putaway_list),
            "recent_tasks": [
                {
                    "id": str(p.id),
                    "task_number": p.task_number,
                    "item_code": p.item_code,
                    "material_name": p.material_name,
                    "quantity": float(p.quantity),
                    "uom": p.uom,
                    "grn_number": p.grn_number,
                    "status": p.status,
                    "destination_bin_code": p.destination_bin_code,
                    "destination_zone": p.destination_zone,
                    "created_at": p.created_at.isoformat(),
                }
                for p in all_putaways[:5]
            ],
        },
        "storage_overview": {
            "total_stores": total_stores,
            "total_zones": total_zones,
            "total_bins": total_bins,
            "occupied_bins": occupied_bins,
            "available_bins": available_bins,
        },
        "dock_overview": {
            "total_docks": total_docks,
            "occupied_docks": occupied_docks,
            "available_docks": available_docks,
            "total_gate_entries": total_gate_entries,
            "awaiting_dock_count": awaiting_dock_count,
        },
        "recent_activity": activity,
    }


class TakeawayRequest(BaseModel):
    bin_scan: str
    material_scan: str
    quantity: Decimal
    remarks: Optional[str] = None
    reference_document: Optional[str] = None


@inventory_router.post("/takeaway")
async def perform_takeaway(
    req: TakeawayRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> Dict[str, Any]:
    """
    Perform authorized material takeaway from a Store Bin.
    Validates Store Manager / Store Keeper RBAC and Store isolation.
    Scans Bin QR & Material QR, decrements bin inventory, updates Material Stock,
    and creates an audit trail entry in InventoryMovementHistoryModel.
    """
    roles_upper = {r.upper() for r in (user.roles or [])}
    is_store_user = ("STORE_MANAGER" in roles_upper or "STORE_KEEPER" in roles_upper)
    is_admin = bool(roles_upper.intersection({"ADMIN", "SUPERUSER", "WAREHOUSE", "WAREHOUSE_MANAGER"}))

    if not is_store_user and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Store Managers or Store Keepers can perform takeaway operations.",
        )

    if req.quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Takeaway quantity must be greater than zero.",
        )

    # 1. Resolve Bin
    bin_raw = req.bin_scan.strip()
    bin_identifier = bin_raw
    if bin_raw.startswith("{") and bin_raw.endswith("}"):
        try:
            import json as _json
            parsed = _json.loads(bin_raw)
            bin_identifier = parsed.get("bin_id") or parsed.get("bin_code") or parsed.get("location_code") or bin_raw
        except Exception:
            bin_identifier = bin_raw

    bin_obj = None
    try:
        b_uuid = uuid.UUID(str(bin_identifier))
        bin_obj = await uow.session.get(StoreBinModel, b_uuid)
    except (ValueError, TypeError):
        pass

    if bin_obj is None:
        bq = await uow.session.execute(
            select(StoreBinModel).where(func.upper(StoreBinModel.bin_code) == str(bin_identifier).strip().upper())
        )
        bin_obj = bq.scalar_one_or_none()

    if bin_obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scanned Bin '{bin_raw}' not found in any store.",
        )

    # 2. Store isolation & RBAC check
    target_store = await uow.session.get(StoreModel, bin_obj.store_id)
    if not target_store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent Store for Bin not found.")

    if is_store_user and not is_admin:
        user_store_id, user_store_code = await _resolve_user_store_context(uow, user)
        # Check against user_store_id or store_code or username
        store_match = False
        if user_store_id and user_store_id == target_store.id:
            store_match = True
        elif user_store_code and user_store_code.strip().upper() == target_store.store_code.strip().upper():
            store_match = True
        elif target_store.store_manager_id and (
            target_store.store_manager_id.lower() == (user.username or "").lower()
            or target_store.store_manager_id.lower() == (user.subject or "").lower()
        ):
            store_match = True

        if not store_match:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access forbidden: You can only perform takeaway operations for your assigned Store ('{target_store.store_code}').",
            )

    # 3. Resolve Material
    mat_raw = req.material_scan.strip()
    cleaned_mat_code = mat_raw
    if mat_raw.startswith("{") and mat_raw.endswith("}"):
        try:
            import json as _json
            parsed = _json.loads(mat_raw)
            cleaned_mat_code = parsed.get("item_code") or parsed.get("material_code") or parsed.get("barcode_value") or mat_raw
        except Exception:
            cleaned_mat_code = mat_raw

    if cleaned_mat_code.upper().startswith("QR-MAT-"):
        cleaned_mat_code = cleaned_mat_code[7:]
    elif cleaned_mat_code.upper().startswith("QR-"):
        cleaned_mat_code = cleaned_mat_code[3:]

    # If cleaned_mat_code is not directly matched, check GrnBatchQr, HandlingUnit, or PutawayTask
    qr_batch = await uow.session.scalar(select(GrnBatchQrModel).where(GrnBatchQrModel.qr_code == mat_raw))
    if qr_batch and qr_batch.item_code:
        cleaned_mat_code = qr_batch.item_code
    else:
        hu_match = await uow.session.scalar(
            select(HandlingUnitModel).where(
                or_(
                    HandlingUnitModel.barcode_value == mat_raw,
                    HandlingUnitModel.hu_number == mat_raw,
                )
            )
        )
        if hu_match and hu_match.item_code:
            cleaned_mat_code = hu_match.item_code

    # 4. Find Storage Location for this Bin
    loc_res = await uow.session.execute(
        select(StorageLocationModel).where(
            or_(
                StorageLocationModel.bin_id == bin_obj.id,
                (
                    (StorageLocationModel.store_id == bin_obj.store_id)
                    & (StorageLocationModel.bin == bin_obj.bin_code)
                ),
            )
        ).with_for_update()
    )
    storage_locs = loc_res.scalars().all()
    loc_ids = [loc.id for loc in storage_locs]

    # 5. Find Inventory Location Balance
    bal_query = select(InventoryLocationBalanceModel).where(
        func.lower(InventoryLocationBalanceModel.material_code) == cleaned_mat_code.lower()
    )
    if loc_ids:
        bal_query = bal_query.where(InventoryLocationBalanceModel.storage_location_id.in_(loc_ids))
    bal_res = await uow.session.execute(bal_query.with_for_update())
    balance = bal_res.scalar_one_or_none()

    if balance is None or balance.available_quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Material '{cleaned_mat_code}' has no available stock in Bin '{bin_obj.bin_code}'.",
        )

    if balance.available_quantity < req.quantity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Insufficient quantity available in Bin '{bin_obj.bin_code}'. Available: {balance.available_quantity} {balance.uom}, Requested: {req.quantity}.",
        )

    # 6. Fetch MaterialStockModel
    stock_res = await uow.session.execute(
        select(MaterialStockModel).where(MaterialStockModel.material_code == balance.material_code).with_for_update()
    )
    stock = stock_res.scalar_one_or_none()
    stock_before = stock.available if stock else balance.available_quantity

    # 7. Apply Stock Decrements
    balance.quantity = balance.quantity - req.quantity
    balance.available_quantity = balance.available_quantity - req.quantity
    now_utc = datetime.now(timezone.utc)
    balance.updated_at = now_utc

    bin_obj.occupied_quantity = max(Decimal("0.0"), (bin_obj.occupied_quantity or Decimal("0.0")) - req.quantity)
    bin_obj.updated_at = now_utc

    for sloc in storage_locs:
        if sloc.id == balance.storage_location_id:
            sloc.occupied_quantity = max(Decimal("0.0"), (sloc.occupied_quantity or Decimal("0.0")) - req.quantity)

    if stock:
        stock.available = max(Decimal("0.0"), stock.available - req.quantity)
        stock.on_hand = max(Decimal("0.0"), stock.on_hand - req.quantity)
        stock.updated_at = now_utc.replace(tzinfo=None)

    stock_after = stock.available if stock else balance.available_quantity

    # 8. Record Inventory Movement History
    movement_rec = InventoryMovementHistoryModel(
        movement_type="TAKEAWAY",
        material_code=balance.material_code,
        material_name=balance.material_name,
        material_qr=req.material_scan.strip(),
        grn_number=balance.last_grn_number,
        batch_lot=None,
        from_location=f"{target_store.store_code} / {bin_obj.bin_code}",
        to_location="OUTBOUND / TAKEAWAY",
        from_bin_id=bin_obj.id,
        to_bin_id=None,
        quantity=req.quantity,
        uom=balance.uom,
        stock_before=stock_before,
        stock_after=stock_after,
        performed_by=user.username,
        user_role=",".join(user.roles or []),
        warehouse_id=target_store.warehouse_id or "MAIN",
        store_id=target_store.id,
        store_code=target_store.store_code,
        reference_document=req.reference_document or "TAKEAWAY",
        remarks=req.remarks or f"Takeaway {req.quantity} {balance.uom} from Bin {bin_obj.bin_code}",
        performed_at=now_utc,
    )
    uow.session.add(movement_rec)
    await uow.session.flush()

    return {
        "success": True,
        "message": f"Successfully executed takeaway of {float(req.quantity)} {balance.uom} for {balance.material_name} ({balance.material_code})",
        "movement_id": str(movement_rec.id),
        "material_code": balance.material_code,
        "material_name": balance.material_name,
        "bin_code": bin_obj.bin_code,
        "store_code": target_store.store_code,
        "takeaway_quantity": float(req.quantity),
        "uom": balance.uom,
        "remaining_bin_quantity": float(balance.available_quantity),
        "total_stock_available": float(stock_after),
        "performed_by": user.username,
        "performed_at": now_utc.isoformat(),
    }


@inventory_router.get("/movement-history")
async def get_inventory_movement_history(
    movement_type: Optional[str] = None,
    material_code: Optional[str] = None,
    store_id: Optional[str] = None,
    bin_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> List[Dict[str, Any]]:
    """
    Query the complete inventory movement history audit trail (PUTAWAY, TAKEAWAY, TRANSFER, etc.).
    Enforces store-level isolation for Store Managers/Keepers.
    """
    user_store_id, _ = await _resolve_user_store_context(uow, user)
    if _is_store_scoped_role(user):
        if not user_store_id:
            raise HTTPException(status_code=403, detail="Store user context not assigned.")
        if store_id and str(user_store_id) != store_id:
            raise HTTPException(status_code=403, detail="Access forbidden: You cannot view movement history of another Store.")
        target_store_id = user_store_id
    else:
        target_store_id = uuid.UUID(store_id) if store_id else None

    stmt = select(InventoryMovementHistoryModel).order_by(InventoryMovementHistoryModel.performed_at.desc())
    if target_store_id:
        stmt = stmt.where(InventoryMovementHistoryModel.store_id == target_store_id)
    if movement_type and movement_type.upper() != "ALL":
        stmt = stmt.where(func.upper(InventoryMovementHistoryModel.movement_type) == movement_type.strip().upper())
    if material_code:
        stmt = stmt.where(func.lower(InventoryMovementHistoryModel.material_code) == material_code.strip().lower())
    if bin_id:
        try:
            b_uuid = uuid.UUID(bin_id)
            stmt = stmt.where(
                or_(
                    InventoryMovementHistoryModel.from_bin_id == b_uuid,
                    InventoryMovementHistoryModel.to_bin_id == b_uuid,
                )
            )
        except ValueError:
            pass

    res = await uow.session.execute(stmt.limit(300))
    records = res.scalars().all()

    output = []
    for r in records:
        ts = r.performed_at.isoformat() if r.performed_at else datetime.now(timezone.utc).isoformat()
        if start_date and ts[:10] < start_date.strip()[:10]:
            continue
        if end_date and ts[:10] > end_date.strip()[:10]:
            continue
        if search:
            st = search.strip().lower()
            if (
                st not in r.material_code.lower()
                and st not in r.material_name.lower()
                and st not in (r.material_qr or "").lower()
                and st not in (r.grn_number or "").lower()
                and st not in r.from_location.lower()
                and st not in r.to_location.lower()
                and st not in r.performed_by.lower()
                and st not in (r.store_code or "").lower()
            ):
                continue

        output.append({
            "id": str(r.id),
            "movement_type": r.movement_type,
            "material_code": r.material_code,
            "material_name": r.material_name,
            "material_qr": r.material_qr,
            "grn_number": r.grn_number,
            "batch_lot": r.batch_lot,
            "from_location": r.from_location,
            "to_location": r.to_location,
            "from_bin_id": str(r.from_bin_id) if r.from_bin_id else None,
            "to_bin_id": str(r.to_bin_id) if r.to_bin_id else None,
            "quantity": float(r.quantity),
            "uom": r.uom,
            "stock_before": float(r.stock_before) if r.stock_before is not None else None,
            "stock_after": float(r.stock_after) if r.stock_after is not None else None,
            "performed_by": r.performed_by,
            "user_role": r.user_role,
            "warehouse_id": r.warehouse_id,
            "store_id": str(r.store_id) if r.store_id else None,
            "store_code": r.store_code,
            "reference_document": r.reference_document,
            "remarks": r.remarks,
            "performed_at": ts,
        })

    return output
