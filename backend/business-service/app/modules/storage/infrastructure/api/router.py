import datetime
import json
import logging
import uuid
from decimal import Decimal

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from sqlalchemy.orm import selectinload

from app.database.session import UnitOfWork, get_uow
from app.modules.dock.infrastructure.persistence.models import (
    DockAllocationRequestModel,
    DockMasterModel,
)
from app.modules.gate.infrastructure.persistence.models import DockAssignmentModel
from app.modules.procurement.infrastructure.persistence.models import (
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
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreBinModel,
    StoreManagerUserModel,
    StoreModel,
    StoreZoneModel,
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
    destination_store_id = await uow.session.scalar(select(PutawayTaskModel.destination_store_id).where(
        PutawayTaskModel.finished_goods_id == fg.id,
        PutawayTaskModel.destination_store_id.is_not(None),
    ).order_by(PutawayTaskModel.updated_at.desc()))
    if destination_store_id:
        fg.store_id = destination_store_id
    fg.updated_at = completed_at.replace(tzinfo=None) if completed_at.tzinfo else completed_at

    order = await uow.session.get(AssemblyOrderModel, fg.assembly_order_id, with_for_update=True)
    if order:
        order.putaway_status = "PUTAWAY_COMPLETED" if remaining == 0 else "PUTAWAY_IN_PROGRESS"
        order.updated_at = completed_at.replace(tzinfo=None) if completed_at.tzinfo else completed_at
        # A Finished Goods Request is fulfilled only after the produced goods
        # have physically reached the Finished Goods Store.
        from app.modules.procurement.infrastructure.persistence.models import FinishedGoodsRequestModel
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
                message=f"Finished goods for {order.order_number} ({order.product_name}) are fully put away in the Finished Goods Store.",
                link=f"/assembly-orders?order={order.id}", is_read=False, created_at=completed_at,
            ))
    return order


class LocationAssignmentRequest(BaseModel):
    store_id: uuid.UUID | None = None
    zone_id: uuid.UUID | None = None
    bin_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None


class PutawayConfirmationRequest(BaseModel):
    material_scan: str
    location_scan: str
    quantity: Decimal


class ResolveGrnQrRequest(BaseModel):
    qr_code: str


class ResolveBinQrRequest(BaseModel):
    bin_scan: str | None = None
    bin_qr_code: str | None = None
    qr_code: str | None = None
    store_id: uuid.UUID | None = None


class ExecutePutawayRequest(BaseModel):
    task_id: uuid.UUID | None = None
    grn_qr_code: str
    bin_qr_code: str
    quantity: Decimal


class StorageLocationCreateRequest(BaseModel):
    location_code: str = Field(min_length=1, max_length=64)
    warehouse_id: str = Field(min_length=1, max_length=64)
    store_id: uuid.UUID | None = None
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
        "store_id": str(location.store_id) if location.store_id else None,
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


async def get_user_store_context(user: CurrentUser, uow: UnitOfWork) -> tuple[set[uuid.UUID], set[str]]:
    roles_upper = {r.upper() for r in (user.roles or [])}
    if "ADMIN" in roles_upper or "SUPERUSER" in roles_upper:
        return set(), set()

    store_ids: set[uuid.UUID] = set()
    store_codes: set[str] = set()

    raw_id = getattr(user, "store_id", None) or (user.raw_claims.get("store_id") if user.raw_claims else None)
    if raw_id:
        try:
            store_ids.add(uuid.UUID(str(raw_id)))
        except (ValueError, TypeError):
            pass

    raw_code = getattr(user, "store_code", None) or (user.raw_claims.get("store_code") if user.raw_claims else None)
    if raw_code:
        store_codes.add(str(raw_code).strip().upper())

    identifiers = {
        str(user.username).strip().lower() if user.username else "",
        str(user.subject).strip().lower() if user.subject else "",
        str(user.raw_claims.get("employee_id") or "").strip().lower() if user.raw_claims else "",
        str(user.raw_claims.get("username") or "").strip().lower() if user.raw_claims else "",
        str(user.raw_claims.get("sub") or "").strip().lower() if user.raw_claims else "",
    }
    identifiers.discard("")

    for emp_id in identifiers:
        st = await uow.session.execute(
            select(StoreManagerUserModel).where(
                or_(
                    func.lower(StoreManagerUserModel.employee_id) == emp_id,
                    func.lower(StoreManagerUserModel.username) == emp_id,
                    func.lower(StoreManagerUserModel.full_name) == emp_id,
                    func.lower(StoreManagerUserModel.email) == emp_id,
                )
            )
        )
        for sm in st.scalars().all():
            if sm.store_id:
                store_ids.add(sm.store_id)
            if getattr(sm, "store_code", None):
                store_codes.add(str(sm.store_code).strip().upper())

        st_res2 = await uow.session.execute(
            select(StoreModel).where(
                or_(
                    func.lower(StoreModel.store_manager_id) == emp_id,
                    func.lower(StoreModel.store_manager_name) == emp_id,
                )
            )
        )
        for sm_store in st_res2.scalars().all():
            store_ids.add(sm_store.id)
            if sm_store.store_code:
                store_codes.add(sm_store.store_code.strip().upper())

    if store_ids:
        s_res = await uow.session.execute(select(StoreModel).where(StoreModel.id.in_(store_ids)))
        for s in s_res.scalars().all():
            if s.store_code:
                store_codes.add(s.store_code.strip().upper())

    if store_codes:
        s_res = await uow.session.execute(select(StoreModel).where(func.upper(StoreModel.store_code).in_(store_codes)))
        for s in s_res.scalars().all():
            store_ids.add(s.id)

    return store_ids, store_codes


async def get_user_store_id(user: CurrentUser, uow: UnitOfWork) -> uuid.UUID | None:
    roles_upper = {r.upper() for r in (user.roles or [])}
    if "ADMIN" in roles_upper or "SUPERUSER" in roles_upper:
        return None

    sids, _ = await get_user_store_context(user, uow)
    return next(iter(sids), None)


