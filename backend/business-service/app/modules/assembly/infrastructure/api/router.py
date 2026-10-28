from __future__ import annotations

from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
import logging
import re
from typing import Any, Dict, List, Optional
import uuid
import unicodedata
from types import SimpleNamespace
from sqlalchemy.exc import IntegrityError

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select

from app.database.session import UnitOfWork, get_uow
from app.modules.assembly.infrastructure.finished_goods import allocate_fifo, stock_quantities, dispatch_priorities, enforce_dispatch_priority
from app.modules.assembly.infrastructure.persistence.models import (
    AssemblyFinishedGoodsModel,
    AssemblyFinishedGoodsAllocationModel,
    AssemblyOrderModel,
    AssemblyMaterialReceiptModel,
    AssemblyMaterialConsumptionModel,
    AssemblyScrapModel,
    AssemblyQualityInspectionModel,
    AssemblyRoutingRevisionModel,
    BillOfMaterialsItemModel,
    BillOfMaterialsModel,
)
from app.modules.store.infrastructure.persistence.models import StoreBinModel, StoreManagerUserModel
from app.modules.storage.infrastructure.persistence.models import (
    InventoryLocationBalanceModel,
    InventoryMovementHistoryModel,
    StorageLocationModel,
)
from app.common.persistence.models import (
    MaterialModel,
    MaterialIssueModel,
    MaterialRequestItemModel,
    MaterialRequestModel,
    MaterialStockModel,
    NotificationModel,
    PickTaskModel,
    FinishedGoodsRequestModel,
)
from app.security.dependencies import CurrentUser, get_current_user
from app.modules.dispatch.infrastructure.persistence.models import DispatchModel, DispatchItemModel
from app.modules.gate.infrastructure.persistence.models import FinishedGoodsPickupGateVisitModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/assembly", tags=["assembly"])


class SupplierFinishedGoodsDispatchRequestPayload(BaseModel):
    product_code: str = Field(..., min_length=1)
    product_name: str = Field(..., min_length=1)
    quantity: Decimal = Field(..., gt=0)
    uom: str = Field(default="PCS", min_length=1)
    vehicle_number: str = Field(..., min_length=1)
    driver_name: str = Field(..., min_length=1)
    driver_contact: str = Field(..., min_length=3)
    expected_pickup_date: date
    remarks: Optional[str] = None

    @field_validator("expected_pickup_date", mode="before")
    @classmethod
    def validate_pickup_date_format(cls, value):
        if isinstance(value, datetime) or not isinstance(value, (str, date)):
            raise ValueError("Expected pickup date must be a calendar date (YYYY-MM-DD)")
        if isinstance(value, str) and not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError("Expected pickup date must use YYYY-MM-DD")
        return value

    @field_validator("expected_pickup_date")
    @classmethod
    def validate_pickup_date_range(cls, value):
        today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
        if value < today:
            raise ValueError("Pickup date must be today or later")
        return value


class FinishedGoodsRequestFifoAllocationPayload(BaseModel):
    allocations: Optional[List[Dict[str, Any]]] = None
    exception_reason: Optional[str] = None


class FinishedGoodsPickScanPayload(BaseModel):
    qr_code: str = Field(..., min_length=3)
    quantity: Decimal = Field(..., gt=0)


@router.post("/supplier/finished-goods-dispatch-requests")
async def create_supplier_finished_goods_dispatch_request(
    payload: SupplierFinishedGoodsDispatchRequestPayload,
    uow: UnitOfWork = Depends(get_uow),
    current_user: CurrentUser = Depends(get_current_user),
):
    vehicle_number = payload.vehicle_number.strip().upper()
    driver_name = " ".join(payload.driver_name.split())
    driver_contact = payload.driver_contact.strip()
    if not re.fullmatch(r"[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4}", vehicle_number):
        raise HTTPException(422, "Enter a valid vehicle number.")
    if not re.fullmatch(r"[A-Za-z][A-Za-z .-]*", driver_name):
        raise HTTPException(422, "Driver name is required.")
    if not re.fullmatch(r"[6-9]\d{9}", driver_contact):
        raise HTTPException(422, "Enter a valid 10-digit mobile number.")
    if payload.expected_pickup_date < datetime.now(timezone(timedelta(hours=5, minutes=30))).date():
        raise HTTPException(422, "Select today or a future pickup date.")
    if payload.quantity != payload.quantity.to_integral_value():
        raise HTTPException(422, "Dispatch quantity must be a whole number.")
    async with uow:
        now = datetime.now()
        year = now.strftime("%Y")
        prefix = f"FGD-{year}-"
        existing_numbers = await uow.session.execute(
            select(FinishedGoodsRequestModel.request_number).where(
                FinishedGoodsRequestModel.request_number.like(f"{prefix}%")
            )
        )
        used_numbers = {
            int(number.removeprefix(prefix))
            for number in existing_numbers.scalars().all()
            if number and number.removeprefix(prefix).isdigit()
        }
        sequence = 1
        while sequence in used_numbers:
            sequence += 1
        request_number = f"{prefix}{sequence:03d}"
        supplier_id = current_user.raw_claims.get("supplier_id") or current_user.subject
        row = FinishedGoodsRequestModel(
            request_number=request_number, material_code=payload.product_code, material_name=payload.product_name,
            quantity=payload.quantity, uom=payload.uom, warehouse="ASSEMBLY", requested_by=current_user.username,
            department="SUPPLIER", priority="MEDIUM", required_date=payload.expected_pickup_date,
            requested_date=now.date(), remarks=payload.remarks, status="PENDING_ASSEMBLY", supplier_id=str(supplier_id),
            supplier_name=current_user.username, vehicle_number=vehicle_number, driver_name=driver_name,
            driver_contact=driver_contact, expected_pickup_date=payload.expected_pickup_date,
        )
        uow.session.add(row)
        uow.session.add(NotificationModel(user_role="ASSEMBLY_MANAGER", title="Supplier FG dispatch request", message=f"{request_number} requests {payload.quantity:g} {payload.uom} of {payload.product_name}.", link="/assembly/dispatch"))
        await uow.commit()
        return {"request_number": request_number, "status": row.status, "supplier_id": str(supplier_id)}


def _supplier_dispatch_state(request, dispatch, visit):
    """One backend classification for badges, filters and security completion."""
    pickup_exit = bool(visit and visit.status == "CLOSED" and visit.exited_at and visit.exit_approved_by)
    dispatch_exit = bool(dispatch and dispatch.gate_exit_completed_at and dispatch.gate_exit_security_officer
                         and dispatch.gate_exit_vehicle_verified and dispatch.gate_exit_driver_verified
                         and dispatch.gate_exit_loaded_goods_verified)
    exited = pickup_exit or dispatch_exit
    raw = dispatch.status if dispatch else request.status
    cancelled = request.status == "CANCELLED" or raw == "CANCELLED"
    if exited:
        workflow_status, group = "COMPLETED", "COMPLETE"
    elif cancelled:
        workflow_status, group = "CANCELLED", "COMPLETE"
    elif raw in ("DISPATCHED", "GATE_OUT", "EXIT_COMPLETED", "COMPLETED", "CLOSED", "DELIVERED"):
        workflow_status, group = "AWAITING_GATE_EXIT", "2"
    elif raw in ("PACKED", "DISPATCH_READY", "ROUTE_ASSIGNED", "VEHICLE_ALLOCATED", "DRIVER_ALLOCATED",
                 "LOADING_STARTED", "LOADING_VERIFIED", "LOADED", "READY_FOR_GATE_EXIT"):
        workflow_status, group = raw, "2"
    elif raw in ("ALLOCATED", "STOCK_RESERVED", "PICKING_IN_PROGRESS", "PICKED", "PICKING_COMPLETED", "PACKING_IN_PROGRESS"):
        workflow_status, group = raw, "1"
    else:
        workflow_status, group = raw, "0"
    exit_time = visit.exited_at if pickup_exit else dispatch.gate_exit_completed_at if dispatch_exit else None
    return {"workflow_status": workflow_status, "processing_group": group,
            "gate_exit_confirmed": exited, "gate_exited_at": exit_time.isoformat() if exit_time else None}


@router.get("/supplier/finished-goods-dispatch-requests")
async def list_supplier_finished_goods_dispatch_requests(
    uow: UnitOfWork = Depends(get_uow), current_user: CurrentUser = Depends(get_current_user),
):
    async with uow:
        query = select(FinishedGoodsRequestModel)
        if not any(role.upper() in {"ASSEMBLY", "ASSEMBLY_MANAGER", "ADMIN", "SUPERUSER", "GATE", "SECURITY", "GATE_SECURITY"} for role in current_user.roles):
            query = query.where(FinishedGoodsRequestModel.supplier_id == str(current_user.raw_claims.get("supplier_id") or current_user.subject))
        rows = (await uow.session.execute(query.order_by(FinishedGoodsRequestModel.created_at, FinishedGoodsRequestModel.id))).scalars().all()
        visits = (await uow.session.execute(select(FinishedGoodsPickupGateVisitModel))).scalars().all()
        visit_by_request = {str(visit.request_id): visit for visit in visits}
        dispatches = (await uow.session.execute(select(DispatchModel).where(DispatchModel.order_number.in_([r.request_number for r in rows])))).scalars().all()
        dispatch_by_number = {d.order_number: d for d in dispatches}
        allocated_rows = (await uow.session.execute(
            select(AssemblyFinishedGoodsAllocationModel, AssemblyFinishedGoodsModel)
            .join(AssemblyFinishedGoodsModel, AssemblyFinishedGoodsModel.id == AssemblyFinishedGoodsAllocationModel.finished_goods_id)
            .where(AssemblyFinishedGoodsAllocationModel.finished_goods_request_id.in_([r.id for r in rows]))
            .order_by(AssemblyFinishedGoodsModel.posted_at, AssemblyFinishedGoodsModel.id)
        )).all()
        allocations_by_request = {}
        for allocation, fg in allocated_rows:
            allocations_by_request.setdefault(allocation.finished_goods_request_id, []).append({
                "finished_goods_id": str(fg.id), "batch_number": fg.batch_number,
                "quantity": float(allocation.quantity), "qr_code": fg.qr_code,
                "status": allocation.status, "location_code": fg.location_code,
            })
        priorities = await dispatch_priorities(uow.session)
        # Rank the complete submission history, never just pending requests.
        # Completed/cancelled requests retain their place when other rows progress.
        history_ids = (await uow.session.execute(select(FinishedGoodsRequestModel.id).where(
            FinishedGoodsRequestModel.warehouse == "ASSEMBLY",
            FinishedGoodsRequestModel.department == "SUPPLIER",
        ).order_by(FinishedGoodsRequestModel.created_at, FinishedGoodsRequestModel.id))).scalars().all()
        original_priority = {identifier: rank for rank, identifier in enumerate(history_ids, 1)}
        results = []
        for r in rows:
            dispatch = dispatch_by_number.get(r.request_number)
            visit = visit_by_request.get(str(r.id))
            workflow = _supplier_dispatch_state(r, dispatch, visit)
            results.append({"id": str(r.id), "request_number": r.request_number,
                "dispatch_number": r.request_number, "order_number": r.request_number,
                "supplier_name": r.supplier_name, "product_code": r.material_code,
                "product_name": r.material_name, "quantity": float(r.quantity), "uom": r.uom,
                "items": [{"material_code": r.material_code, "material_name": r.material_name, "quantity_ordered": float(r.quantity), "uom": r.uom}],
                "vehicle_number": r.vehicle_number, "driver_name": r.driver_name, "driver_contact": r.driver_contact,
                "expected_pickup_date": (r.expected_pickup_date or r.required_date).isoformat(), "status": r.status,
                "dispatch_id": str(dispatch.id) if dispatch else None, "dispatch_status": dispatch.status if dispatch else None,
                "allocated_batches": allocations_by_request.get(r.id, []),
                "gate_pass_number": visit.gate_pass_number if visit else None, "gate_pass_status": "CLOSED" if workflow["gate_exit_confirmed"] else visit.status if visit else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "requested_on": r.created_at.isoformat() if r.created_at else None,
                **priorities.get(r.id, {"priority_rank": None, "next_to_process": False, "allocation_eligible": False, "priority_reason": None}),
                "processing_priority_rank": priorities.get(r.id, {}).get("priority_rank"),
                "priority_rank": original_priority.get(r.id),
                **workflow})
        results.sort(key=lambda row: (row["priority_rank"] is None, row["priority_rank"] or 0, row["requested_on"] or "", row["id"]))
        return results


@router.post("/supplier/finished-goods-dispatch-requests/{request_id}/allocate-fifo")
async def allocate_supplier_finished_goods_fifo(
    request_id: str, payload: FinishedGoodsRequestFifoAllocationPayload = FinishedGoodsRequestFifoAllocationPayload(),
    uow: UnitOfWork = Depends(get_uow), current_user: CurrentUser = Depends(get_current_user),
):
    async with uow:
        try: request_uuid = uuid.UUID(request_id)
        except ValueError: raise HTTPException(400, "Invalid dispatch request identifier")
        await enforce_dispatch_priority(uow.session, request_uuid)
        request = (await uow.session.execute(select(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.id == request_uuid).with_for_update())).scalar_one_or_none()
        if not request: raise HTTPException(404, "Finished-goods dispatch request not found")
        if request.status not in ("PENDING_ASSEMBLY", "APPROVED", "ALLOCATED"):
            raise HTTPException(409, f"Request is already {request.status}")
        existing = (await uow.session.execute(select(AssemblyFinishedGoodsAllocationModel).where(AssemblyFinishedGoodsAllocationModel.finished_goods_request_id == request.id))).scalars().all()
        linked_dispatch = (await uow.session.execute(select(DispatchModel).where(DispatchModel.order_number == request.request_number))).scalar_one_or_none()
        if not linked_dispatch:
            linked_dispatch = DispatchModel(id=uuid.uuid4(), dispatch_number=request.request_number, order_number=request.request_number, customer_name=request.supplier_name or "Supplier", warehouse_id="ASSEMBLY", dispatch_type="SUPPLIER_FINISHED_GOODS", status="STOCK_RESERVED", priority="Normal", notes=request.remarks)
            uow.session.add(linked_dispatch)
            linked_item = DispatchItemModel(id=uuid.uuid4(), dispatch_order_id=linked_dispatch.id, material_code=request.material_code, material_name=request.material_name, quantity_ordered=request.quantity, quantity_available=request.quantity, quantity_reserved=request.quantity, quantity_pending=0, uom=request.uom, status="RESERVED")
            uow.session.add(linked_item)
            await uow.session.flush()
            for allocation in existing:
                allocation.dispatch_order_id = linked_dispatch.id
                allocation.dispatch_item_id = linked_item.id
        else:
            linked_item = (await uow.session.execute(select(DispatchItemModel).where(DispatchItemModel.dispatch_order_id == linked_dispatch.id))).scalars().first()
            if not linked_item:
                linked_item = DispatchItemModel(id=uuid.uuid4(), dispatch_order_id=linked_dispatch.id, material_code=request.material_code, material_name=request.material_name, quantity_ordered=request.quantity, quantity_available=request.quantity, quantity_reserved=request.quantity, quantity_pending=0, uom=request.uom, status="RESERVED")
                uow.session.add(linked_item)
        if request.status == "ALLOCATED":
            await uow.commit()
            finished_goods = (await uow.session.execute(select(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.id.in_([a.finished_goods_id for a in existing])))).scalars().all()
            qr_by_id = {fg.id: fg.qr_code for fg in finished_goods}
            return {"request_number": request.request_number, "status": request.status, "dispatch_number": linked_dispatch.dispatch_number, "dispatch_id": str(linked_dispatch.id), "allocated": [{"finished_goods_id": str(a.finished_goods_id), "quantity": float(a.quantity), "status": a.status, "qr_code": qr_by_id.get(a.finished_goods_id)} for a in existing], "fifo_enforced": True, "already_allocated": True}
        if request.status not in ("PENDING_ASSEMBLY", "APPROVED"): raise HTTPException(409, f"Request is already {request.status}")
        allocated = await allocate_fifo(uow.session, linked_dispatch.id, request.id)
        request.status = "ALLOCATED"
        await uow.commit()
        return {"request_number": request.request_number, "status": request.status, "allocated": allocated, "fifo_enforced": True}


