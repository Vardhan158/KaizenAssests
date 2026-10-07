"""
FastAPI router for Store Master, Store Zones, Store Bins, and real Store Manager accounts.
Provides automatic sequential Store, Zone & Bin Code generation, Store -> Zone -> Bin hierarchy,
Store Manager User provisioning, Bin QR codes, and strict IDOR protection.
"""
from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database.session import UnitOfWork, get_uow
from app.logging.logger import get_logger
from app.modules.store.infrastructure.api.schemas import (
    BinCreate,
    BinQRResponse,
    BinResponse,
    BinScanLookupRequest,
    BinStatusUpdate,
    BinUpdate,
    StoreCreate,
    StoreDashboardKPIs,
    StoreDashboardMetricsResponse,
    StoreInventoryItem,
    StoreMovementActivity,
    StoreAssemblyReservationItem,
    StoreManagerAssign,
    StoreManagerCreate,
    StoreManagerOption,
    StoreManagerResponse,
    StoreManagerStatusUpdate,
    StoreManagerUpdate,
    StoreManagerUserResponse,
    StoreResponse,
    StoreStatusUpdate,
    StoreUpdate,
    StoreWithZonesResponse,
    ZoneCreate,
    ZoneQRResponse,
    ZoneResponse,
    ZoneScanLookupRequest,
    ZoneStatusUpdate,
    ZoneUpdate,
    ZoneWithBinsResponse,
)
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyStockReservationModel,
    InventoryLocationBalanceModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreBinModel,
    StoreManagerUserModel,
    StoreModel,
    StoreZoneModel,
)
from app.security.dependencies import CurrentUser, get_current_user

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1/stores", tags=["store-master"])
zone_router = APIRouter(prefix="/api/v1/zones", tags=["store-zones"])
bin_router = APIRouter(prefix="/api/v1/bins", tags=["store-bins"])


def _is_warehouse_or_admin(user: CurrentUser) -> bool:
    """Check if the user has global warehouse/admin privileges."""
    roles = {r.upper() for r in (user.roles or [])}
    return bool(roles.intersection({"ADMIN", "WAREHOUSE", "WAREHOUSE_MANAGER", "PROCUREMENT", "SUPERUSER"}))


def _to_store_response(store: StoreModel, zones_count: int = 0, bins_count: int = 0) -> StoreResponse:
    return StoreResponse(
        id=str(store.id),
        store_code=store.store_code,
        store_name=store.store_name,
        description=store.description,
        warehouse_id=store.warehouse_id,
        store_manager_id=store.store_manager_id,
        store_manager_name=store.store_manager_name,
        status=store.status,
        store_type=getattr(store, "store_type", "RAW_MATERIAL") or "RAW_MATERIAL",
        created_at=store.created_at,
        updated_at=store.updated_at,
        zones_count=zones_count,
        bins_count=bins_count,
    )



def _to_zone_response(zone: StoreZoneModel, bins_count: int = 0) -> ZoneResponse:
    return ZoneResponse(
        id=str(zone.id),
        store_id=str(zone.store_id),
        zone_code=zone.zone_code,
        zone_name=zone.zone_name,
        description=zone.description,
        status=zone.status,
        created_at=zone.created_at,
        updated_at=zone.updated_at,
        bins_count=bins_count,
    )


def _to_bin_response(bin_obj: StoreBinModel) -> BinResponse:
    return BinResponse(
        id=str(bin_obj.id),
        store_id=str(bin_obj.store_id),
        zone_id=str(bin_obj.zone_id),
        bin_code=bin_obj.bin_code,
        bin_name=bin_obj.bin_name,
        rack=bin_obj.rack,
        shelf=bin_obj.shelf,
        capacity=bin_obj.capacity,
        occupied_quantity=bin_obj.occupied_quantity,
        status=bin_obj.status,
        created_at=bin_obj.created_at,
        updated_at=bin_obj.updated_at,
    )


def _to_manager_response(mgr: StoreManagerUserModel, store: Optional[StoreModel] = None) -> StoreManagerUserResponse:
    return StoreManagerUserResponse(
        id=str(mgr.id),
        employee_id=mgr.employee_id,
        username=mgr.username,
        full_name=mgr.full_name,
        email=mgr.email,
        role=mgr.role,
        applications=mgr.applications or [],
        store_id=str(mgr.store_id),
        store_code=store.store_code if store else getattr(mgr.store, "store_code", None),
        store_name=store.store_name if store else getattr(mgr.store, "store_name", None),
        manager_id=mgr.employee_id,
        manager_name=mgr.full_name,
        status=mgr.status,
        created_at=mgr.created_at,
        updated_at=mgr.updated_at,
    )


def _store_manager_matches(store: StoreModel, user: CurrentUser) -> bool:
    """Check if a store belongs to the authenticated store manager."""
    identifiers = {
        str(user.subject or "").strip().lower(),
        str(user.username or "").strip().lower(),
    }
    identifiers.discard("")
    if user.raw_claims:
        if "store_id" in user.raw_claims and user.raw_claims["store_id"]:
            if str(store.id).lower() == str(user.raw_claims["store_id"]).lower():
                return True
        if "store_code" in user.raw_claims and user.raw_claims["store_code"]:
            if store.store_code.lower() == str(user.raw_claims["store_code"]).lower():
                return True
        if "employee_id" in user.raw_claims and user.raw_claims["employee_id"]:
            identifiers.add(str(user.raw_claims["employee_id"]).strip().lower())
        if "full_name" in user.raw_claims and user.raw_claims["full_name"]:
            identifiers.add(str(user.raw_claims["full_name"]).strip().lower())
        if "username" in user.raw_claims and user.raw_claims["username"]:
            identifiers.add(str(user.raw_claims["username"]).strip().lower())

    if store.store_manager_id and store.store_manager_id.strip().lower() in identifiers:
        return True
    if store.store_manager_name and store.store_manager_name.strip().lower() in identifiers:
        return True

    return False


async def _is_store_authorized(session: AsyncSession, store: StoreModel, user: CurrentUser) -> bool:
    """Check if the user is authorized for the given store (Warehouse/Admin or assigned Store Manager)."""
    if _is_warehouse_or_admin(user):
        return True
    if _store_manager_matches(store, user):
        return True

    identifiers = {
        str(user.subject or "").strip().lower(),
        str(user.username or "").strip().lower(),
        str(user.raw_claims.get("employee_id") or "").strip().lower() if user.raw_claims else "",
        str(user.raw_claims.get("username") or "").strip().lower() if user.raw_claims else "",
        str(user.raw_claims.get("sub") or "").strip().lower() if user.raw_claims else "",
    }
    identifiers.discard("")
    if not identifiers:
        return False

    mgr_stmt = select(StoreManagerUserModel).where(
        StoreManagerUserModel.store_id == store.id,
        or_(
            func.lower(StoreManagerUserModel.username).in_(identifiers),
            func.lower(StoreManagerUserModel.employee_id).in_(identifiers),
            func.lower(StoreManagerUserModel.full_name).in_(identifiers),
            func.lower(StoreManagerUserModel.email).in_(identifiers),
        )
    )
    res = await session.execute(mgr_stmt)
    return res.scalars().first() is not None


async def _resolve_store(session: AsyncSession, id_or_code: str) -> Optional[StoreModel]:
    store = None
    try:
        store_uuid = uuid.UUID(id_or_code)
        store = await session.get(StoreModel, store_uuid)
    except ValueError:
        pass

    if store is None:
        stmt = select(StoreModel).where(func.upper(StoreModel.store_code) == id_or_code.strip().upper())
        res = await session.execute(stmt)
        store = res.scalar_one_or_none()

    return store


async def _resolve_zone(
    session: AsyncSession, id_or_code: str, store_id: Optional[uuid.UUID] = None
) -> Optional[StoreZoneModel]:
    zone = None
    try:
        z_uuid = uuid.UUID(id_or_code.strip())
        zone = await session.get(StoreZoneModel, z_uuid)
    except (ValueError, AttributeError):
        pass

    if zone is None:
        stmt = select(StoreZoneModel).where(
            func.upper(StoreZoneModel.zone_code) == id_or_code.strip().upper()
        )
        if store_id:
            stmt = stmt.where(StoreZoneModel.store_id == store_id)
        res = await session.execute(stmt)
        zone = res.scalars().first()

    return zone


