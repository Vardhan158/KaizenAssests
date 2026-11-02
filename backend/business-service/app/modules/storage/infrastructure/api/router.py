import datetime
import hashlib
import json
import logging
import re
import uuid
from decimal import Decimal
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.orm import selectinload

from app.database.session import UnitOfWork, get_uow
from app.modules.storage.application.putaway_quantity import validate_grn_putaway_quantity
from app.modules.dock.infrastructure.persistence.models import (
    DockAllocationRequestModel,
    DockMasterModel,
)
from app.modules.gate.infrastructure.persistence.models import DockAssignmentModel
from app.common.persistence.models import (
    MaterialModel,
    MaterialStockModel,
    NotificationModel,
)
from app.modules.receiving.infrastructure.persistence.models import (
    GrnBatchModel,
    GrnBatchQrModel,
    GrnLineModel,
    GrnModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    HandlingUnitModel,
    InventoryLocationBalanceModel,
    InventoryMovementHistoryModel,
    PutawayMovementModel,
    PutawayTaskModel,
    PutawayLocationAssignmentModel,
    StorageLocationModel,
)
from app.modules.storage.application.rack_capacity import validate_rack_capacity, get_rack_capacity
from app.modules.warehouse.infrastructure.persistence.models import (
    WarehouseBinModel,
    UserAccountModel,
    WarehouseModel,
    WarehouseZoneModel,
)
from app.security.dependencies import CurrentUser, get_current_user, require_permission

router = APIRouter(prefix="/api/storage/putaway-tasks", tags=["storage"])


async def _sync_finished_goods_putaway_status(uow: UnitOfWork, finished_goods_id: uuid.UUID, location_code: str | None, username: str, completed_at: datetime.datetime):
    """Persist FG posting and linked Assembly order status after each unit putaway."""
    from app.modules.assembly.infrastructure.persistence.models import AssemblyFinishedGoodsModel, AssemblyOrderModel

    fg = await uow.session.get(AssemblyFinishedGoodsModel, finished_goods_id, with_for_update=True)
    if not fg:
        return None
    active_statuses = ["OPEN", "PENDING", "IN_PROGRESS", "ASSIGNED", "DRAFT", "PUTAWAY_PENDING", "PUTAWAY_IN_PROGRESS"]
    remaining = await uow.session.scalar(select(func.count(PutawayTaskModel.id)).where(
        PutawayTaskModel.finished_goods_id == fg.id,
        PutawayTaskModel.status.in_(active_statuses),
    )) or 0
    # The Assembly Finished Goods list uses this record as the source of
    # truth. Once its QR-backed putaway is complete, mark the unit as stored
    # instead of leaving it looking merely available for putaway.
    fg.status = "PUTAWAY_COMPLETED" if remaining == 0 else "PUTAWAY_PENDING"
    if location_code:
        fg.location_code = location_code
    completed_quantity = await uow.session.scalar(select(func.coalesce(
        func.sum(PutawayMovementModel.confirmed_quantity), 0
    )).where(PutawayMovementModel.putaway_task_id.in_(
        select(PutawayTaskModel.id).where(PutawayTaskModel.finished_goods_id == fg.id)
    ))) or Decimal("0")
    fg.on_hand_after = completed_quantity
    destination_warehouse_ref_id = await uow.session.scalar(select(PutawayTaskModel.destination_warehouse_ref_id).where(
        PutawayTaskModel.finished_goods_id == fg.id,
        PutawayTaskModel.destination_warehouse_ref_id.is_not(None),
    ).order_by(PutawayTaskModel.updated_at.desc()))
    if destination_warehouse_ref_id:
        fg.warehouse_ref_id = destination_warehouse_ref_id
    fg.updated_at = completed_at.replace(tzinfo=None) if completed_at.tzinfo else completed_at

    order = await uow.session.get(AssemblyOrderModel, fg.assembly_order_id, with_for_update=True)
    if order:
        order.putaway_status = "PUTAWAY_COMPLETED" if remaining == 0 else "PUTAWAY_IN_PROGRESS"
        order.updated_at = completed_at.replace(tzinfo=None) if completed_at.tzinfo else completed_at
        # A Finished Goods Request is fulfilled only after the produced goods
        # have physically reached the Finished Goods Warehouse.
        from app.common.persistence.models import FinishedGoodsRequestModel
        request = await uow.session.scalar(select(FinishedGoodsRequestModel).where(
            FinishedGoodsRequestModel.request_number == order.request_number
        ).with_for_update())
        if request:
            request.status = "COMPLETED" if remaining == 0 else "IN_PROGRESS"
            request.updated_at = completed_at.replace(tzinfo=None) if completed_at.tzinfo else completed_at
        if remaining == 0:
            uow.session.add(NotificationModel(
                id=uuid.uuid4(), user_role="ASSEMBLY_MANAGER",
                title="Assembly Order Putaway Completed",
                message=f"Finished goods for {order.order_number} ({order.product_name}) are fully put away in the Finished Goods Warehouse.",
                link="/assembly/production", is_read=False, created_at=completed_at,
            ))
    return order


def _parse_uuid(val: Any) -> uuid.UUID | None:
    if not val:
        return None
    if isinstance(val, uuid.UUID):
        return val
    try:
        return uuid.UUID(str(val))
    except (ValueError, AttributeError, TypeError):
        return None


async def _resolve_task(session: AsyncSession, task_id: Any) -> PutawayTaskModel | None:
    if not task_id:
        return None
    uid = _parse_uuid(task_id)
    if uid:
        task = await session.get(PutawayTaskModel, uid)
        if task:
            return task
    stmt = select(PutawayTaskModel).where(
        or_(
            func.lower(PutawayTaskModel.task_number) == str(task_id).strip().lower(),
            func.lower(PutawayTaskModel.grn_number) == str(task_id).strip().lower(),
        )
    )
    res = await session.execute(stmt)
    return res.scalars().first()


async def _material_qr_matches_task(session: AsyncSession, task: PutawayTaskModel, scan: str) -> bool:
    """Resolve existing material/batch QR identities without minting labels."""
    raw = (scan or "").strip()
    if raw.upper() == task.item_code.upper():
        return True
    hu = await session.scalar(select(HandlingUnitModel).where(
        or_(
            func.upper(HandlingUnitModel.hu_number) == raw.upper(),
            func.upper(HandlingUnitModel.barcode_value) == raw.upper(),
        )
    ))
    if hu:
        return (
            hu.item_code.strip().upper() == task.item_code.upper()
            and (not task.handling_unit_id or hu.id == task.handling_unit_id)
            and (not task.batch_number or not hu.batch_number or hu.batch_number.upper() == task.batch_number.upper())
        )
    item_code = grn_number = batch_number = None
    try:
        payload = json.loads(raw)
        if isinstance(payload, dict):
            item_code = payload.get("item_code") or payload.get("material_code") or payload.get("code")
            grn_number = payload.get("grn_number") or payload.get("grn_no") or payload.get("grn")
            batch_number = payload.get("batch_number") or payload.get("batch_no") or payload.get("batch")
    except (json.JSONDecodeError, TypeError, ValueError):
        pass

    if not item_code:
        for line in raw.splitlines():
            label, separator, value = line.partition(":")
            if not separator:
                continue
            label_key = label.strip().lower().replace(" ", "_")
            value = value.strip()
            if label_key in {"material_code", "item_code", "code"}:
                item_code = value
            elif label_key in {"grn", "grn_number", "grn_no"}:
                grn_number = value
            elif label_key in {"batch", "batch_number", "batch_no"}:
                batch_number = value

    if not item_code and raw.upper().startswith("QR-MAT-"):
        item_code = raw[7:].strip()

    if not item_code:
        qr_record = await session.scalar(
            select(GrnBatchQrModel).where(GrnBatchQrModel.qr_code == raw)
        )
        if qr_record:
            item_code = qr_record.item_code
            try:
                payload = json.loads(qr_record.qr_payload or "{}")
                if isinstance(payload, dict):
                    grn_number = grn_number or payload.get("grn_number") or payload.get("grn_no")
                    batch_number = batch_number or payload.get("batch_number") or payload.get("batch")
            except (json.JSONDecodeError, TypeError, ValueError):
                pass

    if not item_code:
        batch = await session.scalar(
            select(GrnBatchModel).where(func.upper(GrnBatchModel.batch_number) == raw.upper())
        )
        if batch:
            line = await session.get(GrnLineModel, batch.grn_line_id)
            grn = await session.get(GrnModel, line.grn_id) if line else None
            item_code = line.item_code if line else None
            grn_number = grn.grn_number if grn else grn_number
            batch_number = batch.batch_number

    if str(item_code or "").strip().upper() != task.item_code.upper():
        return False
    if grn_number and task.grn_number and str(grn_number).strip().upper() != task.grn_number.upper():
        return False
    if batch_number and task.batch_number and str(batch_number).strip().upper() != task.batch_number.upper():
        return False
    return True


async def _lock_warehouse_stock(
    session: AsyncSession,
    material_code: str,
    warehouse_id: str,
) -> tuple[MaterialStockModel | None, MaterialModel]:
    stock_query = select(MaterialStockModel).where(
        MaterialStockModel.material_code == material_code,
        MaterialStockModel.warehouse_id == warehouse_id,
    ).with_for_update()
    rows = (await session.execute(stock_query)).scalars().all()
    if len(rows) > 1:
        raise HTTPException(status_code=409, detail="Material has multiple warehouse stock records; select a material variant before putaway")
    if rows:
        material = await session.scalar(select(MaterialModel).where(MaterialModel.material_code == material_code))
        if material is None:
            raise HTTPException(status_code=409, detail=f"Material master '{material_code}' was not found")
        return rows[0], material

    # The material master is the lock target when its stock row does not yet
    # exist, serializing first receipts of that material in this warehouse.
    material = await session.scalar(
        select(MaterialModel).where(MaterialModel.material_code == material_code).with_for_update()
    )
    if material is None:
        raise HTTPException(status_code=409, detail=f"Material master '{material_code}' was not found")
    rows = (await session.execute(stock_query)).scalars().all()
    if len(rows) > 1:
        raise HTTPException(status_code=409, detail="Material has multiple warehouse stock records; select a material variant before putaway")
    return (rows[0] if rows else None), material


async def _resolve_warehouse_entity(session: AsyncSession, warehouse_ref_id: Any) -> WarehouseModel | None:
    if not warehouse_ref_id:
        return None
    uid = _parse_uuid(warehouse_ref_id)
    if uid:
        warehouse = await session.get(WarehouseModel, uid)
        if warehouse:
            return warehouse
    stmt = select(WarehouseModel).where(
        or_(
            func.lower(WarehouseModel.warehouse_code) == str(warehouse_ref_id).strip().lower(),
            func.lower(WarehouseModel.warehouse_name) == str(warehouse_ref_id).strip().lower(),
        )
    )
    res = await session.execute(stmt)
    return res.scalars().first()


async def _resolve_zone_entity(session: AsyncSession, zone_id: Any) -> WarehouseZoneModel | None:
    if not zone_id:
        return None
    uid = _parse_uuid(zone_id)
    if uid:
        zone = await session.get(WarehouseZoneModel, uid)
        if zone:
            return zone
    stmt = select(WarehouseZoneModel).where(
        or_(
            func.lower(WarehouseZoneModel.zone_code) == str(zone_id).strip().lower(),
            func.lower(WarehouseZoneModel.zone_name) == str(zone_id).strip().lower(),
        )
    )
    res = await session.execute(stmt)
    return res.scalars().first()


async def _resolve_bin_entity(session: AsyncSession, bin_id: Any) -> WarehouseBinModel | None:
    if not bin_id:
        return None
    uid = _parse_uuid(bin_id)
    if uid:
        b_obj = await session.get(WarehouseBinModel, uid)
        if b_obj:
            return b_obj
    stmt = select(WarehouseBinModel).where(
        or_(
            func.lower(WarehouseBinModel.bin_code) == str(bin_id).strip().lower(),
            func.lower(WarehouseBinModel.qr_identifier) == str(bin_id).strip().lower(),
        )
    )
    res = await session.execute(stmt)
    return res.scalars().first()


async def _resolve_loc_entity(session: AsyncSession, loc_id: Any) -> StorageLocationModel | None:
    if not loc_id:
        return None
    uid = _parse_uuid(loc_id)
    if uid:
        loc = await session.get(StorageLocationModel, uid)
        if loc:
            return loc
    stmt = select(StorageLocationModel).where(
        func.lower(StorageLocationModel.location_code) == str(loc_id).strip().lower()
    )
    res = await session.execute(stmt)
    return res.scalars().first()


class LocationAssignmentRequest(BaseModel):
    warehouse_ref_id: Any = None
    zone_id: Any = None
    bin_id: Any = None
    location_id: Any = None
    quantity: Decimal | None = None


class PutawayConfirmationRequest(BaseModel):
    material_scan: str
    location_scan: str
    quantity: Decimal
    confirmation_id: str | None = Field(default=None, max_length=64)


class ResolveGrnQrRequest(BaseModel):
    qr_code: str
    batch_number: str | None = Field(default=None, max_length=128)


class ResolveBinQrRequest(BaseModel):
    bin_scan: str | None = None
    bin_qr_code: str | None = None
    qr_code: str | None = None
    warehouse_ref_id: Any = None


class ExecutePutawayRequest(BaseModel):
    task_id: Any = None
    grn_qr_code: str
    bin_qr_code: str
    quantity: Decimal
    batch_number: str | None = Field(default=None, max_length=128)
    confirmation_id: str | None = Field(default=None, max_length=64)


def _confirmation_digest(*parts: Any) -> str:
    normalized = [str(part or "").strip().upper() for part in parts]
    return hashlib.sha256(json.dumps(normalized, separators=(",", ":")).encode("utf-8")).hexdigest()


class StorageLocationCreateRequest(BaseModel):
    location_code: str = Field(min_length=1, max_length=64)
    warehouse_id: str = Field(min_length=1, max_length=64)
    warehouse_ref_id: uuid.UUID | None = None
    zone_id: uuid.UUID | None = None
    zone: str = Field(min_length=1, max_length=128)
    rack: str = Field(min_length=1, max_length=64)
    bin: str = Field(min_length=1, max_length=64)
    capacity: Decimal = Field(gt=0)


class StorageLocationUpdateRequest(BaseModel):
    active: bool


def storage_location_response(location: StorageLocationModel) -> dict:
    capacity = location.capacity or Decimal("0")
    occupied = location.occupied_quantity or Decimal("0")
    return {
        "id": str(location.id),
        "location_code": location.location_code,
        "warehouse_id": location.warehouse_id,
        "warehouse_ref_id": str(location.warehouse_ref_id) if location.warehouse_ref_id else None,
        "zone_id": str(location.zone_id) if location.zone_id else None,
        "zone": location.zone,
        "rack": location.rack,
        "bin": location.bin,
        "capacity": float(capacity),
        "occupied_quantity": float(occupied),
        "available_capacity": float(capacity - occupied),
        "utilization_percent": float((occupied / capacity) * 100) if capacity else 0,
        "active": location.active,
    }


async def get_user_warehouse_context(user: CurrentUser, uow: UnitOfWork):
    from app.modules.warehouse.context import warehouse_context
    return await warehouse_context(uow.session)


async def get_user_warehouse_ref_id(user: CurrentUser, uow: UnitOfWork) -> uuid.UUID | None:
    roles_upper = {r.upper() for r in (user.roles or [])}
    if "ADMIN" in roles_upper or "SUPERUSER" in roles_upper:
        return None

    sids, _ = await get_user_warehouse_context(user, uow)
    return next(iter(sids), None)


def task_response(task: PutawayTaskModel) -> dict:
    placement_metadata = task.placement_metadata or {}
    stored_quantity = placement_metadata.get("putaway_quantity")
    return {
        "id": str(task.id),
        "task_number": task.task_number,
        "grn_id": str(task.grn_id),
        "grn_number": task.grn_number,
        "handling_unit_id": str(task.handling_unit_id) if task.handling_unit_id else None,
        "item_code": task.item_code,
        "material_name": task.material_name,
        "batch_number": task.batch_number,
        "material_qr": (task.placement_metadata or {}).get("unit_qr") if task.finished_goods_id else None,
        "barcode_value": None,
        "quantity": float(task.quantity),
        "stored_quantity": float(stored_quantity) if stored_quantity is not None else None,
        "accepted_quantity": float(task.quantity),
        "remaining_quantity": 0.0 if task.status in {"COMPLETED", "PUTAWAY_COMPLETED"} else float(task.quantity),
        "uom": task.uom,
        "warehouse_id": task.warehouse_id,
        "source_location": task.source_location,
        "gate_entry_number": None,
        "truck_number": None,
        "vehicle_number": None,
        "asn_number": None,
        "po_number": None,
        "assigned_dock": task.source_location,
        "assigned_dock_code": None,
        "assigned_warehouse_operator": task.assigned_to,
        "assigned_warehouse_operator_name": task.assigned_to,
        "assigned_warehouse_operator_username": task.assigned_to,
        "assigned_warehouse_operator_id": None,
        "assigned_warehouse_ref_id": str(task.destination_warehouse_ref_id) if task.destination_warehouse_ref_id else None,
        "assigned_warehouse_code": None,
        "assigned_warehouse_name": None,
        "destination_warehouse_ref_id": str(task.destination_warehouse_ref_id) if task.destination_warehouse_ref_id else None,
        "destination_zone_id": str(task.destination_zone_id) if task.destination_zone_id else None,
        "destination_bin_id": str(task.destination_bin_id) if getattr(task, "destination_bin_id", None) else None,
        "destination_bin_code": getattr(task, "destination_bin_code", None),
        "destination_location_id": str(task.destination_location_id) if task.destination_location_id else None,
        "destination_zone": task.destination_zone,
        "destination_rack": task.destination_rack,
        "destination_bin": task.destination_bin,
        "location_assigned_by": task.location_assigned_by,
        "location_assigned_at": task.location_assigned_at.isoformat() if task.location_assigned_at else None,
        "assigned_to": task.assigned_to,
        "assigned_by": task.assigned_by,
        "assigned_at": task.assigned_at.isoformat() if task.assigned_at else None,
        "started_by": task.started_by,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "completed_by": task.completed_by,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "status": task.status,
        "created_by": task.created_by,
        "created_at": task.created_at.isoformat() if task.created_at else None,
    }


