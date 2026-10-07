"""
Pydantic schemas for Store Master, Store Zone, Store Bin, and Store Manager User accounts.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, Field


class StoreCreate(BaseModel):
    store_name: str = Field(..., min_length=2, max_length=128, description="Store display name")
    description: Optional[str] = Field(None, max_length=1000)
    warehouse_id: str = Field(default="Main Warehouse", max_length=64)
    store_manager_id: Optional[str] = Field(None, max_length=128)
    store_manager_name: Optional[str] = Field(None, max_length=128)
    status: str = Field(default="ACTIVE", max_length=32)
    store_type: str = Field(default="RAW_MATERIAL", max_length=64)
    store_code: Optional[str] = Field(None, description="System-generated code; client inputs are auto-assigned")


class StoreUpdate(BaseModel):
    store_name: Optional[str] = Field(None, min_length=2, max_length=128)
    description: Optional[str] = Field(None, max_length=1000)
    warehouse_id: Optional[str] = Field(None, max_length=64)
    store_manager_id: Optional[str] = Field(None, max_length=128)
    store_manager_name: Optional[str] = Field(None, max_length=128)
    status: Optional[str] = Field(None, max_length=32)
    store_type: Optional[str] = Field(None, max_length=64)



class StoreStatusUpdate(BaseModel):
    status: str = Field(..., max_length=32, description="ACTIVE or INACTIVE")


class StoreManagerAssign(BaseModel):
    store_manager_id: str = Field(..., max_length=128)
    store_manager_name: Optional[str] = Field(None, max_length=128)


class ZoneCreate(BaseModel):
    zone_name: str = Field(..., min_length=2, max_length=128, description="Zone name (e.g. High Voltage Bay)")
    description: Optional[str] = Field(None, max_length=1000)
    zone_code: Optional[str] = Field(None, max_length=64, description="Optional custom code or auto-generated STR-001-Z01")
    status: str = Field(default="ACTIVE", max_length=32)


class ZoneUpdate(BaseModel):
    zone_name: Optional[str] = Field(None, min_length=2, max_length=128)
    description: Optional[str] = Field(None, max_length=1000)
    status: Optional[str] = Field(None, max_length=32)


class ZoneStatusUpdate(BaseModel):
    status: str = Field(..., max_length=32, description="ACTIVE or INACTIVE")


class BinCreate(BaseModel):
    zone_id: Optional[str] = Field(None, description="Optional zone ID if posting directly to store bins endpoint")
    bin_name: str = Field(..., min_length=2, max_length=128, description="Bin name or description (e.g. Cable Reel Bin A1)")
    bin_code: Optional[str] = Field(None, max_length=64, description="Optional custom code or auto-generated BIN-E01-001")
    rack: Optional[str] = Field(None, max_length=64, description="Rack identifier e.g. R01")
    shelf: Optional[str] = Field(None, max_length=64, description="Shelf/Level identifier e.g. S01")
    capacity: Decimal = Field(default=Decimal("1000.0"), ge=0, description="Max storage capacity")
    status: str = Field(default="ACTIVE", max_length=32)


class BinUpdate(BaseModel):
    bin_name: Optional[str] = Field(None, min_length=2, max_length=128)
    rack: Optional[str] = Field(None, max_length=64)
    shelf: Optional[str] = Field(None, max_length=64)
    capacity: Optional[Decimal] = Field(None, ge=0)
    status: Optional[str] = Field(None, max_length=32)


class BinStatusUpdate(BaseModel):
    status: str = Field(..., max_length=32, description="ACTIVE or INACTIVE")


class BinResponse(BaseModel):
    id: str
    store_id: str
    zone_id: str
    bin_code: str
    bin_name: str
    rack: Optional[str] = None
    shelf: Optional[str] = None
    capacity: Decimal
    occupied_quantity: Decimal
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BinQRResponse(BaseModel):
    bin_id: str
    bin_code: str
    bin_name: str
    zone_id: str
    zone_code: str
    zone_name: str
    store_id: str
    store_code: str
    store_name: str
    warehouse_id: str
    rack: Optional[str] = None
    shelf: Optional[str] = None
    capacity: Decimal
    status: str
    qr_payload: str
    generated_at: datetime


class BinScanLookupRequest(BaseModel):
    scan_value: str = Field(..., min_length=1, description="Scanned QR payload, Bin UUID, or Bin Code")


class ZoneResponse(BaseModel):
    id: str
    store_id: str
    zone_code: str
    zone_name: str
    description: Optional[str] = None
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    bins_count: Optional[int] = 0

    class Config:
        from_attributes = True


class ZoneWithBinsResponse(BaseModel):
    id: str
    store_id: str
    zone_code: str
    zone_name: str
    description: Optional[str] = None
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    bins: List[BinResponse] = []

    class Config:
        from_attributes = True


class StoreResponse(BaseModel):
    id: str
    store_code: str
    store_name: str
    description: Optional[str] = None
    warehouse_id: str
    store_manager_id: Optional[str] = None
    store_manager_name: Optional[str] = None
    status: str
    store_type: str = "RAW_MATERIAL"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    zones_count: Optional[int] = 0
    bins_count: Optional[int] = 0

    class Config:
        from_attributes = True


class StoreWithZonesResponse(BaseModel):
    id: str
    store_code: str
    store_name: str
    description: Optional[str] = None
    warehouse_id: str
    store_manager_id: Optional[str] = None
    store_manager_name: Optional[str] = None
    status: str
    store_type: str = "RAW_MATERIAL"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    zones: List[ZoneWithBinsResponse] = []


    class Config:
        from_attributes = True


class StoreManagerOption(BaseModel):
    manager_id: str
    manager_name: str
    email: Optional[str] = None
    assigned_store_code: Optional[str] = None


class StoreManagerCreate(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=128)
    employee_id: str = Field(..., min_length=2, max_length=64)
    username: str = Field(..., min_length=2, max_length=64)
    email: str = Field(..., min_length=3, max_length=128)
    password: str = Field(..., min_length=4, max_length=128)
    store_id: str = Field(..., description="UUID or Store Code of assigned store")
    status: str = Field(default="ACTIVE", max_length=32)
    role: str = Field(default="Store Manager", max_length=64)
    applications: List[str] = Field(default_factory=lambda: ["WMS"])


class StoreManagerUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=2, max_length=128)
    email: Optional[str] = Field(None, min_length=3, max_length=128)
    password: Optional[str] = Field(None, min_length=4, max_length=128)
    store_id: Optional[str] = Field(None, description="UUID or Store Code of assigned store")
    status: Optional[str] = Field(None, max_length=32)
    role: Optional[str] = Field(None, max_length=64)
    applications: Optional[List[str]] = None


class StoreManagerStatusUpdate(BaseModel):
    status: str = Field(..., max_length=32, description="ACTIVE or INACTIVE")


class StoreManagerUserResponse(BaseModel):
    id: str
    employee_id: str
    username: str
    full_name: str
    email: str
    store_id: str
    store_code: Optional[str] = None
    store_name: Optional[str] = None
    manager_id: Optional[str] = None
    manager_name: Optional[str] = None
    status: str
    role: str = "Store Manager"
    applications: List[str] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


StoreManagerResponse = StoreManagerUserResponse


class ZoneQRResponse(BaseModel):
    zone_id: str
    zone_code: str
    zone_name: str
    store_id: str
    store_code: str
    store_name: str
    warehouse_id: str
    status: str
    qr_payload: str
    generated_at: datetime


class ZoneScanLookupRequest(BaseModel):
    scan_value: str = Field(..., min_length=1, description="Scanned QR payload, Zone UUID, or Zone Code")


class StoreDashboardKPIs(BaseModel):
    total_skus: int = 0
    total_quantity: float = 0.0
    available_quantity: float = 0.0
    quarantined_quantity: float = 0.0
    damaged_quantity: float = 0.0
    low_stock_items: int = 0
    zones_count: int = 0
    bins_count: int = 0
    occupied_bins_count: int = 0
    available_bins_count: int = 0


class StoreInventoryItem(BaseModel):
    id: str
    material_code: str
    material_name: str
    category: str = "GENERAL"
    quantity: float = 0.0
    available_quantity: float = 0.0
    reserved_quantity: float = 0.0
    uom: str = "PCS"
    zone_code: Optional[str] = None
    zone_name: Optional[str] = None
    bin_code: Optional[str] = None
    bin_name: Optional[str] = None
    status: str = "HEALTHY"
    last_updated: Optional[str] = None


class StoreAssemblyReservationItem(BaseModel):
    id: str
    requisition_id: str
    requisition_item_id: str
    requisition_number: str
    material_code: str
    material_name: str
    required_quantity: float
    reserved_quantity: float
    uom: str = "PCS"
    status: str = "RESERVED FOR ASSEMBLY"
    store_id: Optional[str] = None
    store_code: Optional[str] = None
    store_name: Optional[str] = None
    zone_code: Optional[str] = None
    bin_code: Optional[str] = None
    location_code: Optional[str] = None
    reserved_by: str
    reserved_at: datetime


class StoreMovementActivity(BaseModel):
    id: str
    timestamp: str
    movement_type: str
    material_code: str
    material_name: str
    material_qr: Optional[str] = None
    from_location: Optional[str] = None
    to_location: Optional[str] = None
    quantity: float = 0.0
    uom: str = "PCS"
    stock_before: Optional[float] = None
    stock_after: Optional[float] = None
    operator: str = "System"
    reference_document: Optional[str] = None


class StoreDashboardMetricsResponse(BaseModel):
    store: StoreResponse
    kpis: StoreDashboardKPIs
    inventory_summary: List[StoreInventoryItem] = []
    assembly_reservations: List[StoreAssemblyReservationItem] = []
    recent_activity: List[StoreMovementActivity] = []
    assigned_docks_count: int = 0
