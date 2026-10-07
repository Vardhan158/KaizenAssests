from datetime import datetime
from decimal import Decimal
from typing import List, Optional
import uuid

from pydantic import BaseModel, Field


class CreateDockMasterRequest(BaseModel):
    dock_code: str = Field(..., min_length=1, max_length=32)
    dock_name: str = Field(..., min_length=1, max_length=128)
    dock_type: str = Field(..., min_length=1, max_length=32)
    location: Optional[str] = Field(None, max_length=128)
    description: Optional[str] = None
    status: str = Field(..., min_length=1, max_length=32)
    is_active: bool = True


class UpdateDockStatusRequest(BaseModel):
    status: str = Field(..., max_length=32)
    reason: Optional[str] = None


class UpdateDockMasterRequest(BaseModel):
    dock_code: Optional[str] = Field(None, min_length=1, max_length=32)
    dock_name: Optional[str] = Field(None, min_length=1, max_length=128)
    dock_type: Optional[str] = Field(None, max_length=32)
    location: Optional[str] = Field(None, max_length=128)
    description: Optional[str] = None
    is_active: Optional[bool] = None


class AutoCreateAllocationRequest(BaseModel):
    gate_pass_id: str
    vehicle_number: str
    vendor_reference: Optional[str] = None
    material_reference: Optional[str] = None
    material_description: Optional[str] = None
    quantity: Optional[Decimal] = None
    priority: str = "NORMAL"


class AllocateDockRequest(BaseModel):
    allocation_request_id: uuid.UUID
    dock_id: uuid.UUID
    assigned_store_id: uuid.UUID
    store_manager_id: Optional[str] = None
    store_manager_username: Optional[str] = None
    store_manager_name: Optional[str] = None


class ReassignDockRequest(BaseModel):
    new_dock_id: uuid.UUID
    reason: str = Field(..., min_length=1)


class AllocationRequestResponse(BaseModel):
    id: uuid.UUID
    existing_gate_pass_id: str
    vendor_reference: Optional[str] = None
    vehicle_number: str
    material_reference: Optional[str] = None
    material_description: Optional[str] = None
    quantity: Optional[Decimal] = None
    security_approved_at: datetime
    priority: str
    status: str
    assigned_dock_id: Optional[uuid.UUID] = None
    assigned_dock_code: Optional[str] = None
    assigned_store_id: Optional[uuid.UUID] = None
    assigned_store_code: Optional[str] = None
    assigned_store_name: Optional[str] = None
    assigned_store_manager_id: Optional[str] = None
    assigned_store_manager_username: Optional[str] = None
    assigned_store_manager_name: Optional[str] = None
    assigned_by: Optional[str] = None
    assigned_at: Optional[datetime] = None
    arrived_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    released_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancellation_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DockMasterResponse(BaseModel):
    id: uuid.UUID
    dock_code: str
    dock_name: str
    dock_type: str
    location: Optional[str] = None
    description: Optional[str] = None
    status: str
    is_active: bool
    store_id: Optional[uuid.UUID] = None
    store_code: Optional[str] = None
    store_name: Optional[str] = None
    assigned_store_id: Optional[uuid.UUID] = None
    assigned_store_code: Optional[str] = None
    assigned_store_name: Optional[str] = None
    assigned_store_manager_id: Optional[str] = None
    assigned_store_manager_username: Optional[str] = None
    assigned_store_manager_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    current_allocation: Optional[AllocationRequestResponse] = None

    class Config:
        from_attributes = True


class DockAllocationHistoryResponse(BaseModel):
    id: uuid.UUID
    allocation_request_id: uuid.UUID
    existing_gate_pass_id: Optional[str] = None
    vehicle_number: Optional[str] = None
    vendor_reference: Optional[str] = None
    dock_code: Optional[str] = None
    action: str
    previous_status: Optional[str] = None
    new_status: str
    performed_by: str
    performed_at: datetime
    remarks: Optional[str] = None

    class Config:
        from_attributes = True


class DockOverviewMetrics(BaseModel):
    total_docks: int
    available_docks: int
    occupied_docks: int
    reserved_docks: int
    maintenance_docks: int
    pending_allocations_count: int