async def enrich_putaway_tasks(tasks: list[PutawayTaskModel], session) -> list[dict]:
    if not tasks:
        return []

    try:
        grn_ids = {t.grn_id for t in tasks if t.grn_id}
        hu_ids = {t.handling_unit_id for t in tasks if t.handling_unit_id}
        warehouse_ref_ids = {t.destination_warehouse_ref_id for t in tasks if t.destination_warehouse_ref_id}
        fg_ids = {t.finished_goods_id for t in tasks if t.finished_goods_id}
        finished_goods = {}
        if fg_ids:
            from app.modules.assembly.infrastructure.persistence.models import AssemblyFinishedGoodsModel
            fg_res = await session.execute(select(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.id.in_(fg_ids)))
            finished_goods = {fg.id: fg for fg in fg_res.scalars().all()}

        grns: dict[uuid.UUID, GrnModel] = {}
        if grn_ids:
            try:
                grn_res = await session.execute(select(GrnModel).where(GrnModel.id.in_(grn_ids)))
                grns = {g.id: g for g in grn_res.scalars().all()}
            except Exception:
                pass

        hus: dict[uuid.UUID, HandlingUnitModel] = {}
        if hu_ids:
            try:
                hu_res = await session.execute(select(HandlingUnitModel).where(HandlingUnitModel.id.in_(hu_ids)))
                hus = {h.id: h for h in hu_res.scalars().all()}
            except Exception:
                pass

        warehouses: dict[uuid.UUID, WarehouseModel] = {}
        if warehouse_ref_ids:
            try:
                warehouse_res = await session.execute(select(WarehouseModel).where(WarehouseModel.id.in_(warehouse_ref_ids)))
                warehouses = {s.id: s for s in warehouse_res.scalars().all()}
            except Exception:
                pass

        finished_goods_warehouse = None
        if fg_ids:
            try:
                finished_goods_warehouse = (await session.execute(
                    select(WarehouseModel).where(
                        or_(
                            func.upper(WarehouseModel.warehouse_code) == "STR-FG",
                            func.upper(WarehouseModel.warehouse_name) == "FINISHED GOODS WAREHOUSE_OPERATOR",
                        ),
                        WarehouseModel.status == "ACTIVE",
                    ).order_by(WarehouseModel.created_at.asc())
                )).scalars().first()
            except Exception:
                finished_goods_warehouse = None

        gate_passes = {g.gate_entry_number for g in grns.values() if g and g.gate_entry_number}
        gate_entry_ids = {g.gate_entry_id for g in grns.values() if g and g.gate_entry_id}
        grn_id_keys = [g.id for g in grns.values() if g and g.id]
        vehicles = {g.vehicle_number for g in grns.values() if g and g.vehicle_number}

        dock_allocs: list = []
        dock_assigns: list[DockAssignmentModel] = []
        if gate_entry_ids or grn_id_keys or vehicles:
            clauses = []
            if gate_entry_ids:
                clauses.append(DockAssignmentModel.gate_entry_id.in_(gate_entry_ids))
            if grn_id_keys:
                clauses.append(DockAssignmentModel.prepared_grn_id.in_(grn_id_keys))
            if vehicles:
                clauses.append(DockAssignmentModel.vehicle_number.in_(vehicles))
            if clauses:
                try:
                    as_res = await session.execute(
                        select(DockAssignmentModel)
                        .where(or_(*clauses))
                        .order_by(DockAssignmentModel.assigned_at.desc())
                    )
                    dock_assigns = list(as_res.scalars().all())
                except Exception:
                    pass

        results = []
        assignment_totals: dict[uuid.UUID, Decimal] = {}
        assignment_rows_by_task: dict[uuid.UUID, list[PutawayLocationAssignmentModel]] = {}
        task_ids = [t.id for t in tasks]
        if task_ids:
            assignment_rows = await session.execute(
                select(
                    PutawayLocationAssignmentModel.putaway_task_id,
                    func.coalesce(func.sum(PutawayLocationAssignmentModel.quantity), 0),
                ).where(PutawayLocationAssignmentModel.putaway_task_id.in_(task_ids))
                .group_by(PutawayLocationAssignmentModel.putaway_task_id)
            )
            assignment_totals = {row[0]: Decimal(str(row[1] or 0)) for row in assignment_rows.all()}
            assignment_detail_rows = await session.execute(
                select(PutawayLocationAssignmentModel).where(PutawayLocationAssignmentModel.putaway_task_id.in_(task_ids))
            )
            for assignment in assignment_detail_rows.scalars().all():
                assignment_rows_by_task.setdefault(assignment.putaway_task_id, []).append(assignment)
        for t in tasks:
            grn = grns.get(t.grn_id)
            hu = hus.get(t.handling_unit_id) if t.handling_unit_id else None
            is_finished_goods = bool(t.finished_goods_id)
            warehouse = finished_goods_warehouse if is_finished_goods and finished_goods_warehouse else (
                warehouses.get(t.destination_warehouse_ref_id) if t.destination_warehouse_ref_id else None
            )

            da = None
            for item in dock_allocs:
                if grn and grn.gate_entry_number and item.existing_gate_pass_id == grn.gate_entry_number:
                    da = item
                    break
                if grn and grn.vehicle_number and item.vehicle_number == grn.vehicle_number:
                    da = item
                    break

            das = None
            for item in dock_assigns:
                if grn and grn.gate_entry_id and item.gate_entry_id == grn.gate_entry_id:
                    das = item
                    break
                if grn and grn.id and item.prepared_grn_id == grn.id:
                    das = item
                    break
                if grn and grn.vehicle_number and item.vehicle_number == grn.vehicle_number:
                    das = item
                    break

            sm_name = (
                (da.assigned_warehouse_operator_name if da and da.assigned_warehouse_operator_name else None)
                or (das.assigned_warehouse_operator_name if das and das.assigned_warehouse_operator_name else None)
                or (warehouse.warehouse_operator_name if warehouse and getattr(warehouse, "warehouse_operator_name", None) else None)
                or t.assigned_to
            )
            sm_user = (
                (da.assigned_warehouse_operator_username if da and da.assigned_warehouse_operator_username else None)
                or (das.assigned_warehouse_operator_username if das and das.assigned_warehouse_operator_username else None)
                or t.assigned_to
            )
            sm_id = (
                (da.assigned_warehouse_operator_id if da and da.assigned_warehouse_operator_id else None)
                or (das.assigned_warehouse_operator_id if das and das.assigned_warehouse_operator_id else None)
                or (warehouse.warehouse_operator_id if warehouse and getattr(warehouse, "warehouse_operator_id", None) else None)
            )

            dock_code = None if is_finished_goods else (
                (da.assigned_dock.dock_code if da and da.assigned_dock and getattr(da.assigned_dock, "dock_code", None) else None)
                or (das.dock_number if das and das.dock_number else None)
                or (grn.dock_number if grn and grn.dock_number else None)
                or t.source_location
            )

            gate_entry_no = (
                (grn.gate_entry_number if grn and grn.gate_entry_number else None)
                or (da.existing_gate_pass_id if da and da.existing_gate_pass_id else None)
            )
            truck_no = (
                (grn.vehicle_number if grn and grn.vehicle_number else None)
                or (da.vehicle_number if da and da.vehicle_number else None)
                or (das.vehicle_number if das and das.vehicle_number else None)
            )
            asn_no = (
                (grn.asn_number if grn and grn.asn_number else None)
                or (hu.asn_number if hu and hu.asn_number else None)
            )
            po_no = (
                (grn.po_number if grn and grn.po_number else None)
                or (hu.po_number if hu and hu.po_number else None)
            )
            fg_record = finished_goods.get(t.finished_goods_id) if t.finished_goods_id else None
            unit_qr = (t.placement_metadata or {}).get("unit_qr") if t.finished_goods_id else None
            mat_qr = unit_qr or (fg_record.qr_code if fg_record else None)
            if not mat_qr and not is_finished_goods:
                # A normal GRN putaway task is batch-specific. Prefer the
                # persisted QR for this exact GRN line and batch over a
                # handling-unit barcode, which may be absent or associated
                # with a different material/lot in legacy records.
                try:
                    batch_result = await session.execute(
                        select(GrnBatchModel.id).where(
                            GrnBatchModel.grn_line_id.in_(
                                select(GrnLineModel.id).where(
                                    GrnLineModel.grn_id == t.grn_id,
                                    func.upper(GrnLineModel.item_code) == t.item_code.upper(),
                                )
                            ),
                            func.upper(GrnBatchModel.batch_number) == func.upper(t.batch_number),
                            GrnBatchModel.superseded.is_(False),
                        )
                    )
                    batch_id = batch_result.scalar_one_or_none()
                    qr_result = await session.execute(
                        select(GrnBatchQrModel).where(GrnBatchQrModel.batch_id == batch_id)
                    ) if batch_id else None
                    qr_record = qr_result.scalars().first() if qr_result else None
                    mat_qr = qr_record.qr_code if qr_record else None
                except Exception:
                    mat_qr = None
                if not mat_qr:
                    mat_qr = (
                        (hu.barcode_value if hu and hu.barcode_value else None)
                        or (hu.hu_number if hu and hu.hu_number else None)
                        or None
                    )

            unit_metadata = t.placement_metadata or {}
            recorded_putaway_quantity = unit_metadata.get("putaway_quantity")
            if recorded_putaway_quantity is None and t.finished_goods_id and t.status in ("PUTAWAY_COMPLETED", "STORED"):
                recorded_putaway_quantity = 1 if unit_metadata.get("unit_qr") else (float(fg_record.quantity) if fg_record else float(t.quantity))
            results.append({
                "id": str(t.id),
                "task_number": t.task_number,
                "finished_goods_id": str(t.finished_goods_id) if t.finished_goods_id else None,
                "is_finished_goods": is_finished_goods,
                "grn_id": str(t.grn_id),
                "grn_number": None if t.finished_goods_id else t.grn_number,
                "handling_unit_id": str(t.handling_unit_id) if t.handling_unit_id else None,
                "item_code": t.item_code,
                "material_name": t.material_name,
                "batch_number": t.batch_number,
                "material_qr": mat_qr,
                "barcode_value": hu.barcode_value if hu else None,
                "quantity": float(t.quantity),
                "accepted_quantity": float(t.quantity),
                "remaining_quantity": 0.0 if t.status in {"COMPLETED", "PUTAWAY_COMPLETED"} else max(0.0, float(Decimal(str(t.quantity)) - assignment_totals.get(t.id, Decimal("0")))),
                "location_assignments": [
                    {
                        "location_code": a.location_code,
                        "quantity": float(a.quantity),
                        "destination_bin_id": str(a.destination_bin_id) if a.destination_bin_id else None,
                    }
                    for a in assignment_rows_by_task.get(t.id, [])
                ],
                "putaway_quantity": recorded_putaway_quantity,
                "uom": t.uom,
                "warehouse_id": t.warehouse_id,
                "source_location": t.source_location,
                "gate_entry_number": None if t.finished_goods_id else gate_entry_no,
                "gate_entry_id": None if t.finished_goods_id else (str(grn.gate_entry_id) if grn and grn.gate_entry_id else None),
                "truck_number": None if t.finished_goods_id else truck_no,
                "vehicle_number": None if t.finished_goods_id else truck_no,
                "asn_number": None if t.finished_goods_id else asn_no,
                "po_number": None if t.finished_goods_id else po_no,
                "assigned_dock": dock_code,
                "assigned_dock_code": dock_code,
                "assigned_warehouse_operator": sm_name or sm_user or sm_id,
                "assigned_warehouse_operator_name": sm_name,
                "assigned_warehouse_operator_username": sm_user,
                "assigned_warehouse_operator_id": sm_id,
                "assigned_warehouse_ref_id": str(t.destination_warehouse_ref_id) if t.destination_warehouse_ref_id else None,
                "assigned_warehouse_code": warehouse.warehouse_code if warehouse else None,
                "assigned_warehouse_name": warehouse.warehouse_name if warehouse else None,
                "destination_warehouse_ref_id": str(t.destination_warehouse_ref_id) if t.destination_warehouse_ref_id else None,
                "destination_zone_id": str(t.destination_zone_id) if t.destination_zone_id else None,
                "destination_bin_id": str(t.destination_bin_id) if getattr(t, "destination_bin_id", None) else None,
                "destination_bin_code": getattr(t, "destination_bin_code", None),
                "destination_location_id": str(t.destination_location_id) if t.destination_location_id else None,
                "destination_zone": t.destination_zone,
                "destination_rack": t.destination_rack,
                "destination_bin": t.destination_bin,
                "location_assigned_by": t.location_assigned_by,
                "location_assigned_at": t.location_assigned_at.isoformat() if t.location_assigned_at else None,
                "assigned_to": t.assigned_to,
                "assigned_by": t.assigned_by,
                "assigned_at": t.assigned_at.isoformat() if t.assigned_at else None,
                "started_by": t.started_by,
                "started_at": t.started_at.isoformat() if t.started_at else None,
                "completed_by": t.completed_by,
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
                "status": t.status,
                "created_by": t.created_by,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            })
        return results
    except Exception:
        # Fallback to basic task representation if any unexpected error occurs
        return [task_response(t) for t in tasks]


def normalize_hu_scan(value: str) -> str:
    scanned = value.strip()
    if scanned.startswith("{"):
        try:
            payload = json.loads(scanned)
            return str(payload.get("material_code") or payload.get("item_code") or payload.get("hu_number") or payload.get("barcode_value") or "").strip()
        except (json.JSONDecodeError, AttributeError):
            return scanned
    for line in scanned.splitlines():
        label, separator, candidate = line.partition(":")
        if separator and label.strip().upper() in {"HU", "HANDLING UNIT", "HU NUMBER", "MATERIAL", "ITEM", "QR"}:
            scanned = candidate.strip()
            break
    if scanned.upper().startswith("QR-MAT-"):
        return scanned[7:].strip()
    if scanned.upper().startswith("QR-"):
        return scanned[3:].strip()
    return scanned


def normalize_zone_scan(value: str) -> dict[str, str | None]:
    scanned = value.strip()
    if scanned.startswith("{"):
        try:
            payload = json.loads(scanned)
            return {
                "bin_id": str(payload.get("bin_id") or "").strip() or None,
                "bin_code": str(payload.get("bin_code") or "").strip() or None,
                "zone_id": str(payload.get("zone_id") or "").strip() or None,
                "zone_code": str(payload.get("zone_code") or "").strip() or None,
                "warehouse_ref_id": str(payload.get("warehouse_ref_id") or "").strip() or None,
                "warehouse_code": str(payload.get("warehouse_code") or "").strip() or None,
                "raw": scanned,
            }
        except (json.JSONDecodeError, AttributeError):
            pass
    # If the scanned string is a valid UUID, classify it directly
    try:
        parsed_uuid = uuid.UUID(scanned)
        return {
            "bin_id": str(parsed_uuid),
            "bin_code": None,
            "zone_id": str(parsed_uuid),
            "zone_code": None,
            "warehouse_ref_id": None,
            "warehouse_code": None,
            "raw": scanned,
        }
    except (ValueError, TypeError):
        pass
    return {
        "bin_id": None,
        "bin_code": scanned if scanned.upper().startswith("BIN-") else None,
        "zone_id": None,
        "zone_code": scanned,
        "warehouse_ref_id": None,
        "warehouse_code": None,
        "raw": scanned,
    }


def handling_unit_response(unit: HandlingUnitModel, task: PutawayTaskModel | None = None) -> dict:
    return {
        "id": str(unit.id),
        "hu_number": unit.hu_number,
        "barcode_value": unit.barcode_value,
        "item_code": unit.item_code,
        "material_name": unit.material_name,
        "quantity": float(unit.quantity),
        "uom": unit.uom,
        "batch_number": unit.batch_number,
        "supplier_name": unit.supplier_name,
        "po_number": unit.po_number,
        "asn_number": unit.asn_number,
        "grn_number": unit.grn_number,
        "warehouse_id": unit.warehouse_id,
        "current_location": unit.current_location,
        "status": unit.status,
        "putaway_task_id": str(task.id) if task else None,
        "putaway_task_number": task.task_number if task else None,
        "destination_warehouse_ref_id": str(task.destination_warehouse_ref_id) if task and task.destination_warehouse_ref_id else None,
        "destination_zone_id": str(task.destination_zone_id) if task and task.destination_zone_id else None,
        "destination_location_id": str(task.destination_location_id) if task and task.destination_location_id else None,
        "destination": f"{task.warehouse_id} / {task.destination_zone} / {task.destination_rack} / {task.destination_bin}" if task and task.destination_bin else None,
    }


