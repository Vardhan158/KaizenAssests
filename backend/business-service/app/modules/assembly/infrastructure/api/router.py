from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import logging
import re
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.database.session import UnitOfWork, get_uow
from app.modules.assembly.infrastructure.persistence.models import (
    AssemblyMaterialReservationModel,
    AssemblyMaterialConsumptionModel,
    AssemblyScrapModel,
    AssemblyQualityInspectionModel,
    AssemblyReworkOrderModel,
    AssemblyFinishedGoodsModel,
    AssemblyOrderModel,
    AssemblyTeamModel,
    BillOfMaterialsModel,
    BillOfMaterialsItemModel,
)
from app.common.persistence.models import (
    MaterialIssueModel,
    MaterialStockModel,
    MaterialRequestModel,
    MaterialRequestItemModel,
    FinishedGoodsRequestModel,
    NotificationModel,
    PickTaskModel,
)
from app.modules.receiving.infrastructure.persistence.models import (
    GrnModel,
    GrnLineModel,
    GrnBatchModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionModel,
    HandlingUnitModel,
    InventoryIssueTransactionModel,
    InventoryMovementHistoryModel,
    PickupTaskModel,
    PutawayMovementModel,
    PutawayTaskModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import StoreModel, StoreZoneModel, StoreBinModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/assembly", tags=["assembly"])


DEFAULT_ASSEMBLY_STEP_NAMES = [
    "Housing preparation", "PCB installation", "Cable connection",
    "Component installation", "Testing", "Final assembly",
]


PRODUCT_ASSEMBLY_STEP_NAMES = {
    "LAPTOP": [
        "Chassis preparation", "Motherboard installation", "Display installation",
        "Keyboard and trackpad installation", "Battery installation", "Functional testing",
        "Final inspection and packing",
    ],
    "PUMP": [
        "Housing preparation", "Motor installation", "Cable connection",
        "Component installation", "Pressure testing", "Final inspection and packing",
    ],
}


def assembly_step_names(product_name: str | None = None, items: list | None = None) -> list[str]:
    product = (product_name or "").strip().upper()
    for keyword, names in PRODUCT_ASSEMBLY_STEP_NAMES.items():
        if keyword in product:
            return names
    return DEFAULT_ASSEMBLY_STEP_NAMES


def default_assembly_steps(product_name: str | None = None, items: list | None = None) -> list[dict]:
    return [{"id": str(index), "sequence": index, "name": name, "status": "NOT_STARTED", "started_at": None, "completed_at": None}
            for index, name in enumerate(assembly_step_names(product_name, items), start=1)]


def normalize_assembly_steps(order: AssemblyOrderModel) -> list[dict]:
    steps = [dict(step) for step in (order.assembly_steps or [])]
    names = assembly_step_names(order.product_name, order.items)
    is_legacy = not steps or [step.get("name") for step in steps] == DEFAULT_ASSEMBLY_STEP_NAMES
    if not is_legacy:
        return steps
    return [
        {
            **(steps[index - 1] if index <= len(steps) else {}),
            "id": str(index), "sequence": index, "name": name,
            "status": (steps[index - 1].get("status") if index <= len(steps) else "NOT_STARTED"),
        }
        for index, name in enumerate(names, start=1)
    ]


class AssemblyStatusUpdate(BaseModel):
    status: str
    assigned_line: str | None = None
    assigned_operator: str | None = None
    completed_quantity: Decimal | None = Field(default=None, ge=0)
    rejected_quantity: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None


class AssemblyOrderUpdate(BaseModel):
    product_name: str | None = Field(default=None, min_length=1, max_length=255)
    planned_quantity: Decimal | None = Field(default=None, gt=0)
    priority: str | None = None
    required_date: date | None = None
    assigned_team: str | None = None
    notes: str | None = None


class AssemblyStepUpdate(BaseModel):
    status: str


class AssemblyProgressUpdate(BaseModel):
    completed_quantity: Decimal = Field(ge=0)


class MaterialConsumptionUpdate(BaseModel):
    material_code: str = Field(min_length=1, max_length=64)
    expected_per_unit: Decimal = Field(gt=0)
    assembled_quantity: Decimal = Field(ge=0)
    actual_consumed: Decimal = Field(ge=0)
    uom: str = Field(default="PCS", min_length=1, max_length=32)


class AssemblyScrapCreate(BaseModel):
    material_code: str = Field(min_length=1, max_length=64)
    quantity: Decimal = Field(gt=0)
    uom: str = Field(default="PCS", min_length=1, max_length=32)
    reason: str = Field(min_length=1, max_length=1000)
    employee_team: str = Field(min_length=1, max_length=128)
    approval_required: bool = True


class AssemblyScrapApproval(BaseModel):
    approved_by: str = Field(min_length=1, max_length=128)


class AssemblyQualityInspectionUpdate(BaseModel):
    produced_quantity: Decimal = Field(gt=0)
    passed_quantity: Decimal = Field(ge=0)
    failed_quantity: Decimal = Field(ge=0)
    rework_quantity: Decimal = Field(ge=0)
    status: str
    inspected_by: str = Field(min_length=1, max_length=128)
    notes: str | None = Field(default=None, max_length=2000)
    product_code: str | None = Field(default=None, max_length=64)
    warehouse_id: str = Field(default="WH-01", min_length=1, max_length=64)
    location_code: str = Field(default="FG-A-03", min_length=1, max_length=64)


class AssemblyReworkCreate(BaseModel):
    assigned_team: str = Field(min_length=1, max_length=128)
    assigned_worker: str | None = Field(default=None, max_length=128)
    reason_for_failure: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=2000)


class AssemblyReworkUpdate(BaseModel):
    status: str
    assigned_team: str | None = Field(default=None, max_length=128)
    assigned_worker: str | None = Field(default=None, max_length=128)
    notes: str | None = Field(default=None, max_length=2000)


class AssemblyTeamRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    team_leader: str = Field(min_length=1, max_length=128)
    workers: list[str] = Field(default_factory=list)
    shift: str = Field(min_length=1, max_length=64)
    workstation: str = Field(min_length=1, max_length=64)
    active: bool = True


def serialize_team(team: AssemblyTeamModel, orders: list[AssemblyOrderModel]) -> dict:
    active_orders = [order for order in orders if order.assigned_team == team.name and order.status not in {"CLOSED", "COMPLETED", "QUALITY_CHECK"}]
    return {
        "id": str(team.id), "name": team.name, "team_leader": team.team_leader,
        "workers": team.workers or [], "workers_count": len(team.workers or []),
        "shift": team.shift, "workstation": team.workstation, "active": team.active,
        "assigned_orders": [{"id": str(order.id), "order_number": order.order_number,
                             "product_name": order.product_name, "target_quantity": float(order.planned_quantity),
                             "status": order.status} for order in active_orders],
        "current_workload": len(active_orders),
        "target_units": sum(float(order.planned_quantity) for order in active_orders),
        "created_at": team.created_at.isoformat(), "updated_at": team.updated_at.isoformat(),
    }


def calculate_assembly_progress(target: Decimal, completed: Decimal, status: str) -> dict:
    completed = min(max(completed, Decimal("0")), target)
    remaining = max(target - completed, Decimal("0"))
    percentage = round(float(completed / target * 100), 2) if target > 0 else 0.0
    progress_status = "COMPLETED" if status in {"COMPLETED", "QUALITY_CHECK", "CLOSED"} else (
        "PAUSED" if status == "ON_HOLD" else ("IN_PROGRESS" if status == "IN_PROGRESS" else "NOT_STARTED")
    )
    return {"target": float(target), "completed": float(completed), "remaining": float(remaining),
            "progress_percent": percentage, "progress_status": progress_status}


def calculate_material_variance(expected_per_unit: Decimal, assembled_quantity: Decimal, actual_consumed: Decimal) -> dict:
    expected = expected_per_unit * assembled_quantity
    variance = actual_consumed - expected
    variance_percent = round(float(variance / expected * 100), 2) if expected > 0 else 0.0
    status = "OVER_CONSUMPTION" if variance > 0 else ("UNDER_CONSUMPTION" if variance < 0 else "ON_TARGET")
    return {"expected_consumption": float(expected), "actual_consumption": float(actual_consumed),
            "variance_quantity": float(variance), "variance_percent": variance_percent, "status": status}


def validate_quality_quantities(produced: Decimal, passed: Decimal, failed: Decimal,
                                rework: Decimal, status: str) -> str:
    status = status.upper()
    allowed = {"PENDING_INSPECTION", "PASSED", "FAILED", "REWORK_REQUIRED"}
    if status not in allowed:
        raise ValueError(f"Quality status must be one of: {', '.join(sorted(allowed))}")
    if passed + failed + rework != produced:
        raise ValueError("Passed, failed, and rework quantities must equal produced quantity")
    if status == "PASSED" and (passed != produced or failed > 0 or rework > 0):
        raise ValueError("A passed inspection requires every produced unit to pass")
    if status == "FAILED" and failed <= 0:
        raise ValueError("A failed inspection requires at least one failed unit")
    if status == "REWORK_REQUIRED" and rework <= 0:
        raise ValueError("A rework inspection requires at least one rework unit")
    if status == "PENDING_INSPECTION":
        raise ValueError("Use a final inspection status when recording inspected quantities")
    return status


def serialize_quality(inspection: AssemblyQualityInspectionModel, order: AssemblyOrderModel) -> dict:
    return {
        "id": str(inspection.id), "assembly_order_id": str(order.id), "order_number": order.order_number,
        "product_name": order.product_name, "order_status": order.status,
        "produced_quantity": float(inspection.produced_quantity), "passed_quantity": float(inspection.passed_quantity),
        "failed_quantity": float(inspection.failed_quantity), "rework_quantity": float(inspection.rework_quantity),
        "status": inspection.status, "inspected_by": inspection.inspected_by, "notes": inspection.notes,
        "inspected_at": inspection.inspected_at.isoformat() if inspection.inspected_at else None,
        "created_at": inspection.created_at.isoformat(), "updated_at": inspection.updated_at.isoformat(),
    }


def serialize_rework(rework: AssemblyReworkOrderModel, order: AssemblyOrderModel) -> dict:
    return {
        "id": str(rework.id), "assembly_order_id": str(order.id), "assembly_order": order.order_number,
        "rework_number": rework.rework_number, "product_name": order.product_name,
        "reason_for_failure": rework.reason_for_failure, "failed_quantity": float(rework.failed_quantity),
        "assigned_team": rework.assigned_team, "assigned_worker": rework.assigned_worker,
        "status": rework.status, "final_result": rework.final_result, "notes": rework.notes,
        "created_at": rework.created_at.isoformat(),
        "started_at": rework.started_at.isoformat() if rework.started_at else None,
        "completed_at": rework.completed_at.isoformat() if rework.completed_at else None,
        "updated_at": rework.updated_at.isoformat(), "order_status": order.status,
    }