def task_response(task: PutawayTaskModel) -> dict:
    return {
        "id": str(task.id),
        "task_number": task.task_number,
        "grn_id": str(task.grn_id),
        "grn_number": task.grn_number,
        "handling_unit_id": str(task.handling_unit_id) if task.handling_unit_id else None,
        "item_code": task.item_code,
        "material_name": task.material_name,
        "material_qr": (task.placement_metadata or {}).get("unit_qr") if task.finished_goods_id else None,
        "barcode_value": None,
        "quantity": float(task.quantity),
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
        "assigned_store_manager": task.assigned_to,
        "assigned_store_manager_name": task.assigned_to,
        "assigned_store_manager_username": task.assigned_to,
        "assigned_store_manager_id": None,
        "assigned_store_id": str(task.destination_store_id) if task.destination_store_id else None,
        "assigned_store_code": None,
        "assigned_store_name": None,
        "destination_store_id": str(task.destination_store_id) if task.destination_store_id else None,
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
        store_ids = {t.destination_store_id for t in tasks if t.destination_store_id}
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

        stores: dict[uuid.UUID, StoreModel] = {}
        if store_ids:
            try:
                store_res = await session.execute(select(StoreModel).where(StoreModel.id.in_(store_ids)))
                stores = {s.id: s for s in store_res.scalars().all()}
            except Exception:
                pass

        finished_goods_store = None
        if fg_ids:
            try:
                finished_goods_store = (await session.execute(
                    select(StoreModel).where(
                        or_(
                            func.upper(StoreModel.store_code) == "STR-FG",
                            func.upper(StoreModel.store_name) == "FINISHED GOODS STORE",
                        ),
                        StoreModel.status == "ACTIVE",
                    ).order_by(StoreModel.created_at.asc())
                )).scalars().first()
            except Exception:
                finished_goods_store = None

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
        for t in tasks:
            grn = grns.get(t.grn_id)
            hu = hus.get(t.handling_unit_id) if t.handling_unit_id else None
            is_finished_goods = bool(t.finished_goods_id)
            store = finished_goods_store if is_finished_goods and finished_goods_store else (
                stores.get(t.destination_store_id) if t.destination_store_id else None
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
                (da.assigned_store_manager_name if da and da.assigned_store_manager_name else None)
                or (das.assigned_store_manager_name if das and das.assigned_store_manager_name else None)
                or (store.store_manager_name if store and getattr(store, "store_manager_name", None) else None)
                or t.assigned_to
            )
            sm_user = (
                (da.assigned_store_manager_username if da and da.assigned_store_manager_username else None)
                or (das.assigned_store_manager_username if das and das.assigned_store_manager_username else None)
                or t.assigned_to
            )
            sm_id = (
                (da.assigned_store_manager_id if da and da.assigned_store_manager_id else None)
                or (das.assigned_store_manager_id if das and das.assigned_store_manager_id else None)
                or (store.store_manager_id if store and getattr(store, "store_manager_id", None) else None)
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
            mat_qr = (
                unit_qr
                or (fg_record.qr_code if fg_record else None)
                or (hu.barcode_value if hu and hu.barcode_value else None)
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
                "material_qr": mat_qr,
                "barcode_value": hu.barcode_value if hu else None,
                "quantity": float(t.quantity),
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
                "assigned_store_manager": sm_name or sm_user or sm_id,
                "assigned_store_manager_name": sm_name,
                "assigned_store_manager_username": sm_user,
                "assigned_store_manager_id": sm_id,
                "assigned_store_id": str(t.destination_store_id) if t.destination_store_id else None,
                "assigned_store_code": store.store_code if store else None,
                "assigned_store_name": store.store_name if store else None,
                "destination_store_id": str(t.destination_store_id) if t.destination_store_id else None,
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
                "store_id": str(payload.get("store_id") or "").strip() or None,
                "store_code": str(payload.get("store_code") or "").strip() or None,
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
            "store_id": None,
            "store_code": None,
            "raw": scanned,
        }
    except (ValueError, TypeError):
        pass
    return {
        "bin_id": None,
        "bin_code": scanned if scanned.upper().startswith("BIN-") else None,
        "zone_id": None,
        "zone_code": scanned,
        "store_id": None,
        "store_code": None,
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
        "destination_store_id": str(task.destination_store_id) if task and task.destination_store_id else None,
        "destination_zone_id": str(task.destination_zone_id) if task and task.destination_zone_id else None,
        "destination_location_id": str(task.destination_location_id) if task and task.destination_location_id else None,
        "destination": f"{task.warehouse_id} / {task.destination_zone} / {task.destination_rack} / {task.destination_bin}" if task and task.destination_bin else None,
    }


@router.get("")
async def list_putaway_tasks(
    store_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    roles_upper = {r.upper() for r in user.roles}
    query = select(PutawayTaskModel).order_by(PutawayTaskModel.created_at.desc())

    # Store Keepers / Store Managers are strictly scoped to their assigned Store
    if "STORE_KEEPER" in roles_upper or "STORE_MANAGER" in roles_upper:
        if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper and "WAREHOUSE" not in roles_upper and "WAREHOUSE_MANAGER" not in roles_upper:
            user_store_ids, user_store_codes = await get_user_store_context(user, uow)
            if user_store_ids:
                query = query.where(PutawayTaskModel.destination_store_id.in_(user_store_ids))
            elif user_store_codes:
                s_res = await uow.session.execute(select(StoreModel.id).where(func.upper(StoreModel.store_code).in_(user_store_codes)))
                s_ids = list(s_res.scalars().all())
                if s_ids:
                    query = query.where(PutawayTaskModel.destination_store_id.in_(s_ids))
                else:
                    return []
            else:
                return []
    elif store_id:
        query = query.where(PutawayTaskModel.destination_store_id == store_id)

    result = await uow.session.execute(query)
    tasks_list = list(result.scalars().all())
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

    # Store Keepers / Store Managers see only their store's storage locations
    if "STORE_KEEPER" in roles_upper or "STORE_MANAGER" in roles_upper:
        if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper and "WAREHOUSE" not in roles_upper and "WAREHOUSE_MANAGER" not in roles_upper:
            user_store_ids, user_store_codes = await get_user_store_context(user, uow)
            if user_store_ids:
                query = query.where(StorageLocationModel.store_id.in_(user_store_ids))
            elif user_store_codes:
                s_res = await uow.session.execute(select(StoreModel.id).where(func.upper(StoreModel.store_code).in_(user_store_codes)))
                s_ids = list(s_res.scalars().all())
                if s_ids:
                    query = query.where(StorageLocationModel.store_id.in_(s_ids))
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
    is_store_user = "STORE_KEEPER" in roles_upper or "STORE_MANAGER" in roles_upper
    is_admin_or_wh = bool(roles_upper.intersection({"ADMIN", "SUPERUSER", "WAREHOUSE", "WAREHOUSE_MANAGER"}))

    if not is_store_user and not is_admin_or_wh and "gate:approve" not in (user.permissions or []):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Insufficient permissions to create storage locations.",
        )

    store_id = request.store_id
    zone_id = request.zone_id

    # If Store Manager, validate store ownership
    if is_store_user and not is_admin_or_wh:
        user_store_ids, user_store_codes = await get_user_store_context(user, uow)
        if store_id and store_id not in user_store_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You cannot create storage locations for another store.",
            )
        if not store_id and user_store_ids:
            store_id = next(iter(user_store_ids))

        if zone_id:
            zone_obj = await uow.session.get(StoreZoneModel, zone_id)
            if zone_obj and zone_obj.store_id not in user_store_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: The specified zone belongs to another store.",
                )

    values = {
        "location_code": request.location_code.strip().upper(),
        "warehouse_id": request.warehouse_id.strip().upper(),
        "store_id": store_id,
        "zone_id": zone_id,
        "zone": request.zone.strip(),
        "rack": request.rack.strip(),
        "bin": request.bin.strip(),
    }
    if any(value is None or (isinstance(value, str) and not value) for k, value in values.items() if k not in ("store_id", "zone_id")):
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
    is_store_user = "STORE_KEEPER" in roles_upper or "STORE_MANAGER" in roles_upper
    is_admin_or_wh = bool(roles_upper.intersection({"ADMIN", "SUPERUSER", "WAREHOUSE", "WAREHOUSE_MANAGER"}))

    if not is_store_user and not is_admin_or_wh and "gate:approve" not in (user.permissions or []):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Insufficient permissions to modify storage locations.",
        )

    if is_store_user and not is_admin_or_wh:
        user_store_ids, _ = await get_user_store_context(user, uow)
        if location.store_id and location.store_id not in user_store_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You cannot modify storage locations belonging to another store.",
            )

    if not request.active and location.occupied_quantity > 0:
        raise HTTPException(status_code=409, detail="Occupied storage locations cannot be deactivated")
    location.active = request.active
    await uow.session.flush()
    return storage_location_response(location)


