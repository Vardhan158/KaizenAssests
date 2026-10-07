from __future__ import annotations
from pydantic import BaseModel, Field
from datetime import datetime

class DispatchItemDTO(BaseModel):
    material_code: str
    material_name: str
    quantity_ordered: float = 0.0
    quantity_available: float = 0.0
    quantity_reserved: float = 0.0
    quantity_picked: float = 0.0
    quantity_packed: float = 0.0
    quantity_loaded: float = 0.0
    quantity_pending: float = 0.0
    uom: str = "PCS"
    batch: str | None = None
    bin: str | None = None

class CreateDispatchCommand(BaseModel):
    order_number: str
    customer_name: str
    warehouse_id: str = "WH-01"
    dispatch_type: str | None = "Standard"
    items: list[DispatchItemDTO] = Field(default_factory=list)
    delivery_address: str | None = None
    destination: str | None = None
    scheduled_date: datetime | None = None
    expected_delivery_date: datetime | None = None
    priority: str = "Normal"
    dispatch_number: str | None = None
    contact_person: str | None = None
    contact_phone: str | None = None
    delivery_instructions: str | None = None
    transport_mode: str | None = "Road"
    transport_type: str | None = "Full Truckload"
    transporter: str | None = None
    notes: str | None = None

class PickItemEntry(BaseModel):
    id: str | None = None
    material_code: str | None = None
    quantity_picked: float

class PickItemsCommand(BaseModel):
    items: list[PickItemEntry]

class PackItemEntry(BaseModel):
    id: str | None = None
    material_code: str | None = None
    quantity_packed: float

class PackItemsCommand(BaseModel):
    items: list[PackItemEntry]

class AllocateDriverCommand(BaseModel):
    driver_id: str

class AllocateVehicleCommand(BaseModel):
    vehicle_id: str

class AssignRouteCommand(BaseModel):
    route_code: str

class CreateDriverCommand(BaseModel):
    driver_name: str
    license_number: str
    phone: str
    email: str | None = None
    license_type: str = "Heavy"
    is_active: bool = True
    photo_path: str | None = None
    address: str | None = None
    aadhaar_number: str | None = None
    rating: float = 5.0

class CreateVehicleCommand(BaseModel):
    vehicle_number: str
    vehicle_type: str = "Truck"
    ownership_type: str = "Owned"
    capacity_tons: float = 10.0
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
