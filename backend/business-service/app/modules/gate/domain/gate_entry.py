"""
Gate Entry Aggregate Root and domain logic.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
import random
import string
import uuid


class GateEntryStatus(str, Enum):
    CHECKED_IN = "CHECKED_IN"
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
    UNLOADED = "UNLOADED"
    RELEASED = "RELEASED"
    DOCK_RELEASED = "RELEASED"
    COMPLETED = "COMPLETED"
    EXIT_APPROVED = "EXIT_APPROVED"
    GATE_EXIT_COMPLETED = "GATE_EXIT_COMPLETED"
    VEHICLE_EXITED = "VEHICLE_EXITED"
    CHECKED_OUT = "CHECKED_OUT"
    REJECTED = "REJECTED"
    DENIED_ENTRY = "DENIED_ENTRY"


def generate_gate_entry_number() -> str:
    today_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    suffix = "".join(random.choices(string.digits, k=4))
    return f"GE-{today_str}-{suffix}"


@dataclass
class WeighbridgeData:
    gross_weight_kg: Decimal = Decimal("0.00")
    tare_weight_kg: Decimal = Decimal("0.00")

    @property
    def net_weight_kg(self) -> Decimal:
        return max(Decimal("0.00"), self.gross_weight_kg - self.tare_weight_kg)


@dataclass
class GateEntry:
    id: str
    gate_entry_number: str
    warehouse_id: str
    vehicle_number: str
    supplier_name: str
    driver_name: str
    driver_phone: str
    asn_id: str | None = None
    asn_number: str | None = None
    po_id: str | None = None
    po_number: str | None = None
    supplier_id: str | None = None
    assigned_dock_id: str | None = None
    security_officer_id: str | None = None
    verification_notes: str | None = None
    status: GateEntryStatus = GateEntryStatus.CHECKED_IN
    entry_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    exit_time: datetime | None = None
    weighbridge: WeighbridgeData = field(default_factory=WeighbridgeData)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    recorded_events: list[object] = field(default_factory=list, repr=False)

    @classmethod
    def create_check_in(
        cls,
        warehouse_id: str,
        vehicle_number: str,
        supplier_name: str,
        driver_name: str,
        driver_phone: str,
        asn_id: str | None = None,
        asn_number: str | None = None,
        po_id: str | None = None,
        po_number: str | None = None,
        supplier_id: str | None = None,
        security_officer_id: str | None = None,
        verification_notes: str | None = None,
        gate_entry_id: str | None = None,
    ) -> "GateEntry":
        if not warehouse_id or not vehicle_number or not vehicle_number.strip():
            raise ValueError("Warehouse ID and Vehicle Number are required for Gate Entry")

        return cls(
            id=gate_entry_id or f"GE-{uuid.uuid4().hex[:8].upper()}",
            gate_entry_number=generate_gate_entry_number(),
            warehouse_id=warehouse_id,
            vehicle_number=vehicle_number.strip().upper(),
            supplier_name=supplier_name,
            driver_name=driver_name,
            driver_phone=driver_phone,
            asn_id=asn_id,
            asn_number=asn_number,
            po_id=po_id,
            po_number=po_number,
            supplier_id=supplier_id,
            security_officer_id=security_officer_id,
            verification_notes=verification_notes,
            status=GateEntryStatus.CHECKED_IN,
        )

    def assign_dock(self, dock_id: str) -> None:
        if not dock_id or not dock_id.strip():
            raise ValueError("Dock ID is required")
        self.assigned_dock_id = dock_id.strip()
        self.status = GateEntryStatus.DOCK_ASSIGNED
        self.updated_at = datetime.now(timezone.utc)

    def record_weighbridge(self, gross_weight_kg: Decimal | float, tare_weight_kg: Decimal | float = 0.0) -> None:
        self.weighbridge.gross_weight_kg = Decimal(str(gross_weight_kg))
        self.weighbridge.tare_weight_kg = Decimal(str(tare_weight_kg))
        self.updated_at = datetime.now(timezone.utc)

    def mark_unloading(self) -> None:
        self.status = GateEntryStatus.UNLOADING_IN_PROGRESS
        self.updated_at = datetime.now(timezone.utc)

    def mark_unloaded(self) -> None:
        self.status = GateEntryStatus.UNLOADED
        self.updated_at = datetime.now(timezone.utc)

    def check_out(self) -> None:
        self.status = GateEntryStatus.CHECKED_OUT
        self.exit_time = datetime.now(timezone.utc)
        self.updated_at = datetime.now(timezone.utc)
