"""
API Router for Outbound Material Request Store Pickup Tasks (Phase 7).
Enforces strict store-scoped access, IDOR protection, Material QR validation,
Store Zone validation, concurrency locking, and auditable inventory issue transactions.
"""
from __future__ import annotations

import datetime
import json
import uuid
from decimal import Decimal
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.database.session import UnitOfWork, get_uow
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialModel,
    MaterialStockModel,
    NotificationModel,
)
from app.modules.quarantine.infrastructure.persistence.models import QuarantineRecordModel
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionItemModel,
    AssemblyRequisitionModel,
    AssemblyStockReservationModel,
    HandlingUnitModel,
    InventoryIssueTransactionModel,
    InventoryLocationBalanceModel,
    InventoryMovementHistoryModel,
    PickupTaskModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreBinModel,
    StoreManagerUserModel,
    StoreModel,
    StoreZoneModel,
)
from app.security.dependencies import CurrentUser, get_current_user

pickup_router = APIRouter(prefix="/api/storage/pickup-tasks", tags=["pickup-tasks"])


class CompletePickupTaskRequest(BaseModel):
    material_scan: str = Field(..., min_length=1, description="Scanned Material QR payload or item code")
    zone_scan: str = Field(..., min_length=1, description="Scanned Zone QR payload, ID, or zone code")
    quantity: Decimal = Field(..., gt=0, description="Confirmed picked quantity")


async def _resolve_user_store_context(uow: UnitOfWork, user: CurrentUser) -> tuple[Optional[uuid.UUID], Optional[str]]:
    """Resolve store_id and store_code for a Store Manager or Store Keeper user."""
    claims = getattr(user, "raw_claims", {}) or {}
    store_id_str = claims.get("store_id")
    store_code = claims.get("store_code")

    if store_id_str:
        try:
            return uuid.UUID(str(store_id_str)), store_code
        except ValueError:
            pass

    # Lookup in StoreManagerUserModel
    username = user.username or ""
    stmt = (
        select(StoreManagerUserModel)
        .options()
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

    # Lookup by store_code if available
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


def _format_pickup_task(t: PickupTaskModel) -> dict[str, Any]:
    req_id = str(getattr(t, "requisition_id", None) or getattr(t, "request_id", ""))
    req_no = getattr(t, "requisition_number", None) or getattr(t, "request_number", "")
    return {
        "id": str(t.id),
        "task_number": t.task_number,
        "requisition_id": req_id,
        "requisition_number": req_no,
        "request_id": req_id,
        "request_number": req_no,
        "store_id": str(t.store_id),
        "store_code": t.store_code,
        "store_name": t.store_name,
        "department": t.department,
        "material_code": t.material_code,
        "material_name": t.material_name,
        "requested_quantity": float(t.requested_quantity),
        "picked_quantity": float(t.picked_quantity),
        "remaining_quantity": float(t.requested_quantity - t.picked_quantity),
        "uom": t.uom,
        "priority": t.priority,
        "required_date": t.required_date.isoformat() if t.required_date else None,
        "suggested_zone_id": str(t.suggested_zone_id) if t.suggested_zone_id else None,
        "suggested_zone_code": t.suggested_zone_code,
        "picked_zone_id": str(t.picked_zone_id) if t.picked_zone_id else None,
        "picked_zone_code": t.picked_zone_code,
        "status": t.status,
        "assigned_by": t.assigned_by,
        "assigned_at": t.assigned_at.isoformat() if t.assigned_at else None,
        "started_by": t.started_by,
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "completed_by": t.completed_by,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


@pickup_router.get("", response_model=List[dict[str, Any]])
async def list_pickup_tasks(
    store_id: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    material_code: Optional[str] = None,
    search: Optional[str] = None,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """List outbound pickup tasks. Store Managers and Store Keepers are strictly scoped to their Store."""
    roles = [r.upper() for r in (user.roles or [])]
    is_warehouse_or_admin = any(r in ["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"] for r in roles)
    is_store_user = any(r in ["STORE_MANAGER", "STORE_KEEPER"] for r in roles)

    if not is_warehouse_or_admin and not is_store_user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Only Warehouse personnel and Store Keepers can access Pickup Tasks.",
        )

    stmt = select(PickupTaskModel).order_by(PickupTaskModel.created_at.desc())

    if is_store_user and not is_warehouse_or_admin:
        user_store_id, user_store_code = await _resolve_user_store_context(uow, user)
        if user_store_id:
            stmt = stmt.where(PickupTaskModel.store_id == user_store_id)
        elif user_store_code:
            stmt = stmt.where(
                or_(
                    func.lower(PickupTaskModel.store_code) == user_store_code.lower(),
                    func.lower(PickupTaskModel.store_code).like(f"%{user_store_code.lower()}%"),
                )
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Store Keeper is not associated with any active Store.",
            )

        # If user explicitly requested a specific store_id that doesn't match theirs, return 403
        if store_id:
            try:
                requested_store_uuid = uuid.UUID(store_id)
                if user_store_id and requested_store_uuid != user_store_id:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access denied. Cannot query another Store's pickup tasks.",
                    )
            except ValueError:
                pass
    elif store_id:
        try:
            store_uuid = uuid.UUID(store_id)
            stmt = stmt.where(PickupTaskModel.store_id == store_uuid)
        except ValueError:
            stmt = stmt.where(func.lower(PickupTaskModel.store_code) == store_id.lower())

    if status_filter and status_filter.upper() != "ALL":
        stmt = stmt.where(func.upper(PickupTaskModel.status) == status_filter.upper())

    if material_code:
        stmt = stmt.where(func.lower(PickupTaskModel.material_code) == material_code.lower())

    if search:
        s = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(PickupTaskModel.task_number).like(s),
                func.lower(PickupTaskModel.request_number).like(s),
                func.lower(PickupTaskModel.material_code).like(s),
                func.lower(PickupTaskModel.material_name).like(s),
                func.lower(PickupTaskModel.department).like(s),
            )
        )

    res = await uow.session.execute(stmt)
    tasks = res.scalars().all()
    return [_format_pickup_task(t) for t in tasks]


