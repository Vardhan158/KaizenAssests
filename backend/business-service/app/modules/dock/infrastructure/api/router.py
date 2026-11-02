from __future__ import annotations

from typing import List, Optional, Set, Tuple
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, desc, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError

from app.database.session import UnitOfWork, get_uow
from app.modules.dock.application.service import DockAllocationService
from app.modules.dock.domain.enums import DockType
from app.modules.dock.infrastructure.api.schemas import (
    AllocateDockRequest,
    AllocationRequestResponse,
    AutoCreateAllocationRequest,
    CreateDockMasterRequest,
    DockAllocationHistoryResponse,
    DockMasterResponse,
    DockOverviewMetrics,
    ReassignDockRequest,
    UpdateDockMasterRequest,
    UpdateDockStatusRequest,
)
from app.modules.dock.infrastructure.persistence.models import (
    DockAllocationHistoryModel,
    DockAllocationRequestModel,
    DockMasterModel,
    DockStatusHistoryModel,
)
from app.security.dependencies import CurrentUser, get_current_user, require_permission, _bearer_scheme
from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel, UserAccountModel
from app.modules.gate.infrastructure.persistence.models import GateEntryModel, DockAssignmentModel

router = APIRouter(prefix="/api/v1/warehouse", tags=["dock-management"])


async def _get_warehouse_user_context(user: CurrentUser, uow: UnitOfWork):
    from app.modules.warehouse.context import warehouse_context
    return await warehouse_context(uow.session)


@router.get("/dock-types", response_model=List[str])
async def list_dock_types() -> List[str]:
    return [dock_type.value for dock_type in DockType]


@router.get("/docks/availability", response_model=DockOverviewMetrics)
async def get_dock_availability(uow: UnitOfWork = Depends(get_uow)):
    metrics = await DockAllocationService.get_overview_metrics(uow.session)
    return metrics