def serialize_finished_goods(record: AssemblyFinishedGoodsModel) -> dict:
    return {
        "id": str(record.id),
        "assembly_order_id": str(record.assembly_order_id),
        "product_code": record.product_code,
        "product_name": record.product_name,
        "quantity": float(record.quantity),
        "uom": record.uom,
        "status": record.status,
        "warehouse": record.warehouse_id,
        "location": record.location_code,
        "qr_code": record.qr_code,
        "serial_number": record.serial_number,
        "store_id": str(record.store_id) if record.store_id else None,
        "on_hand_before": float(record.on_hand_before),
        "on_hand_after": float(record.on_hand_after),
        "posted_at": record.posted_at.isoformat() if record.posted_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


def finished_good_code(product_name: str) -> str:
    slug = re.sub(r"[^A-Z0-9]+", "-", product_name.upper()).strip("-")
    return f"FG-{slug}"[:64] or "FG-ASSEMBLED-PRODUCT"


async def add_assembly_notification(uow: UnitOfWork, title: str, message: str,
                                    order: AssemblyOrderModel | None = None) -> None:
    link = f"/assembly-orders?q={order.order_number}" if order else "/assembly-dashboard"
    exists = await uow.session.scalar(select(NotificationModel.id).where(
        NotificationModel.user_role == "ASSEMBLY_MANAGER",
        NotificationModel.title == title,
        NotificationModel.message == message,
    ))
    if not exists:
        uow.session.add(NotificationModel(
            id=uuid.uuid4(), user_role="ASSEMBLY_MANAGER", title=title, message=message,
            link=link, is_read=False, created_at=datetime.now(),
        ))


async def post_finished_goods(uow: UnitOfWork, order: AssemblyOrderModel, passed_quantity: Decimal,
                              product_code: str | None, warehouse_id: str, location_code: str,
                              now: datetime) -> AssemblyFinishedGoodsModel | None:
    if passed_quantity <= 0:
        return None
    order.putaway_status = "PUTAWAY_PENDING"
    order.updated_at = now
    code = (product_code or finished_good_code(order.product_name)).strip().upper()
    warehouse = warehouse_id.strip().upper()
    location_value = location_code.strip().upper()

    # Finished goods are unit-tracked. Generate one QR/serial per produced
    # unit so the Finished Goods Store can put away each unit individually.
    unit_count = max(1, int(passed_quantity))
    unit_qrs = [
        (f"SN-{order.order_number}-{uuid.uuid4().hex[:6].upper()}")
        for _ in range(unit_count)
    ]
    serial_number = unit_qrs[0]
    qr_code = f"FG-QR|{code}|{unit_qrs[0]}|ORD:{order.order_number}|QTY:1"

    # Resolve Finished Goods Store dynamically
    fg_store_res = await uow.session.execute(
        select(StoreModel).where(
            or_(
                func.upper(StoreModel.store_code) == "STR-FG",
                func.upper(StoreModel.store_name) == "FINISHED GOODS STORE",
            ),
            StoreModel.status == "ACTIVE"
        ).order_by(StoreModel.created_at.asc())
    )
    fg_store = fg_store_res.scalars().first()
    if not fg_store:
        # Finished goods must never be routed into an arbitrary raw-material
        # store. Provision the dedicated store once when an installation has
        # not created it yet; Warehouse and Assembly can then manage it from
        # the normal Store Master / Finished Goods views.
        fg_store = StoreModel(
            id=uuid.uuid4(),
            store_code="STR-FG",
            store_name="Finished Goods Store",
            description="Dedicated store for assembly finished goods",
            warehouse_id=warehouse,
            status="ACTIVE",
            store_type="FINISHED_GOODS",
            created_at=now,
            updated_at=now,
        )
        uow.session.add(fg_store)
        await uow.session.flush()

    # Finished Goods Store is a system-owned operational store. Ensure a
    # usable destination exists even when an installation created only the
    # Store Master record without zones/bins.
    fg_zone = (await uow.session.execute(
        select(StoreZoneModel).where(
            StoreZoneModel.store_id == fg_store.id,
            StoreZoneModel.status == "ACTIVE",
        ).order_by(StoreZoneModel.created_at.asc())
    )).scalars().first()
    if not fg_zone:
        fg_zone = StoreZoneModel(
            id=uuid.uuid4(),
            store_id=fg_store.id,
            zone_code="FG-ZONE-01",
            zone_name="Finished Goods Storage",
            description="Default zone for Assembly finished goods",
            status="ACTIVE",
            created_at=now,
            updated_at=now,
        )
        uow.session.add(fg_zone)
        await uow.session.flush()

    fg_bin = (await uow.session.execute(
        select(StoreBinModel).where(
            StoreBinModel.store_id == fg_store.id,
            StoreBinModel.zone_id == fg_zone.id,
            StoreBinModel.status == "ACTIVE",
        ).order_by(StoreBinModel.created_at.asc())
    )).scalars().first()
    if not fg_bin:
        fg_bin = StoreBinModel(
            id=uuid.uuid4(),
            store_id=fg_store.id,
            zone_id=fg_zone.id,
            bin_code="BIN-FG-01",
            bin_name="Finished Goods Bin 01",
            rack="FG-RACK-01",
            shelf="FG-SHELF-01",
            capacity=Decimal("10000"),
            occupied_quantity=Decimal("0"),
            status="ACTIVE",
            created_at=now,
            updated_at=now,
        )
        uow.session.add(fg_bin)
        await uow.session.flush()

    posting = await uow.session.scalar(select(AssemblyFinishedGoodsModel).where(
        AssemblyFinishedGoodsModel.assembly_order_id == order.id
    ).with_for_update())

    if not posting:
        posting = AssemblyFinishedGoodsModel(
            id=uuid.uuid4(),
            assembly_order_id=order.id,
            product_code=code,
            product_name=order.product_name,
            quantity=passed_quantity,
            uom="PCS",
            status="PUTAWAY_PENDING",
            warehouse_id=warehouse,
            location_code=location_value,
            qr_code=qr_code,
            serial_number=serial_number,
            store_id=fg_store.id if fg_store else None,
            on_hand_before=Decimal("0"),
            on_hand_after=Decimal("0"),
            posted_at=now,
            updated_at=now,
        )
        uow.session.add(posting)
        await uow.session.flush()
    else:
        posting.quantity = passed_quantity
        posting.qr_code = posting.qr_code or qr_code
        posting.serial_number = posting.serial_number or serial_number
        if fg_store:
            posting.store_id = fg_store.id
        posting.updated_at = now

    # Keep the originating request visible as completed by Assembly while the
    # separate warehouse putaway work is still pending.
    request = await uow.session.scalar(select(FinishedGoodsRequestModel).where(
        FinishedGoodsRequestModel.request_number == order.request_number
    ).with_for_update())
    if request:
        request.status = "ASSEMBLY_COMPLETED"
        request.updated_at = now

    # Create one PutawayTaskModel per unit. Existing installations may already
    # have a single aggregate task; leave it intact rather than duplicating it.
    existing_task = await uow.session.scalar(
        select(PutawayTaskModel).where(
            PutawayTaskModel.finished_goods_id == posting.id
        )
    )
    if existing_task:
        existing_tasks = (await uow.session.execute(
            select(PutawayTaskModel).where(PutawayTaskModel.finished_goods_id == posting.id)
        )).scalars().all()
        for task in existing_tasks:
            task.destination_store_id = fg_store.id
            task.destination_zone_id = fg_zone.id
            task.destination_zone = fg_zone.zone_code
            task.destination_bin_id = fg_bin.id
            task.destination_bin = fg_bin.bin_code
            task.destination_bin_code = fg_bin.bin_code
    else:
        task_number = f"PUT-FG-{now.year}-{uuid.uuid4().hex[:6].upper()}"
        for index, serial in enumerate(unit_qrs, start=1):
            unit_qr = f"FG-QR|{code}|{serial}|ORD:{order.order_number}|QTY:1"
            uow.session.add(PutawayTaskModel(
                id=uuid.uuid4(),
                task_number=f"{task_number}-{index:02d}",
                finished_goods_id=posting.id,
                item_code=code,
                material_name=order.product_name,
                quantity=Decimal("1"),
                uom="PCS",
                warehouse_id=warehouse,
                source_location="ASSEMBLY_LINE",
                destination_store_id=fg_store.id if fg_store else None,
                destination_zone_id=fg_zone.id,
                destination_bin_id=fg_bin.id,
                destination_bin_code=fg_bin.bin_code,
                status="PUTAWAY_PENDING",
                placement_metadata={"unit_qr": unit_qr, "unit_serial": serial, "unit_index": index, "unit_count": unit_count},
                created_by=order.assigned_operator or order.created_by or "Assembly",
                created_at=now.astimezone(timezone.utc) if now.tzinfo else now.replace(tzinfo=timezone.utc),
            ))

        # Notify Finished Goods Store Manager
        if fg_store:
            uow.session.add(
                NotificationModel(
                    id=uuid.uuid4(),
                    user_role=f"STR:{fg_store.store_code}"[:32],
                    title=f"New FG Putaway: {unit_count} unit tasks",
                    message=f"Assembly completed {passed_quantity:g} PCS of {order.product_name} ({code}). {unit_count} individual QR putaway tasks are ready for the Finished Goods Store.",
                    link="/my-store?tab=putaway",
                    is_read=False,
                    created_at=now,
                )
            )
        uow.session.add(
            NotificationModel(
                id=uuid.uuid4(),
                user_role="STORE_MANAGER",
                title=f"New Finished Goods Putaway Task",
                message=f"Assembly completed {passed_quantity:g} PCS of {order.product_name} ({code}). Putaway task {task_number} is ready for store putaway.",
                link="/my-store?tab=putaway",
                is_read=False,
                created_at=now,
            )
        )

    await add_assembly_notification(
        uow, "Finished goods sent to FG Store",
        f"{passed_quantity:g} PCS of {order.product_name} from {order.order_number} generated QR {posting.qr_code} and sent to Finished Goods Store for putaway.",
        order,
    )
    return posting



def serialize_consumption(record: AssemblyMaterialConsumptionModel, material_name: str) -> dict:
    return {
        "id": str(record.id), "material_code": record.material_code, "material_name": material_name,
        "expected_per_unit": float(record.expected_per_unit), "assembled_quantity": float(record.assembled_quantity),
        "uom": record.uom, "recorded_by": record.recorded_by, "recorded_at": record.recorded_at.isoformat(),
        **calculate_material_variance(record.expected_per_unit, record.assembled_quantity, record.actual_consumed),
    }


def serialize_order(order: AssemblyOrderModel, quality_status: str | None = None) -> dict:
    progress = calculate_assembly_progress(order.planned_quantity, order.completed_quantity, order.status)
    steps = normalize_assembly_steps(order)
    return {
        "id": str(order.id), "order_number": order.order_number,
        "material_request_id": str(order.material_request_id), "pick_task_id": str(order.pick_task_id),
        "material_issue_id": str(order.material_issue_id), "request_number": order.request_number,
        "department": order.department, "product_name": order.product_name, "items": order.items,
        "priority": order.priority, "required_date": order.required_date.isoformat() if order.required_date else None,
        "assigned_team": order.assigned_team, "materials_count": len(order.items or []),
        "assembly_steps": steps,
        "status": order.status, "quality_status": quality_status,
        "putaway_status": getattr(order, "putaway_status", "PUTAWAY_PENDING"),
        "planned_quantity": float(order.planned_quantity),
        "completed_quantity": float(order.completed_quantity), "rejected_quantity": float(order.rejected_quantity),
        "assigned_line": order.assigned_line, "assigned_operator": order.assigned_operator,
        "notes": order.notes, "created_by": order.created_by, "created_at": order.created_at.isoformat(),
        "started_at": order.started_at.isoformat() if order.started_at else None,
        "completed_at": order.completed_at.isoformat() if order.completed_at else None,
        "updated_at": order.updated_at.isoformat(),
        **progress,
    }


def aggregate_requirements(items: list) -> dict[str, dict]:
    """Combine duplicate component lines before checking or reserving stock."""
    requirements: dict[str, dict] = {}
    for item in items or []:
        material_code = (item.get("material_code") or "").strip()
        quantity = Decimal(str(item.get("quantity") or 0))
        if not material_code or quantity <= 0:
            continue
        requirement = requirements.setdefault(material_code, {"quantity": Decimal("0"), "item": item})
        requirement["quantity"] += quantity
    return requirements


def material_requirement_status(required: Decimal, free_stock: Decimal, reserved: Decimal) -> tuple[str, str]:
    if reserved >= required:
        return "RESERVED", "Reserved ✅"
    if free_stock >= required:
        return "AVAILABLE", "Available ✅"
    return "SHORTAGE", "Shortage ⚠️"


def build_material_issue_lines(requested_items: list, issued_items: list, batches_by_material: dict[str, set[str]] | None = None) -> list[dict]:
    requested = aggregate_requirements(requested_items)
    issued = aggregate_requirements(issued_items)
    batches_by_material = batches_by_material or {}
    lines = []
    for material_code, requirement in requested.items():
        item = requirement["item"]
        requested_qty = requirement["quantity"]
        issued_entry = issued.get(material_code)
        issued_item = issued_entry["item"] if issued_entry else {}
        issued_qty = issued_entry["quantity"] if issued_entry else Decimal("0")
        pending_qty = max(requested_qty - issued_qty, Decimal("0"))
        allocations = issued_item.get("allocations") or item.get("allocations") or []
        locations = sorted({allocation.get("location") for allocation in allocations if allocation.get("location")})
        explicit_batches = issued_item.get("batches") or item.get("batches") or []
        if isinstance(explicit_batches, str):
            explicit_batches = [explicit_batches]
        batches = sorted({str(value) for value in explicit_batches if value} | batches_by_material.get(material_code, set()))
        status = "ISSUED" if issued_qty >= requested_qty else ("PARTIALLY_ISSUED" if issued_qty > 0 else "PENDING")
        lines.append({
            "material_code": material_code, "material_name": item.get("material_name") or material_code,
            "requested_quantity": float(requested_qty), "issued_quantity": float(issued_qty),
            "pending_quantity": float(pending_qty), "uom": item.get("uom") or issued_item.get("uom") or "PCS",
            "batch_lot": batches, "storage_locations": locations, "status": status,
        })
    return lines


async def reserve_order_materials(uow: UnitOfWork, order: AssemblyOrderModel, reserved_at: datetime) -> list[dict]:
    existing_result = await uow.session.execute(
        select(AssemblyMaterialReservationModel).where(
            AssemblyMaterialReservationModel.assembly_order_id == order.id
        )
    )
    existing = existing_result.scalars().all()
    if existing:
        return [{
            "material_code": row.material_code, "reserved": float(row.quantity), "uom": row.uom,
        } for row in existing]

    requirements = aggregate_requirements(order.items or [])
    stocks: dict[str, MaterialStockModel] = {}
    shortages = []
    updates = []
    for material_code, requirement in requirements.items():
        stock = await uow.session.scalar(
            select(MaterialStockModel)
            .where(MaterialStockModel.material_code == material_code)
            .with_for_update()
        )
        required = requirement["quantity"]
        available = stock.available if stock else Decimal("0")
        if available < required:
            shortages.append({
                "material_code": material_code, "required": float(required),
                "available": float(available), "shortage": float(required - available),
            })
        elif stock:
            stocks[material_code] = stock

    if shortages:
        raise HTTPException(
            status_code=409,
            detail={"message": "Insufficient free stock to release assembly order", "shortages": shortages},
        )

    for material_code, requirement in requirements.items():
        stock = stocks[material_code]
        quantity = requirement["quantity"]
        stock.available -= quantity
        stock.allocated += quantity
        stock.updated_at = reserved_at
        item = requirement["item"]
        uow.session.add(AssemblyMaterialReservationModel(
            id=uuid.uuid4(), assembly_order_id=order.id, material_code=material_code,
            quantity=quantity, uom=item.get("uom") or stock.uom, status="RESERVED",
            reserved_by=order.created_by, reserved_at=reserved_at,
        ))
        updates.append({
            "material_code": material_code, "material_name": stock.material_name,
            "available": float(stock.on_hand), "reserved": float(quantity),
            "free_stock": float(stock.available), "uom": item.get("uom") or stock.uom,
        })
    return updates


async def create_order_for_issue(uow: UnitOfWork, task: PickTaskModel, issue: MaterialIssueModel) -> AssemblyOrderModel:
    existing = await uow.session.scalar(select(AssemblyOrderModel).where(AssemblyOrderModel.material_issue_id == issue.id))
    if existing:
        return existing
    now = datetime.now()
    count = await uow.session.scalar(select(func.count(AssemblyOrderModel.id))) or 0
    order = AssemblyOrderModel(
        id=uuid.uuid4(), order_number=f"AO-{now.year}-{count + 1:04d}", material_request_id=task.request_id,
        pick_task_id=task.id, material_issue_id=issue.id, request_number=task.request_number,
        department=task.department, product_name=task.department or "Assembly Order", items=task.items,
        # The source pick task has already been issued to production, so these
        # materials are ready for assembly and must not be reserved a second time.
        status="READY", priority="MEDIUM", required_date=None, assigned_team=None,
        assembly_steps=default_assembly_steps(),
        planned_quantity=Decimal("1"), completed_quantity=Decimal("0"),
        rejected_quantity=Decimal("0"), created_by=issue.received_by, created_at=now, updated_at=now,
    )
    uow.session.add(order)
    await uow.session.flush()
    await add_assembly_notification(uow, "New assembly order created",
                                    f"{order.order_number} was created for {order.product_name}.", order)
    await add_assembly_notification(uow, "Material issued",
                                    f"Materials for {order.order_number} were issued under {issue.issue_number}.", order)
    return order


async def backfill_issued_orders(uow: UnitOfWork) -> None:
    result = await uow.session.execute(select(MaterialIssueModel, PickTaskModel).join(PickTaskModel, PickTaskModel.id == MaterialIssueModel.pick_task_id))
    changed = False
    for issue, task in result.all():
        exists = await uow.session.scalar(select(AssemblyOrderModel.id).where(AssemblyOrderModel.material_issue_id == issue.id))
        if not exists:
            await create_order_for_issue(uow, task, issue)
            changed = True

    # A Procurement Finished Goods Request is an assembly demand signal even
    # before component materials are issued. Material/pick/issue placeholders
    # keep the existing AssemblyOrder schema intact and make this handoff
    # idempotent across refreshes.
    fgr_result = await uow.session.execute(select(FinishedGoodsRequestModel).where(
        FinishedGoodsRequestModel.status.in_(["SENT_TO_ASSEMBLY", "IN_PROGRESS"])
    ))
    active_team = await uow.session.scalar(select(AssemblyTeamModel).where(
        AssemblyTeamModel.active.is_(True)
    ).order_by(AssemblyTeamModel.name))
    for fgr in fgr_result.scalars().all():
        existing_order = await uow.session.scalar(select(AssemblyOrderModel).where(
            AssemblyOrderModel.request_number == fgr.request_number
        ))
        if existing_order:
            # Keep the request lifecycle aligned with the order lifecycle. This
            # also repairs requests created before the handoff status was added.
            if fgr.status == "SENT_TO_ASSEMBLY":
                fgr.status = "IN_PROGRESS"
                fgr.updated_at = datetime.now()
            continue
        now = datetime.now()
        request_id, pick_id, issue_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        uow.session.add(MaterialRequestModel(
            id=request_id, request_number=fgr.request_number, warehouse_id=fgr.warehouse_id,
            department="Assembly", requested_by=fgr.requested_by, status="PENDING",
            priority="MEDIUM", required_date=fgr.required_date, attachments=[],
            approval_history=[], remarks=f"Finished Goods Request {fgr.request_number}",
            created_at=fgr.created_at, updated_at=now,
        ))
        # Persist the parent before creating the dependent pick task. These
        # models are connected through scalar foreign keys, so explicit flushes
        # keep the insert order deterministic.
        await uow.session.flush()
        uow.session.add(PickTaskModel(
            id=pick_id, task_number=f"PT-{now.year}-{uuid.uuid4().hex[:6].upper()}",
            request_id=request_id, request_number=fgr.request_number, warehouse_id=fgr.warehouse_id,
            department="Assembly", items=[], status="OPEN", destination="Assembly Production Area",
            created_by=fgr.requested_by, created_at=fgr.created_at,
        ))
        await uow.session.flush()
        uow.session.add(MaterialIssueModel(
            id=issue_id, issue_number=f"MI-{now.year}-{uuid.uuid4().hex[:6].upper()}",
            pick_task_id=pick_id, request_id=request_id, department="Assembly", items=[],
            issued_by="Procurement Handoff", received_by=fgr.requested_by, issued_at=fgr.created_at,
        ))
        await uow.session.flush()
        count = await uow.session.scalar(select(func.count(AssemblyOrderModel.id))) or 0
        order = AssemblyOrderModel(
            id=uuid.uuid4(), order_number=f"AO-{now.year}-{count + 1:04d}",
            material_request_id=request_id, pick_task_id=pick_id, material_issue_id=issue_id,
            request_number=fgr.request_number, department="Assembly", product_name=fgr.finished_goods_name,
            items=[], status="READY", priority="HIGH" if fgr.required_date <= now.date() else "MEDIUM",
            required_date=fgr.required_date or now.date(), assigned_team=active_team.name if active_team else None,
            assembly_steps=default_assembly_steps(), planned_quantity=fgr.quantity,
            completed_quantity=Decimal("0"), rejected_quantity=Decimal("0"),
            created_by=fgr.requested_by, created_at=fgr.created_at, updated_at=now,
        )
        uow.session.add(order)
        fgr.status = "IN_PROGRESS"
        fgr.updated_at = now
        count += 1
        changed = True
        await add_assembly_notification(uow, "New assembly order created",
            f"{order.order_number} was created for {order.product_name} ({order.planned_quantity:g} {fgr.uom}) from {fgr.request_number}.", order)

    # Backfill completed AssemblyRequisitionModel
    # Current Store pickup flow marks a requisition PICKED_UP after every
    # assigned pickup task is completed. Keep the older statuses for records
    # created by previous workflow versions, but include PICKED_UP so the
    # Assembly Orders page reflects completed backend handoffs.
    ar_stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
        AssemblyRequisitionModel.status.in_(["COMPLETED", "PICKED_UP", "ISSUED", "MATERIAL_ISSUED"])
    )
    ar_res = await uow.session.execute(ar_stmt)
    completed_ars = ar_res.scalars().all()
    existing_material_request_ids = set((await uow.session.execute(
        select(AssemblyOrderModel.material_request_id)
    )).scalars().all())
    for ar in completed_ars:
        existing_ao = await uow.session.scalar(
            select(AssemblyOrderModel).where(AssemblyOrderModel.request_number == ar.requisition_number)
        )
        if not existing_ao:
            team_res = await uow.session.execute(select(AssemblyTeamModel).where(AssemblyTeamModel.active.is_(True)))
            active_team = team_res.scalars().first()
            team_name = active_team.name if active_team else "Alpha Assembly"
            if not active_team:
                now_team = datetime.now()
                new_team = AssemblyTeamModel(
                    id=uuid.uuid4(),
                    name="Alpha Assembly",
                    team_leader="John Assembly",
                    workers=["Worker 1", "Worker 2"],
                    shift="Morning",
                    workstation="LINE-01",
                    active=True,
                    created_at=now_team,
                    updated_at=now_team,
                )
                uow.session.add(new_team)
                await uow.session.flush()

            # Find matching FGR if any
            fgr = None
            if "FGR-" in (ar.remarks or ""):
                match = re.search(r"FGR-\d{8}-\d{4}", ar.remarks)
                if match:
                    fgr = await uow.session.scalar(
                        select(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.request_number == match.group(0))
                    )
            product_name = (fgr.finished_goods_name if fgr else None) or "PUMP-100"
            if "PUMP-100" in (ar.remarks or ""):
                product_name = "PUMP-100"
            planned_qty = (fgr.quantity if fgr else None) or Decimal("10.0")
            if fgr:
                available_fg = Decimal("0")
                fg_code = (fgr.finished_goods_code or "").strip().upper()
                fg_name = (fgr.finished_goods_name or "").strip().upper()
                fg_filters = []
                if fg_code:
                    fg_filters.append(func.upper(AssemblyFinishedGoodsModel.product_code) == fg_code)
                if fg_name:
                    fg_filters.append(func.upper(AssemblyFinishedGoodsModel.product_name) == fg_name)
                if fg_filters:
                    available_fg = Decimal(str(await uow.session.scalar(
                        select(func.coalesce(func.sum(AssemblyFinishedGoodsModel.quantity), Decimal("0")))
                        .join(StoreModel, StoreModel.id == AssemblyFinishedGoodsModel.store_id)
                        .where(
                            or_(*fg_filters),
                            AssemblyFinishedGoodsModel.status.in_(["AVAILABLE", "PUTAWAY_COMPLETED", "IN_STORE", "COMPLETED", "STORED"]),
                            StoreModel.status == "ACTIVE",
                            or_(func.upper(StoreModel.store_type) == "FINISHED_GOODS", StoreModel.store_name.ilike("%Finished Goods%")),
                        )
                    ) or 0))
                planned_qty = max(Decimal("0"), planned_qty - available_fg)
                if planned_qty <= 0:
                    continue

            mr = await uow.session.scalar(
                select(MaterialRequestModel).where(
                    or_(
                        MaterialRequestModel.remarks.ilike(f"%{ar.requisition_number}%"),
                        MaterialRequestModel.request_number.ilike(f"%{ar.requisition_number}%"),
                    )
                )
            )
            if not mr:
                mr = await uow.session.scalar(select(MaterialRequestModel).order_by(MaterialRequestModel.created_at.desc()))
            mr_id = mr.id if mr else uuid.uuid4()
            # A legacy requisition may not have a directly linked Material
            # Request. Never reuse the latest arbitrary request for multiple
            # requisitions because AssemblyOrder.material_request_id is unique.
            if mr_id in existing_material_request_ids:
                continue
            now = datetime.now()

            items_list = [
                {
                    "material_code": it.material_code,
                    "material_name": it.material_name,
                    "quantity": float(it.requested_quantity),
                    "uom": it.uom,
                }
                for it in (ar.items or [])
            ]

            # This backfill runs whenever Assembly Orders are read. Reuse the
            # existing legacy task/issue because pick_task.request_id is
            # unique; inserting a new pair on every read causes a 500.
            pt = await uow.session.scalar(select(PickTaskModel).where(
                or_(
                    PickTaskModel.request_id == mr_id,
                    PickTaskModel.request_number == ar.requisition_number,
                )
            ).order_by(PickTaskModel.created_at.asc()))
            if not pt:
                pt = PickTaskModel(
                    id=uuid.uuid4(),
                    task_number=f"PT-{now.year}-{uuid.uuid4().hex[:6].upper()}",
                    request_id=mr_id,
                    request_number=ar.requisition_number,
                    warehouse_id=ar.warehouse_id,
                    department=ar.department,
                    items=items_list,
                    status="COMPLETED",
                    destination="Assembly Production Area",
                    created_by=ar.requested_by,
                    created_at=now,
                )
                uow.session.add(pt)
                await uow.session.flush()

            mi = await uow.session.scalar(select(MaterialIssueModel).where(
                MaterialIssueModel.pick_task_id == pt.id
            ))
            if not mi:
                mi = MaterialIssueModel(
                    id=uuid.uuid4(),
                    issue_number=f"MI-{now.year}-{uuid.uuid4().hex[:6].upper()}",
                    pick_task_id=pt.id,
                    request_id=mr_id,
                    department=ar.department,
                    items=items_list,
                    issued_by="Store Keeper",
                    received_by=ar.requested_by,
                    issued_at=now,
                )
                uow.session.add(mi)
                await uow.session.flush()

            # Assembly orders also have unique links to the material request,
            # pick task, and material issue. A legacy record may already use
            # one of those links even when request_number does not match, so
            # check all three before inserting the backfilled order.
            existing_linked_order = await uow.session.scalar(select(AssemblyOrderModel.id).where(
                or_(
                    AssemblyOrderModel.material_request_id == mr_id,
                    AssemblyOrderModel.pick_task_id == pt.id,
                    AssemblyOrderModel.material_issue_id == mi.id,
                )
            ))
            if existing_linked_order:
                continue

            count = await uow.session.scalar(select(func.count(AssemblyOrderModel.id))) or 0
            order = AssemblyOrderModel(
                id=uuid.uuid4(),
                order_number=f"AO-{now.year}-{count + 1:04d}",
                material_request_id=mr_id,
                pick_task_id=pt.id,
                material_issue_id=mi.id,
                request_number=ar.requisition_number,
                department=ar.department,
                product_name=product_name,
                items=items_list,
                status="READY",
                priority=ar.priority or "MEDIUM",
                required_date=ar.required_date,
                assigned_team=team_name,
                assembly_steps=default_assembly_steps(),
                planned_quantity=planned_qty,
                completed_quantity=Decimal("0"),
                rejected_quantity=Decimal("0"),
                created_by=ar.requested_by,
                created_at=now,
                updated_at=now,
            )
            uow.session.add(order)
            existing_material_request_ids.add(mr_id)
            changed = True
            await add_assembly_notification(
                uow, "New assembly order created",
                f"{order.order_number} was created for {order.product_name} ({order.planned_quantity:g} PCS) from {ar.requisition_number}.", order
            )

    if changed:
        await uow.commit()