@pickup_router.get("/{id}", response_model=dict[str, Any])
async def get_pickup_task(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """Get single pickup task details with IDOR store validation."""
    try:
        task_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Pickup Task UUID")

    stmt = select(PickupTaskModel).where(PickupTaskModel.id == task_uuid)
    res = await uow.session.execute(stmt)
    task = res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pickup task not found")

    roles = [r.upper() for r in (user.roles or [])]
    is_warehouse_or_admin = any(r in ["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"] for r in roles)
    is_store_user = any(r in ["STORE_MANAGER", "STORE_KEEPER"] for r in roles)

    if not is_warehouse_or_admin and not is_store_user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if is_store_user and not is_warehouse_or_admin:
        user_store_id, user_store_code = await _resolve_user_store_context(uow, user)
        if user_store_id and task.store_id != user_store_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. This pickup task belongs to '{task.store_name}'.",
            )
        elif not user_store_id and user_store_code and task.store_code.lower() != user_store_code.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. This pickup task belongs to '{task.store_name}'.",
            )

    return _format_pickup_task(task)


@pickup_router.post("/{id}/start", response_model=dict[str, Any])
async def start_pickup_task(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """Start physical picking for a task. Restricted to assigned Store Keeper."""
    try:
        task_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Pickup Task UUID")

    roles = [r.upper() for r in (user.roles or [])]
    is_store_user = any(r in ["STORE_MANAGER", "STORE_KEEPER"] for r in roles)
    is_admin = any(r in ["ADMIN", "SUPERUSER"] for r in roles)

    if not is_store_user and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Warehouse cannot directly start physical Store picking. This must be performed by the Store Keeper.",
        )

    stmt = select(PickupTaskModel).where(PickupTaskModel.id == task_uuid).with_for_update()
    res = await uow.session.execute(stmt)
    task = res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pickup task not found")

    if not is_admin:
        user_store_id, user_store_code = await _resolve_user_store_context(uow, user)
        if user_store_id and task.store_id != user_store_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Cannot start pickup task for '{task.store_name}'.",
            )

    if task.status.upper() in ["COMPLETED", "CANCELLED"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot start task in '{task.status}' status.",
        )

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    task.status = "PICKING"
    task.started_by = user.username or "store_keeper"
    task.started_at = now_utc
    task.updated_at = now_utc

    # Update Assembly Requisition status to PICKING
    req_id = getattr(task, "requisition_id", None) or getattr(task, "request_id", None)
    if req_id:
        req_stmt = select(AssemblyRequisitionModel).where(AssemblyRequisitionModel.id == req_id)
        req_res = await uow.session.execute(req_stmt)
        req = req_res.scalar_one_or_none()
        if req and req.status.upper() in ["PENDING", "SUBMITTED", "ASSIGNED_TO_STORE"]:
            req.status = "PICKING"
            req.updated_at = now_utc

    await uow.commit()
    return _format_pickup_task(task)


