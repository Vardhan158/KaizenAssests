"""Validation shared by supplier ASN transport and gate admission."""
import re
import uuid

from fastapi import HTTPException
from sqlalchemy import func, select, text

from app.modules.gate.infrastructure.persistence.models import GateEntryModel


def normalize_vehicle(value: str) -> str:
    return re.sub(r"[\s-]+", "", value).upper()


def valid_vehicle(value: str) -> bool:
    value = normalize_vehicle(value)
    return bool(
        re.fullmatch(r"[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}", value)
        or re.fullmatch(r"[0-9]{2}BH[0-9]{4}[A-Z]{2}", value)
    )


def validate_transport(vehicle, driver, contact) -> tuple[str, str, str]:
    for field, value in (("vehicle_number", vehicle), ("driver_name", driver), ("driver_contact", contact)):
        if not isinstance(value, str) or not value.strip():
            raise HTTPException(422, f"{field} is required and must be text")
    if not valid_vehicle(vehicle):
        raise HTTPException(422, "Enter a valid Indian vehicle registration from any state, such as KA02AH2755, MH12A1234, or 22BH1234AA")
    driver = driver.strip()
    if not (2 <= len(driver) <= 100 and re.fullmatch(r"[A-Za-z .,'’\-]+", driver)
            and len(re.findall(r"[A-Za-z]", driver)) >= 2):
        raise HTTPException(422, "driver_name must contain 2–100 characters using letters, spaces and standard name punctuation")
    contact = contact.strip()
    if not re.fullmatch(r"[6-9][0-9]{9}", contact):
        raise HTTPException(422, "driver_contact must be a 10-digit Indian mobile number starting with 6–9")
    return normalize_vehicle(vehicle), re.sub(r" +", " ", driver), contact


async def validate_gate_duplicates(session, vehicle: str, asn_id: uuid.UUID | None) -> None:
    """Serialize admission checks and block an active pass for the same vehicle."""
    dialect = session.get_bind().dialect.name
    if dialect == "postgresql":
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": f"gate-vehicle:{normalize_vehicle(vehicle)}"},
        )
    elif dialect == "sqlite":
        # Obtain SQLite's writer reservation before checking for duplicates.
        await session.execute(text("UPDATE gate_entry SET status = status WHERE 0"))
    normalized_column = func.replace(func.replace(func.upper(GateEntryModel.vehicle_number), "-", ""), " ", "")
    duplicate_filters = [
        normalized_column == normalize_vehicle(vehicle),
        GateEntryModel.status.notin_(["REJECTED", "DENIED_ENTRY", "VEHICLE_EXITED", "GATE_EXIT_COMPLETED", "CHECKED_OUT"]),
    ]
    if asn_id is not None:
        duplicate_filters.append(GateEntryModel.asn_id == asn_id)
    existing = await session.scalar(
        select(GateEntryModel.gate_entry_number)
        .where(*duplicate_filters)
        .limit(1)
    )
    if existing:
        raise HTTPException(409, f"Vehicle {normalize_vehicle(vehicle)} already has active Gate Pass {existing}. Record its exit before creating another entry.")
