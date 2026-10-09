import json
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.api_model import ApiModel
from app.database.session import UnitOfWork, get_uow
from app.common.persistence.models import (
    MaterialModel,
    MaterialRequestItemModel,
    MaterialRequestModel,
    MaterialStockModel,
    MaterialVariantModel,
    NotificationModel,
)
from app.modules.quarantine.infrastructure.persistence.models import QuarantineRecordModel
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionItemModel,
    AssemblyRequisitionModel,
    AssemblyStockReservationModel,
    InventoryIssueTransactionModel,
    InventoryLocationBalanceModel,
    PickupTaskModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreBinModel,
    StoreModel,
    StoreZoneModel,
)
from app.security.dependencies import CurrentUser, get_current_user

router = APIRouter(prefix="/api/v1/assembly-requisitions", tags=["assembly-requisitions"])


class AssemblyStockReservationSchema(ApiModel):
    id: str
    requisition_id: str
    requisition_item_id: str
    requisition_number: str
    material_code: str
    material_name: str
    required_quantity: Decimal
    reserved_quantity: Decimal
    uom: str = "PCS"
    status: str = "RESERVED FOR ASSEMBLY"
    store_id: Optional[str] = None
    store_code: Optional[str] = None
    store_name: Optional[str] = None
    zone_code: Optional[str] = None
    bin_code: Optional[str] = None
    location_code: Optional[str] = None
    allocations: List[dict] = Field(default_factory=list)
    reserved_by: str
    reserved_at: datetime


class AssemblyRequisitionItemSchema(ApiModel):
    id: Optional[str] = None
    material_id: Optional[str] = None
    material_variant_id: Optional[str] = None
    material_code: str
    variant_code: Optional[str] = None
    material_name: str
    requested_quantity: Decimal
    required_quantity: Decimal = Decimal("0.0")
    issued_quantity: Decimal = Decimal("0.0")
    available_quantity: Decimal = Decimal("0.0")
    reserved_quantity: Decimal = Decimal("0.0")
    shortage_quantity: Decimal = Decimal("0.0")
    has_sufficient_stock: bool = False
    uom: str = "PCS"
    status: str = "AVAILABLE"
    is_custom: bool = False
    custom_material_name: Optional[str] = None
    location_hint: Optional[str] = None


class CreateAssemblyRequisitionItem(BaseModel):
    material_id: Optional[str] = None
    material_variant_id: Optional[str] = None
    material_code: Optional[str] = None
    variant_code: Optional[str] = None
    material_name: Optional[str] = None
    quantity: Decimal
    uom: str
    is_custom: Optional[bool] = False
    custom_material_name: Optional[str] = None


class CreateAssemblyRequisitionRequest(BaseModel):
    warehouse_id: str
    department: str = "Assembly"
    requested_by: str
    priority: str = "MEDIUM"
    required_date: date
    remarks: Optional[str] = None
    items: List[CreateAssemblyRequisitionItem]


class AssignStoreToRequisitionRequest(BaseModel):
    store_id: Optional[str] = None


class RejectAssemblyRequisitionRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=1000)


class CreateMaterialForRequisitionItemRequest(BaseModel):
    material_name: Optional[str] = None
    category: Optional[str] = "Raw Materials"
    description: Optional[str] = None
    base_uom: Optional[str] = None
    specifications: Optional[dict] = None


class LinkMaterialToRequisitionItemRequest(BaseModel):
    material_id: str
    material_variant_id: Optional[str] = None


class AssemblyRequisitionResponse(ApiModel):
    id: str
    requisition_number: str
    warehouse_id: str
    department: str
    requested_by: str
    priority: str
    required_date: date
    status: str
    assigned_store_id: Optional[str] = None
    assigned_store_code: Optional[str] = None
    assigned_store_name: Optional[str] = None
    suggested_store_id: Optional[str] = None
    suggested_store_code: Optional[str] = None
    suggested_store_name: Optional[str] = None
    store_availability_summary: Optional[str] = None
    assigned_by: Optional[str] = None
    assigned_at: Optional[datetime] = None
    remarks: Optional[str] = None
    items: List[AssemblyRequisitionItemSchema] = []
    reservations: List[AssemblyStockReservationSchema] = []
    total_required: Decimal = Decimal("0.0")
    total_available: Decimal = Decimal("0.0")
    total_reserved: Decimal = Decimal("0.0")
    total_shortage: Decimal = Decimal("0.0")
    all_items_available: bool = False
    can_assign_store: bool = False
    availability_status: str = "AVAILABLE"
    availability_message: Optional[str] = None
    pickup_tracking: List[dict] = []
    pickup_progress: dict = {}
    created_at: datetime
    updated_at: datetime


