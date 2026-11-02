"""Single-warehouse, zone, and bin endpoints used by the WMS location screen."""

from __future__ import annotations

import re
import unicodedata
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.database.session import UnitOfWork, get_uow
from app.modules.warehouse.infrastructure.persistence.models import (
    WarehouseBinModel,
    WarehouseRackModel,
    RackOccupancyEventModel,
    WarehouseModel,
    WarehouseZoneModel,
)
from app.security.dependencies import CurrentUser, get_current_user

warehouse_router = APIRouter(prefix="/api/v1/warehouse", tags=["warehouse-locations"])
zone_router = APIRouter(prefix="/api/v1/zones", tags=["warehouse-locations"])

_CODE_RE = re.compile(r"^[A-Z0-9_-]+$")


class ZoneCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    zone_name: str = Field(min_length=2, max_length=100)
    zone_code: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=1000)
    warehouse_name: str | None = Field(default=None, min_length=1, max_length=128)
    warehouse_id: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("zone_name")
    @classmethod
    def validate_zone_name(cls, value: str) -> str:
        if any(unicodedata.category(character) == "Cc" for character in value):
            raise ValueError("Zone name cannot contain control characters")
        value = unicodedata.normalize("NFKC", value)
        value = re.sub(r"\s+", " ", value).strip()
        if len(value) < 2 or not any(character.isalnum() for character in value):
            raise ValueError("Zone name must include at least one letter or number")
        if len(value) > 100:
            raise ValueError("Zone name must be 100 characters or fewer")
        if not re.fullmatch(r"[\w\s&().,'/#:+-]+", value, flags=re.UNICODE):
            raise ValueError("Zone name can use letters, numbers, spaces, and common punctuation only")
        return value

    @field_validator("zone_code")
    @classmethod
    def validate_zone_code(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        normalized = value.strip().upper()
        if not _CODE_RE.fullmatch(normalized):
            raise ValueError("Zone code may contain only letters, numbers, underscores, and hyphens")
        return normalized


class ZoneUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    zone_name: str | None = Field(default=None, min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, max_length=32)

    @field_validator("zone_name")
    @classmethod
    def validate_zone_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if any(unicodedata.category(character) == "Cc" for character in value):
            raise ValueError("Zone name cannot contain control characters")
        value = unicodedata.normalize("NFKC", value)
        value = re.sub(r"\s+", " ", value).strip()
        if len(value) < 2 or not any(character.isalnum() for character in value):
            raise ValueError("Zone name must include at least one letter or number")
        if len(value) > 100:
            raise ValueError("Zone name must be 100 characters or fewer")
        if not re.fullmatch(r"[\w\s&().,'/#:+-]+", value, flags=re.UNICODE):
            raise ValueError("Zone name can use letters, numbers, spaces, and common punctuation only")
        return value

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip().upper()
        if normalized not in {"ACTIVE", "INACTIVE"}:
            raise ValueError("Zone status must be ACTIVE or INACTIVE")
        return normalized


class BinCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    bin_name: str = Field(min_length=1, max_length=128)
    bin_code: str = Field(min_length=1, max_length=64)
    rack: str | None = Field(default=None, max_length=64)
    position: str | None = Field(default=None, max_length=64)
    qr_identifier: str | None = Field(default=None, max_length=128)
    storage_type: str = Field(default="GENERAL", max_length=64)
    capacity: int = Field(gt=0, le=2147483647, strict=True)

    @field_validator("bin_code", "rack", "position")
    @classmethod
    def validate_location_code(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        normalized = value.strip().upper()
        if not _CODE_RE.fullmatch(normalized):
            raise ValueError("Codes may contain only letters, numbers, underscores, and hyphens")
        return normalized

    @field_validator("bin_name")
    @classmethod
    def validate_bin_name(cls, value: str) -> str:
        if not value or not any(character.isalnum() for character in value):
            raise ValueError("Bin name must include at least one letter or number")
        if any(ord(character) < 32 for character in value):
            raise ValueError("Bin name cannot contain control characters")
        return value


def _require_location_write(user: CurrentUser) -> None:
    roles = {role.upper() for role in (user.roles or [])}
    if not roles.intersection({"ADMIN", "SUPERUSER", "WAREHOUSE", "WAREHOUSE_MANAGER"}) and "warehouse:write" not in (user.permissions or []):
        raise HTTPException(status_code=403, detail="You do not have permission to manage warehouse locations")


async def _get_warehouse(uow: UnitOfWork, id_or_code: str) -> WarehouseModel:
    warehouse = None
    try:
        warehouse = await uow.session.get(WarehouseModel, uuid.UUID(id_or_code))
    except ValueError:
        pass
    if warehouse is None:
        warehouse = await uow.session.scalar(
            select(WarehouseModel).where(func.upper(WarehouseModel.warehouse_code) == id_or_code.strip().upper())
        )
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    return warehouse


async def _get_primary_warehouse(uow: UnitOfWork, *, required: bool = True) -> WarehouseModel | None:
    """Resolve the single legacy warehouse parent without exposing it in location APIs."""
    warehouse = await uow.session.scalar(
        select(WarehouseModel)
        .where(func.upper(WarehouseModel.status) == "ACTIVE")
        .order_by(WarehouseModel.warehouse_code.asc())
        .limit(1)
    )
    if warehouse is None and required:
        raise HTTPException(status_code=409, detail="The warehouse has not been initialized")
    return warehouse


async def _get_zone(uow: UnitOfWork, zone_id: str) -> WarehouseZoneModel:
    try:
        zone_uuid = uuid.UUID(zone_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Zone not found") from exc
    zone = await uow.session.get(WarehouseZoneModel, zone_uuid)
    if zone is None:
        raise HTTPException(status_code=404, detail="Zone not found")
    return zone


def _warehouse_response(warehouse: WarehouseModel) -> dict:
    return {
        "id": str(warehouse.id),
        "warehouse_code": warehouse.warehouse_code,
        "warehouse_name": warehouse.warehouse_name,
        "description": warehouse.description,
        "warehouse_id": warehouse.warehouse_id,
        "warehouse_operator_id": warehouse.warehouse_operator_id,
        "warehouse_operator_name": warehouse.warehouse_operator_name,
        "status": warehouse.status,
        "warehouse_type": warehouse.warehouse_type,
    }


def _zone_response(zone: WarehouseZoneModel, bins_count: int = 0) -> dict:
    return {
        "id": str(zone.id),
        "warehouse_ref_id": str(zone.warehouse_ref_id),
        "zone_code": zone.zone_code,
        "zone_name": zone.zone_name,
        "description": zone.description,
        "status": zone.status,
        "bins_count": bins_count,
    }


def _bin_response(bin_model: WarehouseBinModel) -> dict:
    return {
        "id": str(bin_model.id),
        "warehouse_ref_id": str(bin_model.warehouse_ref_id),
        "zone_id": str(bin_model.zone_id),
        "bin_code": bin_model.bin_code,
        "location_code": bin_model.qr_identifier or bin_model.bin_code,
        "bin_name": bin_model.bin_name,
        "rack": bin_model.rack,
        "shelf": bin_model.shelf,
        "position": bin_model.position,
        "storage_type": bin_model.storage_type,
        "capacity": float(bin_model.capacity or 0),
        "occupied_quantity": float(bin_model.occupied_quantity or 0),
        "qr_identifier": bin_model.qr_identifier,
        "status": bin_model.status,
    }


@warehouse_router.get("/{id_or_code}/zones")
async def list_warehouse_zones(
    id_or_code: str,
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    warehouse = await _get_warehouse(uow, id_or_code)
    result = await uow.session.execute(
        select(WarehouseZoneModel)
        .where(WarehouseZoneModel.warehouse_ref_id == warehouse.id)
        .order_by(WarehouseZoneModel.zone_code.asc())
    )
    zones = result.scalars().all()
    return [
        _zone_response(
            zone,
            await uow.session.scalar(
                select(func.count(WarehouseBinModel.id)).where(WarehouseBinModel.zone_id == zone.id)
            ) or 0,
        )
        for zone in zones
    ]


@warehouse_router.get("/me")
async def current_warehouse(
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """Every operational user works in the same configured warehouse."""
    return _warehouse_response(await _get_primary_warehouse(uow))


@warehouse_router.get("/managers")
async def warehouse_operators(
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    _require_location_write(user)
    from app.modules.warehouse.infrastructure.persistence.models import UserAccountModel
    accounts = (await uow.session.scalars(select(UserAccountModel).where(
        UserAccountModel.status == "ACTIVE",
        UserAccountModel.role.in_(["WAREHOUSE_OPERATOR", "WAREHOUSE_MANAGER", "WAREHOUSE"]),
    ))).all()
    return [{"id": str(account.id), "employee_id": account.employee_id,
             "username": account.username, "full_name": account.full_name} for account in accounts]


@zone_router.get("")
async def list_zones(
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    """List zones without requiring a warehouse identifier."""
    warehouse = await _get_primary_warehouse(uow, required=False)
    if warehouse is None:
        return []
    result = await uow.session.execute(
        select(WarehouseZoneModel)
        .where(WarehouseZoneModel.warehouse_ref_id == warehouse.id)
        .order_by(WarehouseZoneModel.zone_code.asc())
    )
    zones = result.scalars().all()
    rows = []
    for zone in zones:
        count = await uow.session.scalar(
            select(func.count(WarehouseBinModel.id)).where(WarehouseBinModel.zone_id == zone.id)
        )
        rows.append(_zone_response(zone, count or 0))
    return rows


def _next_alphabetic_zone_code(codes):
    sequence = 0
    for code in codes:
        suffix = str(code).upper().removeprefix("ZONE-")
        if str(code).upper().startswith("ZONE-") and suffix.isalpha() and suffix.isascii():
            number = 0
            for character in suffix:
                number = number * 26 + ord(character) - ord("A") + 1
            sequence = max(sequence, number)
        else:
            match = re.search(r"(?:ZONE-|-Z)(\d+)$", str(code).upper())
            if match:
                sequence = max(sequence, int(match.group(1)))
    number = sequence + 1
    suffix = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        suffix = chr(ord("A") + remainder) + suffix
    return f"ZONE-{suffix}"


@warehouse_router.get("/{id_or_code}/zones/next-code")
async def next_zone_code(
    id_or_code: str,
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    warehouse = await _get_warehouse(uow, id_or_code)
    result = await uow.session.execute(
        select(WarehouseZoneModel.zone_code).where(WarehouseZoneModel.warehouse_ref_id == warehouse.id)
    )
    return {"suggested_zone_code": _next_alphabetic_zone_code(result.scalars().all())}


@zone_router.get("/next-code")
async def next_unscoped_zone_code(
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    warehouse = await _get_primary_warehouse(uow, required=False)
    if warehouse is None:
        return {"suggested_zone_code": "ZONE-A"}
    result = await uow.session.execute(
        select(WarehouseZoneModel.zone_code).where(WarehouseZoneModel.warehouse_ref_id == warehouse.id)
    )
    return {"suggested_zone_code": _next_alphabetic_zone_code(result.scalars().all())}


@zone_router.post("", status_code=status.HTTP_201_CREATED)
async def create_unscoped_zone(
    payload: ZoneCreateRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """Create a zone by name; warehouse ownership is resolved internally."""
    _require_location_write(user)
    warehouse = await _get_primary_warehouse(uow, required=False)
    if warehouse is None:
        if not payload.warehouse_name or not payload.warehouse_id:
            raise HTTPException(422, "Enter the warehouse name and location / plant to create the first zone")
        from app.modules.warehouse.infrastructure.api.router import CreateWarehouseRequest, create_warehouse

        await create_warehouse(CreateWarehouseRequest(
            warehouse_name=payload.warehouse_name, warehouse_id=payload.warehouse_id,
        ), uow)
        warehouse = await _get_primary_warehouse(uow)
    return await create_warehouse_zone(warehouse.warehouse_code, payload, user, uow)


@warehouse_router.post("/{id_or_code}/zones", status_code=status.HTTP_201_CREATED)
async def create_warehouse_zone(
    id_or_code: str,
    payload: ZoneCreateRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    _require_location_write(user)
    warehouse = await _get_warehouse(uow, id_or_code)
    if str(warehouse.status).upper() != "ACTIVE":
        raise HTTPException(status_code=409, detail="Cannot add a zone to an inactive warehouse")
    code = payload.zone_code
    if not code:
        code = (await next_zone_code(id_or_code, user, uow))["suggested_zone_code"]
    if not re.fullmatch(r"ZONE-[A-Z]+", code):
        raise HTTPException(status_code=422, detail="Zone codes must use the ZONE-A, ZONE-B format")
    duplicate_code = await uow.session.scalar(
        select(WarehouseZoneModel.id).where(
            WarehouseZoneModel.warehouse_ref_id == warehouse.id,
            func.upper(WarehouseZoneModel.zone_code) == code,
        )
    )
    if duplicate_code:
        raise HTTPException(status_code=409, detail=f"Zone code '{code}' already exists")
    zone = WarehouseZoneModel(
        warehouse_ref_id=warehouse.id,
        zone_code=code,
        zone_name=code,
        description=payload.description,
        status="ACTIVE",
    )
    uow.session.add(zone)
    try:
        await uow.session.flush()
    except IntegrityError as exc:
        await uow.rollback()
        raise HTTPException(status_code=409, detail="Zone code already exists") from exc
    return _zone_response(zone)


@zone_router.put("/{zone_id}")
async def update_zone(
    zone_id: str,
    payload: ZoneUpdateRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    _require_location_write(user)
    try:
        zone_uuid = uuid.UUID(zone_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Zone not found") from exc
    zone = await uow.session.scalar(
        select(WarehouseZoneModel).where(WarehouseZoneModel.id == zone_uuid).with_for_update()
    )
    if zone is None:
        raise HTTPException(status_code=404, detail="Zone not found")

    if payload.zone_name is not None:
        existing_names = await uow.session.scalars(
            select(WarehouseZoneModel.zone_name).where(
                WarehouseZoneModel.warehouse_ref_id == zone.warehouse_ref_id,
                WarehouseZoneModel.id != zone.id,
            )
        )
        normalized_name = payload.zone_name.casefold()
        if any(
            re.sub(r"\s+", " ", unicodedata.normalize("NFKC", name)).strip().casefold()
            == normalized_name
            for name in existing_names
        ):
            raise HTTPException(status_code=409, detail="A zone with this name already exists in the warehouse")
        zone.zone_name = payload.zone_name
    if payload.description is not None:
        zone.description = payload.description
    if payload.status is not None:
        zone.status = payload.status

    try:
        await uow.session.flush()
    except IntegrityError as exc:
        await uow.rollback()
        raise HTTPException(status_code=409, detail="Unable to update the zone") from exc
    bins_count = await uow.session.scalar(
        select(func.count(WarehouseBinModel.id)).where(WarehouseBinModel.zone_id == zone.id)
    )
    return _zone_response(zone, bins_count or 0)


@zone_router.get("/{zone_id}/bins")
async def list_zone_bins(
    zone_id: str,
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    zone = await _get_zone(uow, zone_id)
    result = await uow.session.execute(
        select(WarehouseBinModel)
        .where(WarehouseBinModel.zone_id == zone.id)
        .order_by(WarehouseBinModel.bin_code.asc())
    )
    rows = []
    for bin_model in result.scalars().all():
        row = _bin_response(bin_model)
        rack = await uow.session.scalar(select(WarehouseRackModel).where(
            WarehouseRackModel.zone_id == zone.id, WarehouseRackModel.rack_code == str(bin_model.rack or "").upper()))
        if rack:
            row["rack_capacity"] = _rack_response(rack)
        rows.append(row)
    return rows


async def _next_rack_code(session, zone_id):
    codes = list((await session.execute(select(WarehouseRackModel.rack_code).where(WarehouseRackModel.zone_id == zone_id))).scalars().all())
    codes.extend((await session.execute(select(WarehouseBinModel.rack).where(WarehouseBinModel.zone_id == zone_id))).scalars().all())
    sequences = [int(match.group(1)) for code in codes if (match := re.fullmatch(r"RACK-(\d+)", str(code).upper()))]
    return f"RACK-{max(sequences, default=0) + 1:03d}"


@zone_router.get("/{zone_id}/bins/next-code")
async def next_bin_code(
    zone_id: str,
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    zone = await _get_zone(uow, zone_id)
    result = await uow.session.execute(
        select(WarehouseBinModel.bin_code).where(WarehouseBinModel.zone_id == zone.id)
    )
    max_sequence = 0
    for code in result.scalars().all():
        match = re.search(r"(?:-BIN-|BIN-)(\d+)$", str(code).upper())
        if match:
            max_sequence = max(max_sequence, int(match.group(1)))
    return {"suggested_bin_code": f"{zone.zone_code}-BIN-{max_sequence + 1:03d}", "suggested_rack_code": await _next_rack_code(uow.session, zone.id)}


@zone_router.post("/{zone_id}/bins", status_code=status.HTTP_201_CREATED)
async def create_zone_bin(
    zone_id: str,
    payload: BinCreateRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    _require_location_write(user)
    zone = await uow.session.scalar(select(WarehouseZoneModel).where(WarehouseZoneModel.id == uuid.UUID(zone_id)).with_for_update())
    if zone is None:
        raise HTTPException(404, "Zone not found")
    if str(zone.status).upper() != "ACTIVE":
        raise HTTPException(status_code=409, detail="Cannot add a bin to an inactive zone")
    if not payload.rack:
        payload.rack = await _next_rack_code(uow.session, zone.id)
    if not re.fullmatch(rf"{re.escape(zone.zone_code)}-BIN-\d{{3,}}", payload.bin_code):
        raise HTTPException(
            status_code=422,
            detail=f"Bin codes in this zone must use the {zone.zone_code}-BIN-001 format",
        )
    if payload.capacity <= 0:
        raise HTTPException(status_code=422, detail="Bin capacity must be greater than zero")

    existing_rack = await uow.session.scalar(select(WarehouseRackModel).where(
        WarehouseRackModel.zone_id == zone.id, WarehouseRackModel.rack_code == payload.rack))
    if existing_rack:
        raise HTTPException(409, "This rack already exists in the zone. Use Add Material to put away stock.")
    rack = WarehouseRackModel(zone_id=zone.id, rack_code=payload.rack, maximum_capacity=payload.capacity, occupied_quantity=0)
    uow.session.add(rack)
    await uow.session.flush()
    uow.session.add(RackOccupancyEventModel(rack_id=rack.id, quantity_delta=0,
        reason=f"Rack created; maximum capacity {payload.capacity} PCS", actor=user.username))

    duplicate_code = await uow.session.scalar(
        select(WarehouseBinModel.id).where(
            WarehouseBinModel.warehouse_ref_id == zone.warehouse_ref_id,
            func.upper(WarehouseBinModel.bin_code) == payload.bin_code,
        )
    )
    if duplicate_code:
        raise HTTPException(status_code=409, detail=f"Bin code '{payload.bin_code}' already exists")
    duplicate_position = await uow.session.scalar(
        select(WarehouseBinModel.id).where(
            WarehouseBinModel.zone_id == zone.id,
            func.upper(WarehouseBinModel.rack) == payload.rack,
            func.upper(WarehouseBinModel.position) == payload.position,
        )
    )
    if duplicate_position:
        raise HTTPException(status_code=409, detail="This rack and shelf/position already has a bin")

    qr_identifier = f"QR-{payload.bin_code}"
    duplicate_qr = await uow.session.scalar(
        select(WarehouseBinModel.id).where(func.upper(WarehouseBinModel.qr_identifier) == qr_identifier.upper())
    )
    if duplicate_qr:
        raise HTTPException(status_code=409, detail="QR identifier already belongs to another bin")

    bin_model = WarehouseBinModel(
        warehouse_ref_id=zone.warehouse_ref_id,
        zone_id=zone.id,
        bin_code=payload.bin_code,
        bin_name=payload.bin_name,
        rack=payload.rack,
        shelf=payload.position,
        position=payload.position,
        storage_type=payload.storage_type.strip().upper(),
        capacity=payload.capacity,
        qr_identifier=qr_identifier,
        status="AVAILABLE",
    )
    uow.session.add(bin_model)
    try:
        await uow.session.flush()
    except IntegrityError as exc:
        await uow.rollback()
        raise HTTPException(status_code=409, detail="Bin code or QR identifier already exists") from exc
    return _bin_response(bin_model)


def _rack_response(rack):
    occupied = float(rack.occupied_quantity)
    maximum = rack.maximum_capacity
    return {"id": str(rack.id), "rack_code": rack.rack_code, "maximum_capacity": maximum,
        "occupied_quantity": occupied, "available_capacity": maximum - occupied,
        "occupancy_percentage": round(occupied / maximum * 100, 1),
        "occupancy_status": "Empty" if occupied == 0 else "Full" if occupied >= maximum else "Partially Occupied"}


class RackCapacityUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    maximum_capacity: int = Field(gt=0, le=2147483647, strict=True)
    reason: str = Field(default="", max_length=1000)


async def _rack_in_zone(uow, zone_id, rack_id):
    try:
        ids = uuid.UUID(zone_id), uuid.UUID(rack_id)
    except ValueError:
        raise HTTPException(404, "Rack not found")
    rack = await uow.session.scalar(select(WarehouseRackModel).where(
        WarehouseRackModel.zone_id == ids[0], WarehouseRackModel.id == ids[1]).execution_options(populate_existing=True))
    if rack is None:
        raise HTTPException(404, "Rack not found")
    return rack


async def _lock_rack(uow, rack):
    # All stock endpoints lock physical bins before touching rack occupancy.
    await uow.session.execute(select(WarehouseBinModel).where(WarehouseBinModel.zone_id == rack.zone_id,
        func.upper(WarehouseBinModel.rack) == rack.rack_code).order_by(WarehouseBinModel.id).with_for_update())
    return await uow.session.scalar(select(WarehouseRackModel).where(WarehouseRackModel.id == rack.id)
        .with_for_update().execution_options(populate_existing=True))


@zone_router.delete("/{zone_id}/racks/{rack_id}")
async def delete_rack(zone_id: str, rack_id: str,
    user: CurrentUser = Depends(get_current_user), uow: UnitOfWork = Depends(get_uow)):
    from app.modules.storage.infrastructure.persistence.models import InventoryLocationBalanceModel as Balance, StorageLocationModel as Location
    _require_location_write(user)
    rack = await _rack_in_zone(uow, zone_id, rack_id)
    rack = await _lock_rack(uow, rack)
    if rack is None:
        raise HTTPException(404, "Rack not found")
    if rack.occupied_quantity > 0:
        raise HTTPException(409, "Move all material out of this rack before deleting it.")
    bins = (await uow.session.scalars(select(WarehouseBinModel).where(
        WarehouseBinModel.zone_id == rack.zone_id, func.upper(WarehouseBinModel.rack) == rack.rack_code).with_for_update())).all()
    from app.modules.storage.infrastructure.persistence.models import PutawayTaskModel, PutawayLocationAssignmentModel
    if bins:
        for model in (PutawayTaskModel, PutawayLocationAssignmentModel):
            if await uow.session.scalar(select(model.id).where(model.destination_bin_id.in_([item.id for item in bins])).limit(1)):
                raise HTTPException(409, "This rack is referenced by warehouse tasks and cannot be deleted.")
    locations = (await uow.session.scalars(select(Location).where(Location.bin_id.in_([item.id for item in bins])).with_for_update())).all() if bins else []
    if any(item.occupied_quantity > 0 for item in bins + locations):
        raise HTTPException(409, "Move all material out of this rack before deleting it.")
    if locations and await uow.session.scalar(select(Balance.id).where(
        Balance.storage_location_id.in_([item.id for item in locations])).limit(1)):
        raise HTTPException(409, "This rack has inventory references and cannot be deleted.")
    try:
        for location in locations:
            await uow.session.delete(location)
        await uow.session.flush()
        for item in bins:
            await uow.session.delete(item)
        await uow.session.flush()
        await uow.session.execute(delete(RackOccupancyEventModel).where(RackOccupancyEventModel.rack_id == rack.id))
        await uow.session.delete(rack)
        await uow.session.flush()
    except IntegrityError as exc:
        await uow.rollback()
        raise HTTPException(409, "This rack is referenced by warehouse tasks or history and cannot be deleted.") from exc
    return {"id": rack_id, "deleted": True}


@zone_router.put("/{zone_id}/racks/{rack_id}")
async def update_rack_capacity(zone_id: str, rack_id: str, payload: RackCapacityUpdate,
    user: CurrentUser = Depends(get_current_user), uow: UnitOfWork = Depends(get_uow)):
    _require_location_write(user)
    rack = await _rack_in_zone(uow, zone_id, rack_id)
    rack = await _lock_rack(uow, rack)
    if payload.maximum_capacity < rack.occupied_quantity:
        raise HTTPException(409, "Maximum capacity cannot be less than current occupancy")
    before = rack.maximum_capacity
    rack.maximum_capacity = payload.maximum_capacity
    bins = (await uow.session.scalars(select(WarehouseBinModel).where(WarehouseBinModel.zone_id == rack.zone_id,
        func.upper(WarehouseBinModel.rack) == rack.rack_code).with_for_update())).all()
    for bin_model in bins:
        bin_model.capacity = payload.maximum_capacity
    uow.session.add(RackOccupancyEventModel(rack_id=rack.id, quantity_delta=0, actor=user.username,
        reason=(f"Capacity {before} -> {payload.maximum_capacity} PCS" + (f": {payload.reason}" if payload.reason else ""))[:1000]))
    await uow.session.flush()
    return _rack_response(rack)


@zone_router.get("/{zone_id}/racks/{rack_id}/materials")
async def rack_materials(zone_id: str, rack_id: str, user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow)):
    from app.modules.storage.infrastructure.persistence.models import InventoryLocationBalanceModel as Balance, StorageLocationModel as Location
    from app.modules.receiving.infrastructure.persistence.models import GrnBatchQrModel, GrnBatchModel
    rack = await _rack_in_zone(uow, zone_id, rack_id)
    rows = (await uow.session.execute(select(Balance, Location, WarehouseBinModel)
        .join(Location, Location.id == Balance.storage_location_id).join(WarehouseBinModel, WarehouseBinModel.id == Location.bin_id)
        .where(WarehouseBinModel.zone_id == rack.zone_id, func.upper(WarehouseBinModel.rack) == rack.rack_code, Balance.quantity > 0)
        .order_by(Balance.material_code, Balance.batch_number))).all()
    items = []
    for balance, location, bin_model in rows:
        qr = await uow.session.scalar(select(GrnBatchQrModel.qr_code).join(GrnBatchModel, GrnBatchModel.id == GrnBatchQrModel.batch_id).where(
            GrnBatchQrModel.item_code == balance.material_code, GrnBatchModel.batch_number == balance.batch_number).limit(1))
        items.append({"balance_id": str(balance.id), "material_code": balance.material_code,
            "material_name": balance.material_name, "batch_number": balance.batch_number,
            "quantity": float(balance.quantity), "available_quantity": float(balance.available_quantity),
            "uom": balance.uom, "bin_code": bin_model.bin_code, "bin_id": str(bin_model.id),
            "rack_qr": bin_model.qr_identifier, "material_qr": qr, "location_code": location.location_code,
            "grn_number": balance.last_grn_number})
    return {**_rack_response(rack), "materials": items}


class EmptyRackRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    confirm: bool
    reason: str = Field(min_length=3, max_length=1000)


@zone_router.post("/{zone_id}/racks/{rack_id}/empty")
async def empty_rack(zone_id: str, rack_id: str, payload: EmptyRackRequest,
    user: CurrentUser = Depends(get_current_user), uow: UnitOfWork = Depends(get_uow)):
    _require_location_write(user)
    if not payload.confirm:
        raise HTTPException(422, "Confirm the inventory adjustment before emptying the rack")
    from app.modules.storage.infrastructure.api.inventory_router import perform_takeaway, TakeawayRequest
    from app.modules.storage.infrastructure.persistence.models import AssemblyStockReservationModel
    rack = await _rack_in_zone(uow, zone_id, rack_id)
    await _lock_rack(uow, rack)
    content = await rack_materials(zone_id, rack_id, user, uow)
    for item in content["materials"]:
        if item["quantity"] != item["available_quantity"]:
            raise HTTPException(409, "Release reserved or unavailable stock before emptying the rack")
        # Never remove stock allocated to an active assembly request.
        reservations = (await uow.session.scalars(select(AssemblyStockReservationModel).where(
            AssemblyStockReservationModel.material_code == item["material_code"],
            func.upper(AssemblyStockReservationModel.status).in_(["RESERVED", "ACTIVE", "RESERVED FOR ASSEMBLY"])))).all()
        if any(str(a.get("location_code", "")).upper() == item["location_code"].upper()
            for r in reservations for a in (r.allocations or []) if isinstance(a, dict)):
            raise HTTPException(409, "Release assembly reservations before emptying the rack")
    for item in content["materials"]:
        await perform_takeaway(TakeawayRequest(bin_scan=item["bin_code"], material_scan=item["material_code"],
            batch_number=item["batch_number"], quantity=Decimal(str(item["quantity"])),
            remarks="Authorized empty rack adjustment: " + payload.reason.strip(), reference_document="RACK_ADJUSTMENT"), user, uow)
    uow.session.add(RackOccupancyEventModel(rack_id=rack.id, quantity_delta=0, actor=user.username,
        reason=("Authorized empty rack adjustment: " + payload.reason.strip())[:1000]))
    await uow.session.flush()
    return await rack_materials(zone_id, rack_id, user, uow)


@zone_router.get("/{zone_id}/racks/{rack_id}/history")
async def rack_history(zone_id: str, rack_id: str, user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow)):
    rack = await _rack_in_zone(uow, zone_id, rack_id)
    rows = (await uow.session.scalars(select(RackOccupancyEventModel).where(RackOccupancyEventModel.rack_id == rack.id)
        .order_by(RackOccupancyEventModel.id.desc()).limit(200))).all()
    return [{"id": r.id, "quantity_delta": float(r.quantity_delta), "reason": r.reason,
        "actor": r.actor, "balance_id": r.balance_id, "created_at": r.created_at.isoformat()} for r in rows]


class RackMoveRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    source_scan: str = Field(min_length=1, max_length=4000)
    material_scan: str = Field(min_length=1, max_length=10000)
    destination_scan: str | None = Field(default=None, max_length=4000)
    quantity: int = Field(gt=0, strict=True)
    reason: str = Field(min_length=3, max_length=1000)


@zone_router.post("/{zone_id}/racks/{rack_id}/move")
async def move_rack_material(zone_id: str, rack_id: str, payload: RackMoveRequest,
    user: CurrentUser = Depends(get_current_user), uow: UnitOfWork = Depends(get_uow)):
    _require_location_write(user)
    from app.modules.storage.infrastructure.api.inventory_router import (
        perform_takeaway, TakeawayRequest, perform_bin_to_bin_transfer, BinTransferRequest)
    content = await rack_materials(zone_id, rack_id, user, uow)
    source = await uow.session.scalar(select(WarehouseBinModel).where(WarehouseBinModel.zone_id == uuid.UUID(zone_id),
        func.upper(WarehouseBinModel.rack) == content["rack_code"],
        WarehouseBinModel.qr_identifier == payload.source_scan))
    if source is None:
        raise HTTPException(422, "Scan the QR for this rack")
    fields = {}
    try:
        import json
        parsed = json.loads(payload.material_scan)
        if isinstance(parsed, dict):
            fields = parsed
    except ValueError:
        for line in payload.material_scan.splitlines():
            key, separator, value = line.partition(":")
            if separator:
                fields[key.strip().lower().replace(" ", "_")] = value.strip()
    material = fields.get("material_code") or fields.get("item_code")
    batch = fields.get("batch_number") or fields.get("batch")
    item = next((item for item in content["materials"] if item["bin_id"] == str(source.id) and (
        item["material_qr"] == payload.material_scan or
        (item["material_qr"] and material == item["material_code"] and batch == item["batch_number"]))), None)
    if item is None:
        raise HTTPException(422, "Scan a saved batch-specific QR for material stored in this rack")
    if payload.destination_scan:
        destination = await uow.session.scalar(select(WarehouseBinModel).where(WarehouseBinModel.qr_identifier == payload.destination_scan))
        if destination is None:
            raise HTTPException(422, "Scan a valid destination rack QR")
        result = await perform_bin_to_bin_transfer(BinTransferRequest(material_code=item["material_code"],
            batch_number=item["batch_number"], source_bin_code=source.bin_code, source_warehouse_ref_id=str(source.warehouse_ref_id),
            destination_bin_code=destination.bin_code, destination_warehouse_ref_id=str(destination.warehouse_ref_id),
            quantity=payload.quantity, reason="Other", remarks=payload.reason,
            scanned_material_qr=item["material_qr"], scanned_source_bin_qr=payload.source_scan,
            scanned_dest_bin_qr=payload.destination_scan), user, uow)
    else:
        result = await perform_takeaway(TakeawayRequest(bin_scan=source.qr_identifier,
            material_scan=item["material_qr"], batch_number=item["batch_number"], quantity=payload.quantity,
            remarks=payload.reason, reference_document="RACK_PICK"), user, uow)
    uow.session.add(RackOccupancyEventModel(rack_id=uuid.UUID(rack_id), quantity_delta=0,
        actor=user.username, reason=f"{'Transfer' if payload.destination_scan else 'Pick'} {payload.quantity} PCS; {item['material_code']}; {item['batch_number']}; QR {item['material_qr']}: {payload.reason}"[:1000]))
    await uow.session.flush()
    return result