@router.get("/teams")
async def list_assembly_teams(uow: UnitOfWork = Depends(get_uow)):
    teams_result = await uow.session.execute(select(AssemblyTeamModel).order_by(AssemblyTeamModel.name))
    orders_result = await uow.session.execute(select(AssemblyOrderModel))
    orders = list(orders_result.scalars().all())
    return [serialize_team(team, orders) for team in teams_result.scalars().all()]


@router.post("/teams", status_code=201)
async def create_assembly_team(request: AssemblyTeamRequest, uow: UnitOfWork = Depends(get_uow)):
    name = request.name.strip()
    if await uow.session.scalar(select(AssemblyTeamModel.id).where(func.lower(AssemblyTeamModel.name) == name.lower())):
        raise HTTPException(status_code=409, detail="Assembly team name already exists")
    now = datetime.now()
    workers = list(dict.fromkeys(worker.strip() for worker in request.workers if worker.strip()))
    team = AssemblyTeamModel(
        id=uuid.uuid4(), name=name, team_leader=request.team_leader.strip(), workers=workers,
        shift=request.shift.strip(), workstation=request.workstation.strip().upper(), active=request.active,
        created_at=now, updated_at=now,
    )
    uow.session.add(team)
    await uow.commit()
    return serialize_team(team, [])


@router.patch("/teams/{team_id}")
async def update_assembly_team(team_id: uuid.UUID, request: AssemblyTeamRequest, uow: UnitOfWork = Depends(get_uow)):
    team = await uow.session.get(AssemblyTeamModel, team_id, with_for_update=True)
    if not team:
        raise HTTPException(status_code=404, detail="Assembly team not found")
    name = request.name.strip()
    duplicate = await uow.session.scalar(select(AssemblyTeamModel.id).where(
        func.lower(AssemblyTeamModel.name) == name.lower(), AssemblyTeamModel.id != team.id
    ))
    if duplicate:
        raise HTTPException(status_code=409, detail="Assembly team name already exists")
    old_name = team.name
    team.name = name
    team.team_leader = request.team_leader.strip()
    team.workers = list(dict.fromkeys(worker.strip() for worker in request.workers if worker.strip()))
    team.shift = request.shift.strip()
    team.workstation = request.workstation.strip().upper()
    team.active = request.active
    team.updated_at = datetime.now()
    orders_result = await uow.session.execute(select(AssemblyOrderModel).where(AssemblyOrderModel.assigned_team == old_name))
    orders = list(orders_result.scalars().all())
    for order in orders:
        order.assigned_team = name
    await uow.commit()
    return serialize_team(team, orders)


@router.get("/orders")
async def list_orders(uow: UnitOfWork = Depends(get_uow)):
    await backfill_issued_orders(uow)
    result = await uow.session.execute(select(AssemblyOrderModel).order_by(AssemblyOrderModel.created_at.desc()))
    orders = list(result.scalars().all())
    inspections = (await uow.session.execute(select(AssemblyQualityInspectionModel))).scalars().all()
    quality_by_order = {inspection.assembly_order_id: inspection.status for inspection in inspections}
    return [serialize_order(order, quality_by_order.get(order.id)) for order in orders]


