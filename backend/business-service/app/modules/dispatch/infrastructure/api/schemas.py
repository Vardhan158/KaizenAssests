from __future__ import annotations
from pydantic import BaseModel, Field
from datetime import datetime

class DispatchItemResponse(BaseModel):
    id: str
    material_code: str
    material_name: str
    quantity_ordered: float
    quantity_available: float
    quantity_reserved: float
    quantity_picked: float
    quantity_packed: float
    quantity_loaded: float
    quantity_pending: float
    uom: str
    batch: str | None = None
    bin: str | None = None
    status: str

    class Config:
        from_attributes = True

class DispatchOrderResponse(BaseModel):
    id: str
    dispatch_number: str
    order_number: str
    customer_name: str
    warehouse_id: str
    status: str
    items: list[DispatchItemResponse] = Field(default_factory=list)
    driver_id: str | None = None
    driver_name: str | None = None
    vehicle_id: str | None = None
    vehicle_number: str | None = None
    route_code: str | None = None
    delivery_address: str | None = None
    destination: str | None = None
    scheduled_date: datetime | None = None
    expected_delivery_date: datetime | None = None
    priority: str = "Normal"
    notes: str | None = None
    current_location: str | None = None
    distance_travelled_km: float = 0
    remaining_distance_km: float = 0
    eta_minutes: float = 0
    route_path: str | None = None
    route_deviation: str | None = None
    driver_status: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class DispatchListResponse(BaseModel):
    items: list[DispatchOrderResponse]
    total: int

class DriverResponse(BaseModel):
    id: str
    driver_name: str
    license_number: str
    phone: str
    email: str | None = None
    license_type: str = "Heavy"
    is_active: bool = True
    photo_path: str | None = None
    address: str | None = None
    aadhaar_number: str | None = None
    status: str
    rating: float
    assigned_vehicle_id: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class VehicleResponse(BaseModel):
    id: str
    vehicle_number: str
    vehicle_type: str
    ownership_type: str = "Owned"
    capacity_tons: float
    rc_number: str | None = None
    chassis_number: str | None = None
    registration_date: str | None = None
    registration_expiry_date: str | None = None
    insurance_expiry: str | None = None
    fitness_expiry: str | None = None
    permit_expiry: str | None = None
    puc_expiry: str | None = None
    rc_book_number: str | None = None
    puc_valid: bool = True
    insurance_valid: bool = True
    fitness_valid: bool = True
    permit_valid: bool = True
    gps_available: bool = True
    is_active: bool = True
    status: str
    current_driver_id: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