@router.get("/inventory-locations")
async def list_inventory_location_balances(
    material_code: str | None = None,
    store_id: str | None = None,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    user_store_id = await get_user_store_id(user, uow)
    roles_upper = {r.upper() for r in user.roles}
    is_store_user = ("STORE_MANAGER" in roles_upper or "STORE_KEEPER" in roles_upper) and not (
        "WAREHOUSE" in roles_upper or "ADMIN" in roles_upper or "SUPERUSER" in roles_upper
    )

    if is_store_user:
        if not user_store_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Store context not found for user",
            )
        if store_id and str(user_store_id) != store_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access forbidden: You cannot view inventory of another Store.",
            )
        target_store_id = user_store_id
    else:
        target_store_id = uuid.UUID(store_id) if store_id else None

    query = (
        select(InventoryLocationBalanceModel, StorageLocationModel)
        .join(StorageLocationModel, StorageLocationModel.id == InventoryLocationBalanceModel.storage_location_id)
    )
    if target_store_id:
        query = query.where(StorageLocationModel.store_id == target_store_id)
    if material_code:
        query = query.where(func.lower(InventoryLocationBalanceModel.material_code) == material_code.lower())
    result = await uow.session.execute(
        query.order_by(InventoryLocationBalanceModel.material_code, StorageLocationModel.location_code)
    )
    
    stores_result = await uow.session.execute(select(StoreModel))
    store_map = {s.id: s for s in stores_result.scalars().all()}
    zones_result = await uow.session.execute(select(StoreZoneModel))
    zone_map = {z.id: z for z in zones_result.scalars().all()}

    output = []
    for balance, location in result.all():
        store_obj = store_map.get(location.store_id) if location.store_id else None
        zone_obj = zone_map.get(location.zone_id) if location.zone_id else None
        output.append({
            "id": str(balance.id),
            "material_code": balance.material_code,
            "material_name": balance.material_name,
            "warehouse_id": balance.warehouse_id,
            "storage_location_id": str(location.id),
            "location_code": location.location_code,
            "store_id": str(location.store_id) if location.store_id else None,
            "store_code": store_obj.store_code if store_obj else None,
            "store_name": store_obj.store_name if store_obj else None,
            "zone_id": str(location.zone_id) if location.zone_id else None,
            "zone_code": zone_obj.zone_code if zone_obj else location.zone,
            "zone_name": zone_obj.zone_name if zone_obj else location.zone,
            "zone": location.zone,
            "rack": location.rack,
            "bin": location.bin,
            "quantity": float(balance.quantity),
            "available_quantity": float(balance.available_quantity),
            "uom": balance.uom,
            "last_putaway_task_id": str(balance.last_putaway_task_id),
            "last_grn_number": balance.last_grn_number,
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
        or "STORE_MANAGER" in roles_upper
        or "STORE_KEEPER" in roles_upper
        or "storage:read" in user.permissions
        or "putaway:execute" in user.permissions
        or "gate:read" in user.permissions
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Handling unit scanning requires Warehouse or Store personnel access",
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

    # Store isolation: If task is assigned to a specific store, verify Store Keeper belongs to it
    if task and task.destination_store_id and ("STORE_MANAGER" in roles_upper or "STORE_KEEPER" in roles_upper):
        if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper and "WAREHOUSE" not in roles_upper and "WAREHOUSE_MANAGER" not in roles_upper:
            user_store_id = await get_user_store_id(user, uow)
            if user_store_id and task.destination_store_id != user_store_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: Handling unit belongs to a putaway task for another Store",
                )

    return handling_unit_response(unit, task)


@router.get("/{task_id}")
async def get_putaway_task(
    task_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    task = await uow.session.get(PutawayTaskModel, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Putaway task not found")

    roles_upper = {r.upper() for r in user.roles}
    if "STORE_KEEPER" in roles_upper or "STORE_MANAGER" in roles_upper:
        if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper and "WAREHOUSE" not in roles_upper and "WAREHOUSE_MANAGER" not in roles_upper:
            user_store_id = await get_user_store_id(user, uow)
            if user_store_id and task.destination_store_id != user_store_id:
                raise HTTPException(status_code=403, detail="Access denied: Putaway task belongs to another Store")

    enriched = await enrich_putaway_tasks([task], uow.session)
    return enriched[0] if enriched else task_response(task)


@router.put("/{task_id}/location")
async def assign_storage_location(
    task_id: uuid.UUID,
    request: LocationAssignmentRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    """
    Warehouse assigns the destination Store to the Putaway task and triggers notification.
    """
    roles_upper = {r.upper() for r in user.roles}
    is_wh = "WAREHOUSE" in roles_upper or "WAREHOUSE_MANAGER" in roles_upper or "ADMIN" in roles_upper or "SUPERUSER" in roles_upper or "gate:approve" in user.permissions

    if not is_wh:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Warehouse personnel can assign destination Stores to Putaway tasks",
        )

    task = await uow.session.get(PutawayTaskModel, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Putaway task not found")
    if task.status in ("PUTAWAY_COMPLETED", "STORED"):
        raise HTTPException(status_code=409, detail="Completed putaway tasks cannot be reassigned")

    # Destination Store selection
    if request.store_id:
        store = await uow.session.get(StoreModel, request.store_id)
        if store is None or store.status.upper() != "ACTIVE":
            raise HTTPException(status_code=422, detail="Selected destination store is inactive or not found")

        zone = None
        if request.zone_id:
            zone = await uow.session.get(StoreZoneModel, request.zone_id)
            if zone is None or zone.status.upper() != "ACTIVE":
                raise HTTPException(status_code=422, detail="Selected destination zone is inactive or not found")
            if zone.store_id != store.id:
                raise HTTPException(status_code=422, detail=f"Zone '{zone.zone_code}' does not belong to Store '{store.store_code}'")

        bin_obj = None
        if request.bin_id:
            bin_obj = await uow.session.get(StoreBinModel, request.bin_id)
            if bin_obj is None or bin_obj.status.upper() not in ("ACTIVE", "AVAILABLE"):
                raise HTTPException(status_code=422, detail="Selected destination bin is inactive or not found")
            if zone and bin_obj.zone_id != zone.id:
                raise HTTPException(status_code=422, detail=f"Bin '{bin_obj.bin_code}' does not belong to Zone '{zone.zone_code}'")
            if bin_obj.store_id != store.id:
                raise HTTPException(status_code=422, detail=f"Bin '{bin_obj.bin_code}' does not belong to Store '{store.store_code}'")

        # Resolve or create a storage_location associated with this store, zone, and bin
        location = None
        if zone:
            loc_query = select(StorageLocationModel).where(
                StorageLocationModel.warehouse_id == task.warehouse_id,
                StorageLocationModel.active.is_(True),
                (StorageLocationModel.zone_id == zone.id) | (StorageLocationModel.zone == zone.zone_code),
                StorageLocationModel.capacity - StorageLocationModel.occupied_quantity >= task.quantity,
            )
            if bin_obj:
                loc_query = loc_query.where(StorageLocationModel.bin_id == bin_obj.id)
            loc_res = await uow.session.execute(loc_query)
            location = loc_res.scalars().first()

            if location is None:
                b_code = bin_obj.bin_code if bin_obj else "B01"
                r_code = bin_obj.rack if bin_obj and bin_obj.rack else "R01"
                loc_code = f"LOC-{store.store_code}-{zone.zone_code}-{b_code}"
                exist_res = await uow.session.execute(
                    select(StorageLocationModel).where(StorageLocationModel.location_code == loc_code)
                )
                location = exist_res.scalar_one_or_none()
                if location is None:
                    location = StorageLocationModel(
                        location_code=loc_code,
                        warehouse_id=task.warehouse_id,
                        store_id=store.id,
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
                    location.store_id = store.id
                    location.zone_id = zone.id
                    if bin_obj:
                        location.bin_id = bin_obj.id
                    location.zone = zone.zone_code
                    location.active = True
                    await uow.session.flush()

        task.destination_store_id = store.id
        task.destination_zone_id = zone.id if zone else None
        task.destination_bin_id = bin_obj.id if bin_obj else None
        task.destination_bin_code = bin_obj.bin_code if bin_obj else None
        task.destination_location_id = location.id if location else None
        task.destination_zone = zone.zone_code if zone else None
        task.destination_rack = bin_obj.rack if bin_obj and bin_obj.rack else (location.rack if location else None)
        task.destination_bin = bin_obj.bin_code if bin_obj else (location.bin if location else None)
    elif request.location_id:
        location = await uow.session.get(StorageLocationModel, request.location_id)
        if location is None or not location.active:
            raise HTTPException(status_code=422, detail="Storage location is unavailable")
        if location.warehouse_id != task.warehouse_id:
            raise HTTPException(status_code=422, detail="Storage location belongs to a different warehouse")
        if location.capacity - location.occupied_quantity < task.quantity:
            raise HTTPException(status_code=409, detail="Storage location has insufficient available capacity")
        
        store = None
        if location.store_id:
            store = await uow.session.get(StoreModel, location.store_id)

        task.destination_location_id = location.id
        task.destination_store_id = location.store_id
        task.destination_zone_id = location.zone_id
        task.destination_bin_id = location.bin_id
        task.destination_bin_code = location.bin
        task.destination_zone = location.zone
        task.destination_rack = location.rack
        task.destination_bin = location.bin
    else:
        raise HTTPException(status_code=422, detail="Specify destination store_id or storage location_id")

    task.status = "ASSIGNED_TO_STORE"
    task.location_assigned_by = user.username
    task.location_assigned_at = datetime.datetime.now(datetime.timezone.utc)

    # Trigger Notification for the assigned Store / Store Keeper
    store_name_disp = store.store_name if store else "Designated Store"
    store_code_disp = store.store_code if store else "STORE"

    source_label = (
        "Assembly finished goods"
        if task.finished_goods_id
        else f"GRN {task.grn_number}"
    )
    notif_msg = (
        f"Material {task.material_name} ({task.item_code}) x {task.quantity} {task.uom} "
        f"assigned to {store_name_disp} ({store_code_disp}) from {source_label}."
    )
    # Store-scoped notification
    if store and store.store_code:
        uow.session.add(
            NotificationModel(
                user_role=f"STR:{store.store_code}"[:32],
                title=f"New Putaway Task: {task.task_number}",
                message=notif_msg,
                link=f"/my-store?task={task.id}",
                is_read=False,
            )
        )
    # Role-based notification
    uow.session.add(
        NotificationModel(
            user_role="STORE_KEEPER",
            title=f"New Putaway Task: {task.task_number}",
            message=notif_msg,
            link=f"/my-store?task={task.id}",
            is_read=False,
        )
    )

    await uow.session.flush()
    return task_response(task)


@router.post("/{task_id}/start")
async def start_putaway(
    task_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    task = await uow.session.get(PutawayTaskModel, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Putaway task not found")
    if task.status in ("PUTAWAY_COMPLETED", "STORED"):
        raise HTTPException(status_code=409, detail="Putaway task is already completed")
    if task.status == "PUTAWAY_IN_PROGRESS":
        return task_response(task)

    roles_upper = {r.upper() for r in user.roles}
    if "STORE_KEEPER" in roles_upper or "STORE_MANAGER" in roles_upper:
        if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper and "WAREHOUSE" not in roles_upper and "WAREHOUSE_MANAGER" not in roles_upper:
            user_store_id = await get_user_store_id(user, uow)
            if user_store_id and task.destination_store_id and task.destination_store_id != user_store_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: You can only start putaway tasks assigned to your Store",
                )

    task.status = "PUTAWAY_IN_PROGRESS"
    task.started_by = user.username
    task.started_at = datetime.datetime.now(datetime.timezone.utc)
    await uow.session.flush()
    return task_response(task)


@router.post("/{task_id}/complete")
async def complete_putaway(
    task_id: uuid.UUID,
    request: PutawayConfirmationRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    """
    Store Keeper confirms physical Putaway by scanning Material QR & Zone/Bin QR.
    Updates Material Stock and Inventory balances to AVAILABLE at the Store, Zone, and Bin.
    """
    task = await uow.session.get(PutawayTaskModel, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Putaway task not found")
    if task.status in ("PUTAWAY_COMPLETED", "STORED"):
        raise HTTPException(status_code=409, detail="Putaway task is already completed")

    roles_upper = {r.upper() for r in user.roles}
    is_store_user = bool(roles_upper.intersection({"STORE_MANAGER", "STORE_KEEPER"})) or ("putaway:execute" in (user.permissions or []))
    is_finished_goods_task = bool(task.finished_goods_id)
    is_warehouse_user = bool(roles_upper.intersection({"WAREHOUSE_MANAGER", "WAREHOUSE"}))
    can_execute_finished_goods = is_finished_goods_task and is_warehouse_user

    # Reject Warehouse Manager explicitly
    if is_warehouse_user and not is_store_user and not can_execute_finished_goods:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Warehouse Manager is not authorized to execute Putaway. Physical putaway must be performed by the assigned Store Manager.",
        )

    if not is_store_user and not can_execute_finished_goods and "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Store Keepers or Store Managers assigned to this Store can complete physical putaway",
        )

    # Store isolation: Physical Putaway confirmation into a Store is performed by assigned Store Keeper/Manager
    if task.destination_store_id and not can_execute_finished_goods and "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper:
        user_store_ids, user_store_codes = await get_user_store_context(user, uow)
        if user_store_ids or user_store_codes:
            store_match = False
            if task.destination_store_id in user_store_ids:
                store_match = True
            elif task.destination_store_id:
                # check if destination store's code matches
                st_obj = await uow.session.get(StoreModel, task.destination_store_id)
                if st_obj and st_obj.store_code and st_obj.store_code.strip().upper() in user_store_codes:
                    store_match = True
            if not store_match:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot complete Putaway tasks belonging to another Store",
                )

    if task.status != "PUTAWAY_IN_PROGRESS":
        if task.status in ("ASSIGNED_TO_STORE", "PUTAWAY_PENDING") and task.destination_store_id:
            task.status = "PUTAWAY_IN_PROGRESS"
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

    if (
        handling_unit is None
        and not afg_match
        and scanned_hu.upper() != task.item_code.upper()
        and raw_scan.upper() != task.item_code.upper()
        and task.item_code.upper() not in raw_scan.upper()
    ):
        raise HTTPException(status_code=422, detail="Scanned Material QR does not match the putaway task")

    if handling_unit and handling_unit.status in ("QUARANTINED", "REJECTED", "DAMAGED"):
        raise HTTPException(
            status_code=409,
            detail=f"Material is {handling_unit.status.lower()} and cannot be put away into storage",
        )

    # 2. Validate Location / Zone / Bin Scan
    loc_scan_info = normalize_zone_scan(request.location_scan)
    scanned_bin_id = loc_scan_info.get("bin_id")
    scanned_bin_code = loc_scan_info.get("bin_code")
    scanned_zone_id = loc_scan_info.get("zone_id")
    scanned_zone_code = loc_scan_info.get("zone_code")

    target_bin: StoreBinModel | None = None
    target_zone: StoreZoneModel | None = None

    # Step A: Try resolving Bin first
    if scanned_bin_id:
        try:
            target_bin = await uow.session.get(StoreBinModel, uuid.UUID(scanned_bin_id))
        except (ValueError, TypeError):
            pass

    if target_bin is None and scanned_bin_code:
        bq = await uow.session.execute(
            select(StoreBinModel).where(func.upper(StoreBinModel.bin_code) == scanned_bin_code.strip().upper())
        )
        target_bin = bq.scalar_one_or_none()

    if target_bin is not None:
        target_zone = await uow.session.get(StoreZoneModel, target_bin.zone_id)
    else:
        # Step B: If no bin matched directly, resolve Zone
        if scanned_zone_id:
            try:
                target_zone = await uow.session.get(StoreZoneModel, uuid.UUID(scanned_zone_id))
            except (ValueError, TypeError):
                pass

        if target_zone is None and scanned_zone_code:
            try:
                target_zone = await uow.session.get(StoreZoneModel, uuid.UUID(scanned_zone_code))
            except (ValueError, TypeError):
                pass

        if target_zone is None and scanned_zone_code:
            zq = await uow.session.execute(
                select(StoreZoneModel).where(func.upper(StoreZoneModel.zone_code) == scanned_zone_code.strip().upper())
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
                    target_bin = await uow.session.get(StoreBinModel, matched_loc.bin_id)
                if target_zone is None and matched_loc.zone_id:
                    target_zone = await uow.session.get(StoreZoneModel, matched_loc.zone_id)
                if target_zone is None and matched_loc.zone:
                    zq = await uow.session.execute(
                        select(StoreZoneModel).where(func.upper(StoreZoneModel.zone_code) == matched_loc.zone.strip().upper())
                    )
                    target_zone = zq.scalar_one_or_none()

        if target_zone is None and not (scanned_bin_code or scanned_zone_code or scanned_bin_id or scanned_zone_id) and task.destination_zone_id:
            target_zone = await uow.session.get(StoreZoneModel, task.destination_zone_id)

    if target_zone is None:
        raise HTTPException(status_code=422, detail="Scanned Zone/Bin location was not found")

    if target_zone.status.upper() != "ACTIVE":
        raise HTTPException(status_code=409, detail=f"Scanned Zone '{target_zone.zone_code}' is inactive")

    # STRICT STORE + ZONE VALIDATION: Scanned Zone must belong to target Store
    target_store = await uow.session.get(StoreModel, target_zone.store_id)
    if target_store is None:
        raise HTTPException(status_code=422, detail="Store associated with target zone was not found")
    if (target_store.status or "").strip().upper() != "ACTIVE":
        raise HTTPException(status_code=409, detail=f"Target Store '{target_store.store_code}' is inactive")

    # Validate Warehouse isolation
    if task.destination_store_id and target_store.id == task.destination_store_id:
        pass
    elif target_store.warehouse_id and task.warehouse_id:
        st_wh = target_store.warehouse_id.strip().upper().replace(" ", "").replace("_", "").replace("-", "")
        tk_wh = task.warehouse_id.strip().upper().replace(" ", "").replace("_", "").replace("-", "")
        if st_wh != tk_wh and tk_wh not in st_wh and st_wh not in tk_wh:
            raise HTTPException(
                status_code=422,
                detail=f"Store '{target_store.store_code}' belongs to warehouse '{target_store.warehouse_id}', which does not match task warehouse '{task.warehouse_id}'",
            )

    # Validate Store assignment matching if task has assigned store
    if task.destination_store_id and target_store.id != task.destination_store_id:
        raise HTTPException(
            status_code=422,
            detail=f"Scanned location belongs to Store '{target_store.store_code}', which does not belong to assigned destination Store",
        )

    # Validate User Store authorization
    if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper:
        user_store_ids, user_store_codes = await get_user_store_context(user, uow)
        if user_store_ids or user_store_codes:
            if target_store.id not in user_store_ids and target_store.store_code.upper() not in user_store_codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot complete Putaway tasks into another Store",
                )

    # Step C: If Bin was not explicitly scanned, locate or provision default Bin in the verified Zone
    if target_bin is None:
        bq = await uow.session.execute(
            select(StoreBinModel).where(
                StoreBinModel.zone_id == target_zone.id,
                StoreBinModel.status == "ACTIVE",
            ).order_by(StoreBinModel.bin_code.asc())
        )
        target_bin = bq.scalars().first()

    if target_bin is None:
        bin_code_clean = f"BIN-{target_zone.zone_code.replace(' ', '').upper()}-001"
        now_dt = datetime.datetime.now(datetime.timezone.utc)
        target_bin = StoreBinModel(
            id=uuid.uuid4(),
            store_id=target_zone.store_id,
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

    # STRICT BIN VALIDATION
    if target_bin.status.upper() not in ("ACTIVE", "AVAILABLE"):
        raise HTTPException(status_code=409, detail=f"Target Bin '{target_bin.bin_code}' is inactive")
    if target_bin.zone_id != target_zone.id:
        raise HTTPException(status_code=422, detail=f"Target Bin '{target_bin.bin_code}' does not belong to Zone '{target_zone.zone_code}'")
    if task.destination_store_id and target_bin.store_id != task.destination_store_id:
        raise HTTPException(status_code=422, detail=f"Target Bin '{target_bin.bin_code}' does not belong to assigned destination Store")

    # 3. Resolve or Create Storage Location for the Store Zone + Bin
    location = None
    if task.destination_location_id:
        loc_res = await uow.session.execute(
            select(StorageLocationModel).where(StorageLocationModel.id == task.destination_location_id).with_for_update()
        )
        location = loc_res.scalar_one_or_none()

    if location is None:
        store = await uow.session.get(StoreModel, target_zone.store_id)
        store_code = store.store_code if store else "STORE"
        loc_code = f"LOC-{store_code}-{target_zone.zone_code}-{target_bin.bin_code}"
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
        store = await uow.session.get(StoreModel, target_zone.store_id)
        store_code = store.store_code if store else "STORE"
        loc_code = f"LOC-{store_code}-{target_zone.zone_code}-{target_bin.bin_code}"
        location = StorageLocationModel(
            location_code=loc_code,
            warehouse_id=task.warehouse_id,
            store_id=target_zone.store_id,
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
    if request.quantity <= 0:
        raise HTTPException(status_code=422, detail="Confirmed quantity must be greater than zero")
    if request.quantity > task.quantity:
        raise HTTPException(
            status_code=422,
            detail=f"Confirmed quantity ({request.quantity}) exceeds remaining task quantity ({task.quantity} {task.uom})",
        )
    if target_bin.occupied_quantity + request.quantity > target_bin.capacity:
        raise HTTPException(status_code=409, detail=f"Target Bin '{target_bin.bin_code}' has insufficient capacity")

    # 5. Material Stock Update (Available increments upon Putaway completion)
    stock_result = await uow.session.execute(
        select(MaterialStockModel).where(MaterialStockModel.material_code == task.item_code).with_for_update()
    )
    stock = stock_result.scalar_one_or_none()
    if stock is None:
        stock = MaterialStockModel(
            id=uuid.uuid4(),
            material_code=task.item_code,
            material_name=task.item_code,
            category="General",
            on_hand=Decimal("0.0"),
            allocated=Decimal("0.0"),
            available=Decimal("0.0"),
            uom=task.uom or "PCS",
            warehouse_id=task.warehouse_id or "MAIN",
            reorder_point=Decimal("10.0"),
            updated_at=datetime.datetime.now(),
        )
        uow.session.add(stock)
        await uow.session.flush()

    completed_at = datetime.datetime.now(datetime.timezone.utc)
    available_before = stock.available
    # Putaway completion moves produced stock into warehouse inventory. Keep
    # the canonical on-hand total in sync with available stock; this is
    # especially important for Assembly finished goods, which do not arrive
    # through the GRN receipt-posting flow.
    stock.on_hand = stock.on_hand + request.quantity
    stock.available = stock.available + request.quantity
    stock.updated_at = completed_at.replace(tzinfo=None)
    target_bin.occupied_quantity = target_bin.occupied_quantity + request.quantity
    location.occupied_quantity = location.occupied_quantity + request.quantity

    # 6. Inventory Location Balance Update
    balance_result = await uow.session.execute(
        select(InventoryLocationBalanceModel).where(
            InventoryLocationBalanceModel.material_code == task.item_code,
            InventoryLocationBalanceModel.storage_location_id == location.id,
        ).with_for_update()
    )
    balance = balance_result.scalar_one_or_none()
    if balance is None:
        balance = InventoryLocationBalanceModel(
            material_code=task.item_code,
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
    task.destination_store_id = target_zone.store_id
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
        task.status = "PUTAWAY_COMPLETED"
        task.completed_by = user.username
        task.completed_at = completed_at
    else:
        task.quantity = remaining_task_qty
        task.status = "PUTAWAY_IN_PROGRESS"
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
            putaway_task_id=task.id,
            material_scan=material_scan_record,
            location_scan=location_scan_record,
            material_code=task.item_code,
            material_name=getattr(task, "material_name", None) or task.item_code,
            source_location=src_loc_str,
            destination_location=dest_loc_str,
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
            batch_lot=None,
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
            warehouse_id=task.warehouse_id or "MAIN",
            store_id=target_zone.store_id if target_zone else None,
            store_code=target_store.store_code if target_store else None,
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
    # posting and its Finished Goods Store putaway task.
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

        fg_store = await uow.session.get(StoreModel, fg_task.destination_store_id) if fg_task.destination_store_id else None
        if not fg_store or (fg_store.store_code or "").upper() != "STR-FG":
            fg_store = (await uow.session.execute(
                select(StoreModel).where(
                    or_(
                        func.upper(StoreModel.store_code) == "STR-FG",
                        func.upper(StoreModel.store_name) == "FINISHED GOODS STORE",
                    ),
                    StoreModel.status == "ACTIVE",
                ).order_by(StoreModel.created_at.asc())
            )).scalars().first()
        if fg_store and not fg_task.destination_bin_code:
            fg_zone = (await uow.session.execute(
                select(StoreZoneModel).where(
                    StoreZoneModel.store_id == fg_store.id,
                    StoreZoneModel.status == "ACTIVE",
                ).order_by(StoreZoneModel.created_at.asc())
            )).scalars().first()
            fg_bin = (await uow.session.execute(
                select(StoreBinModel).where(
                    StoreBinModel.store_id == fg_store.id,
                    StoreBinModel.status == "ACTIVE",
                ).order_by(StoreBinModel.created_at.asc())
            )).scalars().first()
            if fg_bin:
                fg_task.destination_store_id = fg_store.id
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
            "warehouse_id": fg.warehouse_id or fg_task.warehouse_id or "MAIN",
            "store_id": str(fg_task.destination_store_id) if fg_task.destination_store_id else None,
            "store_name": fg_store.store_name if fg_store else "Finished Goods Store",
            "store_code": fg_store.store_code if fg_store else "STR-FG",
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
    batch_number: str | None = None
    hu_number: str | None = None

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
                    pass

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
        # First check if there is an active/pending Putaway Task for this material in user's store context
        user_store_ids, user_store_codes = await get_user_store_context(user, uow)
        pt_query = select(PutawayTaskModel).where(
            func.upper(PutawayTaskModel.item_code) == item_code.upper(),
            PutawayTaskModel.status.in_(["PENDING", "IN_PROGRESS", "ASSIGNED", "DRAFT"])
        )
        if user_store_ids:
            pt_query = pt_query.where(PutawayTaskModel.destination_store_id.in_(user_store_ids))
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

    # Locate existing Putaway Task if any
    if task_obj is None:
        res_t = await uow.session.execute(
            select(PutawayTaskModel).where(
                PutawayTaskModel.grn_id == grn.id,
                func.upper(PutawayTaskModel.item_code) == item_code.upper(),
            )
        )
        task_obj = res_t.scalars().first()

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

    # Fetch Dock & Store Manager details
    gate_entry_no = grn.gate_entry_number
    truck_no = grn.vehicle_number
    asn_no = grn.asn_number or (hu_obj.asn_number if hu_obj else None)
    po_no = grn.po_number or (hu_obj.po_number if hu_obj else None)
    supplier_name = grn.supplier_name or grn.supplier_company_name or "Standard Supplier"
    warehouse_id = grn.warehouse_id or "MAIN"
    dock_code = grn.dock_number or (task_obj.source_location if task_obj else "RECEIVING_DOCK")
    assigned_sm = task_obj.assigned_to if task_obj else None
    dest_store_id = str(task_obj.destination_store_id) if task_obj and task_obj.destination_store_id else None
    store_name = None
    store_code = None

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
            if da.assigned_store_manager_name or da.assigned_store_manager_username:
                assigned_sm = da.assigned_store_manager_name or da.assigned_store_manager_username
            if da.dock_number:
                dock_code = da.dock_number

    if task_obj and task_obj.destination_store_id:
        store_obj = await uow.session.get(StoreModel, task_obj.destination_store_id)
        if store_obj:
            store_name = store_obj.store_name
            store_code = store_obj.store_code
            if not assigned_sm:
                assigned_sm = store_obj.store_manager_name

    # Batch number
    if not batch_number:
        if grn_line:
            res_b = await uow.session.execute(select(GrnBatchModel).where(GrnBatchModel.grn_line_id == grn_line.id))
            b_first = res_b.scalars().first()
            if b_first:
                batch_number = b_first.batch_number

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
        "batch_lot_number": batch_number or "BATCH-01",
        "batch_quantity": float(scanned_batch.batch_quantity) if scanned_batch else None,
        "received_quantity": float(received_qty),
        "already_put_away_quantity": float(already_put_away),
        "available_quantity": float(available_qty),
        "uom": uom,
        "supplier_name": supplier_name,
        "warehouse_id": warehouse_id,
        "store_id": dest_store_id,
        "store_name": store_name or "Assigned Store",
        "store_code": store_code or "STORE",
        "gate_entry_number": gate_entry_no or "N/A",
        "truck_number": truck_no or "N/A",
        "dock_code": dock_code,
        "assigned_dock": dock_code,
        "assigned_store_manager": assigned_sm or "Store Manager",
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

    bin_obj: StoreBinModel | None = None
    target_zone: StoreZoneModel | None = None
    target_store: StoreModel | None = None

    # Step 1: Check JSON
    if (raw_scan.startswith("{") and raw_scan.endswith("}")) or (raw_scan.startswith('"{') and raw_scan.endswith('}"')):
        try:
            unquoted = raw_scan[1:-1] if raw_scan.startswith('"{') else raw_scan
            payload = json.loads(unquoted)
            if isinstance(payload, dict):
                bin_id = payload.get("bin_id") or payload.get("id")
                bin_code = payload.get("bin_code") or payload.get("code")
                if bin_id:
                    try:
                        bin_obj = await uow.session.get(StoreBinModel, uuid.UUID(bin_id))
                    except Exception:
                        pass
                if not bin_obj and bin_code:
                    bq = await uow.session.execute(select(StoreBinModel).where(func.upper(StoreBinModel.bin_code) == bin_code.strip().upper()))
                    bin_obj = bq.scalar_one_or_none()
        except Exception:
            pass

    # Step 2: Try UUID lookup
    if bin_obj is None:
        try:
            bin_obj = await uow.session.get(StoreBinModel, uuid.UUID(raw_scan))
        except (ValueError, TypeError):
            pass

    # Step 3: Try exact and cleaned bin_code lookup
    if bin_obj is None:
        cand_code = raw_scan
        if cand_code.upper().startswith("BIN-QR-") or cand_code.upper().startswith("QR-BIN-") or cand_code.upper().startswith("QR-"):
            cand_code = cand_code.split("-", 2)[-1] if "-" in cand_code else cand_code

        bq = await uow.session.execute(
            select(StoreBinModel).where(
                or_(
                    func.upper(StoreBinModel.bin_code) == raw_scan.upper(),
                    func.upper(StoreBinModel.bin_code) == cand_code.upper(),
                    StoreBinModel.bin_code.ilike(f"%{cand_code}%"),
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
            bin_obj = await uow.session.get(StoreBinModel, loc.bin_id)

    if bin_obj is None:
        raise HTTPException(
            status_code=404,
            detail=f"Bin QR code '{raw_scan}' was not found. Please scan a valid destination Bin QR.",
        )

    # Validate active
    if (bin_obj.status or "").upper() not in ("ACTIVE", "AVAILABLE"):
        raise HTTPException(
            status_code=409,
            detail=f"Destination Bin '{bin_obj.bin_code}' is {bin_obj.status} and cannot receive materials.",
        )

    target_zone = await uow.session.get(StoreZoneModel, bin_obj.zone_id) if bin_obj.zone_id else None
    target_store = await uow.session.get(StoreModel, bin_obj.store_id) if bin_obj.store_id else None

    # Check store_id filter if passed
    if request.store_id and bin_obj.store_id != request.store_id:
        raise HTTPException(
            status_code=422,
            detail=f"Bin '{bin_obj.bin_code}' belongs to store '{target_store.store_code if target_store else bin_obj.store_id}', which does not match the required store.",
        )

    # Check user authorization
    roles_upper = {r.upper() for r in (user.roles or [])}
    if "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper and target_store:
        user_store_ids, user_store_codes = await get_user_store_context(user, uow)
        if user_store_ids or user_store_codes:
            if target_store.id not in user_store_ids and target_store.store_code.upper() not in user_store_codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Unauthorized: You are assigned to store '{', '.join(user_store_codes)}', but bin '{bin_obj.bin_code}' belongs to store '{target_store.store_code}'.",
                )

    capacity = float(bin_obj.capacity or 1000)
    occupied = float(bin_obj.occupied_quantity or 0)
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
        "store_id": str(target_store.id) if target_store else None,
        "store_code": target_store.store_code if target_store else "STORE",
        "store_name": target_store.store_name if target_store else "Store",
        "warehouse_id": target_store.warehouse_id if target_store else "MAIN",
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
    is_store_user = bool(roles_upper.intersection({"STORE_MANAGER", "STORE_KEEPER"})) or ("putaway:execute" in (user.permissions or []))

    # Reject Warehouse Manager explicitly
    if ("WAREHOUSE_MANAGER" in roles_upper or "WAREHOUSE" in roles_upper) and not is_store_user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Warehouse Manager is not authorized to execute Putaway. Physical putaway must be performed by the assigned Store Manager.",
        )

    if not is_store_user and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Store Managers or Store Keepers assigned to this Store can execute Putaway.",
        )

    if request.quantity <= 0:
        raise HTTPException(status_code=422, detail="Putaway quantity must be greater than zero")

    # Step 1: Resolve GRN QR strictly on backend
    grn_info = await resolve_grn_qr(ResolveGrnQrRequest(qr_code=request.grn_qr_code), user=user, uow=uow)
    item_code = grn_info["material_code"]
    grn_number = grn_info["grn_number"]
    grn_id = uuid.UUID(grn_info["grn_id"]) if grn_info.get("grn_id") else None
    available_qty = Decimal(str(grn_info["available_quantity"]))
    uom = grn_info["uom"] or "PCS"
    mat_name = grn_info["material_name"]
    warehouse_id = grn_info["warehouse_id"] or "MAIN"

    if request.quantity > available_qty:
        raise HTTPException(
            status_code=422,
            detail=f"Putaway quantity ({request.quantity}) exceeds available quantity ({available_qty} {uom}) for Material '{item_code}'",
        )

    # Step 2: Resolve Bin QR strictly on backend
    bin_info = await resolve_bin_qr(
        ResolveBinQrRequest(bin_scan=request.bin_qr_code, store_id=uuid.UUID(grn_info["store_id"]) if grn_info.get("store_id") else None),
        user=user,
        uow=uow,
    )
    bin_id = uuid.UUID(bin_info["bin_id"])
    target_bin = await uow.session.get(StoreBinModel, bin_id)
    if not target_bin or (target_bin.status or "").upper() not in ("ACTIVE", "AVAILABLE"):
        raise HTTPException(status_code=409, detail="Destination Bin is inactive or not found")

    target_zone = await uow.session.get(StoreZoneModel, target_bin.zone_id) if target_bin.zone_id else None
    target_store = await uow.session.get(StoreModel, target_bin.store_id) if target_bin.store_id else None

    if is_store_user and not is_admin and target_store:
        user_store_ids, user_store_codes = await get_user_store_context(user, uow)
        store_match = False
        if user_store_ids and target_store.id in user_store_ids:
            store_match = True
        elif user_store_codes and target_store.store_code.strip().upper() in {c.strip().upper() for c in user_store_codes}:
            store_match = True
        elif target_store.store_manager_id and (
            target_store.store_manager_id.lower() == (user.username or "").lower()
            or target_store.store_manager_id.lower() == (user.subject or "").lower()
        ):
            store_match = True

        if not store_match:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access forbidden: You can only execute Putaway for your assigned Store ('{target_store.store_code}').",
            )

    # Capacity validation
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
        store_code = target_store.store_code if target_store else "STORE"
        zone_code = target_zone.zone_code if target_zone else "ZONE"
        loc_code = f"LOC-{store_code}-{zone_code}-{target_bin.bin_code}"
        location = StorageLocationModel(
            location_code=loc_code,
            warehouse_id=warehouse_id,
            store_id=target_bin.store_id,
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
    stock_res = await uow.session.execute(
        select(MaterialStockModel).where(MaterialStockModel.material_code == item_code).with_for_update()
    )
    stock = stock_res.scalar_one_or_none()
    if stock is None:
        stock = MaterialStockModel(
            id=uuid.uuid4(),
            material_code=item_code,
            material_name=mat_name,
            category=grn_info.get("material_category") or "General",
            on_hand=Decimal("0.0"),
            allocated=Decimal("0.0"),
            available=Decimal("0.0"),
            uom=uom,
            warehouse_id=warehouse_id,
            reorder_point=Decimal("10.0"),
            updated_at=datetime.datetime.now(),
        )
        uow.session.add(stock)
        await uow.session.flush()

    completed_at = datetime.datetime.now(datetime.timezone.utc)
    available_before = stock.available
    stock.on_hand = stock.on_hand + request.quantity
    stock.available = stock.available + request.quantity
    stock.updated_at = completed_at.replace(tzinfo=None)

    target_bin.occupied_quantity = target_bin.occupied_quantity + request.quantity
    location.occupied_quantity = location.occupied_quantity + request.quantity

    # Step 5: Update InventoryLocationBalanceModel
    bal_res = await uow.session.execute(
        select(InventoryLocationBalanceModel).where(
            InventoryLocationBalanceModel.material_code == item_code,
            InventoryLocationBalanceModel.storage_location_id == location.id,
        ).with_for_update()
    )
    balance = bal_res.scalar_one_or_none()
    if balance is None:
        balance = InventoryLocationBalanceModel(
            material_code=item_code,
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
    task: PutawayTaskModel | None = None
    if task_id:
        task = await uow.session.get(PutawayTaskModel, task_id)
    elif grn_id:
        t_res = await uow.session.execute(
            select(PutawayTaskModel).where(
                PutawayTaskModel.grn_id == grn_id,
                func.upper(PutawayTaskModel.item_code) == item_code.upper(),
            )
        )
        task = t_res.scalars().first()

    remaining_available = max(Decimal("0"), available_qty - request.quantity)
    is_completed = remaining_available <= 0

    if task:
        balance.last_putaway_task_id = task.id
        task.destination_store_id = target_bin.store_id
        task.destination_zone_id = target_bin.zone_id
        task.destination_zone = target_zone.zone_code if target_zone else None
        task.destination_bin_id = target_bin.id
        task.destination_bin = target_bin.bin_code
        task.destination_bin_code = target_bin.bin_code
        task.destination_location_id = location.id

        if is_completed or task.quantity <= request.quantity:
            task.placement_metadata = {**(task.placement_metadata or {}), "putaway_quantity": float(request.quantity if task.quantity <= request.quantity else task.quantity)}
            task.quantity = Decimal("0")
            task.status = "PUTAWAY_COMPLETED"
            task.completed_by = user.username
            task.completed_at = completed_at
        else:
            task.quantity = task.quantity - request.quantity
            task.status = "PUTAWAY_IN_PROGRESS"
            task.started_by = task.started_by or user.username
            task.started_at = task.started_at or completed_at

    # Step 7: Update HandlingUnitModel if present
    if grn_info.get("handling_unit_id"):
        try:
            hu = await uow.session.get(HandlingUnitModel, uuid.UUID(grn_info["handling_unit_id"]))
            if hu:
                hu.current_location = f"{target_zone.zone_code if target_zone else 'STORE'} / {target_bin.bin_code}"
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
            putaway_task_id=task.id if task else uuid.uuid4(),
            material_scan=material_scan_record,
            location_scan=location_scan_record,
            material_code=item_code,
            material_name=mat_name,
            source_location=src_loc_str,
            destination_location=dest_loc_str,
            confirmed_quantity=request.quantity,
            uom=uom,
            inventory_available_before=available_before,
            inventory_available_after=stock.available,
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
            stock_after=stock.available,
            performed_by=user.username,
            user_role=",".join(user.roles or []),
            warehouse_id=warehouse_id,
            store_id=target_bin.store_id,
            store_code=target_store.store_code if target_store else None,
            reference_document=task.task_number if task else (grn_number or "DIRECT_PUTAWAY"),
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
        "inventory_available_after": float(stock.available),
    }