async def _build_requisition_responses_with_availability(
    requisitions: List[AssemblyRequisitionModel],
    session: AsyncSession,
) -> List[AssemblyRequisitionResponse]:
    if not requisitions:
        return []

    req_ids = [r.id for r in requisitions]

    # 1. Collect all registered material codes across the requisitions
    material_codes = set()
    for r in requisitions:
        for it in (r.items or []):
            m_code = (it.material_code or "").strip()
            if m_code and m_code != "CUSTOM" and not getattr(it, "is_custom", False):
                material_codes.add(m_code)

    stock_map: Dict[str, Decimal] = {}
    loc_bal_map: Dict[str, Decimal] = {}
    quar_map: Dict[str, Decimal] = {}
    location_hints_map: Dict[str, List[str]] = {}
    active_reservations_map: Dict[str, Decimal] = {}

    if material_codes:
        # Fetch MaterialStockModel
        stocks_res = await session.execute(
            select(MaterialStockModel).where(MaterialStockModel.material_code.in_(material_codes))
        )
        for s in stocks_res.scalars().all():
            stock_map[s.material_code] = Decimal(str(s.available or 0))

        # Fetch Location Balances
        loc_res = await session.execute(
            select(
                InventoryLocationBalanceModel.material_code,
                func.sum(InventoryLocationBalanceModel.available_quantity),
            )
            .where(InventoryLocationBalanceModel.material_code.in_(material_codes))
            .group_by(InventoryLocationBalanceModel.material_code)
        )
        for m_code, total_bal in loc_res.all():
            loc_bal_map[m_code] = Decimal(str(total_bal or 0))

        # Fetch Quarantined items
        quar_res = await session.execute(
            select(
                QuarantineRecordModel.item_code,
                func.sum(QuarantineRecordModel.damaged_quantity),
            )
            .where(
                QuarantineRecordModel.item_code.in_(material_codes),
                QuarantineRecordModel.status.in_(["PENDING_REVIEW", "QUARANTINED"]),
            )
            .group_by(QuarantineRecordModel.item_code)
        )
        for m_code, total_quar in quar_res.all():
            quar_map[m_code] = Decimal(str(total_quar or 0))

        # Fetch active reservations across all requisitions for these materials
        res_stmt = (
            select(
                AssemblyStockReservationModel.material_code,
                func.sum(AssemblyStockReservationModel.reserved_quantity),
            )
            .where(
                AssemblyStockReservationModel.material_code.in_(material_codes),
                AssemblyStockReservationModel.status == "RESERVED FOR ASSEMBLY",
            )
            .group_by(AssemblyStockReservationModel.material_code)
        )
        for m_code, tot_res in (await session.execute(res_stmt)).all():
            active_reservations_map[m_code] = Decimal(str(tot_res or 0))

        # Fetch location hints for materials (store, zone, bin)
        loc_details_stmt = (
            select(
                InventoryLocationBalanceModel.material_code,
                StorageLocationModel.location_code,
                StoreModel.store_name,
                StoreModel.store_code,
                StorageLocationModel.zone,
                StorageLocationModel.bin,
            )
            .join(StorageLocationModel, InventoryLocationBalanceModel.storage_location_id == StorageLocationModel.id)
            .outerjoin(StoreModel, StorageLocationModel.store_id == StoreModel.id)
            .where(
                InventoryLocationBalanceModel.material_code.in_(material_codes),
                InventoryLocationBalanceModel.available_quantity > 0,
            )
        )
        loc_details_rows = (await session.execute(loc_details_stmt)).all()
        for m_code, l_code, s_name, s_code, zone, bin_name in loc_details_rows:
            desc_parts = []
            if s_name or s_code:
                desc_parts.append(s_name or s_code)
            if zone:
                desc_parts.append(f"Zone {zone}")
            if bin_name and bin_name != "DEFAULT":
                desc_parts.append(f"Bin {bin_name}")
            hint_str = " · ".join(desc_parts) if desc_parts else l_code
            if m_code not in location_hints_map:
                location_hints_map[m_code] = []
            if hint_str and hint_str not in location_hints_map[m_code]:
                location_hints_map[m_code].append(hint_str)

        # Store-level inventory balance
        store_bal_stmt = (
            select(
                InventoryLocationBalanceModel.material_code,
                StoreModel.id,
                StoreModel.store_code,
                StoreModel.store_name,
                func.sum(InventoryLocationBalanceModel.available_quantity),
            )
            .join(StorageLocationModel, InventoryLocationBalanceModel.storage_location_id == StorageLocationModel.id)
            .join(StoreModel, StorageLocationModel.store_id == StoreModel.id)
            .where(
                InventoryLocationBalanceModel.material_code.in_(material_codes),
                InventoryLocationBalanceModel.available_quantity > 0,
            )
            .group_by(
                InventoryLocationBalanceModel.material_code,
                StoreModel.id,
                StoreModel.store_code,
                StoreModel.store_name,
            )
        )
        store_bal_rows = (await session.execute(store_bal_stmt)).all()
        store_mat_bal_map: Dict[tuple, Decimal] = {}
        for m_code, s_id, s_code, s_name, bal in store_bal_rows:
            store_mat_bal_map[(m_code, s_id)] = Decimal(str(bal or 0))

        # Baseline store info map with active stores
        store_all_res = await session.execute(select(StoreModel).where(StoreModel.status == "ACTIVE"))
        store_info_map: Dict[uuid.UUID, dict] = {
            s.id: {"id": str(s.id), "code": s.store_code, "name": s.store_name}
            for s in store_all_res.scalars().all()
        }

        # Store-level active reservations
        store_res_stmt = (
            select(
                AssemblyStockReservationModel.material_code,
                AssemblyStockReservationModel.store_id,
                func.sum(AssemblyStockReservationModel.reserved_quantity),
            )
            .where(
                AssemblyStockReservationModel.material_code.in_(material_codes),
                AssemblyStockReservationModel.status == "RESERVED FOR ASSEMBLY",
                AssemblyStockReservationModel.store_id.isnot(None),
            )
            .group_by(
                AssemblyStockReservationModel.material_code,
                AssemblyStockReservationModel.store_id,
            )
        )
        store_res_rows = (await session.execute(store_res_stmt)).all()
        store_mat_res_map: Dict[tuple, Decimal] = {}
        for m_code, s_id, tot_r in store_res_rows:
            store_mat_res_map[(m_code, s_id)] = Decimal(str(tot_r or 0))
    else:
        store_mat_bal_map = {}
        store_mat_res_map = {}
        store_info_map = {}

    # Fetch all reservation rows for these specific requisitions
    req_reservations_res = await session.execute(
        select(AssemblyStockReservationModel)
        .where(AssemblyStockReservationModel.requisition_id.in_(req_ids))
        .order_by(AssemblyStockReservationModel.reserved_at.asc())
    )
    all_req_reservations = req_reservations_res.scalars().all()
    reservations_by_req_id: Dict[uuid.UUID, List[AssemblyStockReservationModel]] = {}
    for res_row in all_req_reservations:
        reservations_by_req_id.setdefault(res_row.requisition_id, []).append(res_row)

    def get_effective_available(m_code: str) -> Decimal:
        stk_avail = stock_map.get(m_code, Decimal("0.0"))
        quar = quar_map.get(m_code, Decimal("0.0"))
        effective_stk = max(Decimal("0.0"), stk_avail - quar)
        loc_avail = loc_bal_map.get(m_code, Decimal("0.0"))
        return max(effective_stk, loc_avail)

    responses = []
    requisition_ids = [r.id for r in requisitions]
    pickup_map: Dict[uuid.UUID, List[PickupTaskModel]] = {rid: [] for rid in requisition_ids}
    if requisition_ids:
        pickup_result = await session.execute(
            select(PickupTaskModel).where(PickupTaskModel.requisition_id.in_(requisition_ids))
        )
        for task in pickup_result.scalars().all():
            pickup_map.setdefault(task.requisition_id, []).append(task)
    for r in requisitions:
        item_schemas: List[AssemblyRequisitionItemSchema] = []
        req_res_rows = reservations_by_req_id.get(r.id, [])
        reservation_schemas: List[AssemblyStockReservationSchema] = []
        for res_obj in req_res_rows:
            reservation_schemas.append(
                AssemblyStockReservationSchema(
                    id=str(res_obj.id),
                    requisition_id=str(res_obj.requisition_id),
                    requisition_item_id=str(res_obj.requisition_item_id),
                    requisition_number=res_obj.requisition_number,
                    material_code=res_obj.material_code,
                    material_name=res_obj.material_name,
                    required_quantity=Decimal(str(res_obj.required_quantity or 0)),
                    reserved_quantity=Decimal(str(res_obj.reserved_quantity or 0)),
                    uom=res_obj.uom or "PCS",
                    status=res_obj.status or "RESERVED FOR ASSEMBLY",
                    store_id=str(res_obj.store_id) if res_obj.store_id else None,
                    store_code=res_obj.store_code,
                    store_name=res_obj.store_name,
                    zone_code=res_obj.zone_code,
                    bin_code=res_obj.bin_code,
                    location_code=res_obj.location_code,
                    allocations=res_obj.allocations or [],
                    reserved_by=res_obj.reserved_by,
                    reserved_at=res_obj.reserved_at,
                )
            )

        tot_req = Decimal("0.0")
        tot_avail = Decimal("0.0")
        tot_res = Decimal("0.0")
        tot_short = Decimal("0.0")

        for it in (r.items or []):
            is_custom = bool(
                getattr(it, "is_custom", False)
                or it.material_code == "CUSTOM"
                or not it.material_id
            )
            req_qty = Decimal(str(it.requested_quantity or 0))
            res_qty = Decimal(str(getattr(it, "reserved_quantity", 0) or 0))

            tot_req += req_qty
            tot_res += res_qty

            if is_custom:
                avail_qty = Decimal("0.0")
                has_stock = False
                shortage = req_qty
                item_stat = "PENDING_CREATION"
                loc_hint = None
            else:
                physical_avail = get_effective_available(it.material_code)
                total_reserved_for_mat = active_reservations_map.get(it.material_code, Decimal("0.0"))
                # Other orders' reservations = total_reserved - this line's reserved
                other_orders_reserved = max(Decimal("0.0"), total_reserved_for_mat - res_qty)
                # Free unreserved stock in warehouse
                free_avail = max(Decimal("0.0"), physical_avail - total_reserved_for_mat)
                # Available to reserve for this line = physical available minus other orders' reservations
                avail_to_reserve = max(Decimal("0.0"), physical_avail - other_orders_reserved)

                remaining_shortage_after_res = max(Decimal("0.0"), req_qty - res_qty)
                shortage = max(Decimal("0.0"), remaining_shortage_after_res - free_avail)

                avail_qty = avail_to_reserve
                has_stock = (res_qty >= req_qty) or (shortage == Decimal("0.0"))

                if res_qty >= req_qty:
                    item_stat = "RESERVED"
                elif res_qty > Decimal("0.0"):
                    item_stat = "PARTIALLY_RESERVED"
                elif free_avail >= req_qty:
                    item_stat = "AVAILABLE"
                else:
                    item_stat = "SHORTAGE"

                hints = location_hints_map.get(it.material_code, [])
                loc_hint = ", ".join(hints) if hints else None

            tot_avail += avail_qty
            tot_short += shortage

            item_schemas.append(
                AssemblyRequisitionItemSchema(
                    id=str(it.id),
                    material_id=str(it.material_id) if it.material_id else None,
                    material_variant_id=str(it.material_variant_id) if it.material_variant_id else None,
                    material_code=it.material_code,
                    variant_code=it.variant_code,
                    material_name=it.material_name,
                    requested_quantity=req_qty,
                    required_quantity=req_qty,
                    issued_quantity=Decimal(str(it.issued_quantity or 0)),
                    available_quantity=avail_qty,
                    reserved_quantity=res_qty,
                    shortage_quantity=shortage,
                    has_sufficient_stock=has_stock,
                    uom=it.uom,
                    status=item_stat,
                    is_custom=is_custom,
                    custom_material_name=getattr(it, "custom_material_name", None),
                    location_hint=loc_hint,
                )
            )

        all_available = bool(
            item_schemas
            and all(i.has_sufficient_stock and i.shortage_quantity == Decimal("0.0") for i in item_schemas)
        )
        req_status = (r.status or "PENDING").upper()
        # A requisition with a shortage can still be assigned when at least one
        # unit is available. The pickup task will be created for the available
        # quantity and the remaining shortage stays visible for replenishment.
        can_assign = bool(
            req_status in ["PENDING", "RESERVED", "READY"]
            and any(i.available_quantity > 0 for i in item_schemas)
        )

        # Automatic Store Determination
        res_store_counts: Dict[str, Decimal] = {}
        for res_obj in req_res_rows:
            if res_obj.store_id and (res_obj.reserved_quantity or 0) > 0:
                res_store_counts[str(res_obj.store_id)] = res_store_counts.get(str(res_obj.store_id), Decimal("0")) + Decimal(str(res_obj.reserved_quantity))

        store_net_avail: Dict[str, Decimal] = {}
        for it in (r.items or []):
            m_code = (it.material_code or "").strip()
            if not m_code or getattr(it, "is_custom", False):
                continue
            for (mat_c, s_id), physical_q in store_mat_bal_map.items():
                if mat_c == m_code:
                    total_res_in_store = store_mat_res_map.get((mat_c, s_id), Decimal("0"))
                    this_req_res_in_store = sum(
                        Decimal(str(ro.reserved_quantity or 0))
                        for ro in req_res_rows
                        if ro.material_code == m_code and str(ro.store_id) == str(s_id)
                    )
                    other_res_in_store = max(Decimal("0"), total_res_in_store - this_req_res_in_store)
                    net_in_store = max(Decimal("0"), physical_q - other_res_in_store)
                    s_id_str = str(s_id)
                    store_net_avail[s_id_str] = store_net_avail.get(s_id_str, Decimal("0")) + net_in_store

        suggested_s_id = None
        suggested_s_code = None
        suggested_s_name = None

        if res_store_counts:
            best_s_id_str = max(res_store_counts.keys(), key=lambda k: res_store_counts[k])
            for s_id, s_info in store_info_map.items():
                if str(s_id) == best_s_id_str:
                    suggested_s_id = str(s_id)
                    suggested_s_code = s_info["code"]
                    suggested_s_name = s_info["name"]
                    break
        elif store_net_avail:
            best_s_id_str = max(store_net_avail.keys(), key=lambda k: store_net_avail[k])
            for s_id, s_info in store_info_map.items():
                if str(s_id) == best_s_id_str:
                    suggested_s_id = str(s_id)
                    suggested_s_code = s_info["code"]
                    suggested_s_name = s_info["name"]
                    break

        if not suggested_s_id and r.assigned_store_id:
            suggested_s_id = str(r.assigned_store_id)
            suggested_s_code = r.assigned_store_code
            suggested_s_name = r.assigned_store_name

        summary_parts = []
        for s_id_str, net_q in sorted(store_net_avail.items(), key=lambda x: x[1], reverse=True):
            for s_id, s_info in store_info_map.items():
                if str(s_id) == s_id_str:
                    summary_parts.append(f"{s_info['name']}: {net_q} available")
                    break
        store_avail_summary = " · ".join(summary_parts) if summary_parts else None

        if req_status not in ["PENDING", "RESERVED"]:
            avail_status = req_status
            avail_msg = None
        elif all_available:
            avail_status = "AVAILABLE"
            avail_msg = f"All materials available/reserved in inventory — Auto-assigned to {suggested_s_name or 'Store'}" if suggested_s_name else "All materials available/reserved in inventory — Ready for Store assignment"
        else:
            avail_status = "PARTIAL_AVAILABLE" if can_assign else "SHORTAGE"
            avail_msg = (
                f"{tot_short} units short — available quantity can be assigned for Store pickup"
                if can_assign
                else f"Material shortage ({tot_short} remaining) — Store assignment unavailable"
            )

        tasks = pickup_map.get(r.id, [])
        tracking = [{
            "task_number": task.task_number,
            "material_code": task.material_code,
            "material_name": task.material_name,
            "requested_quantity": float(task.requested_quantity or 0),
            "picked_quantity": float(task.picked_quantity or 0),
            "remaining_quantity": float((task.requested_quantity or 0) - (task.picked_quantity or 0)),
            "status": task.status,
            "store_code": task.store_code,
            "store_name": task.store_name,
            "started_at": task.started_at,
            "completed_at": task.completed_at,
            "updated_at": task.updated_at,
        } for task in tasks]
        requested_total = sum((Decimal(str(task.requested_quantity or 0)) for task in tasks), Decimal("0"))
        picked_total = sum((Decimal(str(task.picked_quantity or 0)) for task in tasks), Decimal("0"))
        pickup_progress = {
            "task_count": len(tasks),
            "requested_quantity": float(requested_total),
            "picked_quantity": float(picked_total),
            "remaining_quantity": float(max(Decimal("0"), requested_total - picked_total)),
            "status": "COMPLETED" if tasks and all((task.status or "").upper() == "COMPLETED" for task in tasks)
                else ("PARTIAL" if picked_total > 0 else ("ASSIGNED" if tasks else "PENDING")),
        }

        responses.append(
            AssemblyRequisitionResponse(
                id=str(r.id),
                requisition_number=r.requisition_number,
                warehouse_id=r.warehouse_id,
                department=r.department,
                requested_by=r.requested_by,
                priority=r.priority,
                required_date=r.required_date,
                status=r.status,
                assigned_store_id=str(r.assigned_store_id) if r.assigned_store_id else None,
                assigned_store_code=r.assigned_store_code,
                assigned_store_name=r.assigned_store_name,
                suggested_store_id=suggested_s_id,
                suggested_store_code=suggested_s_code,
                suggested_store_name=suggested_s_name,
                store_availability_summary=store_avail_summary,
                assigned_by=r.assigned_by,
                assigned_at=r.assigned_at,
                remarks=r.remarks,
                items=item_schemas,
                reservations=reservation_schemas,
                total_required=tot_req,
                total_available=tot_avail,
                total_reserved=tot_res,
                total_shortage=tot_short,
                all_items_available=all_available,
                can_assign_store=can_assign,
                availability_status=avail_status,
                availability_message=avail_msg,
                pickup_tracking=tracking,
                pickup_progress=pickup_progress,
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
        )

    return responses


@router.get("", response_model=List[AssemblyRequisitionResponse])
async def list_assembly_requisitions(
    department: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    roles = {role.upper() for role in (user.roles or [])}
    if not roles.intersection({"ASSEMBLY", "ASSEMBLY_MANAGER", "ASSEMBLY_OPERATOR", "WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"}):
        raise HTTPException(status_code=403, detail="Assembly requisition access is not allowed for this role")
    stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items))
    roles = [r.upper() for r in (user.roles or [])]

    if "ASSEMBLY" in roles and not any(r in ["ADMIN", "SUPERUSER", "WAREHOUSE", "WAREHOUSE_MANAGER"] for r in roles):
        stmt = stmt.where(func.lower(AssemblyRequisitionModel.department) == "assembly")
    elif department:
        stmt = stmt.where(func.lower(AssemblyRequisitionModel.department) == department.strip().lower())

    if status_filter and status_filter.upper() != "ALL":
        stmt = stmt.where(func.upper(AssemblyRequisitionModel.status) == status_filter.strip().upper())

    stmt = stmt.order_by(AssemblyRequisitionModel.created_at.desc())
    res = await uow.session.execute(stmt)
    records = res.scalars().all()

    return await _build_requisition_responses_with_availability(records, uow.session)