async def _resolve_bin(
    session: AsyncSession, id_or_code: str, zone_id: Optional[uuid.UUID] = None, store_id: Optional[uuid.UUID] = None
) -> Optional[StoreBinModel]:
    bin_obj = None
    try:
        b_uuid = uuid.UUID(id_or_code.strip())
        bin_obj = await session.get(StoreBinModel, b_uuid)
    except (ValueError, AttributeError):
        pass

    if bin_obj is None:
        stmt = select(StoreBinModel).where(func.upper(StoreBinModel.bin_code) == id_or_code.strip().upper())
        if zone_id:
            stmt = stmt.where(StoreBinModel.zone_id == zone_id)
        if store_id:
            stmt = stmt.where(StoreBinModel.store_id == store_id)
        res = await session.execute(stmt)
        bin_obj = res.scalars().first()

    return bin_obj


async def generate_next_store_code(session: AsyncSession) -> str:
    """Generate the next sequential store code in STR-XXX format (e.g. STR-001, STR-002)."""
    stmt = select(StoreModel.store_code)
    result = await session.execute(stmt)
    codes = result.scalars().all()

    max_seq = 0
    for code in codes:
        if not code:
            continue
        match = re.match(r"^STR-(\d+)$", code.strip(), re.IGNORECASE)
        if match:
            try:
                seq = int(match.group(1))
                if seq > max_seq:
                    max_seq = seq
            except (ValueError, TypeError):
                pass

    return f"STR-{(max_seq + 1):03d}"


async def generate_next_zone_code(session: AsyncSession, store_id: uuid.UUID, store_code: str) -> str:
    """
    Generate the next sequential zone code for a specific store (e.g. STR-001-Z01, STR-001-Z02).
    """
    stmt = select(StoreZoneModel.zone_code).where(StoreZoneModel.store_id == store_id)
    result = await session.execute(stmt)
    codes = result.scalars().all()

    max_seq = 0
    for code in codes:
        if not code:
            continue
        match = re.match(r"^.*-Z(\d+)$", code.strip(), re.IGNORECASE) or re.match(r"^Z-(\d+)$", code.strip(), re.IGNORECASE)
        if match:
            try:
                seq = int(match.group(1))
                if seq > max_seq:
                    max_seq = seq
            except (ValueError, TypeError):
                pass

    return f"{store_code}-Z{(max_seq + 1):02d}"


async def generate_next_bin_code(session: AsyncSession, zone_id: uuid.UUID, zone_code: str) -> str:
    """
    Generate the next sequential bin code for a specific zone (e.g. BIN-STR001-Z01-001 or BIN-E01-001).
    """
    stmt = select(StoreBinModel.bin_code).where(StoreBinModel.zone_id == zone_id)
    result = await session.execute(stmt)
    codes = result.scalars().all()

    clean_zone = zone_code.replace(" ", "").upper()
    max_seq = 0
    for code in codes:
        if not code:
            continue
        match = re.search(r"(\d+)$", code.strip())
        if match:
            try:
                seq = int(match.group(1))
                if seq > max_seq:
                    max_seq = seq
            except (ValueError, TypeError):
                pass

    return f"BIN-{clean_zone}-{(max_seq + 1):03d}"


def _build_zone_qr_response(zone: StoreZoneModel, store: StoreModel) -> ZoneQRResponse:
    payload_dict = {
        "type": "ZONE_QR",
        "zone_id": str(zone.id),
        "zone_code": zone.zone_code,
        "zone_name": zone.zone_name,
        "store_id": str(store.id),
        "store_code": store.store_code,
        "store_name": store.store_name,
        "warehouse_id": store.warehouse_id,
        "status": zone.status,
    }
    qr_payload = json.dumps(payload_dict, separators=(",", ":"))
    return ZoneQRResponse(
        zone_id=str(zone.id),
        zone_code=zone.zone_code,
        zone_name=zone.zone_name,
        store_id=str(store.id),
        store_code=store.store_code,
        store_name=store.store_name,
        warehouse_id=store.warehouse_id,
        status=zone.status,
        qr_payload=qr_payload,
        generated_at=datetime.now(timezone.utc),
    )


def _build_bin_qr_response(bin_obj: StoreBinModel, zone: StoreZoneModel, store: StoreModel) -> BinQRResponse:
    payload_dict = {
        "type": "BIN_QR",
        "bin_id": str(bin_obj.id),
        "bin_code": bin_obj.bin_code,
        "bin_name": bin_obj.bin_name,
        "zone_id": str(zone.id),
        "zone_code": zone.zone_code,
        "zone_name": zone.zone_name,
        "store_id": str(store.id),
        "store_code": store.store_code,
        "store_name": store.store_name,
        "warehouse_id": store.warehouse_id,
        "rack": bin_obj.rack,
        "shelf": bin_obj.shelf,
        "capacity": float(bin_obj.capacity),
        "status": bin_obj.status,
    }
    qr_payload = json.dumps(payload_dict, separators=(",", ":"))
    return BinQRResponse(
        bin_id=str(bin_obj.id),
        bin_code=bin_obj.bin_code,
        bin_name=bin_obj.bin_name,
        zone_id=str(zone.id),
        zone_code=zone.zone_code,
        zone_name=zone.zone_name,
        store_id=str(store.id),
        store_code=store.store_code,
        store_name=store.store_name,
        warehouse_id=store.warehouse_id,
        rack=bin_obj.rack,
        shelf=bin_obj.shelf,
        capacity=bin_obj.capacity,
        status=bin_obj.status,
        qr_payload=qr_payload,
        generated_at=datetime.now(timezone.utc),
    )


# ==========================================
# STORE MANAGER USER ACCOUNT ENDPOINTS
# ==========================================

@router.get("/managers", response_model=List[StoreManagerUserResponse])
async def list_store_managers(
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> List[StoreManagerUserResponse]:
    """
    List all Store Manager user accounts.
    Allowed for Warehouse/Admin users.
    """
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can view manager accounts.",
        )

    stmt = (
        select(StoreManagerUserModel)
        .options(selectinload(StoreManagerUserModel.store))
        .order_by(StoreManagerUserModel.employee_id.asc())
    )
    res = await uow.session.execute(stmt)
    managers = res.scalars().all()
    return [_to_manager_response(m) for m in managers]


@router.post("/managers", response_model=StoreManagerUserResponse, status_code=status.HTTP_201_CREATED)
async def create_store_manager(
    payload: StoreManagerCreate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> StoreManagerUserResponse:
    """
    Create a new real Store Manager user account and assign them to a Store.
    """
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can provision manager accounts.",
        )

    store = await _resolve_store(uow.session, payload.store_id)
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Target Store '{payload.store_id}' not found.",
        )

    clean_emp = payload.employee_id.strip().upper()
    clean_user = payload.username.strip().lower()
    clean_email = payload.email.strip().lower()

    existing_stmt = select(StoreManagerUserModel).where(
        or_(
            StoreManagerUserModel.employee_id == clean_emp,
            StoreManagerUserModel.username == clean_user,
            StoreManagerUserModel.email == clean_email,
        )
    )
    existing_res = await uow.session.execute(existing_stmt)
    if existing_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A manager with this employee ID, username, or email already exists.",
        )

    now = datetime.now(timezone.utc)
    hashed_pwd = hashlib.sha256(payload.password.encode()).hexdigest()

    new_manager = StoreManagerUserModel(
        id=uuid.uuid4(),
        store_id=store.id,
        employee_id=clean_emp,
        username=clean_user,
        full_name=payload.full_name.strip(),
        email=clean_email,
        role=payload.role.strip(),
        applications=payload.applications,
        password_hash=hashed_pwd,
        status=payload.status.strip().upper() if payload.status else "ACTIVE",
        created_at=now,
        updated_at=now,
    )

    uow.session.add(new_manager)
    store.store_manager_id = clean_emp
    store.store_manager_name = payload.full_name.strip()
    store.updated_at = now

    await uow.session.flush()
    await uow.commit()

    logger.info(f"Store Manager '{clean_user}' ({clean_emp}) created for store '{store.store_code}' by '{user.username}'")
    return _to_manager_response(new_manager, store=store)