@router.get("")
async def list_putaway_tasks(
    warehouse_ref_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    roles_upper = {r.upper() for r in user.roles}
    query = select(PutawayTaskModel).order_by(PutawayTaskModel.created_at.desc())

    # Warehouse Operators / Warehouse Operators are strictly scoped to their assigned Warehouse
    if "WAREHOUSE_OPERATOR" in roles_upper or "WAREHOUSE_OPERATOR" in roles_upper:
        if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper and "WAREHOUSE" not in roles_upper and "WAREHOUSE_MANAGER" not in roles_upper:
            user_warehouse_ref_ids, user_warehouse_codes = await get_user_warehouse_context(user, uow)
            if user_warehouse_ref_ids:
                query = query.where((PutawayTaskModel.destination_warehouse_ref_id.in_(user_warehouse_ref_ids)) | (PutawayTaskModel.destination_warehouse_ref_id.is_(None)))
            elif user_warehouse_codes:
                s_res = await uow.session.execute(select(WarehouseModel.id).where(func.upper(WarehouseModel.warehouse_code).in_(user_warehouse_codes)))
                s_ids = list(s_res.scalars().all())
                if s_ids:
                    query = query.where((PutawayTaskModel.destination_warehouse_ref_id.in_(s_ids)) | (PutawayTaskModel.destination_warehouse_ref_id.is_(None)))
    elif warehouse_ref_id and isinstance(warehouse_ref_id, uuid.UUID):
        query = query.where(PutawayTaskModel.destination_warehouse_ref_id == warehouse_ref_id)

    result = await uow.session.execute(query)
    raw_tasks = list(result.scalars().all())

    # Resolve the canonical accepted batches from GRN inspection data. If old
    # posting paths created extra task rows, only batches whose cumulative
    # quantity fits within the saved QC-approved quantity are eligible.
    canonical_batches: dict[tuple[uuid.UUID, str], set[str]] = {}
    canonical_grn_materials: set[tuple[uuid.UUID, str]] = set()
    reconciled_grn_ids: set[uuid.UUID] = set()
    reconciled_grn_numbers: dict[uuid.UUID, str] = {}
    grn_ids = {task.grn_id for task in raw_tasks if task.grn_id}
    if grn_ids:
        grn_result = await uow.session.execute(
            select(GrnModel)
            .options(selectinload(GrnModel.lines).selectinload(GrnLineModel.batches))
            .where(GrnModel.id.in_(grn_ids))
        )
        grns_for_reconciliation = list(grn_result.scalars().all())
        for grn in grns_for_reconciliation:
            reconciled_grn_ids.add(grn.id)
            if grn.grn_number:
                reconciled_grn_numbers[grn.id] = grn.grn_number.strip().upper()
            for line in grn.lines:
                item_key = (grn.id, line.item_code.strip().upper())
                approved = line.quality_approved_quantity or line.good_quantity or Decimal("0")
                # Zero-quantity ASN balance lines remain visible in the GRN
                # audit, but they were not received and must never enter the
                # warehouse putaway queue.
                if approved <= Decimal("0"):
                    continue
                canonical_grn_materials.add(item_key)
                remaining = approved
                allowed: set[str] = set()
                for batch in sorted(line.batches, key=lambda item: item.created_at):
                    batch_number = str(batch.batch_number or "").strip().upper()
                    quantity = batch.batch_quantity or Decimal("0")
                    if batch.superseded or not batch_number or batch_number in allowed or remaining <= Decimal("0"):
                        continue
                    if quantity <= Decimal("0"):
                        continue
                    allowed.add(batch_number)
                    remaining -= min(quantity, remaining)
                if allowed:
                    canonical_batches[item_key] = allowed

    # Reconcile legacy duplicate active tasks against the canonical batch set.
    # Keep the records for auditability, but make only approved batch tasks
    # eligible for normal putaway.
    if canonical_batches:
        for task in raw_tasks:
            item_key = (task.grn_id, task.item_code.upper())
            allowed = canonical_batches.get(item_key)
            if not allowed:
                continue
            batch = str(task.batch_number or "").strip().upper()
            if batch not in allowed and task.status not in {"COMPLETED", "STORED", "CANCELLED", "VOID"}:
                task.status = "CANCELLED"

        # Preserve excess batch rows for auditability, but mark them
        # superseded so they cannot be used for normal putaway or displayed as
        # active batches. Canonical batches are selected by GRN link, creation
        # order, and the QC-approved quantity above.
        for grn in grns_for_reconciliation if grn_ids else []:
            for line in grn.lines:
                allowed = canonical_batches.get((grn.id, line.item_code.upper()))
                if not allowed:
                    continue
                for batch in line.batches:
                    if str(batch.batch_number or "").strip().upper() not in allowed:
                        batch.superseded = True
        await uow.session.flush()

    # A GRN batch is the unit of normal putaway. Older completion paths could
    # also leave a second line-level task for the same GRN/material. Prefer
    # the persisted batch tasks and expose each batch only once.
    batch_keys = {
        (task.grn_id, task.item_code.upper(), str(task.batch_number).strip().upper())
        for task in raw_tasks
        if task.grn_id and task.batch_number and str(task.batch_number).strip()
    }
    batch_materials = {(grn_id, item_code) for grn_id, item_code, _ in batch_keys}
    seen_keys: set[tuple[uuid.UUID | None, str, str]] = set()
    tasks_list = []
    for task in raw_tasks:
        if task.status in {"CANCELLED", "VOID"}:
            continue
        item_key = (task.grn_id, task.item_code.strip().upper())
        canonical_grn_number = reconciled_grn_numbers.get(task.grn_id)
        task_grn_number = str(task.grn_number or "").strip().upper()
        # Never render a legacy task beneath a different GRN number than the
        # receipt linked by its foreign key. This was the source of STEEL from
        # GRN-004 appearing in the GRN-005 details modal.
        if canonical_grn_number and task_grn_number and task_grn_number != canonical_grn_number:
            continue
        # The GRN is the source of truth for material ownership. Legacy rows
        # occasionally retained the right GRN number with an item copied from
        # another receipt; never expose those rows under this GRN.
        if task.grn_id in reconciled_grn_ids and item_key not in canonical_grn_materials:
            continue
        batch = str(task.batch_number or "").strip().upper()
        allowed_batches = canonical_batches.get(item_key)
        if allowed_batches and batch not in allowed_batches:
            continue
        if not batch and item_key in batch_materials:
            continue
        key = (task.grn_id, task.item_code.upper(), batch)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        tasks_list.append(task)
    return await enrich_putaway_tasks(tasks_list, uow.session)


@router.get("/locations")
async def list_storage_locations(
    warehouse_id: str | None = None,
    include_inactive: bool = False,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    roles_upper = {r.upper() for r in (user.roles or [])}
    query = select(StorageLocationModel)
    if not include_inactive:
        query = query.where(StorageLocationModel.active.is_(True))
    if warehouse_id:
        query = query.where(StorageLocationModel.warehouse_id == warehouse_id)

    # Warehouse Operators / Warehouse Operators see only their warehouse's storage locations
    if "WAREHOUSE_OPERATOR" in roles_upper or "WAREHOUSE_OPERATOR" in roles_upper:
        if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper and "WAREHOUSE" not in roles_upper and "WAREHOUSE_MANAGER" not in roles_upper:
            user_warehouse_ref_ids, user_warehouse_codes = await get_user_warehouse_context(user, uow)
            if user_warehouse_ref_ids:
                query = query.where(StorageLocationModel.warehouse_ref_id.in_(user_warehouse_ref_ids))
            elif user_warehouse_codes:
                s_res = await uow.session.execute(select(WarehouseModel.id).where(func.upper(WarehouseModel.warehouse_code).in_(user_warehouse_codes)))
                s_ids = list(s_res.scalars().all())
                if s_ids:
                    query = query.where(StorageLocationModel.warehouse_ref_id.in_(s_ids))
                else:
                    return []
            else:
                return []

    result = await uow.session.execute(query.order_by(StorageLocationModel.warehouse_id, StorageLocationModel.zone, StorageLocationModel.rack, StorageLocationModel.bin))
    return [storage_location_response(location) for location in result.scalars().all()]


@router.post("/locations", status_code=201)
async def create_storage_location(
    request: StorageLocationCreateRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    roles_upper = {r.upper() for r in (user.roles or [])}
    is_warehouse_user = "WAREHOUSE_OPERATOR" in roles_upper or "WAREHOUSE_OPERATOR" in roles_upper
    is_admin_or_wh = bool(roles_upper.intersection({"ADMIN", "SUPERUSER", "WAREHOUSE", "WAREHOUSE_MANAGER"}))

    if not is_warehouse_user and not is_admin_or_wh and "gate:approve" not in (user.permissions or []):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Insufficient permissions to create storage locations.",
        )

    warehouse_ref_id = request.warehouse_ref_id
    zone_id = request.zone_id

    # If Warehouse Operator, validate warehouse ownership
    if is_warehouse_user and not is_admin_or_wh:
        user_warehouse_ref_ids, user_warehouse_codes = await get_user_warehouse_context(user, uow)
        if warehouse_ref_id and warehouse_ref_id not in user_warehouse_ref_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You cannot create storage locations for another warehouse.",
            )
        if not warehouse_ref_id and user_warehouse_ref_ids:
            warehouse_ref_id = next(iter(user_warehouse_ref_ids))

        if zone_id:
            zone_obj = await uow.session.get(WarehouseZoneModel, zone_id)
            if zone_obj and zone_obj.warehouse_ref_id not in user_warehouse_ref_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: The specified zone belongs to another warehouse.",
                )

    values = {
        "location_code": request.location_code.strip().upper(),
        "warehouse_id": request.warehouse_id.strip().upper(),
        "warehouse_ref_id": warehouse_ref_id,
        "zone_id": zone_id,
        "zone": request.zone.strip(),
        "rack": request.rack.strip(),
        "bin": request.bin.strip(),
    }
    if any(value is None or (isinstance(value, str) and not value) for k, value in values.items() if k not in ("warehouse_ref_id", "zone_id")):
        raise HTTPException(status_code=422, detail="Location fields cannot be blank")

    existing = await uow.session.scalar(
        select(StorageLocationModel).where(
            (StorageLocationModel.location_code == values["location_code"])
            | (
                (StorageLocationModel.warehouse_id == values["warehouse_id"])
                & (StorageLocationModel.zone == values["zone"])
                & (StorageLocationModel.rack == values["rack"])
                & (StorageLocationModel.bin == values["bin"])
            )
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="Storage location already exists")

    location = StorageLocationModel(
        **values,
        capacity=request.capacity,
        occupied_quantity=Decimal("0"),
        active=True,
    )
    uow.session.add(location)
    try:
        await uow.session.flush()
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Storage location already exists") from error
    return storage_location_response(location)


@router.put("/locations/{location_id}")
async def update_storage_location(
    location_id: uuid.UUID,
    request: StorageLocationUpdateRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    location = await uow.session.get(StorageLocationModel, location_id)
    if location is None:
        raise HTTPException(status_code=404, detail="Storage location not found")

    roles_upper = {r.upper() for r in (user.roles or [])}
    is_warehouse_user = "WAREHOUSE_OPERATOR" in roles_upper or "WAREHOUSE_OPERATOR" in roles_upper
    is_admin_or_wh = bool(roles_upper.intersection({"ADMIN", "SUPERUSER", "WAREHOUSE", "WAREHOUSE_MANAGER"}))

    if not is_warehouse_user and not is_admin_or_wh and "gate:approve" not in (user.permissions or []):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Insufficient permissions to modify storage locations.",
        )

    if is_warehouse_user and not is_admin_or_wh:
        user_warehouse_ref_ids, _ = await get_user_warehouse_context(user, uow)
        if location.warehouse_ref_id and location.warehouse_ref_id not in user_warehouse_ref_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You cannot modify storage locations belonging to another warehouse.",
            )

    if not request.active and location.occupied_quantity > 0:
        raise HTTPException(status_code=409, detail="Occupied storage locations cannot be deactivated")
    location.active = request.active
    await uow.session.flush()
    return storage_location_response(location)


@router.get("/inventory-locations")
async def list_inventory_location_balances(
    material_code: str | None = None,
    warehouse_ref_id: str | None = None,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    user_warehouse_ref_id = await get_user_warehouse_ref_id(user, uow)
    roles_upper = {r.upper() for r in user.roles}
    is_warehouse_user = ("WAREHOUSE_OPERATOR" in roles_upper or "WAREHOUSE_OPERATOR" in roles_upper) and not (
        "WAREHOUSE" in roles_upper or "ADMIN" in roles_upper or "SUPERUSER" in roles_upper
    )

    if is_warehouse_user:
        if not user_warehouse_ref_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Warehouse context not found for user",
            )
        if warehouse_ref_id and str(user_warehouse_ref_id) != warehouse_ref_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access forbidden: You cannot view inventory of another Warehouse.",
            )
        target_warehouse_ref_id = user_warehouse_ref_id
    else:
        target_warehouse_ref_id = uuid.UUID(warehouse_ref_id) if warehouse_ref_id else None

    query = (
        select(InventoryLocationBalanceModel, StorageLocationModel)
        .join(StorageLocationModel, StorageLocationModel.id == InventoryLocationBalanceModel.storage_location_id)
    )
    if target_warehouse_ref_id:
        query = query.where(StorageLocationModel.warehouse_ref_id == target_warehouse_ref_id)
    if material_code:
        query = query.where(func.lower(InventoryLocationBalanceModel.material_code) == material_code.lower())
    result = await uow.session.execute(
        query.order_by(InventoryLocationBalanceModel.material_code, StorageLocationModel.location_code)
    )
    
    warehouses_result = await uow.session.execute(select(WarehouseModel))
    warehouse_map = {s.id: s for s in warehouses_result.scalars().all()}
    zones_result = await uow.session.execute(select(WarehouseZoneModel))
    zone_map = {z.id: z for z in zones_result.scalars().all()}
    balance_rows = result.all()
    task_ids = {balance.last_putaway_task_id for balance, _ in balance_rows if balance.last_putaway_task_id}
    task_map = {}
    if task_ids:
        task_result = await uow.session.execute(select(PutawayTaskModel).where(PutawayTaskModel.id.in_(task_ids)))
        task_map = {t.id: t for t in task_result.scalars().all()}
    grn_ids = {t.grn_id for t in task_map.values() if t.grn_id}
    grn_map = {}
    if grn_ids:
        grn_result = await uow.session.execute(select(GrnModel).where(GrnModel.id.in_(grn_ids)))
        grn_map = {g.id: g for g in grn_result.scalars().all()}
    material_codes = {balance.material_code for balance, _ in balance_rows}
    stock_result = await uow.session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code.in_(material_codes))) if material_codes else None
    stock_map = {s.material_code: s for s in stock_result.scalars().all()} if stock_result else {}
    quarantine_result = await uow.session.execute(
        select(GrnLineModel.item_code, func.coalesce(func.sum(GrnLineModel.damaged_quantity + GrnLineModel.rejected_quantity), 0))
        .where(GrnLineModel.item_code.in_(material_codes)).group_by(GrnLineModel.item_code)
    ) if material_codes else None
    quarantined_map = {row[0]: Decimal(str(row[1] or 0)) for row in quarantine_result.all()} if quarantine_result else {}

    output = []
    for balance, location in balance_rows:
        warehouse_obj = warehouse_map.get(location.warehouse_ref_id) if location.warehouse_ref_id else None
        zone_obj = zone_map.get(location.zone_id) if location.zone_id else None
        task_obj = task_map.get(balance.last_putaway_task_id)
        grn_obj = grn_map.get(task_obj.grn_id) if task_obj else None
        stock_obj = stock_map.get(balance.material_code)
        output.append({
            "id": str(balance.id),
            "material_code": balance.material_code,
            "material_name": balance.material_name,
            "warehouse_id": balance.warehouse_id,
            "storage_location_id": str(location.id),
            "location_code": location.location_code,
            "warehouse_ref_id": str(location.warehouse_ref_id) if location.warehouse_ref_id else None,
            "warehouse_code": warehouse_obj.warehouse_code if warehouse_obj else None,
            "warehouse_name": warehouse_obj.warehouse_name if warehouse_obj else None,
            "zone_id": str(location.zone_id) if location.zone_id else None,
            "zone_code": zone_obj.zone_code if zone_obj else location.zone,
            "zone_name": zone_obj.zone_name if zone_obj else location.zone,
            "zone": location.zone,
            "rack": location.rack,
            "bin": location.bin,
            "location_code": location.location_code,
            "batch_number": task_obj.batch_number if task_obj else None,
            "quantity": float(balance.quantity),
            "total_physical_quantity": float(balance.quantity),
            "available_quantity": float(balance.available_quantity),
            "available_to_pick_quantity": float(balance.available_quantity),
            "reserved_quantity": float(stock_obj.allocated_quantity if stock_obj else 0),
            "quarantined_quantity": float(quarantined_map.get(balance.material_code, 0)),
            "uom": balance.uom,
            "last_putaway_task_id": str(balance.last_putaway_task_id),
            "last_grn_number": balance.last_grn_number,
            "original_grn": balance.last_grn_number,
            "supplier_name": grn_obj.supplier_name if grn_obj else None,
            "received_date": grn_obj.created_at.isoformat() if grn_obj and grn_obj.created_at else (task_obj.created_at.isoformat() if task_obj and task_obj.created_at else None),
            "updated_at": balance.updated_at.isoformat(),
        })
    return output


@router.get("/handling-units/{scan_value}")
async def get_handling_unit(
    scan_value: str,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    roles_upper = {r.upper() for r in user.roles}
    allowed = (
        "WAREHOUSE" in roles_upper
        or "ADMIN" in roles_upper
        or "SUPERUSER" in roles_upper
        or "WAREHOUSE_OPERATOR" in roles_upper
        or "WAREHOUSE_OPERATOR" in roles_upper
        or "storage:read" in user.permissions
        or "putaway:execute" in user.permissions
        or "gate:read" in user.permissions
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Handling unit scanning requires Warehouse or Warehouse personnel access",
        )

    normalized = normalize_hu_scan(scan_value)
    result = await uow.session.execute(select(HandlingUnitModel).where(
        (HandlingUnitModel.hu_number == normalized) | (HandlingUnitModel.barcode_value == normalized) | (HandlingUnitModel.item_code == normalized)
    ))
    unit = result.scalar_one_or_none()
    if unit is None:
        raise HTTPException(status_code=404, detail="Handling unit was not found")

    task_result = await uow.session.execute(select(PutawayTaskModel).where(PutawayTaskModel.handling_unit_id == unit.id))
    task = task_result.scalar_one_or_none()

    # Warehouse isolation: If task is assigned to a specific warehouse, verify Warehouse Operator belongs to it
    if task and task.destination_warehouse_ref_id and ("WAREHOUSE_OPERATOR" in roles_upper or "WAREHOUSE_OPERATOR" in roles_upper):
        if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper and "WAREHOUSE" not in roles_upper and "WAREHOUSE_MANAGER" not in roles_upper:
            user_warehouse_ref_id = await get_user_warehouse_ref_id(user, uow)
            if user_warehouse_ref_id and task.destination_warehouse_ref_id != user_warehouse_ref_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: Handling unit belongs to a putaway task for another Warehouse",
                )

    return handling_unit_response(unit, task)