@router.get("/docks", response_model=List[DockMasterResponse])
async def list_docks(
    dock_type: Optional[str] = None,
    status: Optional[str] = None,
    direction: Optional[str] = None,
    status_filter: Optional[str] = None,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    actual_status = status if status is not None else status_filter
    if isinstance(actual_status, str) and actual_status.strip().upper() == "ALL":
        actual_status = None
    if isinstance(dock_type, str) and dock_type.strip().upper() == "ALL":
        dock_type = None

    docks = await DockAllocationService.list_docks(uow.session, dock_type=dock_type, status=actual_status)
    if direction:
        direction_value = direction.strip().upper()
        docks = [dock for dock in docks if dock.direction in (direction_value, "BOTH")]
    dock_ids = [d.id for d in docks]
    alloc_map = await DockAllocationService.get_active_allocations_for_docks(uow.session, dock_ids)

    from app.modules.gate.infrastructure.persistence.models import GateEntryModel, DockAssignmentModel, DockModel
    from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel

    ge_res = await uow.session.execute(select(GateEntryModel))
    ge_list = ge_res.scalars().all()
    ge_map_by_pass = {ge.gate_entry_number: ge for ge in ge_list if ge.gate_entry_number}
    ge_map_by_id = {str(ge.id): ge for ge in ge_list}
    ge_map_by_veh = {ge.vehicle_number: ge for ge in ge_list if ge.vehicle_number}

    da_res = await uow.session.execute(select(DockAssignmentModel))
    da_list = da_res.scalars().all()
    da_map_by_ge = {da.gate_entry_id: da for da in da_list if da.gate_entry_id}
    da_map_by_dock = {da.dock_number: da for da in da_list if da.dock_number}
    wh_dock_res = await uow.session.execute(select(DockModel))
    wh_dock_status = {dock.dock_number.upper(): dock.status for dock in wh_dock_res.scalars().all()}

    warehouses_res = await uow.session.execute(select(WarehouseModel))
    warehouses_list = warehouses_res.scalars().all()
    warehouse_by_id = {s.id: s for s in warehouses_list}
    warehouse_by_code = {s.warehouse_code.strip().upper(): s for s in warehouses_list if s.warehouse_code}

    res = []
    for d in docks:
        dock_warehouse = warehouse_by_id.get(d.warehouse_ref_id) if getattr(d, "warehouse_ref_id", None) else None

        d_warehouse_ref_id = dock_warehouse.id if dock_warehouse else getattr(d, "warehouse_ref_id", None)
        d_warehouse_code = dock_warehouse.warehouse_code if dock_warehouse else None
        d_warehouse_name = dock_warehouse.warehouse_name if dock_warehouse else None

        alloc_req = alloc_map.get(d.id)
        current_alloc = None
        assigned_sid = None
        assigned_scode = None
        assigned_sname = None

        if alloc_req:
            ge = ge_map_by_pass.get(alloc_req.existing_gate_pass_id) or ge_map_by_id.get(alloc_req.existing_gate_pass_id) or ge_map_by_veh.get(alloc_req.vehicle_number)
            da = da_map_by_ge.get(ge.id) if ge else None
            if not da:
                da = da_map_by_dock.get(d.dock_code)
            # Legacy allocations can retain an old pass/vehicle reference,
            # while DockAssignment still points at the persisted gate entry.
            if not ge and da and da.gate_entry_id:
                ge = ge_map_by_id.get(str(da.gate_entry_id))

            if getattr(alloc_req, "assigned_warehouse_ref_id", None):
                assigned_sid = alloc_req.assigned_warehouse_ref_id
                assigned_scode = getattr(alloc_req, "assigned_warehouse_code", None)
                assigned_sname = getattr(alloc_req, "assigned_warehouse_name", None)
            elif da and da.assigned_warehouse_ref_id:
                assigned_sid = da.assigned_warehouse_ref_id
                assigned_scode = da.assigned_warehouse_code
                assigned_sname = da.assigned_warehouse_name

            if assigned_sid and not assigned_scode and assigned_sid in warehouse_by_id:
                st = warehouse_by_id[assigned_sid]
                assigned_scode = st.warehouse_code
                assigned_sname = st.warehouse_name
            if assigned_scode and not assigned_sid and assigned_scode.strip().upper() in warehouse_by_code:
                st = warehouse_by_code[assigned_scode.strip().upper()]
                assigned_sid = st.id
                assigned_sname = st.warehouse_name

            mat_ref = alloc_req.material_reference
            if not mat_ref or mat_ref in ("General Material", "Material", "Inbound Goods"):
                if ge:
                    mat_ref = ge.ocr_product_material or getattr(ge, "material_description", None) or (f"PO: {ge.po_number}" if ge.po_number else None)
            vendor_ref = alloc_req.vendor_reference
            if not vendor_ref or vendor_ref in ("Approved Vendor", "Vendor"):
                if ge and ge.ocr_supplier_name:
                    vendor_ref = ge.ocr_supplier_name

            # Gate Entry is the source of truth for the vehicle and canonical
            # gate-pass number. Older allocation rows may have a blank or
            # stale vehicle value, so prefer the linked persisted entry.
            canonical_vehicle_number = (
                getattr(ge, "vehicle_number", None)
                or alloc_req.vehicle_number
            )

            current_alloc = AllocationRequestResponse(
                id=alloc_req.id,
                # Gate Security is authoritative for the pass number. The
                # allocation request may contain a legacy/stale reference.
                existing_gate_pass_id=ge.gate_entry_number if ge and ge.gate_entry_number else alloc_req.existing_gate_pass_id,
                vendor_reference=vendor_ref,
                vehicle_number=canonical_vehicle_number,
                material_reference=mat_ref,
                material_description=alloc_req.material_description if (alloc_req.material_description and alloc_req.material_description not in ("Inbound Material Shipment", "General Material")) else mat_ref,
                quantity=alloc_req.quantity,
                security_approved_at=alloc_req.security_approved_at,
                priority=alloc_req.priority,
                status=alloc_req.status,
                assigned_dock_id=alloc_req.assigned_dock_id,
                assigned_dock_code=d.dock_code,
                assigned_warehouse_ref_id=assigned_sid,
                assigned_warehouse_code=assigned_scode,
                assigned_warehouse_name=assigned_sname,
                assigned_by=alloc_req.assigned_by,
                assigned_at=alloc_req.assigned_at,
                arrived_at=alloc_req.arrived_at,
                started_at=alloc_req.started_at,
                completed_at=alloc_req.completed_at,
                released_at=alloc_req.released_at,
                cancelled_at=alloc_req.cancelled_at,
                cancellation_reason=alloc_req.cancellation_reason,
                created_at=alloc_req.created_at,
                updated_at=alloc_req.updated_at,
            )
        effective_status = wh_dock_status.get(d.dock_code.upper(), d.status)
        res.append(
            DockMasterResponse(
                id=d.id,
                dock_code=d.dock_code,
                dock_name=d.dock_name,
                dock_type=d.dock_type,
                direction=d.direction,
                location=d.location,
                description=d.description,
                status=effective_status,
                is_active=d.is_active,
                warehouse_ref_id=d_warehouse_ref_id or assigned_sid,
                warehouse_code=d_warehouse_code or assigned_scode,
                warehouse_name=d_warehouse_name or assigned_sname,
                assigned_warehouse_ref_id=assigned_sid,
                assigned_warehouse_code=assigned_scode,
                assigned_warehouse_name=assigned_sname,
                created_at=d.created_at,
                updated_at=d.updated_at,
                current_allocation=current_alloc,
            )
        )
    user_roles = [r.upper() for r in getattr(user, "roles", [])]
    is_warehouse_or_admin = any(
        r in user_roles
        for r in ("ADMIN", "SUPERUSER", "WAREHOUSE_MANAGER", "WAREHOUSE", "GATE_SECURITY", "PROCUREMENT")
    )
    is_warehouse_user = any(r in user_roles for r in ("WAREHOUSE_OPERATOR"))

    if is_warehouse_user and not is_warehouse_or_admin:
        user_warehouse_ref_ids, user_warehouse_codes = await _get_warehouse_user_context(user, uow)
        user_warehouse_str_ids = {str(sid).lower() for sid in user_warehouse_ref_ids}
        user_warehouse_codes_upper = {str(sc).strip().upper() for sc in user_warehouse_codes}

        filtered_res = []
        for d_resp in res:
            # Warehouse Operator must ONLY see docks that have an active allocation assigned to their warehouse
            alloc = d_resp.current_allocation
            if alloc and alloc.status in ("OCCUPIED", "RESERVED", "ALLOCATED", "DOCK_ASSIGNED", "AT_DOCK"):
                alloc_sid = str(alloc.assigned_warehouse_ref_id).lower() if alloc.assigned_warehouse_ref_id else ""
                alloc_scode = str(alloc.assigned_warehouse_code or "").strip().upper()
                if (alloc_sid and alloc_sid in user_warehouse_str_ids) or (alloc_scode and alloc_scode in user_warehouse_codes_upper):
                    filtered_res.append(d_resp)
                    continue

            # Some dock allocations are represented directly on the dock
            # response while the allocation request is being synchronized.
            # Keep those visible to the assigned warehouse too.
            direct_sid = str(d_resp.assigned_warehouse_ref_id).lower() if d_resp.assigned_warehouse_ref_id else ""
            direct_scode = str(d_resp.assigned_warehouse_code or "").strip().upper()
            if (
                (direct_sid and direct_sid in user_warehouse_str_ids)
                or (direct_scode and direct_scode in user_warehouse_codes_upper)
            ) and str(d_resp.status or "").upper() in ("OCCUPIED", "RESERVED", "ALLOCATED", "DOCK_ASSIGNED", "AT_DOCK"):
                filtered_res.append(d_resp)
        return filtered_res

    return res


@router.post("/docks", response_model=DockMasterResponse, status_code=status.HTTP_201_CREATED)
async def create_dock(
    req: CreateDockMasterRequest,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
):
    dock_code = req.dock_code.strip().upper()
    if await uow.session.scalar(select(DockMasterModel.id).where(DockMasterModel.dock_code == dock_code)):
        raise HTTPException(status_code=409, detail=f"Dock code '{dock_code}' already exists")
    dock = DockMasterModel(
        dock_code=dock_code,
        dock_name=req.dock_name.strip(),
        dock_type=req.dock_type.strip().upper(),
        direction=req.direction.strip().upper(),
        location=req.location,
        description=req.description,
        status=req.status.upper(),
        is_active=req.is_active,
    )
    uow.session.add(dock)
    try:
        await uow.session.commit()
    except IntegrityError as exc:
        await uow.session.rollback()
        raise HTTPException(status_code=409, detail=f"Dock code '{dock_code}' already exists") from exc
    return await get_dock_by_id(dock.id, user=user, uow=uow)


@router.get("/docks/{dock_id}", response_model=DockMasterResponse)
async def get_dock_by_id(
    dock_id: uuid.UUID,
    user: CurrentUser | None = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    result = await uow.session.execute(
        select(DockMasterModel).where(DockMasterModel.id == dock_id)
    )
    dock = result.scalar_one_or_none()
    if not dock:
        raise HTTPException(status_code=404, detail="Dock not found")

    alloc_map = await DockAllocationService.get_active_allocations_for_docks(uow.session, [dock.id])
    alloc_req = alloc_map.get(dock.id)

    user_roles = [r.upper() for r in getattr(user, "roles", [])] if user else ["ADMIN"]
    is_warehouse_or_admin = any(
        r in user_roles
        for r in ("ADMIN", "SUPERUSER", "WAREHOUSE_MANAGER", "WAREHOUSE", "GATE_SECURITY", "PROCUREMENT")
    )
    is_warehouse_user = any(r in user_roles for r in ("WAREHOUSE_OPERATOR"))

    if is_warehouse_user and not is_warehouse_or_admin:
        user_warehouse_ref_ids, user_warehouse_codes = await _get_warehouse_user_context(user, uow)
        match = False
        if alloc_req:
            if alloc_req.assigned_warehouse_ref_id and alloc_req.assigned_warehouse_ref_id in user_warehouse_ref_ids:
                match = True
            elif alloc_req.assigned_warehouse_code and alloc_req.assigned_warehouse_code.strip().upper() in user_warehouse_codes:
                match = True
        elif dock.warehouse_ref_id and dock.warehouse_ref_id in user_warehouse_ref_ids and dock.status in ("OCCUPIED", "RESERVED"):
            match = True

        if not match:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You are only authorized to access docks allocated to your warehouse.",
            )

    current_alloc = None
    if alloc_req:
        from app.modules.gate.infrastructure.persistence.models import GateEntryModel
        ge_res = await uow.session.execute(
            select(GateEntryModel).where(
                (GateEntryModel.gate_entry_number == alloc_req.existing_gate_pass_id) |
                (GateEntryModel.vehicle_number == alloc_req.vehicle_number)
            )
        )
        ge = ge_res.scalars().first()
        mat_ref = alloc_req.material_reference
        if not mat_ref or mat_ref in ("General Material", "Material", "Inbound Goods"):
            if ge:
                mat_ref = ge.ocr_product_material or getattr(ge, "material_description", None) or (f"PO: {ge.po_number}" if ge.po_number else None)
        vendor_ref = alloc_req.vendor_reference
        if not vendor_ref or vendor_ref in ("Approved Vendor", "Vendor"):
            if ge and ge.ocr_supplier_name:
                vendor_ref = ge.ocr_supplier_name

        current_alloc = AllocationRequestResponse(
            id=alloc_req.id,
            existing_gate_pass_id=ge.gate_entry_number if ge and ge.gate_entry_number else alloc_req.existing_gate_pass_id,
            vendor_reference=vendor_ref,
            vehicle_number=getattr(ge, "vehicle_number", None) or alloc_req.vehicle_number,
            material_reference=mat_ref,
            material_description=alloc_req.material_description if (alloc_req.material_description and alloc_req.material_description not in ("Inbound Material Shipment", "General Material")) else mat_ref,
            quantity=alloc_req.quantity,
            security_approved_at=alloc_req.security_approved_at,
            priority=alloc_req.priority,
            status=alloc_req.status,
            assigned_dock_id=alloc_req.assigned_dock_id,
            assigned_dock_code=dock.dock_code,
            assigned_warehouse_ref_id=alloc_req.assigned_warehouse_ref_id,
            assigned_warehouse_code=alloc_req.assigned_warehouse_code,
            assigned_warehouse_name=alloc_req.assigned_warehouse_name,
            assigned_by=alloc_req.assigned_by,
            assigned_at=alloc_req.assigned_at,
            arrived_at=alloc_req.arrived_at,
            started_at=alloc_req.started_at,
            completed_at=alloc_req.completed_at,
            released_at=alloc_req.released_at,
            cancelled_at=alloc_req.cancelled_at,
            cancellation_reason=alloc_req.cancellation_reason,
            created_at=alloc_req.created_at,
            updated_at=alloc_req.updated_at,
        )

    return DockMasterResponse(
        id=dock.id,
        dock_code=dock.dock_code,
        dock_name=dock.dock_name,
        dock_type=dock.dock_type,
        direction=dock.direction,
        location=dock.location,
        description=dock.description,
        status=dock.status,
        is_active=dock.is_active,
        created_at=dock.created_at,
        updated_at=dock.updated_at,
        current_allocation=current_alloc,
    )


@router.put("/docks/{dock_id}", response_model=DockMasterResponse)
async def update_dock(
    dock_id: uuid.UUID,
    req: UpdateDockMasterRequest,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
):
    dock = (await uow.session.execute(select(DockMasterModel).where(DockMasterModel.id == dock_id))).scalar_one_or_none()
    if not dock:
        raise HTTPException(status_code=404, detail="Dock not found")

    if req.dock_code is not None:
        dock_code = req.dock_code.strip().upper()
        duplicate = await uow.session.scalar(select(DockMasterModel).where(DockMasterModel.dock_code == dock_code, DockMasterModel.id != dock.id))
        if duplicate:
            raise HTTPException(status_code=409, detail=f"Dock code '{dock_code}' already exists")
        dock.dock_code = dock_code
    if req.dock_name is not None:
        dock.dock_name = req.dock_name.strip()
    if req.dock_type is not None:
        dock.dock_type = req.dock_type.strip().upper()
    if req.direction is not None:
        dock.direction = req.direction.strip().upper()
    if req.location is not None:
        dock.location = req.location
    if req.description is not None:
        dock.description = req.description
    if req.is_active is not None:
        dock.is_active = req.is_active

    try:
        await uow.session.commit()
    except IntegrityError as exc:
        await uow.session.rollback()
        raise HTTPException(status_code=409, detail="Dock code already exists") from exc
    return await get_dock_by_id(dock.id, uow=uow)


@router.patch("/docks/{dock_id}/status", response_model=DockMasterResponse)
async def update_dock_status(
    dock_id: uuid.UUID,
    req: UpdateDockStatusRequest,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
):
    dock = (await uow.session.execute(select(DockMasterModel).where(DockMasterModel.id == dock_id))).scalar_one_or_none()
    if not dock:
        raise HTTPException(status_code=404, detail="Dock not found")
    old_status = dock.status
    dock.status = req.status.upper()
    uow.session.add(
        DockStatusHistoryModel(
            dock_id=dock.id,
            previous_status=old_status,
            new_status=dock.status,
            reason=req.reason,
            changed_by=user.username,
        )
    )
    await uow.session.commit()
    return await get_dock_by_id(dock_id, uow=uow)


@router.get("/dock-allocation-requests", response_model=List[AllocationRequestResponse])
async def list_allocation_requests(
    status_filter: Optional[str] = None,
    status: Optional[str] = None,
    uow: UnitOfWork = Depends(get_uow),
):
    actual_status = status_filter if status_filter is not None else status
    if isinstance(actual_status, str) and actual_status.strip().upper() == "ALL":
        actual_status = None

    query = select(DockAllocationRequestModel).options(
        selectinload(DockAllocationRequestModel.assigned_dock),
    )
    if actual_status and isinstance(actual_status, str):
        query = query.where(DockAllocationRequestModel.status == actual_status.strip().upper())
    query = query.order_by(
        desc(DockAllocationRequestModel.priority == "URGENT"),
        desc(DockAllocationRequestModel.priority == "HIGH"),
        desc(DockAllocationRequestModel.security_approved_at),
    )
    result = await uow.session.execute(query)
    reqs = result.scalars().all()
    gate_result = await uow.session.execute(
        select(GateEntryModel).order_by(GateEntryModel.created_at.desc())
    )
    gate_entries = gate_result.scalars().all()
    gate_by_pass: dict[str, GateEntryModel] = {}
    gate_by_id: dict[str, GateEntryModel] = {}
    gate_by_vehicle: dict[str, GateEntryModel] = {}
    for gate_entry in gate_entries:
        if gate_entry.gate_entry_number:
            gate_by_pass.setdefault(gate_entry.gate_entry_number.strip().upper(), gate_entry)
        gate_by_id.setdefault(str(gate_entry.id).upper(), gate_entry)
        if gate_entry.vehicle_number:
            gate_by_vehicle.setdefault(gate_entry.vehicle_number.strip().upper(), gate_entry)

    res = []
    for r in reqs:
        raw_gate_reference = (r.existing_gate_pass_id or "").strip()
        ge = (
            gate_by_pass.get(raw_gate_reference.upper())
            or gate_by_id.get(raw_gate_reference.upper())
            or gate_by_vehicle.get((r.vehicle_number or "").strip().upper())
        )
        res.append(
            AllocationRequestResponse(
                id=r.id,
                # Return the exact gate pass generated by Gate Security.
                existing_gate_pass_id=ge.gate_entry_number if ge and ge.gate_entry_number else r.existing_gate_pass_id,
                vendor_reference=r.vendor_reference,
                vehicle_number=r.vehicle_number,
                material_reference=r.material_reference,
                material_description=r.material_description,
                quantity=r.quantity,
                security_approved_at=r.security_approved_at,
                priority=r.priority,
                status=r.status,
                assigned_dock_id=r.assigned_dock_id,
                assigned_dock_code=r.assigned_dock.dock_code if r.assigned_dock else None,
                assigned_by=r.assigned_by,
                assigned_at=r.assigned_at,
                arrived_at=r.arrived_at,
                started_at=r.started_at,
                completed_at=r.completed_at,
                released_at=r.released_at,
                cancelled_at=r.cancelled_at,
                cancellation_reason=r.cancellation_reason,
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
        )
    return res


@router.get("/dock-allocation-requests/pending", response_model=List[AllocationRequestResponse])
async def list_pending_allocation_requests(uow: UnitOfWork = Depends(get_uow)):
    await DockAllocationService.sync_pending_gate_entries(uow.session)
    query = (
        select(DockAllocationRequestModel)
        .options(selectinload(DockAllocationRequestModel.assigned_dock))
        .where(DockAllocationRequestModel.status.in_(["PENDING", "PENDING_ALLOCATION", "AWAITING_DOCK"]))
        .order_by(
            desc(DockAllocationRequestModel.priority == "URGENT"),
            desc(DockAllocationRequestModel.priority == "HIGH"),
            desc(DockAllocationRequestModel.security_approved_at),
        )
    )
    result = await uow.session.execute(query)
    reqs = result.scalars().all()

    from app.common.persistence.models import AsnModel
    from app.modules.gate.infrastructure.persistence.models import GateEntryModel
    ge_res = await uow.session.execute(select(GateEntryModel))
    ge_list = sorted(ge_res.scalars().all(), key=lambda entry: entry.created_at or datetime.min, reverse=True)
    asn_res = await uow.session.execute(select(AsnModel).options(selectinload(AsnModel.lines)))
    asn_by_id = {str(asn.id): asn for asn in asn_res.scalars().all()}
    ge_map_by_pass = {ge.gate_entry_number: ge for ge in ge_list if ge.gate_entry_number}
    ge_map_by_id = {str(ge.id): ge for ge in ge_list}
    ge_map_by_veh = {ge.vehicle_number: ge for ge in ge_list if ge.vehicle_number}

    res_list = []
    seen_gate_passes: set[str] = set()
    for r in reqs:
        ge = ge_map_by_pass.get(r.existing_gate_pass_id) or ge_map_by_id.get(r.existing_gate_pass_id) or ge_map_by_veh.get(r.vehicle_number)
        if ge is None or not ge.gate_entry_number:
            continue
        if ge.assigned_dock_id or (ge.status or "").upper() in {
            "DOCK_ASSIGNED",
            "MOVING_TO_DOCK",
            "AT_DOCK",
            "UNLOADING_IN_PROGRESS",
            "RECEIVING_COMPLETED",
            "GATE_EXIT_COMPLETED",
        }:
            # Preserve the historical allocation request, but do not expose
            # it as pending after its gate entry has progressed.
            continue
        canonical_gate_pass = ge.gate_entry_number
        if canonical_gate_pass in seen_gate_passes:
            continue
        seen_gate_passes.add(canonical_gate_pass)
        asn = asn_by_id.get(str(ge.asn_id)) if ge.asn_id else None

        mat_ref = r.material_reference
        if not mat_ref or mat_ref in ("General Material", "Material", "Inbound Goods"):
            if ge:
                mat_ref = ge.ocr_product_material or getattr(ge, "material_description", None) or (f"PO: {ge.po_number}" if ge.po_number else None)
        vendor_ref = r.vendor_reference
        if not vendor_ref or vendor_ref in ("Approved Vendor", "Vendor"):
            if ge and ge.ocr_supplier_name:
                vendor_ref = ge.ocr_supplier_name

        asn_lines = list(asn.lines) if asn else []
        if asn_lines:
            mat_ref = ", ".join(dict.fromkeys(line.material_name or line.item_code for line in asn_lines))
            quantity = sum((line.shipped_quantity or 0) for line in asn_lines)
            uoms = list(dict.fromkeys(line.uom for line in asn_lines if line.uom))
            uom = uoms[0] if len(uoms) == 1 else ("MIXED" if len(uoms) > 1 else None)
        else:
            quantity = r.quantity
            uom = None

        res_list.append(
            AllocationRequestResponse(
                id=r.id,
                existing_gate_pass_id=canonical_gate_pass,
                vendor_reference=vendor_ref,
                vehicle_number=r.vehicle_number,
                material_reference=mat_ref,
                material_description=r.material_description if (r.material_description and r.material_description not in ("Inbound Material Shipment", "General Material")) else mat_ref,
                quantity=quantity,
                uom=uom,
                security_approved_at=r.security_approved_at,
                priority=r.priority,
                status=r.status,
                assigned_dock_id=r.assigned_dock_id,
                assigned_dock_code=r.assigned_dock.dock_code if r.assigned_dock else None,
                assigned_by=r.assigned_by,
                assigned_at=r.assigned_at,
                arrived_at=r.arrived_at,
                started_at=r.started_at,
                completed_at=r.completed_at,
                released_at=r.released_at,
                cancelled_at=r.cancelled_at,
                cancellation_reason=r.cancellation_reason,
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
        )
    return res_list


async def _build_allocation_response(
    session: AsyncSession, r: DockAllocationRequestModel
) -> AllocationRequestResponse:
    dock_code = None
    assigned_warehouse_ref_id = getattr(r, "assigned_warehouse_ref_id", None)
    assigned_warehouse_code = getattr(r, "assigned_warehouse_code", None)
    assigned_warehouse_name = getattr(r, "assigned_warehouse_name", None)
    assigned_sm_id = getattr(r, "assigned_warehouse_operator_id", None)
    assigned_sm_user = getattr(r, "assigned_warehouse_operator_username", None)
    assigned_sm_name = getattr(r, "assigned_warehouse_operator_name", None)

    if r.assigned_dock_id:
        try:
            d = await session.get(DockMasterModel, r.assigned_dock_id)
            if d:
                dock_code = d.dock_code
                if not assigned_warehouse_ref_id and getattr(d, "warehouse_ref_id", None):
                    assigned_warehouse_ref_id = d.warehouse_ref_id
        except Exception:
            dock_code = None

    if not assigned_warehouse_ref_id or not assigned_sm_id:
        try:
            from app.modules.gate.infrastructure.persistence.models import GateEntryModel, DockAssignmentModel
            ge_conds = [
                GateEntryModel.gate_entry_number == r.existing_gate_pass_id,
                GateEntryModel.vehicle_number == r.vehicle_number,
            ]
            try:
                ge_conds.append(GateEntryModel.id == uuid.UUID(r.existing_gate_pass_id))
            except (ValueError, TypeError):
                pass
            ge_res = await session.execute(select(GateEntryModel).where(or_(*ge_conds)))
            ge_obj = ge_res.scalars().first()
            if ge_obj:
                da_res = await session.execute(
                    select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == ge_obj.id)
                )
                da = da_res.scalar_one_or_none()
                if da:
                    if not assigned_warehouse_ref_id and da.assigned_warehouse_ref_id:
                        assigned_warehouse_ref_id = da.assigned_warehouse_ref_id
                        assigned_warehouse_code = da.assigned_warehouse_code
                        assigned_warehouse_name = da.assigned_warehouse_name
                    if not assigned_sm_id and da.assigned_warehouse_operator_id:
                        assigned_sm_id = da.assigned_warehouse_operator_id
                        assigned_sm_user = da.assigned_warehouse_operator_username
                        assigned_sm_name = da.assigned_warehouse_operator_name
        except Exception:
            pass

    if assigned_warehouse_ref_id and (not assigned_warehouse_code or not assigned_warehouse_name):
        try:
            from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel
            st = await session.get(WarehouseModel, assigned_warehouse_ref_id)
            if st:
                assigned_warehouse_code = assigned_warehouse_code or st.warehouse_code
                assigned_warehouse_name = assigned_warehouse_name or st.warehouse_name
                if not assigned_sm_id and st.warehouse_operator_id:
                    assigned_sm_id = st.warehouse_operator_id
                    assigned_sm_name = st.warehouse_operator_name
        except Exception:
            pass

    return AllocationRequestResponse(
        id=r.id,
        existing_gate_pass_id=r.existing_gate_pass_id,
        vendor_reference=r.vendor_reference,
        vehicle_number=r.vehicle_number,
        material_reference=r.material_reference,
        material_description=r.material_description,
        quantity=r.quantity,
        security_approved_at=r.security_approved_at,
        priority=r.priority,
        status=r.status,
        assigned_dock_id=r.assigned_dock_id,
        assigned_dock_code=dock_code,
        assigned_warehouse_ref_id=assigned_warehouse_ref_id,
        assigned_warehouse_code=assigned_warehouse_code,
        assigned_warehouse_name=assigned_warehouse_name,
        assigned_warehouse_operator_id=assigned_sm_id,
        assigned_warehouse_operator_username=assigned_sm_user,
        assigned_warehouse_operator_name=assigned_sm_name,
        assigned_by=r.assigned_by,
        assigned_at=r.assigned_at,
        arrived_at=r.arrived_at,
        started_at=r.started_at,
        completed_at=r.completed_at,
        released_at=r.released_at,
        cancelled_at=r.cancelled_at,
        cancellation_reason=r.cancellation_reason,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


@router.post("/dock-allocation-requests/auto-create", response_model=AllocationRequestResponse, status_code=201)
@router.post("/dock-allocation-requests/auto", response_model=AllocationRequestResponse, status_code=status.HTTP_201_CREATED)
async def auto_create_allocation_request(
    req: AutoCreateAllocationRequest,
    uow: UnitOfWork = Depends(get_uow),
):
    created = await DockAllocationService.auto_create_allocation_request(
        session=uow.session,
        gate_pass_id=req.gate_pass_id,
        vehicle_number=req.vehicle_number,
        vendor_reference=req.vendor_reference,
        material_reference=req.material_reference,
        material_description=req.material_description,
        quantity=req.quantity,
        priority=req.priority,
    )
    return await _build_allocation_response(uow.session, created)


@router.post("/dock-allocations", response_model=AllocationRequestResponse)
async def allocate_dock(
    req: AllocateDockRequest,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
):
    allocated = await DockAllocationService.allocate_dock(
        session=uow.session,
        allocation_request_id=req.allocation_request_id,
        dock_id=req.dock_id,
        assigned_warehouse_ref_id=req.assigned_warehouse_ref_id,
        allocated_by=user.username,
        warehouse_operator_id=req.warehouse_operator_id,
        warehouse_operator_username=req.warehouse_operator_username,
        warehouse_operator_name=req.warehouse_operator_name,
    )
    return await _build_allocation_response(uow.session, allocated)


@router.patch("/dock-allocations/{id}/reassign", response_model=AllocationRequestResponse)
async def reassign_dock(
    id: uuid.UUID,
    req: ReassignDockRequest,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
):
    reassigned = await DockAllocationService.reassign_dock(
        session=uow.session,
        allocation_request_id=id,
        new_dock_id=req.new_dock_id,
        reassigned_by=user.username,
        reason=req.reason,
    )
    return await _build_allocation_response(uow.session, reassigned)


@router.post("/dock-allocations/{id}/arrive", response_model=AllocationRequestResponse)
async def mark_vehicle_arrived(
    id: uuid.UUID,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
):
    arrived = await DockAllocationService.mark_vehicle_arrived(
        session=uow.session,
        allocation_request_id=id,
        performed_by=user.username,
    )
    return await _build_allocation_response(uow.session, arrived)


@router.post("/dock-allocations/{id}/start-receiving", response_model=AllocationRequestResponse)
async def start_receiving(
    id: uuid.UUID,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
):
    req = await DockAllocationService.start_receiving(uow.session, id, user.username)
    return await _build_allocation_response(uow.session, req)


@router.post("/dock-allocations/{id}/complete", response_model=AllocationRequestResponse)
async def complete_receiving(
    id: str,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
):
    parsed_uuid = None
    try:
        parsed_uuid = uuid.UUID(str(id).strip())
    except (ValueError, TypeError):
        parsed_uuid = None

    target_id = parsed_uuid
    if not target_id:
        clean_code = str(id).strip().replace("Dock ", "").replace("dock ", "").strip()
        dock_match = (await uow.session.execute(
            select(DockMasterModel).where(
                (DockMasterModel.dock_code.ilike(clean_code)) |
                (DockMasterModel.dock_name.ilike(clean_code))
            )
        )).scalars().first()
        if dock_match:
            alloc = (await uow.session.execute(
                select(DockAllocationRequestModel)
                .where(DockAllocationRequestModel.assigned_dock_id == dock_match.id)
                .order_by(desc(DockAllocationRequestModel.created_at))
            )).scalars().first()
            if alloc:
                target_id = alloc.id
    if not target_id:
        target_id = parsed_uuid or uuid.uuid4()

    req = await DockAllocationService.complete_receiving(uow.session, target_id, user.username)
    return await _build_allocation_response(uow.session, req)


@router.post("/dock-allocations/{id}/release", response_model=AllocationRequestResponse)
async def release_dock(
    id: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    uow: UnitOfWork = Depends(get_uow),
):
    # 1. Unauthenticated check (Case 5)
    auth_hdr = request.headers.get("Authorization") or request.headers.get("authorization")
    roles_hdr = request.headers.get("X-User-Roles") or request.headers.get("x-user-roles")
    if credentials is None and not auth_hdr and not roles_hdr:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token or authentication credentials",
        )

    user: CurrentUser = await get_current_user(request, credentials)
    roles_upper = {r.upper() for r in (user.roles or [])}
    is_grn_authorized = bool(roles_upper.intersection({"GRN", "GRN_MANAGER", "RECEIVING", "OPERATIONS", "OPERATIONS_MANAGER"}))

    # 2. Reject Warehouse Manager explicitly (Case 3)
    if not is_grn_authorized and ("WAREHOUSE_MANAGER" in roles_upper or "WAREHOUSE" in roles_upper):
        if "WAREHOUSE_OPERATOR" not in roles_upper and "WAREHOUSE_OPERATOR" not in roles_upper:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Warehouse Manager is not authorized to release docks. Dock release must be performed by the assigned Warehouse Operator.",
            )

    # 3. Require Warehouse Operator role (Case 4)
    is_warehouse_operator = "WAREHOUSE_OPERATOR" in roles_upper or "WAREHOUSE_OPERATOR" in roles_upper
    if not is_warehouse_operator and not is_grn_authorized:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Dock release must be performed by the assigned Warehouse Operator.",
        )

    # 4. Resolve Warehouse Operator's assigned warehouse(s) (Case 6)
    user_warehouse_ref_ids, user_warehouse_codes = await _get_warehouse_user_context(user, uow)
    if not is_grn_authorized and not user_warehouse_ref_ids and not user_warehouse_codes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Warehouse Operator does not have an assigned warehouse.",
        )

    # 5. Look up allocation request & dock
    parsed_uuid = None
    try:
        parsed_uuid = uuid.UUID(str(id).strip())
    except (ValueError, TypeError):
        parsed_uuid = None

    req = None
    if parsed_uuid:
        req_res = await uow.session.execute(
            select(DockAllocationRequestModel)
            .where(
                (DockAllocationRequestModel.id == parsed_uuid) |
                (DockAllocationRequestModel.assigned_dock_id == parsed_uuid)
            )
            .order_by(desc(DockAllocationRequestModel.created_at))
            .with_for_update()
        )
        req = req_res.scalars().first()

    if not req:
        clean_str = str(id).strip()
        clean_code = clean_str.replace("Dock ", "").replace("dock ", "").strip()
        dock_match = (await uow.session.execute(
            select(DockMasterModel).where(
                (DockMasterModel.dock_code.ilike(clean_code)) |
                (DockMasterModel.dock_name.ilike(clean_code))
            )
        )).scalars().first()
        if dock_match:
            req_res = await uow.session.execute(
                select(DockAllocationRequestModel)
                .where(DockAllocationRequestModel.assigned_dock_id == dock_match.id)
                .order_by(desc(DockAllocationRequestModel.created_at))
                .with_for_update()
            )
            req = req_res.scalars().first()

    if not req:
        clean_str = str(id).strip()
        req_res = await uow.session.execute(
            select(DockAllocationRequestModel)
            .where(
                (DockAllocationRequestModel.existing_gate_pass_id.ilike(clean_str)) |
                (DockAllocationRequestModel.vehicle_number.ilike(clean_str))
            )
            .order_by(desc(DockAllocationRequestModel.created_at))
            .with_for_update()
        )
        req = req_res.scalars().first()

    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allocation request or dock not found")

    target_dock_id = req.assigned_dock_id or (parsed_uuid if parsed_uuid else None)
    dock = None
    if target_dock_id:
        dock_res = await uow.session.execute(
            select(DockMasterModel).where(DockMasterModel.id == target_dock_id).with_for_update()
        )
        dock = dock_res.scalar_one_or_none()

    # 6. Determine the warehouse associated with this dock / dock allocation
    dock_warehouse_ref_ids: Set[uuid.UUID] = set()
    dock_warehouse_codes: Set[str] = set()

    # From allocation request
    if req.assigned_warehouse_ref_id:
        dock_warehouse_ref_ids.add(req.assigned_warehouse_ref_id)
    if req.assigned_warehouse_code:
        dock_warehouse_codes.add(req.assigned_warehouse_code.strip().upper())

    # From Gate Entry & DockAssignmentModel
    if req.existing_gate_pass_id or req.vehicle_number:
        ge_conds = [
            GateEntryModel.gate_entry_number == req.existing_gate_pass_id,
            GateEntryModel.vehicle_number == req.vehicle_number,
        ]
        try:
            ge_conds.append(GateEntryModel.id == uuid.UUID(req.existing_gate_pass_id))
        except (ValueError, TypeError):
            pass
        ge_res = await uow.session.execute(select(GateEntryModel).where(or_(*ge_conds)))
        ge_obj = ge_res.scalars().first()
        if ge_obj:
            da_res = await uow.session.execute(
                select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == ge_obj.id)
            )
            da = da_res.scalar_one_or_none()
            if da:
                if da.assigned_warehouse_ref_id:
                    dock_warehouse_ref_ids.add(da.assigned_warehouse_ref_id)
                if da.assigned_warehouse_code:
                    dock_warehouse_codes.add(da.assigned_warehouse_code.strip().upper())

    # From dock itself or DockAssignmentModel by dock code
    if dock:
        if getattr(dock, "warehouse_ref_id", None):
            dock_warehouse_ref_ids.add(dock.warehouse_ref_id)
        da_dock_res = await uow.session.execute(
            select(DockAssignmentModel)
            .where(DockAssignmentModel.dock_number == dock.dock_code)
            .order_by(desc(DockAssignmentModel.assigned_at))
        )
        da_dock = da_dock_res.scalars().first()
        if da_dock:
            if da_dock.assigned_warehouse_ref_id:
                dock_warehouse_ref_ids.add(da_dock.assigned_warehouse_ref_id)
            if da_dock.assigned_warehouse_code:
                dock_warehouse_codes.add(da_dock.assigned_warehouse_code.strip().upper())

    # Synchronize codes for warehouse IDs
    if dock_warehouse_ref_ids:
        s_res = await uow.session.execute(select(WarehouseModel).where(WarehouseModel.id.in_(dock_warehouse_ref_ids)))
        for s in s_res.scalars().all():
            if s.warehouse_code:
                dock_warehouse_codes.add(s.warehouse_code.strip().upper())

    # 7. Check authorization: logged_in_user matches assigned Warehouse Operator or logged_in_user.warehouse == dock.warehouse
    user_identifiers = {
        str(user.username).strip().lower() if user.username else "",
        str(user.subject).strip().lower() if user.subject else "",
        str(user.raw_claims.get("employee_id") or "").strip().lower(),
        str(user.raw_claims.get("sub") or "").strip().lower(),
        str(user.raw_claims.get("username") or "").strip().lower(),
    }
    user_identifiers.discard("")

    sm_direct_match = False
    if req.assigned_warehouse_operator_username and req.assigned_warehouse_operator_username.strip().lower() in user_identifiers:
        sm_direct_match = True
    if req.assigned_warehouse_operator_id and str(req.assigned_warehouse_operator_id).strip().lower() in user_identifiers:
        sm_direct_match = True

    user_warehouse_str_ids = {str(sid).lower() for sid in user_warehouse_ref_ids}
    user_warehouse_codes_upper = {str(sc).strip().upper() for sc in user_warehouse_codes}

    dock_warehouse_str_ids = {str(sid).lower() for sid in dock_warehouse_ref_ids}
    dock_warehouse_codes_upper = {str(sc).strip().upper() for sc in dock_warehouse_codes}

    is_warehouse_authorized = bool(
        (dock_warehouse_str_ids & user_warehouse_str_ids) or
        (dock_warehouse_codes_upper & user_warehouse_codes_upper)
    )

    if not is_grn_authorized and not sm_direct_match and not is_warehouse_authorized:
        if req.assigned_warehouse_operator_name or req.assigned_warehouse_operator_username:
            target_sm = req.assigned_warehouse_operator_name or req.assigned_warehouse_operator_username
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: Dock is assigned to Warehouse Operator '{target_sm}'. Only the assigned Warehouse Operator can release this dock.",
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You can only release docks assigned to your Warehouse.",
        )

    # 8. Release the dock
    if req.status != "COMPLETED":
        req.status = "COMPLETED"
        await uow.session.flush()
    released = await DockAllocationService.release_dock(uow.session, req.id, user.username)
    return await _build_allocation_response(uow.session, released)