@router.put("/managers/{manager_id}", response_model=StoreManagerUserResponse)
@router.patch("/managers/{manager_id}", response_model=StoreManagerUserResponse)
async def update_store_manager(
    manager_id: str,
    payload: StoreManagerUpdate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> StoreManagerUserResponse:
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can update manager accounts.",
        )

    mgr = None
    try:
        m_uuid = uuid.UUID(manager_id)
        mgr = await uow.session.get(StoreManagerUserModel, m_uuid)
    except ValueError:
        pass

    if mgr is None:
        stmt = select(StoreManagerUserModel).where(
            or_(
                StoreManagerUserModel.employee_id == manager_id.strip().upper(),
                StoreManagerUserModel.username == manager_id.strip().lower(),
            )
        )
        res = await uow.session.execute(stmt)
        mgr = res.scalar_one_or_none()

    if not mgr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Store Manager '{manager_id}' not found")

    target_store = None
    if payload.store_id:
        target_store = await _resolve_store(uow.session, payload.store_id)
        if not target_store:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Store '{payload.store_id}' not found")
        mgr.store_id = target_store.id
        target_store.store_manager_id = mgr.employee_id
        target_store.store_manager_name = payload.full_name.strip() if payload.full_name else mgr.full_name

    if payload.full_name:
        mgr.full_name = payload.full_name.strip()
    if payload.email:
        mgr.email = payload.email.strip().lower()
    if payload.password:
        mgr.password_hash = hashlib.sha256(payload.password.encode()).hexdigest()
    if payload.status:
        mgr.status = payload.status.strip().upper()
    if payload.role is not None:
        mgr.role = payload.role.strip()
    if payload.applications is not None:
        mgr.applications = payload.applications

    mgr.updated_at = datetime.now(timezone.utc)
    await uow.session.flush()
    await uow.commit()

    if not target_store:
        target_store = await uow.session.get(StoreModel, mgr.store_id)

    return _to_manager_response(mgr, store=target_store)


@router.patch("/managers/{manager_id}/status", response_model=StoreManagerUserResponse)
async def update_store_manager_status(
    manager_id: str,
    payload: StoreManagerStatusUpdate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> StoreManagerUserResponse:
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can change manager account status.",
        )

    mgr = None
    try:
        m_uuid = uuid.UUID(manager_id)
        mgr = await uow.session.get(StoreManagerUserModel, m_uuid)
    except ValueError:
        pass

    if mgr is None:
        stmt = select(StoreManagerUserModel).where(
            or_(
                StoreManagerUserModel.employee_id == manager_id.strip().upper(),
                StoreManagerUserModel.username == manager_id.strip().lower(),
            )
        )
        res = await uow.session.execute(stmt)
        mgr = res.scalar_one_or_none()

    if not mgr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Store Manager '{manager_id}' not found")

    mgr.status = payload.status.strip().upper()
    mgr.updated_at = datetime.now(timezone.utc)
    await uow.session.flush()
    await uow.commit()

    store = await uow.session.get(StoreModel, mgr.store_id)
    return _to_manager_response(mgr, store=store)


@router.get("/manager-options", response_model=List[StoreManagerOption])
async def list_manager_options(
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> List[StoreManagerOption]:
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can view manager options.",
        )

    stmt = (
        select(StoreManagerUserModel)
        .options(selectinload(StoreManagerUserModel.store))
        .where(StoreManagerUserModel.status == "ACTIVE")
        .order_by(StoreManagerUserModel.full_name.asc())
    )
    res = await uow.session.execute(stmt)
    managers = res.scalars().all()

    return [
        StoreManagerOption(
            manager_id=m.employee_id,
            manager_name=f"{m.full_name} ({m.employee_id})",
            email=m.email,
            assigned_store_code=m.store.store_code if m.store else None,
        )
        for m in managers
    ]


# ==========================================
# STORE MASTER ENDPOINTS
# ==========================================

