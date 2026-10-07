"""
Pydantic DTO Schemas for Outbound Dispatch and Gate Exit module.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class ConfirmGateExitRequest(BaseModel):
    vehicle_verified: bool = Field(..., description="Must be True to confirm vehicle plate matches dispatch manifest")
    driver_verified: bool = Field(..., description="Must be True to confirm driver matches manifest")
    remarks: Optional[str] = Field(None, description="Optional security officer verification remarks")


class ReportMismatchRequest(BaseModel):
    verification_result: str = Field(..., description="VEHICLE_MISMATCH, DRIVER_MISMATCH, or BOTH_MISMATCH")
    mismatch_reason: str = Field(..., description="Security officer detailed observations/reason for flagging mismatch")
    actual_vehicle: Optional[str] = Field(None, description="Observed vehicle plate if different")
    actual_driver: Optional[str] = Field(None, description="Observed driver name if different")


class ResolveMismatchRequest(BaseModel):
    resolution_action: str = Field(..., description="UPDATE_MANIFEST or CONFIRM_CLEARED")
    resolution_notes: str = Field(..., description="Dispatch team explanation of resolution")
    new_vehicle_number: Optional[str] = Field(None, description="Updated vehicle plate when action is UPDATE_MANIFEST")
    new_driver_name: Optional[str] = Field(None, description="Updated driver name when action is UPDATE_MANIFEST")
    new_driver_phone: Optional[str] = Field(None, description="Updated driver phone when action is UPDATE_MANIFEST")


class OutboundGateExitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dispatch_id: str
    security_officer_id: str
    vehicle_verified: bool
    driver_verified: bool
    remarks: Optional[str] = None
    status: str
    exit_completed_at: str
    created_at: str


class OutboundGateExitExceptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dispatch_id: str
    dispatch_number: str
    expected_vehicle: str
    expected_driver: str
    actual_vehicle: Optional[str] = None
    actual_driver: Optional[str] = None
    verification_result: str
    mismatch_reason: str
    security_officer_id: str
    status: str
    resolution_action: Optional[str] = None
    resolution_notes: Optional[str] = None
    resolved_by: Optional[str] = None
    resolved_at: Optional[str] = None
    created_at: str
    updated_at: str


class OutboundDispatchResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dispatch_number: str
    customer_name: str
    order_reference: str
    vehicle_number: str
    driver_name: str
    driver_phone: Optional[str] = None
    loading_status: str
    status: str
    items_summary: Optional[str] = None
    destination_address: Optional[str] = None
    seal_number: Optional[str] = None
    eway_bill: Optional[str] = None
    transporter: Optional[str] = None
    gross_weight: Optional[str] = None
    dock_bay: Optional[str] = None
    warehouse_id: str
    ready_time: Optional[str] = None
    created_at: str
    updated_at: str
    gate_exit: Optional[OutboundGateExitResponse] = None
    active_exception: Optional[OutboundGateExitExceptionResponse] = None