@router.post("/dispatch/{dispatch_id}/scan-finished-goods")
async def scan_allocated_finished_goods(
    dispatch_id: str, payload: FinishedGoodsPickScanPayload,
    uow: UnitOfWork = Depends(get_uow), current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    async with uow:
        try: dispatch_uuid = uuid.UUID(dispatch_id)
        except ValueError: raise HTTPException(400, "Invalid dispatch identifier")
        fg = (await uow.session.execute(select(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.qr_code == payload.qr_code.strip()))).scalar_one_or_none()
        if not fg or fg.status not in ("QC_APPROVED", "AVAILABLE"): raise HTTPException(422, "QR is not a QC-approved finished-good batch")
        allocation = (await uow.session.execute(select(AssemblyFinishedGoodsAllocationModel).where(AssemblyFinishedGoodsAllocationModel.dispatch_order_id == dispatch_uuid, AssemblyFinishedGoodsAllocationModel.finished_goods_id == fg.id, AssemblyFinishedGoodsAllocationModel.status.in_(["ALLOCATED", "LOADED"])))).scalar_one_or_none()
        if not allocation: raise HTTPException(422, "Finished-good batch is not allocated to this dispatch")
        if payload.quantity > allocation.quantity: raise HTTPException(422, "Scanned quantity exceeds the FIFO allocation")
        return {"status": "QR_VERIFIED", "dispatch_id": dispatch_id, "finished_goods_id": str(fg.id), "batch_number": fg.batch_number, "quantity_verified": float(payload.quantity), "location_code": fg.location_code}


def _calculate_progress(order: AssemblyOrderModel) -> float:
    """Calculate order progress percentage based on completed quantity or work steps."""
    if order.status in ("COMPLETED", "PACKED", "READY_FOR_DISPATCH", "DISPATCHED", "CLOSED"):
        return 100.0
    if order.planned_quantity and order.planned_quantity > Decimal("0"):
        qty_progress = float(order.completed_quantity / order.planned_quantity * 100)
        if qty_progress > 0:
            return round(qty_progress, 1)

    steps = order.assembly_steps or []
    if steps:
        completed = sum(1 for s in steps if isinstance(s, dict) and s.get("status") in ("COMPLETED", "DONE", "PASSED"))
        return round((completed / len(steps)) * 100, 1)

    return 0.0


def _serialize_order(order: AssemblyOrderModel) -> Dict[str, Any]:
    return {
        "id": str(order.id),
        "order_number": order.order_number,
        "product_code": order.product_code or "",
        "product_name": order.product_name,
        "bom_id": str(order.bom_id) if order.bom_id else None,
        "bom_number": order.bom_number or "",
        "target_quantity": float(order.planned_quantity),
        "planned_quantity": float(order.planned_quantity),
        "completed_quantity": float(order.completed_quantity),
        "rejected_quantity": float(order.rejected_quantity),
        "uom": order.uom or "PCS",
        "required_date": order.required_date.isoformat() if order.required_date else None,
        "assembly_line": order.assigned_line,
        "assigned_line": order.assigned_line,
        "assigned_operator": order.assigned_operator,
        "priority": order.priority,
        "status": order.status,
        "notes": order.notes,
        "progress": _calculate_progress(order),
        "items": order.items or [],
        "assembly_steps": order.assembly_steps or [],
        "created_by": order.created_by,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "started_at": order.started_at.isoformat() if order.started_at else None,
        "completed_at": order.completed_at.isoformat() if order.completed_at else None,
        "updated_at": order.updated_at.isoformat() if order.updated_at else None,
    }


# ==============================================================================
# 1. DASHBOARD
# ==============================================================================
def _group_material_lines(lines):
    """One receipt line per material; repeated BOM/pick lines remain additive."""
    grouped = {}
    for line in lines or []:
        row = dict(line)
        code = str(row.get("material_code", "")).strip()
        key = code.casefold()
        if key not in grouped:
            grouped[key] = {**row, "material_code": code}
            continue
        target = grouped[key]
        if str(target.get("uom", "PCS")).upper() != str(row.get("uom", "PCS")).upper():
            raise HTTPException(422, f"Conflicting units for material {code}. Correct the request before receiving.")
        for field in ("quantity", "required_quantity", "requested_quantity", "issued_quantity", "received_quantity", "quantity_per_unit"):
            if field in row:
                target[field] = float(Decimal(str(target.get(field, 0) or 0)) + Decimal(str(row[field] or 0)))
    return list(grouped.values())


def _group_request_items(items):
    return [SimpleNamespace(**row) for row in _group_material_lines([
        {"id": item.id, "material_code": item.material_code, "material_name": item.material_name,
         "quantity": item.quantity, "uom": item.uom} for item in items
    ])]


def _material_fulfillment(material_code: str, required, order_items, issue_items) -> dict:
    code = material_code.casefold()
    item = next((row for row in _group_material_lines(order_items) if isinstance(row, dict) and str(row.get("material_code", "")).casefold() == code), {})
    matches = [row for row in (issue_items or []) if isinstance(row, dict) and str(row.get("material_code", "")).casefold() == code]
    issued = item.get("issued_quantity")
    if matches and all(row.get("issued_quantity") is not None for row in matches):
        issued = sum(float(row["issued_quantity"]) for row in matches)
    received = float(item.get("received_quantity", 0) or 0)
    return {"required_quantity": float(required), "issued_quantity": float(issued) if issued is not None else None,
            "received_quantity": received, "shortage": max(0.0, float(required) - received)}


def _request_display_status(status: str, order, issued: bool = False) -> str:
    if status in ("CANCELLED", "REJECTED"):
        return status
    if order and order.material_received_at:
        return "RECEIVED"
    if status == "RECEIVED":
        return status
    return "ISSUED" if issued else status


def _qc_status_group(status: str, rework=0, held=0) -> str:
    key = (status or "PENDING_INSPECTION").upper()
    if key == "PARTIALLY_APPROVED":
        return "REWORK" if rework > 0 else "HELD" if held > 0 else "PARTIALLY_APPROVED"
    return {"QC_APPROVED": "PASSED", "REJECTED": "FAILED", "PENDING": "PENDING_INSPECTION",
            "REWORK_REQUIRED": "REWORK"}.get(key, key)


async def _rejected_order_ids(session, orders):
    """Read the linked request so historical rejections also show correctly."""
    request_ids = [o.material_request_id for o in orders if o.material_request_id]
    if not request_ids:
        return set()
    rejected = set((await session.scalars(
        select(MaterialRequestModel.id).where(
            MaterialRequestModel.id.in_(request_ids), MaterialRequestModel.status == "REJECTED"
        )
    )).all())
    return {o.id for o in orders if o.material_request_id in rejected}


def _dashboard_material_supply(item: dict, warehouse_available: float, receipt_confirmed: bool = False) -> tuple[float, float, float]:
    """Use actual fulfillment instead of the shortage snapshot taken at creation."""
    required = float(item.get("required_quantity", item.get("quantity", 0)) or 0)
    if receipt_confirmed or item.get("status") == "RECEIVED" or float(item.get("received_quantity", 0) or 0) > 0:
        # A physical receipt is authoritative, including a reported zero receipt.
        available = float(item.get("received_quantity", 0) or 0)
    else:
        available = float(item.get("issued_quantity", 0) or 0) + warehouse_available
    return required, available, max(0.0, required - available)


@router.get("/dashboard")
async def get_assembly_dashboard(
    admin_user: Optional[uuid.UUID] = Query(default=None),
    assembly_unit: Optional[str] = Query(default=None, max_length=64),
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Get live Assembly Dashboard data aggregated directly from PostgreSQL:
    - 5 Top KPI Cards (Open Orders, Material Pending, In Production, QC Pending, Completed Today)
    - Active Orders List
    - Needs Attention alerts (Material Shortages, Waiting for Material, Production Issues, QC Fails)
    - Recent Activity timeline
    """
    async with uow:
        viewed_account = None
        order_filters = []
        if admin_user is not None:
            roles = {role.strip().upper() for role in current_user.roles}
            if not roles.intersection({"ADMIN", "SUPERUSER", "SUPER_ADMIN"}):
                raise HTTPException(status_code=403, detail="Administrator access required for user reports")
            viewed_account = await uow.session.get(StoreManagerUserModel, admin_user)
            if viewed_account is None or viewed_account.role.strip().upper().replace(" ", "_") != "ASSEMBLY_MANAGER":
                raise HTTPException(status_code=404, detail="Assembly manager not found")
            identities = [viewed_account.username.lower(), viewed_account.employee_id.lower()]
            order_filters.append(or_(
                func.lower(AssemblyOrderModel.created_by).in_(identities),
                func.lower(AssemblyOrderModel.assigned_operator).in_(identities),
            ))
        elif assembly_unit:
            roles = {role.strip().upper() for role in current_user.roles}
            if not roles.intersection({"ADMIN", "SUPERUSER", "SUPER_ADMIN"}):
                raise HTTPException(status_code=403, detail="Administrator access required for assembly-unit reports")
            unit_accounts = (await uow.session.execute(
                select(StoreManagerUserModel).where(
                    func.upper(StoreManagerUserModel.role) == "ASSEMBLY_MANAGER",
                    func.upper(StoreManagerUserModel.assembly_unit_code) == assembly_unit.strip().upper(),
                )
            )).scalars().all()
            identities = [identity.lower() for account in unit_accounts for identity in (account.username, account.employee_id)]
            order_filters.append(or_(
                func.lower(AssemblyOrderModel.created_by).in_(identities),
                func.lower(AssemblyOrderModel.assigned_operator).in_(identities),
            ))
        # Fetch all orders
        res = await uow.session.execute(
            select(AssemblyOrderModel).where(*order_filters).order_by(AssemblyOrderModel.created_at.desc())
        )
        orders = list(res.scalars().all())
        rejected_order_ids = await _rejected_order_ids(uow.session, orders)

        # Load current stock once; order.items availability is a creation-time snapshot.
        material_codes = {
            str(item.get("material_code", "")).lower()
            for order in orders
            if (order.status or "").upper() in ("PLANNED", "MATERIAL_PENDING", "MATERIAL_REQUESTED")
            for item in (order.items or [])
            if isinstance(item, dict) and item.get("material_code")
        }
        stock_by_material = {}
        if material_codes:
            stock_rows = await uow.session.execute(
                select(
                    func.lower(InventoryLocationBalanceModel.material_code),
                    func.coalesce(func.sum(InventoryLocationBalanceModel.available_quantity), Decimal("0")),
                )
                .where(func.lower(InventoryLocationBalanceModel.material_code).in_(material_codes))
                .group_by(func.lower(InventoryLocationBalanceModel.material_code))
            )
            stock_by_material = {code: float(quantity) for code, quantity in stock_rows.all()}

        today = date.today()

        open_orders = 0
        material_pending = 0
        in_production = 0
        qc_pending = 0
        completed_today = 0

        active_orders = []
        needs_attention = []
        recent_activity = []

        for o in orders:
            st = "REJECTED" if o.id in rejected_order_ids else (o.status or "").upper()

            # KPI calculations
            is_terminal = st in ("COMPLETED", "PACKED", "READY_FOR_DISPATCH", "DISPATCHED", "CLOSED")
            if not is_terminal and st not in ("REJECTED", "CANCELLED"):
                open_orders += 1

            if st in ("PLANNED", "MATERIAL_PENDING", "MATERIAL_REQUESTED"):
                material_pending += 1
            elif st in ("IN_PRODUCTION", "IN-PROGRESS", "RUNNING"):
                in_production += 1
            elif st in ("QC_PENDING", "QUALITY_PENDING"):
                qc_pending += 1

            # Check if completed today
            comp_date = None
            if o.completed_at:
                comp_date = o.completed_at.date()
            elif o.updated_at and is_terminal:
                comp_date = o.updated_at.date()
            if comp_date == today and is_terminal:
                completed_today += 1

            # Active orders table (exclude DISPATCHED and CLOSED)
            if st not in ("DISPATCHED", "CLOSED"):
                active_orders.append({**_serialize_order(o), "status": st})

            # Needs Attention analysis
            # 1. Check material shortage in items
            for itm in (o.items or []):
                if isinstance(itm, dict) and not is_terminal and st not in ("CANCELLED", "REJECTED"):
                    # Ready/running legacy orders without receipt quantities must not
                    # resurrect their original warehouse-shortage snapshot.
                    if st not in ("PLANNED", "MATERIAL_PENDING", "MATERIAL_REQUESTED") and not o.material_received_at and itm.get("status") != "RECEIVED" and not float(itm.get("received_quantity", 0) or 0):
                        continue
                    req_qty, avail_qty, shortage_qty = _dashboard_material_supply(
                        itm, stock_by_material.get(str(itm.get("material_code", "")).lower(), 0.0),
                        receipt_confirmed=bool(o.material_received_at),
                    )
                    if shortage_qty > 0:
                        needs_attention.append({
                            "id": f"shortage-{o.order_number}-{itm.get('material_code')}",
                            "order_number": o.order_number,
                            "product_name": o.product_name,
                            "type": "Material Shortage",
                            "severity": "CRITICAL",
                            "item_name": itm.get("material_name") or itm.get("material_code"),
                            "required": req_qty,
                            "available": avail_qty,
                            "shortage": shortage_qty,
                            "uom": itm.get("uom", "PCS"),
                            "message": f"{itm.get('material_name') or itm.get('material_code')}: Shortage of {shortage_qty:g} {itm.get('uom', 'PCS')}",
                        })

            # 2. Waiting for material
            if st in ("MATERIAL_PENDING", "PLANNED", "MATERIAL_REQUESTED") and not any(n["order_number"] == o.order_number for n in needs_attention):
                needs_attention.append({
                    "id": f"mat-pend-{o.order_number}",
                    "order_number": o.order_number,
                    "product_name": o.product_name,
                    "type": "Waiting for Material",
                    "severity": "WARNING",
                    "message": "Order is planned and awaiting material requisition from warehouse.",
                })

            # 3. QC Failed or Rework required
            if not is_terminal and (st in ("REWORK", "REWORK_REQUIRED", "QC_FAILED") or (o.rejected_quantity and o.rejected_quantity > 0)):
                needs_attention.append({
                    "id": f"rework-{o.order_number}",
                    "order_number": o.order_number,
                    "product_name": o.product_name,
                    "type": "Rework Required" if st in ("REWORK", "REWORK_REQUIRED") else "QC Failed",
                    "severity": "CRITICAL",
                    "message": f"Rejected quantity: {float(o.rejected_quantity):g} {o.uom}. Quality inspection flagged defect.",
                })

            # Activity feed entries
            if o.created_at:
                recent_activity.append({
                    "id": f"act-created-{o.id}",
                    "order_number": o.order_number,
                    "action": "Assembly Order Created",
                    "description": f"Order {o.order_number} for {float(o.planned_quantity):g} {o.uom or 'PCS'} of {o.product_name} created.",
                    "user": o.created_by or "System",
                    "timestamp": o.created_at.isoformat(),
                })
            if o.started_at:
                recent_activity.append({
                    "id": f"act-started-{o.id}",
                    "order_number": o.order_number,
                    "action": "Production Started",
                    "description": f"Production commenced for {o.order_number}.",
                    "user": o.assigned_operator or o.created_by or "System",
                    "timestamp": o.started_at.isoformat(),
                })
            if o.completed_at:
                recent_activity.append({
                    "id": f"act-comp-{o.id}",
                    "order_number": o.order_number,
                    "action": "Production Completed",
                    "description": f"Production completed for {o.order_number} ({float(o.completed_quantity):g} units).",
                    "user": o.assigned_operator or o.created_by or "System",
                    "timestamp": o.completed_at.isoformat(),
                })

        # Sort activity by timestamp desc, limit to 15
        recent_activity.sort(key=lambda x: x["timestamp"], reverse=True)

        return {
            "viewed_user": ({
                "id": str(viewed_account.id),
                "full_name": viewed_account.full_name,
                "employee_id": viewed_account.employee_id,
            } if viewed_account else None),
            "assembly_unit": assembly_unit.strip().upper() if assembly_unit else None,
            "kpis": {
                "open_orders": open_orders,
                "material_pending": material_pending,
                "in_production": in_production,
                "qc_pending": qc_pending,
                "completed_today": completed_today,
            },
            "active_orders": active_orders[:15],
            "needs_attention": needs_attention[:10],
            "recent_activity": recent_activity[:15],
        }


# ==============================================================================
# 2. MASTER DATA (PRODUCTS & LINES)
# ==============================================================================
@router.get("/products")
async def list_assembly_products(
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Get manufacturable products from Product Master / Bill of Materials in PostgreSQL.
    """
    async with uow:
        # The request form must expose only active, component-backed products.
        # Raw-material master records are not manufacturable products.
        res = await uow.session.execute(
            select(BillOfMaterialsModel)
            .where(func.upper(func.trim(BillOfMaterialsModel.status)) == "ACTIVE")
            .order_by(BillOfMaterialsModel.product_name)
        )
        boms = res.scalars().all()

        products = []
        seen_codes = set()
        for b in boms:
            item_count = await uow.session.scalar(
                select(func.count(BillOfMaterialsItemModel.id)).where(
                    BillOfMaterialsItemModel.bom_id == b.id
                )
            )
            if not item_count:
                continue
            product_code = b.product_code or b.bom_number
            if not product_code or product_code in seen_codes:
                continue
            seen_codes.add(product_code)
            products.append({
                "id": str(b.id),
                "product_code": product_code,
                "product_name": b.product_name,
                "bom_number": b.bom_number,
                "description": b.description or "",
                "uom": "PCS",
            })
        return products


class CreateBOMComponentPayload(BaseModel):
    material_code: str
    material_name: str
    quantity_per_unit: float = 1.0
    uom: str = "PCS"


class CreateProductPayload(BaseModel):
    product_name: str
    product_code: Optional[str] = None
    description: Optional[str] = None
    components: Optional[List[CreateBOMComponentPayload]] = None


@router.post("/products", status_code=status.HTTP_201_CREATED)
async def create_assembly_product(
    payload: CreateProductPayload,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Register a new manufacturable product and its Bill of Materials (BOM) in PostgreSQL.
    """
    async with uow:
        clean_name = payload.product_name.strip()
        if not clean_name:
            raise HTTPException(status_code=400, detail="Product name is required.")

        clean_code = (payload.product_code or "").strip().upper()
        if not clean_code or clean_code == "AUTO":
            words = [w for w in re.split(r'[\s_\-]+', clean_name) if w]
            if len(words) >= 2:
                prefix = "".join(w[0].upper() for w in words[:3])
            elif words:
                prefix = words[0][:4].upper()
            else:
                prefix = "PRD"
            prefix = re.sub(r'[^A-Z0-9]', '', prefix) or "PRD"

            for s in range(1, 1000):
                candidate = f"FG-{prefix}-{s:03d}"
                exists_check = await uow.session.execute(
                    select(BillOfMaterialsModel.id).where(BillOfMaterialsModel.product_code == candidate)
                )
                if not exists_check.scalars().first():
                    clean_code = candidate
                    break
            if not clean_code or clean_code == "AUTO":
                clean_code = f"FG-{prefix}-{uuid.uuid4().hex[:4].upper()}"

        existing = await uow.session.execute(
            select(BillOfMaterialsModel).where(
                or_(
                    BillOfMaterialsModel.product_code == clean_code,
                    BillOfMaterialsModel.product_name == clean_name,
                )
            )
        )
        if existing.scalars().first():
            raise HTTPException(
                status_code=400,
                detail=f"A product with code '{clean_code}' or name '{clean_name}' already exists."
            )

        date_str = datetime.now().strftime("%Y%m%d")
        seq_res = await uow.session.execute(
            select(func.count(BillOfMaterialsModel.id)).where(
                BillOfMaterialsModel.bom_number.like(f"BOM-{date_str}-%")
            )
        )
        count_seq = (seq_res.scalar() or 0) + 1
        bom_number = f"BOM-{date_str}-{count_seq:04d}"

        user_name = current_user.username if current_user and current_user.username else "Assembly Planner"

        bom = BillOfMaterialsModel(
            id=uuid.uuid4(),
            bom_number=bom_number,
            product_code=clean_code,
            product_name=clean_name,
            description=payload.description or f"BOM for {clean_name}",
            status="ACTIVE",
            created_by=user_name,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        uow.session.add(bom)

        if not payload.components:
            raise HTTPException(status_code=400, detail="At least one BOM component is required.")
        items_to_add = payload.components

        for itm in items_to_add:
            if not itm.material_code.strip() or not itm.material_name.strip() or itm.quantity_per_unit <= 0 or not (itm.uom or "").strip():
                raise HTTPException(status_code=400, detail="Each BOM component requires a material, positive quantity, and UOM.")
            bom_item = BillOfMaterialsItemModel(
                id=uuid.uuid4(),
                bom_id=bom.id,
                material_code=itm.material_code.strip(),
                material_name=itm.material_name.strip(),
                quantity_per_unit=Decimal(str(itm.quantity_per_unit)),
                uom=itm.uom or "PCS",
                created_at=datetime.now(),
            )
            uow.session.add(bom_item)

        await uow.commit()

        return {
            "id": str(bom.id),
            "product_code": bom.product_code,
            "product_name": bom.product_name,
            "bom_number": bom.bom_number,
            "description": bom.description,
            "uom": "PCS",
            "message": f"Product '{bom.product_name}' registered successfully with BOM {bom.bom_number}."
        }



class AddProductBomMaterialPayload(BaseModel):
    material_code: str = Field(min_length=1, max_length=64)
    quantity_per_unit: Decimal = Field(gt=0, max_digits=18, decimal_places=4)


@router.post("/products/{product_code}/bom/materials", status_code=201)
async def add_product_bom_material(product_code: str, payload: AddProductBomMaterialPayload,
    uow: UnitOfWork = Depends(get_uow), current_user: CurrentUser = Depends(get_current_user)):
    if not {role.upper() for role in (current_user.roles or [])}.intersection({"ASSEMBLY", "ASSEMBLY_MANAGER", "ADMIN", "SUPERUSER"}):
        raise HTTPException(403, "Only Assembly managers can update product BOM components")
    bom = await uow.session.scalar(select(BillOfMaterialsModel).where(
        func.upper(BillOfMaterialsModel.product_code) == product_code.strip().upper(),
        func.upper(BillOfMaterialsModel.status) == "ACTIVE").with_for_update())
    if bom is None:
        raise HTTPException(404, "No active BOM found for this product")
    material = await uow.session.scalar(select(MaterialModel).where(
        func.upper(MaterialModel.material_code) == payload.material_code.strip().upper(),
        func.upper(MaterialModel.status) == "ACTIVE"))
    if material is None:
        raise HTTPException(422, "Select an active raw material from the material master")
    existing = await uow.session.scalar(select(BillOfMaterialsItemModel.id).where(
        BillOfMaterialsItemModel.bom_id == bom.id,
        func.upper(BillOfMaterialsItemModel.material_code) == material.material_code.upper()))
    if existing:
        raise HTTPException(409, "This material is already in the product BOM")
    item = BillOfMaterialsItemModel(bom_id=bom.id, material_id=material.id,
        material_code=material.material_code, material_name=material.material_name,
        quantity_per_unit=payload.quantity_per_unit, uom=material.base_uom,
        notes=f"Added by {current_user.username}")
    uow.session.add(item)
    bom.updated_at = datetime.now()
    await uow.session.flush()
    return {"material_code": item.material_code, "quantity_per_unit": float(item.quantity_per_unit), "uom": item.uom}


@router.get("/products/{product_code}/bom")
async def get_product_bom(
    product_code: str,
    quantity: float = Query(1.0, gt=0, description="Quantity to calculate BOM requirements for"),
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Get active BOM for a product and calculate required materials for a given quantity.
    Queries live warehouse availability for each component.
    """
    bom_query = select(BillOfMaterialsModel).where(
        or_(
            BillOfMaterialsModel.product_code == product_code,
            BillOfMaterialsModel.product_name == product_code,
        )
    )
    res_bom = await uow.session.execute(bom_query)
    bom = res_bom.scalars().first()

    if not bom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active Bill of Materials found for product: '{product_code}'.",
        )

    items_res = await uow.session.execute(
        select(BillOfMaterialsItemModel)
        .where(BillOfMaterialsItemModel.bom_id == bom.id)
        .order_by(BillOfMaterialsItemModel.created_at)
    )
    bom_items = items_res.scalars().all()

    qty_dec = Decimal(str(quantity))
    calculated_materials = []
    shortage_count = 0
    available_count = 0

    for bi in bom_items:
        req_qty = float(qty_dec * Decimal(str(bi.quantity_per_unit)))
        stock_res = await uow.session.execute(
            select(func.coalesce(func.sum(MaterialStockModel.available_quantity), Decimal("0")))
            .where(MaterialStockModel.material_code == bi.material_code)
        )
        avail_stock = float(stock_res.scalar() or Decimal("0"))
        shortage = max(0.0, req_qty - avail_stock)
        item_status = "AVAILABLE" if avail_stock >= req_qty else "SHORTAGE"

        if item_status == "SHORTAGE":
            shortage_count += 1
        else:
            available_count += 1

        calculated_materials.append({
            "material_code": bi.material_code,
            "material_name": bi.material_name,
            "quantity_per_unit": float(bi.quantity_per_unit),
            "required_quantity": req_qty,
            "available_quantity": avail_stock,
            "shortage": shortage,
            "uom": bi.uom or "PCS",
            "status": item_status,
        })

    return {
        "product_code": bom.product_code,
        "product_name": bom.product_name,
        "bom_number": bom.bom_number,
        "target_quantity": quantity,
        "uom": "PCS",
        "summary": {
            "total_components": len(calculated_materials),
            "available_components": available_count,
            "shortage_components": shortage_count,
            "has_shortage": shortage_count > 0,
        },
        "materials": calculated_materials,
    }


# ==============================================================================
# 5. ASSEMBLY MATERIAL REQUESTS (WAREHOUSE INTEGRATION)
# ==============================================================================
class CreateAssemblyMaterialRequestPayload(BaseModel):
    product_code: str
    target_quantity: Decimal = Field(..., gt=0, description="Quantity must be greater than 0")
    required_date: date
    remarks: Optional[str] = None
    priority: str = Field(default="NORMAL")
    assembly_line: Optional[str] = "LINE-01"
    order_id: Optional[str] = None

    @field_validator("required_date")
    @classmethod
    def validate_required_date(cls, value: date) -> date:
        if value < date.today():
            raise ValueError("Required completion date must be today or later.")
        return value


@router.post("/material-requests", status_code=status.HTTP_201_CREATED)
async def create_assembly_material_request(
    payload: CreateAssemblyMaterialRequestPayload,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Step 1: Create a real Raw Material Request for Assembly production:
    1. Loads active Product BOM and validates component items.
    2. Calculates required materials using the production target quantity.
    3. Either links to existing AssemblyOrder (if payload.order_id provided) or generates a new AssemblyOrder.
    4. Generates unique sequential MR-YYYY-XXXXXX number.
    5. Inserts real MaterialRequestModel and MaterialRequestItemModel records into PostgreSQL.
    6. Updates AssemblyOrder with material_request_id, request_number, and status 'MATERIAL_PENDING'.
    7. Atomically commits in PostgreSQL so Warehouse sees the real requisition.
    """
    async with uow:
        # 1. Lookup Product & active BOM
        bom_res = await uow.session.execute(
            select(BillOfMaterialsModel).where(
                or_(
                    BillOfMaterialsModel.product_code == payload.product_code,
                    BillOfMaterialsModel.product_name == payload.product_code,
                )
            )
        )
        bom = bom_res.scalars().first()
        if not bom:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No active Bill of Materials found for product code: '{payload.product_code}'.",
            )

        # 2. Get BOM items
        bom_items_res = await uow.session.execute(
            select(BillOfMaterialsItemModel)
            .where(BillOfMaterialsItemModel.bom_id == bom.id)
            .order_by(BillOfMaterialsItemModel.created_at)
        )
        bom_items = bom_items_res.scalars().all()
        if not bom_items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"The active BOM '{bom.bom_number}' has no components configured.",
            )

        # 3. Calculate materials
        calculated_materials = []
        for bi in bom_items:
            req_qty = payload.target_quantity * Decimal(str(bi.quantity_per_unit))
            stock_res = await uow.session.execute(
                select(func.coalesce(func.sum(MaterialStockModel.available_quantity), Decimal("0")))
                .where(MaterialStockModel.material_code == bi.material_code)
            )
            avail_stock = stock_res.scalar() or Decimal("0")
            shortage = max(Decimal("0"), req_qty - avail_stock)
            calculated_materials.append({
                "material_code": bi.material_code,
                "material_name": bi.material_name,
                "quantity_per_unit": float(bi.quantity_per_unit),
                "required_quantity": float(req_qty),
                "available_quantity": float(avail_stock),
                "requested_quantity": float(req_qty),
                "received_quantity": 0.0,
                "shortage": float(shortage),
                "uom": bi.uom or "PCS",
                "status": "REQUESTED",
            })

        # 4. Sequential MR Number Generation (MR-YYYY-XXXXXX)
        current_year = datetime.now().year
        mr_prefix = f"MR-{current_year}-"
        all_mr_res = await uow.session.execute(
            select(MaterialRequestModel.request_number).where(MaterialRequestModel.request_number.like(f"{mr_prefix}%"))
        )
        existing_mr_nums = all_mr_res.scalars().all()
        max_mr_seq = 0
        for mrn in existing_mr_nums:
            suffix = mrn.replace(mr_prefix, "")
            if suffix.isdigit():
                max_mr_seq = max(max_mr_seq, int(suffix))
        request_number = f"{mr_prefix}{max_mr_seq + 1:06d}"

        user_name = current_user.username if current_user and current_user.username else "Assembly Supervisor"

        # 5. Determine order number
        order = None
        if payload.order_id:
            try:
                ord_uuid = uuid.UUID(payload.order_id)
                ord_res = await uow.session.execute(
                    select(AssemblyOrderModel).where(
                        or_(AssemblyOrderModel.id == ord_uuid, AssemblyOrderModel.order_number == payload.order_id)
                    )
                )
                order = ord_res.scalars().first()
            except ValueError:
                ord_res = await uow.session.execute(
                    select(AssemblyOrderModel).where(AssemblyOrderModel.order_number == payload.order_id)
                )
                order = ord_res.scalars().first()

        order_number_to_use = order.order_number if order else None
        if not order_number_to_use:
            asm_prefix = f"ASM-{current_year}-"
            all_asm_res = await uow.session.execute(
                select(AssemblyOrderModel.order_number).where(AssemblyOrderModel.order_number.like(f"{asm_prefix}%"))
            )
            existing_asm_nums = all_asm_res.scalars().all()
            max_asm_seq = 0
            for asmn in existing_asm_nums:
                suffix = asmn.replace(asm_prefix, "")
                if suffix.isdigit():
                    max_asm_seq = max(max_asm_seq, int(suffix))
            order_number_to_use = f"{asm_prefix}{max_asm_seq + 1:06d}"

        # 6. Create MaterialRequestModel first and flush so FK is satisfied
        new_mr = MaterialRequestModel(
            id=uuid.uuid4(),
            request_number=request_number,
            warehouse_id="WH-01",
            department="Assembly",
            requested_by=user_name,
            status="PENDING_WAREHOUSE_APPROVAL",
            priority=payload.priority.upper(),
            required_date=payload.required_date,
            remarks=f"{payload.remarks or 'Production Raw Materials'} [Assembly Order: {order_number_to_use}]",
            approval_history=[
                {
                    "status": "PENDING_WAREHOUSE_APPROVAL",
                    "actor": user_name,
                    "comments": f"Requisition created from Assembly for order {order_number_to_use} ({float(payload.target_quantity):g} PCS of {bom.product_name})",
                    "timestamp": datetime.now().isoformat(),
                }
            ],
            attachments=[],
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        uow.session.add(new_mr)

        # 7. Create MaterialRequestItemModel records
        mr_items_response = []
        for itm in calculated_materials:
            m_item = MaterialRequestItemModel(
                id=uuid.uuid4(),
                request_id=new_mr.id,
                material_code=itm["material_code"],
                material_name=itm["material_name"],
                quantity=Decimal(str(itm["required_quantity"])),
                uom=itm["uom"],
            )
            uow.session.add(m_item)
            mr_items_response.append({
                "material_code": itm["material_code"],
                "material_name": itm["material_name"],
                "quantity": itm["required_quantity"],
                "available_quantity": itm["available_quantity"],
                "shortage": itm["shortage"],
                "uom": itm["uom"],
                "status": itm["status"],
            })

        # Explicitly flush MaterialRequest so it is present in PostgreSQL before AssemblyOrder FK check
        await uow.session.flush()

        # 8. Create or update Assembly Order
        if not order:
            # Load routing operations
            routing_res = await uow.session.execute(
                select(AssemblyRoutingRevisionModel).where(
                    AssemblyRoutingRevisionModel.product_code == bom.product_code,
                    AssemblyRoutingRevisionModel.status == "ACTIVE",
                ).limit(1)
            )
            routing = routing_res.scalars().first()
            work_steps = []
            if routing and routing.operations:
                for idx, op in enumerate(sorted(routing.operations, key=lambda x: x.sequence)):
                    work_steps.append({
                        "id": str(op.id),
                        "sequence": op.sequence or ((idx + 1) * 10),
                        "name": op.operation_name,
                        "instruction": op.work_instruction or "",
                        "expected_time_minutes": op.expected_duration_minutes or 5,
                        "qc_required": bool(op.qc_required),
                        "status": "NOT_STARTED",
                        "started_at": None,
                        "completed_at": None,
                    })

            order = AssemblyOrderModel(
                id=uuid.uuid4(),
                order_number=order_number_to_use,
                material_request_id=new_mr.id,
                request_number=new_mr.request_number,
                product_code=bom.product_code,
                product_name=bom.product_name,
                product_id=str(bom.id),
                bom_id=bom.id,
                bom_number=bom.bom_number,
                uom="PCS",
                planned_quantity=payload.target_quantity,
                completed_quantity=Decimal("0"),
                rejected_quantity=Decimal("0"),
                required_date=payload.required_date,
                assigned_line=payload.assembly_line,
                priority=payload.priority.upper(),
                status="MATERIAL_PENDING",
                putaway_status="PUTAWAY_PENDING",
                department="Assembly",
                notes=payload.remarks,
                items=calculated_materials,
                assembly_steps=work_steps,
                created_by=user_name,
                created_at=datetime.now(),
                updated_at=datetime.now(),
            )
            uow.session.add(order)
        else:
            order.status = "MATERIAL_PENDING"
            order.material_request_id = new_mr.id
            order.request_number = new_mr.request_number
            order.items = calculated_materials
            order.updated_at = datetime.now()

        await uow.commit()

        logger.info(f"Assembly Material Request created: {request_number} linked to {order.order_number}")

        return {
            "id": str(new_mr.id),
            "request_number": new_mr.request_number,
            "order_id": str(order.id),
            "order_number": order.order_number,
            "product_code": order.product_code,
            "product_name": order.product_name,
            "target_quantity": float(order.planned_quantity),
            "uom": order.uom or "PCS",
            "required_date": new_mr.required_date.isoformat(),
            "warehouse_id": new_mr.warehouse_id,
            "department": new_mr.department,
            "status": new_mr.status,
            "remarks": new_mr.remarks,
            "items_count": len(mr_items_response),
            "created_at": new_mr.created_at.isoformat(),
            "items": mr_items_response,
        }


@router.get("/material-requests")
async def list_assembly_material_requests(
    search: Optional[str] = Query(None, description="Search by request # or order #"),
    status: Optional[str] = Query(None, description="Filter by status"),
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    List all Material Requests created for Assembly.
    Reads from PostgreSQL material_request and joins with assembly_order.
    """
    async with uow:
        query = (
            select(MaterialRequestModel)
            .where(
                or_(
                    MaterialRequestModel.department.ilike("%Assembly%"),
                    MaterialRequestModel.id.in_(
                        select(AssemblyOrderModel.material_request_id).where(
                            AssemblyOrderModel.material_request_id.is_not(None)
                        )
                    ),
                )
            )
            .order_by(MaterialRequestModel.created_at.desc())
        )

        if status and status.upper() != "ALL":
            query = query.where(MaterialRequestModel.status.ilike(f"%{status.strip()}%"))

        res = await uow.session.execute(query)
        requests = res.scalars().all()

        results = []
        for req in requests:
            ord_res = await uow.session.execute(
                select(AssemblyOrderModel).where(
                    or_(
                        AssemblyOrderModel.material_request_id == req.id,
                        AssemblyOrderModel.request_number == req.request_number,
                    )
                ).limit(1)
            )
            order = ord_res.scalars().first()

            items_res = await uow.session.execute(
                select(MaterialRequestItemModel).where(MaterialRequestItemModel.request_id == req.id)
            )
            items = _group_request_items(items_res.scalars().all())

            issue_record = await uow.session.get(MaterialIssueModel, order.material_issue_id) if order and order.material_issue_id else None
            item_list = []
            for i in items:
                available = await uow.session.scalar(
                    select(func.coalesce(func.sum(InventoryLocationBalanceModel.available_quantity), Decimal("0")))
                    .where(func.lower(InventoryLocationBalanceModel.material_code) == i.material_code.lower())
                ) or Decimal("0")
                order_item = next((oi for oi in (order.items or []) if isinstance(oi, dict) and str(oi.get("material_code", "")).lower() == i.material_code.lower()), {}) if order else {}
                received_quantity = float(order_item.get("received_quantity", 0) or 0)
                required_quantity = float(i.quantity)
                remaining_shortage = max(0.0, required_quantity - received_quantity)
                fulfillment_status = "MATERIAL_READY" if received_quantity >= required_quantity else ("SHORTAGE" if received_quantity > 0 else req.status)
                item_list.append({
                    "id": str(i.id),
                    "material_code": i.material_code,
                    "material_name": i.material_name or i.material_code,
                    "quantity": float(i.quantity),
                    "uom": i.uom,
                    "available_quantity": float(available),
                    **_material_fulfillment(i.material_code, i.quantity, order.items if order else [], issue_record.items if issue_record else []),
                    "required_quantity": required_quantity,
                    "received_quantity": received_quantity,
                    "shortage": remaining_shortage,
                    "status": fulfillment_status,
                })

            completed_pick = await uow.session.scalar(
                select(PickTaskModel.id)
                .where(
                    PickTaskModel.request_id == req.id,
                    PickTaskModel.department == "Assembly",
                    PickTaskModel.completed_at.is_not(None),
                )
                .limit(1)
            )
            effective_status = _request_display_status(req.status, order, bool(completed_pick or issue_record))
            effective_order_status = order.status if order else None

            results.append({
                "id": str(req.id),
                "request_number": req.request_number,
                "order_id": str(order.id) if order else None,
                "order_number": order.order_number if order else (req.remarks or "—"),
                "order_status": effective_order_status,
                "issue_transaction_exists": bool(order and order.material_issue_id) or bool(completed_pick),
                "material_issue_id": str(order.material_issue_id) if order and order.material_issue_id else None,
                "issue_transaction": {
                    "issue_number": issue_record.issue_number,
                    "issued_at": issue_record.issued_at.isoformat() if issue_record.issued_at else None,
                    "issued_by": issue_record.issued_by,
                    "items": issue_record.items or [],
                } if issue_record else None,
                "product_code": order.product_code if order else "",
                "product_name": order.product_name if order else "Manufactured Goods",
                "target_quantity": float(order.planned_quantity) if order else sum(float(i.quantity) for i in items),
                "uom": order.uom if order else "PCS",
                "items_count": len(items),
                "warehouse_id": req.warehouse_id,
                # ISSUED is valid only when the persisted issue transaction is linked.
                # Legacy requests without that transaction remain pending.
                "status": effective_status,
                "priority": req.priority or "NORMAL",
                "required_date": req.required_date.isoformat() if req.required_date else None,
                "remarks": req.remarks,
                "created_at": req.created_at.isoformat() if req.created_at else None,
                "material_received_by": getattr(order, "material_received_by", None),
                "material_received_at": order.material_received_at.isoformat() if getattr(order, "material_received_at", None) else None,
                "items": item_list,
            })

        if search:
            sterm = search.strip().lower()
            results = [
                r for r in results
                if sterm in r["request_number"].lower()
                or (r["order_number"] and sterm in r["order_number"].lower())
                or (r["product_name"] and sterm in r["product_name"].lower())
            ]

        return results


@router.get("/material-requests/picking-tasks")
async def list_assembly_picking_tasks(
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    async with uow:
        tasks = (await uow.session.execute(
            select(PickTaskModel)
            .where(PickTaskModel.department == "Assembly")
            .order_by(PickTaskModel.created_at.desc())
        )).scalars().all()
        output = []
        for task in tasks:
            task_items = task.items or []
            first_item = task_items[0] if task_items else {}
            enriched_items = []
            for item in task_items:
                location = await uow.session.scalar(
                    select(StorageLocationModel.location_code)
                    .join(InventoryLocationBalanceModel, InventoryLocationBalanceModel.storage_location_id == StorageLocationModel.id)
                    .where(InventoryLocationBalanceModel.warehouse_id == task.warehouse_id)
                    .where(func.lower(InventoryLocationBalanceModel.material_code) == str(item.get("material_code", "")).lower())
                    .order_by(InventoryLocationBalanceModel.available_quantity.desc())
                    .limit(1)
                )
                if not location:
                    location = await uow.session.scalar(
                        select(StorageLocationModel.location_code)
                        .join(InventoryLocationBalanceModel, InventoryLocationBalanceModel.storage_location_id == StorageLocationModel.id)
                        .where(func.lower(InventoryLocationBalanceModel.material_code) == str(item.get("material_code", "")).lower())
                        .order_by(InventoryLocationBalanceModel.available_quantity.desc())
                        .limit(1)
                    )
                # Match the FIFO batch enforced at confirmation, rather than
                # offering a generic material QR that cannot pass validation.
                batch_number = None
                if not task.completed_at and location:
                    warehouse = await uow.session.scalar(
                        select(InventoryLocationBalanceModel.warehouse_id)
                        .join(StorageLocationModel, StorageLocationModel.id == InventoryLocationBalanceModel.storage_location_id)
                        .where(StorageLocationModel.location_code == location)
                        .where(func.lower(InventoryLocationBalanceModel.material_code) == str(item.get("material_code", "")).lower())
                        .limit(1)
                    )
                    movements = (await uow.session.scalars(
                        select(InventoryMovementHistoryModel)
                        .where(InventoryMovementHistoryModel.warehouse_id == warehouse)
                        .where(func.lower(InventoryMovementHistoryModel.material_code) == str(item.get("material_code", "")).lower())
                        .where(InventoryMovementHistoryModel.batch_lot.is_not(None))
                        .order_by(InventoryMovementHistoryModel.performed_at, InventoryMovementHistoryModel.id)
                    )).all()
                    balances = {}
                    first_seen = {}
                    for movement in movements:
                        lot = (movement.batch_lot or "").strip()
                        kind = movement.movement_type.upper()
                        if lot and kind in ("PUTAWAY", "RETURN"):
                            balances[lot] = balances.get(lot, Decimal("0")) + movement.quantity
                            first_seen.setdefault(lot, movement.performed_at.replace(tzinfo=None))
                        elif lot and kind in ("TAKEAWAY", "DISPATCH"):
                            balances[lot] = max(Decimal("0"), balances.get(lot, Decimal("0")) - movement.quantity)
                    candidates = [lot for lot in balances if balances[lot] > 0]
                    if candidates:
                        batch_number = min(candidates, key=lambda lot: (first_seen[lot], lot.casefold()))
                enriched_items.append({**item, "pick_location": location or item.get("pick_location"),
                                       **({"batch_number": batch_number, "material_qr": f"QR-BATCH-{batch_number}"} if batch_number else {})})
            issue_record = await uow.session.scalar(
                select(MaterialIssueModel).where(MaterialIssueModel.request_id == task.request_id).order_by(MaterialIssueModel.issued_at.desc()).limit(1)
            ) if task.request_id else None
            output.append({
                "id": str(task.id), "task_number": task.task_number, "request_number": task.request_number,
                "status": task.status if task.completed_at else ("PENDING" if task.status == "COMPLETED" else task.status),
                "destination": task.destination, "items": enriched_items,
                "warehouse_id": task.warehouse_id, "assigned_to": task.assigned_to,
                "confirmation": {"confirmed": bool(task.completed_at or issue_record),
                                 "confirmed_by": (issue_record.issued_by if issue_record else task.completed_by),
                                 "confirmed_at": ((issue_record.issued_at if issue_record else task.completed_at).isoformat()
                                                  if (issue_record or task.completed_at) else None),
                                 "material_qr": ((issue_record.items or [{}])[0].get("material_scan") if issue_record else None) or first_item.get("material_scan"),
                                 "rack_qr": ((issue_record.items or [{}])[0].get("zone_scan") if issue_record else None) or first_item.get("zone_scan"),
                                 "batch_number": ((issue_record.items or [{}])[0].get("batch_number") if issue_record else None) or first_item.get("batch_number") or first_item.get("batch_lot_number")},
            })
        return output


class AssemblyPickConfirmationPayload(BaseModel):
    material_scan: str = Field(..., min_length=1)
    zone_scan: str = Field(..., min_length=1)
    quantity: Decimal = Field(..., gt=0)


@router.post("/material-requests/picking-tasks/{task_id}/complete")
async def complete_assembly_picking_task(
    task_id: str,
    payload: AssemblyPickConfirmationPayload,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """Record physical confirmation for an Assembly PickTaskModel."""
    async with uow:
        try:
            task_uuid = uuid.UUID(task_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Assembly picking task ID.")
        task = await uow.session.get(PickTaskModel, task_uuid, with_for_update=True)
        if not task or task.department != "Assembly":
            raise HTTPException(status_code=404, detail="Assembly picking task not found.")
        if task.completed_at or task.status == "COMPLETED":
            raise HTTPException(status_code=409, detail="Assembly picking task is already completed.")
        items = list(task.items or [])
        requested = sum(Decimal(str(item.get("requested_quantity") or item.get("quantity") or 0)) for item in items)
        if not items or payload.quantity > requested:
            raise HTTPException(status_code=422, detail=f"Picked quantity cannot exceed requested quantity ({requested}).")
        material_scan = payload.material_scan.strip()
        # Completed-GRN QR labels contain a human-readable multi-line payload
        # ("Material Code: ..."), while older labels use QR-/JSON formats.
        # Normalize that payload before matching the task item.
        material_scan_upper = material_scan.upper()
        material_payload_fields: dict[str, str] = {}
        for line in material_scan.splitlines():
            key, separator, value = line.partition(":")
            if separator:
                material_payload_fields[key.strip().lower().replace(" ", "_")] = value.strip()
        scanned_material_code = (
            material_payload_fields.get("material_code")
            or material_payload_fields.get("item_code")
            or ""
        ).strip()
        if scanned_material_code:
            material_scan_upper = scanned_material_code.upper()
        scanned_batch_number = (
            material_payload_fields.get("batch_number")
            or material_payload_fields.get("batch_lot")
            or material_payload_fields.get("batch")
            or ""
        ).strip()
        if not scanned_batch_number:
            batch_match = re.search(r"(?:QR-)?BATCH[-:]([A-Z0-9._/-]+)", material_scan, re.IGNORECASE)
            if batch_match:
                scanned_batch_number = batch_match.group(1).strip()
        matched_items = [
            item for item in items
            if str(item.get("material_code") or "").upper() in material_scan_upper
        ]
        if not matched_items and scanned_batch_number and len(items) == 1:
            matched_items = items
        if not matched_items:
            raise HTTPException(status_code=422, detail="Material QR does not match this Assembly picking task.")
        matched_item = matched_items[0]
        material_code = str(matched_item.get("material_code") or "").strip()
        now = datetime.utcnow()

        # Completing the physical warehouse pick is the inventory issue event.
        # Lock and decrement both the rack balance and aggregate material stock
        # in the same transaction so the Inventory screen reflects the pickup.
        # The scanned bin is authoritative. Older tasks may carry a generic
        # warehouse id (for example WH-01) while the persisted rack balance
        # belongs to the store warehouse shown in the Inventory screen.
        zone_scan = payload.zone_scan.strip()
        location_filters = [
            func.lower(InventoryLocationBalanceModel.material_code) == material_code.lower(),
            InventoryLocationBalanceModel.available_quantity >= payload.quantity,
        ]
        if zone_scan:
            # BIN QR values are normally the persisted location code. Accept
            # common prefixed forms as well, but never treat a material QR as
            # a location scan.
            if "MATERIAL CODE:" in zone_scan.upper() or "MATERIAL NAME:" in zone_scan.upper():
                raise HTTPException(status_code=422, detail="Scan the BIN/location QR in the second field, not the material QR.")
            location_filters.append(
                or_(
                    func.upper(StorageLocationModel.location_code) == zone_scan.upper(),
                    func.upper(StorageLocationModel.location_code) == f"LOC-{zone_scan.upper()}",
                    StorageLocationModel.bin_id.in_(
                        select(StoreBinModel.id).where(
                            func.upper(StoreBinModel.qr_identifier) == zone_scan.upper()
                        )
                    ),
                )
            )
        else:
            location_filters.append(InventoryLocationBalanceModel.warehouse_id == (task.warehouse_id or "WH-01"))
        location_res = await uow.session.execute(
            select(InventoryLocationBalanceModel, StorageLocationModel)
            .join(StorageLocationModel, StorageLocationModel.id == InventoryLocationBalanceModel.storage_location_id)
            .where(*location_filters)
            .order_by(InventoryLocationBalanceModel.available_quantity.desc())
            .with_for_update()
        )
        location_pair = location_res.first()
        if not location_pair:
            raise HTTPException(status_code=409, detail=f"Insufficient inventory for {material_code}.")
        location_balance, picked_location = location_pair

        # Enforce FIFO against the actual batch movement ledger. Replaying
        # movements keeps the rule compatible with existing putaway records.
        movement_res = await uow.session.execute(
            select(InventoryMovementHistoryModel)
            .where(
                func.lower(InventoryMovementHistoryModel.material_code) == material_code.lower(),
                InventoryMovementHistoryModel.warehouse_id == location_balance.warehouse_id,
                InventoryMovementHistoryModel.batch_lot.is_not(None),
            )
            .order_by(InventoryMovementHistoryModel.performed_at, InventoryMovementHistoryModel.id)
        )
        batch_balances: dict[str, Decimal] = {}
        batch_first_seen: dict[str, datetime] = {}
        for movement in movement_res.scalars().all():
            lot = (movement.batch_lot or "").strip()
            if not lot:
                continue
            movement_kind = movement.movement_type.upper()
            if movement_kind in ("PUTAWAY", "RETURN"):
                batch_balances[lot] = batch_balances.get(lot, Decimal("0")) + movement.quantity
                batch_first_seen.setdefault(lot, movement.performed_at.replace(tzinfo=None))
            elif movement_kind in ("TAKEAWAY", "DISPATCH"):
                batch_balances[lot] = max(Decimal("0"), batch_balances.get(lot, Decimal("0")) - movement.quantity)
        eligible_batches = [
            (lot, quantity, batch_first_seen.get(lot, now))
            for lot, quantity in batch_balances.items()
            if quantity > 0
        ]
        eligible_batches.sort(key=lambda row: (row[2], row[0].casefold()))
        # Location balances remain authoritative if old picks predate batch
        # movement history; cap reconstructed lots to physically available stock.
        available_total_res = await uow.session.execute(
            select(func.coalesce(func.sum(InventoryLocationBalanceModel.available_quantity), Decimal("0")))
            .where(
                func.lower(InventoryLocationBalanceModel.material_code) == material_code.lower(),
                InventoryLocationBalanceModel.warehouse_id == location_balance.warehouse_id,
            )
        )
        remaining_total = Decimal(str(available_total_res.scalar() or 0))
        capped_batches = []
        for lot, quantity, first_seen in eligible_batches:
            capped_quantity = min(quantity, remaining_total)
            if capped_quantity > 0:
                capped_batches.append((lot, capped_quantity, first_seen))
                remaining_total -= capped_quantity
        if capped_batches:
            oldest_batch, oldest_quantity, _ = capped_batches[0]
            if not scanned_batch_number:
                raise HTTPException(
                    status_code=409,
                    detail=f"FIFO: Scan the batch label. Pick the oldest available batch {oldest_batch} first.",
                )
            selected_batch = next(
                (row for row in capped_batches if row[0].casefold() == scanned_batch_number.casefold()),
                None,
            )
            if selected_batch is None:
                raise HTTPException(status_code=409, detail=f"FIFO: Batch {scanned_batch_number} has no eligible stock available.")
            if selected_batch[0] != oldest_batch:
                raise HTTPException(
                    status_code=409,
                    detail=f"FIFO: Older batch {oldest_batch} ({oldest_quantity} available) is still in stock. Clear it before picking batch {selected_batch[0]}.",
                )
            if payload.quantity > oldest_quantity:
                raise HTTPException(
                    status_code=409,
                    detail=f"FIFO: Only {oldest_quantity} remains in oldest batch {oldest_batch}. Pick it before moving to a newer batch.",
                )
        stock_res = await uow.session.execute(
            select(MaterialStockModel)
            .where(func.lower(MaterialStockModel.material_code) == material_code.lower())
            .with_for_update()
        )
        stock = stock_res.scalars().first()
        # Location balances are authoritative after putaway. Older putaway
        # records may have the correct quantity in the BIN but a stale zero in
        # the aggregate material stock row, so reconcile it before picking.
        location_available = location_balance.available_quantity
        if stock and stock.available_quantity < location_available:
            stock.available_quantity = location_available
        if stock and stock.on_hand_quantity < location_available:
            stock.on_hand_quantity = location_available
        if not stock or stock.available_quantity < payload.quantity or stock.on_hand_quantity < payload.quantity:
            available = stock.available_quantity if stock else location_available
            raise HTTPException(status_code=409, detail=f"Insufficient aggregate inventory for {material_code}: {available} available.")
        location_balance.available_quantity -= payload.quantity
        location_balance.quantity = max(Decimal("0"), location_balance.quantity - payload.quantity)
        location_balance.updated_at = now
        stock.available_quantity -= payload.quantity
        stock.on_hand_quantity -= payload.quantity
        stock.updated_at = now

        updated_items = []
        for item in items:
            item_copy = dict(item)
            if str(item_copy.get("material_code") or "").upper() in material_scan_upper:
                item_copy.update(picked_quantity=float(payload.quantity), material_scan=material_scan, zone_scan=payload.zone_scan.strip(), batch_number=scanned_batch_number or (capped_batches[0][0] if capped_batches else None))
            updated_items.append(item_copy)
        picked_batch = scanned_batch_number or (capped_batches[0][0] if capped_batches else None)
        if picked_batch:
            uow.session.add(InventoryMovementHistoryModel(
                movement_type="TAKEAWAY",
                material_code=material_code,
                material_name=location_balance.material_name,
                material_qr=material_scan[:128],
                grn_number=location_balance.last_grn_number,
                batch_lot=picked_batch,
                from_location=picked_location.location_code,
                to_location="ASSEMBLY",
                from_bin_id=picked_location.bin_id,
                to_bin_id=None,
                quantity=payload.quantity,
                uom=location_balance.uom,
                stock_before=location_balance.available_quantity + payload.quantity,
                stock_after=location_balance.available_quantity,
                performed_by=current_user.username if current_user and current_user.username else "Warehouse Operator",
                warehouse_id=location_balance.warehouse_id,
                store_id=picked_location.store_id,
                reference_document=task.task_number,
                remarks="FIFO-checked Assembly pick",
                performed_at=now,
            ))
        # PickTaskModel.completed_at is stored as TIMESTAMP WITHOUT TIME ZONE.
        # Use a naive UTC application timestamp to match the existing schema.
        task.items = updated_items
        task.status = "COMPLETED"
        task.completed_at = now
        task.completed_by = current_user.username if current_user and current_user.username else "Warehouse Operator"
        # A completed physical pick is the warehouse issue event for an
        # Assembly request. Keep the request/order dashboards in sync.
        if task.request_id:
            req = await uow.session.get(MaterialRequestModel, task.request_id, with_for_update=True)
            if req and req.status not in ("ISSUED", "RECEIVED"):
                req.status = "ISSUED"
                history = list(req.approval_history or [])
                history.append({
                    "status": "ISSUED",
                    "actor": task.completed_by,
                    "comments": f"Warehouse picking confirmed under {task.task_number}.",
                    "timestamp": now.isoformat(),
                })
                req.approval_history = history
            order = (await uow.session.execute(
                select(AssemblyOrderModel).where(
                    or_(AssemblyOrderModel.material_request_id == task.request_id,
                        AssemblyOrderModel.request_number == task.request_number)
                ).limit(1)
            )).scalars().first()
            if order:
                if not order.material_issue_id:
                    issue_items = [
                        {
                            **item,
                            "issued_quantity": item.get("picked_quantity", item.get("requested_quantity", 0)),
                            "status": "ISSUED",
                        }
                        for item in updated_items
                    ]
                    material_issue = MaterialIssueModel(
                        id=uuid.uuid4(),
                        issue_number=f"ISS-{now.year}-{uuid.uuid4().hex[:6].upper()}",
                        pick_task_id=task.id,
                        request_id=task.request_id,
                        department="Assembly",
                        items=issue_items,
                        issued_by=task.completed_by,
                        received_by="PENDING RECEIPT",
                        issued_at=now,
                    )
                    uow.session.add(material_issue)
                    await uow.session.flush()
                    order.material_issue_id = material_issue.id
                order.pick_task_id = task.id
                order.status = "MATERIAL_ISSUED"
        await uow.commit()
        return {"id": str(task.id), "task_number": task.task_number, "status": task.status, "completed_at": now.isoformat()}


@router.get("/material-requests/{request_id}")
async def get_assembly_material_request_detail(
    request_id: str,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Get detailed information for a specific Assembly Material Request.
    """
    async with uow:
        try:
            req_uuid = uuid.UUID(request_id)
            q = select(MaterialRequestModel).where(
                or_(MaterialRequestModel.id == req_uuid, MaterialRequestModel.request_number == request_id)
            )
        except ValueError:
            q = select(MaterialRequestModel).where(MaterialRequestModel.request_number == request_id)

        res = await uow.session.execute(q)
        req = res.scalars().first()
        if not req:
            raise HTTPException(status_code=404, detail=f"Material request '{request_id}' not found.")

        ord_res = await uow.session.execute(
            select(AssemblyOrderModel).where(
                or_(AssemblyOrderModel.material_request_id == req.id, AssemblyOrderModel.request_number == req.request_number)
            ).limit(1)
        )
        order = ord_res.scalars().first()

        items_res = await uow.session.execute(
            select(MaterialRequestItemModel).where(MaterialRequestItemModel.request_id == req.id)
        )
        items = _group_request_items(items_res.scalars().all())

        material_issue_data = None
        if order and order.material_issue_id:
            iss_res = await uow.session.execute(
                select(MaterialIssueModel).where(MaterialIssueModel.id == order.material_issue_id)
            )
            issue_rec = iss_res.scalars().first()
            if issue_rec:
                material_issue_data = {
                    "id": str(issue_rec.id),
                    "issue_number": issue_rec.issue_number,
                    "issued_by": issue_rec.issued_by,
                    "received_by": issue_rec.received_by,
                    "issued_at": issue_rec.issued_at.isoformat(),
                    "items": issue_rec.items,
                }

        completed_pick = await uow.session.scalar(select(PickTaskModel.id).where(
            PickTaskModel.request_id == req.id, PickTaskModel.department == "Assembly",
            PickTaskModel.completed_at.is_not(None),
        ).limit(1))
        return {
            "id": str(req.id),
            "request_number": req.request_number,
            "order_id": str(order.id) if order else None,
            "order_number": order.order_number if order else None,
            "order_status": order.status if order else req.status,
            "product_code": order.product_code if order else "",
            "product_name": order.product_name if order else "",
            "target_quantity": float(order.planned_quantity) if order else 0,
            "uom": order.uom if order else "PCS",
            "items_count": len(items),
            "warehouse_id": req.warehouse_id,
            "status": _request_display_status(req.status, order, bool(completed_pick or material_issue_data)),
            "priority": req.priority or "NORMAL",
            "required_date": req.required_date.isoformat() if req.required_date else None,
            "remarks": req.remarks,
            "material_received_by": getattr(order, "material_received_by", None),
            "material_received_at": order.material_received_at.isoformat() if getattr(order, "material_received_at", None) else None,
            "material_issue": material_issue_data,
            "created_at": req.created_at.isoformat() if req.created_at else None,
            "items": [
                {
                    **_material_fulfillment(i.material_code, i.quantity, order.items if order else [], (material_issue_data or {}).get("items", [])),
                    "id": str(i.id),
                    "material_code": i.material_code,
                    "material_name": i.material_name or i.material_code,
                    "quantity": float(i.quantity),
                    "uom": i.uom,
                }
                for i in items
            ],
            "approval_history": req.approval_history or [],
        }


# ==============================================================================
# STEP 2: WAREHOUSE ISSUE & ASSEMBLY MATERIAL RECEIPT
# ==============================================================================
class WarehouseIssueRequestPayload(BaseModel):
    warehouse_id: Optional[str] = "WH-01"
    remarks: Optional[str] = None


class ApproveAssemblyMaterialRequestPayload(BaseModel):
    approved_items: Optional[List[dict]] = None
    remarks: Optional[str] = None


class RejectAssemblyMaterialRequestPayload(BaseModel):
    reason: str = Field(..., min_length=1, max_length=1000)


@router.post("/material-requests/{request_id}/approve")
async def approve_assembly_material_request(
    request_id: str,
    payload: ApproveAssemblyMaterialRequestPayload | None = None,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """Approve and reserve an Assembly request; physical issue remains a later step."""
    async with uow:
        try:
            request_uuid = uuid.UUID(request_id)
            query = select(MaterialRequestModel).where(MaterialRequestModel.id == request_uuid)
        except ValueError:
            query = select(MaterialRequestModel).where(MaterialRequestModel.request_number == request_id)
        req = (await uow.session.execute(query)).scalars().first()
        if not req:
            raise HTTPException(status_code=404, detail=f"Material request '{request_id}' not found.")
        # Resolve the linked assembly order before creating the picking task.
        # The approval path uses its pick_task_id to remain idempotent; leaving
        # this lookup out caused a NameError and returned a 500 response.
        order_res = await uow.session.execute(
            select(AssemblyOrderModel)
            .where(
                or_(
                    AssemblyOrderModel.material_request_id == req.id,
                    AssemblyOrderModel.request_number == req.request_number,
                )
            )
            .limit(1)
        )
        order = order_res.scalars().first()
        if not order:
            raise HTTPException(
                status_code=404,
                detail=f"No linked Assembly Order found for request '{req.request_number}'.",
            )
        if req.status in ("ISSUED", "RECEIVED"):
            raise HTTPException(status_code=409, detail="Issued material requests cannot be approved again.")
        items = (await uow.session.execute(select(MaterialRequestItemModel).where(MaterialRequestItemModel.request_id == req.id))).scalars().all()
        approved_by_code = {
            str(item.get("material_code")): Decimal(str(item.get("approved_quantity", 0)))
            for item in (payload.approved_items if payload and payload.approved_items else [])
            if item.get("material_code")
        }
        shortages = []
        approved_total = 0
        for item in items:
            available = await uow.session.scalar(
                select(func.coalesce(func.sum(InventoryLocationBalanceModel.available_quantity), Decimal("0")))
                .where(func.lower(InventoryLocationBalanceModel.material_code) == item.material_code.lower())
            ) or Decimal("0")
            approved_qty = approved_by_code.get(item.material_code, item.quantity)
            if approved_qty < 0 or approved_qty > item.quantity:
                raise HTTPException(status_code=422, detail=f"Approved quantity for {item.material_code} must be between 0 and {item.quantity}")
            if approved_qty > available:
                approved_qty = available
            item.approved_quantity = approved_qty
            approved_total += 1 if approved_qty > 0 else 0
            if approved_qty < item.quantity:
                shortages.append(f"{item.material_code}: {available} available, {item.quantity} required")
        if not approved_total:
            raise HTTPException(status_code=409, detail="No stock was approved for this request")
        if shortages:
            raise HTTPException(status_code=409, detail="Insufficient available stock: " + "; ".join(shortages))
        now = datetime.now()
        actor = current_user.username if current_user and current_user.username else "Warehouse Manager"
        req.status = "PARTIALLY_APPROVED" if shortages else "APPROVED"
        req.approved_by = actor
        req.approved_at = now
        history = list(req.approval_history or [])
        history.append({"status": req.status, "actor": actor, "comments": payload.remarks if payload and payload.remarks else "Stock availability verified; request released for picking.", "timestamp": now.isoformat()})
        req.approval_history = history
        if order and not order.pick_task_id:
            task_prefix = f"PT-{datetime.now().year}-"
            existing_tasks = (await uow.session.execute(select(PickTaskModel.task_number).where(PickTaskModel.task_number.like(f"{task_prefix}%")))).scalars().all()
            seq = max([int(value.replace(task_prefix, "")) for value in existing_tasks if value.replace(task_prefix, "").isdigit()] or [0]) + 1
            location = await uow.session.scalar(
                select(StorageLocationModel.location_code)
                .join(InventoryLocationBalanceModel, InventoryLocationBalanceModel.storage_location_id == StorageLocationModel.id)
                .where(InventoryLocationBalanceModel.warehouse_id == req.warehouse_id)
                .where(func.lower(InventoryLocationBalanceModel.material_code) == items[0].material_code.lower())
                .where(InventoryLocationBalanceModel.available_quantity > 0)
                .order_by(InventoryLocationBalanceModel.available_quantity.desc())
                .limit(1)
            ) if items else None
            pick_task = PickTaskModel(
                id=uuid.uuid4(), task_number=f"{task_prefix}{seq:06d}", request_id=req.id,
                request_number=req.request_number, warehouse_id=req.warehouse_id, department="Assembly",
                items=[{"material_code": item.material_code, "material_name": item.material_name or item.material_code,
                        "requested_quantity": float(item.approved_quantity), "picked_quantity": 0, "uom": item.uom}
                       for item in items if item.approved_quantity > 0],
                status="PENDING", destination=location or "Warehouse inventory location",
                created_by=actor, created_at=now,
            )
            uow.session.add(pick_task)
            await uow.session.flush()
            order.pick_task_id = pick_task.id
            order.status = "MATERIAL_PICKING"
        uow.session.add(NotificationModel(user_role="ASSEMBLY_OPERATOR", title=f"Material request {req.status}: {req.request_number}", message=f"Warehouse approved material quantities for {req.request_number}; picking task is ready.", link=f"/assembly/material-requests?request={req.id}"))
        await uow.commit()
        return {"id": str(req.id), "request_number": req.request_number, "status": req.status}


@router.post("/material-requests/{request_id}/reject")
async def reject_assembly_material_request(
    request_id: str,
    payload: RejectAssemblyMaterialRequestPayload,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    async with uow:
        try:
            query = select(MaterialRequestModel).where(MaterialRequestModel.id == uuid.UUID(request_id))
        except ValueError:
            query = select(MaterialRequestModel).where(MaterialRequestModel.request_number == request_id)
        req = (await uow.session.execute(query.with_for_update())).scalars().first()
        if not req:
            raise HTTPException(status_code=404, detail="Material request not found")
        if req.status in {"ISSUED", "RECEIVED", "REJECTED"}:
            raise HTTPException(status_code=409, detail="Material request cannot be rejected in its current status")
        actor = current_user.username if current_user and current_user.username else "Warehouse Manager"
        req.status = "REJECTED"
        history = list(req.approval_history or [])
        history.append({"status": "REJECTED", "actor": actor, "comments": payload.reason, "timestamp": datetime.now().isoformat()})
        req.approval_history = history
        uow.session.add(NotificationModel(user_role="ASSEMBLY_MANAGER", title=f"Material request rejected: {req.request_number}", message=payload.reason, link=f"/assembly/material-requests?request={req.id}"))
        await uow.commit()
        return {"id": str(req.id), "request_number": req.request_number, "status": req.status}


@router.post("/material-requests/{request_id}/warehouse-issue")
async def warehouse_issue_materials(
    request_id: str,
    payload: Optional[WarehouseIssueRequestPayload] = None,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Step 2.1: Warehouse approves, picks, and issues materials for an Assembly Request.
    1. Validates the request is in PENDING/Submitted status.
    2. Generates real PickTaskModel (status='COMPLETED') and MaterialIssueModel (issue_number='ISS-YYYY-XXXXXX').
    3. Allocates/deducts real MaterialStockModel on hand in PostgreSQL.
    4. Updates AssemblyOrder with material_issue_id, pick_task_id, items, and status 'MATERIAL_ISSUED'.
    5. Updates MaterialRequest status to 'ISSUED'.
    """
    async with uow:
        try:
            req_uuid = uuid.UUID(request_id)
            q = select(MaterialRequestModel).where(
                or_(MaterialRequestModel.id == req_uuid, MaterialRequestModel.request_number == request_id)
            )
        except ValueError:
            q = select(MaterialRequestModel).where(MaterialRequestModel.request_number == request_id)

        res = await uow.session.execute(q)
        req = res.scalars().first()
        if not req:
            raise HTTPException(status_code=404, detail=f"Material request '{request_id}' not found.")

        # Check existing order
        ord_res = await uow.session.execute(
            select(AssemblyOrderModel).where(
                or_(AssemblyOrderModel.material_request_id == req.id, AssemblyOrderModel.request_number == req.request_number)
            ).limit(1)
        )
        order = ord_res.scalars().first()
        if not order:
            raise HTTPException(status_code=404, detail=f"No linked Assembly Order found for request '{req.request_number}'.")

        # Prevent duplicate issue
        if req.status in ("ISSUED", "RECEIVED") or order.status in ("MATERIAL_ISSUED", "MATERIAL_READY", "IN_PROGRESS", "COMPLETED"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Materials for request '{req.request_number}' (Order '{order.order_number}') are already {req.status}.",
            )

        user_name = current_user.username if current_user and current_user.username else "Warehouse Dispatcher"
        current_year = datetime.now().year

        # 1. Generate sequential PickTaskModel (PT-YYYY-XXXXXX)
        pt_prefix = f"PT-{current_year}-"
        all_pt_res = await uow.session.execute(
            select(PickTaskModel.task_number).where(PickTaskModel.task_number.like(f"{pt_prefix}%"))
        )
        existing_pt_nums = all_pt_res.scalars().all()
        max_pt_seq = 0
        for ptn in existing_pt_nums:
            suffix = ptn.replace(pt_prefix, "")
            if suffix.isdigit():
                max_pt_seq = max(max_pt_seq, int(suffix))
        pt_number = f"{pt_prefix}{max_pt_seq + 1:06d}"

        # 2. Generate sequential MaterialIssueModel (ISS-YYYY-XXXXXX)
        iss_prefix = f"ISS-{current_year}-"
        all_iss_res = await uow.session.execute(
            select(MaterialIssueModel.issue_number).where(MaterialIssueModel.issue_number.like(f"{iss_prefix}%"))
        )
        existing_iss_nums = all_iss_res.scalars().all()
        max_iss_seq = 0
        for isn in existing_iss_nums:
            suffix = isn.replace(iss_prefix, "")
            if suffix.isdigit():
                max_iss_seq = max(max_iss_seq, int(suffix))
        issue_number = f"{iss_prefix}{max_iss_seq + 1:06d}"

        # 3. Retrieve request items
        items_res = await uow.session.execute(
            select(MaterialRequestItemModel).where(MaterialRequestItemModel.request_id == req.id)
        )
        req_items = items_res.scalars().all()

        issued_items = []
        now = datetime.now()
        for itm in req_items:
            qty_dec = Decimal(str(itm.quantity))
            # Deduct the same location balance used by Warehouse Inventory.
            # This keeps rack-level availability and aggregate material stock
            # in one transaction and prevents issuing stock that is not at a
            # real source location.
            loc_res = await uow.session.execute(
                select(InventoryLocationBalanceModel, StorageLocationModel)
                .join(StorageLocationModel, StorageLocationModel.id == InventoryLocationBalanceModel.storage_location_id)
                .where(
                    func.lower(InventoryLocationBalanceModel.material_code) == itm.material_code.lower(),
                    InventoryLocationBalanceModel.warehouse_id == (req.warehouse_id or "WH-01"),
                    InventoryLocationBalanceModel.available_quantity >= qty_dec,
                )
                .order_by(InventoryLocationBalanceModel.available_quantity.desc())
                .with_for_update()
            )
            location_row = loc_res.first()
            if not location_row:
                raise HTTPException(status_code=409, detail=f"Insufficient rack stock for {itm.material_code} in warehouse {req.warehouse_id or 'WH-01'}")
            location_balance, source_location = location_row
            location_balance.available_quantity -= qty_dec
            location_balance.quantity = max(Decimal("0"), location_balance.quantity - qty_dec)
            location_balance.updated_at = now
            issued_items.append({
                "material_code": itm.material_code,
                "material_name": itm.material_name or itm.material_code,
                "required_quantity": float(qty_dec),
                "issued_quantity": float(qty_dec),
                "received_quantity": 0.0,
                "uom": itm.uom or "PCS",
                "source_rack": source_location.location_code,
                "status": "ISSUED",
            })

            # Deduct from real MaterialStockModel if present
            stock_res = await uow.session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == itm.material_code)
            )
            stock = stock_res.scalars().first()
            if stock:
                stock.on_hand_quantity = max(Decimal("0"), (stock.on_hand_quantity or Decimal("0")) - qty_dec)
                stock.available_quantity = max(Decimal("0"), (stock.available_quantity or Decimal("0")) - qty_dec)
                stock.updated_at = now

        # 4. Insert PickTaskModel
        pick_task = PickTaskModel(
            id=uuid.uuid4(),
            task_number=pt_number,
            request_id=req.id,
            request_number=req.request_number,
            warehouse_id=req.warehouse_id or "WH-01",
            department="Assembly",
            items=issued_items,
            status="COMPLETED",
            destination="Assembly Production Line Staging",
            assigned_to=user_name,
            assigned_at=now,
            started_at=now,
            completed_at=now,
            completed_by=user_name,
            created_by=user_name,
            created_at=now,
        )
        uow.session.add(pick_task)
        await uow.session.flush()

        # 5. Insert MaterialIssueModel
        mat_issue = MaterialIssueModel(
            id=uuid.uuid4(),
            issue_number=issue_number,
            pick_task_id=pick_task.id,
            request_id=req.id,
            department="Assembly",
            items=issued_items,
            issued_by=user_name,
            received_by="PENDING RECEIPT",
            issued_at=now,
        )
        uow.session.add(mat_issue)
        await uow.session.flush()

        # 6. Update MaterialRequest
        req.status = "ISSUED"
        req.approved_by = user_name
        req.approved_at = now
        history = list(req.approval_history or [])
        history.append({
            "status": "ISSUED",
            "actor": user_name,
            "comments": f"Warehouse picked and issued materials under {issue_number} (Pick Task: {pt_number})",
            "timestamp": now.isoformat(),
        })
        req.approval_history = history

        # 7. Update AssemblyOrder
        order.material_issue_id = mat_issue.id
        order.pick_task_id = pick_task.id
        order.status = "MATERIAL_ISSUED"
        order.items = issued_items
        order.updated_at = now

        await uow.commit()

        logger.info(f"Warehouse issued materials {issue_number} for Assembly Order {order.order_number}")

        return {
            "status": "SUCCESS",
            "message": f"Warehouse successfully issued materials under {issue_number}",
            "issue_id": str(mat_issue.id),
            "issue_number": mat_issue.issue_number,
            "pick_task_number": pick_task.task_number,
            "request_number": req.request_number,
            "order_number": order.order_number,
            "order_status": order.status,
            "issued_by": mat_issue.issued_by,
            "issued_at": mat_issue.issued_at.isoformat(),
            "items": issued_items,
        }


class ConfirmReceiptItemPayload(BaseModel):
    material_code: str
    received_quantity: Decimal = Field(..., ge=0)
    material_scan: Optional[str] = None


class ConfirmMaterialReceiptPayload(BaseModel):
    received_items: Optional[List[ConfirmReceiptItemPayload]] = None
    remarks: Optional[str] = None


@router.post("/material-requests/{request_id}/confirm-receipt")
async def confirm_assembly_material_receipt(
    request_id: str,
    payload: Optional[ConfirmMaterialReceiptPayload] = None,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Step 2.2: Assembly receives the issued materials and confirms receipt.
    1. Shows materials issued by Warehouse.
    2. Validates that Warehouse has actually issued the materials (order status is MATERIAL_ISSUED).
    3. Prevents duplicate receipt if already received (rejects with 409 Conflict).
    4. Records actual received quantities, user and timestamp.
    5. Updates AssemblyOrder status to 'MATERIAL_READY' to unlock Step 3: Production.
    6. Updates MaterialRequest status to 'RECEIVED'.
    """
    async with uow:
        try:
            req_uuid = uuid.UUID(request_id)
            q = select(MaterialRequestModel).where(
                or_(MaterialRequestModel.id == req_uuid, MaterialRequestModel.request_number == request_id)
            )
        except ValueError:
            q = select(MaterialRequestModel).where(MaterialRequestModel.request_number == request_id)

        res = await uow.session.execute(q.with_for_update())
        req = res.scalars().first()
        if not req:
            raise HTTPException(status_code=404, detail=f"Material request '{request_id}' not found.")

        ord_res = await uow.session.execute(
            select(AssemblyOrderModel).where(
                or_(AssemblyOrderModel.material_request_id == req.id, AssemblyOrderModel.request_number == req.request_number)
            ).limit(1)
        )
        order = ord_res.scalars().first()
        if not order:
            raise HTTPException(status_code=404, detail=f"No linked Assembly Order found for request '{req.request_number}'.")

        completed_pick = await uow.session.get(PickTaskModel, order.pick_task_id) if order.pick_task_id else None
        if not completed_pick:
            completed_pick = (await uow.session.execute(
                select(PickTaskModel)
                .where(
                    PickTaskModel.request_id == req.id,
                    PickTaskModel.department == "Assembly",
                    PickTaskModel.completed_at.is_not(None),
                )
                .order_by(PickTaskModel.completed_at.desc())
                .limit(1)
            )).scalars().first()
        if completed_pick and completed_pick.completed_at:
            req.status = "ISSUED" if req.status != "RECEIVED" else req.status
            if order.status not in ("MATERIAL_READY", "IN_PROGRESS", "COMPLETED"):
                order.status = "MATERIAL_ISSUED"
            if not order.items:
                order.items = completed_pick.items or []

        existing_receipt = await uow.session.scalar(select(AssemblyMaterialReceiptModel.id).where(
            AssemblyMaterialReceiptModel.assembly_order_id == order.id).limit(1))
        if existing_receipt:
            raise HTTPException(409, "Material receipt is already recorded. Refresh the request to see its current status.")

        # Validation: Duplicate receipt prevention
        if order.status in ("MATERIAL_READY", "IN_PROGRESS", "COMPLETED") or req.status == "RECEIVED":
            rec_date_str = order.material_received_at.isoformat() if order.material_received_at else "previously"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Duplicate receipt prevented: Materials for Order {order.order_number} were already confirmed received on {rec_date_str} by {order.material_received_by or 'Assembly Operator'}.",
            )

        # Validation: Require prior Warehouse issue
        if req.status != "ISSUED" and order.status != "MATERIAL_ISSUED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot confirm receipt: Materials have not been issued by Warehouse yet. Current status is '{req.status}'.",
            )

        user_name = current_user.username if current_user and current_user.username else "Assembly Operator"
        now = datetime.now()

        if not order.material_issue_id and completed_pick and completed_pick.completed_at:
            # Older picking records were completed without creating the issue
            # ledger row. Reconstruct it from the completed physical pick so
            # Assembly can confirm receipt without manual database repair.
            issue_now = datetime.now()
            material_issue = MaterialIssueModel(
                id=uuid.uuid4(),
                issue_number=f"ISS-{issue_now.year}-{uuid.uuid4().hex[:6].upper()}",
                pick_task_id=completed_pick.id,
                request_id=req.id,
                department="Assembly",
                items=completed_pick.items or [],
                issued_by=completed_pick.completed_by or "Warehouse Operator",
                received_by="PENDING RECEIPT",
                issued_at=issue_now,
            )
            uow.session.add(material_issue)
            await uow.session.flush()
            order.material_issue_id = material_issue.id
        if not order.material_issue_id:
            raise HTTPException(status_code=400, detail="No persisted warehouse Material Issue is linked to this production order")
        issue_rec = await uow.session.get(MaterialIssueModel, order.material_issue_id)
        if not issue_rec:
            raise HTTPException(status_code=404, detail="Linked Material Issue record was not found")

        # Build map of received quantities
        custom_qty_map: Dict[str, float] = {}
        if payload and payload.received_items:
            for item_in in payload.received_items:
                code_key = item_in.material_code.strip().casefold()
                if code_key in custom_qty_map:
                    raise HTTPException(422, detail="Duplicate material lines submitted. Refresh the request and enter one received quantity per material.")
                custom_qty_map[code_key] = float(item_in.received_quantity)
                if item_in.material_scan and item_in.material_code.upper() not in item_in.material_scan.upper():
                    raise HTTPException(status_code=422, detail=f"Scanned material QR does not match {item_in.material_code}")

        # Update order item lines with actual received quantities
        updated_items = []
        for itm in _group_material_lines(order.items):
            code = itm.get("material_code")
            issued_qty = _material_fulfillment(code, itm.get("required_quantity", 0), [], issue_rec.items)["issued_quantity"]
            if issued_qty is None:
                raise HTTPException(status_code=422, detail=f"Warehouse issued quantity for {code} is missing. Receipt cannot use requested quantity.")
            received_qty = custom_qty_map.get(code.casefold(), issued_qty)
            itm_copy = dict(itm)
            itm_copy["issued_quantity"] = issued_qty
            itm_copy["received_quantity"] = received_qty
            itm_copy["status"] = "RECEIVED"
            updated_items.append(itm_copy)
            received_decimal = Decimal(str(received_qty))
            if received_decimal > Decimal(str(issued_qty)):
                raise HTTPException(status_code=422, detail=f"Received quantity for {code} exceeds issued quantity")
            uow.session.add(AssemblyMaterialReceiptModel(
                id=uuid.uuid4(), assembly_order_id=order.id, material_issue_id=order.material_issue_id,
                material_code=code, material_qr=next((x.material_scan for x in (payload.received_items if payload else []) if x.material_code == code), None),
                issued_quantity=Decimal(str(issued_qty)), received_quantity=received_decimal,
                uom=itm.get("uom", "PCS"), received_by=user_name, received_at=now,
                remarks=payload.remarks if payload else None,
            ))

        # Update AssemblyOrder
        order.items = updated_items
        order.material_received_by = user_name
        order.material_received_at = now
        materials_ready = bool(updated_items) and all(float(item.get("received_quantity", 0)) >= float(item.get("required_quantity", 0)) for item in updated_items)
        order.status = "MATERIAL_READY" if materials_ready else "MATERIAL_SHORTAGE"
        order.updated_at = now

        # Update MaterialRequest
        req.status = "RECEIVED"
        history = list(req.approval_history or [])
        history.append({
            "status": "RECEIVED",
            "actor": user_name,
            "comments": f"Materials confirmed received physically at Assembly for Order {order.order_number}",
            "timestamp": now.isoformat(),
        })
        req.approval_history = history
        if not materials_ready:
            uow.session.add(NotificationModel(
                user_role="WAREHOUSE", title=f"Assembly receipt shortage: {req.request_number}",
                message=f"Assembly reported a quantity shortage or mismatch for {req.request_number}.", link="/inventory?tab=requests",
            ))

        # Update MaterialIssue record if present
        if order.material_issue_id:
            iss_res = await uow.session.execute(
                select(MaterialIssueModel).where(MaterialIssueModel.id == order.material_issue_id)
            )
            issue_rec = iss_res.scalars().first()
            if issue_rec:
                issue_rec.received_by = user_name

        try:
            await uow.commit()
        except IntegrityError as exc:
            await uow.session.rollback()
            if "assembly_material_receipt" in str(exc.orig):
                raise HTTPException(409, "Material receipt is already recorded. Refresh the request before retrying.") from exc
            raise

        logger.info(f"Assembly Order {order.order_number} confirmed material receipt by {user_name}")

        return {
            "status": "SUCCESS",
            "message": f"Material receipt confirmed for Assembly Order {order.order_number}. " + ("Order is now ready for production." if materials_ready else "Materials are short; production is blocked."),
            "order_number": order.order_number,
            "order_status": order.status,
            "request_number": req.request_number,
            "material_received_by": order.material_received_by,
            "material_received_at": order.material_received_at.isoformat(),
            "items": updated_items,
        }


# ==============================================================================
# STEP 3: SIMPLE ASSEMBLY PRODUCTION
# ==============================================================================
@router.get("/production/orders")
async def list_production_orders(
    search: Optional[str] = Query(None, description="Search by order number or product"),
    status: Optional[str] = Query(None, description="Filter by status"),
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Step 3.1: List Assembly Production orders.
    Shows:
    - Production/Assembly Order Number
    - Product Code and Name
    - Target Quantity
    - Produced Quantity
    - Status
    - Action availability (can_start if MATERIAL_READY, can_complete if IN_PRODUCTION)
    """
    async with uow:
        query = select(AssemblyOrderModel).order_by(AssemblyOrderModel.created_at.desc())

        if search:
            sterm = f"%{search.strip()}%"
            query = query.where(
                or_(
                    AssemblyOrderModel.order_number.ilike(sterm),
                    AssemblyOrderModel.product_name.ilike(sterm),
                    AssemblyOrderModel.product_code.ilike(sterm),
                )
            )

        res = await uow.session.execute(query)
        orders = res.scalars().all()

        rejected_order_ids = await _rejected_order_ids(uow.session, orders)
        results = []
        for o in orders:
            effective_status = "REJECTED" if o.id in rejected_order_ids else o.status
            st_filter = (status or "ALL").strip().upper()
            accepted = {"READY": {"MATERIAL_READY"}, "IN_PRODUCTION": {"IN_PRODUCTION", "IN-PROGRESS", "RUNNING"}, "COMPLETED": {"QC_PENDING", "COMPLETED", "CLOSED"}}.get(st_filter, {st_filter})
            if st_filter != "ALL" and effective_status not in accepted:
                continue
            can_start = effective_status == "MATERIAL_READY"
            can_complete = effective_status in ("IN_PRODUCTION", "IN-PROGRESS", "RUNNING")
            results.append({
                "id": str(o.id),
                "order_number": o.order_number,
                "product_code": o.product_code or "",
                "product_name": o.product_name,
                "target_quantity": float(o.planned_quantity),
                "produced_quantity": float(o.completed_quantity),
                "rejected_quantity": float(o.rejected_quantity),
                "uom": o.uom or "PCS",
                "status": effective_status,
                "priority": o.priority,
                "required_date": o.required_date.isoformat() if o.required_date else None,
                "assigned_line": o.assigned_line,
                "assigned_operator": o.assigned_operator,
                "material_request_number": o.request_number,
                "can_start": can_start,
                "can_complete": can_complete,
                "started_at": o.started_at.isoformat() if o.started_at else None,
                "completed_at": o.completed_at.isoformat() if o.completed_at else None,
                "created_at": o.created_at.isoformat() if o.created_at else None,
            })

        return results


@router.post("/orders/{order_id}/start-production")
async def start_production(
    order_id: str,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Step 3.2: Start Production on an Assembly Order.
    Requires that materials have been received (status is MATERIAL_READY).
    Transitions status to 'IN_PRODUCTION' and records started_at in PostgreSQL.
    """
    async with uow:
        try:
            ord_uuid = uuid.UUID(order_id)
            q = select(AssemblyOrderModel).where(
                or_(AssemblyOrderModel.id == ord_uuid, AssemblyOrderModel.order_number == order_id)
            )
        except ValueError:
            q = select(AssemblyOrderModel).where(AssemblyOrderModel.order_number == order_id)

        res = await uow.session.execute(q)
        order = res.scalars().first()
        if not order:
            raise HTTPException(status_code=404, detail=f"Assembly Order '{order_id}' not found.")

        # Require materials confirmed received
        if order.status != "MATERIAL_READY":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot start production: Required materials have not been confirmed as received yet (current status: '{order.status}'). Please confirm material receipt first.",
            )

        operator_name = (
            current_user.username
            if current_user and current_user.username
            else "Assembly Operator"
        )
        now = datetime.now()

        order.status = "IN_PRODUCTION"
        order.started_at = now
        order.assigned_operator = operator_name
        order.updated_at = now

        await uow.commit()

        logger.info(f"Assembly Order {order.order_number} started production by {operator_name}")

        return {
            "status": "SUCCESS",
            "message": f"Production started for Order {order.order_number}.",
            "order_id": str(order.id),
            "order_number": order.order_number,
            "order_status": order.status,
            "started_at": order.started_at.isoformat(),
            "assigned_operator": order.assigned_operator,
            "target_quantity": float(order.planned_quantity),
            "produced_quantity": float(order.completed_quantity),
        }


class CompleteProductionPayload(BaseModel):
    produced_quantity: Decimal = Field(..., gt=0, description="Produced quantity must be greater than 0")
    notes: Optional[str] = None
    completed_steps: list[str] = Field(default_factory=list, description="Completed manufacturing step IDs or names")
    wastage_quantity: Decimal = Field(default=Decimal("0"), ge=0)
    wastage_material_code: Optional[str] = None
    wastage_reason: Optional[str] = None


@router.post("/orders/{order_id}/complete-production")
async def complete_production(
    order_id: str,
    payload: CompleteProductionPayload,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Step 3.3: Complete Production on an Assembly Order.
    Requires order to be in 'IN_PRODUCTION' status.
    Records actual produced quantity and completed_at in PostgreSQL.
    Transitions status to 'QC_PENDING' ready for Step 4: Quality Check.
    """
    if payload.produced_quantity <= Decimal("0"):
        raise HTTPException(status_code=400, detail="Produced quantity must be greater than 0.")

    async with uow:
        try:
            ord_uuid = uuid.UUID(order_id)
            q = select(AssemblyOrderModel).where(
                or_(AssemblyOrderModel.id == ord_uuid, AssemblyOrderModel.order_number == order_id)
            )
        except ValueError:
            q = select(AssemblyOrderModel).where(AssemblyOrderModel.order_number == order_id)

        res = await uow.session.execute(q)
        order = res.scalars().first()
        if not order:
            raise HTTPException(status_code=404, detail=f"Assembly Order '{order_id}' not found.")

        if order.status not in ("IN_PRODUCTION", "IN-PROGRESS", "RUNNING"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot complete production: Order '{order.order_number}' is in status '{order.status}', not 'IN_PRODUCTION'.",
            )

        required_steps = [step for step in (order.assembly_steps or []) if isinstance(step, dict) and step.get("required", True)]
        if required_steps:
            completed_keys = {str(value).strip().casefold() for value in payload.completed_steps}
            missing_steps = [
                str(step.get("name") or step.get("id") or "Unnamed step")
                for step in required_steps
                if str(step.get("id") or "").strip().casefold() not in completed_keys
                and str(step.get("name") or "").strip().casefold() not in completed_keys
                and str(step.get("status") or "").upper() != "COMPLETED"
            ]
            if missing_steps:
                raise HTTPException(status_code=400, detail="Complete all required manufacturing steps before finalizing production: " + ", ".join(missing_steps))
            updated_steps = []
            for step in (order.assembly_steps or []):
                step_copy = dict(step) if isinstance(step, dict) else {"name": str(step)}
                key_id = str(step_copy.get("id") or "").strip().casefold()
                key_name = str(step_copy.get("name") or "").strip().casefold()
                if key_id in completed_keys or key_name in completed_keys:
                    step_copy["status"] = "COMPLETED"
                updated_steps.append(step_copy)
            order.assembly_steps = updated_steps

        now = datetime.now()

        # Record production usage without deducting inventory again: stock was
        # already reduced by the warehouse Material Issue transaction.
        operator = current_user.username if current_user and current_user.username else "Assembly Operator"
        for item in (order.items or []):
            code = item.get("material_code") if isinstance(item, dict) else None
            if not code:
                continue
            actual = Decimal(str(item.get("issued_quantity", item.get("required_quantity", 0)) or 0))
            consumption = (await uow.session.execute(select(AssemblyMaterialConsumptionModel).where(
                AssemblyMaterialConsumptionModel.assembly_order_id == order.id,
                AssemblyMaterialConsumptionModel.material_code == code,
            ).with_for_update())).scalars().first()
            if consumption:
                consumption.assembled_quantity = payload.produced_quantity
                consumption.actual_consumed = actual
                consumption.recorded_by = operator
                consumption.recorded_at = now
            else:
                uow.session.add(AssemblyMaterialConsumptionModel(
                    id=uuid.uuid4(), assembly_order_id=order.id, material_code=code,
                    expected_per_unit=(actual / order.planned_quantity) if order.planned_quantity else actual,
                    assembled_quantity=payload.produced_quantity, actual_consumed=actual,
                    uom=item.get("uom", "PCS"), recorded_by=operator, recorded_at=now,
                ))
        if payload.wastage_quantity > 0:
            if not payload.wastage_material_code or not payload.wastage_reason:
                raise HTTPException(status_code=422, detail="Wastage material code and reason are required")
            uow.session.add(AssemblyScrapModel(
                id=uuid.uuid4(), assembly_order_id=order.id, material_code=payload.wastage_material_code,
                quantity=payload.wastage_quantity, uom=order.uom, reason=payload.wastage_reason,
                employee_team=operator,
            ))

        order.completed_quantity = payload.produced_quantity
        order.status = "QC_PENDING"  # Complete production transitions order to QC_PENDING for QC Inspector
        order.completed_at = now
        order.updated_at = now
        if payload.notes:
            order.notes = f"{order.notes or ''} [Production note: {payload.notes}]".strip()

        await uow.commit()

        logger.info(
            f"Assembly Order {order.order_number} completed production: {payload.produced_quantity} {order.uom} produced."
        )

        return {
            "status": "SUCCESS",
            "message": f"Production completed for Order {order.order_number}. Produced quantity recorded as {float(order.completed_quantity):g} {order.uom}. Order is ready for Quality Check.",
            "order_id": str(order.id),
            "order_number": order.order_number,
            "order_status": order.status,
            "target_quantity": float(order.planned_quantity),
            "produced_quantity": float(order.completed_quantity),
            "uom": order.uom,
            "completed_at": order.completed_at.isoformat(),
        }


# ==============================================================================
# STEP 4: FINAL QUALITY CHECK (QC)
# ==============================================================================

async def require_quality_inspector(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    allowed_roles = {"ASSEMBLY", "ASSEMBLY_MANAGER", "QUALITY", "QC", "ADMIN", "SUPERUSER"}
    if not user or not user.subject:
        raise HTTPException(status_code=401, detail="Authentication required for quality inspection.")
    if not (allowed_roles.intersection(role.upper() for role in user.roles) or
            {"quality:inspect", "assembly:quality:inspect"}.intersection(user.permissions)):
        raise HTTPException(status_code=403, detail="Not authorized to perform Assembly quality inspections.")
    return user


class QualityInspectionPayload(BaseModel):
    authorized_person_confirmed: bool = Field(..., strict=True)
    inspector_name: str = Field(..., max_length=128)

    @field_validator("authorized_person_confirmed")
    @classmethod
    def validate_authorization_confirmation(cls, value: bool) -> bool:
        if not value:
            raise ValueError("Confirm quality check was performed by an authorized person.")
        return value

    @field_validator("inspector_name")
    @classmethod
    def validate_inspector_name(cls, value: str) -> str:
        name = value.strip()
        if not (2 <= len(name) <= 128 and sum(c.isalpha() for c in name) >= 2
                and all(c.isalpha() or c in " .'-" or unicodedata.category(c).startswith("M") for c in name)):
            raise ValueError("Enter a valid inspector name (2-128 characters, at least two letters).")
        return name

    order_id: str
    passed_quantity: Decimal = Field(..., ge=0, description="Quantity that passed QC")
    failed_quantity: Decimal = Field(default=Decimal("0"), ge=0, description="Quantity that failed QC and is scrapped")
    rework_quantity: Decimal = Field(default=Decimal("0"), ge=0, description="Quantity that needs rework")
    held_quantity: Decimal = Field(default=Decimal("0"), ge=0, description="Quantity held pending disposition")
    notes: Optional[str] = None


@router.get("/quality/inspections")
async def list_quality_inspections(
    status: Optional[str] = Query(None, description="Filter: PENDING, PASSED, REWORK, FAILED, ALL"),
    search: Optional[str] = Query(None, description="Search by order number or product"),
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Step 4.1: List orders requiring Quality Inspection and past inspection records.
    Shows:
    - Order Number & ID
    - Product Code & Name
    - Produced Quantity
    - Passed / Failed / Rework Quantities
    - QC Status (PENDING_INSPECTION, PASSED, REWORK, FAILED)
    - Inspector & Inspected At
    - Notes
    """
    async with uow:
        # Fetch orders in QC_PENDING or that have an inspection
        orders_q = (
            select(AssemblyOrderModel, AssemblyQualityInspectionModel)
            .outerjoin(
                AssemblyQualityInspectionModel,
                AssemblyQualityInspectionModel.assembly_order_id == AssemblyOrderModel.id,
            )
            .where(
                or_(
                    AssemblyOrderModel.status.in_(["QC_PENDING", "COMPLETED", "REWORK_REQUIRED", "QC_FAILED"]),
                    AssemblyQualityInspectionModel.id.is_not(None),
                )
            )
            .order_by(AssemblyOrderModel.completed_at.desc().nullslast(), AssemblyOrderModel.created_at.desc())
        )

        res = await uow.session.execute(orders_q)
        rows = res.all()

        results = []
        for order, inspection in rows:
            # Determine effective QC status
            if inspection:
                qc_st = inspection.status
                passed_qty = float(inspection.passed_quantity)
                failed_qty = float(inspection.failed_quantity)
                rework_qty = float(inspection.rework_quantity)
                held_qty = float(inspection.held_quantity)
                inspected_by = inspection.inspected_by
                inspected_at = inspection.inspected_at.isoformat() if inspection.inspected_at else None
                qc_notes = inspection.notes
            else:
                qc_st = "PENDING_INSPECTION"
                passed_qty = 0.0
                failed_qty = 0.0
                rework_qty = 0.0
                held_qty = 0.0
                inspected_by = None
                inspected_at = None
                qc_notes = None

            qc_group = _qc_status_group(qc_st, rework_qty, held_qty)
            # Filter by search
            if search:
                sterm = search.strip().lower()
                matches = (
                    sterm in order.order_number.lower()
                    or (order.product_name and sterm in order.product_name.lower())
                    or (order.product_code and sterm in order.product_code.lower())
                    or (inspected_by and sterm in inspected_by.lower())
                )
                if not matches:
                    continue

            # Filter by status
            if status and status.upper() != "ALL":
                st_filter = _qc_status_group(status.strip())
                if qc_group != st_filter and qc_st.upper() != status.strip().upper():
                    continue

            results.append({
                "order_id": str(order.id),
                "order_number": order.order_number,
                "product_code": order.product_code or "",
                "product_name": order.product_name,
                "uom": order.uom or "PCS",
                "produced_quantity": float(order.completed_quantity),
                "target_quantity": float(order.planned_quantity),
                "passed_quantity": passed_qty,
                "failed_quantity": failed_qty,
                "rework_quantity": rework_qty,
                "held_quantity": held_qty,
                "qc_status": qc_st,
                "qc_status_group": qc_group,
                "order_status": order.status,
                "inspected_by": inspected_by,
                "inspected_at": inspected_at,
                "notes": qc_notes,
                "can_inspect": order.status in ("QC_PENDING", "REWORK_REQUIRED") or (inspection is None and order.status == "QC_PENDING"),
                "completed_at": order.completed_at.isoformat() if order.completed_at else None,
            })

        return results


@router.post("/quality/inspect")
async def perform_quality_inspection(
    payload: QualityInspectionPayload,
    uow: UnitOfWork = Depends(get_uow),
    current_user: CurrentUser = Depends(require_quality_inspector),
):
    """
    Step 4.2 & 5.1: Perform final Quality Check.
    1. Validates quantities against produced quantity.
    2. Records QC inspection in assembly_quality_inspection.
    3. Updates assembly_order status:
       - If all passed -> COMPLETED
       - If rework > 0 -> REWORK_REQUIRED
       - If failed > 0 and passed == 0 -> QC_FAILED
    4. Automatically creates Finished Goods record for QC-passed items (Step 8 & 9):
       - Generates unique Finished Good QR code
       - Physical location remains inside Assembly (location_code: ASSEMBLY-STORAGE-01)
       - Status set to AVAILABLE
    """
    async with uow:
        try:
            ord_uuid = uuid.UUID(payload.order_id)
            q = select(AssemblyOrderModel).where(
                or_(AssemblyOrderModel.id == ord_uuid, AssemblyOrderModel.order_number == payload.order_id)
            )
        except ValueError:
            q = select(AssemblyOrderModel).where(AssemblyOrderModel.order_number == payload.order_id)

        res = await uow.session.execute(q.with_for_update())
        order = res.scalars().first()
        if not order:
            raise HTTPException(status_code=404, detail=f"Assembly Order '{payload.order_id}' not found.")

        # Require order to be in QC_PENDING or REWORK_REQUIRED
        if order.status not in ("QC_PENDING", "REWORK_REQUIRED", "IN_PRODUCTION"):
            # Check if already inspected
            ins_res = await uow.session.execute(
                select(AssemblyQualityInspectionModel).where(
                    AssemblyQualityInspectionModel.assembly_order_id == order.id
                )
            )
            existing_ins = ins_res.scalars().first()
            if existing_ins and existing_ins.status == "PASSED":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Order '{order.order_number}' was already inspected and PASSED QC on {existing_ins.inspected_at.isoformat()} by {existing_ins.inspected_by}.",
                )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Order '{order.order_number}' is in status '{order.status}'. Only orders awaiting QC ('QC_PENDING') can be inspected.",
            )

        # Validate total inspected quantity matches produced quantity
        total_inspected = payload.passed_quantity + payload.failed_quantity + payload.rework_quantity + payload.held_quantity
        if total_inspected != order.completed_quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Total inspected quantity ({total_inspected:g} {order.uom}) must match "
                    f"the produced quantity ({order.completed_quantity:g} {order.uom}). "
                    f"[Accepted: {payload.passed_quantity:g}, Rejected: {payload.failed_quantity:g}, Rework: {payload.rework_quantity:g}, Held: {payload.held_quantity:g}]"
                ),
            )

        inspector_name = payload.inspector_name
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        # Determine QC outcome status
        if payload.passed_quantity == order.completed_quantity:
            qc_status = "QC_APPROVED"
            order.status = "COMPLETED"
        else:
            qc_status = "PARTIALLY_APPROVED" if payload.passed_quantity > Decimal("0") else "REJECTED"
            order.status = "REWORK_REQUIRED" if payload.rework_quantity > Decimal("0") else "QC_FAILED"

        order.rejected_quantity = payload.failed_quantity + payload.rework_quantity
        order.updated_at = now

        # Upsert AssemblyQualityInspectionModel
        ins_res = await uow.session.execute(
            select(AssemblyQualityInspectionModel).where(
                AssemblyQualityInspectionModel.assembly_order_id == order.id
            )
        )
        inspection = ins_res.scalars().first()
        previous_passed = inspection.passed_quantity if inspection else Decimal("0")
        if not inspection:
            inspection = AssemblyQualityInspectionModel(
                assembly_order_id=order.id,
                produced_quantity=order.completed_quantity,
                passed_quantity=payload.passed_quantity,
                failed_quantity=payload.failed_quantity,
                rework_quantity=payload.rework_quantity,
                held_quantity=payload.held_quantity,
                status=qc_status,
                inspected_by=inspector_name,
                inspected_by_user_id=current_user.subject,
                authorized_person_confirmed=payload.authorized_person_confirmed,
                notes=payload.notes,
                inspected_at=now,
                created_at=now,
                updated_at=now,
            )
            uow.session.add(inspection)
        else:
            inspection.produced_quantity = order.completed_quantity
            inspection.passed_quantity = payload.passed_quantity
            inspection.failed_quantity = payload.failed_quantity
            inspection.rework_quantity = payload.rework_quantity
            inspection.held_quantity = payload.held_quantity
            inspection.status = qc_status
            inspection.inspected_by = inspector_name
            inspection.inspected_by_user_id = current_user.subject
            inspection.authorized_person_confirmed = payload.authorized_person_confirmed
            inspection.notes = payload.notes
            inspection.inspected_at = now
            inspection.updated_at = now

        fg_created = None
        # Step 8 & 9: Only QC-passed products become Finished Goods with unique QR
        if payload.passed_quantity > Decimal("0") or previous_passed > Decimal("0"):
            fg_res = await uow.session.execute(
                select(AssemblyFinishedGoodsModel).where(
                    AssemblyFinishedGoodsModel.assembly_order_id == order.id
                ).with_for_update()
            )
            fg = fg_res.scalars().first()

            # Generate unique QR code payload & serial number
            unique_token = uuid.uuid4().hex[:8].upper()
            batch_number = f"FG-BAT-{now.strftime('%Y%m%d')}-{unique_token}"
            qr_payload_str = (
                f"FG|CODE:{order.product_code}|NAME:{order.product_name}|ORDER:{order.order_number}|BATCH:{batch_number}|QTY:{payload.passed_quantity:g}|QC:QC_APPROVED|LOC:ASSEMBLY-STORAGE-01"
            )
            serial_str = f"SN-{order.product_code or 'FG'}-{order.order_number}-{unique_token}"

            if not fg:
                fg = AssemblyFinishedGoodsModel(
                    assembly_order_id=order.id,
                    product_code=order.product_code or "UNKNOWN",
                    product_name=order.product_name,
                    quantity=payload.passed_quantity,
                    uom=order.uom or "PCS",
                    status="QC_APPROVED",
                    warehouse_id="ASSEMBLY",
                    location_code="ASSEMBLY-STORAGE-01",
                    on_hand_before=Decimal("0"),
                    on_hand_after=payload.passed_quantity,
                    qr_code=qr_payload_str,
                    serial_number=serial_str,
                    batch_number=batch_number,
                    posted_at=now,
                    updated_at=now,
                )
                uow.session.add(fg)
            else:
                quantities = await stock_quantities(uow.session, fg)
                remaining = fg.quantity + payload.passed_quantity - previous_passed
                if remaining < Decimal(str(quantities["reserved_quantity"])) or remaining < 0:
                    raise HTTPException(409, "QC adjustment would reduce stock below reserved or dispatched quantities.")
                fg.quantity = remaining
                fg.on_hand_after = remaining
                fg.status = "QC_APPROVED" if remaining > 0 else ("DISPATCHED" if quantities["dispatched_quantity"] > 0 else "QC_REJECTED")
                fg.updated_at = now

            await uow.session.flush()
            fg_created = {
                "fg_id": str(fg.id),
                "product_code": fg.product_code,
                "product_name": fg.product_name,
                "quantity": float(fg.quantity),
                "uom": fg.uom,
                "status": fg.status,
                "location_code": fg.location_code,
                "qr_code": fg.qr_code,
                "serial_number": fg.serial_number,
                "batch_number": fg.batch_number,
            }

        await uow.commit()

        logger.info(
            f"Quality Inspection for Order {order.order_number}: {qc_status} "
            f"(Accepted: {payload.passed_quantity}, Rejected: {payload.failed_quantity}, Rework: {payload.rework_quantity}, Held: {payload.held_quantity})"
        )

        return {
            "status": "SUCCESS",
            "message": f"Quality inspection completed for Order {order.order_number}. Result: {qc_status}.",
            "order_number": order.order_number,
            "order_status": order.status,
            "qc_status": qc_status,
            "produced_quantity": float(order.completed_quantity),
            "passed_quantity": float(payload.passed_quantity),
            "failed_quantity": float(payload.failed_quantity),
            "rework_quantity": float(payload.rework_quantity),
            "held_quantity": float(payload.held_quantity),
            "inspected_by": inspector_name,
            "inspected_by_user_id": current_user.subject,
            "authorized_person_confirmed": payload.authorized_person_confirmed,
            "inspected_at": now.isoformat(),
            "finished_goods": fg_created,
        }


# ==============================================================================
# STEP 5: FINISHED GOODS TRACKING & QR GENERATION INSIDE ASSEMBLY
# ==============================================================================

@router.post("/dispatch/{dispatch_id}/allocate-fifo")
async def allocate_finished_goods_fifo(
    dispatch_id: str,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """Allocate persisted QC-approved Assembly FG batches oldest-first."""
    try:
        dispatch_uuid = uuid.UUID(dispatch_id)
    except ValueError:
        dispatch_uuid = (await uow.session.execute(select(DispatchModel.id).where(DispatchModel.dispatch_number == dispatch_id))).scalar_one_or_none()
    if not dispatch_uuid:
        raise HTTPException(404, "Dispatch order not found")
    try:
        result = await allocate_fifo(uow.session, dispatch_uuid)
        await uow.session.commit()
    except HTTPException:
        await uow.session.rollback()
        raise
    return {"dispatch_id": str(dispatch_uuid), "allocated": result, "status": "ALLOCATED"}

@router.get("/finished-goods")
async def list_assembly_finished_goods(
    search: Optional[str] = Query(None, description="Search by product, order # or QR"),
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
    group_by: Optional[str] = None,
):
    """
    Step 5.1: List Finished Goods records stored physically inside Assembly.
    Reads from PostgreSQL assembly_finished_goods joined with assembly_order.
    Shows:
    - FG ID
    - Order Number
    - Product Code & Name
    - Quantity & UOM
    - Status (AVAILABLE)
    - Storage Location (ASSEMBLY-STORAGE-01)
    - QR Code string
    - Serial Number
    - Date Posted
    """
    async with uow:
        q = (
            select(AssemblyFinishedGoodsModel, AssemblyOrderModel)
            .join(AssemblyOrderModel, AssemblyOrderModel.id == AssemblyFinishedGoodsModel.assembly_order_id)
            .order_by(AssemblyFinishedGoodsModel.posted_at.desc())
        )

        res = await uow.session.execute(q)
        rows = res.all()

        results = []
        for fg, order in rows:
            if search and group_by != "product":
                sterm = search.strip().lower()
                matches = (
                    sterm in order.order_number.lower()
                    or (fg.product_name and sterm in fg.product_name.lower())
                    or (fg.product_code and sterm in fg.product_code.lower())
                    or (fg.serial_number and sterm in fg.serial_number.lower())
                    or (fg.qr_code and sterm in fg.qr_code.lower())
                )
                if not matches:
                    continue

            qc = (await uow.session.execute(select(AssemblyQualityInspectionModel).where(AssemblyQualityInspectionModel.assembly_order_id == order.id))).scalar_one_or_none()
            quantities = await stock_quantities(uow.session, fg)
            results.append({
                **quantities,
                "qc_approved_quantity": quantities["produced_quantity"],
                "produced_quantity": float(order.completed_quantity),
                "manufacturing_date": (order.completed_at or fg.posted_at).isoformat(),
                "qc_status": qc.status if qc else fg.status,
                "inspected_by": qc.inspected_by if qc else None,
                "inspected_at": qc.inspected_at.isoformat() if qc and qc.inspected_at else None,
                "batch_number": fg.batch_number,
                "id": str(fg.id),
                "order_id": str(order.id),
                "order_number": order.order_number,
                "product_code": fg.product_code,
                "product_name": fg.product_name,
                "quantity": float(fg.quantity),
                "uom": fg.uom,
                "status": fg.status,
                "warehouse_id": fg.warehouse_id,
                "location_code": fg.location_code,
                "qr_code": fg.qr_code,
                "serial_number": fg.serial_number,
                "posted_at": fg.posted_at.isoformat() if fg.posted_at else None,
            })

        if group_by == "product":
            products = {}
            for batch in results:
                key = (batch["product_code"], batch["uom"])
                if key not in products:
                    products[key] = {**batch, "batches": [], **{name: Decimal("0") for name in (
                        "produced_quantity", "available_quantity", "reserved_quantity", "dispatched_quantity", "qc_approved_quantity", "quantity")}}
                product = products[key]
                product["batches"].append(batch)
                for name in ("produced_quantity", "available_quantity", "reserved_quantity", "dispatched_quantity", "qc_approved_quantity", "quantity"):
                    product[name] += Decimal(str(batch[name]))
            results = list(products.values())
            for product in results:
                product["status"] = "AVAILABLE" if product["available_quantity"] > 0 else "OUT_OF_STOCK"
                product["allocation_enabled"] = product["available_quantity"] > 0
                product["batches"].sort(key=lambda batch: (batch["posted_at"] or "", batch["id"]))
            if search:
                term = search.strip().casefold()
                results = [product for product in results if any(term in str(batch.get(field) or "").casefold()
                    for batch in product["batches"] for field in ("product_code", "product_name", "order_number", "batch_number", "serial_number", "qr_code", "location_code"))]
        return results


@router.get("/finished-goods/inventory-summary")
async def get_finished_goods_inventory_summary(
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """Return Assembly-resident FG inventory without treating it as a warehouse."""
    async with uow:
        produced = (await uow.session.execute(select(func.coalesce(func.sum(AssemblyOrderModel.completed_quantity), 0)).where(AssemblyOrderModel.completed_quantity > 0))).scalar_one()
        inspected = (await uow.session.execute(select(AssemblyQualityInspectionModel))).scalars().all()
        finished_goods = (await uow.session.execute(select(AssemblyFinishedGoodsModel))).scalars().all()
        totals = [await stock_quantities(uow.session, fg) for fg in finished_goods]
        reserved = sum(t["reserved_quantity"] for t in totals)
        dispatched = sum(t["dispatched_quantity"] for t in totals)
        approved = sum(t["produced_quantity"] for t in totals)
        available = sum(t["available_quantity"] for t in totals)
        rejected_held = sum((i.failed_quantity + i.rework_quantity + i.held_quantity for i in inspected), Decimal("0"))
        packed_rows = (await uow.session.execute(
            select(DispatchItemModel.quantity_packed, func.sum(AssemblyFinishedGoodsAllocationModel.quantity))
            .join(AssemblyFinishedGoodsAllocationModel, AssemblyFinishedGoodsAllocationModel.dispatch_item_id == DispatchItemModel.id)
            .where(AssemblyFinishedGoodsAllocationModel.status.in_(["ALLOCATED", "LOADED"]))
            .group_by(DispatchItemModel.id, DispatchItemModel.quantity_packed)
        )).all()
        packed = sum((min(packed_qty or Decimal("0"), allocated_qty) for packed_qty, allocated_qty in packed_rows), Decimal("0"))
        fifo_dates = sorted((fg.posted_at for fg in finished_goods if fg.posted_at), key=lambda d: d)
        return {
            "total_produced": float(produced),
            "qc_approved": float(approved),
            "available": float(available),
            "reserved": float(reserved),
            "packed": float(packed),
            "dispatched": float(dispatched),
            "rejected_held": float(rejected_held),
            "fifo_oldest_completion": fifo_dates[0].isoformat() if fifo_dates else None,
            "assembly_location": "ASSEMBLY-STORAGE-01",
        }


@router.get("/finished-goods/{fg_id}")
async def get_assembly_finished_goods_detail(
    fg_id: str,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Step 5.2: Get Finished Goods detail and printable label data.
    """
    async with uow:
        try:
            fg_uuid = uuid.UUID(fg_id)
            q = (
                select(AssemblyFinishedGoodsModel, AssemblyOrderModel)
                .join(AssemblyOrderModel, AssemblyOrderModel.id == AssemblyFinishedGoodsModel.assembly_order_id)
                .where(AssemblyFinishedGoodsModel.id == fg_uuid)
            )
        except ValueError:
            q = (
                select(AssemblyFinishedGoodsModel, AssemblyOrderModel)
                .join(AssemblyOrderModel, AssemblyOrderModel.id == AssemblyFinishedGoodsModel.assembly_order_id)
                .where(
                    or_(
                        AssemblyFinishedGoodsModel.serial_number == fg_id,
                        AssemblyOrderModel.order_number == fg_id,
                    )
                )
            )

        res = await uow.session.execute(q)
        row = res.first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Finished goods record '{fg_id}' not found.")

        fg, order = row
        qc = (await uow.session.execute(select(AssemblyQualityInspectionModel).where(AssemblyQualityInspectionModel.assembly_order_id == order.id))).scalar_one_or_none()
        quantities = await stock_quantities(uow.session, fg)
        return {
            **quantities,
            "qc_approved_quantity": quantities["produced_quantity"],
            "produced_quantity": float(order.completed_quantity),
            "manufacturing_date": (order.completed_at or fg.posted_at).isoformat(),
            "qc_status": qc.status if qc else fg.status,
            "inspected_by": qc.inspected_by if qc else None,
            "inspected_at": qc.inspected_at.isoformat() if qc and qc.inspected_at else None,
            "id": str(fg.id),
            "order_id": str(order.id),
            "order_number": order.order_number,
            "product_code": fg.product_code,
            "product_name": fg.product_name,
            "quantity": float(fg.quantity),
            "uom": fg.uom,
            "status": fg.status,
            "warehouse_id": fg.warehouse_id,
            "location_code": fg.location_code,
            "qr_code": fg.qr_code,
            "serial_number": fg.serial_number,
            "batch_number": fg.batch_number,
            "posted_at": fg.posted_at.isoformat() if fg.posted_at else None,
            "label_payload": {
                "title": "FINISHED GOODS ACCEPTANCE LABEL",
                "product_name": fg.product_name,
                "product_code": fg.product_code,
                "order_number": order.order_number,
                "quantity": f"{float(fg.quantity):g} {fg.uom}",
                "serial_number": fg.serial_number,
                "batch_number": fg.batch_number,
                "qr_code": fg.qr_code,
                "location": fg.location_code,
                "inspected_by": qc.inspected_by if qc else "QC Certified",
                "date": fg.posted_at.strftime("%Y-%m-%d %H:%M") if fg.posted_at else None,
                "qc_status": fg.status,
            },
        }


class FinishedGoodsQrVerificationPayload(BaseModel):
    qr_code: str = Field(..., min_length=3)


@router.post("/finished-goods/{fg_id}/verify-qr")
async def verify_finished_goods_qr(
    fg_id: str,
    payload: FinishedGoodsQrVerificationPayload,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    async with uow:
        try:
            fg_uuid = uuid.UUID(fg_id)
        except ValueError:
            raise HTTPException(400, "Invalid finished-goods identifier")
        fg = (await uow.session.execute(select(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.id == fg_uuid))).scalar_one_or_none()
        if not fg:
            raise HTTPException(404, "Finished-goods batch not found")
        if fg.status not in ("QC_APPROVED", "AVAILABLE"):
            raise HTTPException(409, "Only QC-approved finished goods can be label verified")
        if payload.qr_code.strip() != (fg.qr_code or "").strip():
            raise HTTPException(422, "Scanned QR does not match this finished-goods batch")
        fg.qr_verified_at = datetime.now()
        fg.qr_verified_by = current_user.username if current_user and current_user.username else "Assembly Operator"
        await uow.commit()
        return {"status": "LABEL_VERIFIED", "fg_id": str(fg.id), "batch_number": fg.batch_number, "verified_at": fg.qr_verified_at.isoformat()}




