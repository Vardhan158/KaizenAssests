from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import uuid

class VehicleStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    ASSIGNED = "ASSIGNED"
    LOADING = "LOADING"
    IN_TRANSIT = "IN_TRANSIT"
    MAINTENANCE = "MAINTENANCE"

@dataclass
class Vehicle:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    vehicle_number: str = ""
    vehicle_type: str = "Truck"
    ownership_type: str = "Owned"
    capacity_tons: float = 10.0
    status: VehicleStatus = VehicleStatus.AVAILABLE
    is_active: bool = True
    insurance_valid: bool = True
    fitness_valid: bool = True
    permit_valid: bool = True
    puc_valid: bool = True
    gps_available: bool = True
    rc_number: str | None = None
    chassis_number: str | None = None
    registration_date: str | None = None
    registration_expiry_date: str | None = None
    insurance_expiry: str | None = None
    fitness_expiry: str | None = None
    permit_expiry: str | None = None
    puc_expiry: str | None = None
    rc_book_number: str | None = None
    current_driver_id: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @classmethod
    def create(
        cls,
        vehicle_number: str,
        vehicle_type: str = "Truck",
        ownership_type: str = "Owned",
        capacity_tons: float = 10.0,
        status: VehicleStatus = VehicleStatus.AVAILABLE,
        is_active: bool = True,
        insurance_valid: bool = True,
        fitness_valid: bool = True,
        permit_valid: bool = True,
        puc_valid: bool = True,
        gps_available: bool = True,
        rc_number: str | None = None,
        chassis_number: str | None = None,
        registration_date: str | None = None,
        registration_expiry_date: str | None = None,
        insurance_expiry: str | None = None,
        fitness_expiry: str | None = None,
        permit_expiry: str | None = None,
        puc_expiry: str | None = None,
        rc_book_number: str | None = None,
        vehicle_id: str | None = None,
    ) -> Vehicle:
        if not vehicle_number:
            raise ValueError("Vehicle number is required")
        return cls(
            id=vehicle_id or str(uuid.uuid4()),
            vehicle_number=vehicle_number,
            vehicle_type=vehicle_type,
            ownership_type=ownership_type,
            capacity_tons=capacity_tons,
            status=status,
            is_active=is_active,
            insurance_valid=insurance_valid,
            fitness_valid=fitness_valid,
            permit_valid=permit_valid,
            puc_valid=puc_valid,
            gps_available=gps_available,
            rc_number=rc_number,
            chassis_number=chassis_number,
            registration_date=registration_date,
            registration_expiry_date=registration_expiry_date,
            insurance_expiry=insurance_expiry,
            fitness_expiry=fitness_expiry,
            permit_expiry=permit_expiry,
            puc_expiry=puc_expiry,
            rc_book_number=rc_book_number,
        )
