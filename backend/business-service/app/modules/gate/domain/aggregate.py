"""
GateEntry Aggregate Root and Gate Entry Number generator.
Refactored to remove ANPR and treat vehicle_plate as a mandatory manual input string.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from app.common.domain.aggregate_root import AggregateRoot
from app.common.domain.events import DomainEvent
from app.common.domain.exceptions import DomainRuleViolationException
from app.modules.gate.domain.events import GateEntryReadyForReceivingEvent
from app.modules.gate.domain.value_objects import (
    FieldMismatch,
    GateEntryStatus,
    OcrResult,
)


def generate_gate_entry_number(created_at: Optional[datetime] = None) -> str:
    """
    Generates a unique gate entry number with format GE-YYYYMMDD-<6-HEX-SUFFIX>.
    Example: GE-20260813-A8F32B
    """
    dt = created_at or datetime.now(timezone.utc)
    date_str = dt.strftime("%Y%m%d")
    hex_suffix = uuid.uuid4().hex[:6].upper()
    return f"GE-{date_str}-{hex_suffix}"


class GateEntry(AggregateRoot):
    def __init__(
        self,
        id: str,
        vehicle_plate: str,
        status: GateEntryStatus,
        created_by: str,
        driver_name: Optional[str] = "Driver",
        gate_entry_number: Optional[str] = None,
        po_id: Optional[str] = None,
        po_number: Optional[str] = None,
        asn_id: Optional[str] = None,
        asn_number: Optional[str] = None,
        assigned_dock_id: Optional[str] = None,
        truck_photo_base64: Optional[str] = None,
        ocr_result: Optional[OcrResult] = None,
        mismatched_fields: Optional[List[FieldMismatch]] = None,
        verified_by: Optional[str] = None,
        exited_at: Optional[datetime] = None,
        exited_by: Optional[str] = None,
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None,
    ) -> None:
        super().__init__()
        self.id = id
        self.created_at = created_at or datetime.now(timezone.utc)
        self.updated_at = updated_at or self.created_at
        self.gate_entry_number = gate_entry_number or generate_gate_entry_number(self.created_at)
        self.vehicle_plate = vehicle_plate
        self.driver_name = driver_name
        self.po_id = po_id
        self.po_number = po_number
        self.asn_id = asn_id
        self.asn_number = asn_number
        self.assigned_dock_id = assigned_dock_id
        self.truck_photo_base64 = truck_photo_base64
        self.status = status
        self.ocr_result = ocr_result
        self.mismatched_fields = mismatched_fields or []
        self.created_by = created_by
        self.verified_by = verified_by
        self.exited_at = exited_at
        self.exited_by = exited_by

    @classmethod
    def create(
        cls,
        vehicle_plate: str,
        created_by: str,
        driver_name: Optional[str] = "Driver",
        po_number: Optional[str] = None,
        po_id: Optional[str] = None,
        asn_id: Optional[str] = None,
        asn_number: Optional[str] = None,
        truck_photo_base64: Optional[str] = None,
        ocr_result: Optional[OcrResult] = None,
        status: GateEntryStatus = GateEntryStatus.UNSCHEDULED_ARRIVAL,
        mismatched_fields: Optional[List[FieldMismatch]] = None,

    ) -> GateEntry:
        """Create a new Gate Entry aggregate root."""
        if not vehicle_plate or not vehicle_plate.strip():
            raise DomainRuleViolationException("Vehicle plate number is required for gate entry")

        entry = cls(
            id=str(uuid.uuid4()),
            vehicle_plate=vehicle_plate.strip().upper(),
            driver_name=driver_name,
            status=status,
            created_by=created_by,
            po_id=po_id,
            asn_id=asn_id,
            asn_number=asn_number,
            po_number=po_number,
            truck_photo_base64=truck_photo_base64,
            ocr_result=ocr_result,
            mismatched_fields=mismatched_fields or [],
        )

        if status in (GateEntryStatus.PO_VERIFIED, GateEntryStatus.APPROVED):
            entry._emit_ready_event()

        return entry

    def update_verification_results(
        self,
        status: GateEntryStatus,
        po_id: Optional[str] = None,
        po_number: Optional[str] = None,
        mismatched_fields: Optional[List[FieldMismatch]] = None,
    ) -> None:
        """Update automated verification status and field mismatches."""
        self.status = status
        if po_id:
            self.po_id = po_id
        if po_number:
            self.po_number = po_number
        if mismatched_fields is not None:
            self.mismatched_fields = mismatched_fields
        self.updated_at = datetime.now(timezone.utc)

        if self.status in (GateEntryStatus.PO_VERIFIED, GateEntryStatus.APPROVED):
            self._emit_ready_event()

    def approve(self, supervisor_id: str, remarks: Optional[str] = None) -> None:
        """Manual supervisor approval for manual verification / field mismatches / unscheduled arrivals."""
        if self.status in (GateEntryStatus.APPROVED, GateEntryStatus.GATE_ENTRY_APPROVED, GateEntryStatus.REJECTED):
            raise DomainRuleViolationException(f"Gate entry is already in terminal status: {self.status}")

        self.status = GateEntryStatus.APPROVED
        self.verified_by = supervisor_id
        self.updated_at = datetime.now(timezone.utc)
        self._emit_ready_event()

    def approve_gate_entry(self, security_officer_id: str) -> None:
        """Approve a verified gate entry, including a permitted direct arrival."""
        if self.status != GateEntryStatus.UNSCHEDULED_ARRIVAL:
            self.status = GateEntryStatus.GATE_ENTRY_APPROVED
        self.verified_by = security_officer_id
        self.updated_at = datetime.now(timezone.utc)
        self._emit_ready_event()

    def move_to_inbound_queue(self) -> None:
        if self.status != GateEntryStatus.GATE_ENTRY_APPROVED:
            raise DomainRuleViolationException("Gate entry must be approved before awaiting a dock")
        self.status = GateEntryStatus.AWAITING_DOCK
        self.updated_at = datetime.now(timezone.utc)

    def assign_dock(self, dock_id: str) -> None:
        if self.status != GateEntryStatus.AWAITING_DOCK:
            raise DomainRuleViolationException("Only an arrival awaiting a dock can be assigned")
        if not dock_id or not dock_id.strip():
            raise DomainRuleViolationException("Dock id is required")
        self.assigned_dock_id = dock_id.strip().upper()
        self.status = GateEntryStatus.DOCK_ASSIGNED
        self.updated_at = datetime.now(timezone.utc)

    def start_moving_to_dock(self) -> None:
        if self.status != GateEntryStatus.DOCK_ASSIGNED:
            raise DomainRuleViolationException("Vehicle movement requires an assigned dock")
        if not self.assigned_dock_id:
            raise DomainRuleViolationException("Assigned dock is missing")
        self.status = GateEntryStatus.MOVING_TO_DOCK
        self.updated_at = datetime.now(timezone.utc)

    def check_in_at_dock(self) -> None:
        if self.status != GateEntryStatus.MOVING_TO_DOCK:
            raise DomainRuleViolationException("Vehicle must be moving to the dock before check-in")
        if not self.assigned_dock_id:
            raise DomainRuleViolationException("Assigned dock is missing")
        self.status = GateEntryStatus.AT_DOCK
        self.updated_at = datetime.now(timezone.utc)

    def start_unloading(self) -> None:
        if self.status != GateEntryStatus.AT_DOCK:
            raise DomainRuleViolationException("Vehicle must be checked in at the dock before unloading")
        self.status = GateEntryStatus.UNLOADING_IN_PROGRESS
        self.updated_at = datetime.now(timezone.utc)

    def require_quality_inspection(self) -> None:
        if self.status != GateEntryStatus.UNLOADING_IN_PROGRESS:
            raise DomainRuleViolationException("Quality inspection can only start during receiving")
        self.status = GateEntryStatus.QUALITY_INSPECTION_REQUIRED
        self.updated_at = datetime.now(timezone.utc)

    def complete_quality_inspection(self, passed: bool) -> None:
        if self.status != GateEntryStatus.QUALITY_INSPECTION_REQUIRED:
            raise DomainRuleViolationException("Shipment is not awaiting quality inspection")
        self.status = GateEntryStatus.QUALITY_PASSED if passed else GateEntryStatus.QUALITY_FAILED
        self.updated_at = datetime.now(timezone.utc)

    def complete_receiving(self) -> None:
        if self.status not in (GateEntryStatus.UNLOADING_IN_PROGRESS, GateEntryStatus.QUALITY_PASSED):
            raise DomainRuleViolationException("Receiving completion requires verified items and any required quality inspection to pass")
        self.status = GateEntryStatus.RECEIVING_COMPLETED
        self.updated_at = datetime.now(timezone.utc)

    def reject(self, supervisor_id: str, reason: str) -> None:
        """Reject gate entry attempt."""
        if not reason or not reason.strip():
            raise DomainRuleViolationException("Rejection reason must be provided")

        if self.status in (GateEntryStatus.APPROVED, GateEntryStatus.REJECTED):
            raise DomainRuleViolationException(f"Gate entry is already in terminal status: {self.status}")

        self.status = GateEntryStatus.REJECTED
        self.verified_by = supervisor_id
        self.updated_at = datetime.now(timezone.utc)

    def mark_unscheduled(self, supervisor_id: str, remarks: Optional[str] = None) -> None:
        """Transition gate entry status to UNSCHEDULED_ARRIVAL after supervisor review."""
        if self.status in (GateEntryStatus.APPROVED, GateEntryStatus.REJECTED):
            raise DomainRuleViolationException(f"Gate entry is already in terminal status: {self.status}")

        self.status = GateEntryStatus.UNSCHEDULED_ARRIVAL
        self.verified_by = supervisor_id
        self.updated_at = datetime.now(timezone.utc)


    def _emit_ready_event(self) -> None:
        event = GateEntryReadyForReceivingEvent(
            gate_entry_id=self.id,
            gate_entry_number=self.gate_entry_number,
            po_number=self.po_number,
            vehicle_plate=self.vehicle_plate,
            status=self.status.value if isinstance(self.status, GateEntryStatus) else str(self.status),
            occurred_at=DomainEvent.now(),
        )
        self._register_event(event)

    def mark_vehicle_exited(self, security_officer_id: str, exited_at: Optional[datetime] = None) -> None:
        eligible_statuses = {
            GateEntryStatus.RECEIVING_COMPLETED,
            GateEntryStatus.RELEASED,
            GateEntryStatus.DOCK_RELEASED,
            GateEntryStatus.COMPLETED,
            GateEntryStatus.QUALITY_PASSED,
            GateEntryStatus.UNLOADED,
        }
        if self.status == GateEntryStatus.VEHICLE_EXITED:
            raise DomainRuleViolationException("Vehicle has already exited.")
        if self.status not in eligible_statuses and (hasattr(self.status, "value") and self.status.value not in [s.value for s in eligible_statuses]):
            raise DomainRuleViolationException("Gate entry is not in an eligible post-receiving status for vehicle exit.")

        self.status = GateEntryStatus.VEHICLE_EXITED
        self.exited_at = exited_at or datetime.now(timezone.utc)
        self.exited_by = security_officer_id
        self.updated_at = datetime.now(timezone.utc)

    @classmethod
    def rehydrate(
        cls,
        id: str,
        gate_entry_number: str,
        vehicle_plate: str,
        status: GateEntryStatus,
        created_by: str,
        driver_name: Optional[str] = "Driver",
        po_id: Optional[str] = None,
        po_number: Optional[str] = None,
        asn_id: Optional[str] = None,
        asn_number: Optional[str] = None,
        assigned_dock_id: Optional[str] = None,
        truck_photo_base64: Optional[str] = None,
        ocr_result: Optional[OcrResult] = None,
        mismatched_fields: Optional[List[FieldMismatch]] = None,
        verified_by: Optional[str] = None,
        exited_at: Optional[datetime] = None,
        exited_by: Optional[str] = None,
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None,
    ) -> GateEntry:
        """Reconstruct GateEntry from persistence without raising events."""
        return cls(
            id=id,
            gate_entry_number=gate_entry_number,
            vehicle_plate=vehicle_plate,
            status=status,
            created_by=created_by,
            driver_name=driver_name,
            po_id=po_id,
            po_number=po_number,
            asn_id=asn_id,
            asn_number=asn_number,
            assigned_dock_id=assigned_dock_id,
            truck_photo_base64=truck_photo_base64,
            ocr_result=ocr_result,
            mismatched_fields=mismatched_fields,
            verified_by=verified_by,
            exited_at=exited_at,
            exited_by=exited_by,
            created_at=created_at,
            updated_at=updated_at,
        )