@pickup_router.post("/{id}/complete", response_model=dict[str, Any])
async def complete_pickup_task(
    id: str,
    payload: CompletePickupTaskRequest,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Confirm physical picking and issue material to Assembly.
    Validates Material QR, validates Store Zone, checks available stock with FOR UPDATE lock,
    decrements stock, records InventoryIssueTransactionModel, and updates request lifecycle.
    """
    try:
        task_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Pickup Task UUID")

    roles = [r.upper() for r in (user.roles or [])]
    is_store_user = any(r in ["STORE_MANAGER", "STORE_KEEPER"] for r in roles)
    is_admin = any(r in ["ADMIN", "SUPERUSER"] for r in roles)

    # Warehouse direct completion prohibited
    if not is_store_user and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Warehouse personnel cannot directly confirm physical Store pickup. This must be executed by the Store Keeper.",
        )

    stmt = select(PickupTaskModel).where(PickupTaskModel.id == task_uuid).with_for_update()
    res = await uow.session.execute(stmt)
    task = res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pickup task not found")

    # 1. Store IDOR Verification
    if not is_admin:
        user_store_id, user_store_code = await _resolve_user_store_context(uow, user)
        if user_store_id and task.store_id != user_store_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Cannot complete pickup task for '{task.store_name}'.",
            )
        elif not user_store_id and user_store_code and task.store_code.lower() != user_store_code.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Cannot complete pickup task for '{task.store_name}'.",
            )

    # 2. Status Validation
    if task.status.upper() == "COMPLETED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Pickup task '{task.task_number}' is already COMPLETED.",
        )

    remaining_needed = task.requested_quantity - task.picked_quantity
    if payload.quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Picked quantity must be greater than zero.",
        )
    if payload.quantity > remaining_needed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Picked quantity ({payload.quantity}) exceeds remaining requested quantity ({remaining_needed} {task.uom}).",
        )

    # 3. Material QR Validation
    scanned_mat = payload.material_scan.strip()
    target_mat_code = task.material_code.strip()
    mat_matches = False

    if scanned_mat.upper() == target_mat_code.upper():
        mat_matches = True
    else:
        try:
            parsed = json.loads(scanned_mat)
            if isinstance(parsed, dict):
                p_code = parsed.get("item_code") or parsed.get("material_code") or parsed.get("material_tag") or parsed.get("code") or ""
                if str(p_code).strip().upper() == target_mat_code.upper():
                    mat_matches = True
        except (json.JSONDecodeError, ValueError):
            pass

    # Multi-line label format parsing (e.g. "Material Code: MAT-MOTOR-001")
    if not mat_matches:
        for line in scanned_mat.splitlines():
            label, separator, candidate = line.partition(":")
            if separator and label.strip().upper() in {"MATERIAL CODE", "ITEM CODE", "MATERIAL TAG", "CODE", "MAT", "ITEM"}:
                if candidate.strip().upper() == target_mat_code.upper():
                    mat_matches = True
                    break

    if not mat_matches and target_mat_code.upper() in scanned_mat.upper():
        mat_matches = True

    # Handling Unit database lookup
    if not mat_matches:
        hu_res = await uow.session.execute(
            select(HandlingUnitModel.item_code).where(
                or_(
                    HandlingUnitModel.hu_number == scanned_mat,
                    HandlingUnitModel.barcode_value == scanned_mat,
                )
            )
        )
        hu_item_code = hu_res.scalar_one_or_none()
        if hu_item_code and hu_item_code.upper() == target_mat_code.upper():
            mat_matches = True

    if not mat_matches:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Scanned Material QR does not match requested material '{target_mat_code}'.",
        )

    # 4. Store Zone/Bin Validation. Pickup labels may contain either a zone
    # QR or a bin QR; a bin resolves to its owning zone for the stock issue.
    scanned_zone_str = payload.zone_scan.strip()
    zone: StoreZoneModel | None = None
    scanned_bin: StoreBinModel | None = None

    # Try UUID
    try:
        zone = await uow.session.get(StoreZoneModel, uuid.UUID(scanned_zone_str))
    except (ValueError, TypeError):
        pass

    if zone is None:
        try:
            scanned_bin = await uow.session.get(StoreBinModel, uuid.UUID(scanned_zone_str))
        except (ValueError, TypeError):
            pass

    if zone is None:
        # Check if JSON payload or QR string like WMS:ZONE:<code>:<id>
        candidate_code = scanned_zone_str
        if scanned_zone_str.startswith("WMS:ZONE:"):
            parts = scanned_zone_str.split(":")
            if len(parts) >= 3:
                candidate_code = parts[2]
        else:
            try:
                parsed_z = json.loads(scanned_zone_str)
                if isinstance(parsed_z, dict):
                    candidate_code = (
                        parsed_z.get("bin_code")
                        or parsed_z.get("bin_id")
                        or parsed_z.get("zone_code")
                        or parsed_z.get("zone_id")
                        or scanned_zone_str
                    )
            except (json.JSONDecodeError, ValueError):
                pass

        if scanned_bin is None:
            bin_stmt = select(StoreBinModel).where(
                or_(
                    func.upper(StoreBinModel.bin_code) == candidate_code.strip().upper(),
                    func.lower(StoreBinModel.bin_name) == candidate_code.strip().lower(),
                )
            )
            bin_res = await uow.session.execute(bin_stmt)
            scanned_bin = bin_res.scalars().first()
        if scanned_bin is not None:
            zone = await uow.session.get(StoreZoneModel, scanned_bin.zone_id)

        if zone is None:
            zone_stmt = select(StoreZoneModel).where(
                or_(
                    func.upper(StoreZoneModel.zone_code) == candidate_code.strip().upper(),
                    func.lower(StoreZoneModel.zone_name) == candidate_code.strip().lower(),
                )
            )
            zone_res = await uow.session.execute(zone_stmt)
            zone = zone_res.scalars().first()
    if not zone:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Zone '{scanned_zone_str}' not found.",
        )
    if zone.status.upper() != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Zone '{zone.zone_code}' is inactive.",
        )

    # Cross-store Zone Validation: Zone MUST belong to the task's assigned Store!
    if zone.store_id != task.store_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Zone '{zone.zone_code}' does not belong to assigned Store '{task.store_name}'. Cannot pick from another Store.",
        )
    if scanned_bin is not None and scanned_bin.store_id != task.store_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Bin '{scanned_bin.bin_code}' does not belong to assigned Store '{task.store_name}'.",
        )

    # 5. Inventory Stock Validation & Concurrency Lock
    stock_stmt = (
        select(MaterialStockModel)
        .where(MaterialStockModel.material_code == task.material_code)
        .with_for_update()
    )
    stock_res = await uow.session.execute(stock_stmt)
    stock = stock_res.scalar_one_or_none()

    # Check for any active quarantine records for this material
    quar_stmt = select(func.coalesce(func.sum(QuarantineRecordModel.damaged_quantity), Decimal("0.0"))).where(
        QuarantineRecordModel.item_code == task.material_code,
        QuarantineRecordModel.status.in_(["PENDING_REVIEW", "QUARANTINED"]),
    )
    quar_res = await uow.session.execute(quar_stmt)
    quarantined_qty = quar_res.scalar() or Decimal("0.0")

    available_stock = stock.available if stock else Decimal("0.0")
    allocated_stock = stock.allocated if stock else Decimal("0.0")
    on_hand_stock = stock.on_hand if stock else Decimal("0.0")
    # For a pickup task, the usable stock includes both free available and allocated (reserved for AR) stock
    usable_stock = max(available_stock, on_hand_stock, available_stock + allocated_stock)
    effective_available = max(Decimal("0.0"), usable_stock - quarantined_qty)

    if not stock or effective_available < payload.quantity:
        avail = float(effective_available)
        quar_info = f" ({float(quarantined_qty)} {task.uom} quarantined/blocked)" if quarantined_qty > 0 else ""
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient available stock for '{task.material_code}' in {task.store_name}{quar_info}. Requested: {payload.quantity}, Available: {avail} {task.uom}.",
        )

    # 6. Atomic Inventory Deduction
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    stock_before = stock.available if stock.allocated == Decimal("0.0") else stock.on_hand
    if stock.allocated >= payload.quantity:
        stock.allocated = stock.allocated - payload.quantity
    elif stock.allocated > Decimal("0.0"):
        stock.allocated = Decimal("0.0")
    else:
        stock.available = max(Decimal("0.0"), stock.available - payload.quantity)
    stock.on_hand = max(Decimal("0.0"), stock.on_hand - payload.quantity)
    stock.available = max(Decimal("0.0"), min(stock.available, stock.on_hand - stock.allocated))
    stock_after = stock.available if stock.allocated == Decimal("0.0") and stock_before == (stock.available + payload.quantity) else stock.on_hand
    stock.updated_at = now_utc.replace(tzinfo=None)

    # Decrement location balance if existing
    loc_balance_stmt = (
        select(InventoryLocationBalanceModel)
        .join(StorageLocationModel, InventoryLocationBalanceModel.storage_location_id == StorageLocationModel.id)
        .where(
            InventoryLocationBalanceModel.material_code == task.material_code,
            StorageLocationModel.store_id == task.store_id,
            StorageLocationModel.zone_id == zone.id,
        )
        .where(
            StorageLocationModel.bin_id == scanned_bin.id
            if scanned_bin is not None
            else True
        )
        .with_for_update()
    )
    loc_balance_res = await uow.session.execute(loc_balance_stmt)
    loc_balance = loc_balance_res.scalars().first()
    if loc_balance:
        loc_balance.available_quantity = max(Decimal("0.0"), loc_balance.available_quantity - payload.quantity)
        loc_balance.quantity = max(Decimal("0.0"), loc_balance.quantity - payload.quantity)
        loc_balance.updated_at = now_utc

    # 7. Record Immutable Inventory Issue Transaction
    issue_no = f"ISS-{now_utc.year}-{uuid.uuid4().hex[:6].upper()}"
    req_id_val = getattr(task, "requisition_id", None) or getattr(task, "request_id", None)
    req_no_val = getattr(task, "requisition_number", None) or getattr(task, "request_number", "")
    issue_tx = InventoryIssueTransactionModel(
        id=uuid.uuid4(),
        issue_number=issue_no,
        requisition_id=req_id_val,
        requisition_number=req_no_val,
        pickup_task_id=task.id,
        store_id=task.store_id,
        store_code=task.store_code,
        zone_id=zone.id,
        zone_code=zone.zone_code,
        material_code=task.material_code,
        material_name=task.material_name,
        quantity=payload.quantity,
        uom=task.uom,
        recipient_department=task.department,
        stock_before=stock_before,
        stock_after=stock_after,
        issued_by=user.username or "store_keeper",
        issued_at=now_utc,
    )
    uow.session.add(issue_tx)

    # Keep the common pickup workflow auditable for finished goods as a
    # dispatch movement, while retaining TAKEAWAY for raw-material stores.
    store_obj = await uow.session.get(StoreModel, task.store_id)
    is_finished_goods = bool(
        store_obj and (
            (store_obj.store_type or "").upper() == "FINISHED_GOODS"
            or "FINISHED GOODS" in (store_obj.store_name or "").upper()
        )
    )
    uow.session.add(InventoryMovementHistoryModel(
        id=uuid.uuid4(),
        movement_type="DISPATCH" if is_finished_goods else "TAKEAWAY",
        material_code=task.material_code,
        material_name=task.material_name,
        material_qr=scanned_mat[:128],
        from_location=f"{task.store_name} / {zone.zone_code}",
        to_location=task.department or ("CUSTOMER_DISPATCH" if is_finished_goods else "ASSEMBLY"),
        quantity=payload.quantity,
        uom=task.uom,
        stock_before=stock_before,
        stock_after=stock_after,
        performed_by=user.username or "store_keeper",
        user_role="STORE_MANAGER" if "STORE_MANAGER" in roles else "STORE_KEEPER",
        warehouse_id="MAIN",
        store_id=task.store_id,
        store_code=task.store_code,
        reference_document=req_no_val,
        remarks="Finished goods dispatch" if is_finished_goods else "Assembly material pickup",
        performed_at=now_utc,
    ))

    # 8. Update Task Status
    task.picked_quantity = task.picked_quantity + payload.quantity
    task.picked_zone_id = zone.id
    task.picked_zone_code = zone.zone_code
    if task.picked_quantity >= task.requested_quantity:
        task.status = "COMPLETED"
    else:
        task.status = "PARTIALLY_PICKED"
    task.completed_by = user.username or "store_keeper"
    task.completed_at = now_utc
    task.updated_at = now_utc

    # 9. Update Assembly Requisition Lifecycle
    if req_id_val:
        req_stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
            AssemblyRequisitionModel.id == req_id_val
        )
        req_res = await uow.session.execute(req_stmt)
        req = req_res.scalar_one_or_none()
        if req:
            # Update item issued quantity
            for it in req.items:
                if it.material_code == task.material_code:
                    it.issued_quantity = (it.issued_quantity or Decimal("0.0")) + payload.quantity

            # Check all tasks for this Requisition
            all_tasks_res = await uow.session.execute(
                select(PickupTaskModel).where(PickupTaskModel.requisition_id == req.id)
            )
            all_tasks = all_tasks_res.scalars().all()
            all_completed = all(t.status.upper() == "COMPLETED" for t in all_tasks)
            if all_completed:
                req.status = "PICKED_UP"
            else:
                req.status = "PARTIALLY_PICKED_UP"
            req.updated_at = now_utc

        # Update matching AssemblyStockReservationModel status
        res_stmt = select(AssemblyStockReservationModel).where(
            AssemblyStockReservationModel.requisition_id == req_id_val,
            AssemblyStockReservationModel.material_code == task.material_code,
        )
        res_rows = (await uow.session.execute(res_stmt)).scalars().all()
        for res_obj in res_rows:
            if task.status.upper() == "COMPLETED":
                res_obj.status = "FULFILLED"

    # 10. Notifications to Assembly and Warehouse
    notif_assembly = NotificationModel(
        id=uuid.uuid4(),
        user_role="ASSEMBLY",
        title=f"Material Handover Complete — {req_no_val}",
        message=f"{payload.quantity} {task.uom} of {task.material_name} ({task.material_code}) issued from {task.store_name} ({zone.zone_code}) to {task.department}.",
        link="/assembly/requests",
        is_read=False,
    )
    uow.session.add(notif_assembly)

    notif_wh = NotificationModel(
        id=uuid.uuid4(),
        user_role="WAREHOUSE",
        title=f"Pickup Task Completed — {task.task_number}",
        message=f"Pickup task {task.task_number} for {task.material_code} ({payload.quantity} {task.uom}) completed by {task.store_name}.",
        link="/warehouse/assembly-requisitions",
        is_read=False,
    )
    uow.session.add(notif_wh)

    await uow.commit()

    resp = _format_pickup_task(task)
    resp["issue_number"] = issue_no
    resp["inventory_available_before"] = float(stock_before)
    resp["inventory_available_after"] = float(stock_after)
    return resp