@router.get("/next-code")
async def get_next_store_code(
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> dict:
    next_code = await generate_next_store_code(uow.session)
    return {"suggested_store_code": next_code}


@router.get("/hierarchy/all", response_model=List[StoreWithZonesResponse])
async def get_store_hierarchy(
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> List[StoreWithZonesResponse]:
    """
    Return all Stores with their nested Zones and Bins.
    Warehouse & Admin see all stores/zones/bins.
    Store Manager sees only their assigned store with its zones and bins.
    """
    stmt = (
        select(StoreModel)
        .options(
            selectinload(StoreModel.zones).selectinload(StoreZoneModel.bins),
            selectinload(StoreModel.bins),
        )
        .order_by(StoreModel.store_code.asc())
    )
    res = await uow.session.execute(stmt)
    stores = res.scalars().all()

    if not _is_warehouse_or_admin(user):
        stores = [s for s in stores if _store_manager_matches(s, user)]

    response = []
    for s in stores:
        zones_out = []
        for z in (s.zones or []):
            zones_out.append(
                ZoneWithBinsResponse(
                    id=str(z.id),
                    store_id=str(z.store_id),
                    zone_code=z.zone_code,
                    zone_name=z.zone_name,
                    description=z.description,
                    status=z.status,
                    created_at=z.created_at,
                    updated_at=z.updated_at,
                    bins=[_to_bin_response(b) for b in (z.bins or [])],
                )
            )
        response.append(
            StoreWithZonesResponse(
                id=str(s.id),
                store_code=s.store_code,
                store_name=s.store_name,
                description=s.description,
                warehouse_id=s.warehouse_id,
                store_manager_id=s.store_manager_id,
                store_manager_name=s.store_manager_name,
                status=s.status,
                created_at=s.created_at,
                updated_at=s.updated_at,
                zones=zones_out,
            )
        )
    return response


@router.get("/me", response_model=StoreResponse)
async def get_my_store(
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> StoreResponse:
    """
    Resolve and return the single assigned Store for the authenticated Store Manager.
    Directly derives store identity from the authenticated session.
    """
    if user.raw_claims and user.raw_claims.get("store_id"):
        try:
            store_uuid = uuid.UUID(str(user.raw_claims["store_id"]))
            store = await uow.session.get(StoreModel, store_uuid)
            if store:
                count_stmt = select(func.count(StoreZoneModel.id)).where(StoreZoneModel.store_id == store.id)
                z_count = (await uow.session.execute(count_stmt)).scalar() or 0
                bin_count_stmt = select(func.count(StoreBinModel.id)).where(StoreBinModel.store_id == store.id)
                b_count = (await uow.session.execute(bin_count_stmt)).scalar() or 0
                return _to_store_response(store, zones_count=z_count, bins_count=b_count)
        except (ValueError, TypeError):
            pass

    if user.raw_claims and user.raw_claims.get("store_code"):
        store = await _resolve_store(uow.session, str(user.raw_claims["store_code"]))
        if store:
            count_stmt = select(func.count(StoreZoneModel.id)).where(StoreZoneModel.store_id == store.id)
            z_count = (await uow.session.execute(count_stmt)).scalar() or 0
            bin_count_stmt = select(func.count(StoreBinModel.id)).where(StoreBinModel.store_id == store.id)
            b_count = (await uow.session.execute(bin_count_stmt)).scalar() or 0
            return _to_store_response(store, zones_count=z_count, bins_count=b_count)

    mgr_stmt = select(StoreManagerUserModel).where(
        or_(
            StoreManagerUserModel.username == user.username,
            StoreManagerUserModel.employee_id == user.subject,
            StoreManagerUserModel.employee_id == user.username,
        )
    )
    mgr = (await uow.session.execute(mgr_stmt)).scalar_one_or_none()
    if mgr:
        store = await uow.session.get(StoreModel, mgr.store_id)
        if store:
            count_stmt = select(func.count(StoreZoneModel.id)).where(StoreZoneModel.store_id == store.id)
            z_count = (await uow.session.execute(count_stmt)).scalar() or 0
            bin_count_stmt = select(func.count(StoreBinModel.id)).where(StoreBinModel.store_id == store.id)
            b_count = (await uow.session.execute(bin_count_stmt)).scalar() or 0
            return _to_store_response(store, zones_count=z_count, bins_count=b_count)

    stmt = select(StoreModel)
    result = await uow.session.execute(stmt)
    stores = result.scalars().all()

    for store in stores:
        if _store_manager_matches(store, user):
            count_stmt = select(func.count(StoreZoneModel.id)).where(StoreZoneModel.store_id == store.id)
            z_count = (await uow.session.execute(count_stmt)).scalar() or 0
            bin_count_stmt = select(func.count(StoreBinModel.id)).where(StoreBinModel.store_id == store.id)
            b_count = (await uow.session.execute(bin_count_stmt)).scalar() or 0
            return _to_store_response(store, zones_count=z_count, bins_count=b_count)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"No assigned store found for user '{user.username}'",
    )


async def _build_store_dashboard_metrics(uow: UnitOfWork, store: StoreModel) -> StoreDashboardMetricsResponse:
    from app.modules.storage.infrastructure.persistence.models import (
        InventoryLocationBalanceModel,
        StorageLocationModel,
        InventoryMovementHistoryModel,
    )
    from app.modules.quarantine.infrastructure.persistence.models import QuarantineRecordModel
    from app.modules.procurement.infrastructure.persistence.models import MaterialModel, MaterialStockModel
    from app.modules.dock.infrastructure.persistence.models import DockMasterModel, DockAllocationRequestModel

    # 1. Zones & Bins in store
    z_res = await uow.session.execute(select(StoreZoneModel).where(StoreZoneModel.store_id == store.id))
    zones = z_res.scalars().all()
    zones_map = {z.id: z for z in zones}
    zones_count = len(zones)

    b_res = await uow.session.execute(select(StoreBinModel).where(StoreBinModel.store_id == store.id))
    bins = b_res.scalars().all()
    bins_map = {b.id: b for b in bins}
    bins_count = len(bins)
    occupied_bins_count = sum(1 for b in bins if float(b.occupied_quantity or 0) > 0)
    available_bins_count = sum(1 for b in bins if float(b.occupied_quantity or 0) == 0 and (b.status or "").upper() == "ACTIVE")

    # 2. Location balances in this store
    loc_stmt = (
        select(InventoryLocationBalanceModel, StorageLocationModel)
        .join(StorageLocationModel, StorageLocationModel.id == InventoryLocationBalanceModel.storage_location_id)
        .where(StorageLocationModel.store_id == store.id)
        .order_by(InventoryLocationBalanceModel.updated_at.desc())
    )
    loc_res = await uow.session.execute(loc_stmt)
    balances = loc_res.all()

    # Materials lookup
    mat_res = await uow.session.execute(select(MaterialModel))
    mat_map = {m.material_code: m for m in mat_res.scalars().all()}
    stock_res = await uow.session.execute(select(MaterialStockModel))
    stock_map = {s.material_code: s for s in stock_res.scalars().all()}

    # Quarantined records
    quar_res = await uow.session.execute(
        select(QuarantineRecordModel).where(
            QuarantineRecordModel.status.in_(["PENDING_REVIEW", "QUARANTINED"])
        )
    )
    quarantine_records = quar_res.scalars().all()

    inv_items: List[StoreInventoryItem] = []
    seen_skus = set()
    total_qty = 0.0
    total_avail = 0.0

    for bal, loc in balances:
        m_code = bal.material_code
        seen_skus.add(m_code)
        mat_obj = mat_map.get(m_code)
        stk_obj = stock_map.get(m_code)
        z_obj = zones_map.get(loc.zone_id) if loc.zone_id else None
        b_obj = bins_map.get(loc.bin_id) if loc.bin_id else None

        avail_q = float(bal.available_quantity or 0)
        tot_q = avail_q
        total_qty += tot_q
        total_avail += avail_q

        stat = "HEALTHY"
        reorder_pt = float(stk_obj.reorder_point) if stk_obj else 10.0
        if tot_q == 0:
            stat = "OUT_OF_STOCK"
        elif avail_q < reorder_pt:
            stat = "LOW_STOCK"

        inv_items.append(
            StoreInventoryItem(
                id=str(bal.id),
                material_code=m_code,
                material_name=bal.material_name or (mat_obj.material_name if mat_obj else m_code),
                category=mat_obj.category if mat_obj and getattr(mat_obj, "category", None) else (stk_obj.category if stk_obj else "GENERAL"),
                quantity=tot_q,
                available_quantity=avail_q,
                uom=bal.uom or "PCS",
                zone_code=z_obj.zone_code if z_obj else loc.zone,
                zone_name=z_obj.zone_name if z_obj else loc.zone,
                bin_code=b_obj.bin_code if b_obj else (loc.bin if loc.bin and loc.bin != "DEFAULT" else None),
                bin_name=b_obj.bin_name if b_obj else (f"Bin {loc.bin}" if loc.bin and loc.bin != "DEFAULT" else None),
                status=stat,
                last_updated=bal.updated_at.isoformat() if bal.updated_at else datetime.now(timezone.utc).isoformat(),
            )
        )

    # Check low stock across seen SKUs
    low_stock_count = 0
    for m_code in seen_skus:
        stk_obj = stock_map.get(m_code)
        reorder_pt = float(stk_obj.reorder_point) if stk_obj else 10.0
        sku_avail = sum(item.available_quantity for item in inv_items if item.material_code == m_code)
        if sku_avail < reorder_pt:
            low_stock_count += 1

    # Quarantined & Damaged quantity for store
    store_quar_qty = sum(
        float(q.damaged_quantity)
        for q in quarantine_records
        if (q.item_code in seen_skus) or (getattr(q, "store_id", None) and getattr(q, "store_id") == store.id)
    )

    # 3. Recent store activity from InventoryMovementHistoryModel
    mov_stmt = (
        select(InventoryMovementHistoryModel)
        .where(
            or_(
                InventoryMovementHistoryModel.store_id == store.id,
                InventoryMovementHistoryModel.material_code.in_(seen_skus) if seen_skus else False,
            )
        )
        .order_by(InventoryMovementHistoryModel.performed_at.desc())
        .limit(10)
    )
    mov_res = await uow.session.execute(mov_stmt)
    movements = mov_res.scalars().all()
    recent_activity: List[StoreMovementActivity] = []
    for m in movements:
        recent_activity.append(
            StoreMovementActivity(
                id=str(m.id),
                timestamp=m.performed_at.isoformat() if m.performed_at else datetime.now(timezone.utc).isoformat(),
                movement_type=m.movement_type,
                material_code=m.material_code,
                material_name=m.material_name,
                material_qr=m.material_qr,
                from_location=m.from_location,
                to_location=m.to_location,
                quantity=float(m.quantity or 0),
                uom=m.uom or "PCS",
                stock_before=float(m.stock_before) if m.stock_before is not None else None,
                stock_after=float(m.stock_after) if m.stock_after is not None else None,
                operator=m.performed_by or "System",
                reference_document=m.reference_document,
            )
        )

    # 4. Assigned docks count
    docks_count_stmt = (
        select(func.count(DockAllocationRequestModel.id))
        .where(
            DockAllocationRequestModel.assigned_store_id == store.id,
            DockAllocationRequestModel.status.in_(["OCCUPIED", "RESERVED", "ALLOCATED", "DOCK_ASSIGNED"]),
        )
    )
    assigned_docks_count = (await uow.session.execute(docks_count_stmt)).scalar() or 0

    # 5. Query Assembly Stock Reservations for this store / stored materials
    res_conditions = [
        AssemblyStockReservationModel.store_id == store.id,
        AssemblyStockReservationModel.store_code == store.store_code,
    ]
    if seen_skus:
        res_conditions.append(AssemblyStockReservationModel.material_code.in_(seen_skus))

    res_stmt = (
        select(AssemblyStockReservationModel)
        .where(
            or_(*res_conditions),
            AssemblyStockReservationModel.status.in_(["RESERVED FOR ASSEMBLY", "FULFILLED", "RESERVED"]),
        )
        .order_by(AssemblyStockReservationModel.reserved_at.desc())
    )
    res_rows = (await uow.session.execute(res_stmt)).scalars().all()

    assembly_reservations: List[StoreAssemblyReservationItem] = []
    reserved_qty_by_code: Dict[str, float] = {}
    for r in res_rows:
        assembly_reservations.append(
            StoreAssemblyReservationItem(
                id=str(r.id),
                requisition_id=str(r.requisition_id),
                requisition_item_id=str(r.requisition_item_id),
                requisition_number=r.requisition_number,
                material_code=r.material_code,
                material_name=r.material_name,
                required_quantity=float(r.required_quantity or 0),
                reserved_quantity=float(r.reserved_quantity or 0),
                uom=r.uom or "PCS",
                status=r.status or "RESERVED FOR ASSEMBLY",
                store_id=str(r.store_id) if r.store_id else str(store.id),
                store_code=r.store_code or store.store_code,
                store_name=r.store_name or store.store_name,
                zone_code=r.zone_code,
                bin_code=r.bin_code,
                location_code=r.location_code,
                reserved_by=r.reserved_by,
                reserved_at=r.reserved_at,
            )
        )
        reserved_qty_by_code[r.material_code] = reserved_qty_by_code.get(r.material_code, 0.0) + float(r.reserved_quantity or 0)

    for item in inv_items:
        if item.material_code in reserved_qty_by_code:
            item.reserved_quantity = reserved_qty_by_code[item.material_code]

    kpis = StoreDashboardKPIs(
        total_skus=len(seen_skus),
        total_quantity=total_qty,
        available_quantity=total_avail,
        quarantined_quantity=store_quar_qty,
        damaged_quantity=store_quar_qty,
        low_stock_items=low_stock_count,
        zones_count=zones_count,
        bins_count=bins_count,
        occupied_bins_count=occupied_bins_count,
        available_bins_count=available_bins_count,
    )

    store_resp = _to_store_response(store, zones_count=zones_count, bins_count=bins_count)

    return StoreDashboardMetricsResponse(
        store=store_resp,
        kpis=kpis,
        inventory_summary=inv_items,
        assembly_reservations=assembly_reservations,
        recent_activity=recent_activity,
        assigned_docks_count=assigned_docks_count,
    )


@router.get("/me/dashboard-metrics", response_model=StoreDashboardMetricsResponse)
async def get_my_store_dashboard_metrics(
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> StoreDashboardMetricsResponse:
    """
    Returns store-level real-time dashboard KPIs, inventory summary, and recent movements
    for the authenticated Store Manager's assigned store.
    """
    store = None
    if user.raw_claims and user.raw_claims.get("store_id"):
        try:
            store_uuid = uuid.UUID(str(user.raw_claims["store_id"]))
            store = await uow.session.get(StoreModel, store_uuid)
        except (ValueError, TypeError):
            pass

    if not store:
        mgr_stmt = select(StoreManagerUserModel).where(
            or_(
                StoreManagerUserModel.username == user.username,
                StoreManagerUserModel.employee_id == user.subject,
                StoreManagerUserModel.employee_id == user.username,
            )
        )
        mgr = (await uow.session.execute(mgr_stmt)).scalar_one_or_none()
        if mgr:
            store = await uow.session.get(StoreModel, mgr.store_id)

    if not store:
        stmt = select(StoreModel)
        result = await uow.session.execute(stmt)
        for s in result.scalars().all():
            if _store_manager_matches(s, user):
                store = s
                break

    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No assigned store found for user '{user.username}'",
        )

    return await _build_store_dashboard_metrics(uow, store)


@router.get("/{store_id}/dashboard-metrics", response_model=StoreDashboardMetricsResponse)
async def get_store_dashboard_metrics_by_id(
    store_id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> StoreDashboardMetricsResponse:
    """
    Returns store dashboard KPIs for a specific store.
    Strictly verifies that the caller is authorized for the target store.
    """
    store = await _resolve_store(uow.session, store_id)
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Store '{store_id}' not found",
        )

    if not await _is_store_authorized(uow.session, store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are only authorized to view dashboard metrics for your assigned store.",
        )

    return await _build_store_dashboard_metrics(uow, store)


@router.get("/me/assembly-reservations", response_model=List[StoreAssemblyReservationItem])
async def get_my_store_assembly_reservations(
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> List[StoreAssemblyReservationItem]:
    """Get active stock reservations for Assembly requirements in the current user's store."""
    metrics = await get_my_store_dashboard_metrics(uow=uow, user=user)
    return metrics.assembly_reservations


@router.get("/{store_id}/assembly-reservations", response_model=List[StoreAssemblyReservationItem])
async def get_store_assembly_reservations_by_id(
    store_id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> List[StoreAssemblyReservationItem]:
    """Get active stock reservations for Assembly requirements in a specific store."""
    store = await _resolve_store(uow.session, store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Store '{store_id}' not found")
    if not await _is_store_authorized(uow.session, store, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
    metrics = await _build_store_dashboard_metrics(uow, store)
    return metrics.assembly_reservations


@router.get("", response_model=List[StoreResponse])
async def list_stores(
    search: Optional[str] = Query(None, description="Search by store code or store name"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by ACTIVE / INACTIVE"),
    warehouse_id: Optional[str] = Query(None, description="Filter by warehouse ID"),
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> List[StoreResponse]:
    stmt = select(StoreModel).order_by(StoreModel.store_code.asc())

    if status_filter and status_filter.upper() != "ALL":
        stmt = stmt.where(func.upper(StoreModel.status) == status_filter.strip().upper())

    if warehouse_id:
        stmt = stmt.where(StoreModel.warehouse_id == warehouse_id)

    if search:
        term = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(StoreModel.store_code).like(term),
                func.lower(StoreModel.store_name).like(term),
                func.lower(StoreModel.description).like(term),
                func.lower(StoreModel.store_manager_name).like(term),
            )
        )

    result = await uow.session.execute(stmt)
    stores = result.scalars().all()

    z_counts_stmt = select(StoreZoneModel.store_id, func.count(StoreZoneModel.id)).group_by(StoreZoneModel.store_id)
    z_counts_res = await uow.session.execute(z_counts_stmt)
    z_counts_map = {row[0]: row[1] for row in z_counts_res.fetchall()}

    b_counts_stmt = select(StoreBinModel.store_id, func.count(StoreBinModel.id)).group_by(StoreBinModel.store_id)
    b_counts_res = await uow.session.execute(b_counts_stmt)
    b_counts_map = {row[0]: row[1] for row in b_counts_res.fetchall()}

    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can view the global Store Master list.",
        )

    return [_to_store_response(s, zones_count=z_counts_map.get(s.id, 0), bins_count=b_counts_map.get(s.id, 0)) for s in stores]


@router.get("/{id_or_code}", response_model=StoreResponse)
async def get_store(
    id_or_code: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> StoreResponse:
    store = await _resolve_store(uow.session, id_or_code)
    if store is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Store '{id_or_code}' not found",
        )

    if not _is_warehouse_or_admin(user):
        if not _store_manager_matches(store, user):
            logger.warning(
                f"Unauthorized store access attempt by user '{user.username}' for store '{store.store_code}'"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You are only authorized to access your assigned store.",
            )

    count_stmt = select(func.count(StoreZoneModel.id)).where(StoreZoneModel.store_id == store.id)
    z_count = (await uow.session.execute(count_stmt)).scalar() or 0
    bin_count_stmt = select(func.count(StoreBinModel.id)).where(StoreBinModel.store_id == store.id)
    b_count = (await uow.session.execute(bin_count_stmt)).scalar() or 0
    return _to_store_response(store, zones_count=z_count, bins_count=b_count)


@router.post("", response_model=StoreResponse, status_code=status.HTTP_201_CREATED)
async def create_store(
    payload: StoreCreate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> StoreResponse:
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can create stores.",
        )

    for attempt in range(5):
        clean_code = await generate_next_store_code(uow.session)
        now = datetime.now(timezone.utc)
        new_store = StoreModel(
            id=uuid.uuid4(),
            store_code=clean_code,
            store_name=payload.store_name.strip(),
            description=payload.description.strip() if payload.description else None,
            warehouse_id=payload.warehouse_id.strip() if payload.warehouse_id else "Main Warehouse",
            store_manager_id=payload.store_manager_id.strip() if payload.store_manager_id else None,
            store_manager_name=payload.store_manager_name.strip() if payload.store_manager_name else None,
            status=payload.status.strip().upper() if payload.status else "ACTIVE",
            store_type=payload.store_type.strip().upper() if getattr(payload, "store_type", None) else "RAW_MATERIAL",
            created_at=now,
            updated_at=now,
        )

        uow.session.add(new_store)
        try:
            await uow.session.flush()
            await uow.commit()
            logger.info(f"Store '{new_store.store_code}' created with ID '{new_store.id}' by '{user.username}'")
            return _to_store_response(new_store, zones_count=0, bins_count=0)
        except IntegrityError:
            await uow.rollback()
            if attempt == 4:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Failed to generate a unique store code after multiple attempts. Please retry.",
                )

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Unexpected error generating store code.",
    )


@router.put("/{id_or_code}", response_model=StoreResponse)
@router.patch("/{id_or_code}", response_model=StoreResponse)
async def update_store(
    id_or_code: str,
    payload: StoreUpdate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> StoreResponse:
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can update stores.",
        )

    store = await _resolve_store(uow.session, id_or_code)
    if store is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Store '{id_or_code}' not found",
        )

    if payload.store_name is not None:
        store.store_name = payload.store_name.strip()
    if payload.description is not None:
        store.description = payload.description.strip()
    if payload.warehouse_id is not None:
        store.warehouse_id = payload.warehouse_id.strip()
    if payload.store_manager_id is not None:
        store.store_manager_id = payload.store_manager_id.strip() if payload.store_manager_id else None
    if payload.store_manager_name is not None:
        store.store_manager_name = payload.store_manager_name.strip() if payload.store_manager_name else None
    if payload.status is not None:
        store.status = payload.status.strip().upper()
    if getattr(payload, "store_type", None) is not None:
        store.store_type = payload.store_type.strip().upper()


    store.updated_at = datetime.now(timezone.utc)
    await uow.session.flush()
    await uow.commit()

    count_stmt = select(func.count(StoreZoneModel.id)).where(StoreZoneModel.store_id == store.id)
    z_count = (await uow.session.execute(count_stmt)).scalar() or 0
    bin_count_stmt = select(func.count(StoreBinModel.id)).where(StoreBinModel.store_id == store.id)
    b_count = (await uow.session.execute(bin_count_stmt)).scalar() or 0
    return _to_store_response(store, zones_count=z_count, bins_count=b_count)


@router.patch("/{id_or_code}/status", response_model=StoreResponse)
async def update_store_status(
    id_or_code: str,
    payload: StoreStatusUpdate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> StoreResponse:
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can change store status.",
        )

    store = await _resolve_store(uow.session, id_or_code)
    if store is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Store '{id_or_code}' not found",
        )

    store.status = payload.status.strip().upper()
    store.updated_at = datetime.now(timezone.utc)
    await uow.session.flush()
    await uow.commit()

    count_stmt = select(func.count(StoreZoneModel.id)).where(StoreZoneModel.store_id == store.id)
    z_count = (await uow.session.execute(count_stmt)).scalar() or 0
    bin_count_stmt = select(func.count(StoreBinModel.id)).where(StoreBinModel.store_id == store.id)
    b_count = (await uow.session.execute(bin_count_stmt)).scalar() or 0
    return _to_store_response(store, zones_count=z_count, bins_count=b_count)


@router.delete("/{id_or_code}", status_code=status.HTTP_200_OK)
async def delete_store(
    id_or_code: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can delete stores.",
        )

    store = await _resolve_store(uow.session, id_or_code)
    if store is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Store '{id_or_code}' not found",
        )

    total_stores = (await uow.session.execute(select(func.count(StoreModel.id)))).scalar() or 0
    if total_stores <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the sole remaining Chemical Store in the system.",
        )

    # Clean up child records before deletion
    await uow.session.execute(delete(StoreBinModel).where(StoreBinModel.store_id == store.id))
    await uow.session.execute(delete(StoreZoneModel).where(StoreZoneModel.store_id == store.id))
    await uow.session.execute(delete(StoreManagerUserModel).where(StoreManagerUserModel.store_id == store.id))

    await uow.session.delete(store)
    await uow.commit()

    return {"message": f"Store '{store.store_name}' ({store.store_code}) deleted successfully."}


