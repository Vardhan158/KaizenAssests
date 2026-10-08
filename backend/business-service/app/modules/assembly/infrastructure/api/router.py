from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
import logging
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.database.session import UnitOfWork, get_uow
from app.modules.assembly.infrastructure.persistence.models import (
    AssemblyFinishedGoodsModel,
    AssemblyLineModel,
    AssemblyOrderModel,
    AssemblyQualityInspectionModel,
    AssemblyRoutingOperationModel,
    AssemblyRoutingRevisionModel,
    BillOfMaterialsItemModel,
    BillOfMaterialsModel,
)
from app.common.persistence.models import (
    MaterialIssueModel,
    MaterialRequestItemModel,
    MaterialRequestModel,
    MaterialStockModel,
    PickTaskModel,
)
from app.security.dependencies import CurrentUser, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/assembly", tags=["assembly"])


class CreateAssemblyOrderRequest(BaseModel):
    product_code: str
    product_name: Optional[str] = None
    target_quantity: Decimal = Field(..., gt=0, description="Quantity must be greater than 0")
    required_date: date
    assembly_line: Optional[str] = None
    priority: str = Field(default="NORMAL")
    notes: Optional[str] = None


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
@router.get("/dashboard")
async def get_assembly_dashboard(
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
        # Fetch all orders
        res = await uow.session.execute(
            select(AssemblyOrderModel).order_by(AssemblyOrderModel.created_at.desc())
        )
        orders = list(res.scalars().all())

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
            st = (o.status or "").upper()

            # KPI calculations
            is_terminal = st in ("COMPLETED", "PACKED", "READY_FOR_DISPATCH", "DISPATCHED", "CLOSED")
            if not is_terminal:
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
                active_orders.append(_serialize_order(o))

            # Needs Attention analysis
            # 1. Check material shortage in items
            for itm in (o.items or []):
                if isinstance(itm, dict):
                    req_qty = float(itm.get("required_quantity", 0))
                    avail_qty = float(itm.get("available_quantity", 0))
                    shortage_qty = float(itm.get("shortage", max(0.0, req_qty - avail_qty)))
                    if shortage_qty > 0 or itm.get("status") == "SHORTAGE":
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
            if st in ("MATERIAL_PENDING", "PLANNED") and not any(n["order_number"] == o.order_number for n in needs_attention):
                needs_attention.append({
                    "id": f"mat-pend-{o.order_number}",
                    "order_number": o.order_number,
                    "product_name": o.product_name,
                    "type": "Waiting for Material",
                    "severity": "WARNING",
                    "message": "Order is planned and awaiting material requisition from warehouse.",
                })

            # 3. QC Failed or Rework required
            if st in ("REWORK", "QC_FAILED") or (o.rejected_quantity and o.rejected_quantity > 0):
                needs_attention.append({
                    "id": f"rework-{o.order_number}",
                    "order_number": o.order_number,
                    "product_name": o.product_name,
                    "type": "Rework Required" if st == "REWORK" else "QC Failed",
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
        res = await uow.session.execute(
            select(BillOfMaterialsModel).where(BillOfMaterialsModel.status == "ACTIVE").order_by(BillOfMaterialsModel.product_name)
        )
        boms = res.scalars().all()

        products = []
        for b in boms:
            products.append({
                "id": str(b.id),
                "product_code": b.product_code or b.bom_number,
                "product_name": b.product_name,
                "bom_number": b.bom_number,
                "description": b.description or "",
                "uom": "PCS",
            })
        return products


@router.get("/lines")
async def list_assembly_lines(
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Get assembly lines from PostgreSQL assembly_line table.
    """
    async with uow:
        res = await uow.session.execute(
            select(AssemblyLineModel).order_by(AssemblyLineModel.code)
        )
        lines = res.scalars().all()
        return [
            {
                "id": str(l.id),
                "code": l.code,
                "name": l.name,
                "status": l.status,
            }
            for l in lines
        ]


# ==============================================================================
# 3. ASSEMBLY ORDERS (LIST, CREATE, DETAIL)
# ==============================================================================
@router.get("/orders")
async def list_assembly_orders(
    search: Optional[str] = Query(None, description="Search by order number or product"),
    status: Optional[str] = Query(None, description="Filter by status"),
    priority: Optional[str] = Query(None, description="Filter by priority"),
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    List Assembly Orders from PostgreSQL with search, status, and priority filters.
    """
    async with uow:
        query = select(AssemblyOrderModel).order_by(AssemblyOrderModel.created_at.desc())

        if search:
            term = f"%{search.strip()}%"
            query = query.where(
                or_(
                    AssemblyOrderModel.order_number.ilike(term),
                    AssemblyOrderModel.product_name.ilike(term),
                    AssemblyOrderModel.product_code.ilike(term),
                )
            )

        if status and status.upper() != "ALL":
            query = query.where(AssemblyOrderModel.status == status.upper())

        if priority and priority.upper() != "ALL":
            query = query.where(AssemblyOrderModel.priority == priority.upper())

        res = await uow.session.execute(query)
        orders = res.scalars().all()

        return [_serialize_order(o) for o in orders]


@router.post("/orders", status_code=status.HTTP_201_CREATED)
async def create_assembly_order(
    payload: CreateAssemblyOrderRequest,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Create a new Assembly Order:
    1. Validates quantity > 0 and product in BOM master.
    2. Generates sequential unique order number: ASM-YYYY-XXXXXX on backend.
    3. Loads Product's active BOM from bill_of_materials & bill_of_materials_item.
    4. Calculates required materials = quantity_per_unit * target_quantity.
    5. Checks live Warehouse inventory availability from material_stock.
    6. Loads Product's Work Steps / Routing from assembly_routing_revision.
    7. Atomically inserts order with status MATERIAL_PENDING into PostgreSQL.
    """
    if payload.target_quantity <= Decimal("0"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Target quantity must be greater than 0.",
        )

    async with uow:
        # 1. Lookup Product & BOM
        bom_query = select(BillOfMaterialsModel).where(
            or_(
                BillOfMaterialsModel.product_code == payload.product_code,
                BillOfMaterialsModel.product_name == payload.product_code,
            )
        )
        res_bom = await uow.session.execute(bom_query)
        bom = res_bom.scalars().first()

        if not bom:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No active Bill of Materials found for product code: '{payload.product_code}'.",
            )

        # 2. Sequential Unique ASM Number Generation (ASM-YYYY-XXXXXX)
        current_year = datetime.now().year
        prefix = f"ASM-{current_year}-"

        # Query max order number with this prefix
        max_order_res = await uow.session.execute(
            select(AssemblyOrderModel.order_number)
            .where(AssemblyOrderModel.order_number.like(f"{prefix}%"))
            .order_by(AssemblyOrderModel.order_number.desc())
            .limit(1)
        )
        last_order = max_order_res.scalar()

        if last_order and last_order.startswith(prefix):
            try:
                last_seq = int(last_order.replace(prefix, ""))
                next_seq = last_seq + 1
            except ValueError:
                next_seq = 1
        else:
            next_seq = 1

        order_number = f"{prefix}{next_seq:06d}"

        # 3. Calculate Required Materials from BOM items
        items_res = await uow.session.execute(
            select(BillOfMaterialsItemModel)
            .where(BillOfMaterialsItemModel.bom_id == bom.id)
            .order_by(BillOfMaterialsItemModel.created_at)
        )
        bom_items = items_res.scalars().all()
        if not bom_items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"The active Bill of Materials '{bom.bom_number}' for product '{bom.product_name}' has no component items defined. Please configure BOM components before creating assembly orders.",
            )

        calculated_materials = []
        for bi in bom_items:
            req_qty = bi.quantity_per_unit * payload.target_quantity

            # Check warehouse stock in material_stock
            stock_res = await uow.session.execute(
                select(func.coalesce(func.sum(MaterialStockModel.available), Decimal("0")))
                .where(MaterialStockModel.material_code == bi.material_code)
            )
            avail_stock = stock_res.scalar() or Decimal("0")

            shortage = max(Decimal("0"), req_qty - avail_stock)
            item_status = "AVAILABLE" if avail_stock >= req_qty else "SHORTAGE"

            calculated_materials.append({
                "material_code": bi.material_code,
                "material_name": bi.material_name,
                "quantity_per_unit": float(bi.quantity_per_unit),
                "required_quantity": float(req_qty),
                "available_quantity": float(avail_stock),
                "requested_quantity": 0.0,
                "received_quantity": 0.0,
                "shortage": float(shortage),
                "uom": bi.uom or "PCS",
                "status": item_status,
            })

        # 4. Load Work Steps / Routing from Database
        routing_res = await uow.session.execute(
            select(AssemblyRoutingRevisionModel)
            .where(
                AssemblyRoutingRevisionModel.product_code == bom.product_code,
                AssemblyRoutingRevisionModel.status == "ACTIVE",
            )
            .limit(1)
        )
        routing = routing_res.scalars().first()

        work_steps = []
        if routing and routing.operations:
            sorted_ops = sorted(routing.operations, key=lambda x: x.sequence)
            for idx, op in enumerate(sorted_ops):
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
                    "started_by": None,
                    "completed_by": None,
                })
        # Work steps loaded purely from database routing operations
        # If no routing operations exist in PostgreSQL, work_steps remains empty []

        # 5. Creator user identity
        creator_name = (
            current_user.username
            if current_user and current_user.username
            else "Assembly Manager"
        )

        # 6. Insert AssemblyOrderModel
        new_order = AssemblyOrderModel(
            id=uuid.uuid4(),
            order_number=order_number,
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
            status="PLANNED",
            putaway_status="PUTAWAY_PENDING",
            department="Assembly",
            notes=payload.notes,
            items=calculated_materials,
            assembly_steps=work_steps,
            created_by=creator_name,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

        uow.session.add(new_order)
        await uow.commit()

        logger.info(f"Assembly Order created: {order_number} for {bom.product_name} ({payload.target_quantity} PCS)")
        return _serialize_order(new_order)


@router.get("/orders/{order_id}")
async def get_assembly_order(
    order_id: str,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Get full details for an Assembly Order by UUID or order_number.
    Refreshes live warehouse stock availability for materials in the Materials tab.
    """
    async with uow:
        try:
            val_uuid = uuid.UUID(order_id)
            query = select(AssemblyOrderModel).where(
                or_(AssemblyOrderModel.id == val_uuid, AssemblyOrderModel.order_number == order_id)
            )
        except ValueError:
            query = select(AssemblyOrderModel).where(AssemblyOrderModel.order_number == order_id)

        res = await uow.session.execute(query)
        order = res.scalars().first()

        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Assembly order '{order_id}' not found.",
            )

        # Refresh warehouse availability dynamically
        items = order.items or []
        updated_items = []
        for itm in items:
            if isinstance(itm, dict) and "material_code" in itm:
                mat_code = itm["material_code"]
                stock_res = await uow.session.execute(
                    select(func.coalesce(func.sum(MaterialStockModel.available), Decimal("0")))
                    .where(MaterialStockModel.material_code == mat_code)
                )
                avail_stock = float(stock_res.scalar() or Decimal("0"))
                req_qty = float(itm.get("required_quantity", 0))
                shortage = max(0.0, req_qty - avail_stock)
                status_calc = "AVAILABLE" if avail_stock >= req_qty else "SHORTAGE"

                itm_copy = dict(itm)
                itm_copy["available_quantity"] = avail_stock
                itm_copy["shortage"] = shortage
                itm_copy["status"] = itm.get("status") if itm.get("received_quantity", 0) > 0 else status_calc
                updated_items.append(itm_copy)
            else:
                updated_items.append(itm)

        order_data = _serialize_order(order)
        order_data["items"] = updated_items

        return order_data


@router.get("/orders/{order_id}/materials")
async def get_assembly_order_materials(
    order_id: str,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Get detailed BOM requirements for an Assembly Order with real-time Warehouse inventory.
    Enforces that Warehouse is the single source of truth for raw material stock.
    Calculates required quantity = target_quantity * quantity_per_unit.
    """
    async with uow:
        try:
            val_uuid = uuid.UUID(order_id)
            query = select(AssemblyOrderModel).where(
                or_(AssemblyOrderModel.id == val_uuid, AssemblyOrderModel.order_number == order_id)
            )
        except ValueError:
            query = select(AssemblyOrderModel).where(AssemblyOrderModel.order_number == order_id)

        res = await uow.session.execute(query)
        order = res.scalars().first()

        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Assembly order '{order_id}' not found.",
            )

        items = order.items or []
        detailed_items = []
        shortage_count = 0
        available_count = 0

        for itm in items:
            if isinstance(itm, dict) and "material_code" in itm:
                mat_code = itm["material_code"]
                stock_res = await uow.session.execute(
                    select(func.coalesce(func.sum(MaterialStockModel.available), Decimal("0")))
                    .where(MaterialStockModel.material_code == mat_code)
                )
                avail_stock = float(stock_res.scalar() or Decimal("0"))
                req_qty = float(itm.get("required_quantity", 0))
                received_qty = float(itm.get("received_quantity", 0))
                requested_qty = float(itm.get("requested_quantity", 0))
                shortage = max(0.0, req_qty - avail_stock)

                if received_qty >= req_qty:
                    item_status = "RECEIVED"
                elif requested_qty >= req_qty:
                    item_status = "REQUESTED"
                elif avail_stock >= req_qty:
                    item_status = "AVAILABLE"
                else:
                    item_status = "SHORTAGE"

                if item_status == "SHORTAGE":
                    shortage_count += 1
                else:
                    available_count += 1

                detailed_items.append({
                    "material_code": mat_code,
                    "material_name": itm.get("material_name", mat_code),
                    "quantity_per_unit": float(itm.get("quantity_per_unit", 1.0)),
                    "required_quantity": req_qty,
                    "available_quantity": avail_stock,
                    "requested_quantity": requested_qty,
                    "received_quantity": received_qty,
                    "shortage": shortage,
                    "uom": itm.get("uom", "PCS"),
                    "status": item_status,
                })

        overall_status = "SHORTAGE_DETECTED" if shortage_count > 0 else "ALL_AVAILABLE"

        return {
            "order_id": str(order.id),
            "order_number": order.order_number,
            "product_code": order.product_code or "",
            "product_name": order.product_name,
            "target_quantity": float(order.planned_quantity),
            "uom": order.uom or "PCS",
            "summary": {
                "total_components": len(detailed_items),
                "available_components": available_count,
                "shortage_components": shortage_count,
                "status": overall_status,
            },
            "materials": detailed_items,
        }


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
    async with uow:
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
            req_qty = float(bi.quantity_per_unit * qty_dec)
            stock_res = await uow.session.execute(
                select(func.coalesce(func.sum(MaterialStockModel.available), Decimal("0")))
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


@router.post("/material-requests", status_code=status.HTTP_201_CREATED)
async def create_assembly_material_request(
    payload: CreateAssemblyMaterialRequestPayload,
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Step 1: Create a real Raw Material Request for Assembly production:
    1. Loads active Product BOM and validates component items.
    2. Calculates required materials = BOM quantity per unit * target_quantity.
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
            req_qty = bi.quantity_per_unit * payload.target_quantity
            stock_res = await uow.session.execute(
                select(func.coalesce(func.sum(MaterialStockModel.available), Decimal("0")))
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
            status="PENDING",
            priority=payload.priority.upper(),
            required_date=payload.required_date,
            remarks=f"{payload.remarks or 'Production Raw Materials'} [Assembly Order: {order_number_to_use}]",
            approval_history=[
                {
                    "status": "PENDING",
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
            items = items_res.scalars().all()

            item_list = [
                {
                    "id": str(i.id),
                    "material_code": i.material_code,
                    "material_name": i.material_name or i.material_code,
                    "quantity": float(i.quantity),
                    "uom": i.uom,
                }
                for i in items
            ]

            results.append({
                "id": str(req.id),
                "request_number": req.request_number,
                "order_id": str(order.id) if order else None,
                "order_number": order.order_number if order else (req.remarks or "—"),
                "order_status": order.status if order else req.status,
                "product_code": order.product_code if order else "",
                "product_name": order.product_name if order else "Manufactured Goods",
                "target_quantity": float(order.planned_quantity) if order else sum(float(i.quantity) for i in items),
                "uom": order.uom if order else "PCS",
                "items_count": len(items),
                "warehouse_id": req.warehouse_id,
                "status": req.status,
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
        items = items_res.scalars().all()

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
            "status": req.status,
            "priority": req.priority or "NORMAL",
            "required_date": req.required_date.isoformat() if req.required_date else None,
            "remarks": req.remarks,
            "material_received_by": getattr(order, "material_received_by", None),
            "material_received_at": order.material_received_at.isoformat() if getattr(order, "material_received_at", None) else None,
            "material_issue": material_issue_data,
            "created_at": req.created_at.isoformat() if req.created_at else None,
            "items": [
                {
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
            issued_items.append({
                "material_code": itm.material_code,
                "material_name": itm.material_name or itm.material_code,
                "required_quantity": float(qty_dec),
                "issued_quantity": float(qty_dec),
                "received_quantity": 0.0,
                "uom": itm.uom or "PCS",
                "status": "ISSUED",
            })

            # Deduct from real MaterialStockModel if present
            stock_res = await uow.session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == itm.material_code)
            )
            stock = stock_res.scalars().first()
            if stock:
                stock.on_hand = max(Decimal("0"), (stock.on_hand or Decimal("0")) - qty_dec)
                stock.available = max(Decimal("0"), (stock.available or Decimal("0")) - qty_dec)
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
        if not order:
            raise HTTPException(status_code=404, detail=f"No linked Assembly Order found for request '{req.request_number}'.")

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

        # Build map of received quantities
        custom_qty_map: Dict[str, float] = {}
        if payload and payload.received_items:
            for item_in in payload.received_items:
                custom_qty_map[item_in.material_code] = float(item_in.received_quantity)

        # Update order item lines with actual received quantities
        updated_items = []
        for itm in (order.items or []):
            code = itm.get("material_code")
            issued_qty = float(itm.get("issued_quantity", itm.get("required_quantity", 0)))
            received_qty = custom_qty_map.get(code, issued_qty)
            itm_copy = dict(itm)
            itm_copy["received_quantity"] = received_qty
            itm_copy["status"] = "RECEIVED"
            updated_items.append(itm_copy)

        # Update AssemblyOrder
        order.items = updated_items
        order.material_received_by = user_name
        order.material_received_at = now
        order.status = "MATERIAL_READY"  # Transition to MATERIAL_READY unlocks Production
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

        # Update MaterialIssue record if present
        if order.material_issue_id:
            iss_res = await uow.session.execute(
                select(MaterialIssueModel).where(MaterialIssueModel.id == order.material_issue_id)
            )
            issue_rec = iss_res.scalars().first()
            if issue_rec:
                issue_rec.received_by = user_name

        await uow.commit()

        logger.info(f"Assembly Order {order.order_number} confirmed material receipt by {user_name}")

        return {
            "status": "SUCCESS",
            "message": f"Material receipt confirmed for Assembly Order {order.order_number}. Order is now ready for production.",
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

        if status and status.upper() != "ALL":
            st_filter = status.strip().upper()
            if st_filter == "READY":
                query = query.where(AssemblyOrderModel.status == "MATERIAL_READY")
            elif st_filter == "IN_PRODUCTION":
                query = query.where(AssemblyOrderModel.status.in_(["IN_PRODUCTION", "IN-PROGRESS", "RUNNING"]))
            elif st_filter == "COMPLETED":
                query = query.where(AssemblyOrderModel.status.in_(["QC_PENDING", "COMPLETED", "CLOSED"]))
            else:
                query = query.where(AssemblyOrderModel.status == st_filter)

        res = await uow.session.execute(query)
        orders = res.scalars().all()

        results = []
        for o in orders:
            can_start = o.status == "MATERIAL_READY"
            can_complete = o.status in ("IN_PRODUCTION", "IN-PROGRESS", "RUNNING")
            results.append({
                "id": str(o.id),
                "order_number": o.order_number,
                "product_code": o.product_code or "",
                "product_name": o.product_name,
                "target_quantity": float(o.planned_quantity),
                "produced_quantity": float(o.completed_quantity),
                "rejected_quantity": float(o.rejected_quantity),
                "uom": o.uom or "PCS",
                "status": o.status,
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

        now = datetime.now()

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

class QualityInspectionPayload(BaseModel):
    order_id: str
    passed_quantity: Decimal = Field(..., ge=0, description="Quantity that passed QC")
    failed_quantity: Decimal = Field(default=Decimal("0"), ge=0, description="Quantity that failed QC and is scrapped")
    rework_quantity: Decimal = Field(default=Decimal("0"), ge=0, description="Quantity that needs rework")
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
                inspected_by = inspection.inspected_by
                inspected_at = inspection.inspected_at.isoformat() if inspection.inspected_at else None
                qc_notes = inspection.notes
            else:
                qc_st = "PENDING_INSPECTION"
                passed_qty = 0.0
                failed_qty = 0.0
                rework_qty = 0.0
                inspected_by = None
                inspected_at = None
                qc_notes = None

            # Filter by search
            if search:
                sterm = search.strip().lower()
                matches = (
                    sterm in order.order_number.lower()
                    or (order.product_name and sterm in order.product_name.lower())
                    or (order.product_code and sterm in order.product_code.lower())
                )
                if not matches:
                    continue

            # Filter by status
            if status and status.upper() != "ALL":
                st_filter = status.strip().upper()
                if st_filter == "PENDING" and qc_st != "PENDING_INSPECTION":
                    continue
                elif st_filter != "PENDING" and qc_st != st_filter:
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
                "qc_status": qc_st,
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
    current_user: Optional[CurrentUser] = Depends(get_current_user),
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

        res = await uow.session.execute(q)
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
        total_inspected = payload.passed_quantity + payload.failed_quantity + payload.rework_quantity
        if total_inspected != order.completed_quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Total inspected quantity ({total_inspected:g} {order.uom}) must match "
                    f"the produced quantity ({order.completed_quantity:g} {order.uom}). "
                    f"[Passed: {payload.passed_quantity:g}, Failed: {payload.failed_quantity:g}, Rework: {payload.rework_quantity:g}]"
                ),
            )

        inspector_name = current_user.username if current_user and current_user.username else "QC Inspector"
        now = datetime.now()

        # Determine QC outcome status
        if payload.failed_quantity == Decimal("0") and payload.rework_quantity == Decimal("0"):
            qc_status = "PASSED"
            order.status = "COMPLETED"
        elif payload.rework_quantity > Decimal("0"):
            qc_status = "REWORK"
            order.status = "REWORK_REQUIRED"
        else:
            qc_status = "FAILED"
            order.status = "QC_FAILED"

        order.rejected_quantity = payload.failed_quantity + payload.rework_quantity
        order.updated_at = now

        # Upsert AssemblyQualityInspectionModel
        ins_res = await uow.session.execute(
            select(AssemblyQualityInspectionModel).where(
                AssemblyQualityInspectionModel.assembly_order_id == order.id
            )
        )
        inspection = ins_res.scalars().first()
        if not inspection:
            inspection = AssemblyQualityInspectionModel(
                assembly_order_id=order.id,
                produced_quantity=order.completed_quantity,
                passed_quantity=payload.passed_quantity,
                failed_quantity=payload.failed_quantity,
                rework_quantity=payload.rework_quantity,
                status=qc_status,
                inspected_by=inspector_name,
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
            inspection.status = qc_status
            inspection.inspected_by = inspector_name
            inspection.notes = payload.notes
            inspection.inspected_at = now
            inspection.updated_at = now

        fg_created = None
        # Step 8 & 9: Only QC-passed products become Finished Goods with unique QR
        if payload.passed_quantity > Decimal("0"):
            fg_res = await uow.session.execute(
                select(AssemblyFinishedGoodsModel).where(
                    AssemblyFinishedGoodsModel.assembly_order_id == order.id
                )
            )
            fg = fg_res.scalars().first()

            # Generate unique QR code payload & serial number
            unique_token = uuid.uuid4().hex[:8].upper()
            qr_payload_str = (
                f"FG|{order.product_code}|{order.order_number}|QTY:{payload.passed_quantity:g}|SN-{unique_token}"
            )
            serial_str = f"SN-{order.product_code or 'FG'}-{order.order_number}-{unique_token}"

            if not fg:
                fg = AssemblyFinishedGoodsModel(
                    assembly_order_id=order.id,
                    product_code=order.product_code or "UNKNOWN",
                    product_name=order.product_name,
                    quantity=payload.passed_quantity,
                    uom=order.uom or "PCS",
                    status="AVAILABLE",
                    warehouse_id="ASSEMBLY-WH",
                    location_code="ASSEMBLY-STORAGE-01",
                    on_hand_before=Decimal("0"),
                    on_hand_after=payload.passed_quantity,
                    qr_code=qr_payload_str,
                    serial_number=serial_str,
                    posted_at=now,
                    updated_at=now,
                )
                uow.session.add(fg)
            else:
                fg.quantity = payload.passed_quantity
                fg.on_hand_after = payload.passed_quantity
                fg.qr_code = qr_payload_str
                fg.serial_number = serial_str
                fg.status = "AVAILABLE"
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
            }

        await uow.commit()

        logger.info(
            f"Quality Inspection for Order {order.order_number}: {qc_status} "
            f"(Passed: {payload.passed_quantity}, Failed: {payload.failed_quantity}, Rework: {payload.rework_quantity})"
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
            "inspected_by": inspector_name,
            "inspected_at": now.isoformat(),
            "finished_goods": fg_created,
        }


# ==============================================================================
# STEP 5: FINISHED GOODS TRACKING & QR GENERATION INSIDE ASSEMBLY
# ==============================================================================

@router.get("/finished-goods")
async def list_assembly_finished_goods(
    search: Optional[str] = Query(None, description="Search by product, order # or QR"),
    uow: UnitOfWork = Depends(get_uow),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
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
            if search:
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

            results.append({
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

        return results


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
        return {
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
            "label_payload": {
                "title": "FINISHED GOODS ACCEPTANCE LABEL",
                "product_name": fg.product_name,
                "product_code": fg.product_code,
                "order_number": order.order_number,
                "quantity": f"{float(fg.quantity):g} {fg.uom}",
                "serial_number": fg.serial_number,
                "qr_code": fg.qr_code,
                "location": fg.location_code,
                "inspected_by": "QC Certified",
                "date": fg.posted_at.strftime("%Y-%m-%d %H:%M") if fg.posted_at else None,
            },
        }




