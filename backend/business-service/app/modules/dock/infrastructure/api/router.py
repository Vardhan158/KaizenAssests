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
from app.modules.store.infrastructure.persistence.models import StoreModel, StoreManagerUserModel
from app.modules.gate.infrastructure.persistence.models import GateEntryModel, DockAssignmentModel

router = APIRouter(prefix="/api/v1/warehouse", tags=["dock-management"])


async def _get_store_user_context(user: CurrentUser, uow: UnitOfWork) -> Tuple[Set[uuid.UUID], Set[str]]:
    """Returns (store_ids, store_codes) authorized for the current user."""
    store_ids: Set[uuid.UUID] = set()
    store_codes: Set[str] = set()

    raw_id = getattr(user, "store_id", None) or (user.raw_claims.get("store_id") if user.raw_claims else None)
    if raw_id:
        try:
            store_ids.add(uuid.UUID(str(raw_id)))
        except (ValueError, TypeError):
            pass

    raw_code = getattr(user, "store_code", None) or (user.raw_claims.get("store_code") if user.raw_claims else None)
    if raw_code:
        store_codes.add(str(raw_code).strip().upper())

    # Collect all possible identifier strings for this user
    identifiers = {
        str(user.username).strip().lower() if user.username else "",
        str(user.subject).strip().lower() if user.subject else "",
        str(user.raw_claims.get("employee_id") or "").strip().lower() if user.raw_claims else "",
        str(user.raw_claims.get("username") or "").strip().lower() if user.raw_claims else "",
        str(user.raw_claims.get("sub") or "").strip().lower() if user.raw_claims else "",
    }
    identifiers.discard("")

    for emp_id in identifiers:
        st_res = await uow.session.execute(
            select(StoreManagerUserModel).where(
                or_(
                    func.lower(StoreManagerUserModel.employee_id) == emp_id,
                    func.lower(StoreManagerUserModel.username) == emp_id,
                    func.lower(StoreManagerUserModel.full_name) == emp_id,
                    func.lower(StoreManagerUserModel.email) == emp_id,
                )
            )
        )
        sm_users = st_res.scalars().all()
        for sm in sm_users:
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
    dock_ids = [d.id for d in docks]
    alloc_map = await DockAllocationService.get_active_allocations_for_docks(uow.session, dock_ids)

    from app.modules.gate.infrastructure.persistence.models import GateEntryModel, DockAssignmentModel
    from app.modules.store.infrastructure.persistence.models import StoreModel

    ge_res = await uow.session.execute(select(GateEntryModel))
    ge_list = ge_res.scalars().all()
    ge_map_by_pass = {ge.gate_entry_number: ge for ge in ge_list if ge.gate_entry_number}
    ge_map_by_id = {str(ge.id): ge for ge in ge_list}
    ge_map_by_veh = {ge.vehicle_number: ge for ge in ge_list if ge.vehicle_number}

    da_res = await uow.session.execute(select(DockAssignmentModel))
    da_list = da_res.scalars().all()
    da_map_by_ge = {da.gate_entry_id: da for da in da_list if da.gate_entry_id}
    da_map_by_dock = {da.dock_number: da for da in da_list if da.dock_number}

    stores_res = await uow.session.execute(select(StoreModel))
    stores_list = stores_res.scalars().all()
    store_by_id = {s.id: s for s in stores_list}
    store_by_code = {s.store_code.strip().upper(): s for s in stores_list if s.store_code}

    res = []
    for d in docks:
        dock_store = store_by_id.get(d.store_id) if getattr(d, "store_id", None) else None

        d_store_id = dock_store.id if dock_store else getattr(d, "store_id", None)
        d_store_code = dock_store.store_code if dock_store else None
        d_store_name = dock_store.store_name if dock_store else None

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

            if getattr(alloc_req, "assigned_store_id", None):
                assigned_sid = alloc_req.assigned_store_id
                assigned_scode = getattr(alloc_req, "assigned_store_code", None)
                assigned_sname = getattr(alloc_req, "assigned_store_name", None)
            elif da and da.assigned_store_id:
                assigned_sid = da.assigned_store_id
                assigned_scode = da.assigned_store_code
                assigned_sname = da.assigned_store_name

            if assigned_sid and not assigned_scode and assigned_sid in store_by_id:
                st = store_by_id[assigned_sid]
                assigned_scode = st.store_code
                assigned_sname = st.store_name
            if assigned_scode and not assigned_sid and assigned_scode.strip().upper() in store_by_code:
                st = store_by_code[assigned_scode.strip().upper()]
                assigned_sid = st.id
                assigned_sname = st.store_name

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
                existing_gate_pass_id=alloc_req.existing_gate_pass_id,
                vendor_reference=vendor_ref,
                vehicle_number=alloc_req.vehicle_number,
                material_reference=mat_ref,
                material_description=alloc_req.material_description if (alloc_req.material_description and alloc_req.material_description not in ("Inbound Material Shipment", "General Material")) else mat_ref,
                quantity=alloc_req.quantity,
                security_approved_at=alloc_req.security_approved_at,
                priority=alloc_req.priority,
                status=alloc_req.status,
                assigned_dock_id=alloc_req.assigned_dock_id,
                assigned_dock_code=d.dock_code,
                assigned_store_id=assigned_sid,
                assigned_store_code=assigned_scode,
                assigned_store_name=assigned_sname,
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
        res.append(
            DockMasterResponse(
                id=d.id,
                dock_code=d.dock_code,
                dock_name=d.dock_name,
                dock_type=d.dock_type,
                location=d.location,
                description=d.description,
                status=d.status,
                is_active=d.is_active,
                store_id=d_store_id or assigned_sid,
                store_code=d_store_code or assigned_scode,
                store_name=d_store_name or assigned_sname,
                assigned_store_id=assigned_sid,
                assigned_store_code=assigned_scode,
                assigned_store_name=assigned_sname,
                created_at=d.created_at,
                updated_at=d.updated_at,
                current_allocation=current_alloc,
            )
        )
    user_roles = [r.upper() for r in getattr(user, "roles", [])]
    is_warehouse_or_admin = any(
        r in user_roles
        for r in ("ADMIN", "SUPERUSER", "WAREHOUSE_MANAGER", "WAREHOUSE", "GATE_SECURITY", "PROCUREMENT", "FINANCE")
    )
    is_store_user = any(r in user_roles for r in ("STORE_MANAGER", "STORE_KEEPER", "STORE"))

    if is_store_user and not is_warehouse_or_admin:
        user_store_ids, user_store_codes = await _get_store_user_context(user, uow)
        user_store_str_ids = {str(sid).lower() for sid in user_store_ids}
        user_store_codes_upper = {str(sc).strip().upper() for sc in user_store_codes}

        filtered_res = []
        for d_resp in res:
            # Store Manager must ONLY see docks that have an active allocation assigned to their store
            alloc = d_resp.current_allocation
            if alloc and alloc.status in ("OCCUPIED", "RESERVED", "ALLOCATED", "DOCK_ASSIGNED"):
                alloc_sid = str(alloc.assigned_store_id).lower() if alloc.assigned_store_id else ""
                alloc_scode = str(alloc.assigned_store_code or "").strip().upper()
                if (alloc_sid and alloc_sid in user_store_str_ids) or (alloc_scode and alloc_scode in user_store_codes_upper):
                    filtered_res.append(d_resp)
                    continue

            # Some dock allocations are represented directly on the dock
            # response while the allocation request is being synchronized.
            # Keep those visible to the assigned store too.
            direct_sid = str(d_resp.assigned_store_id).lower() if d_resp.assigned_store_id else ""
            direct_scode = str(d_resp.assigned_store_code or "").strip().upper()
            if (
                (direct_sid and direct_sid in user_store_str_ids)
                or (direct_scode and direct_scode in user_store_codes_upper)
            ) and str(d_resp.status or "").upper() in ("OCCUPIED", "RESERVED", "ALLOCATED", "DOCK_ASSIGNED"):
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
    import re
    
    match = re.match(r"^([A-Z]+)-?(\d+)$", dock_code)
    prefix = ""
    num = 0
    if match:
        prefix = match.group(1)
        num = int(match.group(2))
        
    while True:
        existing = await uow.session.scalar(select(DockMasterModel).where(DockMasterModel.dock_code == dock_code))
        if not existing:
            break
        if prefix:
            num += 1
            dock_code = f"{prefix}-{num:02d}"
        else:
            raise HTTPException(status_code=409, detail=f"Dock code '{dock_code}' already exists")
    dock = DockMasterModel(
        dock_code=dock_code,
        dock_name=req.dock_name.strip(),
        dock_type=req.dock_type.strip().upper(),
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
        for r in ("ADMIN", "SUPERUSER", "WAREHOUSE_MANAGER", "WAREHOUSE", "GATE_SECURITY", "PROCUREMENT", "FINANCE")
    )
    is_store_user = any(r in user_roles for r in ("STORE_MANAGER", "STORE_KEEPER", "STORE"))

    if is_store_user and not is_warehouse_or_admin:
        user_store_ids, user_store_codes = await _get_store_user_context(user, uow)
        match = False
        if alloc_req:
            if alloc_req.assigned_store_id and alloc_req.assigned_store_id in user_store_ids:
                match = True
            elif alloc_req.assigned_store_code and alloc_req.assigned_store_code.strip().upper() in user_store_codes:
                match = True
        elif dock.store_id and dock.store_id in user_store_ids and dock.status in ("OCCUPIED", "RESERVED"):
            match = True

        if not match:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You are only authorized to access docks allocated to your store.",
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
            existing_gate_pass_id=alloc_req.existing_gate_pass_id,
            vendor_reference=vendor_ref,
            vehicle_number=alloc_req.vehicle_number,
            material_reference=mat_ref,
            material_description=alloc_req.material_description if (alloc_req.material_description and alloc_req.material_description not in ("Inbound Material Shipment", "General Material")) else mat_ref,
            quantity=alloc_req.quantity,
            security_approved_at=alloc_req.security_approved_at,
            priority=alloc_req.priority,
            status=alloc_req.status,
            assigned_dock_id=alloc_req.assigned_dock_id,
            assigned_dock_code=dock.dock_code,
            assigned_store_id=alloc_req.assigned_store_id,
            assigned_store_code=alloc_req.assigned_store_code,
            assigned_store_name=alloc_req.assigned_store_name,
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
    return await get_dock_by_id(dock.id, uow)


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
    return await get_dock_by_id(dock_id, uow)


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
    res = []
    for r in reqs:
        res.append(
            AllocationRequestResponse(
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

    from app.modules.gate.infrastructure.persistence.models import GateEntryModel
    ge_res = await uow.session.execute(select(GateEntryModel))
    ge_list = ge_res.scalars().all()
    ge_map_by_pass = {ge.gate_entry_number: ge for ge in ge_list if ge.gate_entry_number}
    ge_map_by_id = {str(ge.id): ge for ge in ge_list}
    ge_map_by_veh = {ge.vehicle_number: ge for ge in ge_list if ge.vehicle_number}

    res_list = []
    for r in reqs:
        ge = ge_map_by_pass.get(r.existing_gate_pass_id) or ge_map_by_id.get(r.existing_gate_pass_id) or ge_map_by_veh.get(r.vehicle_number)

        mat_ref = r.material_reference
        if not mat_ref or mat_ref in ("General Material", "Material", "Inbound Goods"):
            if ge:
                mat_ref = ge.ocr_product_material or getattr(ge, "material_description", None) or (f"PO: {ge.po_number}" if ge.po_number else None)
        vendor_ref = r.vendor_reference
        if not vendor_ref or vendor_ref in ("Approved Vendor", "Vendor"):
            if ge and ge.ocr_supplier_name:
                vendor_ref = ge.ocr_supplier_name

        res_list.append(
            AllocationRequestResponse(
                id=r.id,
                existing_gate_pass_id=r.existing_gate_pass_id,
                vendor_reference=vendor_ref,
                vehicle_number=r.vehicle_number,
                material_reference=mat_ref,
                material_description=r.material_description if (r.material_description and r.material_description not in ("Inbound Material Shipment", "General Material")) else mat_ref,
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
    return res_list


async def _build_allocation_response(
    session: AsyncSession, r: DockAllocationRequestModel
) -> AllocationRequestResponse:
    dock_code = None
    assigned_store_id = getattr(r, "assigned_store_id", None)
    assigned_store_code = getattr(r, "assigned_store_code", None)
    assigned_store_name = getattr(r, "assigned_store_name", None)
    assigned_sm_id = getattr(r, "assigned_store_manager_id", None)
    assigned_sm_user = getattr(r, "assigned_store_manager_username", None)
    assigned_sm_name = getattr(r, "assigned_store_manager_name", None)

    if r.assigned_dock_id:
        try:
            d = await session.get(DockMasterModel, r.assigned_dock_id)
            if d:
                dock_code = d.dock_code
                if not assigned_store_id and getattr(d, "store_id", None):
                    assigned_store_id = d.store_id
        except Exception:
            dock_code = None

    if not assigned_store_id or not assigned_sm_id:
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
                    if not assigned_store_id and da.assigned_store_id:
                        assigned_store_id = da.assigned_store_id
                        assigned_store_code = da.assigned_store_code
                        assigned_store_name = da.assigned_store_name
                    if not assigned_sm_id and da.assigned_store_manager_id:
                        assigned_sm_id = da.assigned_store_manager_id
                        assigned_sm_user = da.assigned_store_manager_username
                        assigned_sm_name = da.assigned_store_manager_name
        except Exception:
            pass

    if assigned_store_id and (not assigned_store_code or not assigned_store_name):
        try:
            from app.modules.store.infrastructure.persistence.models import StoreModel
            st = await session.get(StoreModel, assigned_store_id)
            if st:
                assigned_store_code = assigned_store_code or st.store_code
                assigned_store_name = assigned_store_name or st.store_name
                if not assigned_sm_id and st.store_manager_id:
                    assigned_sm_id = st.store_manager_id
                    assigned_sm_name = st.store_manager_name
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
        assigned_store_id=assigned_store_id,
        assigned_store_code=assigned_store_code,
        assigned_store_name=assigned_store_name,
        assigned_store_manager_id=assigned_sm_id,
        assigned_store_manager_username=assigned_sm_user,
        assigned_store_manager_name=assigned_sm_name,
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
        assigned_store_id=req.assigned_store_id,
        allocated_by=user.username,
        store_manager_id=req.store_manager_id,
        store_manager_username=req.store_manager_username,
        store_manager_name=req.store_manager_name,
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
    id: uuid.UUID,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
):
    req = await DockAllocationService.complete_receiving(uow.session, id, user.username)
    return await _build_allocation_response(uow.session, req)


@router.post("/dock-allocations/{id}/release", response_model=AllocationRequestResponse)
async def release_dock(
    id: uuid.UUID,
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

    # 2. Reject Warehouse Manager explicitly (Case 3)
    if "WAREHOUSE_MANAGER" in roles_upper or "WAREHOUSE" in roles_upper:
        if "STORE_MANAGER" not in roles_upper and "STORE_KEEPER" not in roles_upper:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Warehouse Manager is not authorized to release docks. Dock release must be performed by the assigned Store Manager.",
            )

    # 3. Require Store Manager role (Case 4)
    is_store_manager = "STORE_MANAGER" in roles_upper or "STORE_KEEPER" in roles_upper
    if not is_store_manager:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Dock release must be performed by the assigned Store Manager.",
        )

    # 4. Resolve Store Manager's assigned store(s) (Case 6)
    user_store_ids, user_store_codes = await _get_store_user_context(user, uow)
    if not user_store_ids and not user_store_codes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Store Manager does not have an assigned store.",
        )

    # 5. Look up allocation request & dock
    req_res = await uow.session.execute(
        select(DockAllocationRequestModel)
        .where(
            (DockAllocationRequestModel.id == id) |
            (DockAllocationRequestModel.assigned_dock_id == id)
        )
        .order_by(desc(DockAllocationRequestModel.created_at))
        .with_for_update()
    )
    req = req_res.scalars().first()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allocation request or dock not found")

    target_dock_id = req.assigned_dock_id or id
    dock_res = await uow.session.execute(
        select(DockMasterModel).where(DockMasterModel.id == target_dock_id).with_for_update()
    )
    dock = dock_res.scalar_one_or_none()

    # 6. Determine the store associated with this dock / dock allocation
    dock_store_ids: Set[uuid.UUID] = set()
    dock_store_codes: Set[str] = set()

    # From allocation request
    if req.assigned_store_id:
        dock_store_ids.add(req.assigned_store_id)
    if req.assigned_store_code:
        dock_store_codes.add(req.assigned_store_code.strip().upper())

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
                if da.assigned_store_id:
                    dock_store_ids.add(da.assigned_store_id)
                if da.assigned_store_code:
                    dock_store_codes.add(da.assigned_store_code.strip().upper())

    # From dock itself or DockAssignmentModel by dock code
    if dock:
        if getattr(dock, "store_id", None):
            dock_store_ids.add(dock.store_id)
        da_dock_res = await uow.session.execute(
            select(DockAssignmentModel)
            .where(DockAssignmentModel.dock_number == dock.dock_code)
            .order_by(desc(DockAssignmentModel.assigned_at))
        )
        da_dock = da_dock_res.scalars().first()
        if da_dock:
            if da_dock.assigned_store_id:
                dock_store_ids.add(da_dock.assigned_store_id)
            if da_dock.assigned_store_code:
                dock_store_codes.add(da_dock.assigned_store_code.strip().upper())

    # Synchronize codes for store IDs
    if dock_store_ids:
        s_res = await uow.session.execute(select(StoreModel).where(StoreModel.id.in_(dock_store_ids)))
        for s in s_res.scalars().all():
            if s.store_code:
                dock_store_codes.add(s.store_code.strip().upper())

    # 7. Check authorization: logged_in_user matches assigned Store Manager or logged_in_user.store == dock.store
    user_identifiers = {
        str(user.username).strip().lower() if user.username else "",
        str(user.subject).strip().lower() if user.subject else "",
        str(user.raw_claims.get("employee_id") or "").strip().lower(),
        str(user.raw_claims.get("sub") or "").strip().lower(),
        str(user.raw_claims.get("username") or "").strip().lower(),
    }
    user_identifiers.discard("")

    sm_direct_match = False
    if req.assigned_store_manager_username and req.assigned_store_manager_username.strip().lower() in user_identifiers:
        sm_direct_match = True
    if req.assigned_store_manager_id and str(req.assigned_store_manager_id).strip().lower() in user_identifiers:
        sm_direct_match = True

    user_store_str_ids = {str(sid).lower() for sid in user_store_ids}
    user_store_codes_upper = {str(sc).strip().upper() for sc in user_store_codes}

    dock_store_str_ids = {str(sid).lower() for sid in dock_store_ids}
    dock_store_codes_upper = {str(sc).strip().upper() for sc in dock_store_codes}

    is_store_authorized = bool(
        (dock_store_str_ids & user_store_str_ids) or
        (dock_store_codes_upper & user_store_codes_upper)
    )

    if not sm_direct_match and not is_store_authorized:
        if req.assigned_store_manager_name or req.assigned_store_manager_username:
            target_sm = req.assigned_store_manager_name or req.assigned_store_manager_username
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: Dock is assigned to Store Manager '{target_sm}'. Only the assigned Store Manager can release this dock.",
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You can only release docks assigned to your Store.",
        )

    # 8. Release the dock
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