# ==========================================
# STORE ZONE SUB-ENDPOINTS
# ==========================================

@router.get("/{id_or_code}/zones/next-code")
async def get_next_zone_code(
    id_or_code: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    store = await _resolve_store(uow.session, id_or_code)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Store '{id_or_code}' not found")

    if not await _is_store_authorized(uow.session, store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are only authorized to access your assigned store.",
        )

    next_code = await generate_next_zone_code(uow.session, store.id, store.store_code)
    return {"suggested_zone_code": next_code}


@router.get("/{id_or_code}/zones", response_model=List[ZoneResponse])
async def list_store_zones(
    id_or_code: str,
    status_filter: Optional[str] = Query(None, alias="status"),
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> List[ZoneResponse]:
    store = await _resolve_store(uow.session, id_or_code)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Store '{id_or_code}' not found")

    if not await _is_store_authorized(uow.session, store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are only authorized to access your assigned store.",
        )

    stmt = select(StoreZoneModel).where(StoreZoneModel.store_id == store.id).order_by(StoreZoneModel.zone_code.asc())
    if status_filter and status_filter.upper() != "ALL":
        stmt = stmt.where(func.upper(StoreZoneModel.status) == status_filter.strip().upper())

    res = await uow.session.execute(stmt)
    zones = res.scalars().all()

    b_counts_stmt = (
        select(StoreBinModel.zone_id, func.count(StoreBinModel.id))
        .where(StoreBinModel.store_id == store.id)
        .group_by(StoreBinModel.zone_id)
    )
    b_counts_res = await uow.session.execute(b_counts_stmt)
    b_counts_map = {row[0]: row[1] for row in b_counts_res.fetchall()}

    return [_to_zone_response(z, bins_count=b_counts_map.get(z.id, 0)) for z in zones]


@router.post("/{id_or_code}/zones", response_model=ZoneResponse, status_code=status.HTTP_201_CREATED)
async def create_store_zone(
    id_or_code: str,
    payload: ZoneCreate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> ZoneResponse:
    store = await _resolve_store(uow.session, id_or_code)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Store '{id_or_code}' not found")

    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can create zones.",
        )

    store_code = store.store_code
    clean_code = payload.zone_code.strip().upper() if payload.zone_code else None
    if not clean_code:
        clean_code = await generate_next_zone_code(uow.session, store.id, store_code)

    now = datetime.now(timezone.utc)
    new_zone = StoreZoneModel(
        id=uuid.uuid4(),
        store_id=store.id,
        zone_code=clean_code,
        zone_name=payload.zone_name.strip(),
        description=payload.description.strip() if payload.description else None,
        status=payload.status.strip().upper() if payload.status else "ACTIVE",
        created_at=now,
        updated_at=now,
    )

    uow.session.add(new_zone)
    try:
        await uow.session.flush()
        await uow.commit()
        logger.info(f"Zone '{new_zone.zone_code}' created under Store '{store_code}' by '{user.username}'")
        return _to_zone_response(new_zone, bins_count=0)
    except IntegrityError:
        await uow.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Zone with code '{clean_code}' already exists in Store '{store_code}'.",
        )


@router.get("/{id_or_code}/bins", response_model=List[BinResponse])
async def list_store_bins(
    id_or_code: str,
    status_filter: Optional[str] = Query(None, alias="status"),
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> List[BinResponse]:
    """List all Bins belonging to a Store."""
    store = await _resolve_store(uow.session, id_or_code)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Store '{id_or_code}' not found")

    if not await _is_store_authorized(uow.session, store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are only authorized to access bins in your assigned store.",
        )

    stmt = select(StoreBinModel).where(StoreBinModel.store_id == store.id).order_by(StoreBinModel.bin_code.asc())
    if status_filter and status_filter.upper() != "ALL":
        stmt = stmt.where(func.upper(StoreBinModel.status) == status_filter.strip().upper())

    res = await uow.session.execute(stmt)
    bins = res.scalars().all()
    return [_to_bin_response(b) for b in bins]


@router.post("/{id_or_code}/bins", response_model=BinResponse, status_code=status.HTTP_201_CREATED)
async def create_store_bin(
    id_or_code: str,
    payload: BinCreate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> BinResponse:
    """Create a new Bin under a Store (and its specified Zone)."""
    store = await _resolve_store(uow.session, id_or_code)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Store '{id_or_code}' not found")

    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can create bins.",
        )

    if not payload.zone_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="zone_id is required to create a bin.",
        )

    zone = await _resolve_zone(uow.session, str(payload.zone_id))
    if not zone:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Zone '{payload.zone_id}' not found")

    if zone.store_id != store.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Zone '{zone.zone_code}' does not belong to Store '{store.store_code}'. Cross-store bin assignment is prohibited.",
        )

    clean_code = payload.bin_code.strip().upper() if payload.bin_code else None
    if not clean_code:
        clean_code = await generate_next_bin_code(uow.session, zone.id, zone.zone_code)

    now = datetime.now(timezone.utc)
    new_bin = StoreBinModel(
        id=uuid.uuid4(),
        store_id=store.id,
        zone_id=zone.id,
        bin_code=clean_code,
        bin_name=payload.bin_name.strip(),
        rack=payload.rack.strip() if payload.rack else None,
        shelf=payload.shelf.strip() if payload.shelf else None,
        capacity=payload.capacity,
        occupied_quantity=Decimal("0.0"),
        status=payload.status.strip().upper() if payload.status else "ACTIVE",
        created_at=now,
        updated_at=now,
    )

    uow.session.add(new_bin)
    try:
        await uow.session.flush()
        await uow.commit()
        logger.info(f"Bin '{new_bin.bin_code}' created under Zone '{zone.zone_code}' (Store: '{store.store_code}') by '{user.username}'")
        return _to_bin_response(new_bin)
    except IntegrityError:
        await uow.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bin with code '{clean_code}' already exists in Store '{store.store_code}'.",
        )