@router.post("/handling-units/{scan_value}/verify-label")
async def verify_handling_unit_label(
    scan_value: str,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    """Mark a successfully scanned material label as readable."""
    unit_result = await uow.session.execute(select(HandlingUnitModel).where(
        (HandlingUnitModel.hu_number == normalize_hu_scan(scan_value))
        | (HandlingUnitModel.barcode_value == normalize_hu_scan(scan_value))
    ).with_for_update())
    unit = unit_result.scalar_one_or_none()
    if unit is None:
        raise HTTPException(status_code=404, detail="Handling unit was not found")
    unit.status = "LABEL_VERIFIED"
    unit.updated_at = datetime.datetime.now(datetime.timezone.utc)
    await uow.session.flush()
    return handling_unit_response(unit)


@router.get("/{task_id}")
async def get_putaway_task(
    task_id: str,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    task = await _resolve_task(uow.session, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Putaway task not found")

    roles_upper = {r.upper() for r in user.roles}
    if "WAREHOUSE_OPERATOR" in roles_upper or "WAREHOUSE_OPERATOR" in roles_upper:
        if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper and "WAREHOUSE" not in roles_upper and "WAREHOUSE_MANAGER" not in roles_upper:
            user_warehouse_ref_id = await get_user_warehouse_ref_id(user, uow)
            if user_warehouse_ref_id and task.destination_warehouse_ref_id != user_warehouse_ref_id:
                raise HTTPException(status_code=403, detail="Access denied: Putaway task belongs to another Warehouse")

    enriched = await enrich_putaway_tasks([task], uow.session)
    return enriched[0] if enriched else task_response(task)


@router.put("/{task_id}/location")
async def assign_storage_location(
    task_id: str,
    request: LocationAssignmentRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    """
    Warehouse assigns the destination Warehouse to the Putaway task and triggers notification.
    """
    roles_upper = {r.upper() for r in user.roles}
    is_wh = "WAREHOUSE" in roles_upper or "WAREHOUSE_MANAGER" in roles_upper or "ADMIN" in roles_upper or "SUPERUSER" in roles_upper or "gate:approve" in user.permissions

    if not is_wh:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Warehouse personnel can assign destination Warehouses to Putaway tasks",
        )

    task = await _resolve_task(uow.session, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Putaway task not found")
    if task.status in ("PUTAWAY_COMPLETED", "COMPLETED", "STORED"):
        raise HTTPException(status_code=409, detail="Completed putaway tasks cannot be reassigned")

    # Lock the task while calculating the split remainder so concurrent
    # managers cannot assign more than the accepted quantity.
    locked_task = await uow.session.scalar(
        select(PutawayTaskModel).where(PutawayTaskModel.id == task.id).with_for_update()
    )
    task = locked_task or task
    assigned_total = await uow.session.scalar(
        select(func.coalesce(func.sum(PutawayLocationAssignmentModel.quantity), 0)).where(
            PutawayLocationAssignmentModel.putaway_task_id == task.id
        )
    )
    remaining_quantity = Decimal(str(task.quantity or 0)) - Decimal(str(assigned_total or 0))
    requested_quantity = Decimal(str(request.quantity if request.quantity is not None else remaining_quantity))
    if requested_quantity <= 0:
        raise HTTPException(status_code=422, detail="Assignment quantity must be greater than zero")
    if requested_quantity > remaining_quantity:
        raise HTTPException(status_code=409, detail=f"Assignment exceeds remaining putaway quantity ({remaining_quantity})")

    # Destination Warehouse selection
    if request.warehouse_ref_id:
        warehouse = await _resolve_warehouse_entity(uow.session, request.warehouse_ref_id)
        if warehouse is None or (warehouse.status and warehouse.status.upper() != "ACTIVE"):
            raise HTTPException(status_code=422, detail="Selected destination warehouse is inactive or not found")

        zone = None
        if request.zone_id:
            zone = await _resolve_zone_entity(uow.session, request.zone_id)
            if zone is None or (zone.status and zone.status.upper() != "ACTIVE"):
                raise HTTPException(status_code=422, detail="Selected destination zone is inactive or not found")
            if zone.warehouse_ref_id != warehouse.id:
                raise HTTPException(status_code=422, detail=f"Zone '{zone.zone_code}' does not belong to Warehouse '{warehouse.warehouse_code}'")

        bin_obj = None
        if request.bin_id:
            bin_obj = await _resolve_bin_entity(uow.session, request.bin_id)
            if bin_obj is None or (bin_obj.status and bin_obj.status.upper() not in ("ACTIVE", "AVAILABLE", "OCCUPIED", "PARTIALLY_OCCUPIED")):
                raise HTTPException(status_code=422, detail="Selected destination bin is inactive or not found")
            if zone and bin_obj.zone_id != zone.id:
                raise HTTPException(status_code=422, detail=f"Bin '{bin_obj.bin_code}' does not belong to Zone '{zone.zone_code}'")
            if bin_obj.warehouse_ref_id != warehouse.id:
                raise HTTPException(status_code=422, detail=f"Bin '{bin_obj.bin_code}' does not belong to Warehouse '{warehouse.warehouse_code}'")
            if bin_obj.allowed_material_category and task.material_category:
                allowed = {v.strip().upper() for v in bin_obj.allowed_material_category.split(",") if v.strip()}
                if task.material_category.strip().upper() not in allowed:
                    raise HTTPException(status_code=422, detail="Selected location does not permit this material category")

        rack_capacity = None
        if bin_obj:
            bin_obj = await uow.session.scalar(select(WarehouseBinModel).where(WarehouseBinModel.id == bin_obj.id)
                .with_for_update().execution_options(populate_existing=True))
            rack_capacity = await validate_rack_capacity(uow.session, bin_obj, requested_quantity, task.uom)

        # Resolve or create a storage_location associated with this warehouse, zone, and bin
        location = None
        if zone:
            loc_query = select(StorageLocationModel).where(
                StorageLocationModel.warehouse_id == task.warehouse_id,
                StorageLocationModel.active.is_(True),
                (StorageLocationModel.zone_id == zone.id) | (StorageLocationModel.zone == zone.zone_code),
            )
            # Managed racks use current inventory occupancy; a stale legacy
            # location cache must not hide the existing physical location.
            if rack_capacity is None:
                loc_query = loc_query.where(StorageLocationModel.capacity - StorageLocationModel.occupied_quantity >= requested_quantity)
            if bin_obj:
                loc_query = loc_query.where(StorageLocationModel.bin_id == bin_obj.id)
            loc_res = await uow.session.execute(loc_query)
            location = loc_res.scalars().first()

            if location is None:
                b_code = bin_obj.bin_code if bin_obj else "B01"
                r_code = bin_obj.rack if bin_obj and bin_obj.rack else "R01"
                loc_code = f"LOC-{warehouse.warehouse_code}-{zone.zone_code}-{b_code}"
                exist_res = await uow.session.execute(
                    select(StorageLocationModel).where(StorageLocationModel.location_code == loc_code)
                )
                location = exist_res.scalar_one_or_none()
                if location is None:
                    location = StorageLocationModel(
                        location_code=loc_code,
                        warehouse_id=task.warehouse_id,
                        warehouse_ref_id=warehouse.id,
                        zone_id=zone.id,
                        bin_id=bin_obj.id if bin_obj else None,
                        zone=zone.zone_code,
                        rack=r_code,
                        bin=b_code,
                        capacity=bin_obj.capacity if bin_obj else Decimal("10000.0"),
                        occupied_quantity=bin_obj.occupied_quantity if bin_obj else Decimal("0.0"),
                        active=True,
                    )
                    uow.session.add(location)
                    await uow.session.flush()
                else:
                    location.warehouse_ref_id = warehouse.id
                    location.zone_id = zone.id
                    if bin_obj:
                        location.bin_id = bin_obj.id
                    location.zone = zone.zone_code
                    location.active = True
                    await uow.session.flush()

        task.destination_warehouse_ref_id = warehouse.id
        task.destination_zone_id = zone.id if zone else None
        task.destination_bin_id = bin_obj.id if bin_obj else None
        task.destination_bin_code = bin_obj.bin_code if bin_obj else None
        task.destination_location_id = location.id if location else None
        task.destination_zone = zone.zone_code if zone else None
        task.destination_rack = bin_obj.rack if bin_obj and bin_obj.rack else (location.rack if location else None)
        task.destination_bin = bin_obj.bin_code if bin_obj else (location.bin if location else None)
    elif request.location_id:
        location = await _resolve_loc_entity(uow.session, request.location_id)
        if location is None or not location.active:
            raise HTTPException(status_code=422, detail="Storage location is unavailable")
        if location.warehouse_id != task.warehouse_id:
            raise HTTPException(status_code=422, detail="Storage location belongs to a different warehouse")
        rack = None
        if location.bin_id:
            bin_obj = await uow.session.scalar(select(WarehouseBinModel).where(WarehouseBinModel.id == location.bin_id)
                .with_for_update().execution_options(populate_existing=True))
            if bin_obj:
                rack = await validate_rack_capacity(uow.session, bin_obj, requested_quantity, task.uom)
        if rack is None and location.capacity - location.occupied_quantity < requested_quantity:
            raise HTTPException(status_code=409, detail="Storage location has insufficient available capacity")
        
        warehouse = None
        if location.warehouse_ref_id:
            warehouse = await uow.session.get(WarehouseModel, location.warehouse_ref_id)

        task.destination_location_id = location.id
        task.destination_warehouse_ref_id = location.warehouse_ref_id
        task.destination_zone_id = location.zone_id
        task.destination_bin_id = location.bin_id
        task.destination_bin_code = location.bin
        task.destination_zone = location.zone
        task.destination_rack = location.rack
        task.destination_bin = location.bin
    else:
        raise HTTPException(status_code=422, detail="Specify destination warehouse_ref_id or storage location_id")

    location_code = (
        task.destination_bin_code
        or task.destination_bin
        or (location.location_code if 'location' in locals() and location else None)
        or task.destination_zone
        or "UNASSIGNED"
    )
    existing_assignment = await uow.session.scalar(
        select(PutawayLocationAssignmentModel).where(
            PutawayLocationAssignmentModel.putaway_task_id == task.id,
            PutawayLocationAssignmentModel.destination_bin_id == task.destination_bin_id,
        ).with_for_update()
    )
    if existing_assignment:
        existing_assignment.quantity = Decimal(str(existing_assignment.quantity or 0)) + requested_quantity
        existing_assignment.assigned_by = user.username
        existing_assignment.assigned_at = datetime.datetime.now(datetime.timezone.utc)
    else:
        uow.session.add(PutawayLocationAssignmentModel(
            putaway_task_id=task.id,
            destination_warehouse_ref_id=task.destination_warehouse_ref_id,
            destination_zone_id=task.destination_zone_id,
            destination_bin_id=task.destination_bin_id,
            location_code=location_code,
            quantity=requested_quantity,
            assigned_by=user.username,
            assigned_at=datetime.datetime.now(datetime.timezone.utc),
        ))

    task.status = "ASSIGNED"
    task.location_assigned_by = user.username
    task.location_assigned_at = datetime.datetime.now(datetime.timezone.utc)

    # Trigger Notification for the assigned Warehouse / Warehouse Operator
    warehouse_name_disp = warehouse.warehouse_name if warehouse else "Designated Warehouse"
    warehouse_code_disp = warehouse.warehouse_code if warehouse else "WAREHOUSE_OPERATOR"

    source_label = (
        "Assembly finished goods"
        if task.finished_goods_id
        else f"GRN {task.grn_number}"
    )
    notif_msg = (
        f"Material {task.material_name} ({task.item_code}) x {requested_quantity} {task.uom} "
        f"assigned to {warehouse_name_disp} ({warehouse_code_disp}) from {source_label}."
    )
    # Warehouse-scoped notification
    if warehouse and warehouse.warehouse_code:
        uow.session.add(
            NotificationModel(
                user_role=f"WH:{warehouse.warehouse_code}"[:32],
                title=f"New Putaway Task: {task.task_number}",
                message=notif_msg,
                link=f"/inventory?task={task.id}",
                is_read=False,
            )
        )
    # Role-based notification
    uow.session.add(
        NotificationModel(
            user_role="WAREHOUSE_OPERATOR",
            title=f"New Putaway Task: {task.task_number}",
            message=notif_msg,
            link=f"/inventory?task={task.id}",
            is_read=False,
        )
    )

    await uow.session.flush()
    return task_response(task)


@router.post("/{task_id}/start")
async def start_putaway(
    task_id: str,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    task = await _resolve_task(uow.session, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Putaway task not found")
    if task.status in ("PUTAWAY_COMPLETED", "COMPLETED", "STORED"):
        raise HTTPException(status_code=409, detail="Putaway task is already completed")
    if task.status == "PUTAWAY_IN_PROGRESS":
        return task_response(task)

    roles_upper = {r.upper() for r in user.roles}
    if "WAREHOUSE_OPERATOR" in roles_upper or "WAREHOUSE_OPERATOR" in roles_upper:
        if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper and "WAREHOUSE" not in roles_upper and "WAREHOUSE_MANAGER" not in roles_upper:
            user_warehouse_ref_id = await get_user_warehouse_ref_id(user, uow)
            if user_warehouse_ref_id and task.destination_warehouse_ref_id and task.destination_warehouse_ref_id != user_warehouse_ref_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: You can only start putaway tasks assigned to your Warehouse",
                )

    task.status = "IN_PROGRESS"
    task.started_by = user.username
    task.started_at = datetime.datetime.now(datetime.timezone.utc)
    await uow.session.flush()
    return task_response(task)


@router.post("/{task_id}/complete")
async def complete_putaway(
    task_id: str,
    request: PutawayConfirmationRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    """
    Warehouse Operator confirms physical Putaway by scanning Material QR & Zone/Bin QR.
    Updates Material Stock and Inventory balances to AVAILABLE at the Warehouse, Zone, and Bin.
    """
    task = await _resolve_task(uow.session, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Putaway task not found")
    # Serialize partial confirmations for this task and reload its remaining
    # quantity after the preceding operator commits.
    locked_task = await uow.session.scalar(
        select(PutawayTaskModel)
        .where(PutawayTaskModel.id == task.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked_task is None:
        raise HTTPException(status_code=404, detail="Putaway task not found")
    task = locked_task
    confirmation_id = (request.confirmation_id or "").strip() or None
    confirmation_hash = _confirmation_digest(
        task.id,
        request.material_scan,
        request.location_scan,
        request.quantity,
    )
    if confirmation_id:
        prior_confirmation = await uow.session.scalar(
            select(PutawayMovementModel).where(PutawayMovementModel.confirmation_id == confirmation_id)
        )
        if prior_confirmation:
            if prior_confirmation.confirmation_hash != confirmation_hash:
                raise HTTPException(status_code=409, detail="Confirmation ID was already used for a different putaway scan")
            response = task_response(task)
            response["duplicate_confirmation"] = True
            response["confirmed_quantity"] = float(prior_confirmation.confirmed_quantity)
            return response
    if task.status in ("PUTAWAY_COMPLETED", "COMPLETED", "STORED"):
        raise HTTPException(status_code=409, detail="Putaway task is already completed")

    roles_upper = {r.upper() for r in user.roles}
    is_operator = bool(roles_upper.intersection({"WAREHOUSE_OPERATOR"})) or ("putaway:execute" in (user.permissions or []))
    is_finished_goods_task = bool(task.finished_goods_id)
    is_warehouse_user = bool(roles_upper.intersection({"WAREHOUSE_MANAGER", "WAREHOUSE"}))
    can_execute_finished_goods = is_finished_goods_task and is_warehouse_user

    # Warehouse users may execute only against the task's assigned warehouse/rack;
    # the strict destination-warehouse and assigned-rack checks below remain in force.
    if not is_operator and not is_warehouse_user and not can_execute_finished_goods and "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse Operators or Warehouse Operators assigned to this Warehouse can complete physical putaway",
        )

    # Warehouse isolation: Physical Putaway confirmation into a Warehouse is performed by assigned Warehouse Operator/Manager
    if task.destination_warehouse_ref_id and not is_warehouse_user and not can_execute_finished_goods and "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper:
        user_warehouse_ref_ids, user_warehouse_codes = await get_user_warehouse_context(user, uow)
        if user_warehouse_ref_ids or user_warehouse_codes:
            warehouse_match = False
            if task.destination_warehouse_ref_id in user_warehouse_ref_ids:
                warehouse_match = True
            elif task.destination_warehouse_ref_id:
                # check if destination warehouse's code matches
                st_obj = await uow.session.get(WarehouseModel, task.destination_warehouse_ref_id)
                if st_obj and st_obj.warehouse_code and st_obj.warehouse_code.strip().upper() in user_warehouse_codes:
                    warehouse_match = True
            if not warehouse_match:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot complete Putaway tasks belonging to another Warehouse",
                )

    if task.status != "IN_PROGRESS":
        if task.status in ("ASSIGNED", "ASSIGNED_TO_WAREHOUSE", "PUTAWAY_PENDING", "PENDING") and task.destination_warehouse_ref_id:
            task.status = "IN_PROGRESS"
            task.started_by = user.username
            task.started_at = datetime.datetime.now(datetime.timezone.utc)
        else:
            raise HTTPException(status_code=409, detail="Putaway task must be in progress")

    # 1. Validate Material QR
    raw_scan = request.material_scan.strip()
    scanned_hu = normalize_hu_scan(raw_scan)
    handling_unit = None
    if task.handling_unit_id:
        hu_result = await uow.session.execute(
            select(HandlingUnitModel).where(
                HandlingUnitModel.id == task.handling_unit_id,
                (HandlingUnitModel.hu_number == scanned_hu)
                | (HandlingUnitModel.barcode_value == scanned_hu)
                | (HandlingUnitModel.hu_number == raw_scan)
                | (HandlingUnitModel.barcode_value == raw_scan)
                | (HandlingUnitModel.item_code == scanned_hu)
                | (HandlingUnitModel.item_code == raw_scan),
            ).with_for_update()
        )
        handling_unit = hu_result.scalar_one_or_none()

    afg_match = False
    if getattr(task, "finished_goods_id", None):
        try:
            from app.modules.assembly.infrastructure.persistence.models import AssemblyFinishedGoodsModel
            afg = await uow.session.get(AssemblyFinishedGoodsModel, task.finished_goods_id)
            if afg:
                if (
                    raw_scan == afg.qr_code
                    or raw_scan == afg.serial_number
                    or raw_scan.upper() == afg.product_code.upper()
                    or (afg.product_code and afg.product_code.upper() in raw_scan.upper())
                    or (afg.serial_number and afg.serial_number.upper() in raw_scan.upper())
                ):
                    afg_match = True
        except Exception:
            pass

    qr_matches_task = await _material_qr_matches_task(uow.session, task, raw_scan)
    if handling_unit is None and not afg_match and not qr_matches_task:
        raise HTTPException(status_code=422, detail="Scanned Material QR does not match the putaway task")

    if handling_unit and handling_unit.status in ("QUARANTINED", "REJECTED", "DAMAGED"):
        raise HTTPException(
            status_code=409,
            detail=f"Material is {handling_unit.status.lower()} and cannot be put away into storage",
        )
    if handling_unit and task.batch_number and handling_unit.batch_number:
        if handling_unit.batch_number.strip().upper() != task.batch_number.strip().upper():
            raise HTTPException(status_code=422, detail="Scanned material batch does not match the putaway task batch")

    # 2. Validate Location / Zone / Bin Scan
    loc_scan_info = normalize_zone_scan(request.location_scan)
    scanned_bin_id = loc_scan_info.get("bin_id")
    scanned_bin_code = loc_scan_info.get("bin_code")
    scanned_zone_id = loc_scan_info.get("zone_id")
    scanned_zone_code = loc_scan_info.get("zone_code")

    target_bin: WarehouseBinModel | None = None
    target_zone: WarehouseZoneModel | None = None

    # Step A: Try resolving Bin first
    if scanned_bin_id:
        try:
            target_bin = await uow.session.get(WarehouseBinModel, uuid.UUID(scanned_bin_id))
        except (ValueError, TypeError):
            pass

    if target_bin is None and scanned_bin_code:
        bq = await uow.session.execute(
            select(WarehouseBinModel).where(func.upper(WarehouseBinModel.bin_code) == scanned_bin_code.strip().upper())
        )
        target_bin = bq.scalar_one_or_none()

    if target_bin is not None:
        target_zone = await uow.session.get(WarehouseZoneModel, target_bin.zone_id)
    else:
        # Step B: If no bin matched directly, resolve Zone
        if scanned_zone_id:
            try:
                target_zone = await uow.session.get(WarehouseZoneModel, uuid.UUID(scanned_zone_id))
            except (ValueError, TypeError):
                pass

        if target_zone is None and scanned_zone_code:
            try:
                target_zone = await uow.session.get(WarehouseZoneModel, uuid.UUID(scanned_zone_code))
            except (ValueError, TypeError):
                pass

        if target_zone is None and scanned_zone_code:
            zq = await uow.session.execute(
                select(WarehouseZoneModel).where(func.upper(WarehouseZoneModel.zone_code) == scanned_zone_code.strip().upper())
            )
            target_zone = zq.scalar_one_or_none()

        # Step C: Check if scanned value matches StorageLocationModel directly
        if target_zone is None:
            loc_match = await uow.session.execute(
                select(StorageLocationModel).where(
                    func.upper(StorageLocationModel.location_code) == request.location_scan.strip().upper()
                )
            )
            matched_loc = loc_match.scalar_one_or_none()
            if matched_loc:
                if target_bin is None and matched_loc.bin_id:
                    target_bin = await uow.session.get(WarehouseBinModel, matched_loc.bin_id)
                if target_zone is None and matched_loc.zone_id:
                    target_zone = await uow.session.get(WarehouseZoneModel, matched_loc.zone_id)
                if target_zone is None and matched_loc.zone:
                    zq = await uow.session.execute(
                        select(WarehouseZoneModel).where(func.upper(WarehouseZoneModel.zone_code) == matched_loc.zone.strip().upper())
                    )
                    target_zone = zq.scalar_one_or_none()

        if target_zone is None and not (scanned_bin_code or scanned_zone_code or scanned_bin_id or scanned_zone_id) and task.destination_zone_id:
            target_zone = await uow.session.get(WarehouseZoneModel, task.destination_zone_id)

    if target_zone is None:
        raise HTTPException(status_code=422, detail="Scanned Zone/Bin location was not found")

    if target_zone.status.upper() != "ACTIVE":
        raise HTTPException(status_code=409, detail=f"Scanned Zone '{target_zone.zone_code}' is inactive")

    # STRICT WAREHOUSE_OPERATOR + ZONE VALIDATION: Scanned Zone must belong to target Warehouse
    target_warehouse = await uow.session.get(WarehouseModel, target_zone.warehouse_ref_id)
    if target_warehouse is None:
        raise HTTPException(status_code=422, detail="Warehouse associated with target zone was not found")
    if (target_warehouse.status or "").strip().upper() != "ACTIVE":
        raise HTTPException(status_code=409, detail=f"Target Warehouse '{target_warehouse.warehouse_code}' is inactive")

    # Validate Warehouse isolation
    if task.destination_warehouse_ref_id and target_warehouse.id == task.destination_warehouse_ref_id:
        pass
    elif target_warehouse.warehouse_id and task.warehouse_id:
        st_wh = target_warehouse.warehouse_id.strip().upper().replace(" ", "").replace("_", "").replace("-", "")
        tk_wh = task.warehouse_id.strip().upper().replace(" ", "").replace("_", "").replace("-", "")
        if st_wh != tk_wh and tk_wh not in st_wh and st_wh not in tk_wh:
            raise HTTPException(
                status_code=422,
                detail=f"Warehouse '{target_warehouse.warehouse_code}' belongs to warehouse '{target_warehouse.warehouse_id}', which does not match task warehouse '{task.warehouse_id}'",
            )

    # Validate Warehouse assignment matching if task has assigned warehouse
    if task.destination_warehouse_ref_id and target_warehouse.id != task.destination_warehouse_ref_id:
        raise HTTPException(
            status_code=422,
            detail=f"Scanned location belongs to Warehouse '{target_warehouse.warehouse_code}', which does not belong to assigned destination Warehouse",
        )

    # Validate User Warehouse authorization
    if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper:
        user_warehouse_ref_ids, user_warehouse_codes = await get_user_warehouse_context(user, uow)
        if user_warehouse_ref_ids or user_warehouse_codes:
            if target_warehouse.id not in user_warehouse_ref_ids and target_warehouse.warehouse_code.upper() not in user_warehouse_codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot complete Putaway tasks into another Warehouse",
                )

    # Step C: If Bin was not explicitly scanned, locate or provision default Bin in the verified Zone
    if target_bin is None:
        bq = await uow.session.execute(
            select(WarehouseBinModel).where(
                WarehouseBinModel.zone_id == target_zone.id,
                WarehouseBinModel.status == "ACTIVE",
            ).order_by(WarehouseBinModel.bin_code.asc())
        )
        target_bin = bq.scalars().first()

    if target_bin is None:
        bin_code_clean = f"BIN-{target_zone.zone_code.replace(' ', '').upper()}-001"
        now_dt = datetime.datetime.now(datetime.timezone.utc)
        target_bin = WarehouseBinModel(
            id=uuid.uuid4(),
            warehouse_ref_id=target_zone.warehouse_ref_id,
            zone_id=target_zone.id,
            bin_code=bin_code_clean,
            bin_name=f"{target_zone.zone_name} Primary Bin",
            rack="R01",
            shelf="S01",
            capacity=Decimal("10000.0"),
            occupied_quantity=Decimal("0.0"),
            status="ACTIVE",
            created_at=now_dt,
            updated_at=now_dt,
        )
        uow.session.add(target_bin)
        await uow.session.flush()

    # The physical rack scan must match the warehouse manager's assignment.
    if task.destination_bin_id and target_bin.id != task.destination_bin_id:
        raise HTTPException(status_code=422, detail="Scanned Rack/Bin does not match the rack assigned to this putaway task")
    target_bin = await uow.session.scalar(
        select(WarehouseBinModel)
        .where(WarehouseBinModel.id == target_bin.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if target_bin is None:
        raise HTTPException(status_code=404, detail="Scanned Rack/Bin no longer exists")

    # STRICT BIN VALIDATION
    if target_bin.status.upper() not in ("ACTIVE", "AVAILABLE", "OCCUPIED", "PARTIALLY_OCCUPIED"):
        raise HTTPException(status_code=409, detail=f"Target Bin '{target_bin.bin_code}' is inactive")
    if target_bin.zone_id != target_zone.id:
        raise HTTPException(status_code=422, detail=f"Target Bin '{target_bin.bin_code}' does not belong to Zone '{target_zone.zone_code}'")
    if task.destination_warehouse_ref_id and target_bin.warehouse_ref_id != task.destination_warehouse_ref_id:
        raise HTTPException(status_code=422, detail=f"Target Bin '{target_bin.bin_code}' does not belong to assigned destination Warehouse")

    # When a task has been split, the physical scan must target one of its
    # persisted location instructions, and cannot consume more than the
    # quantity assigned to that location.
    location_assignment = await uow.session.scalar(
        select(PutawayLocationAssignmentModel).where(
            PutawayLocationAssignmentModel.putaway_task_id == task.id,
            PutawayLocationAssignmentModel.destination_bin_id == target_bin.id,
        )
    )
    if (
        location_assignment is None
        and task.destination_bin_id != target_bin.id
        and task.destination_zone_id is not None
        and task.destination_zone_id != target_zone.id
    ):
        raise HTTPException(status_code=422, detail="Scanned location is not assigned to this putaway task")

    # 3. Resolve or Create Storage Location for the Warehouse Zone + Bin
    location = None
    if task.destination_location_id:
        loc_res = await uow.session.execute(
            select(StorageLocationModel).where(StorageLocationModel.id == task.destination_location_id).with_for_update()
        )
        location = loc_res.scalar_one_or_none()

    if location is None:
        warehouse = await uow.session.get(WarehouseModel, target_zone.warehouse_ref_id)
        warehouse_code = warehouse.warehouse_code if warehouse else "WAREHOUSE_OPERATOR"
        loc_code = f"LOC-{warehouse_code}-{target_zone.zone_code}-{target_bin.bin_code}"
        loc_res = await uow.session.execute(
            select(StorageLocationModel).where(
                or_(
                    StorageLocationModel.bin_id == target_bin.id,
                    func.upper(StorageLocationModel.location_code) == loc_code.upper(),
                    StorageLocationModel.location_code == loc_code,
                )
            ).with_for_update()
        )
        location = loc_res.scalars().first()

    if location is None:
        warehouse = await uow.session.get(WarehouseModel, target_zone.warehouse_ref_id)
        warehouse_code = warehouse.warehouse_code if warehouse else "WAREHOUSE_OPERATOR"
        loc_code = f"LOC-{warehouse_code}-{target_zone.zone_code}-{target_bin.bin_code}"
        location = StorageLocationModel(
            location_code=loc_code,
            warehouse_id=task.warehouse_id,
            warehouse_ref_id=target_zone.warehouse_ref_id,
            zone_id=target_zone.id,
            bin_id=target_bin.id,
            zone=target_zone.zone_code,
            rack=target_bin.rack or "R01",
            bin=target_bin.bin_code,
            capacity=target_bin.capacity,
            occupied_quantity=target_bin.occupied_quantity,
            active=True,
        )
        uow.session.add(location)
        await uow.session.flush()

    if not location.active:
        raise HTTPException(status_code=409, detail="Assigned storage location is inactive")

    # 4. Quantity Validation
    await validate_grn_putaway_quantity(uow.session, task.grn_id, task.item_code, request.quantity)
    if request.quantity <= 0:
        raise HTTPException(status_code=422, detail="Confirmed quantity must be greater than zero")
    if request.quantity > task.quantity:
        raise HTTPException(
            status_code=422,
            detail=f"Confirmed quantity ({request.quantity}) exceeds remaining task quantity ({task.quantity} {task.uom})",
        )
    if location_assignment is not None:
        stored_at_location = await uow.session.scalar(
            select(func.coalesce(func.sum(PutawayMovementModel.confirmed_quantity), 0)).where(
                PutawayMovementModel.putaway_task_id == task.id,
                func.upper(PutawayMovementModel.location_scan) == target_bin.bin_code.upper(),
            )
        )
        assignment_remaining = Decimal(str(location_assignment.quantity or 0)) - Decimal(str(stored_at_location or 0))
        if request.quantity > assignment_remaining:
            raise HTTPException(
                status_code=422,
                detail=f"Confirmed quantity ({request.quantity}) exceeds this location assignment remainder ({assignment_remaining} {task.uom})",
            )
    await validate_rack_capacity(uow.session, target_bin, request.quantity, task.uom)
    if target_bin.occupied_quantity + request.quantity > target_bin.capacity:
        raise HTTPException(status_code=409, detail=f"Target Bin '{target_bin.bin_code}' has insufficient capacity")

    # 5. Material Stock Update (Available increments upon Putaway completion)
    stock, material = await _lock_warehouse_stock(uow.session, task.item_code, task.warehouse_id)
    if stock is None:
        stock = MaterialStockModel(
            id=uuid.uuid4(),
            material_id=material.id,
            material_code=task.item_code,
            on_hand_quantity=Decimal("0.0"),
            allocated_quantity=Decimal("0.0"),
            available_quantity=Decimal("0.0"),
            uom=task.uom or "PCS",
            warehouse_id=task.warehouse_id or "MAIN",
            updated_at=datetime.datetime.now(),
        )
        uow.session.add(stock)
        await uow.session.flush()

    completed_at = datetime.datetime.now(datetime.timezone.utc)
    available_before = stock.available_quantity
    # GRN receipt already posted accepted quantity into aggregate on-hand at
    # staging. Putaway only transfers that quantity to a final location and
    # makes it pickable. Assembly finished goods have no GRN receipt posting,
    # so their on-hand is increased here.
    if not task.grn_id:
        stock.on_hand_quantity = stock.on_hand_quantity + request.quantity
    stock.available_quantity = stock.available_quantity + request.quantity
    stock.updated_at = completed_at.replace(tzinfo=None)
    target_bin.occupied_quantity = target_bin.occupied_quantity + request.quantity
    location.occupied_quantity = location.occupied_quantity + request.quantity

    # 6. Inventory Location Balance Update
    balance_result = await uow.session.execute(
        select(InventoryLocationBalanceModel).where(
            InventoryLocationBalanceModel.material_code == task.item_code,
            InventoryLocationBalanceModel.storage_location_id == location.id,
            InventoryLocationBalanceModel.batch_number == (task.batch_number or "UNTRACKED"),
        ).with_for_update()
    )
    balance = balance_result.scalar_one_or_none()
    if balance is None:
        balance = InventoryLocationBalanceModel(
            material_code=task.item_code,
            batch_number=task.batch_number or "UNTRACKED",
            material_name=task.material_name,
            warehouse_id=task.warehouse_id,
            storage_location_id=location.id,
            quantity=0,
            available_quantity=0,
            uom=task.uom,
            last_putaway_task_id=task.id,
            last_grn_number=task.grn_number or "ASSEMBLY-FINISHED-GOODS",
            updated_at=completed_at,
        )
        uow.session.add(balance)
    balance.quantity = balance.quantity + request.quantity
    balance.available_quantity = balance.available_quantity + request.quantity
    balance.last_putaway_task_id = task.id
    balance.last_grn_number = task.grn_number or "ASSEMBLY-FINISHED-GOODS"
    balance.updated_at = completed_at

    # 7. Task and Handling Unit Completion
    task.destination_warehouse_ref_id = target_zone.warehouse_ref_id
    task.destination_zone_id = target_zone.id
    task.destination_zone = target_zone.zone_code
    task.destination_bin_id = target_bin.id
    task.destination_bin = target_bin.bin_code
    task.destination_bin_code = target_bin.bin_code
    task.destination_location_id = location.id

    remaining_task_qty = task.quantity - request.quantity
    if remaining_task_qty <= 0:
        task.placement_metadata = {**(task.placement_metadata or {}), "putaway_quantity": float(request.quantity)}
        task.quantity = Decimal("0")
        task.status = "COMPLETED"
        task.completed_by = user.username
        task.completed_at = completed_at
    else:
        task.quantity = remaining_task_qty
        task.status = "PARTIALLY_COMPLETED"
        task.started_by = task.started_by or user.username
        task.started_at = task.started_at or completed_at

    if handling_unit:
        dest_display = f"{target_zone.zone_code} / {target_bin.bin_code}"
        handling_unit.current_location = dest_display
        if remaining_task_qty <= 0:
            handling_unit.status = "STORED"
        handling_unit.updated_at = completed_at

    material_scan_record = (request.material_scan.strip() or scanned_hu)[:64]
    location_scan_record = (target_bin.bin_code or target_zone.zone_code or request.location_scan.strip())[:64]

    dest_loc_str = location.location_code if location else (f"{target_zone.zone_code} / {target_bin.bin_code}" if target_zone and target_bin else "STORAGE")
    src_loc_str = getattr(task, "source_location", None) or "RECEIVING_DOCK"
    uow.session.add(
        PutawayMovementModel(
            confirmation_id=confirmation_id,
            confirmation_hash=confirmation_hash if confirmation_id else None,
            putaway_task_id=task.id,
            material_scan=material_scan_record,
            location_scan=location_scan_record,
            material_code=task.item_code,
            material_name=getattr(task, "material_name", None) or task.item_code,
            source_location=src_loc_str,
            destination_location=dest_loc_str,
            batch_lot=task.batch_number or "UNTRACKED",
            confirmed_quantity=request.quantity,
            uom=task.uom,
            inventory_available_before=available_before,
            inventory_available_after=stock.available,
            confirmed_by=user.username,
            confirmed_at=completed_at,
        )
    )
    uow.session.add(
        InventoryMovementHistoryModel(
            movement_type="PUTAWAY",
            material_code=task.item_code,
            material_name=getattr(task, "material_name", None) or task.item_code,
            material_qr=material_scan_record,
            grn_number=task.grn_number,
            batch_lot=task.batch_number or "UNTRACKED",
            from_location=src_loc_str,
            to_location=dest_loc_str,
            from_bin_id=None,
            to_bin_id=target_bin.id if target_bin else None,
            quantity=request.quantity,
            uom=task.uom or "PCS",
            stock_before=available_before,
            stock_after=stock.available,
            performed_by=user.username,
            user_role=",".join(user.roles or []),
            warehouse_id=task.warehouse_id,
            warehouse_ref_id=target_zone.warehouse_ref_id if target_zone else None,
            warehouse_code=target_warehouse.warehouse_code if target_warehouse else None,
            reference_document=task.task_number,
            remarks=f"Putaway confirmed into {dest_loc_str}",
            performed_at=completed_at,
        )
    )

    if getattr(task, "finished_goods_id", None):
        try:
            await _sync_finished_goods_putaway_status(uow, task.finished_goods_id, dest_loc_str, user.username, completed_at)
        except Exception as e:
            logger.warning(f"Failed to update linked Assembly order on putaway complete: {e}")

    await uow.session.flush()

    response = task_response(task)
    response["inventory_available_before"] = float(available_before)
    response["inventory_available_after"] = float(stock.available)
    return response


@router.post("/resolve-grn-qr")
async def resolve_grn_qr(
    request: ResolveGrnQrRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    raw_code = (request.qr_code or "").strip()
    if not raw_code:
        raise HTTPException(status_code=422, detail="GRN Material QR code is required")

    # Assembly finished goods are produced internally and therefore do not
    # have a supplier GRN. Resolve their Assembly QR directly to the FG
    # posting and its Finished Goods Warehouse putaway task.
    if raw_code.upper().startswith("FG-QR|") or raw_code.upper().startswith("FG-"):
        from app.modules.assembly.infrastructure.persistence.models import AssemblyFinishedGoodsModel

        # Prefer the individual unit task QR. Unit QRs are stored in task
        # placement metadata so one Assembly posting can safely own many
        # independently putaway-able units.
        unit_task = None
        active_fg_tasks = (await uow.session.execute(select(PutawayTaskModel).where(
            PutawayTaskModel.finished_goods_id.is_not(None),
            PutawayTaskModel.status.in_(["OPEN", "PENDING", "IN_PROGRESS", "ASSIGNED", "DRAFT", "PUTAWAY_IN_PROGRESS"]),
        ))).scalars().all()
        for candidate in active_fg_tasks:
            if (candidate.placement_metadata or {}).get("unit_qr", "").upper() == raw_code.upper():
                unit_task = candidate
                break

        fg_query = select(AssemblyFinishedGoodsModel).where(
            or_(
                func.upper(AssemblyFinishedGoodsModel.qr_code) == raw_code.upper(),
                func.upper(AssemblyFinishedGoodsModel.serial_number) == raw_code.upper(),
            )
        )
        fg = (await uow.session.execute(fg_query)).scalars().first()
        if not fg and unit_task:
            fg = await uow.session.get(AssemblyFinishedGoodsModel, unit_task.finished_goods_id)
        if not fg:
            parts = raw_code.split("|")
            product_code = parts[1].strip().upper() if len(parts) > 1 else ""
            product_code = product_code or raw_code.upper()
            product_codes = {product_code}
            if product_code.startswith("FG-"):
                product_codes.add(product_code[3:])
            serial = next((part[4:] for part in parts if part.upper().startswith("SN:")), "")
            if product_codes:
                fg = (await uow.session.execute(select(AssemblyFinishedGoodsModel).where(
                    func.upper(AssemblyFinishedGoodsModel.product_code).in_(product_codes),
                    func.upper(AssemblyFinishedGoodsModel.serial_number) == serial.upper() if serial else True,
                ).order_by(AssemblyFinishedGoodsModel.updated_at.desc()))).scalars().first()
        if not fg:
            raise HTTPException(status_code=404, detail="Finished Goods QR was not found in Assembly postings")

        fg_task = unit_task or (await uow.session.execute(select(PutawayTaskModel).where(
            PutawayTaskModel.finished_goods_id == fg.id,
            PutawayTaskModel.status.in_(["OPEN", "PENDING", "IN_PROGRESS", "ASSIGNED", "DRAFT", "PUTAWAY_IN_PROGRESS"]),
        ).order_by(PutawayTaskModel.created_at.desc()))).scalars().first()
        if not fg_task:
            raise HTTPException(status_code=409, detail="No active Finished Goods Putaway task exists for this QR")

        movement_total = await uow.session.scalar(select(func.coalesce(
            func.sum(PutawayMovementModel.confirmed_quantity), 0
        )).where(PutawayMovementModel.putaway_task_id == fg_task.id)) or Decimal("0")
        is_unit_task = bool((fg_task.placement_metadata or {}).get("unit_qr"))
        received_qty = Decimal(str(fg_task.quantity if is_unit_task else (fg.quantity or fg_task.quantity or 0)))
        already_put_away = Decimal(str(movement_total))
        available_qty = max(Decimal("0"), received_qty - already_put_away)
        if available_qty <= 0:
            raise HTTPException(status_code=422, detail="Finished Goods QR has already been completely put away")

        fg_warehouse = await uow.session.get(WarehouseModel, fg_task.destination_warehouse_ref_id) if fg_task.destination_warehouse_ref_id else None
        if not fg_warehouse or (fg_warehouse.warehouse_code or "").upper() != "STR-FG":
            fg_warehouse = (await uow.session.execute(
                select(WarehouseModel).where(
                    or_(
                        func.upper(WarehouseModel.warehouse_code) == "STR-FG",
                        func.upper(WarehouseModel.warehouse_name) == "FINISHED GOODS WAREHOUSE_OPERATOR",
                    ),
                    WarehouseModel.status == "ACTIVE",
                ).order_by(WarehouseModel.created_at.asc())
            )).scalars().first()
        if fg_warehouse and not fg_task.destination_bin_code:
            fg_zone = (await uow.session.execute(
                select(WarehouseZoneModel).where(
                    WarehouseZoneModel.warehouse_ref_id == fg_warehouse.id,
                    WarehouseZoneModel.status == "ACTIVE",
                ).order_by(WarehouseZoneModel.created_at.asc())
            )).scalars().first()
            fg_bin = (await uow.session.execute(
                select(WarehouseBinModel).where(
                    WarehouseBinModel.warehouse_ref_id == fg_warehouse.id,
                    WarehouseBinModel.status == "ACTIVE",
                ).order_by(WarehouseBinModel.created_at.asc())
            )).scalars().first()
            if fg_bin:
                fg_task.destination_warehouse_ref_id = fg_warehouse.id
                fg_task.destination_zone_id = fg_zone.id if fg_zone else fg_bin.zone_id
                fg_task.destination_zone = fg_zone.zone_code if fg_zone else None
                fg_task.destination_bin_id = fg_bin.id
                fg_task.destination_bin = fg_bin.bin_code
                fg_task.destination_bin_code = fg_bin.bin_code
                await uow.session.flush()
        return {
            "valid": True,
            "material_code": fg.product_code,
            "material_name": fg.product_name,
            "material_description": fg.product_name,
            "material_variant": "Finished Goods",
            "material_category": "Finished Goods",
            "grn_number": None,
            "grn_id": None,
            "source_type": "ASSEMBLY_FINISHED_GOODS",
            "source_reference": fg_task.task_number,
            "po_number": "N/A",
            "asn_number": "N/A",
            "batch_lot_number": None,
            "received_quantity": float(received_qty),
            "already_put_away_quantity": float(already_put_away),
            "available_quantity": float(available_qty),
            "uom": fg.uom or fg_task.uom or "PCS",
            "supplier_name": "Assembly",
            "warehouse_id": fg.warehouse_id or fg_task.warehouse_id,
            "warehouse_ref_id": str(fg_task.destination_warehouse_ref_id) if fg_task.destination_warehouse_ref_id else None,
            "warehouse_name": fg_warehouse.warehouse_name if fg_warehouse else None,
            "warehouse_code": fg_warehouse.warehouse_code if fg_warehouse else None,
            "destination_zone": fg_task.destination_zone,
            "destination_bin": fg_task.destination_bin,
            "destination_bin_code": fg_task.destination_bin_code,
            "current_location": fg.location_code or fg_task.source_location or "ASSEMBLY_LINE",
            "putaway_task_id": str(fg_task.id),
            "putaway_status": fg_task.status,
            "handling_unit_id": None,
            "qr_code": raw_code,
        }

    item_code: str | None = None
    grn_number: str | None = None
    batch_number: str | None = request.batch_number.strip() if request.batch_number else None
    hu_number: str | None = None

    # Batch QR identifiers are deterministic and contain the persisted batch
    # number. Resolve them through GRN batch records first so lookup does not
    # depend on a legacy material-level QR row.
    if raw_code.upper().startswith("QR-BATCH-"):
        batch_number = raw_code[len("QR-BATCH-"):].strip()
        batch_result = await uow.session.execute(
            select(GrnBatchModel).where(
                func.upper(GrnBatchModel.batch_number) == batch_number.upper(),
                GrnBatchModel.superseded.is_(False),
            )
        )
        batch_obj = batch_result.scalars().first()
        if batch_obj:
            line_obj = await uow.session.get(GrnLineModel, batch_obj.grn_line_id)
            if line_obj:
                item_code = line_obj.item_code
                grn_obj = await uow.session.get(GrnModel, line_obj.grn_id)
                if grn_obj:
                    grn_number = grn_obj.grn_number

    # Step 1: Parse JSON QR payload if applicable
    if (raw_code.startswith("{") and raw_code.endswith("}")) or (raw_code.startswith('"{') and raw_code.endswith('}"')):
        try:
            unquoted = raw_code[1:-1] if raw_code.startswith('"{') else raw_code
            payload = json.loads(unquoted)
            if isinstance(payload, dict):
                item_code = payload.get("item_code") or payload.get("material_code") or payload.get("code")
                grn_number = payload.get("grn_number") or payload.get("grn_no") or payload.get("grn")
                batch_number = payload.get("batch_number") or payload.get("batch_no") or payload.get("batch")
                hu_number = payload.get("hu_number") or payload.get("handling_unit") or payload.get("barcode_value")
        except Exception:
            pass

    # GRN batch labels generated by the web client use a readable key/value
    # payload rather than JSON. Parse downloaded/scanned labels so the exact
    # completed GRN batch can be linked to its putaway task.
    if not item_code or not grn_number or not batch_number:
        text_fields: dict[str, str] = {}
        for payload_line in raw_code.splitlines():
            key, separator, value = payload_line.partition(":")
            if separator:
                text_fields[key.strip().lower().replace(" ", "_")] = value.strip()
        # A QR scanner writing into a single-line HTML input removes CR/LF
        # characters from the readable label payload. Recover fields using
        # the known labels as boundaries (for example
        # "GRN Number: ...Supplier: ...Material Code: ...").
        if len(text_fields) <= 1:
            labels = (
                "GRN Number", "GRN No", "Supplier", "Warehouse", "Dock", "Vehicle",
                "Driver", "Material Code", "Item Code", "Material Name",
                "Material Category", "Material Variant Code", "Batch Number", "Batch",
                "Size", "Color", "Grade", "UOM", "QA Status", "Inspection Status",
                "Batch Quantity",
            )
            label_pattern = "|".join(re.escape(label) for label in labels)
            for match in re.finditer(
                rf"({label_pattern})\s*:\s*(.*?)(?=(?:{label_pattern})\s*:|$)",
                raw_code,
                flags=re.IGNORECASE | re.DOTALL,
            ):
                text_fields[match.group(1).strip().lower().replace(" ", "_")] = (
                    match.group(2).strip()
                )
        item_code = item_code or text_fields.get("material_code") or text_fields.get("item_code")
        grn_number = grn_number or text_fields.get("grn_number") or text_fields.get("grn_no")
        batch_number = batch_number or text_fields.get("batch") or text_fields.get("batch_number")

    # Step 2: Match GrnBatchQrModel
    if not item_code:
        res_bqr = await uow.session.execute(
            select(GrnBatchQrModel).where(
                or_(
                    GrnBatchQrModel.qr_code == raw_code,
                    GrnBatchQrModel.item_code.ilike(raw_code),
                )
            )
        )
        b_qr = res_bqr.scalars().first()
        if b_qr:
            item_code = b_qr.item_code
            if b_qr.qr_payload:
                try:
                    payload = json.loads(b_qr.qr_payload)
                    if isinstance(payload, dict):
                        grn_number = grn_number or payload.get("grn_number")
                        batch_number = batch_number or payload.get("batch_number")
                except Exception:
                    # GRN batch labels are also emitted as human-readable
                    # key/value text. Extract the batch identity from that
                    # payload instead of resolving only the material code.
                    for payload_line in b_qr.qr_payload.splitlines():
                        key, separator, value = payload_line.partition(":")
                        if separator and key.strip().lower() in {"batch", "batch number", "batch_number"}:
                            batch_number = batch_number or value.strip()

    # Step 3: Match HandlingUnitModel
    hu_obj: HandlingUnitModel | None = None
    if not item_code or not grn_number:
        res_hu = await uow.session.execute(
            select(HandlingUnitModel).where(
                or_(
                    HandlingUnitModel.barcode_value == raw_code,
                    HandlingUnitModel.hu_number == raw_code,
                    HandlingUnitModel.barcode_value.ilike(raw_code),
                    HandlingUnitModel.hu_number.ilike(raw_code),
                )
            )
        )
        hu_obj = res_hu.scalars().first()
        if hu_obj:
            item_code = item_code or hu_obj.item_code
            grn_number = grn_number or hu_obj.grn_number
            batch_number = batch_number or hu_obj.batch_number
            hu_number = hu_number or hu_obj.hu_number

    # Step 4: Check QR-MAT- prefix or clean item_code
    if not item_code:
        if raw_code.upper().startswith("QR-MAT-"):
            item_code = raw_code[7:].strip()
        elif raw_code.upper().startswith("MAT-") or raw_code.upper().startswith("RM-") or raw_code.upper().startswith("RAW-"):
            item_code = raw_code.strip()

    # Step 5: Match GrnBatchModel directly
    if not item_code:
        res_batch = await uow.session.execute(
            select(GrnBatchModel).where(func.upper(GrnBatchModel.batch_number) == raw_code.upper())
        )
        batch_obj = res_batch.scalars().first()
        if batch_obj:
            batch_number = batch_obj.batch_number
            res_line = await uow.session.execute(select(GrnLineModel).where(GrnLineModel.id == batch_obj.grn_line_id))
            line_obj = res_line.scalar_one_or_none()
            if line_obj:
                item_code = line_obj.item_code
                grn_obj = await uow.session.get(GrnModel, line_obj.grn_id)
                if grn_obj:
                    grn_number = grn_obj.grn_number

    # Step 6: Match PutawayTaskModel
    task_obj: PutawayTaskModel | None = None
    if not item_code:
        res_pt = await uow.session.execute(
            select(PutawayTaskModel).where(
                or_(
                    PutawayTaskModel.task_number.ilike(raw_code),
                    PutawayTaskModel.item_code.ilike(raw_code),
                    PutawayTaskModel.grn_number.ilike(raw_code),
                )
            )
        )
        task_obj = res_pt.scalars().first()
        if task_obj:
            item_code = task_obj.item_code
            grn_number = grn_number or task_obj.grn_number

    if not item_code:
        raise HTTPException(
            status_code=404,
            detail=f"QR Code '{raw_code}' could not be resolved to any GRN material. Please ensure you are scanning a valid GRN material QR.",
        )

    # Resolve GRN & Line
    grn_line: GrnLineModel | None = None
    grn: GrnModel | None = None

    if grn_number:
        res_grn = await uow.session.execute(select(GrnModel).where(func.upper(GrnModel.grn_number) == grn_number.upper()))
        grn = res_grn.scalar_one_or_none()

    if grn and item_code:
        res_line = await uow.session.execute(
            select(GrnLineModel).where(GrnLineModel.grn_id == grn.id, func.upper(GrnLineModel.item_code) == item_code.upper())
        )
        grn_line = res_line.scalars().first()

    if grn_line is None:
        # First check if there is an active/pending Putaway Task for this material in user's warehouse context
        user_warehouse_ref_ids, user_warehouse_codes = await get_user_warehouse_context(user, uow)
        pt_query = select(PutawayTaskModel).where(
            func.upper(PutawayTaskModel.item_code) == item_code.upper(),
            PutawayTaskModel.status.in_(["PENDING", "IN_PROGRESS", "ASSIGNED", "DRAFT", "OPEN", "ASSIGNED_TO_WAREHOUSE", "PUTAWAY_IN_PROGRESS"])
        )
        if batch_number:
            pt_query = pt_query.where(func.upper(PutawayTaskModel.batch_number) == batch_number.upper())
        if user_warehouse_ref_ids:
            pt_query = pt_query.where(PutawayTaskModel.destination_warehouse_ref_id.in_(user_warehouse_ref_ids))
        pt_query = pt_query.order_by(PutawayTaskModel.created_at.desc())
        
        pt_res = await uow.session.execute(pt_query)
        active_task = pt_res.scalars().first()
        if active_task:
            task_obj = active_task
            grn_number = active_task.grn_number
            if active_task.grn_id:
                grn = await uow.session.get(GrnModel, active_task.grn_id)
            elif grn_number:
                res_grn = await uow.session.execute(select(GrnModel).where(func.upper(GrnModel.grn_number) == grn_number.upper()))
                grn = res_grn.scalar_one_or_none()
            if grn:
                res_line = await uow.session.execute(
                    select(GrnLineModel).where(GrnLineModel.grn_id == grn.id, func.upper(GrnLineModel.item_code) == item_code.upper())
                )
                grn_line = res_line.scalars().first()

    if grn_line is None:
        res_line = await uow.session.execute(
            select(GrnLineModel)
            .join(GrnModel, GrnLineModel.grn_id == GrnModel.id)
            .where(func.upper(GrnLineModel.item_code) == item_code.upper())
            .order_by(GrnModel.created_at.desc())
        )
        grn_line = res_line.scalars().first()
        if grn_line:
            grn = await uow.session.get(GrnModel, grn_line.grn_id)

    # A shared material QR can identify an item that has several batches. Do
    # not silently assign a random batch; ask the operator to scan a
    # batch-specific label or provide the batch number explicitly.
    if grn_line and not batch_number:
        batch_rows = (await uow.session.execute(
            select(GrnBatchModel).where(GrnBatchModel.grn_line_id == grn_line.id)
        )).scalars().all()
        if len(batch_rows) > 1:
            raise HTTPException(status_code=422, detail="This material QR is shared across multiple batches; scan a batch label or enter the batch number")
        if len(batch_rows) == 1:
            batch_number = batch_rows[0].batch_number

    if grn is None:
        raise HTTPException(
            status_code=404,
            detail=f"No Goods Receipt Note (GRN) found for Material '{item_code}'. The material must be received and processed through GRN before Putaway.",
        )

    # Validate GRN Status
    grn_st = (grn.status or "").upper()
    if grn_st in ["DRAFT", "CANCELLED", "REJECTED"]:
        raise HTTPException(
            status_code=422,
            detail=f"GRN '{grn.grn_number}' status is {grn.status}. Material has not been received or completed yet.",
        )

    # Locate the task for the exact batch. A GRN can contain multiple batches
    # of the same material, and selecting only by material would keep resolving
    # the first batch after it had already been put away.
    task_query = select(PutawayTaskModel).where(
        PutawayTaskModel.grn_id == grn.id,
        func.upper(PutawayTaskModel.item_code) == item_code.upper(),
    )
    if batch_number:
        task_query = task_query.where(
            func.upper(PutawayTaskModel.batch_number) == str(batch_number).upper()
        )
    task_query = task_query.order_by(PutawayTaskModel.created_at.desc())
    batch_task = (await uow.session.execute(task_query)).scalars().first()
    if batch_task is not None:
        task_obj = batch_task

    # Normal GRN putaway tasks are batch-specific. A material-level QR such
    # as QR-MAT-MAT-LSE-022 is not sufficient because another lot of the same
    # material could otherwise be stored against this task.
    required_batch = str(task_obj.batch_number or "").strip() if task_obj else ""
    resolved_batch = str(batch_number or "").strip()
    if required_batch and (
        raw_code.upper().startswith("QR-MAT-")
        or resolved_batch.upper() != required_batch.upper()
    ):
        raise HTTPException(
            status_code=422,
            detail=f"Material QR must identify batch '{required_batch}'. Scan the QR label for that exact GRN batch.",
        )

    # Calculate quantities. A batch QR represents only that batch, not the
    # entire GRN line (for example, 25 of a 100-unit receipt).
    scanned_batch = None
    if batch_number and grn_line:
        batch_result = await uow.session.execute(
            select(GrnBatchModel).where(
                GrnBatchModel.grn_line_id == grn_line.id,
                func.upper(GrnBatchModel.batch_number) == batch_number.upper(),
            )
        )
        scanned_batch = batch_result.scalars().first()

    if grn_line:
        received_qty = Decimal(str(grn_line.good_quantity if grn_line.good_quantity and grn_line.good_quantity > 0 else (grn_line.received_quantity or 0)))
    elif hu_obj:
        received_qty = Decimal(str(hu_obj.quantity))
    elif task_obj:
        received_qty = Decimal(str(task_obj.quantity))
    else:
        received_qty = Decimal("0")

    if scanned_batch is not None:
        received_qty = Decimal(str(scanned_batch.batch_quantity))

    # Sum already put away quantity
    mov_stmt = (
        select(func.coalesce(func.sum(PutawayMovementModel.confirmed_quantity), 0))
        .join(PutawayTaskModel, PutawayMovementModel.putaway_task_id == PutawayTaskModel.id)
        .where(
            PutawayTaskModel.item_code == item_code,
            or_(PutawayTaskModel.grn_id == grn.id, PutawayTaskModel.grn_number == grn.grn_number),
        )
    )
    if batch_number:
        mov_stmt = mov_stmt.where(func.upper(PutawayTaskModel.batch_number) == batch_number.upper())
    mov_res = await uow.session.execute(mov_stmt)
    already_put_away = Decimal(str(mov_res.scalar() or 0))

    if already_put_away == 0 and grn.grn_number:
        hist_stmt = select(func.coalesce(func.sum(InventoryMovementHistoryModel.quantity), 0)).where(
            InventoryMovementHistoryModel.movement_type == "PUTAWAY",
            InventoryMovementHistoryModel.grn_number == grn.grn_number,
            InventoryMovementHistoryModel.material_code == item_code,
        )
        hist_res = await uow.session.execute(hist_stmt)
        already_put_away = Decimal(str(hist_res.scalar() or 0))

    available_qty = max(Decimal("0"), received_qty - already_put_away)

    if task_obj and task_obj.quantity > 0 and available_qty == 0:
        available_qty = Decimal(str(task_obj.quantity))

    if available_qty <= 0:
        raise HTTPException(
            status_code=422,
            detail=f"Material '{item_code}' from GRN '{grn.grn_number}' has already been completely put away (Received: {received_qty}, Already Put Away: {already_put_away}, Available: 0).",
        )

    # Fetch Material Master info if available
    mat_name = (grn_line.material_name if grn_line and grn_line.material_name else None) or (task_obj.material_name if task_obj else item_code)
    mat_cat = (grn_line.material_category if grn_line and grn_line.material_category else None) or (task_obj.material_category if task_obj else "Raw Material")
    variant_code = getattr(grn_line, "variant_code", None) if grn_line else None
    uom = (grn_line.uom if grn_line and grn_line.uom else None) or (task_obj.uom if task_obj else "PCS")

    # Fetch Dock & Warehouse Operator details
    gate_entry_no = grn.gate_entry_number
    truck_no = grn.vehicle_number
    asn_no = grn.asn_number or (hu_obj.asn_number if hu_obj else None)
    po_no = grn.po_number or (hu_obj.po_number if hu_obj else None)
    supplier_name = grn.supplier_name or grn.supplier_company_name
    warehouse_id = grn.warehouse_id or (task_obj.warehouse_id if task_obj else None)
    dock_code = grn.dock_number or (task_obj.source_location if task_obj else "RECEIVING_DOCK")
    assigned_sm = task_obj.assigned_to if task_obj else None
    dest_warehouse_ref_id = str(task_obj.destination_warehouse_ref_id) if task_obj and task_obj.destination_warehouse_ref_id else None
    warehouse_name = None
    warehouse_code = None

    # Match dock assignment for this gate entry / vehicle
    clauses = []
    if gate_entry_no:
        clauses.append(DockAssignmentModel.gate_entry_id == gate_entry_no if isinstance(gate_entry_no, uuid.UUID) else None)
    if truck_no:
        clauses.append(DockAssignmentModel.vehicle_number == truck_no)
    valid_clauses = [c for c in clauses if c is not None]
    if valid_clauses:
        da_res = await uow.session.execute(
            select(DockAssignmentModel)
            .where(or_(*valid_clauses))
            .order_by(DockAssignmentModel.assigned_at.desc())
        )
        da = da_res.scalars().first()
        if da:
            if da.assigned_warehouse_operator_name or da.assigned_warehouse_operator_username:
                assigned_sm = da.assigned_warehouse_operator_name or da.assigned_warehouse_operator_username
            if da.dock_number:
                dock_code = da.dock_number

    if task_obj and task_obj.destination_warehouse_ref_id:
        warehouse_obj = await uow.session.get(WarehouseModel, task_obj.destination_warehouse_ref_id)
        if warehouse_obj:
            warehouse_name = warehouse_obj.warehouse_name
            warehouse_code = warehouse_obj.warehouse_code
            if not assigned_sm:
                assigned_sm = warehouse_obj.warehouse_operator_name

    return {
        "valid": True,
        "material_code": item_code,
        "material_name": mat_name,
        "material_description": f"{mat_name} ({mat_cat})",
        "material_variant": variant_code or "Standard",
        "material_category": mat_cat,
        "grn_number": grn.grn_number,
        "grn_id": str(grn.id),
        "po_number": po_no or "N/A",
        "asn_number": asn_no or "N/A",
        "batch_lot_number": batch_number,
        "batch_quantity": float(scanned_batch.batch_quantity) if scanned_batch else None,
        "received_quantity": float(received_qty),
        "already_put_away_quantity": float(already_put_away),
        "available_quantity": float(available_qty),
        "uom": uom,
        "supplier_name": supplier_name,
        "warehouse_id": warehouse_id or (task_obj.warehouse_id if task_obj else None),
        "warehouse_ref_id": dest_warehouse_ref_id,
        "warehouse_name": warehouse_name,
        "warehouse_code": warehouse_code,
        "gate_entry_number": gate_entry_no or "N/A",
        "truck_number": truck_no or "N/A",
        "dock_code": dock_code,
        "assigned_dock": dock_code,
        "assigned_warehouse_operator": assigned_sm,
        "putaway_task_id": str(task_obj.id) if task_obj else None,
        "putaway_status": task_obj.status if task_obj else ("COMPLETED" if available_qty == 0 else ("IN_PROGRESS" if already_put_away > 0 else "READY_FOR_PUTAWAY")),
        "handling_unit_id": str(hu_obj.id) if hu_obj else None,
        "qr_code": raw_code,
    }


@router.post("/resolve-finished-goods-qr")
async def resolve_finished_goods_qr(
    request: ResolveGrnQrRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    """Resolve an Assembly finished-goods QR without any GRN relationship."""
    raw_code = (request.qr_code or "").strip()
    if not raw_code.upper().startswith("FG-QR|") and not raw_code.upper().startswith("FG-"):
        raise HTTPException(status_code=422, detail="Scan a valid Assembly finished-goods QR code.")
    return await resolve_grn_qr(request, user=user, uow=uow)


@router.post("/resolve-bin-qr")
async def resolve_bin_qr(
    request: ResolveBinQrRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    raw_scan = (request.bin_scan or request.bin_qr_code or request.qr_code or "").strip()
    if not raw_scan:
        raise HTTPException(status_code=422, detail="Bin scan value is required")

    bin_obj: WarehouseBinModel | None = None
    target_zone: WarehouseZoneModel | None = None
    target_warehouse: WarehouseModel | None = None

    hyphen_scan = raw_scan.replace(" ", "-").replace("_", "-")
    # The printed Warehouse label contains qr_identifier, not just bin_code.
    # Resolve the persisted identifier first so repeated bin codes across warehouses
    # cannot select an unrelated destination.
    qr_result = await uow.session.execute(
        select(WarehouseBinModel).where(
            func.upper(WarehouseBinModel.qr_identifier) == raw_scan.upper()
        )
    )
    bin_obj = qr_result.scalar_one_or_none()

    # Step 1: Check JSON
    if bin_obj is None and ((raw_scan.startswith("{") and raw_scan.endswith("}")) or (raw_scan.startswith('"{') and raw_scan.endswith('}"'))):
        try:
            unquoted = raw_scan[1:-1] if raw_scan.startswith('"{') else raw_scan
            payload = json.loads(unquoted)
            if isinstance(payload, dict):
                bin_id = payload.get("bin_id") or payload.get("id")
                bin_code = payload.get("bin_code") or payload.get("code")
                if bin_id:
                    try:
                        bin_obj = await uow.session.get(WarehouseBinModel, uuid.UUID(bin_id))
                    except Exception:
                        pass
                if not bin_obj and bin_code:
                    bq = await uow.session.execute(select(WarehouseBinModel).where(func.upper(WarehouseBinModel.bin_code) == bin_code.strip().upper()))
                    bin_obj = bq.scalar_one_or_none()
        except Exception:
            pass

    # Step 2: Try UUID lookup
    if bin_obj is None:
        try:
            bin_obj = await uow.session.get(WarehouseBinModel, uuid.UUID(raw_scan))
        except (ValueError, TypeError):
            pass

    # Step 3: Try exact and cleaned bin_code lookup
    if bin_obj is None:
        cand_code = raw_scan
        if cand_code.upper().startswith("BIN-QR-") or cand_code.upper().startswith("QR-BIN-") or cand_code.upper().startswith("QR-") or cand_code.upper().startswith("QR "):
            cand_code = cand_code.split("-", 2)[-1] if "-" in cand_code else (cand_code.split(" ", 1)[-1] if " " in cand_code else cand_code)
        cand_hyphen = cand_code.replace(" ", "-").replace("_", "-")

        bq = await uow.session.execute(
            select(WarehouseBinModel).where(
                or_(
                    func.upper(WarehouseBinModel.bin_code) == raw_scan.upper(),
                    func.upper(WarehouseBinModel.bin_code) == cand_code.upper(),
                    WarehouseBinModel.bin_code.ilike(f"%{cand_code}%"),
                )
            )
        )
        bin_obj = bq.scalars().first()

    # Step 4: StorageLocationModel fallback
    if bin_obj is None:
        loc_res = await uow.session.execute(
            select(StorageLocationModel).where(
                func.upper(StorageLocationModel.location_code) == raw_scan.upper()
            )
        )
        loc = loc_res.scalar_one_or_none()
        if loc and loc.bin_id:
            bin_obj = await uow.session.get(WarehouseBinModel, loc.bin_id)

    if bin_obj is None:
        raise HTTPException(
            status_code=404,
            detail=f"Bin QR code '{raw_scan}' was not found. Please scan a valid destination Bin QR.",
        )

    # Validate active
    if (bin_obj.status or "").upper() not in ("ACTIVE", "AVAILABLE", "OCCUPIED", "PARTIALLY_OCCUPIED"):
        raise HTTPException(
            status_code=409,
            detail=f"Destination Bin '{bin_obj.bin_code}' is {bin_obj.status} and cannot receive materials.",
        )

    target_zone = await uow.session.get(WarehouseZoneModel, bin_obj.zone_id) if bin_obj.zone_id else None
    target_warehouse = await uow.session.get(WarehouseModel, bin_obj.warehouse_ref_id) if bin_obj.warehouse_ref_id else None

    # Check warehouse_ref_id filter if passed. API clients commonly send UUIDs as
    # strings; normalize before comparing with the database UUID value.
    requested_warehouse_ref_id = _parse_uuid(request.warehouse_ref_id)
    if request.warehouse_ref_id and requested_warehouse_ref_id and bin_obj.warehouse_ref_id != requested_warehouse_ref_id:
        raise HTTPException(
            status_code=422,
            detail=f"Bin '{bin_obj.bin_code}' belongs to warehouse '{target_warehouse.warehouse_code if target_warehouse else bin_obj.warehouse_ref_id}', which does not match the required warehouse.",
        )

    # Check user authorization
    roles_upper = {r.upper() for r in (user.roles or [])}
    if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper and target_warehouse:
        user_warehouse_ref_ids, user_warehouse_codes = await get_user_warehouse_context(user, uow)
        if user_warehouse_ref_ids or user_warehouse_codes:
            if target_warehouse.id not in user_warehouse_ref_ids and target_warehouse.warehouse_code.upper() not in user_warehouse_codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Unauthorized: You are assigned to warehouse '{', '.join(user_warehouse_codes)}', but bin '{bin_obj.bin_code}' belongs to warehouse '{target_warehouse.warehouse_code}'.",
                )

    # Assembly picks update the physical balances and shared rack counter.
    # Legacy bin/location counters can lag; never use them for a managed rack QR.
    rack = await get_rack_capacity(uow.session, bin_obj)
    capacity = float(rack.maximum_capacity if rack else (bin_obj.capacity or 0))
    occupied = float(rack.occupied_quantity if rack else (bin_obj.occupied_quantity or 0))
    avail_cap = max(0.0, capacity - occupied)
    pct = round((occupied / capacity) * 100, 1) if capacity > 0 else 0.0

    return {
        "valid": True,
        "bin_id": str(bin_obj.id),
        "bin_code": bin_obj.bin_code,
        "bin_name": bin_obj.bin_name or f"Bin {bin_obj.bin_code}",
        "zone_id": str(target_zone.id) if target_zone else None,
        "zone_code": target_zone.zone_code if target_zone else "General Zone",
        "zone_name": target_zone.zone_name if target_zone else "General Zone",
        "rack": bin_obj.rack or "R01",
        "shelf": bin_obj.shelf or "S01",
        "warehouse_ref_id": str(target_warehouse.id) if target_warehouse else None,
        "warehouse_code": target_warehouse.warehouse_code if target_warehouse else "WAREHOUSE_OPERATOR",
        "warehouse_name": target_warehouse.warehouse_name if target_warehouse else "Warehouse",
        "warehouse_id": target_warehouse.warehouse_id if target_warehouse else "MAIN",
        "capacity": capacity,
        "occupied_quantity": occupied,
        "available_capacity": avail_cap,
        "occupancy_percentage": pct,
        "status": bin_obj.status,
    }


@router.post("/execute-putaway")
async def execute_putaway(
    request: ExecutePutawayRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    roles_upper = {r.upper() for r in (user.roles or [])}
    is_admin = bool(roles_upper.intersection({"ADMIN", "SUPERUSER"}))
    is_operator = bool(roles_upper.intersection({"WAREHOUSE_OPERATOR"})) or ("putaway:execute" in (user.permissions or []))

    is_warehouse_user = bool(roles_upper.intersection({"WAREHOUSE_MANAGER", "WAREHOUSE"}))

    if not is_operator and not is_warehouse_user and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse Operators or Warehouse Operators assigned to this Warehouse can execute Putaway.",
        )

    if request.quantity <= 0:
        raise HTTPException(status_code=422, detail="Putaway quantity must be greater than zero")

    confirmation_id = (request.confirmation_id or "").strip() or None
    confirmation_hash = _confirmation_digest(
        request.task_id,
        request.grn_qr_code,
        request.bin_qr_code,
        request.quantity,
    )
    if confirmation_id:
        prior_confirmation = await uow.session.scalar(
            select(PutawayMovementModel).where(PutawayMovementModel.confirmation_id == confirmation_id)
        )
        if prior_confirmation:
            if prior_confirmation.confirmation_hash != confirmation_hash:
                raise HTTPException(status_code=409, detail="Confirmation ID was already used for a different putaway scan")
            return {
                "status": "SUCCESS",
                "duplicate_confirmation": True,
                "message": "This putaway confirmation was already posted",
                "task_id": str(prior_confirmation.putaway_task_id),
                "material_code": prior_confirmation.material_code,
                "putaway_quantity": float(prior_confirmation.confirmed_quantity),
                "bin_code": prior_confirmation.location_scan,
                "inventory_available_before": float(prior_confirmation.inventory_available_before),
                "inventory_available_after": float(prior_confirmation.inventory_available_after),
            }

    # Step 1: Resolve GRN QR strictly on backend
    grn_info = await resolve_grn_qr(
        ResolveGrnQrRequest(qr_code=request.grn_qr_code, batch_number=request.batch_number),
        user=user,
        uow=uow,
    )
    item_code = grn_info["material_code"]
    grn_number = grn_info["grn_number"]
    grn_id = uuid.UUID(grn_info["grn_id"]) if grn_info.get("grn_id") else None
    available_qty = Decimal(str(grn_info["available_quantity"]))
    uom = grn_info["uom"] or "PCS"
    mat_name = grn_info["material_name"]
    warehouse_id = grn_info["warehouse_id"]
    if not warehouse_id:
        raise HTTPException(status_code=409, detail="The GRN material is not associated with a warehouse")

    if request.quantity > available_qty:
        raise HTTPException(
            status_code=422,
            detail=f"Putaway quantity ({request.quantity}) exceeds available quantity ({available_qty} {uom}) for Material '{item_code}'",
        )

    # Step 2: Resolve Bin QR strictly on backend
    bin_info = await resolve_bin_qr(
        ResolveBinQrRequest(bin_scan=request.bin_qr_code, warehouse_ref_id=uuid.UUID(grn_info["warehouse_ref_id"]) if grn_info.get("warehouse_ref_id") else None),
        user=user,
        uow=uow,
    )
    bin_id = uuid.UUID(bin_info["bin_id"])
    target_bin = await uow.session.get(WarehouseBinModel, bin_id)
    if not target_bin or (target_bin.status or "").upper() not in ("ACTIVE", "AVAILABLE", "OCCUPIED", "PARTIALLY_OCCUPIED"):
        raise HTTPException(status_code=409, detail="Destination Bin is inactive or not found")

    target_zone = await uow.session.get(WarehouseZoneModel, target_bin.zone_id) if target_bin.zone_id else None
    target_warehouse = await uow.session.get(WarehouseModel, target_bin.warehouse_ref_id) if target_bin.warehouse_ref_id else None

    # A physical operator may only confirm into the bin assigned on the task.
    # This makes an incorrect scan a safe exception instead of silently moving
    # stock to a different location.
    resolved_task: PutawayTaskModel | None = None
    if request.task_id:
        resolved_task = await uow.session.scalar(
            select(PutawayTaskModel)
            .where(PutawayTaskModel.id == request.task_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if resolved_task is None:
            raise HTTPException(status_code=404, detail="Putaway task was not found")
        # When the scanned QR resolved an exact batch task, use that task even
        # if the UI supplied the grouped/material-level task id.
        qr_task_id = grn_info.get("putaway_task_id")
        if qr_task_id and str(resolved_task.id) != str(qr_task_id):
            exact_task = await uow.session.get(PutawayTaskModel, uuid.UUID(str(qr_task_id)))
            if exact_task is not None:
                resolved_task = exact_task
    elif grn_info.get("putaway_task_id"):
        resolved_task = await uow.session.scalar(
            select(PutawayTaskModel)
            .where(PutawayTaskModel.id == uuid.UUID(grn_info["putaway_task_id"]))
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    if resolved_task and (
        resolved_task.item_code.strip().upper() != item_code.strip().upper()
        or (resolved_task.grn_id and grn_id and resolved_task.grn_id != grn_id)
        or (
            resolved_task.batch_number
            and grn_info.get("batch_lot_number")
            and resolved_task.batch_number.strip().upper() != grn_info["batch_lot_number"].strip().upper()
        )
    ):
        raise HTTPException(status_code=422, detail="Scanned GRN material batch does not match the selected putaway task")

    # The task lock above serializes partial receipts. Recheck the key after
    # acquiring it so a retry sent concurrently with the first commit returns
    # the already-posted outcome.
    if confirmation_id:
        prior_confirmation = await uow.session.scalar(
            select(PutawayMovementModel).where(PutawayMovementModel.confirmation_id == confirmation_id)
        )
        if prior_confirmation:
            if prior_confirmation.confirmation_hash != confirmation_hash:
                raise HTTPException(status_code=409, detail="Confirmation ID was already used for a different putaway scan")
            return {
                "status": "SUCCESS",
                "duplicate_confirmation": True,
                "message": "This putaway confirmation was already posted",
                "task_id": str(prior_confirmation.putaway_task_id),
                "material_code": prior_confirmation.material_code,
                "putaway_quantity": float(prior_confirmation.confirmed_quantity),
                "bin_code": prior_confirmation.location_scan,
                "inventory_available_before": float(prior_confirmation.inventory_available_before),
                "inventory_available_after": float(prior_confirmation.inventory_available_after),
            }

    # Refresh and lock the physical bin after the task lock, matching the
    # direct putaway endpoint's lock order and protecting capacity from two
    # concurrent material confirmations.
    target_bin = await uow.session.scalar(
        select(WarehouseBinModel)
        .where(WarehouseBinModel.id == bin_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not target_bin:
        raise HTTPException(status_code=404, detail="Destination Bin no longer exists")
    target_zone = await uow.session.get(WarehouseZoneModel, target_bin.zone_id) if target_bin.zone_id else None
    target_warehouse = await uow.session.get(WarehouseModel, target_bin.warehouse_ref_id) if target_bin.warehouse_ref_id else None

    if resolved_task:
        if resolved_task.status in {"CANCELLED", "PUTAWAY_COMPLETED", "COMPLETED"}:
            raise HTTPException(status_code=409, detail=f"Putaway task is {resolved_task.status.lower()} and cannot be confirmed")
        expected_bin_id = resolved_task.destination_bin_id
        expected_bin_code = (resolved_task.destination_bin_code or resolved_task.destination_bin or "").upper()
        if (expected_bin_id and target_bin.id != expected_bin_id) or (expected_bin_code and target_bin.bin_code.upper() != expected_bin_code):
            expected = resolved_task.destination_bin_code or resolved_task.destination_bin or str(expected_bin_id)
            raise HTTPException(
                status_code=422,
                detail=f"WRONG LOCATION. Expected {expected}; scanned {target_bin.bin_code}. Move material to the assigned location.",
            )
        if request.quantity > resolved_task.quantity:
            raise HTTPException(
                status_code=422,
                detail=f"Putaway quantity ({request.quantity}) exceeds remaining task quantity ({resolved_task.quantity} {resolved_task.uom}).",
            )

    await validate_grn_putaway_quantity(uow.session, grn_id, item_code, request.quantity)

    allowed_category = (getattr(target_bin, "allowed_material_category", None) or "").strip()
    material_category = (grn_info.get("material_category") or "").strip()
    if allowed_category and allowed_category.upper() not in {"ANY", "ALL"} and allowed_category.upper() != material_category.upper():
        raise HTTPException(status_code=422, detail=f"Bin '{target_bin.bin_code}' only permits material category '{allowed_category}'")
    if grn_info.get("hazardous_material") and not getattr(target_bin, "hazardous_material_permitted", False):
        raise HTTPException(status_code=422, detail=f"Bin '{target_bin.bin_code}' does not permit hazardous material")

    if is_operator and not is_admin and target_warehouse:
        user_warehouse_ref_ids, user_warehouse_codes = await get_user_warehouse_context(user, uow)
        warehouse_match = False
        if user_warehouse_ref_ids and target_warehouse.id in user_warehouse_ref_ids:
            warehouse_match = True
        elif user_warehouse_codes and target_warehouse.warehouse_code.strip().upper() in {c.strip().upper() for c in user_warehouse_codes}:
            warehouse_match = True
        elif target_warehouse.warehouse_operator_id and (
            target_warehouse.warehouse_operator_id.lower() == (user.username or "").lower()
            or target_warehouse.warehouse_operator_id.lower() == (user.subject or "").lower()
        ):
            warehouse_match = True

        if not warehouse_match:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access forbidden: You can only execute Putaway for your assigned Warehouse ('{target_warehouse.warehouse_code}').",
            )

    # Capacity validation
    if (target_bin.status or "").upper() not in ("ACTIVE", "AVAILABLE", "OCCUPIED", "PARTIALLY_OCCUPIED"):
        raise HTTPException(status_code=409, detail=f"Target Bin '{target_bin.bin_code}' is {target_bin.status} and cannot receive material")
    await validate_rack_capacity(uow.session, target_bin, request.quantity, uom)
    if target_bin.occupied_quantity + request.quantity > target_bin.capacity:
        raise HTTPException(
            status_code=409,
            detail=f"Target Bin '{target_bin.bin_code}' has insufficient capacity (Capacity: {target_bin.capacity}, Occupied: {target_bin.occupied_quantity}, Requested: {request.quantity})",
        )

    # Step 3: Resolve or provision StorageLocationModel
    loc_res = await uow.session.execute(
        select(StorageLocationModel).where(
            StorageLocationModel.bin_id == target_bin.id,
            StorageLocationModel.active.is_(True),
        ).with_for_update()
    )
    location = loc_res.scalars().first()

    if location is None:
        warehouse_code = target_warehouse.warehouse_code if target_warehouse else "WAREHOUSE_OPERATOR"
        zone_code = target_zone.zone_code if target_zone else "ZONE"
        loc_code = f"LOC-{warehouse_code}-{zone_code}-{target_bin.bin_code}"
        location = StorageLocationModel(
            location_code=loc_code,
            warehouse_id=warehouse_id,
            warehouse_ref_id=target_bin.warehouse_ref_id,
            zone_id=target_bin.zone_id,
            bin_id=target_bin.id,
            zone=zone_code,
            rack=target_bin.rack or "R01",
            bin=target_bin.bin_code,
            capacity=target_bin.capacity,
            occupied_quantity=target_bin.occupied_quantity,
            active=True,
        )
        uow.session.add(location)
        await uow.session.flush()

    # Step 4: Update MaterialStockModel
    stock, material = await _lock_warehouse_stock(uow.session, item_code, warehouse_id)
    if stock is None:
        stock = MaterialStockModel(
            id=uuid.uuid4(),
            material_id=material.id,
            material_code=item_code,
            on_hand_quantity=Decimal("0.0"),
            allocated_quantity=Decimal("0.0"),
            available_quantity=Decimal("0.0"),
            uom=uom,
            warehouse_id=warehouse_id,
            updated_at=datetime.datetime.now(),
        )
        uow.session.add(stock)
        await uow.session.flush()

    completed_at = datetime.datetime.now(datetime.timezone.utc)
    available_before = stock.available_quantity
    stock.on_hand_quantity = stock.on_hand_quantity + request.quantity
    stock.available_quantity = stock.available_quantity + request.quantity
    stock.updated_at = completed_at.replace(tzinfo=None)

    target_bin.occupied_quantity = target_bin.occupied_quantity + request.quantity
    target_bin.status = "OCCUPIED" if target_bin.occupied_quantity >= target_bin.capacity else "PARTIALLY_OCCUPIED"
    location.occupied_quantity = location.occupied_quantity + request.quantity

    # Step 5: Update the exact material, batch, and location balance.
    batch_number = (resolved_task.batch_number if resolved_task else grn_info.get("batch_lot_number")) or "UNTRACKED"
    bal_res = await uow.session.execute(
        select(InventoryLocationBalanceModel).where(
            InventoryLocationBalanceModel.material_code == item_code,
            InventoryLocationBalanceModel.storage_location_id == location.id,
            InventoryLocationBalanceModel.batch_number == batch_number,
        ).with_for_update()
    )
    balance = bal_res.scalar_one_or_none()
    if balance is None:
        balance = InventoryLocationBalanceModel(
            material_code=item_code,
            batch_number=batch_number,
            material_name=mat_name,
            warehouse_id=warehouse_id,
            storage_location_id=location.id,
            quantity=0,
            available_quantity=0,
            uom=uom,
            last_grn_number=grn_number,
            updated_at=completed_at,
        )
        uow.session.add(balance)

    balance.quantity = balance.quantity + request.quantity
    balance.available_quantity = balance.available_quantity + request.quantity
    balance.last_grn_number = grn_number
    balance.updated_at = completed_at

    # Step 6: Update PutawayTaskModel if present
    task_id = request.task_id or (uuid.UUID(grn_info["putaway_task_id"]) if grn_info.get("putaway_task_id") else None)
    task: PutawayTaskModel | None = resolved_task
    if task is None and task_id:
        task = resolved_task or await uow.session.get(PutawayTaskModel, task_id)
    elif grn_id:
        task_query = select(PutawayTaskModel).where(
                PutawayTaskModel.grn_id == grn_id,
                func.upper(PutawayTaskModel.item_code) == item_code.upper(),
            )
        if batch_number != "UNTRACKED":
            task_query = task_query.where(func.upper(PutawayTaskModel.batch_number) == batch_number.upper())
        t_res = await uow.session.execute(task_query.with_for_update())
        task = t_res.scalars().first()

    if task is None:
        raise HTTPException(status_code=409, detail="No active putaway task is linked to this material batch")

    remaining_available = max(Decimal("0"), available_qty - request.quantity)
    is_completed = remaining_available <= 0

    if task:
        balance.last_putaway_task_id = task.id
        task.destination_warehouse_ref_id = target_bin.warehouse_ref_id
        task.destination_zone_id = target_bin.zone_id
        task.destination_zone = target_zone.zone_code if target_zone else None
        task.destination_bin_id = target_bin.id
        task.destination_bin = target_bin.bin_code
        task.destination_bin_code = target_bin.bin_code
        task.destination_location_id = location.id

        if is_completed or task.quantity <= request.quantity:
            task.placement_metadata = {**(task.placement_metadata or {}), "putaway_quantity": float(request.quantity if task.quantity <= request.quantity else task.quantity)}
            task.quantity = Decimal("0")
            task.status = "COMPLETED"
            task.completed_by = user.username
            task.completed_at = completed_at
        else:
            task.quantity = task.quantity - request.quantity
            task.status = "PARTIALLY_COMPLETED"
            task.started_by = task.started_by or user.username
            task.started_at = task.started_at or completed_at
            if target_bin.occupied_quantity >= target_bin.capacity:
                # The assigned bin became full during a partial confirmation.
                # Release the unplaced remainder so it can be assigned to a
                # different rack instead of leaving it attached to a full bin.
                assignment_rows = await uow.session.execute(
                    select(PutawayLocationAssignmentModel).where(
                        PutawayLocationAssignmentModel.putaway_task_id == task.id,
                        PutawayLocationAssignmentModel.destination_bin_id == target_bin.id,
                    )
                )
                for assignment in assignment_rows.scalars().all():
                    await uow.session.delete(assignment)
                task.destination_zone_id = None
                task.destination_zone = None
                task.destination_bin_id = None
                task.destination_bin = None
                task.destination_bin_code = None
                task.destination_location_id = None

    # Step 7: Update HandlingUnitModel if present
    if grn_info.get("handling_unit_id"):
        try:
            hu = await uow.session.get(HandlingUnitModel, uuid.UUID(grn_info["handling_unit_id"]))
            if hu:
                hu.current_location = f"{target_zone.zone_code if target_zone else 'WAREHOUSE_OPERATOR'} / {target_bin.bin_code}"
                if is_completed:
                    hu.status = "STORED"
                hu.updated_at = completed_at
        except Exception:
            pass

    # Step 8: Log PutawayMovementModel & InventoryMovementHistoryModel
    material_scan_record = request.grn_qr_code[:64]
    location_scan_record = target_bin.bin_code[:64]
    dest_loc_str = location.location_code
    src_loc_str = grn_info.get("current_location") or "RECEIVING_DOCK"

    uow.session.add(
        PutawayMovementModel(
            confirmation_id=confirmation_id,
            confirmation_hash=confirmation_hash if confirmation_id else None,
            putaway_task_id=task.id,
            material_scan=material_scan_record,
            location_scan=location_scan_record,
            material_code=item_code,
            material_name=mat_name,
            source_location=src_loc_str,
            destination_location=dest_loc_str,
            batch_lot=batch_number,
            confirmed_quantity=request.quantity,
            uom=uom,
            inventory_available_before=available_before,
            inventory_available_after=stock.available_quantity,
            confirmed_by=user.username,
            confirmed_at=completed_at,
        )
    )

    uow.session.add(
        InventoryMovementHistoryModel(
            movement_type="PUTAWAY",
            material_code=item_code,
            material_name=mat_name,
            material_qr=material_scan_record,
            grn_number=grn_number,
            batch_lot=grn_info.get("batch_lot_number"),
            from_location=src_loc_str,
            to_location=dest_loc_str,
            from_bin_id=None,
            to_bin_id=target_bin.id,
            quantity=request.quantity,
            uom=uom,
            stock_before=available_before,
            stock_after=stock.available_quantity,
            performed_by=user.username,
            user_role=",".join(user.roles or []),
            warehouse_id=warehouse_id,
            warehouse_ref_id=target_bin.warehouse_ref_id,
            warehouse_code=target_warehouse.warehouse_code if target_warehouse else None,
            reference_document=task.task_number,
            remarks=f"Putaway confirmed via GRN QR into Bin {target_bin.bin_code}",
            performed_at=completed_at,
        )
    )

    if task and getattr(task, "finished_goods_id", None) and is_completed:
        try:
            await _sync_finished_goods_putaway_status(uow, task.finished_goods_id, dest_loc_str, user.username, completed_at)
        except Exception as e:
            logger.warning(f"Failed to update linked Assembly order on QR putaway: {e}")

    await uow.session.flush()

    return {
        "status": "SUCCESS",
        "message": f"Successfully put away {request.quantity} {uom} of {item_code} into Bin {target_bin.bin_code}",
        "putaway_status": "COMPLETED" if is_completed else "PARTIALLY_COMPLETED",
        "material_code": item_code,
        "material_name": mat_name,
        "grn_number": grn_number,
        "bin_code": target_bin.bin_code,
        "putaway_quantity": float(request.quantity),
        "received_quantity": float(grn_info["received_quantity"]),
        "already_put_away_quantity": float(grn_info["already_put_away_quantity"]) + float(request.quantity),
        "remaining_available_quantity": float(remaining_available),
        "task_id": str(task.id) if task else None,
        "inventory_available_before": float(available_before),
        "inventory_available_after": float(stock.available_quantity),
    }

