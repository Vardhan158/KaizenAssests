"""
Pydantic Schemas for Gate Entry API.
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class GateCheckInCreateDTO(BaseModel):
    warehouse_id: str = Field(..., example="WH-MAIN")
    vehicle_number: str = Field(..., example="MH-12-AB-1234")
    driver_name: str = Field(..., example="Dave Miller")
    driver_phone: str = Field(..., example="+1555987654")
    supplier_name: Optional[str] = Field(None, example="Acme Supplies")
    asn_id: Optional[str] = Field(None, example="ASN-101")
    po_id: Optional[str] = Field(None, example="PO-20260812-1001")
    security_officer_id: Optional[str] = Field(None, example="SEC-01")
    verification_notes: Optional[str] = Field(None, example="Driver ID and vehicle documents verified")


class GateDockAssignDTO(BaseModel):
    dock_id: str = Field(..., example="DOCK-04")


class WeighbridgeRecordDTO(BaseModel):
    gross_weight_kg: Decimal = Field(..., example=12500.50)
    tare_weight_kg: Decimal = Field(Decimal("0.00"), example=4200.00)


class GateEntryResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    gate_entry_number: str
    warehouse_id: str
    vehicle_number: str
    supplier_name: str
    driver_name: str
    driver_phone: str
    asn_id: Optional[str] = None
    asn_number: Optional[str] = None
    po_id: Optional[str] = None
    po_number: Optional[str] = None
    supplier_id: Optional[str] = None
    assigned_dock_id: Optional[str] = None
    security_officer_id: Optional[str] = None
    verification_notes: Optional[str] = None
    status: str
    entry_time: datetime
    exit_time: Optional[datetime] = None
    gross_weight_kg: Decimal
    tare_weight_kg: Decimal
    net_weight_kg: Decimal
    created_at: datetime
    updated_at: datetime


class GateEntryListResponseDTO(BaseModel):
    items: list[GateEntryResponseDTO]
    total: int
    skip: int
    limit: int
