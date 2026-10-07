"""
Value objects and enumerations for the Gate Entry module.
Refactored for PO Document OCR Scanning & Manual Vehicle Plate Entry.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class GateEntryStatus(str, Enum):
    PENDING_VERIFICATION = "PENDING_VERIFICATION"
    PO_VERIFIED = "PO_VERIFIED"
    FIELD_MISMATCH_DETECTED = "FIELD_MISMATCH_DETECTED"
    MANUAL_VERIFICATION_REQUIRED = "MANUAL_VERIFICATION_REQUIRED"
    UNSCHEDULED_ARRIVAL = "UNSCHEDULED_ARRIVAL"
    APPROVED = "APPROVED"
    GATE_ENTRY_APPROVED = "GATE_ENTRY_APPROVED"
    AWAITING_DOCK = "AWAITING_DOCK"
    DOCK_ASSIGNED = "DOCK_ASSIGNED"
    MOVING_TO_DOCK = "MOVING_TO_DOCK"
    AT_DOCK = "AT_DOCK"
    OCCUPIED = "OCCUPIED"
    UNLOADING_IN_PROGRESS = "UNLOADING_IN_PROGRESS"
    QUALITY_INSPECTION_REQUIRED = "QUALITY_INSPECTION_REQUIRED"
    QUALITY_PASSED = "QUALITY_PASSED"
    QUALITY_FAILED = "QUALITY_FAILED"
    RECEIVING_COMPLETED = "RECEIVING_COMPLETED"
    COMPLETED = "COMPLETED"
    RELEASED = "RELEASED"
    DOCK_RELEASED = "RELEASED"
    EXIT_APPROVED = "EXIT_APPROVED"
    GATE_EXIT_COMPLETED = "GATE_EXIT_COMPLETED"
    VEHICLE_EXITED = "VEHICLE_EXITED"
    REJECTED = "REJECTED"
    CHECKED_IN = "CHECKED_IN"
    UNLOADED = "UNLOADED"
    CHECKED_OUT = "CHECKED_OUT"
    DENIED_ENTRY = "DENIED_ENTRY"


@dataclass(frozen=True)
class OcrResult:
    po_number: Optional[str]
    supplier_name: Optional[str]
    material_description: Optional[str]
    total_quantity: Optional[float]
    po_date: Optional[str]
    delivery_date: Optional[str]
    confidence: float
    line_items: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class AnprResult:
    detected_vehicle_number: str
    confidence: float
    raw_metadata: dict[str, Any] = field(default_factory=dict)

    def is_high_confidence(self, threshold: float = 0.85) -> bool:
        return self.confidence >= threshold


@dataclass(frozen=True)
class FieldMismatch:
    field_name: str
    extracted_value: Any
    canonical_value: Any


@dataclass(frozen=True)
class PurchaseOrderRecord:
    po_number: str
    supplier_name: str
    material_description: str
    total_quantity: float
    po_date: str
    delivery_date: str
    status: str = "OPEN"
    po_id: Optional[str] = None


@dataclass(frozen=True)
class VerificationResult:
    status: GateEntryStatus
    verification_type: Any = None
    mismatched_fields: list[Any] = ()
    reasons: list[str] = ()


@dataclass(frozen=True)
class GateEntryId:
    value: str


@dataclass(frozen=True)
class VehicleNumber:
    value: str


@dataclass(frozen=True)
class DriverInfo:
    name: str
    license_number: Optional[str] = None
    phone: Optional[str] = None