@router.post("/dock-allocations/{id}/cancel", response_model=AllocationRequestResponse)
async def cancel_request(
    id: uuid.UUID,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
):
    req = await DockAllocationService.cancel_request(uow.session, id, user.username)
    return await _build_allocation_response(uow.session, req)


@router.get("/dock-history", response_model=List[DockAllocationHistoryResponse])
async def list_dock_history(uow: UnitOfWork = Depends(get_uow)):
    result = await uow.session.execute(
        select(DockAllocationHistoryModel)
        .order_by(desc(DockAllocationHistoryModel.performed_at))
        .limit(100)
    )
    histories = result.scalars().all()
    req_ids = [h.allocation_request_id for h in histories]
    req_map = {}
    if req_ids:
        r_res = await uow.session.execute(
            select(DockAllocationRequestModel).where(DockAllocationRequestModel.id.in_(req_ids))
        )
        req_map = {r.id: r for r in r_res.scalars().all()}

    dock_ids = [h.dock_id for h in histories if h.dock_id]
    dock_map = {}
    if dock_ids:
        d_res = await uow.session.execute(select(DockMasterModel).where(DockMasterModel.id.in_(dock_ids)))
        dock_map = {d.id: d.dock_code for d in d_res.scalars().all()}

    res = []
    for h in histories:
        r = req_map.get(h.allocation_request_id)
        res.append(
            DockAllocationHistoryResponse(
                id=h.id,
                allocation_request_id=h.allocation_request_id,
                existing_gate_pass_id=r.existing_gate_pass_id if r else None,
                vehicle_number=r.vehicle_number if r else None,
                vendor_reference=r.vendor_reference if r else None,
                dock_code=dock_map.get(h.dock_id),
                action=h.action,
                previous_status=h.previous_status,
                new_status=h.new_status,
                performed_by=h.performed_by,
                performed_at=h.performed_at,
                remarks=h.remarks,
            )
        )
    return res
