"""Warehouse master endpoints used by Warehouse location management."""
import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from app.database.session import UnitOfWork, get_uow
from app.security.dependencies import require_permission
from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel, WarehouseZoneModel, WarehouseBinModel

router = APIRouter(prefix="/api/v1/warehouse", tags=["warehouses"])

class CreateWarehouseRequest(BaseModel):
    warehouse_name: str = Field(min_length=1, max_length=128)
    warehouse_code: str | None = Field(default=None, max_length=64)
    description: str | None = None
    warehouse_id: str = Field(min_length=1, max_length=64)
    warehouse_type: str = "RAW_MATERIAL"
    status: str = "ACTIVE"
    warehouse_operator_id: str | None = None
    warehouse_operator_name: str | None = None

async def next_code(session):
    return "WH-001"

def serialize(warehouse):
    return {key: str(value) if isinstance(value, uuid.UUID) else value for key, value in
            ((column.name, getattr(warehouse, column.name)) for column in warehouse.__table__.columns)}

@router.get("/next-code", dependencies=[Depends(require_permission("warehouse:read"))])
async def suggest_warehouse_code(uow: UnitOfWork = Depends(get_uow)):
    return {"suggested_warehouse_code": await next_code(uow.session)}

@router.get("", dependencies=[Depends(require_permission("warehouse:read"))])
async def list_warehouses(warehouse_id: str | None = None, search: str | None = None, status: str | None = None, uow: UnitOfWork = Depends(get_uow)):
    query = select(WarehouseModel).order_by(WarehouseModel.warehouse_code)
    if warehouse_id:
        query = query.where(WarehouseModel.warehouse_id == warehouse_id)
    if status:
        query = query.where(WarehouseModel.status == status.upper())
    if search:
        query = query.where(or_(WarehouseModel.warehouse_name.ilike(f"%{search.strip()}%"), WarehouseModel.warehouse_code.ilike(f"%{search.strip()}%")))
    return [serialize(warehouse) for warehouse in (await uow.session.execute(query)).scalars().all()]

@router.post("", status_code=201, dependencies=[Depends(require_permission("warehouse:write"))])
async def create_warehouse(payload: CreateWarehouseRequest, uow: UnitOfWork = Depends(get_uow)):
    if await uow.session.scalar(select(WarehouseModel.id).limit(1)):
        raise HTTPException(409, "The warehouse is already configured. Additional warehouses are not supported.")
    values = payload.model_dump()
    values["warehouse_name"] = payload.warehouse_name.strip()
    values["warehouse_id"] = payload.warehouse_id.strip()
    if not values["warehouse_name"] or not values["warehouse_id"]:
        raise HTTPException(422, "Warehouse name and location / plant are required")
    values["warehouse_code"] = (payload.warehouse_code or "").strip() or await next_code(uow.session)
    warehouse = WarehouseModel(id=uuid.uuid4(), **values)
    uow.session.add(warehouse)
    try:
        await uow.session.flush()
    except IntegrityError as exc:
        await uow.session.rollback()
        raise HTTPException(409, "The warehouse is already configured; refresh and retry") from exc
    return serialize(warehouse)

@router.get("/configuration/{id_or_code}", dependencies=[Depends(require_permission("warehouse:read"))])
async def get_warehouse(id_or_code: str, uow: UnitOfWork = Depends(get_uow)):
    condition = WarehouseModel.warehouse_code == id_or_code
    try:
        condition = or_(condition, WarehouseModel.id == uuid.UUID(id_or_code))
    except ValueError:
        pass
    warehouse = (await uow.session.execute(select(WarehouseModel).where(condition))).scalar_one_or_none()
    if warehouse is None:
        raise HTTPException(404, "Warehouse not found")
    return serialize(warehouse)


class CreateZoneRequest(BaseModel):
    zone_name: str = Field(min_length=1, max_length=128)
    zone_code: str | None = Field(default=None, max_length=64)
    description: str | None = None
    status: str = "ACTIVE"

class CreateBinRequest(BaseModel):
    bin_name: str = Field(min_length=1, max_length=128)
    bin_code: str | None = Field(default=None, max_length=64)
    rack: str | None = Field(default=None, max_length=64)
    shelf: str | None = Field(default=None, max_length=64)
    position: str | None = Field(default=None, max_length=64)
    qr_identifier: str | None = Field(default=None, max_length=128)
    storage_type: str = "GENERAL"
    capacity: Decimal = Field(default=Decimal("1000"), gt=0)
    maximum_weight: Decimal | None = Field(default=None, ge=0)
    maximum_volume: Decimal | None = Field(default=None, ge=0)
    allowed_material_category: str | None = None
    hazardous_material_permitted: bool = False
    temperature_requirement: str | None = None
    status: str = "ACTIVE"

async def resolve_zone(zone_id, session):
    try:
        zone = await session.get(WarehouseZoneModel, uuid.UUID(zone_id))
    except ValueError:
        zone = None
    if zone is None:
        raise HTTPException(404, "Storage zone not found")
    return zone

def generated_code(codes, prefix):
    numbers = [int(code[len(prefix):]) for code in codes if code.startswith(prefix) and code[len(prefix):].isdigit()]
    return f"{prefix}{max(numbers, default=0)+1:03d}"