# ==========================================
# DIRECT ZONE RESOURCE ENDPOINTS (/api/v1/zones/...)
# ==========================================

@zone_router.get("/{zone_id}", response_model=ZoneResponse)
async def get_zone(
    zone_id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> ZoneResponse:
    try:
        z_uuid = uuid.UUID(zone_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Zone UUID format")

    zone = await uow.session.get(StoreZoneModel, z_uuid)
    if not zone:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Zone '{zone_id}' not found")

    store = await uow.session.get(StoreModel, zone.store_id)
    if not store or not await _is_store_authorized(uow.session, store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are only authorized to access zones in your assigned store.",
        )

    bin_count_stmt = select(func.count(StoreBinModel.id)).where(StoreBinModel.zone_id == zone.id)
    b_count = (await uow.session.execute(bin_count_stmt)).scalar() or 0
    return _to_zone_response(zone, bins_count=b_count)


@zone_router.put("/{zone_id}", response_model=ZoneResponse)
@zone_router.patch("/{zone_id}", response_model=ZoneResponse)
async def update_zone(
    zone_id: str,
    payload: ZoneUpdate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> ZoneResponse:
    try:
        z_uuid = uuid.UUID(zone_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Zone UUID format")

    zone = await uow.session.get(StoreZoneModel, z_uuid)
    if not zone:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Zone '{zone_id}' not found")

    store = await uow.session.get(StoreModel, zone.store_id)
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can modify zones.",
        )

    if payload.zone_name is not None:
        zone.zone_name = payload.zone_name.strip()
    if payload.description is not None:
        zone.description = payload.description.strip()
    if payload.status is not None:
        zone.status = payload.status.strip().upper()

    zone.updated_at = datetime.now(timezone.utc)
    await uow.session.flush()
    await uow.commit()

    logger.info(f"Zone '{zone.zone_code}' updated by '{user.username}'")
    bin_count_stmt = select(func.count(StoreBinModel.id)).where(StoreBinModel.zone_id == zone.id)
    b_count = (await uow.session.execute(bin_count_stmt)).scalar() or 0
    return _to_zone_response(zone, bins_count=b_count)


@zone_router.patch("/{zone_id}/status", response_model=ZoneResponse)
async def update_zone_status(
    zone_id: str,
    payload: ZoneStatusUpdate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> ZoneResponse:
    try:
        z_uuid = uuid.UUID(zone_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Zone UUID format")

    zone = await uow.session.get(StoreZoneModel, z_uuid)
    if not zone:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Zone '{zone_id}' not found")

    store = await uow.session.get(StoreModel, zone.store_id)
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can change zone status.",
        )

    zone.status = payload.status.strip().upper()
    zone.updated_at = datetime.now(timezone.utc)
    await uow.session.flush()
    await uow.commit()

    logger.info(f"Zone '{zone.zone_code}' status changed to '{zone.status}' by '{user.username}'")
    bin_count_stmt = select(func.count(StoreBinModel.id)).where(StoreBinModel.zone_id == zone.id)
    b_count = (await uow.session.execute(bin_count_stmt)).scalar() or 0
    return _to_zone_response(zone, bins_count=b_count)


@zone_router.get("/{zone_id}/bins/next-code")
async def get_next_bin_code_for_zone(
    zone_id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    zone = await _resolve_zone(uow.session, zone_id)
    if not zone:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Zone '{zone_id}' not found")

    store = await uow.session.get(StoreModel, zone.store_id)
    if not store or not await _is_store_authorized(uow.session, store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are only authorized to access zones in your assigned store.",
        )

    next_code = await generate_next_bin_code(uow.session, zone.id, zone.zone_code)
    return {"suggested_bin_code": next_code}


@zone_router.get("/{zone_id}/bins", response_model=List[BinResponse])
async def list_zone_bins(
    zone_id: str,
    status_filter: Optional[str] = Query(None, alias="status"),
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> List[BinResponse]:
    zone = await _resolve_zone(uow.session, zone_id)
    if not zone:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Zone '{zone_id}' not found")

    store = await uow.session.get(StoreModel, zone.store_id)
    if not store or not await _is_store_authorized(uow.session, store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are only authorized to access zones in your assigned store.",
        )

    stmt = select(StoreBinModel).where(StoreBinModel.zone_id == zone.id).order_by(StoreBinModel.bin_code.asc())
    if status_filter and status_filter.upper() != "ALL":
        stmt = stmt.where(func.upper(StoreBinModel.status) == status_filter.strip().upper())

    res = await uow.session.execute(stmt)
    bins = res.scalars().all()
    return [_to_bin_response(b) for b in bins]


@zone_router.post("/{zone_id}/bins", response_model=BinResponse, status_code=status.HTTP_201_CREATED)
async def create_zone_bin(
    zone_id: str,
    payload: BinCreate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> BinResponse:
    zone = await _resolve_zone(uow.session, zone_id)
    if not zone:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Zone '{zone_id}' not found")

    store = await uow.session.get(StoreModel, zone.store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent Store not found")

    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can create bins.",
        )

    clean_code = payload.bin_code.strip().upper() if payload.bin_code else None
    if not clean_code:
        clean_code = await generate_next_bin_code(uow.session, zone.id, zone.zone_code)

    now = datetime.now(timezone.utc)
    new_bin = StoreBinModel(
        id=uuid.uuid4(),
        store_id=store.id,
        zone_id=zone.id,
        bin_code=clean_code,
        bin_name=payload.bin_name.strip(),
        rack=payload.rack.strip() if payload.rack else None,
        shelf=payload.shelf.strip() if payload.shelf else None,
        capacity=payload.capacity,
        occupied_quantity=Decimal("0.0"),
        status=payload.status.strip().upper() if payload.status else "ACTIVE",
        created_at=now,
        updated_at=now,
    )

    uow.session.add(new_bin)
    try:
        await uow.session.flush()
        await uow.commit()
        logger.info(f"Bin '{new_bin.bin_code}' created under Zone '{zone.zone_code}' by '{user.username}'")
        return _to_bin_response(new_bin)
    except IntegrityError:
        await uow.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bin with code '{clean_code}' already exists in Zone '{zone.zone_code}'.",
        )


# ==========================================
# DIRECT BIN RESOURCE ENDPOINTS (/api/v1/bins/...)
# ==========================================

@bin_router.get("/{bin_id}", response_model=BinResponse)
async def get_bin(
    bin_id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> BinResponse:
    bin_obj = await _resolve_bin(uow.session, bin_id)
    if not bin_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Bin '{bin_id}' not found")

    store = await uow.session.get(StoreModel, bin_obj.store_id)
    if not store or not await _is_store_authorized(uow.session, store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are only authorized to access bins in your assigned store.",
        )

    return _to_bin_response(bin_obj)


@bin_router.put("/{bin_id}", response_model=BinResponse)
@bin_router.patch("/{bin_id}", response_model=BinResponse)
async def update_bin(
    bin_id: str,
    payload: BinUpdate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> BinResponse:
    bin_obj = await _resolve_bin(uow.session, bin_id)
    if not bin_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Bin '{bin_id}' not found")

    store = await uow.session.get(StoreModel, bin_obj.store_id)
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can modify bins.",
        )

    if payload.bin_name is not None:
        bin_obj.bin_name = payload.bin_name.strip()
    if payload.rack is not None:
        bin_obj.rack = payload.rack.strip() if payload.rack else None
    if payload.shelf is not None:
        bin_obj.shelf = payload.shelf.strip() if payload.shelf else None
    if payload.capacity is not None:
        bin_obj.capacity = payload.capacity
    if payload.status is not None:
        bin_obj.status = payload.status.strip().upper()

    bin_obj.updated_at = datetime.now(timezone.utc)
    await uow.session.flush()
    await uow.commit()

    logger.info(f"Bin '{bin_obj.bin_code}' updated by '{user.username}'")
    return _to_bin_response(bin_obj)


@bin_router.patch("/{bin_id}/status", response_model=BinResponse)
async def update_bin_status(
    bin_id: str,
    payload: BinStatusUpdate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> BinResponse:
    bin_obj = await _resolve_bin(uow.session, bin_id)
    if not bin_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Bin '{bin_id}' not found")

    store = await uow.session.get(StoreModel, bin_obj.store_id)
    if not _is_warehouse_or_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only Warehouse or Admin users can change bin status.",
        )

    bin_obj.status = payload.status.strip().upper()
    bin_obj.updated_at = datetime.now(timezone.utc)
    await uow.session.flush()
    await uow.commit()

    logger.info(f"Bin '{bin_obj.bin_code}' status changed to '{bin_obj.status}' by '{user.username}'")
    return _to_bin_response(bin_obj)


@bin_router.get("/{bin_id}/qr", response_model=BinQRResponse)
async def get_bin_qr(
    bin_id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> BinQRResponse:
    bin_obj = await _resolve_bin(uow.session, bin_id)
    if not bin_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Bin '{bin_id}' not found")

    zone = await uow.session.get(StoreZoneModel, bin_obj.zone_id)
    store = await uow.session.get(StoreModel, bin_obj.store_id)
    if not zone or not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent Zone/Store for Bin not found")

    if not await _is_store_authorized(uow.session, store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are only authorized to generate QR codes for bins in your assigned store.",
        )

    return _build_bin_qr_response(bin_obj, zone, store)


@bin_router.post("/scan-lookup", response_model=BinQRResponse)
async def lookup_bin_by_scan(
    payload: BinScanLookupRequest,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> BinQRResponse:
    scan_raw = payload.scan_value.strip()
    bin_identifier = scan_raw

    if scan_raw.startswith("{") and scan_raw.endswith("}"):
        try:
            parsed = json.loads(scan_raw)
            bin_identifier = (
                parsed.get("bin_id")
                or parsed.get("bin_code")
                or parsed.get("location_code")
                or scan_raw
            )
        except Exception:
            bin_identifier = scan_raw

    bin_obj = await _resolve_bin(uow.session, str(bin_identifier))
    if not bin_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scanned Bin '{scan_raw}' was not found in any store/zone.",
        )

    zone = await uow.session.get(StoreZoneModel, bin_obj.zone_id)
    store = await uow.session.get(StoreModel, bin_obj.store_id)
    if not zone or not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Parent Zone/Store for scanned Bin '{scan_raw}' not found",
        )

    if not await _is_store_authorized(uow.session, store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are not authorized to access this Bin/Store.",
        )

    return _build_bin_qr_response(bin_obj, zone, store)


@bin_router.get("/{bin_id}/materials")
async def get_bin_materials(
    bin_id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    bin_obj = await _resolve_bin(uow.session, bin_id)
    if not bin_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Bin '{bin_id}' not found")

    zone = await uow.session.get(StoreZoneModel, bin_obj.zone_id)
    store = await uow.session.get(StoreModel, bin_obj.store_id)
    if not zone or not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent Zone/Store for Bin not found")

    if not await _is_store_authorized(uow.session, store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are only authorized to view bins in your assigned store.",
        )

    # Find storage locations linked to this bin
    loc_stmt = select(StorageLocationModel).where(
        or_(
            StorageLocationModel.bin_id == bin_obj.id,
            (
                (StorageLocationModel.store_id == bin_obj.store_id)
                & (StorageLocationModel.zone_id == bin_obj.zone_id)
                & (StorageLocationModel.bin == bin_obj.bin_code)
            ),
        )
    )
    loc_res = await uow.session.execute(loc_stmt)
    storage_locs = loc_res.scalars().all()
    loc_ids = [loc.id for loc in storage_locs]

    materials = []
    if loc_ids:
        bal_stmt = (
            select(InventoryLocationBalanceModel)
            .where(
                InventoryLocationBalanceModel.storage_location_id.in_(loc_ids),
                InventoryLocationBalanceModel.available_quantity > 0,
            )
            .order_by(InventoryLocationBalanceModel.material_code.asc())
        )
        bal_res = await uow.session.execute(bal_stmt)
        balances = bal_res.scalars().all()

        for b in balances:
            materials.append({
                "id": str(b.id),
                "material_code": b.material_code,
                "material_name": b.material_name,
                "material_qr": f"QR-MAT-{b.material_code}",
                "quantity": float(b.quantity),
                "available_quantity": float(b.available_quantity),
                "uom": b.uom,
                "last_grn_number": b.last_grn_number,
                "storage_location_id": str(b.storage_location_id),
                "updated_at": b.updated_at.isoformat() if b.updated_at else None,
            })

    return {
        "bin_id": str(bin_obj.id),
        "bin_code": bin_obj.bin_code,
        "bin_name": bin_obj.bin_name,
        "store_id": str(store.id),
        "store_code": store.store_code,
        "store_name": store.store_name,
        "zone_id": str(zone.id),
        "zone_code": zone.zone_code,
        "zone_name": zone.zone_name,
        "rack": bin_obj.rack,
        "shelf": bin_obj.shelf,
        "capacity": float(bin_obj.capacity),
        "occupied_quantity": float(bin_obj.occupied_quantity),
        "available_capacity": float(max(Decimal("0.0"), bin_obj.capacity - bin_obj.occupied_quantity)),
        "status": bin_obj.status,
        "materials": materials,
    }


# ==========================================
# ZONE QR & LOCATION LOOKUP ENDPOINTS
# ==========================================

@router.get("/{id_or_code}/zones/{zone_id}/qr", response_model=ZoneQRResponse)
async def get_store_zone_qr(
    id_or_code: str,
    zone_id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> ZoneQRResponse:
    store = await _resolve_store(uow.session, id_or_code)
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Store '{id_or_code}' not found",
        )

    if not _is_warehouse_or_admin(user) and not _store_manager_matches(store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are only authorized to access zones in your assigned store.",
        )

    zone = await _resolve_zone(uow.session, zone_id, store_id=store.id)
    if not zone:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Zone '{zone_id}' not found in Store '{store.store_code}'",
        )

    return _build_zone_qr_response(zone, store)


@zone_router.get("/{zone_id}/qr", response_model=ZoneQRResponse)
async def get_zone_qr(
    zone_id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> ZoneQRResponse:
    zone = await _resolve_zone(uow.session, zone_id)
    if not zone:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Zone '{zone_id}' not found",
        )

    store = await uow.session.get(StoreModel, zone.store_id)
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Parent Store for Zone '{zone_id}' not found",
        )

    if not _is_warehouse_or_admin(user) and not _store_manager_matches(store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are only authorized to generate/view QR codes for zones in your assigned store.",
        )

    return _build_zone_qr_response(zone, store)


@zone_router.post("/scan-lookup", response_model=ZoneQRResponse)
async def lookup_zone_by_scan(
    payload: ZoneScanLookupRequest,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> ZoneQRResponse:
    scan_raw = payload.scan_value.strip()
    zone_identifier = scan_raw

    if scan_raw.startswith("{") and scan_raw.endswith("}"):
        try:
            parsed = json.loads(scan_raw)
            zone_identifier = (
                parsed.get("zone_id")
                or parsed.get("zone_code")
                or scan_raw
            )
        except Exception:
            zone_identifier = scan_raw

    zone = await _resolve_zone(uow.session, str(zone_identifier))
    if not zone:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scanned Zone '{scan_raw}' was not found in any store.",
        )

    store = await uow.session.get(StoreModel, zone.store_id)
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Parent Store for scanned Zone '{scan_raw}' not found",
        )

    if not _is_warehouse_or_admin(user) and not _store_manager_matches(store, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are not authorized to access this Zone/Store.",
        )

    return _build_zone_qr_response(zone, store)
