from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import uuid

class DriverStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    ASSIGNED = "ASSIGNED"
    ON_DUTY = "ON_DUTY"
    OFF_DUTY = "OFF_DUTY"
    IN_TRANSIT = "IN_TRANSIT"

@dataclass
class Driver:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    driver_name: str = ""
    license_number: str = ""
    phone: str = ""
    email: str | None = None
    license_type: str = "Heavy"
    is_active: bool = True
    photo_path: str | None = None
    address: str | None = None
    aadhaar_number: str | None = None
    status: DriverStatus = DriverStatus.AVAILABLE
    rating: float = 5.0
    assigned_vehicle_id: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @classmethod
    def create(
        cls,
        driver_name: str,
        license_number: str,
        phone: str,
        email: str | None = None,
        license_type: str = "Heavy",
        is_active: bool = True,
        photo_path: str | None = None,
        address: str | None = None,
        aadhaar_number: str | None = None,
        status: DriverStatus = DriverStatus.AVAILABLE,
        rating: float = 5.0,
        driver_id: str | None = None,
    ) -> Driver:
        if not driver_name or not license_number:
            raise ValueError("Driver name and license number are required")
        return cls(
            id=driver_id or str(uuid.uuid4()),
            driver_name=driver_name,
            license_number=license_number,
            phone=phone,
            email=email,
            license_type=license_type,
            is_active=is_active,
            photo_path=photo_path,
            address=address,
            aadhaar_number=aadhaar_number,
            status=status,
            rating=rating,
        )