async def flush_location(session):
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(409, "Location code or QR identifier already exists; refresh and retry") from exc

@router.get("/{warehouse_ref_id}/zones/next-code", dependencies=[Depends(require_permission("warehouse:read"))])
async def next_zone_code(warehouse_ref_id: str, uow: UnitOfWork = Depends(get_uow)):
    warehouse = await get_warehouse(warehouse_ref_id, uow)
    codes = (await uow.session.execute(select(WarehouseZoneModel.zone_code).where(WarehouseZoneModel.warehouse_ref_id == uuid.UUID(warehouse["id"])))).scalars().all()
    return {"suggested_zone_code": generated_code(codes, "ZONE-")}

@router.get("/{warehouse_ref_id}/zones", dependencies=[Depends(require_permission("warehouse:read"))])
async def list_zones(warehouse_ref_id: str, status: str | None = None, uow: UnitOfWork = Depends(get_uow)):
    warehouse = await get_warehouse(warehouse_ref_id, uow)
    query = select(WarehouseZoneModel).where(WarehouseZoneModel.warehouse_ref_id == uuid.UUID(warehouse["id"])).order_by(WarehouseZoneModel.zone_code)
    if status:
        query = query.where(WarehouseZoneModel.status == status.upper())
    return [serialize(zone) for zone in (await uow.session.execute(query)).scalars().all()]

@router.post("/{warehouse_ref_id}/zones", status_code=201, dependencies=[Depends(require_permission("warehouse:write"))])
async def create_zone(warehouse_ref_id: str, payload: CreateZoneRequest, uow: UnitOfWork = Depends(get_uow)):
    warehouse = await get_warehouse(warehouse_ref_id, uow)
    values = payload.model_dump()
    values["zone_name"] = payload.zone_name.strip()
    if not values["zone_name"]:
        raise HTTPException(422, "Zone name is required")
    values["zone_code"] = (payload.zone_code or "").strip() or (await next_zone_code(warehouse_ref_id, uow))["suggested_zone_code"]
    zone = WarehouseZoneModel(id=uuid.uuid4(), warehouse_ref_id=uuid.UUID(warehouse["id"]), **values)
    uow.session.add(zone)
    await flush_location(uow.session)
    return serialize(zone)

@router.get("/{warehouse_ref_id}/bins", dependencies=[Depends(require_permission("warehouse:read"))])
async def list_warehouse_bins(warehouse_ref_id: str, status: str | None = None, uow: UnitOfWork = Depends(get_uow)):
    warehouse = await get_warehouse(warehouse_ref_id, uow)
    query = select(WarehouseBinModel).where(WarehouseBinModel.warehouse_ref_id == uuid.UUID(warehouse["id"])).order_by(WarehouseBinModel.bin_code)
    if status:
        query = query.where(WarehouseBinModel.status == status.upper())
    return [serialize(item) for item in (await uow.session.execute(query)).scalars().all()]

zone_router = APIRouter(prefix="/api/v1/zones", tags=["storage zones"])

@zone_router.get("/{zone_id}/bins/next-code", dependencies=[Depends(require_permission("warehouse:read"))])
async def next_bin_code(zone_id: str, uow: UnitOfWork = Depends(get_uow)):
    zone = await resolve_zone(zone_id, uow.session)
    codes = (await uow.session.execute(select(WarehouseBinModel.bin_code).where(WarehouseBinModel.warehouse_ref_id == zone.warehouse_ref_id))).scalars().all()
    prefix = "BIN-" + zone.zone_code.replace(" ", "").upper() + "-"
    return {"suggested_bin_code": generated_code(codes, prefix)}

@zone_router.get("/{zone_id}/bins", dependencies=[Depends(require_permission("warehouse:read"))])
async def list_zone_bins(zone_id: str, status: str | None = None, uow: UnitOfWork = Depends(get_uow)):
    zone = await resolve_zone(zone_id, uow.session)
    query = select(WarehouseBinModel).where(WarehouseBinModel.zone_id == zone.id).order_by(WarehouseBinModel.bin_code)
    if status:
        query = query.where(WarehouseBinModel.status == status.upper())
    return [serialize(item) for item in (await uow.session.execute(query)).scalars().all()]

@zone_router.post("/{zone_id}/bins", status_code=201, dependencies=[Depends(require_permission("warehouse:write"))])
async def create_bin(zone_id: str, payload: CreateBinRequest, uow: UnitOfWork = Depends(get_uow)):
    zone = await resolve_zone(zone_id, uow.session)
    values = payload.model_dump()
    values["bin_name"] = payload.bin_name.strip()
    if not values["bin_name"]:
        raise HTTPException(422, "Bin name is required")
    values["bin_code"] = (payload.bin_code or "").strip() or (await next_bin_code(zone_id, uow))["suggested_bin_code"]
    values["qr_identifier"] = payload.qr_identifier or f"BIN:{zone.warehouse_ref_id}:{zone.id}:{values['bin_code']}"
    item = WarehouseBinModel(id=uuid.uuid4(), warehouse_ref_id=zone.warehouse_ref_id, zone_id=zone.id, **values)
    uow.session.add(item)
    await flush_location(uow.session)
    return serialize(item)


bin_router = zone_router