@router.get("/orders/{order_id}")
async def get_order(order_id: uuid.UUID, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    quality_status = await uow.session.scalar(select(AssemblyQualityInspectionModel.status).where(
        AssemblyQualityInspectionModel.assembly_order_id == order.id
    ))
    return serialize_order(order, quality_status)


@router.patch("/orders/{order_id}")
async def update_order(order_id: uuid.UUID, request: AssemblyOrderUpdate, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id, with_for_update=True)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    if order.status not in {"DRAFT", "RELEASED", "MATERIAL_CHECK", "READY"}:
        raise HTTPException(status_code=409, detail="Order details cannot be edited after assembly starts")
    if request.priority is not None:
        priority = request.priority.upper()
        if priority not in {"LOW", "MEDIUM", "HIGH", "URGENT"}:
            raise HTTPException(status_code=422, detail="Priority must be LOW, MEDIUM, HIGH, or URGENT")
        order.priority = priority
    if request.product_name is not None: order.product_name = request.product_name.strip()
    if request.planned_quantity is not None: order.planned_quantity = request.planned_quantity
    if request.required_date is not None: order.required_date = request.required_date
    if request.assigned_team is not None:
        assigned_team = request.assigned_team.strip() or None
        if assigned_team and not await uow.session.scalar(select(AssemblyTeamModel.id).where(
            AssemblyTeamModel.name == assigned_team, AssemblyTeamModel.active.is_(True)
        )):
            raise HTTPException(status_code=422, detail="Select an active assembly team")
        order.assigned_team = assigned_team
    if request.notes is not None: order.notes = request.notes.strip() or None
    order.updated_at = datetime.now()
    await uow.commit()
    return serialize_order(order)


@router.patch("/orders/{order_id}/status")
async def update_order_status(order_id: uuid.UUID, request: AssemblyStatusUpdate, uow: UnitOfWork = Depends(get_uow)):
    transitions = {
        # READY is retained here for orders created before issued-material
        # assembly orders began opening directly in the ready state.
        "DRAFT": {"RELEASED", "READY"}, "RELEASED": {"MATERIAL_CHECK"},
        "MATERIAL_CHECK": {"READY", "MATERIAL_SHORTAGE"}, "MATERIAL_SHORTAGE": {"MATERIAL_CHECK"},
        "READY": {"IN_PROGRESS"}, "IN_PROGRESS": {"COMPLETED", "ON_HOLD"},
        "ON_HOLD": {"IN_PROGRESS"}, "COMPLETED": {"QUALITY_CHECK"},
        "QUALITY_CHECK": {"CLOSED", "IN_PROGRESS"}, "CLOSED": set(),
    }
    status = request.status.upper()
    if status not in transitions:
        raise HTTPException(status_code=422, detail=f"Unknown assembly status: {status}")
    order = await uow.session.get(AssemblyOrderModel, order_id, with_for_update=True)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    current = order.status.upper()
    if status not in transitions.get(current, set()):
        next_values = ", ".join(sorted(transitions.get(current, set()))) or "none"
        raise HTTPException(status_code=409, detail=f"{current} can only move to: {next_values}")
    now = datetime.now()
    reservation_updates = []

    if status == "IN_PROGRESS" and not order.assigned_team:
        raise HTTPException(status_code=409, detail="Assign an assembly team before starting the work order")
    if current == "QUALITY_CHECK" and status in {"CLOSED", "IN_PROGRESS"}:
        inspection = await uow.session.scalar(select(AssemblyQualityInspectionModel).where(
            AssemblyQualityInspectionModel.assembly_order_id == order.id
        ))
        if not inspection:
            raise HTTPException(status_code=409, detail="Record the quality inspection result first")
        if status == "CLOSED" and inspection.status != "PASSED":
            raise HTTPException(status_code=409, detail="Only an order that passed quality inspection can be closed")
        if status == "IN_PROGRESS" and inspection.status not in {"FAILED", "REWORK_REQUIRED"}:
            raise HTTPException(status_code=409, detail="Only failed or rework-required inspections can return to assembly")
        if status == "IN_PROGRESS" and not await uow.session.scalar(select(AssemblyReworkOrderModel.id).where(
            AssemblyReworkOrderModel.assembly_order_id == order.id,
            AssemblyReworkOrderModel.status.in_({"PENDING", "IN_PROGRESS"}),
        )):
            raise HTTPException(status_code=409, detail="Create a rework order before returning the assembly to the team")

    if status == "RELEASED":
        reservation_updates = await reserve_order_materials(uow, order, now)

    # Automatic material check logic
    if status == "MATERIAL_CHECK":
        all_available = True
        reservation_result = await uow.session.execute(
            select(AssemblyMaterialReservationModel).where(
                AssemblyMaterialReservationModel.assembly_order_id == order.id,
                AssemblyMaterialReservationModel.status == "RESERVED",
            )
        )
        reservations = {row.material_code: row.quantity for row in reservation_result.scalars().all()}
        for material_code, requirement in aggregate_requirements(order.items or []).items():
            required_qty = requirement["quantity"]
            stock = await uow.session.scalar(
                select(MaterialStockModel).where(MaterialStockModel.material_code == material_code)
            )
            available_qty = (stock.available if stock else Decimal("0")) + reservations.get(material_code, Decimal("0"))
            if available_qty < required_qty:
                all_available = False
                break

        status = "READY" if all_available else "MATERIAL_SHORTAGE"

    order.status = status
    if request.assigned_line is not None: order.assigned_line = request.assigned_line.strip() or None
    if request.assigned_operator is not None: order.assigned_operator = request.assigned_operator.strip() or None
    if request.completed_quantity is not None: order.completed_quantity = request.completed_quantity
    if request.rejected_quantity is not None: order.rejected_quantity = request.rejected_quantity
    if request.notes is not None: order.notes = request.notes.strip() or None
    if status == "IN_PROGRESS" and not order.started_at: order.started_at = now
    if status == "COMPLETED":
        order.completed_at = now
        if request.completed_quantity is None: order.completed_quantity = order.planned_quantity
    if status == "QUALITY_CHECK":
        inspection = await uow.session.scalar(select(AssemblyQualityInspectionModel).where(
            AssemblyQualityInspectionModel.assembly_order_id == order.id
        ))
        if not inspection:
            inspection = AssemblyQualityInspectionModel(
                id=uuid.uuid4(), assembly_order_id=order.id, produced_quantity=order.completed_quantity,
                passed_quantity=Decimal("0"), failed_quantity=Decimal("0"), rework_quantity=Decimal("0"),
                status="PENDING_INSPECTION", created_at=now, updated_at=now,
            )
            uow.session.add(inspection)
        else:
            inspection.produced_quantity = order.completed_quantity
            inspection.passed_quantity = Decimal("0")
            inspection.failed_quantity = Decimal("0")
            inspection.rework_quantity = Decimal("0")
            inspection.status = "PENDING_INSPECTION"
            inspection.inspected_by = None
            inspection.notes = None
            inspection.inspected_at = None
            inspection.updated_at = now
        await add_assembly_notification(uow, "Quality inspection pending",
                                        f"{order.order_number} is awaiting finished assembly inspection.", order)
    if status == "MATERIAL_SHORTAGE":
        await add_assembly_notification(uow, "Material shortage",
                                        f"{order.order_number} cannot proceed because required material is short.", order)
    if status == "COMPLETED":
        await add_assembly_notification(uow, "Assembly completed",
                                        f"Assembly work for {order.order_number} is complete.", order)
    order.updated_at = now
    await uow.commit()
    response = serialize_order(order)
    if reservation_updates:
        response["reservation"] = {
            "status": "RESERVED", "materials": reservation_updates,
            "materials_count": len(reservation_updates), "reserved_at": now.isoformat(),
        }
    return response


@router.get("/orders/{order_id}/quality-inspection")
async def get_quality_inspection(order_id: uuid.UUID, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    inspection = await uow.session.scalar(select(AssemblyQualityInspectionModel).where(
        AssemblyQualityInspectionModel.assembly_order_id == order.id
    ))
    if not inspection:
        now = datetime.now()
        inspection = AssemblyQualityInspectionModel(
            id=uuid.uuid4(), assembly_order_id=order.id, produced_quantity=order.completed_quantity,
            passed_quantity=Decimal("0"), failed_quantity=Decimal("0"), rework_quantity=Decimal("0"),
            status="PENDING_INSPECTION", created_at=now, updated_at=now,
        )
        uow.session.add(inspection)
        await uow.commit()
    response = serialize_quality(inspection, order)
    finished_goods = await uow.session.scalar(select(AssemblyFinishedGoodsModel).where(
        AssemblyFinishedGoodsModel.assembly_order_id == order.id
    ))
    response["finished_goods"] = serialize_finished_goods(finished_goods) if finished_goods else None
    return response


@router.put("/orders/{order_id}/quality-inspection")
async def record_quality_inspection(order_id: uuid.UUID, request: AssemblyQualityInspectionUpdate,
                                    uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id, with_for_update=True)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    if order.status != "QUALITY_CHECK":
        raise HTTPException(status_code=409, detail="Send the completed assembly order to quality before inspection")
    if request.produced_quantity != order.completed_quantity:
        raise HTTPException(status_code=422, detail="Produced quantity must match the completed assembly quantity")
    try:
        status = validate_quality_quantities(
            request.produced_quantity, request.passed_quantity, request.failed_quantity,
            request.rework_quantity, request.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    inspection = await uow.session.scalar(select(AssemblyQualityInspectionModel).where(
        AssemblyQualityInspectionModel.assembly_order_id == order.id
    ))
    now = datetime.now()
    if not inspection:
        inspection = AssemblyQualityInspectionModel(id=uuid.uuid4(), assembly_order_id=order.id, created_at=now)
        uow.session.add(inspection)
    inspection.produced_quantity = request.produced_quantity
    inspection.passed_quantity = request.passed_quantity
    inspection.failed_quantity = request.failed_quantity
    inspection.rework_quantity = request.rework_quantity
    inspection.status = status
    inspection.inspected_by = request.inspected_by.strip()
    inspection.notes = request.notes.strip() if request.notes and request.notes.strip() else None
    inspection.inspected_at = now
    inspection.updated_at = now
    order.rejected_quantity = request.failed_quantity
    order.updated_at = now
    latest_rework = await uow.session.scalar(select(AssemblyReworkOrderModel).where(
        AssemblyReworkOrderModel.assembly_order_id == order.id,
        AssemblyReworkOrderModel.status == "COMPLETED",
        AssemblyReworkOrderModel.final_result == "PENDING_INSPECTION",
    ).order_by(AssemblyReworkOrderModel.created_at.desc()))
    if latest_rework:
        latest_rework.final_result = status
        latest_rework.updated_at = now
    if status == "FAILED":
        await add_assembly_notification(uow, "Quality failed",
                                        f"{order.order_number} failed quality inspection for {request.failed_quantity:g} units.", order)
    if status == "REWORK_REQUIRED":
        await add_assembly_notification(uow, "Rework required",
                                        f"{order.order_number} requires rework for {request.rework_quantity:g} units.", order)
    finished_goods = await post_finished_goods(
        uow, order, request.passed_quantity, request.product_code,
        request.warehouse_id, request.location_code, now,
    )
    await uow.commit()
    response = serialize_quality(inspection, order)
    response["finished_goods"] = serialize_finished_goods(finished_goods) if finished_goods else None
    return response


@router.get("/finished-goods")
async def list_finished_goods(uow: UnitOfWork = Depends(get_uow)):
    result = await uow.session.execute(select(AssemblyFinishedGoodsModel).order_by(
        AssemblyFinishedGoodsModel.updated_at.desc()
    ))
    records = result.scalars().all()
    stores = {s.id: s for s in (await uow.session.execute(select(StoreModel))).scalars().all()}
    orders = {o.id: o for o in (await uow.session.execute(select(AssemblyOrderModel))).scalars().all()}
    output = []
    for r in records:
        data = serialize_finished_goods(r)
        if r.store_id and r.store_id in stores:
            data["store_name"] = stores[r.store_id].store_name
            data["store_code"] = stores[r.store_id].store_code
        if r.assembly_order_id and r.assembly_order_id in orders:
            data["order_number"] = orders[r.assembly_order_id].order_number
        output.append(data)
    return output


def serialize_bom(bom: BillOfMaterialsModel) -> dict:
    if not bom:
        return None
    return {
        "id": str(bom.id),
        "bom_number": bom.bom_number,
        "product_code": bom.product_code,
        "product_name": bom.product_name,
        "description": bom.description,
        "status": bom.status,
        "created_by": bom.created_by,
        "created_at": bom.created_at.isoformat() if bom.created_at else None,
        "updated_at": bom.updated_at.isoformat() if bom.updated_at else None,
        "items": [
            {
                "id": str(item.id),
                "bom_id": str(item.bom_id),
                "material_id": str(item.material_id) if item.material_id else None,
                "material_code": item.material_code,
                "material_name": item.material_name,
                "variant_code": item.variant_code,
                "quantity_per_unit": float(item.quantity_per_unit),
                "uom": item.uom or "PCS",
                "notes": item.notes,
            }
            for item in (bom.items or [])
        ],
    }


async def _serialize_assembly_fg_request(req: FinishedGoodsRequestModel, uow: UnitOfWork) -> dict:
    fg_available = Decimal("0")
    try:
        from app.modules.storage.infrastructure.persistence.models import InventoryLocationBalanceModel
        fg_conditions = []
        if req.finished_goods_code:
            fg_conditions.append(func.upper(InventoryLocationBalanceModel.material_code) == req.finished_goods_code.strip().upper())
        if req.finished_goods_name:
            fg_conditions.append(func.upper(InventoryLocationBalanceModel.material_name) == req.finished_goods_name.strip().upper())

        if fg_conditions:
            fg_query = select(func.coalesce(func.sum(InventoryLocationBalanceModel.available_quantity), Decimal("0"))).where(
                or_(*fg_conditions),
            )
            fg_res = await uow.session.execute(fg_query)
            fg_available = Decimal(str(fg_res.scalar() or 0))
    except Exception as e:
        logger.warning(f"Error calculating FG store availability: {e}")

    # Check if a BOM already exists for this finished good product
    bom_obj = None
    try:
        bom_conditions = []
        if req.finished_goods_code:
            bom_conditions.append(func.upper(BillOfMaterialsModel.product_code) == req.finished_goods_code.strip().upper())
        if req.finished_goods_name:
            bom_conditions.append(func.lower(func.trim(BillOfMaterialsModel.product_name)) == func.lower(func.trim(req.finished_goods_name)))

        if bom_conditions:
            bom_res = await uow.session.execute(
                select(BillOfMaterialsModel)
                .options(selectinload(BillOfMaterialsModel.items))
                .where(BillOfMaterialsModel.status == "ACTIVE", or_(*bom_conditions))
                .order_by(BillOfMaterialsModel.created_at.desc())
            )
            bom_obj = bom_res.scalars().first()
    except Exception as e:
        logger.warning(f"Error checking BOM for FG request: {e}")

    has_bom = bom_obj is not None
    bom_data = serialize_bom(bom_obj) if bom_obj else None

    req_qty = Decimal(str(req.quantity or 0))
    shortage = max(Decimal("0"), req_qty - fg_available)

    return {
        "id": str(req.id),
        "request_number": req.request_number,
        "warehouse_id": req.warehouse_id,
        "finished_goods_code": req.finished_goods_code,
        "product_code": req.finished_goods_code,
        "finished_goods_name": req.finished_goods_name,
        "product_name": req.finished_goods_name,
        "quantity": float(req_qty),
        "requested_quantity": float(req_qty),
        "uom": req.uom or "PCS",
        "required_date": req.required_date.isoformat() if req.required_date else None,
        "requested_by": req.requested_by,
        "requested_date": req.requested_date.isoformat() if getattr(req, "requested_date", None) else (req.created_at.date().isoformat() if req.created_at else None),
        "created_by": req.requested_by,
        "status": req.status,
        "bom_attachment_url": req.bom_attachment_url,
        "bom_attachment_name": req.bom_attachment_name,
        "remarks": req.remarks,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "updated_at": req.updated_at.isoformat() if req.updated_at else None,
        "fg_store_available": float(fg_available),
        "available_quantity": float(fg_available),
        "shortage": float(shortage),
        "shortage_quantity": float(shortage),
        "has_bom": has_bom,
        "bom": bom_data,
    }


@router.get("/finished-goods-requests")
async def list_assembly_finished_goods_requests(
    uow: UnitOfWork = Depends(get_uow),
):
    """
    Assembly view of Finished Goods Requests with FG Store availability check data.
    """
    res = await uow.session.execute(
        select(FinishedGoodsRequestModel).order_by(FinishedGoodsRequestModel.created_at.desc())
    )
    records = res.scalars().all()
    output = []
    for r in records:
        output.append(await _serialize_assembly_fg_request(r, uow))
    return output


@router.get("/finished-goods-requests/{request_id}")
async def get_assembly_finished_goods_request(
    request_id: str,
    uow: UnitOfWork = Depends(get_uow),
):
    """
    Assembly view of single Finished Goods Request with FG Store availability check data.
    """
    try:
        req_uuid = uuid.UUID(request_id)
        req = await uow.session.get(FinishedGoodsRequestModel, req_uuid)
    except ValueError:
        req = await uow.session.scalar(
            select(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.request_number == request_id)
        )

    if not req:
        raise HTTPException(status_code=404, detail="Finished Goods Request not found")

    return await _serialize_assembly_fg_request(req, uow)


# -------------------------------------------------------------------------
# BOM (Bill of Materials) Endpoints
# -------------------------------------------------------------------------


class BOMItemCreate(BaseModel):
    material_id: Optional[str] = None
    material_code: str
    material_name: str
    variant_code: Optional[str] = None
    quantity_per_unit: float = Field(..., gt=0)
    uom: str = "PCS"
    notes: Optional[str] = None


class BOMCreate(BaseModel):
    product_name: str
    product_code: Optional[str] = None
    description: Optional[str] = None
    created_by: Optional[str] = "Assembly"
    items: list[BOMItemCreate] = Field(..., min_length=1)


class BOMUpdate(BaseModel):
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    items: Optional[list[BOMItemCreate]] = None


@router.get("/bom")
async def list_boms(
    product_code: Optional[str] = None,
    product_name: Optional[str] = None,
    uow: UnitOfWork = Depends(get_uow),
):
    query = select(BillOfMaterialsModel).options(selectinload(BillOfMaterialsModel.items))
    conditions = []
    if product_code:
        conditions.append(func.upper(BillOfMaterialsModel.product_code) == product_code.strip().upper())
    if product_name:
        conditions.append(func.lower(func.trim(BillOfMaterialsModel.product_name)) == func.lower(func.trim(product_name)))
    if conditions:
        query = query.where(or_(*conditions))
    query = query.order_by(BillOfMaterialsModel.created_at.desc())

    res = await uow.session.execute(query)
    records = res.scalars().all()
    return [serialize_bom(b) for b in records]


@router.get("/bom/by-product")
async def get_bom_by_product(
    product_name: Optional[str] = None,
    product_code: Optional[str] = None,
    uow: UnitOfWork = Depends(get_uow),
):
    if not product_name and not product_code:
        raise HTTPException(status_code=400, detail="product_name or product_code must be provided")

    conditions = []
    if product_code:
        conditions.append(func.upper(BillOfMaterialsModel.product_code) == product_code.strip().upper())
    if product_name:
        conditions.append(func.lower(func.trim(BillOfMaterialsModel.product_name)) == func.lower(func.trim(product_name)))

    query = (
        select(BillOfMaterialsModel)
        .options(selectinload(BillOfMaterialsModel.items))
        .where(BillOfMaterialsModel.status == "ACTIVE", or_(*conditions))
        .order_by(BillOfMaterialsModel.created_at.desc())
    )
    res = await uow.session.execute(query)
    bom = res.scalars().first()
    if not bom:
        raise HTTPException(status_code=404, detail="No BOM found for this product")
    return serialize_bom(bom)


@router.get("/bom/{bom_id}")
async def get_bom(bom_id: str, uow: UnitOfWork = Depends(get_uow)):
    bom = None
    try:
        b_uuid = uuid.UUID(bom_id)
        bom = await uow.session.get(BillOfMaterialsModel, b_uuid, options=[selectinload(BillOfMaterialsModel.items)])
    except ValueError:
        bom = await uow.session.scalar(
            select(BillOfMaterialsModel)
            .options(selectinload(BillOfMaterialsModel.items))
            .where(BillOfMaterialsModel.bom_number == bom_id)
        )
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    return serialize_bom(bom)


@router.post("/bom", status_code=201)
async def create_bom(payload: BOMCreate, uow: UnitOfWork = Depends(get_uow)):
    # Check if a BOM already exists for this product to prevent duplicate BOM definitions
    conditions = []
    if payload.product_code:
        conditions.append(func.upper(BillOfMaterialsModel.product_code) == payload.product_code.strip().upper())
    if payload.product_name:
        conditions.append(func.lower(func.trim(BillOfMaterialsModel.product_name)) == func.lower(func.trim(payload.product_name)))

    existing = None
    if conditions:
        query = (
            select(BillOfMaterialsModel)
            .options(selectinload(BillOfMaterialsModel.items))
            .where(BillOfMaterialsModel.status == "ACTIVE", or_(*conditions))
        )
        res = await uow.session.execute(query)
        existing = res.scalars().first()

    if existing:
        # Update existing BOM items to maintain single source of truth for the product
        existing.product_name = payload.product_name.strip()
        if payload.product_code:
            existing.product_code = payload.product_code.strip()
        if payload.description is not None:
            existing.description = payload.description

        for old_item in (existing.items or []):
            await uow.session.delete(old_item)

        for it in payload.items:
            mat_uuid = None
            if it.material_id:
                try:
                    mat_uuid = uuid.UUID(it.material_id)
                except ValueError:
                    pass
            itm = BillOfMaterialsItemModel(
                bom_id=existing.id,
                material_id=mat_uuid,
                material_code=it.material_code.strip(),
                material_name=it.material_name.strip(),
                variant_code=it.variant_code.strip() if it.variant_code else None,
                quantity_per_unit=Decimal(str(it.quantity_per_unit)),
                uom=it.uom.strip() if it.uom else "PCS",
                notes=it.notes,
            )
            uow.session.add(itm)
        await uow.commit()

        refreshed = await uow.session.scalar(
            select(BillOfMaterialsModel)
            .options(selectinload(BillOfMaterialsModel.items))
            .where(BillOfMaterialsModel.id == existing.id)
        )
        return serialize_bom(refreshed or existing)

    date_str = datetime.now().strftime("%Y%m%d")
    count_query = select(func.count(BillOfMaterialsModel.id))
    cnt = (await uow.session.scalar(count_query)) or 0
    bom_number = f"BOM-{date_str}-{cnt + 1:04d}"

    bom = BillOfMaterialsModel(
        bom_number=bom_number,
        product_code=payload.product_code.strip() if payload.product_code else None,
        product_name=payload.product_name.strip(),
        description=payload.description,
        created_by=payload.created_by or "Assembly",
        status="ACTIVE",
    )
    uow.session.add(bom)
    await uow.session.flush()

    for it in payload.items:
        mat_uuid = None
        if it.material_id:
            try:
                mat_uuid = uuid.UUID(it.material_id)
            except ValueError:
                pass
        item_model = BillOfMaterialsItemModel(
            bom_id=bom.id,
            material_id=mat_uuid,
            material_code=it.material_code.strip(),
            material_name=it.material_name.strip(),
            variant_code=it.variant_code.strip() if it.variant_code else None,
            quantity_per_unit=Decimal(str(it.quantity_per_unit)),
            uom=it.uom.strip() if it.uom else "PCS",
            notes=it.notes,
        )
        uow.session.add(item_model)

    await uow.commit()

    refreshed = await uow.session.scalar(
        select(BillOfMaterialsModel)
        .options(selectinload(BillOfMaterialsModel.items))
        .where(BillOfMaterialsModel.id == bom.id)
    )
    return serialize_bom(refreshed or bom)


@router.put("/bom/{bom_id}")
async def update_bom(bom_id: str, payload: BOMUpdate, uow: UnitOfWork = Depends(get_uow)):
    bom = None
    try:
        b_uuid = uuid.UUID(bom_id)
        bom = await uow.session.get(BillOfMaterialsModel, b_uuid, options=[selectinload(BillOfMaterialsModel.items)])
    except ValueError:
        bom = await uow.session.scalar(
            select(BillOfMaterialsModel)
            .options(selectinload(BillOfMaterialsModel.items))
            .where(BillOfMaterialsModel.bom_number == bom_id)
        )
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    if payload.product_name is not None:
        bom.product_name = payload.product_name.strip()
    if payload.product_code is not None:
        bom.product_code = payload.product_code.strip() if payload.product_code else None
    if payload.description is not None:
        bom.description = payload.description
    if payload.status is not None:
        bom.status = payload.status

    if payload.items is not None:
        for old_item in (bom.items or []):
            await uow.session.delete(old_item)

        for it in payload.items:
            mat_uuid = None
            if it.material_id:
                try:
                    mat_uuid = uuid.UUID(it.material_id)
                except ValueError:
                    pass
            item_model = BillOfMaterialsItemModel(
                bom_id=bom.id,
                material_id=mat_uuid,
                material_code=it.material_code.strip(),
                material_name=it.material_name.strip(),
                variant_code=it.variant_code.strip() if it.variant_code else None,
                quantity_per_unit=Decimal(str(it.quantity_per_unit)),
                uom=it.uom.strip() if it.uom else "PCS",
                notes=it.notes,
            )
            uow.session.add(item_model)

    await uow.commit()

    refreshed = await uow.session.scalar(
        select(BillOfMaterialsModel)
        .options(selectinload(BillOfMaterialsModel.items))
        .where(BillOfMaterialsModel.id == bom.id)
    )
    return serialize_bom(refreshed or bom)


@router.get("/genealogy/{identifier}")
@router.get("/finished-goods/{identifier}/genealogy")
@router.get("/orders/{identifier}/genealogy")
async def get_genealogy(identifier: str, uow: UnitOfWork = Depends(get_uow)):
    """
    Detailed Genealogy view tracing:
    Finished Good -> QR -> Assembly Order -> Assembly Steps -> Consumed Raw Materials & Batches -> Source Store/Bin -> Inventory movements -> GRN -> QC info.
    """
    order = None
    fg = None
    try:
        ident_uuid = uuid.UUID(identifier)
        order = await uow.session.get(AssemblyOrderModel, ident_uuid)
        if not order:
            fg = await uow.session.get(AssemblyFinishedGoodsModel, ident_uuid)
            if fg:
                order = await uow.session.get(AssemblyOrderModel, fg.assembly_order_id)
    except ValueError:
        pass

    if not order and not fg:
        order = await uow.session.scalar(
            select(AssemblyOrderModel).where(
                func.upper(AssemblyOrderModel.order_number) == identifier.strip().upper()
            )
        )
        if not order:
            fg = await uow.session.scalar(
                select(AssemblyFinishedGoodsModel).where(
                    or_(
                        func.upper(AssemblyFinishedGoodsModel.qr_code) == identifier.strip().upper(),
                        func.upper(AssemblyFinishedGoodsModel.serial_number) == identifier.strip().upper(),
                        func.upper(AssemblyFinishedGoodsModel.product_code) == identifier.strip().upper(),
                    )
                )
            )
            if fg:
                order = await uow.session.get(AssemblyOrderModel, fg.assembly_order_id)

    if not order and not fg:
        raise HTTPException(status_code=404, detail=f"Genealogy record not found for '{identifier}'")

    if order and not fg:
        fg = await uow.session.scalar(
            select(AssemblyFinishedGoodsModel).where(
                AssemblyFinishedGoodsModel.assembly_order_id == order.id
            )
        )

    fg_store = None
    if fg and fg.store_id:
        fg_store = await uow.session.get(StoreModel, fg.store_id)
    elif fg:
        # Resolve any store matching FG
        fg_store = await uow.session.scalar(
            select(StoreModel).where(
                or_(
                    func.upper(StoreModel.store_type) == "FINISHED_GOODS",
                    StoreModel.store_name.ilike("%Finished Goods%"),
                    StoreModel.store_code.ilike("%FG%"),
                )
            )
        )

    consumptions = list((await uow.session.execute(
        select(AssemblyMaterialConsumptionModel).where(
            AssemblyMaterialConsumptionModel.assembly_order_id == order.id
        )
    )).scalars().all())

    issue = await uow.session.get(MaterialIssueModel, order.material_issue_id) if order.material_issue_id else None
    task = await uow.session.get(PickTaskModel, order.pick_task_id) if order.pick_task_id else None

    material_codes = [c.material_code for c in consumptions] or [
        item.get("material_code") for item in (order.items or []) if item.get("material_code")
    ]

    handling_units = list((await uow.session.execute(
        select(HandlingUnitModel).where(HandlingUnitModel.item_code.in_(material_codes))
    )).scalars().all()) if material_codes else []

    movements = list((await uow.session.execute(
        select(PutawayMovementModel).where(PutawayMovementModel.material_code.in_(material_codes))
    )).scalars().all()) if material_codes else []

    grn_lines = list((await uow.session.execute(
        select(GrnLineModel).options(selectinload(GrnLineModel.batches), selectinload(GrnLineModel.grn)).where(
            GrnLineModel.item_code.in_(material_codes)
        )
    )).scalars().all()) if material_codes else []

    issue_txs = list((await uow.session.execute(
        select(InventoryIssueTransactionModel).where(
            or_(
                InventoryIssueTransactionModel.requisition_number == order.request_number,
                InventoryIssueTransactionModel.material_code.in_(material_codes),
            )
        )
    )).scalars().all()) if material_codes else []

    putaway_tasks = list((await uow.session.execute(
        select(PutawayTaskModel).where(
            PutawayTaskModel.item_code.in_(material_codes)
        ).order_by(PutawayTaskModel.created_at.desc())
    )).scalars().all()) if material_codes else []

    grn_by_number = {}
    grn_numbers = {hu.grn_number for hu in handling_units if hu.grn_number}
    for gl in grn_lines:
        if gl.grn and gl.grn.grn_number:
            grn_numbers.add(gl.grn.grn_number)
            grn_by_number[gl.grn.grn_number] = gl.grn

    if grn_numbers:
        grn_records = list((await uow.session.execute(
            select(GrnModel).where(GrnModel.grn_number.in_(grn_numbers))
        )).scalars().all())
        for g in grn_records:
            grn_by_number[g.grn_number] = g

    quality_insp = await uow.session.scalar(
        select(AssemblyQualityInspectionModel).where(
            AssemblyQualityInspectionModel.assembly_order_id == order.id
        )
    )

    scrap_records = list((await uow.session.execute(
        select(AssemblyScrapModel).where(AssemblyScrapModel.assembly_order_id == order.id)
    )).scalars().all())

    consumed_list = []
    requirements_map = aggregate_requirements(order.items or [])

    for mat_code in material_codes:
        c_record = next((c for c in consumptions if c.material_code == mat_code), None)
        req_item = requirements_map.get(mat_code, {}).get("item", {})
        mat_hus = [hu for hu in handling_units if hu.item_code == mat_code]
        mat_movs = [m for m in movements if m.material_code == mat_code]
        mat_grn_lines = [gl for gl in grn_lines if gl.item_code == mat_code]
        mat_issues = [itx for itx in issue_txs if itx.material_code == mat_code]
        mat_puts = [pt for pt in putaway_tasks if pt.item_code == mat_code]

        batches_set = {hu.batch_number for hu in mat_hus if hu.batch_number} | {m.batch_lot for m in mat_movs if m.batch_lot}
        for gl in mat_grn_lines:
            for b in (gl.batches or []):
                if b.batch_number:
                    batches_set.add(b.batch_number)
        batches = sorted(list(batches_set))

        locations_set = {hu.current_location for hu in mat_hus if hu.current_location} | {m.destination_location for m in mat_movs if m.destination_location}
        for itx in mat_issues:
            if itx.store_code:
                locations_set.add(f"{itx.store_code} / {itx.zone_code or 'MAIN'}")
        locations = sorted(list(locations_set))

        mat_grn = None
        for gl in mat_grn_lines:
            if gl.grn:
                g = gl.grn
                mat_grn = {
                    "grn_number": g.grn_number,
                    "supplier_name": g.supplier_name or g.supplier_company_name or "Approved Supplier",
                    "po_number": g.po_number or "—",
                    "received_date": g.created_at.isoformat() if g.created_at else None,
                    "qc_status": "PASSED" if g.status in ("COMPLETED", "GRN_POSTED") else g.status,
                }
                break

        if not mat_grn:
            for hu in mat_hus:
                if hu.grn_number and hu.grn_number in grn_by_number:
                    g = grn_by_number[hu.grn_number]
                    mat_grn = {
                        "grn_number": g.grn_number,
                        "supplier_name": g.supplier_name or hu.supplier_name,
                        "po_number": g.po_number or hu.po_number,
                        "received_date": g.created_at.isoformat() if g.created_at else None,
                        "qc_status": "PASSED",
                    }
                    break

        if not mat_grn and mat_hus:
            mat_grn = {
                "grn_number": mat_hus[0].grn_number or "—",
                "supplier_name": mat_hus[0].supplier_name or "—",
                "po_number": mat_hus[0].po_number or "—",
                "received_date": mat_hus[0].generated_at.isoformat() if mat_hus[0].generated_at else None,
                "qc_status": "QC_PASSED",
            }

        putaway_no = None
        if mat_grn and mat_grn.get("grn_number"):
            matching_pt = next((pt for pt in mat_puts if pt.grn_number == mat_grn["grn_number"]), None)
            if matching_pt:
                putaway_no = matching_pt.task_number
        if not putaway_no and mat_puts:
            putaway_no = mat_puts[0].task_number
        if not putaway_no and mat_movs:
            putaway_no = mat_movs[0].destination_location

        issue_no = mat_issues[0].issue_number if mat_issues else (issue.issue_number if issue else None)

        consumed_list.append({
            "material_code": mat_code,
            "material_name": req_item.get("material_name") or mat_code,
            "expected_per_unit": float(c_record.expected_per_unit) if c_record else 1.0,
            "assembled_quantity": float(c_record.assembled_quantity) if c_record else float(order.completed_quantity),
            "actual_consumed": float(c_record.actual_consumed) if c_record else float(requirements_map.get(mat_code, {}).get("quantity", 0)),
            "uom": c_record.uom if c_record else (req_item.get("uom") or "PCS"),
            "batches": batches or ["LOT-STD-PRIMARY"],
            "source_locations": locations or ["MAIN STORE / RAW_MATERIAL"],
            "grn_info": mat_grn,
            "putaway_task": putaway_no,
            "issue_number": issue_no,
        })

    return {
        "finished_good": {
            "id": str(fg.id) if fg else None,
            "product_code": fg.product_code if fg else (order.product_name or "FG-PRODUCT"),
            "product_name": fg.product_name if fg else order.product_name,
            "serial_number": fg.serial_number if fg else f"SN-{order.order_number}",
            "qr_code": fg.qr_code if fg else f"FG-QR|{order.product_name}|ORD:{order.order_number}",
            "quantity": float(fg.quantity) if fg else float(order.completed_quantity),
            "uom": fg.uom if fg else "PCS",
            "status": fg.status if fg else order.status,
            "store_id": str(fg.store_id) if fg and fg.store_id else (str(fg_store.id) if fg_store else None),
            "store_name": fg_store.store_name if fg_store else "Finished Goods Store",
            "store_code": fg_store.store_code if fg_store else "STR-FG",
            "location_code": fg.location_code if fg else "FG-A-01",
            "posted_at": fg.posted_at.isoformat() if fg and fg.posted_at else None,
        },
        "assembly_order": {
            "id": str(order.id),
            "order_number": order.order_number,
            "product_name": order.product_name,
            "status": order.status,
            "planned_quantity": float(order.planned_quantity),
            "completed_quantity": float(order.completed_quantity),
            "rejected_quantity": float(order.rejected_quantity),
            "assigned_team": order.assigned_team or "Assembly Team",
            "assigned_operator": order.assigned_operator or order.created_by,
            "started_at": order.started_at.isoformat() if order.started_at else None,
            "completed_at": order.completed_at.isoformat() if order.completed_at else None,
            "required_date": order.required_date.isoformat() if order.required_date else None,
        },
        "assembly_steps": order.assembly_steps or default_assembly_steps(),
        "consumed_materials": consumed_list,
        "material_issue": {
            "issue_number": issue.issue_number if issue else "—",
            "issued_by": issue.issued_by if issue else "—",
            "issued_at": issue.issued_at.isoformat() if issue and issue.issued_at else None,
            "warehouse": task.warehouse_id if task else "Main Warehouse",
        } if issue else None,
        "quality_inspection": {
            "status": quality_insp.status if quality_insp else "PASSED",
            "produced_quantity": float(quality_insp.produced_quantity) if quality_insp else float(order.completed_quantity),
            "passed_quantity": float(quality_insp.passed_quantity) if quality_insp else float(order.completed_quantity),
            "failed_quantity": float(quality_insp.failed_quantity) if quality_insp else float(order.rejected_quantity),
            "rework_quantity": float(quality_insp.rework_quantity) if quality_insp else 0.0,
            "inspected_by": quality_insp.inspected_by if quality_insp else "QC Team",
            "inspected_at": quality_insp.inspected_at.isoformat() if quality_insp and quality_insp.inspected_at else None,
            "notes": quality_insp.notes if quality_insp else None,
        } if quality_insp else None,
        "scrap_records": [
            {
                "material_code": s.material_code,
                "quantity": float(s.quantity),
                "uom": s.uom,
                "reason": s.reason,
                "status": s.status,
            }
            for s in scrap_records
        ],
    }



@router.get("/orders/{order_id}/rework")
async def list_rework_orders(order_id: uuid.UUID, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    result = await uow.session.execute(select(AssemblyReworkOrderModel).where(
        AssemblyReworkOrderModel.assembly_order_id == order.id
    ).order_by(AssemblyReworkOrderModel.created_at.desc()))
    inspection = await uow.session.scalar(select(AssemblyQualityInspectionModel).where(
        AssemblyQualityInspectionModel.assembly_order_id == order.id
    ))
    return {"assembly_order_id": str(order.id), "order_number": order.order_number,
            "order_status": order.status, "quality_status": inspection.status if inspection else None,
            "records": [serialize_rework(row, order) for row in result.scalars().all()]}


@router.post("/orders/{order_id}/rework", status_code=201)
async def create_rework_order(order_id: uuid.UUID, request: AssemblyReworkCreate,
                              uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id, with_for_update=True)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    inspection = await uow.session.scalar(select(AssemblyQualityInspectionModel).where(
        AssemblyQualityInspectionModel.assembly_order_id == order.id
    ))
    if order.status != "QUALITY_CHECK" or not inspection or inspection.status not in {"FAILED", "REWORK_REQUIRED"}:
        raise HTTPException(status_code=409, detail="A failed or rework-required quality inspection is required")
    if await uow.session.scalar(select(AssemblyReworkOrderModel.id).where(
        AssemblyReworkOrderModel.assembly_order_id == order.id,
        AssemblyReworkOrderModel.status.in_({"PENDING", "IN_PROGRESS"}),
    )):
        raise HTTPException(status_code=409, detail="An active rework order already exists")
    team = request.assigned_team.strip()
    if not await uow.session.scalar(select(AssemblyTeamModel.id).where(
        AssemblyTeamModel.name == team, AssemblyTeamModel.active.is_(True)
    )):
        raise HTTPException(status_code=422, detail="Select an active assembly team")
    count = await uow.session.scalar(select(func.count(AssemblyReworkOrderModel.id)).where(
        AssemblyReworkOrderModel.assembly_order_id == order.id
    )) or 0
    now = datetime.now()
    rework = AssemblyReworkOrderModel(
        id=uuid.uuid4(), assembly_order_id=order.id, rework_number=f"RW-{order.order_number}-{count + 1:02d}",
        reason_for_failure=(request.reason_for_failure or inspection.notes or inspection.status.replace("_", " ")).strip(),
        failed_quantity=inspection.failed_quantity + inspection.rework_quantity,
        assigned_team=team, assigned_worker=request.assigned_worker.strip() if request.assigned_worker else None,
        status="PENDING", final_result="PENDING_INSPECTION",
        notes=request.notes.strip() if request.notes else None, created_at=now, updated_at=now,
    )
    uow.session.add(rework)
    await add_assembly_notification(uow, "Rework required",
                                    f"{rework.rework_number} assigned to {rework.assigned_team} for {rework.failed_quantity:g} units.", order)
    await uow.commit()
    return serialize_rework(rework, order)


@router.patch("/orders/{order_id}/rework/{rework_id}")
async def update_rework_order(order_id: uuid.UUID, rework_id: uuid.UUID, request: AssemblyReworkUpdate,
                              uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id, with_for_update=True)
    rework = await uow.session.get(AssemblyReworkOrderModel, rework_id, with_for_update=True)
    if not order or not rework or rework.assembly_order_id != order.id:
        raise HTTPException(status_code=404, detail="Rework order not found")
    status = request.status.upper()
    transitions = {"PENDING": {"IN_PROGRESS"}, "IN_PROGRESS": {"COMPLETED"}, "COMPLETED": set()}
    if status not in transitions.get(rework.status, set()):
        raise HTTPException(status_code=409, detail=f"{rework.status} cannot move to {status}")
    if status == "IN_PROGRESS" and order.status != "IN_PROGRESS":
        raise HTTPException(status_code=409, detail="Return the assembly order to rework before starting")
    now = datetime.now()
    if request.assigned_team is not None: rework.assigned_team = request.assigned_team.strip()
    if request.assigned_worker is not None: rework.assigned_worker = request.assigned_worker.strip() or None
    if request.notes is not None: rework.notes = request.notes.strip() or None
    rework.status = status
    if status == "IN_PROGRESS": rework.started_at = now
    if status == "COMPLETED":
        rework.completed_at = now
        order.status = "COMPLETED"
        order.completed_at = now
        order.updated_at = now
    rework.updated_at = now
    await uow.commit()
    return serialize_rework(rework, order)


@router.patch("/orders/{order_id}/steps/{step_id}")
async def update_assembly_step(order_id: uuid.UUID, step_id: str, request: AssemblyStepUpdate, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id, with_for_update=True)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    if order.status not in {"IN_PROGRESS", "ON_HOLD"}:
        raise HTTPException(status_code=409, detail="Assembly work must be in progress before steps can be updated")
    status = request.status.upper()
    if status not in {"IN_PROGRESS", "COMPLETED"}:
        raise HTTPException(status_code=422, detail="Step status must be IN_PROGRESS or COMPLETED")
    steps = normalize_assembly_steps(order)
    index = next((position for position, step in enumerate(steps) if str(step.get("id")) == step_id), None)
    if index is None:
        raise HTTPException(status_code=404, detail="Assembly step not found")
    if index > 0 and steps[index - 1].get("status") != "COMPLETED":
        raise HTTPException(status_code=409, detail="Complete the previous assembly step first")
    if status == "COMPLETED" and steps[index].get("status") != "IN_PROGRESS":
        raise HTTPException(status_code=409, detail="Start the assembly step before completing it")
    now = datetime.now()
    steps[index]["status"] = status
    if status == "IN_PROGRESS" and not steps[index].get("started_at"):
        steps[index]["started_at"] = now.isoformat()
    if status == "COMPLETED":
        steps[index]["completed_at"] = now.isoformat()
    order.assembly_steps = steps
    order.updated_at = now
    await uow.commit()
    return serialize_order(order)


@router.patch("/orders/{order_id}/progress")
async def update_assembly_progress(order_id: uuid.UUID, request: AssemblyProgressUpdate, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id, with_for_update=True)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    if order.status not in {"IN_PROGRESS", "ON_HOLD"}:
        raise HTTPException(status_code=409, detail="Progress can only be recorded for active or paused work orders")
    if request.completed_quantity > order.planned_quantity:
        raise HTTPException(status_code=422, detail="Completed quantity cannot exceed the work-order target")
    if request.completed_quantity < order.completed_quantity:
        raise HTTPException(status_code=409, detail="Completed quantity cannot be reduced")
    order.completed_quantity = request.completed_quantity
    order.updated_at = datetime.now()
    await uow.commit()
    return serialize_order(order)


@router.get("/orders/{order_id}/consumption")
async def get_material_consumption(order_id: uuid.UUID, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    result = await uow.session.execute(select(AssemblyMaterialConsumptionModel).where(
        AssemblyMaterialConsumptionModel.assembly_order_id == order.id
    ))
    records = {record.material_code: record for record in result.scalars().all()}
    lines = []
    for material_code, requirement in aggregate_requirements(order.items or []).items():
        item = requirement["item"]
        record = records.get(material_code)
        if record:
            lines.append(serialize_consumption(record, item.get("material_name") or material_code))
        else:
            expected_per_unit = requirement["quantity"] / order.planned_quantity if order.planned_quantity > 0 else Decimal("0")
            lines.append({
                "id": None, "material_code": material_code, "material_name": item.get("material_name") or material_code,
                "expected_per_unit": float(expected_per_unit), "assembled_quantity": float(order.completed_quantity),
                "expected_consumption": float(expected_per_unit * order.completed_quantity), "actual_consumption": None,
                "variance_quantity": None, "variance_percent": None, "status": "NOT_RECORDED",
                "uom": item.get("uom") or "PCS", "recorded_by": None, "recorded_at": None,
            })
    recorded = [line for line in lines if line["actual_consumption"] is not None]
    return {
        "order_number": order.order_number, "product_name": order.product_name, "order_status": order.status,
        "target_quantity": float(order.planned_quantity), "completed_quantity": float(order.completed_quantity),
        "summary": {
            "materials": len(lines), "recorded": len(recorded),
            "expected_consumption": sum(line["expected_consumption"] for line in recorded),
            "actual_consumption": sum(line["actual_consumption"] for line in recorded),
            "variance_quantity": sum(line["variance_quantity"] for line in recorded),
            "over_consumed_materials": sum(line["status"] == "OVER_CONSUMPTION" for line in recorded),
        },
        "materials": lines,
    }


@router.put("/orders/{order_id}/consumption")
async def record_material_consumption(order_id: uuid.UUID, request: MaterialConsumptionUpdate, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id, with_for_update=True)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    if order.status not in {"IN_PROGRESS", "ON_HOLD", "COMPLETED", "QUALITY_CHECK"}:
        raise HTTPException(status_code=409, detail="Start assembly before recording material consumption")
    requirements = aggregate_requirements(order.items or [])
    material_code = request.material_code.strip()
    if material_code not in requirements:
        raise HTTPException(status_code=422, detail="Material is not required by this assembly order")
    if request.assembled_quantity > order.planned_quantity:
        raise HTTPException(status_code=422, detail="Assembled quantity cannot exceed the work-order target")
    result = await uow.session.execute(select(AssemblyMaterialConsumptionModel).where(
        AssemblyMaterialConsumptionModel.assembly_order_id == order.id,
        AssemblyMaterialConsumptionModel.material_code == material_code,
    ).with_for_update())
    record = result.scalar_one_or_none()
    now = datetime.now()
    if not record:
        record = AssemblyMaterialConsumptionModel(
            id=uuid.uuid4(), assembly_order_id=order.id, material_code=material_code,
            recorded_by=order.assigned_team or order.created_by, recorded_at=now, updated_at=now,
        )
        uow.session.add(record)
    record.expected_per_unit = request.expected_per_unit
    record.assembled_quantity = request.assembled_quantity
    record.actual_consumed = request.actual_consumed
    record.uom = request.uom.strip().upper()
    record.updated_at = now
    await uow.commit()
    item = requirements[material_code]["item"]
    return serialize_consumption(record, item.get("material_name") or material_code)


async def scrap_response(uow: UnitOfWork, order: AssemblyOrderModel, scrap: AssemblyScrapModel) -> dict:
    requirements = aggregate_requirements(order.items or [])
    requirement = requirements.get(scrap.material_code, {"quantity": Decimal("0"), "item": {}})
    consumption = await uow.session.scalar(select(AssemblyMaterialConsumptionModel).where(
        AssemblyMaterialConsumptionModel.assembly_order_id == order.id,
        AssemblyMaterialConsumptionModel.material_code == scrap.material_code,
    ))
    planned = consumption.expected_per_unit * consumption.assembled_quantity if consumption else requirement["quantity"]
    used = consumption.actual_consumed if consumption else max(planned - scrap.quantity, Decimal("0"))
    item = requirement["item"]
    return {
        "id": str(scrap.id), "assembly_order_id": str(order.id), "assembly_order": order.order_number,
        "material_code": scrap.material_code, "material_name": item.get("material_name") or scrap.material_code,
        "planned_quantity": float(planned), "used_quantity": float(used), "damaged_quantity": float(scrap.quantity),
        "quantity": float(scrap.quantity), "uom": scrap.uom, "reason": scrap.reason,
        "employee_team": scrap.employee_team, "approval_required": scrap.approval_required,
        "status": scrap.status, "date": scrap.recorded_at.isoformat(),
        "approved_by": scrap.approved_by, "approved_at": scrap.approved_at.isoformat() if scrap.approved_at else None,
    }


@router.get("/orders/{order_id}/scrap")
async def list_assembly_scrap(order_id: uuid.UUID, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    result = await uow.session.execute(select(AssemblyScrapModel).where(
        AssemblyScrapModel.assembly_order_id == order.id
    ).order_by(AssemblyScrapModel.recorded_at.desc()))
    records = [await scrap_response(uow, order, scrap) for scrap in result.scalars().all()]
    return {
        "order_number": order.order_number, "order_status": order.status,
        "summary": {"records": len(records), "damaged_quantity": sum(row["quantity"] for row in records),
                    "pending_approval": sum(row["status"] == "PENDING_APPROVAL" for row in records)},
        "records": records,
    }


@router.post("/orders/{order_id}/scrap", status_code=201)
async def create_assembly_scrap(order_id: uuid.UUID, request: AssemblyScrapCreate, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id, with_for_update=True)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    if order.status not in {"IN_PROGRESS", "ON_HOLD", "COMPLETED", "QUALITY_CHECK"}:
        raise HTTPException(status_code=409, detail="Start assembly before recording scrap")
    requirements = aggregate_requirements(order.items or [])
    material_code = request.material_code.strip()
    if material_code not in requirements:
        raise HTTPException(status_code=422, detail="Material is not required by this assembly order")
    existing_total = await uow.session.scalar(select(func.coalesce(func.sum(AssemblyScrapModel.quantity), 0)).where(
        AssemblyScrapModel.assembly_order_id == order.id, AssemblyScrapModel.material_code == material_code
    ))
    if Decimal(str(existing_total)) + request.quantity > requirements[material_code]["quantity"]:
        raise HTTPException(status_code=422, detail="Total damaged quantity cannot exceed material issued for the order")
    scrap = AssemblyScrapModel(
        id=uuid.uuid4(), assembly_order_id=order.id, material_code=material_code,
        quantity=request.quantity, uom=request.uom.strip().upper(), reason=request.reason.strip(),
        employee_team=request.employee_team.strip(), approval_required=request.approval_required,
        status="PENDING_APPROVAL" if request.approval_required else "RECORDED", recorded_at=datetime.now(),
    )
    uow.session.add(scrap)
    await uow.commit()
    return await scrap_response(uow, order, scrap)


@router.patch("/orders/{order_id}/scrap/{scrap_id}/approve")
async def approve_assembly_scrap(order_id: uuid.UUID, scrap_id: uuid.UUID, request: AssemblyScrapApproval, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    scrap = await uow.session.get(AssemblyScrapModel, scrap_id, with_for_update=True)
    if not scrap or scrap.assembly_order_id != order.id:
        raise HTTPException(status_code=404, detail="Scrap record not found")
    if scrap.status != "PENDING_APPROVAL":
        raise HTTPException(status_code=409, detail="Scrap record is not pending approval")
    scrap.status = "APPROVED"
    scrap.approved_by = request.approved_by.strip()
    scrap.approved_at = datetime.now()
    await uow.commit()
    return await scrap_response(uow, order, scrap)


@router.get("/orders/{order_id}/material-issue")
async def get_order_material_issue(order_id: uuid.UUID, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")
    issue = await uow.session.get(MaterialIssueModel, order.material_issue_id)
    task = await uow.session.get(PickTaskModel, order.pick_task_id)
    if not issue or not task:
        raise HTTPException(status_code=404, detail="Material issue handoff was not found")

    material_codes = list(aggregate_requirements(order.items or []))
    locations = {
        allocation.get("location")
        for item in issue.items or []
        for allocation in item.get("allocations") or []
        if allocation.get("location")
    }
    batches_by_material: dict[str, set[str]] = defaultdict(set)
    if material_codes and locations:
        units_result = await uow.session.execute(
            select(HandlingUnitModel).where(
                HandlingUnitModel.item_code.in_(material_codes),
                HandlingUnitModel.current_location.in_(locations),
            )
        )
        for unit in units_result.scalars().all():
            if unit.batch_number:
                batches_by_material[unit.item_code].add(unit.batch_number)
        movements_result = await uow.session.execute(
            select(PutawayMovementModel).where(
                PutawayMovementModel.material_code.in_(material_codes),
                PutawayMovementModel.destination_location.in_(locations),
            )
        )
        for movement in movements_result.scalars().all():
            if movement.batch_lot:
                batches_by_material[movement.material_code].add(movement.batch_lot)

    lines = build_material_issue_lines(order.items or [], issue.items or [], batches_by_material)
    overall_status = "ISSUED" if all(line["status"] == "ISSUED" for line in lines) else (
        "PARTIALLY_ISSUED" if any(line["issued_quantity"] > 0 for line in lines) else "PENDING"
    )
    return {
        "assembly_order_id": str(order.id), "order_number": order.order_number,
        "material_request_id": str(order.material_request_id), "request_number": order.request_number,
        "material_issue_id": str(issue.id), "issue_number": issue.issue_number,
        "warehouse": task.warehouse_id, "destination": task.destination,
        "issued_by": issue.issued_by, "received_by": issue.received_by,
        "issue_date": issue.issued_at.isoformat(), "status": overall_status, "materials": lines,
    }


@router.get("/orders/{order_id}/requirements")
async def get_order_requirements(order_id: uuid.UUID, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")

    reservation_result = await uow.session.execute(
        select(AssemblyMaterialReservationModel).where(
            AssemblyMaterialReservationModel.assembly_order_id == order.id,
            AssemblyMaterialReservationModel.status == "RESERVED",
        )
    )
    reservations = {row.material_code: row for row in reservation_result.scalars().all()}

    requirements = []
    for material_code, requirement in aggregate_requirements(order.items or []).items():
        item = requirement["item"]
        required_qty = requirement["quantity"]

        # Check stock availability
        stock = await uow.session.scalar(
            select(MaterialStockModel).where(MaterialStockModel.material_code == material_code)
        )

        on_hand_qty = stock.on_hand if stock else Decimal("0")
        free_qty = stock.available if stock else Decimal("0")
        reserved_qty = reservations[material_code].quantity if material_code in reservations else Decimal("0")
        status, status_label = material_requirement_status(required_qty, free_qty, reserved_qty)

        requirements.append({
            "component": item.get("material_name") or material_code,
            "material_code": material_code,
            "required": float(required_qty),
            "available": float(on_hand_qty),
            "reserved": float(reserved_qty),
            "free_stock": float(free_qty),
            "status": status,
            "status_label": status_label,
            "shortage_quantity": float(max(required_qty - free_qty - reserved_qty, Decimal("0"))),
            "uom": item.get("uom") or "PCS"
        })

    return {
        "order_number": order.order_number,
        "summary": {
            "total": len(requirements),
            "available": sum(row["status"] == "AVAILABLE" for row in requirements),
            "reserved": sum(row["status"] == "RESERVED" for row in requirements),
            "shortage": sum(row["status"] == "SHORTAGE" for row in requirements),
            "all_materials_ready": all(row["status"] != "SHORTAGE" for row in requirements),
        },
        "requirements": requirements
    }


@router.post("/orders/{order_id}/material-request")
async def request_shortage_materials(order_id: uuid.UUID, uow: UnitOfWork = Depends(get_uow)):
    order = await uow.session.get(AssemblyOrderModel, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Assembly order not found")

    reservation_result = await uow.session.execute(
        select(AssemblyMaterialReservationModel).where(
            AssemblyMaterialReservationModel.assembly_order_id == order.id,
            AssemblyMaterialReservationModel.status == "RESERVED",
        )
    )
    reservations = {row.material_code: row for row in reservation_result.scalars().all()}

    shortage_items = []
    for material_code, requirement in aggregate_requirements(order.items or []).items():
        required_qty = requirement["quantity"]
        stock = await uow.session.scalar(
            select(MaterialStockModel).where(MaterialStockModel.material_code == material_code)
        )
        free_qty = stock.available if stock else Decimal("0")
        reserved_qty = reservations[material_code].quantity if material_code in reservations else Decimal("0")

        shortage = float(max(required_qty - free_qty - reserved_qty, Decimal("0")))
        if shortage > 0:
            shortage_items.append({
                "material_code": material_code,
                "material_name": requirement["item"].get("material_name") or material_code,
                "quantity": shortage,
                "uom": requirement["item"].get("uom") or "PCS"
            })

    if not shortage_items:
        raise HTTPException(status_code=400, detail="No material shortages found for this order")

    now = datetime.now()
    count = await uow.session.scalar(select(func.count(MaterialRequestModel.id))) or 0
    request_number = f"MR-ASM-{now.year}-{count + 1:04d}"

    new_mr = MaterialRequestModel(
        id=uuid.uuid4(),
        request_number=request_number,
        warehouse_id="WH_PUNE-01",
        department="Assembly",
        requested_by=order.assigned_operator or order.created_by or "Assembly Manager",
        status="PENDING",
        required_date=order.required_date or (now + timedelta(days=2)).date(),
        remarks=f"Auto-generated for shortage in Assembly Order {order.order_number}",
        created_at=now
    )

    for item in shortage_items:
        new_mr.items.append(MaterialRequestItemModel(
            id=uuid.uuid4(),
            material_code=item["material_code"],
            material_name=item["material_name"],
            quantity=Decimal(str(item["quantity"])),
            uom=item["uom"]
        ))

    uow.session.add(new_mr)

    uow.session.add(NotificationModel(
        id=uuid.uuid4(),
        user_role="WAREHOUSE",
        title="New Material Request from Assembly",
        message=f"Material request {request_number} created for Assembly Order {order.order_number} shortages.",
        link="/procurement/material-requests",
        is_read=False,
        created_at=now
    ))

    await uow.commit()

    return {
        "status": "success",
        "request_number": request_number,
        "items_count": len(shortage_items)
    }


@router.get("/reports")
async def assembly_reports(uow: UnitOfWork = Depends(get_uow)):
    await backfill_issued_orders(uow)
    orders = list((await uow.session.execute(select(AssemblyOrderModel))).scalars().all())
    order_by_id = {order.id: order for order in orders}
    today = date.today()
    complete_statuses = {"COMPLETED", "QUALITY_CHECK", "CLOSED"}
    delayed = [order for order in orders if order.required_date and order.required_date < today and order.status not in complete_statuses]

    consumption_records = list((await uow.session.execute(
        select(AssemblyMaterialConsumptionModel).order_by(AssemblyMaterialConsumptionModel.material_code)
    )).scalars().all())
    consumption_lines = []
    for record in consumption_records:
        variance = calculate_material_variance(record.expected_per_unit, record.assembled_quantity, record.actual_consumed)
        consumption_lines.append({
            "order_number": order_by_id.get(record.assembly_order_id).order_number if record.assembly_order_id in order_by_id else "—",
            "material_code": record.material_code, "planned": variance["expected_consumption"],
            "actual": variance["actual_consumption"], "variance": variance["variance_quantity"],
            "variance_percent": variance["variance_percent"], "uom": record.uom,
        })

    scrap_records = list((await uow.session.execute(select(AssemblyScrapModel))).scalars().all())
    consumption_by_key = {(row.assembly_order_id, row.material_code): row for row in consumption_records}
    wastage_lines = []
    for scrap in scrap_records:
        order = order_by_id.get(scrap.assembly_order_id)
        consumption = consumption_by_key.get((scrap.assembly_order_id, scrap.material_code))
        planned = consumption.expected_per_unit * consumption.assembled_quantity if consumption else (
            aggregate_requirements(order.items or []).get(scrap.material_code, {}).get("quantity", Decimal("0")) if order else Decimal("0")
        )
        wastage_lines.append({
            "order_number": order.order_number if order else "—", "material_code": scrap.material_code,
            "material_wastage": float(scrap.quantity), "scrap_quantity": float(scrap.quantity),
            "planned_quantity": float(planned),
            "wastage_percent": round(float(scrap.quantity / planned * 100), 2) if planned else 0,
            "uom": scrap.uom, "reason": scrap.reason,
        })

    inspections = list((await uow.session.execute(select(AssemblyQualityInspectionModel))).scalars().all())
    passed = sum((row.passed_quantity for row in inspections), Decimal("0"))
    failed = sum((row.failed_quantity for row in inspections), Decimal("0"))
    rework = sum((row.rework_quantity for row in inspections), Decimal("0"))
    inspected = passed + failed + rework

    teams = list((await uow.session.execute(select(AssemblyTeamModel).order_by(AssemblyTeamModel.name))).scalars().all())
    team_lines = []
    for team in teams:
        assigned = [order for order in orders if order.assigned_team == team.name]
        target = sum((order.planned_quantity for order in assigned), Decimal("0"))
        actual = sum((order.completed_quantity for order in assigned), Decimal("0"))
        team_lines.append({
            "team": team.name, "team_output": float(actual), "target": float(target), "actual": float(actual),
            "completed_orders": sum(order.status in complete_statuses for order in assigned),
            "total_orders": len(assigned), "workers": len(team.workers or []),
            "productivity": round(float(actual / target * 100), 2) if target else 0,
        })

    planned_total = sum((Decimal(str(line["planned"])) for line in consumption_lines), Decimal("0"))
    actual_total = sum((Decimal(str(line["actual"])) for line in consumption_lines), Decimal("0"))
    scrap_total = sum((scrap.quantity for scrap in scrap_records), Decimal("0"))
    scrap_planned = sum((Decimal(str(line["planned_quantity"])) for line in wastage_lines), Decimal("0"))
    return {
        "production": {"total_orders": len(orders), "completed_orders": sum(order.status in complete_statuses for order in orders),
                       "pending_orders": sum(order.status not in complete_statuses for order in orders), "delayed_orders": len(delayed),
                       "delayed": [{"order_number": row.order_number, "required_date": row.required_date.isoformat(), "status": row.status} for row in delayed]},
        "consumption": {"planned": float(planned_total), "actual": float(actual_total), "variance": float(actual_total - planned_total), "lines": consumption_lines},
        "wastage": {"material_wastage": float(scrap_total), "scrap_quantity": float(scrap_total),
                    "wastage_percentage": round(float(scrap_total / scrap_planned * 100), 2) if scrap_planned else 0, "lines": wastage_lines},
        "quality": {"passed": float(passed), "failed": float(failed), "rework": float(rework),
                    "rejection_rate": round(float(failed / inspected * 100), 2) if inspected else 0},
        "team_performance": team_lines,
        "generated_at": datetime.now().isoformat(),
    }


@router.get("/overview/{section}")
async def assembly_module_overview(section: str, uow: UnitOfWork = Depends(get_uow)):
    section = section.strip().lower().replace("_", "-")
    supported = {"material-requirements", "material-reservations", "material-issues", "work-orders",
                 "assembly-progress", "material-consumption", "scrap-wastage", "quality-inspection",
                 "rework", "finished-goods"}
    if section not in supported:
        raise HTTPException(status_code=404, detail="Assembly overview section not found")
    await backfill_issued_orders(uow)
    orders = list((await uow.session.execute(select(AssemblyOrderModel).order_by(
        AssemblyOrderModel.created_at.desc()
    ))).scalars().all())
    order_map = {order.id: order for order in orders}
    rows: list[dict] = []
    columns: list[dict] = []

    if section == "material-requirements":
        columns = [{"key": "order", "label": "Assembly order"}, {"key": "material", "label": "Material"},
                   {"key": "required", "label": "Required"}, {"key": "available", "label": "Available"},
                   {"key": "status", "label": "Status"}]
        reservations = list((await uow.session.execute(select(AssemblyMaterialReservationModel))).scalars().all())
        reservation_map = {(row.assembly_order_id, row.material_code): row.quantity for row in reservations if row.status == "RESERVED"}
        stocks = {row.material_code: row for row in (await uow.session.execute(select(MaterialStockModel))).scalars().all()}
        for order in orders:
            for code, requirement in aggregate_requirements(order.items or []).items():
                stock = stocks.get(code); required = requirement["quantity"]
                reserved = reservation_map.get((order.id, code), Decimal("0")); free = stock.available if stock else Decimal("0")
                status, _ = material_requirement_status(required, free, reserved)
                rows.append({"order": order.order_number, "material": requirement["item"].get("material_name") or code,
                             "required": f"{required:g} {requirement['item'].get('uom') or 'PCS'}",
                             "available": f"{(stock.on_hand if stock else Decimal('0')):g}", "status": status,
                             "order_id": str(order.id)})
    elif section == "material-reservations":
        columns = [{"key": "order", "label": "Assembly order"}, {"key": "material", "label": "Material"},
                   {"key": "quantity", "label": "Reserved quantity"}, {"key": "reserved_by", "label": "Reserved by"},
                   {"key": "reserved_at", "label": "Reserved at"}, {"key": "status", "label": "Status"}]
        records = (await uow.session.execute(select(AssemblyMaterialReservationModel).order_by(
            AssemblyMaterialReservationModel.reserved_at.desc()))).scalars().all()
        for record in records:
            order = order_map.get(record.assembly_order_id)
            rows.append({"order": order.order_number if order else "—", "material": record.material_code,
                         "quantity": f"{record.quantity:g} {record.uom}", "reserved_by": record.reserved_by,
                         "reserved_at": record.reserved_at.isoformat(), "status": record.status,
                         "order_id": str(record.assembly_order_id)})
    elif section == "material-issues":
        columns = [{"key": "order", "label": "Assembly order"}, {"key": "issue", "label": "Pickup task"},
                   {"key": "warehouse", "label": "Store"}, {"key": "materials", "label": "Material / quantity"},
                   {"key": "issued_by", "label": "Picked by"}, {"key": "issued_at", "label": "Updated"},
                   {"key": "status", "label": "Status"}]
        pickup_tasks = (await uow.session.execute(select(PickupTaskModel).order_by(
            PickupTaskModel.updated_at.desc()
        ))).scalars().all()
        order_by_request = {order.request_number: order for order in orders if order.request_number}
        for task in pickup_tasks:
            order = order_by_request.get(task.requisition_number)
            picked = task.picked_quantity or Decimal("0")
            requested = task.requested_quantity or Decimal("0")
            rows.append({
                "order": order.order_number if order else task.requisition_number,
                "issue": task.task_number,
                "warehouse": task.store_name or task.store_code,
                "materials": f"{task.material_code} ({picked:g}/{requested:g} {task.uom})",
                "issued_by": task.completed_by or task.started_by or task.assigned_by,
                "issued_at": (task.completed_at or task.updated_at or task.created_at).isoformat(),
                "status": task.status,
                "order_id": str(order.id) if order else None,
            })
    elif section == "material-issues-legacy":
        columns = [{"key": "order", "label": "Assembly order"}, {"key": "issue", "label": "Issue number"},
                   {"key": "warehouse", "label": "Warehouse"}, {"key": "materials", "label": "Materials"},
                   {"key": "issued_by", "label": "Issued by"}, {"key": "issued_at", "label": "Issue date"},
                   {"key": "status", "label": "Status"}]
        for order in orders:
            issue = await uow.session.get(MaterialIssueModel, order.material_issue_id)
            task = await uow.session.get(PickTaskModel, order.pick_task_id)
            if issue:
                rows.append({"order": order.order_number, "issue": issue.issue_number,
                             "warehouse": task.warehouse_id if task else "—", "materials": len(issue.items or []),
                             "issued_by": issue.issued_by, "issued_at": issue.issued_at.isoformat(), "status": "ISSUED",
                             "order_id": str(order.id)})
    elif section == "work-orders":
        columns = [{"key": "order", "label": "Work order"}, {"key": "product", "label": "Product"},
                   {"key": "target", "label": "Target"}, {"key": "team", "label": "Assembly team"},
                   {"key": "steps", "label": "Steps completed"}, {"key": "status", "label": "Status"}]
        for order in orders:
            steps = order.assembly_steps or default_assembly_steps()
            rows.append({"order": order.order_number, "product": order.product_name, "target": float(order.planned_quantity),
                         "team": order.assigned_team or "Not assigned", "steps": f"{sum(s.get('status') == 'COMPLETED' for s in steps)} / {len(steps)}",
                         "status": order.status, "order_id": str(order.id)})
    elif section == "assembly-progress":
        columns = [{"key": "order", "label": "Assembly order"}, {"key": "team", "label": "Team"},
                   {"key": "target", "label": "Target"}, {"key": "completed", "label": "Completed"},
                   {"key": "remaining", "label": "Remaining"}, {"key": "progress", "label": "Progress"},
                   {"key": "status", "label": "Status"}]
        for order in orders:
            progress = calculate_assembly_progress(order.planned_quantity, order.completed_quantity, order.status)
            rows.append({"order": order.order_number, "team": order.assigned_team or "Not assigned", "target": progress["target"],
                         "completed": progress["completed"], "remaining": progress["remaining"],
                         "progress": f"{progress['progress_percent']}%", "status": progress["progress_status"], "order_id": str(order.id)})
    elif section == "material-consumption":
        columns = [{"key": "order", "label": "Assembly order"}, {"key": "material", "label": "Material"},
                   {"key": "planned", "label": "Planned"}, {"key": "actual", "label": "Actual"},
                   {"key": "variance", "label": "Variance"}, {"key": "status", "label": "Status"}]
        records = (await uow.session.execute(select(AssemblyMaterialConsumptionModel).order_by(
            AssemblyMaterialConsumptionModel.updated_at.desc()))).scalars().all()
        for record in records:
            variance = calculate_material_variance(record.expected_per_unit, record.assembled_quantity, record.actual_consumed)
            order = order_map.get(record.assembly_order_id)
            rows.append({"order": order.order_number if order else "—", "material": record.material_code,
                         "planned": variance["expected_consumption"], "actual": variance["actual_consumption"],
                         "variance": variance["variance_quantity"], "status": variance["status"], "order_id": str(record.assembly_order_id)})
    elif section == "scrap-wastage":
        columns = [{"key": "order", "label": "Assembly order"}, {"key": "material", "label": "Material"},
                   {"key": "quantity", "label": "Scrap quantity"}, {"key": "reason", "label": "Reason"},
                   {"key": "employee", "label": "Employee / team"}, {"key": "date", "label": "Date"},
                   {"key": "status", "label": "Approval"}]
        records = (await uow.session.execute(select(AssemblyScrapModel).order_by(AssemblyScrapModel.recorded_at.desc()))).scalars().all()
        for record in records:
            order = order_map.get(record.assembly_order_id)
            rows.append({"order": order.order_number if order else "—", "material": record.material_code,
                         "quantity": f"{record.quantity:g} {record.uom}", "reason": record.reason,
                         "employee": record.employee_team, "date": record.recorded_at.isoformat(),
                         "status": record.status, "order_id": str(record.assembly_order_id)})
    elif section == "quality-inspection":
        columns = [{"key": "order", "label": "Assembly order"}, {"key": "produced", "label": "Produced"},
                   {"key": "passed", "label": "Passed"}, {"key": "failed", "label": "Failed"},
                   {"key": "rework", "label": "Rework"}, {"key": "inspector", "label": "Inspected by"},
                   {"key": "status", "label": "Result"}]
        records = (await uow.session.execute(select(AssemblyQualityInspectionModel).order_by(
            AssemblyQualityInspectionModel.updated_at.desc()))).scalars().all()
        for record in records:
            order = order_map.get(record.assembly_order_id)
            rows.append({"order": order.order_number if order else "—", "produced": float(record.produced_quantity),
                         "passed": float(record.passed_quantity), "failed": float(record.failed_quantity),
                         "rework": float(record.rework_quantity), "inspector": record.inspected_by or "Pending",
                         "status": record.status, "order_id": str(record.assembly_order_id)})
    elif section == "rework":
        columns = [{"key": "rework", "label": "Rework order"}, {"key": "assembly", "label": "Assembly order"},
                   {"key": "reason", "label": "Failure reason"}, {"key": "quantity", "label": "Failed quantity"},
                   {"key": "assignment", "label": "Team / worker"}, {"key": "status", "label": "Status"},
                   {"key": "result", "label": "Final result"}]
        records = (await uow.session.execute(select(AssemblyReworkOrderModel).order_by(
            AssemblyReworkOrderModel.created_at.desc()))).scalars().all()
        for record in records:
            order = order_map.get(record.assembly_order_id)
            rows.append({"rework": record.rework_number, "assembly": order.order_number if order else "—",
                         "reason": record.reason_for_failure, "quantity": float(record.failed_quantity),
                         "assignment": f"{record.assigned_team} / {record.assigned_worker or 'Team'}",
                         "status": record.status, "result": record.final_result, "order_id": str(record.assembly_order_id)})
    elif section == "finished-goods":
        columns = [
            {"key": "product", "label": "Finished Good"},
            {"key": "qr_code", "label": "QR Code"},
            {"key": "quantity", "label": "Quantity"},
            {"key": "store", "label": "Store"},
            {"key": "location", "label": "Zone / Bin Location"},
            {"key": "order_number", "label": "Assembly Order"},
            {"key": "status", "label": "Status"},
            {"key": "posted", "label": "Posted At"},
        ]
        records = (await uow.session.execute(
            select(AssemblyFinishedGoodsModel).order_by(AssemblyFinishedGoodsModel.updated_at.desc())
        )).scalars().all()
        stores = {s.id: s for s in (await uow.session.execute(select(StoreModel))).scalars().all()}
        orders = {o.id: o for o in (await uow.session.execute(select(AssemblyOrderModel))).scalars().all()}
        for record in records:
            st = stores.get(record.store_id)
            ord_obj = orders.get(record.assembly_order_id)
            unit_tasks = (await uow.session.execute(
                select(PutawayTaskModel).where(
                    PutawayTaskModel.finished_goods_id == record.id
                ).order_by(PutawayTaskModel.created_at.asc())
            )).scalars().all()
            for unit_task in unit_tasks or [None]:
                metadata = unit_task.placement_metadata if unit_task else {}
                unit_qr = metadata.get("unit_qr") if metadata else None
                rows.append({
                    "id": str(unit_task.id if unit_task else record.id),
                    "product": f"{record.product_name} ({record.product_code})",
                    "code": record.product_code,
                    "qr_code": unit_qr or record.qr_code,
                    "quantity": f"{unit_task.quantity:g} {unit_task.uom}" if unit_task else f"{record.quantity:g} {record.uom}",
                    "store": st.store_name if st else "Finished Goods Store",
                    "store_code": st.store_code if st else "STR-FG",
                    "location": (unit_task.destination_bin_code or unit_task.destination_bin) if unit_task else record.location_code,
                    "warehouse": record.warehouse_id,
                    "order_number": ord_obj.order_number if ord_obj else None,
                    "order": ord_obj.order_number if ord_obj else None,
                    "order_id": str(record.assembly_order_id) if record.assembly_order_id else None,
                    "status": unit_task.status if unit_task else record.status,
                    "posted": record.posted_at.isoformat() if record.posted_at else None,
                })

    status_counts = defaultdict(int)
    for row in rows: status_counts[str(row.get("status") or row.get("result") or "RECORDED")] += 1
    return {"section": section, "total": len(rows), "columns": columns, "rows": rows,
            "status_summary": [{"status": key, "count": value} for key, value in status_counts.items()],
            "generated_at": datetime.now().isoformat()}


@router.get("/dashboard")
async def assembly_dashboard(uow: UnitOfWork = Depends(get_uow)):
    await backfill_issued_orders(uow)
    result = await uow.session.execute(select(AssemblyOrderModel).order_by(AssemblyOrderModel.created_at.asc()))
    orders = list(result.scalars().all())
    statuses = defaultdict(int)
    consumption = defaultdict(float)
    for order in orders:
        statuses[order.status] += 1
        for item in order.items or []:
            consumption[item.get("material_name") or item.get("material_code") or "Material"] += float(item.get("quantity") or 0)
    today = date.today()
    for order in orders:
        await add_assembly_notification(uow, "New assembly order created",
                                        f"{order.order_number} was created for {order.product_name}.", order)
        issue = await uow.session.get(MaterialIssueModel, order.material_issue_id)
        if issue:
            await add_assembly_notification(uow, "Material issued",
                                            f"Materials for {order.order_number} were issued under {issue.issue_number}.", order)
        if order.required_date and order.required_date < today and order.status not in {"COMPLETED", "QUALITY_CHECK", "CLOSED"}:
            await add_assembly_notification(uow, "Assembly delayed",
                                            f"{order.order_number} passed its required date of {order.required_date.isoformat()}.", order)
        if order.status == "MATERIAL_SHORTAGE":
            await add_assembly_notification(uow, "Material shortage",
                                            f"{order.order_number} cannot proceed because required material is short.", order)
        if order.status == "QUALITY_CHECK":
            await add_assembly_notification(uow, "Quality inspection pending",
                                            f"{order.order_number} is awaiting finished assembly inspection.", order)
        if order.completed_at:
            await add_assembly_notification(uow, "Assembly completed",
                                            f"Assembly work for {order.order_number} is complete.", order)
    inspections_result = await uow.session.execute(select(AssemblyQualityInspectionModel))
    for inspection in inspections_result.scalars().all():
        order = next((row for row in orders if row.id == inspection.assembly_order_id), None)
        if order and inspection.status == "FAILED":
            await add_assembly_notification(uow, "Quality failed",
                                            f"{order.order_number} failed quality inspection for {inspection.failed_quantity:g} units.", order)
        if order and inspection.status == "REWORK_REQUIRED":
            await add_assembly_notification(uow, "Rework required",
                                            f"{order.order_number} requires rework for {inspection.rework_quantity:g} units.", order)
    rework_result = await uow.session.execute(select(AssemblyReworkOrderModel))
    for rework in rework_result.scalars().all():
        order = next((row for row in orders if row.id == rework.assembly_order_id), None)
        if order:
            await add_assembly_notification(uow, "Rework required",
                                            f"{rework.rework_number} assigned to {rework.assigned_team} for {rework.failed_quantity:g} units.", order)
    finished_result = await uow.session.execute(select(AssemblyFinishedGoodsModel))
    for finished in finished_result.scalars().all():
        order = next((row for row in orders if row.id == finished.assembly_order_id), None)
        if order:
            await add_assembly_notification(uow, "Finished goods transferred to inventory",
                                            f"{finished.quantity:g} {finished.uom} of {finished.product_name} from {order.order_number} posted to {finished.warehouse_id} / {finished.location_code}.", order)
    await uow.commit()
    notification_result = await uow.session.execute(select(NotificationModel).where(
        NotificationModel.user_role == "ASSEMBLY_MANAGER"
    ).order_by(NotificationModel.created_at.desc()).limit(12))
    notifications = [{"id": str(row.id), "title": row.title, "message": row.message, "link": row.link,
                      "is_read": row.is_read, "created_at": row.created_at.isoformat()} for row in notification_result.scalars().all()]
    fg_req_result = await uow.session.execute(
        select(FinishedGoodsRequestModel).where(
            FinishedGoodsRequestModel.status.in_(["SENT_TO_ASSEMBLY", "PENDING", "SUBMITTED", "READY", "DRAFT"])
        )
    )
    pending_fg_requests = list(fg_req_result.scalars().all())
    pending_fg_count = len(pending_fg_requests)

    for fg_req in pending_fg_requests:
        await add_assembly_notification(
            uow,
            "Finished goods request received",
            f"{fg_req.request_number} requested for {fg_req.quantity:g} {fg_req.uom or 'PCS'} of {fg_req.finished_goods_name or fg_req.finished_goods_code or 'Product'}.",
            None,
        )

    output = []
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        output.append({"date": day.strftime("%d %b"),
                       "completed": sum(float(o.completed_quantity) for o in orders if o.completed_at and o.completed_at.date() == day),
                       "rejected": sum(float(o.rejected_quantity) for o in orders if o.completed_at and o.completed_at.date() == day)})
    total_completed = sum(float(o.completed_quantity) for o in orders)
    total_rejected = sum(float(o.rejected_quantity) for o in orders)
    status_keys = ["DRAFT", "RELEASED", "MATERIAL_CHECK", "READY", "IN_PROGRESS", "COMPLETED", "QUALITY_CHECK", "CLOSED", "ON_HOLD", "MATERIAL_SHORTAGE"]
    return {
        "stats": {
            # Keep Assembly Order KPIs sourced from AssemblyOrderModel only.
            # Finished-goods requests are a separate intake workflow and must
            # not make the Orders card point to an empty order list.
            "total": len(orders),
            "pending": sum(statuses[key] for key in ["DRAFT", "RELEASED", "MATERIAL_CHECK", "READY"]),
            "in_progress": statuses["IN_PROGRESS"],
            "completed": sum(statuses[key] for key in ["COMPLETED", "QUALITY_CHECK", "CLOSED"]),
            "on_hold": statuses["ON_HOLD"],
            "material_shortage": statuses["MATERIAL_SHORTAGE"],
            "quality_pending": statuses["QUALITY_CHECK"],
            "putaway_pending": sum(1 for o in orders if getattr(o, "putaway_status", "PUTAWAY_PENDING") == "PUTAWAY_PENDING"),
            "putaway_in_progress": sum(1 for o in orders if getattr(o, "putaway_status", "PUTAWAY_PENDING") == "PUTAWAY_IN_PROGRESS"),
            "putaway_completed": sum(1 for o in orders if getattr(o, "putaway_status", "PUTAWAY_PENDING") == "PUTAWAY_COMPLETED"),
            "today_output": sum(float(o.completed_quantity) for o in orders if o.completed_at and o.completed_at.date() == today),
        },
        "status_chart": [{"status": key.replace("_", " ").title(), "count": statuses[key]} for key in status_keys],
        "output_chart": output,
        "consumption_chart": [{"material": key, "quantity": value} for key, value in sorted(consumption.items(), key=lambda x: -x[1])[:6]],
        "quality": {"completed": total_completed, "rejected": total_rejected,
                    "defect_rate": round(total_rejected / (total_completed + total_rejected) * 100, 2) if total_completed + total_rejected else 0},
        "notifications": notifications,
        "orders": [serialize_order(order) for order in reversed(orders)],
    }