@router.post("/{id}/reject")
async def reject_assembly_requisition(
    id: str,
    payload: RejectAssemblyRequisitionRequest,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    roles = {role.upper() for role in (user.roles or [])}
    if not roles.intersection({"WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"}):
        raise HTTPException(status_code=403, detail="Only Warehouse personnel may reject an Assembly requisition")
    try:
        req_id = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid requisition UUID")
    req = (await uow.session.execute(
        select(AssemblyRequisitionModel).where(AssemblyRequisitionModel.id == req_id).with_for_update()
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Assembly requisition not found")
    if req.status not in {"PENDING", "SUBMITTED"}:
        raise HTTPException(status_code=409, detail=f"Requisition cannot be rejected while in {req.status}")
    active_reservation = await uow.session.scalar(select(AssemblyStockReservationModel.id).where(
        AssemblyStockReservationModel.requisition_id == req.id,
        AssemblyStockReservationModel.status == "RESERVED FOR ASSEMBLY",
    ).limit(1))
    if active_reservation:
        raise HTTPException(status_code=409, detail="Release the stock reservation before rejecting this requisition")
    now = datetime.now(timezone.utc)
    req.status = "REJECTED"
    req.remarks = f"{req.remarks}\nRejected by {user.username} at {now.isoformat()}: {payload.reason}" if req.remarks else f"Rejected by {user.username} at {now.isoformat()}: {payload.reason}"
    req.updated_at = now
    uow.session.add(NotificationModel(
        user_role="ASSEMBLY", title=f"Requisition rejected: {req.requisition_number}",
        message=f"Warehouse rejected Assembly requisition {req.requisition_number}: {payload.reason}",
        link=f"/assembly/requests?requisition={req.id}", notification_type="ASSEMBLY_REQUISITION_REJECTED",
        payload_json=json.dumps({"requisition_id": str(req.id), "requisition_number": req.requisition_number,
                                 "reviewed_by": user.username, "reviewed_at": now.isoformat(), "reason": payload.reason}),
    ))
    await uow.commit()
    return {"id": str(req.id), "requisition_number": req.requisition_number, "status": req.status,
            "reviewed_by": user.username, "reviewed_at": now.isoformat(), "reason": payload.reason}


@router.post("", response_model=AssemblyRequisitionResponse, status_code=status.HTTP_201_CREATED)
async def create_assembly_requisition(
    payload: CreateAssemblyRequisitionRequest,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    roles = {role.upper() for role in (user.roles or [])}
    if not roles.intersection({"ASSEMBLY", "ASSEMBLY_MANAGER", "ASSEMBLY_OPERATOR", "ADMIN", "SUPERUSER"}):
        raise HTTPException(status_code=403, detail="Only Assembly personnel may create a material requisition")
    if not payload.warehouse_id.strip():
        raise HTTPException(status_code=422, detail="Warehouse is required")
    if not user.username:
        raise HTTPException(status_code=422, detail="Authenticated requester identity is required")
    if not payload.items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Requisition must contain at least one item",
        )

    now_utc = datetime.now(timezone.utc)
    current_year = now_utc.year

    # Generate sequential requisition number AR-YYYY-XXXX
    count_stmt = select(func.count(AssemblyRequisitionModel.id)).where(
        AssemblyRequisitionModel.requisition_number.like(f"AR-{current_year}-%")
    )
    count_res = await uow.session.execute(count_stmt)
    seq = (count_res.scalar() or 0) + 1
    req_number = f"AR-{current_year}-{seq:04d}"

    req = AssemblyRequisitionModel(
        id=uuid.uuid4(),
        requisition_number=req_number,
        warehouse_id=payload.warehouse_id,
        department=payload.department or "Assembly",
        requested_by=user.username,
        priority=payload.priority.upper() if payload.priority else "MEDIUM",
        required_date=payload.required_date,
        status="PENDING",
        remarks=payload.remarks,
        created_at=now_utc,
        updated_at=now_utc,
    )
    uow.session.add(req)

    for it in payload.items:
        mat_uuid = None
        var_uuid = None
        is_custom = bool(
            it.is_custom
            or it.material_id == "CUSTOM"
            or (it.material_code or "").strip().upper() == "CUSTOM"
            or (not it.material_id and not it.material_code and (it.custom_material_name or it.material_name))
        )

        if is_custom:
            custom_name = (it.custom_material_name or it.material_name or "").strip()
            if not custom_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Custom material name is required for custom/new items.",
                )
            item_model = AssemblyRequisitionItemModel(
                id=uuid.uuid4(),
                requisition_id=req.id,
                material_id=None,
                material_variant_id=None,
                material_code="CUSTOM",
                variant_code=None,
                material_name=custom_name,
                custom_material_name=custom_name,
                requested_quantity=Decimal(str(it.quantity)),
                issued_quantity=Decimal("0.0"),
                uom=it.uom.strip().upper(),
                is_custom=True,
            )
        else:
            if it.material_id:
                try:
                    mat_uuid = uuid.UUID(it.material_id)
                except ValueError:
                    mat_uuid = None

            if it.material_variant_id:
                try:
                    var_uuid = uuid.UUID(it.material_variant_id)
                except ValueError:
                    var_uuid = None

            material_code = (it.material_code or "").strip()
            material_name = (it.material_name or "").strip()
            variant_code = it.variant_code.strip() if it.variant_code else None
            uom = it.uom.strip().upper()

            if mat_uuid:
                mat_res = await uow.session.execute(
                    select(MaterialModel).options(selectinload(MaterialModel.variants)).where(MaterialModel.id == mat_uuid)
                )
                mat_obj = mat_res.scalar_one_or_none()
                if mat_obj:
                    material_code = mat_obj.material_code
                    material_name = material_name or mat_obj.material_name
                    uom = uom or mat_obj.base_uom
                    if var_uuid:
                        var_obj = next((v for v in (mat_obj.variants or []) if v.id == var_uuid), None)
                        if var_obj:
                            variant_code = var_obj.variant_code
                            uom = var_obj.uom or uom
                    elif mat_obj.variants:
                        active_vars = [v for v in mat_obj.variants if (v.status or "").lower() == "active"]
                        picked_v = active_vars[0] if active_vars else mat_obj.variants[0]
                        var_uuid = picked_v.id
                        variant_code = picked_v.variant_code
                        uom = picked_v.uom or uom
            elif material_code and material_code != "CUSTOM":
                mat_res = await uow.session.execute(
                    select(MaterialModel).options(selectinload(MaterialModel.variants)).where(MaterialModel.material_code == material_code)
                )
                mat_obj = mat_res.scalar_one_or_none()
                if mat_obj:
                    mat_uuid = mat_obj.id
                    material_name = material_name or mat_obj.material_name
                    uom = uom or mat_obj.base_uom
                    if var_uuid:
                        var_obj = next((v for v in (mat_obj.variants or []) if v.id == var_uuid), None)
                        if var_obj:
                            variant_code = var_obj.variant_code
                            uom = var_obj.uom or uom
                    elif mat_obj.variants:
                        active_vars = [v for v in mat_obj.variants if (v.status or "").lower() == "active"]
                        picked_v = active_vars[0] if active_vars else mat_obj.variants[0]
                        var_uuid = picked_v.id
                        variant_code = picked_v.variant_code
                        uom = picked_v.uom or uom
                        if var_obj:
                            variant_code = var_obj.variant_code
                            uom = var_obj.uom or uom
                    elif mat_obj.variants:
                        active_vars = [v for v in mat_obj.variants if (v.status or "").lower() == "active"]
                        picked_v = active_vars[0] if active_vars else mat_obj.variants[0]
                        var_uuid = picked_v.id
                        variant_code = picked_v.variant_code
                        uom = picked_v.uom or uom

            if not mat_uuid or not material_code or not material_name:
                raise HTTPException(status_code=422, detail=f"Item '{material_code or material_name or 'unknown'}' is not linked to a persisted material")
            if not uom:
                raise HTTPException(status_code=422, detail=f"A unit is required for material {material_code}")
            item_model = AssemblyRequisitionItemModel(
                id=uuid.uuid4(),
                requisition_id=req.id,
                material_id=mat_uuid,
                material_variant_id=var_uuid,
                material_code=material_code,
                variant_code=variant_code,
                material_name=material_name,
                custom_material_name=None,
                requested_quantity=Decimal(str(it.quantity)),
                issued_quantity=Decimal("0.0"),
                uom=uom,
                is_custom=False,
            )
        uow.session.add(item_model)

    # Notify Warehouse of new Assembly Material Requisition
    notif = NotificationModel(
        id=uuid.uuid4(),
        user_role="WAREHOUSE",
        title=f"New Assembly Requisition: {req.requisition_number}",
        message=f"Assembly submitted requisition {req.requisition_number} ({len(payload.items)} items). Requires store assignment.",
        link="/warehouse/assembly-requisitions",
        is_read=False,
    )
    uow.session.add(notif)

    await uow.commit()

    # Refresh
    stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
        AssemblyRequisitionModel.id == req.id
    )
    res = await uow.session.execute(stmt)
    created_req = res.scalar_one()

    responses = await _build_requisition_responses_with_availability([created_req], uow.session)
    return responses[0]


@router.get("/{id}", response_model=AssemblyRequisitionResponse)
async def get_assembly_requisition(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    roles = {role.upper() for role in (user.roles or [])}
    if not roles.intersection({"ASSEMBLY", "ASSEMBLY_MANAGER", "ASSEMBLY_OPERATOR", "WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"}):
        raise HTTPException(status_code=403, detail="Assembly requisition access is not allowed for this role")
    try:
        req_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Requisition UUID")

    stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
        AssemblyRequisitionModel.id == req_uuid
    )
    res = await uow.session.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assembly Requisition not found")
    responses = await _build_requisition_responses_with_availability([req], uow.session)
    return responses[0]


@router.post("/{id}/confirm-receipt")
async def confirm_assembly_receipt(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """Record Assembly's handover confirmation against the persisted issued transactions."""
    roles = {role.upper() for role in (user.roles or [])}
    if not roles.intersection({"ASSEMBLY", "ASSEMBLY_MANAGER", "ASSEMBLY_OPERATOR", "ADMIN", "SUPERUSER"}):
        raise HTTPException(status_code=403, detail="Assembly personnel must confirm material receipt")
    try:
        requisition_id = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid requisition UUID")
    req = (await uow.session.execute(
        select(AssemblyRequisitionModel).where(AssemblyRequisitionModel.id == requisition_id).with_for_update()
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Assembly requisition not found")
    if req.status == "ASSEMBLY_RECEIVED":
        raise HTTPException(status_code=409, detail="Assembly receipt was already confirmed")
    tasks = (await uow.session.execute(
        select(PickupTaskModel).where(PickupTaskModel.requisition_id == req.id).with_for_update()
    )).scalars().all()
    if not tasks or any(task.status.upper() != "COMPLETED" or task.picked_quantity < task.requested_quantity for task in tasks):
        raise HTTPException(status_code=409, detail="All requested material must be picked and issued before Assembly can confirm receipt")
    issues = (await uow.session.execute(
        select(InventoryIssueTransactionModel).where(InventoryIssueTransactionModel.requisition_id == req.id)
    )).scalars().all()
    if not issues:
        raise HTTPException(status_code=409, detail="No persisted issue transactions are linked to this requisition")
    received_at = datetime.now(timezone.utc)
    receipt_items = [{
        "issue_id": str(issue.id), "issue_number": issue.issue_number,
        "material_code": issue.material_code, "quantity": str(issue.quantity), "uom": issue.uom,
        "pickup_task_id": str(issue.pickup_task_id) if issue.pickup_task_id else None,
    } for issue in issues]
    req.status = "ASSEMBLY_RECEIVED"
    req.updated_at = received_at
    uow.session.add(NotificationModel(
        user_role="WAREHOUSE", title=f"Assembly receipt confirmed — {req.requisition_number}",
        message=f"Assembly confirmed receipt of issued materials for requisition {req.requisition_number}.",
        link=f"/assembly/requests?requisition={req.id}", notification_type="ASSEMBLY_RECEIPT_CONFIRMED",
        payload_json=json.dumps({"requisition_id": str(req.id), "requisition_number": req.requisition_number,
                                 "confirmed_by": user.username, "confirmed_at": received_at.isoformat(),
                                 "items": receipt_items}),
    ))
    await uow.commit()
    return {"requisition_id": str(req.id), "requisition_number": req.requisition_number,
            "status": req.status, "confirmed_by": user.username,
            "confirmed_at": received_at.isoformat(), "items": receipt_items}


@router.post("/{id}/items/{item_id}/create-material", response_model=AssemblyRequisitionResponse)
async def create_material_for_assembly_requisition_item(
    id: str,
    item_id: str,
    payload: CreateMaterialForRequisitionItemRequest = CreateMaterialForRequisitionItemRequest(),
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Warehouse action to create a Material Master record for a custom/new material request line
    and link it to this requisition line.
    """
    roles = [r.upper() for r in (user.roles or [])]
    if not any(r in ["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"] for r in roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Warehouse personnel or Admins can create and register new materials.",
        )

    try:
        req_uuid = uuid.UUID(id)
        item_uuid = uuid.UUID(item_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid UUID format")

    stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
        AssemblyRequisitionModel.id == req_uuid
    )
    res = await uow.session.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assembly Requisition not found")

    target_item = next((it for it in req.items if it.id == item_uuid), None)
    if not target_item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requisition item not found")

    if not target_item.is_custom and target_item.material_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Item is already associated with Material '{target_item.material_code}'.",
        )

    # Determine material name, base UOM, category
    material_name = (
        payload.material_name or target_item.custom_material_name or target_item.material_name or ""
    ).strip()
    if not material_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Material name is required")

    base_uom = (payload.base_uom or target_item.uom or "PCS").strip().upper()
    category = (payload.category or "Raw Materials").strip()

    # Generate sequential material code using canonical logic
    import re
    codes_stmt = select(MaterialModel.material_code)
    codes_res = await uow.session.execute(codes_stmt)
    codes = codes_res.scalars().all()
    max_seq = 0
    for code in codes:
        if not code:
            continue
        match = re.match(r"^MAT-(\d+)$", code.strip(), re.IGNORECASE)
        if match:
            try:
                seq = int(match.group(1))
                if seq > max_seq:
                    max_seq = seq
            except (ValueError, TypeError):
                pass

    next_mat_code = f"MAT-{(max_seq + 1):03d}"
    next_var_code = f"{next_mat_code}-V001"

    now_time = datetime.now()
    # Check if duplicate material name already exists in Material Master
    existing_name_stmt = select(MaterialModel).where(func.lower(MaterialModel.material_name) == material_name.lower())
    existing_name_res = await uow.session.execute(existing_name_stmt)
    existing_mat = existing_name_res.scalar_one_or_none()

    if existing_mat:
        new_material = existing_mat
        var_stmt = select(MaterialVariantModel).where(MaterialVariantModel.material_id == new_material.id)
        var_res = await uow.session.execute(var_stmt)
        variants = var_res.scalars().all()
        new_variant = variants[0] if variants else None
        if not new_variant:
            new_variant = MaterialVariantModel(
                id=uuid.uuid4(),
                material_id=new_material.id,
                variant_code=f"{new_material.material_code}-V001",
                uom=new_material.base_uom,
                status="Active",
                created_at=now_time,
                updated_at=now_time,
            )
            uow.session.add(new_variant)
    else:
        new_material = MaterialModel(
            id=uuid.uuid4(),
            material_code=next_mat_code,
            material_name=material_name,
            category=category,
            description=payload.description or f"Created from Assembly Requisition {req.requisition_number}",
            base_uom=base_uom,
            status="Active",
            created_by=user.username or "warehouse",
            updated_by=user.username or "warehouse",
            created_at=now_time,
            updated_at=now_time,
        )
        uow.session.add(new_material)

        new_variant = MaterialVariantModel(
            id=uuid.uuid4(),
            material_id=new_material.id,
            variant_code=next_var_code,
            uom=base_uom,
            status="Active",
            created_at=now_time,
            updated_at=now_time,
        )
        uow.session.add(new_variant)

    await uow.session.flush()

    # Associate created material with requisition line
    target_item.material_id = new_material.id
    target_item.material_variant_id = new_variant.id
    target_item.material_code = new_material.material_code
    target_item.variant_code = new_variant.variant_code
    target_item.material_name = new_material.material_name
    target_item.uom = base_uom
    target_item.is_custom = False

    await uow.commit()

    # Re-fetch and return updated requisition
    stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
        AssemblyRequisitionModel.id == req.id
    )
    res = await uow.session.execute(stmt)
    updated_req = res.scalar_one()

    responses = await _build_requisition_responses_with_availability([updated_req], uow.session)
    return responses[0]


@router.post("/{id}/items/{item_id}/link-material", response_model=AssemblyRequisitionResponse)
async def link_material_for_assembly_requisition_item(
    id: str,
    item_id: str,
    payload: LinkMaterialToRequisitionItemRequest,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Warehouse action to link an existing Material Master item to a requisition line.
    """
    roles = [r.upper() for r in (user.roles or [])]
    if not any(r in ["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"] for r in roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Warehouse personnel or Admins can link materials.",
        )

    try:
        req_uuid = uuid.UUID(id)
        item_uuid = uuid.UUID(item_id)
        mat_uuid = uuid.UUID(payload.material_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid UUID format")

    var_uuid = None
    if payload.material_variant_id:
        try:
            var_uuid = uuid.UUID(payload.material_variant_id)
        except ValueError:
            var_uuid = None

    stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
        AssemblyRequisitionModel.id == req_uuid
    )
    res = await uow.session.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assembly Requisition not found")

    target_item = next((it for it in req.items if it.id == item_uuid), None)
    if not target_item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requisition item not found")

    mat_stmt = select(MaterialModel).options(selectinload(MaterialModel.variants)).where(MaterialModel.id == mat_uuid)
    mat_res = await uow.session.execute(mat_stmt)
    mat_obj = mat_res.scalar_one_or_none()
    if not mat_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected Material Master item not found")

    var_obj = None
    if var_uuid:
        var_obj = next((v for v in (mat_obj.variants or []) if v.id == var_uuid), None)
    elif mat_obj.variants:
        var_obj = mat_obj.variants[0]
        var_uuid = var_obj.id

    target_item.material_id = mat_obj.id
    target_item.material_variant_id = var_uuid
    target_item.material_code = mat_obj.material_code
    target_item.variant_code = var_obj.variant_code if var_obj else None
    target_item.material_name = mat_obj.material_name
    target_item.uom = (var_obj.uom if var_obj else mat_obj.base_uom) or target_item.uom
    target_item.is_custom = False

    await uow.commit()

    stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
        AssemblyRequisitionModel.id == req.id
    )
    res = await uow.session.execute(stmt)
    updated_req = res.scalar_one()

    responses = await _build_requisition_responses_with_availability([updated_req], uow.session)
    return responses[0]


@router.post("/{id}/approve", response_model=AssemblyRequisitionResponse)
@router.post("/{id}/reserve-stock", response_model=AssemblyRequisitionResponse)
async def reserve_assembly_requisition_stock(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Reserve available warehouse stock for this Assembly Requisition.
    - Reserves only what is currently physically available (accounting for other reservations).
    - Does not physically deduct stock.
    - Prevents duplicate/over-reservations.
    - Updates reserved_quantity on items and creates/updates AssemblyStockReservationModel records.
    - Notifies relevant store keepers.
    """
    roles = [r.upper() for r in (user.roles or [])]
    if not any(r in ["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"] for r in roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Warehouse personnel or Admins can reserve stock for Assembly Requisitions.",
        )

    try:
        req_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Requisition UUID")

    stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
        AssemblyRequisitionModel.id == req_uuid
    ).with_for_update()
    res = await uow.session.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assembly Requisition not found")
    if req.status not in {"PENDING", "SUBMITTED", "APPROVED", "PARTIALLY_RESERVED"}:
        raise HTTPException(status_code=409, detail=f"Requisition cannot be approved while in {req.status}")
    if not user.username:
        raise HTTPException(status_code=422, detail="Authenticated reviewer identity is required")

    now_utc = datetime.now(timezone.utc)

    # For each item, calculate available stock and reserve
    for it in (req.items or []):
        if getattr(it, "is_custom", False) or it.material_code == "CUSTOM" or not it.material_id:
            continue

        req_qty = Decimal(str(it.requested_quantity or 0))
        cur_reserved = Decimal(str(getattr(it, "reserved_quantity", 0) or 0))

        # Check warehouse stock & location balances
        stk_res = await uow.session.execute(
            select(MaterialStockModel).where(MaterialStockModel.material_code == it.material_code).with_for_update()
        )
        stk_obj = stk_res.scalar_one_or_none()
        stk_avail = Decimal(str(stk_obj.available or 0)) if stk_obj else Decimal("0.0")

        # Quarantined
        quar_stmt = select(func.coalesce(func.sum(QuarantineRecordModel.damaged_quantity), Decimal("0.0"))).where(
            QuarantineRecordModel.item_code == it.material_code,
            QuarantineRecordModel.status.in_(["PENDING_REVIEW", "QUARANTINED"]),
        )
        quar_res = await uow.session.execute(quar_stmt)
        quar_qty = Decimal(str(quar_res.scalar() or 0))

        # Location balance
        loc_lock_stmt = select(InventoryLocationBalanceModel).where(
            InventoryLocationBalanceModel.material_code == it.material_code
        ).with_for_update()
        loc_balances = (await uow.session.execute(loc_lock_stmt)).scalars().all()
        loc_avail = sum((Decimal(str(row.available_quantity or 0)) for row in loc_balances), Decimal("0"))

        effective_avail = min(max(Decimal("0.0"), stk_avail - quar_qty), loc_avail)

        # Active reservations by other requisitions
        # MaterialStock.available is decremented atomically for earlier reservations.
        avail_to_reserve = max(Decimal("0.0"), effective_avail)

        # Max we can reserve for this line (existing reservation + additional available stock)
        max_can_reserve = min(req_qty, cur_reserved + avail_to_reserve)

        # If we can reserve more than currently reserved, or if currently reserved exceeds available, sync
        new_reserved = max_can_reserve
        if new_reserved <= Decimal("0.0") and cur_reserved <= Decimal("0.0"):
            continue

        if stk_obj and new_reserved > cur_reserved:
            delta = new_reserved - cur_reserved
            stk_obj.allocated = (stk_obj.allocated or Decimal("0.0")) + delta
            stk_obj.available = max(Decimal("0.0"), (stk_obj.available or Decimal("0.0")) - delta)

        it.reserved_quantity = new_reserved

        # Find location details (store, zone, bin) for this material
        loc_stmt = (
            select(
                StorageLocationModel,
                StoreModel,
                InventoryLocationBalanceModel.available_quantity,
            )
            .join(StorageLocationModel, InventoryLocationBalanceModel.storage_location_id == StorageLocationModel.id)
            .outerjoin(StoreModel, StorageLocationModel.store_id == StoreModel.id)
            .where(
                InventoryLocationBalanceModel.material_code == it.material_code,
                InventoryLocationBalanceModel.available_quantity > 0,
            )
            .order_by(InventoryLocationBalanceModel.available_quantity.desc())
        )
        loc_rows = (await uow.session.execute(loc_stmt)).all()
        loc_row = loc_rows[0] if loc_rows else None

        store_id = None
        store_code = None
        store_name = None
        zone_code = None
        bin_code = None
        location_code = None
        storage_loc_id = None
        allocations: list[dict] = []

        # Allocate across oldest updated location balances first (FIFO). The
        # balance's GRN is retained as the batch reference so consumers can
        # present a batch-aware pick sequence; expiry-controlled materials can
        # be ordered by an explicit FEFO location policy in a later extension.
        remaining_to_allocate = new_reserved
        for row in loc_rows:
            storage_loc, store_obj, available_qty = row
            if remaining_to_allocate <= 0:
                break
            allocated_qty = min(remaining_to_allocate, Decimal(str(available_qty or 0)))
            if allocated_qty <= 0:
                continue
            allocations.append({
                "quantity": float(allocated_qty),
                "uom": it.uom,
                "location_code": storage_loc.location_code,
                "zone_code": storage_loc.zone,
                "rack": storage_loc.rack,
                "bin_code": storage_loc.bin,
                "batch": None,
                "strategy": "FIFO",
            })
            remaining_to_allocate -= allocated_qty

        if loc_row:
            storage_loc, store_obj, _ = loc_row
            storage_loc_id = storage_loc.id
            location_code = storage_loc.location_code
            zone_code = storage_loc.zone
            bin_code = storage_loc.bin
            if store_obj:
                store_id = store_obj.id
                store_code = store_obj.store_code
                store_name = store_obj.store_name
        elif new_reserved > 0:
            raise HTTPException(status_code=409, detail=f"Reserved stock for {it.material_code} has no persisted storage location")

        # Check existing reservation record for this requisition item
        res_stmt = select(AssemblyStockReservationModel).where(
            AssemblyStockReservationModel.requisition_id == req.id,
            AssemblyStockReservationModel.requisition_item_id == it.id,
        )
        res_row = (await uow.session.execute(res_stmt)).scalar_one_or_none()

        if new_reserved > Decimal("0.0"):
            if res_row:
                res_row.required_quantity = req_qty
                res_row.reserved_quantity = new_reserved
                res_row.status = "RESERVED FOR ASSEMBLY"
                if store_id:
                    res_row.store_id = store_id
                    res_row.store_code = store_code
                    res_row.store_name = store_name
                    res_row.zone_code = zone_code
                    res_row.bin_code = bin_code
                    res_row.location_code = location_code
                    res_row.storage_location_id = storage_loc_id
                res_row.allocations = allocations
                res_row.reserved_by = user.username
                res_row.reserved_at = now_utc
            else:
                new_res_record = AssemblyStockReservationModel(
                    id=uuid.uuid4(),
                    requisition_id=req.id,
                    requisition_item_id=it.id,
                    requisition_number=req.requisition_number,
                    material_code=it.material_code,
                    material_name=it.material_name,
                    required_quantity=req_qty,
                    reserved_quantity=new_reserved,
                    uom=it.uom,
                    status="RESERVED FOR ASSEMBLY",
                    store_id=store_id,
                    store_code=store_code,
                    store_name=store_name,
                    zone_code=zone_code,
                    bin_code=bin_code,
                    location_code=location_code,
                    storage_location_id=storage_loc_id,
                    allocations=allocations,
                    reserved_by=user.username,
                    reserved_at=now_utc,
                )
                uow.session.add(new_res_record)

            # Store notification
            if store_code:
                notif = NotificationModel(
                    id=uuid.uuid4(),
                    user_role=f"STR:{store_code}",
                    title=f"Stock Reserved for Assembly — {req.requisition_number}",
                    message=f"Reserved {new_reserved} {it.uom} of {it.material_name} for Assembly Requisition {req.requisition_number} in {store_name or store_code}.",
                    link="/my-store",
                    is_read=False,
                )
                uow.session.add(notif)
        elif res_row:
            # Cancelled / 0 reservation
            res_row.reserved_quantity = Decimal("0.0")
            res_row.status = "CANCELLED"

    req.status = "APPROVED" if all(Decimal(str(it.reserved_quantity or 0)) >= Decimal(str(it.requested_quantity)) for it in (req.items or [])) else "PARTIALLY_RESERVED"
    req.updated_at = now_utc
    uow.session.add(NotificationModel(
        user_role="ASSEMBLY",
        title=f"Requisition {req.status.lower().replace('_', ' ')}: {req.requisition_number}",
        message=f"Warehouse reviewed requisition {req.requisition_number}. Reservation status: {req.status}.",
        link=f"/assembly/requests?requisition={req.id}", notification_type="ASSEMBLY_REQUISITION_REVIEWED",
        payload_json=json.dumps({"requisition_id": str(req.id), "requisition_number": req.requisition_number,
                                 "status": req.status, "reviewed_by": user.username, "reviewed_at": now_utc.isoformat()}),
    ))
    await uow.commit()

    # Re-fetch updated response
    stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
        AssemblyRequisitionModel.id == req.id
    )
    res = await uow.session.execute(stmt)
    updated_req = res.scalar_one()

    responses = await _build_requisition_responses_with_availability([updated_req], uow.session)
    return responses[0]


@router.post("/{id}/create-material-request")
async def create_material_request_for_shortage(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Create a Procurement/Warehouse Material Request for remaining shortages on this requisition.
    Contains strictly the remaining shortage quantity, not already reserved stock.
    """
    roles = [r.upper() for r in (user.roles or [])]
    if not any(r in ["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"] for r in roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Warehouse personnel or Admins can create material requests.",
        )

    try:
        req_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Requisition UUID")

    stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
        AssemblyRequisitionModel.id == req_uuid
    )
    res = await uow.session.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assembly Requisition not found")

    # Determine shortages for all items
    shortage_items_data = []
    for it in (req.items or []):
        req_qty = Decimal(str(it.requested_quantity or 0))
        res_qty = Decimal(str(getattr(it, "reserved_quantity", 0) or 0))
        is_custom = bool(getattr(it, "is_custom", False) or it.material_code == "CUSTOM" or not it.material_id)

        if is_custom:
            shortage_qty = req_qty
            shortage_items_data.append({
                "item": it,
                "shortage_quantity": shortage_qty,
                "is_custom": True,
                "custom_material_name": it.custom_material_name or it.material_name,
            })
        else:
            # Physical available stock
            stk_res = await uow.session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == it.material_code)
            )
            stk_obj = stk_res.scalar_one_or_none()
            stk_avail = Decimal(str(stk_obj.available or 0)) if stk_obj else Decimal("0.0")

            quar_stmt = select(func.coalesce(func.sum(QuarantineRecordModel.damaged_quantity), Decimal("0.0"))).where(
                QuarantineRecordModel.item_code == it.material_code,
                QuarantineRecordModel.status.in_(["PENDING_REVIEW", "QUARANTINED"]),
            )
            quar_qty = Decimal(str((await uow.session.execute(quar_stmt)).scalar() or 0))

            loc_bal_stmt = select(func.coalesce(func.sum(InventoryLocationBalanceModel.available_quantity), Decimal("0.0"))).where(
                InventoryLocationBalanceModel.material_code == it.material_code
            )
            loc_avail = Decimal(str((await uow.session.execute(loc_bal_stmt)).scalar() or 0))

            effective_avail = max(max(Decimal("0.0"), stk_avail - quar_qty), loc_avail)

            # Active reservations by other requisitions
            other_res_stmt = select(func.coalesce(func.sum(AssemblyStockReservationModel.reserved_quantity), Decimal("0.0"))).where(
                AssemblyStockReservationModel.material_code == it.material_code,
                AssemblyStockReservationModel.status == "RESERVED FOR ASSEMBLY",
                AssemblyStockReservationModel.requisition_id != req.id,
            )
            other_res = Decimal(str((await uow.session.execute(other_res_stmt)).scalar() or 0))
            free_unreserved = max(Decimal("0.0"), effective_avail - other_res - res_qty)
            remaining_needed = max(Decimal("0.0"), req_qty - res_qty)
            shortage_qty = max(Decimal("0.0"), remaining_needed - free_unreserved)
            if shortage_qty > Decimal("0.0"):
                shortage_items_data.append({
                    "item": it,
                    "shortage_quantity": shortage_qty,
                    "is_custom": False,
                    "custom_material_name": None,
                })

    if not shortage_items_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No material shortages found for this requisition. All required items are available or reserved.",
        )

    # Generate sequential Material Request number
    now_utc = datetime.now(timezone.utc)
    current_year = now_utc.year
    try:
        count_stmt = select(func.count(MaterialRequestModel.id))
        count_res = await uow.session.execute(count_stmt)
        req_count = count_res.scalar_one() or 0
        req_no = f"MR-{current_year}-{req_count + 1:06d}"
    except Exception:
        req_no = f"MR-{current_year}-{int(now_utc.timestamp())}"

    mr = MaterialRequestModel(
        id=uuid.uuid4(),
        request_number=req_no,
        warehouse_id=req.warehouse_id or "MAIN",
        department=req.department or "Assembly",
        requested_by=user.username or req.requested_by or "Warehouse",
        status="Submitted",
        priority=(req.priority or "HIGH").strip().upper(),
        required_date=req.required_date or now_utc.date(),
        attachments=[],
        approval_history=[
            {
                "status": "Submitted",
                "actor": user.username or "warehouse",
                "comments": f"Auto-generated for shortage on Assembly Requisition {req.requisition_number}",
                "timestamp": now_utc.isoformat(),
            }
        ],
        remarks=f"Shortage fulfillment for Assembly Requisition {req.requisition_number}",
        created_at=now_utc.replace(tzinfo=None),
        updated_at=now_utc.replace(tzinfo=None),
    )
    uow.session.add(mr)

    created_items = []
    for s_item in shortage_items_data:
        it = s_item["item"]
        sh_qty = s_item["shortage_quantity"]
        is_c = s_item["is_custom"]
        c_name = s_item["custom_material_name"]

        mr_item = MaterialRequestItemModel(
            id=uuid.uuid4(),
            request_id=mr.id,
            material_id=it.material_id if not is_c else None,
            material_variant_id=it.material_variant_id if not is_c else None,
            material_code=it.material_code or "CUSTOM",
            variant_code=it.variant_code if not is_c else None,
            material_name=it.material_name or c_name or "Material",
            quantity=sh_qty,
            uom=it.uom or "PCS",
            is_custom=is_c,
            custom_material_name=c_name if is_c else None,
        )
        uow.session.add(mr_item)
        created_items.append({
            "material_code": mr_item.material_code,
            "material_name": mr_item.material_name,
            "quantity": float(sh_qty),
            "uom": mr_item.uom,
        })

    # Notify Warehouse & Procurement
    notif_wh = NotificationModel(
        id=uuid.uuid4(),
        user_role="WAREHOUSE",
        title=f"Shortage Material Request Created: {mr.request_number}",
        message=f"Created Material Request {mr.request_number} ({len(created_items)} shortage items) for Assembly Requisition {req.requisition_number}.",
        link="/warehouse/material-requests",
        is_read=False,
    )
    uow.session.add(notif_wh)

    notif_proc = NotificationModel(
        id=uuid.uuid4(),
        user_role="PROCUREMENT",
        title=f"New Shortage Material Request: {mr.request_number}",
        message=f"Assembly Requisition {req.requisition_number} shortage generated Material Request {mr.request_number}.",
        link="/procurement/material-requests",
        is_read=False,
    )
    uow.session.add(notif_proc)

    await uow.commit()

    return {
        "status": "success",
        "material_request_number": mr.request_number,
        "material_request_id": str(mr.id),
        "requisition_number": req.requisition_number,
        "items_count": len(created_items),
        "items": created_items,
    }


@router.get("/reservations/all", response_model=List[AssemblyStockReservationSchema])
async def list_all_assembly_reservations(
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """List all active Assembly Stock Reservations."""
    stmt = (
        select(AssemblyStockReservationModel)
        .where(AssemblyStockReservationModel.status == "RESERVED FOR ASSEMBLY")
        .order_by(AssemblyStockReservationModel.reserved_at.desc())
    )
    res = await uow.session.execute(stmt)
    records = res.scalars().all()
    return [
        AssemblyStockReservationSchema(
            id=str(r.id),
            requisition_id=str(r.requisition_id),
            requisition_item_id=str(r.requisition_item_id),
            requisition_number=r.requisition_number,
            material_code=r.material_code,
            material_name=r.material_name,
            required_quantity=Decimal(str(r.required_quantity or 0)),
            reserved_quantity=Decimal(str(r.reserved_quantity or 0)),
            uom=r.uom or "PCS",
            status=r.status or "RESERVED FOR ASSEMBLY",
            store_id=str(r.store_id) if r.store_id else None,
            store_code=r.store_code,
            store_name=r.store_name,
            zone_code=r.zone_code,
            bin_code=r.bin_code,
            location_code=r.location_code,
            allocations=r.allocations or [],
            reserved_by=r.reserved_by,
            reserved_at=r.reserved_at,
        )
        for r in records
    ]


@router.get("/reservations/by-store/{store_id}", response_model=List[AssemblyStockReservationSchema])
async def list_store_assembly_reservations(
    store_id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """List active Assembly Stock Reservations for a specific Store."""
    try:
        store_uuid = uuid.UUID(store_id)
        stmt = select(AssemblyStockReservationModel).where(
            AssemblyStockReservationModel.store_id == store_uuid,
            AssemblyStockReservationModel.status == "RESERVED FOR ASSEMBLY",
        )
    except ValueError:
        stmt = select(AssemblyStockReservationModel).where(
            func.lower(AssemblyStockReservationModel.store_code) == store_id.lower(),
            AssemblyStockReservationModel.status == "RESERVED FOR ASSEMBLY",
        )

    stmt = stmt.order_by(AssemblyStockReservationModel.reserved_at.desc())
    res = await uow.session.execute(stmt)
    records = res.scalars().all()
    return [
        AssemblyStockReservationSchema(
            id=str(r.id),
            requisition_id=str(r.requisition_id),
            requisition_item_id=str(r.requisition_item_id),
            requisition_number=r.requisition_number,
            material_code=r.material_code,
            material_name=r.material_name,
            required_quantity=Decimal(str(r.required_quantity or 0)),
            reserved_quantity=Decimal(str(r.reserved_quantity or 0)),
            uom=r.uom or "PCS",
            status=r.status or "RESERVED FOR ASSEMBLY",
            store_id=str(r.store_id) if r.store_id else None,
            store_code=r.store_code,
            store_name=r.store_name,
            zone_code=r.zone_code,
            bin_code=r.bin_code,
            location_code=r.location_code,
            allocations=r.allocations or [],
            reserved_by=r.reserved_by,
            reserved_at=r.reserved_at,
        )
        for r in records
    ]


@router.post("/{id}/assign-store")
async def assign_store_to_assembly_requisition(
    id: str,
    payload: AssignStoreToRequisitionRequest,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    roles = [r.upper() for r in (user.roles or [])]
    if not any(r in ["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"] for r in roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only authorized Warehouse personnel can assign stores to Assembly Requisitions.",
        )

    try:
        req_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Requisition UUID")

    stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
        AssemblyRequisitionModel.id == req_uuid
    )
    res = await uow.session.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assembly Requisition not found")

    store_uuid = None
    if payload and payload.store_id:
        try:
            store_uuid = uuid.UUID(payload.store_id)
        except ValueError:
            st_res = await uow.session.execute(
                select(StoreModel).where(func.lower(StoreModel.store_code) == payload.store_id.strip().lower())
            )
            st_obj = st_res.scalar_one_or_none()
            if st_obj:
                store_uuid = st_obj.id
            else:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Store UUID or Code")
    else:
        # 1. Auto-determine store from active reservations for this requisition
        res_stmt = select(AssemblyStockReservationModel.store_id).where(
            AssemblyStockReservationModel.requisition_id == req.id,
            AssemblyStockReservationModel.status == "RESERVED FOR ASSEMBLY",
            AssemblyStockReservationModel.store_id.isnot(None),
        ).limit(1)
        res_s_id = (await uow.session.execute(res_stmt)).scalar_one_or_none()
        if res_s_id:
            store_uuid = res_s_id
        else:
            # 2. Check location balance with highest available stock for requisition's items
            mat_codes = [
                it.material_code
                for it in (req.items or [])
                if it.material_code and not getattr(it, "is_custom", False)
            ]
            if mat_codes:
                loc_stmt = (
                    select(
                        StoreModel.id,
                        func.sum(InventoryLocationBalanceModel.available_quantity).label("tot_avail"),
                    )
                    .join(StorageLocationModel, InventoryLocationBalanceModel.storage_location_id == StorageLocationModel.id)
                    .join(StoreModel, StorageLocationModel.store_id == StoreModel.id)
                    .where(
                        InventoryLocationBalanceModel.material_code.in_(mat_codes),
                        InventoryLocationBalanceModel.available_quantity > 0,
                        func.upper(StoreModel.status) == "ACTIVE",
                    )
                    .group_by(StoreModel.id)
                    .order_by(func.sum(InventoryLocationBalanceModel.available_quantity).desc())
                )
                loc_store_row = (await uow.session.execute(loc_stmt)).first()
                if loc_store_row:
                    store_uuid = loc_store_row[0]

    if not store_uuid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active Store could be determined for this requisition.",
        )

    # Availability Validation: Ensure all requested material quantities are in stock or reserved
    shortages = []
    pickup_quantities: dict[str, Decimal] = {}
    for item in req.items:
        if getattr(item, "is_custom", False) or item.material_code == "CUSTOM" or not item.material_id:
            shortages.append(
                f"Custom/New material '{item.custom_material_name or item.material_name}' must be created in Material Master first."
            )
            continue

        res_qty = Decimal(str(getattr(item, "reserved_quantity", 0) or 0))
        if res_qty >= item.requested_quantity:
            pickup_quantities[item.material_code] = Decimal(str(item.requested_quantity))
            continue

        stock_res = await uow.session.execute(
            select(MaterialStockModel).where(MaterialStockModel.material_code == item.material_code)
        )
        stock = stock_res.scalar_one_or_none()

        quar_stmt = select(func.coalesce(func.sum(QuarantineRecordModel.damaged_quantity), Decimal("0.0"))).where(
            QuarantineRecordModel.item_code == item.material_code,
            QuarantineRecordModel.status.in_(["PENDING_REVIEW", "QUARANTINED"]),
        )
        quar_res = await uow.session.execute(quar_stmt)
        quarantined_qty = quar_res.scalar() or Decimal("0.0")

        loc_bal_stmt = select(func.coalesce(func.sum(InventoryLocationBalanceModel.available_quantity), Decimal("0.0"))).where(
            InventoryLocationBalanceModel.material_code == item.material_code
        )
        loc_bal_res = await uow.session.execute(loc_bal_stmt)
        loc_avail = loc_bal_res.scalar() or Decimal("0.0")

        stk_avail = max(Decimal("0.0"), (stock.available if stock else Decimal("0.0")) - quarantined_qty)
        effective_avail = min(stk_avail, loc_avail)

        other_res_stmt = select(func.coalesce(func.sum(AssemblyStockReservationModel.reserved_quantity), Decimal("0.0"))).where(
            AssemblyStockReservationModel.material_code == item.material_code,
            AssemblyStockReservationModel.status == "RESERVED FOR ASSEMBLY",
            AssemblyStockReservationModel.requisition_id != req.id,
        )
        other_res = (await uow.session.execute(other_res_stmt)).scalar() or Decimal("0.0")
        free_unreserved = max(Decimal("0.0"), effective_avail - other_res - res_qty)

        total_satisfied = res_qty + free_unreserved
        pickup_quantities[item.material_code] = min(Decimal(str(item.requested_quantity)), total_satisfied)
        if total_satisfied < item.requested_quantity:
            shortages.append(
                f"Material '{item.material_code}' ({item.material_name}): Required {item.requested_quantity} {item.uom}, Available/Reserved {total_satisfied} {item.uom} (Shortage: {item.requested_quantity - total_satisfied} {item.uom})"
            )

    # Partial assignment is supported: only the quantity currently available
    # in reservations/free stock is sent to the Store pickup task.
    if not pickup_quantities or all(quantity <= 0 for quantity in pickup_quantities.values()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No stock is currently available for Store pickup: {'; '.join(shortages)}",
        )

    store_stmt = select(StoreModel).where(StoreModel.id == store_uuid)
    store_res = await uow.session.execute(store_stmt)
    store = store_res.scalar_one_or_none()
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assigned Store not found")
    if store.status.upper() != "ACTIVE":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Store '{store.store_name}' is inactive.")

    now_utc = datetime.now(timezone.utc)

    req.assigned_store_id = store.id
    req.assigned_store_code = store.store_code
    req.assigned_store_name = store.store_name
    req.assigned_by = user.username or "warehouse"
    req.assigned_at = now_utc
    req.status = "ASSIGNED_TO_STORE"
    req.updated_at = now_utc

    tasks_created = []
    for item in req.items:
        pickup_quantity = pickup_quantities.get(item.material_code, Decimal("0.0"))
        if pickup_quantity <= 0:
            continue
        existing_pck_res = await uow.session.execute(
            select(PickupTaskModel).where(
                PickupTaskModel.requisition_id == req.id,
                PickupTaskModel.material_code == item.material_code,
            )
        )
        pck = existing_pck_res.scalar_one_or_none()
        if not pck:
            task_no = f"PCK-{now_utc.year}-{uuid.uuid4().hex[:6].upper()}"
            pck = PickupTaskModel(
                id=uuid.uuid4(),
                task_number=task_no,
                requisition_id=req.id,
                requisition_number=req.requisition_number,
                store_id=store.id,
                store_code=store.store_code,
                store_name=store.store_name,
                department=req.department or "Assembly",
                material_code=item.material_code,
                material_name=item.material_name,
                requested_quantity=pickup_quantity,
                picked_quantity=Decimal("0.0"),
                uom=item.uom or "PCS",
                priority=req.priority or "MEDIUM",
                required_date=req.required_date,
                status="ASSIGNED_TO_STORE",
                assigned_by=user.username or "warehouse",
                assigned_at=now_utc,
                created_at=now_utc,
                updated_at=now_utc,
            )
            uow.session.add(pck)
        else:
            pck.store_id = store.id
            pck.store_code = store.store_code
            pck.store_name = store.store_name
            pck.status = "ASSIGNED_TO_STORE"
            pck.updated_at = now_utc
        tasks_created.append(pck)

    # Targeted store notification to STR:<store_code>
    notif = NotificationModel(
        id=uuid.uuid4(),
        user_role=f"STR:{store.store_code}",
        title=f"New Pickup Task Assigned — {store.store_name}",
        message=f"Assembly Requisition {req.requisition_number} ({len(req.items)} items) assigned to {store.store_name}.",
        link="/my-store",
        is_read=False,
    )
    uow.session.add(notif)

    # Targeted notification to STORE_KEEPER
    notif_sk = NotificationModel(
        id=uuid.uuid4(),
        user_role="STORE_KEEPER",
        title=f"New Pickup Task — {store.store_code}",
        message=f"Assembly Requisition {req.requisition_number} assigned to {store.store_name}.",
        link="/my-store",
        is_read=False,
    )
    uow.session.add(notif_sk)

    await uow.commit()

    return {
        "status": "success",
        "requisition_number": req.requisition_number,
        "assigned_store": {
            "id": str(store.id),
            "store_code": store.store_code,
            "store_name": store.store_name,
        },
        "tasks": [{"id": str(t.id), "task_number": t.task_number} for t in tasks_created],
    }

