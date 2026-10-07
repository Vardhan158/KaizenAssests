"""
Unit tests for the complete Gate Entry module.
Tests for PO Document OCR Scanning & Manual Vehicle Plate Entry.
"""
from __future__ import annotations

import re
try:
    import pytest
except ImportError:
    class _PytestMock:
        @staticmethod
        def raises(exc_type):
            class _RaisesCtx:
                def __enter__(self):
                    return self
                def __exit__(self, exc_type_val, exc_val, traceback):
                    if exc_val is None:
                        raise AssertionError(f"Expected exception {exc_type} was not raised")
                    if not isinstance(exc_val, exc_type):
                        return False
                    self.value = exc_val
                    return True
            return _RaisesCtx()
    pytest = _PytestMock()

from app.common.domain.exceptions import DomainRuleViolationException, NotFoundException
from app.modules.gate.adapters.mock_adapters import (
    InMemoryGateEntryRepository,
    MockOcrEngine,
    MockPoRepository,
)
from app.modules.gate.application.ocr_pipeline import EnterprisePoOcrEngine
from app.modules.gate.domain.aggregate import GateEntry, generate_gate_entry_number
from app.modules.gate.domain.events import GateEntryReadyForReceivingEvent
from app.modules.gate.domain.services import GateVerificationService
from app.modules.gate.domain.value_objects import (
    FieldMismatch,
    GateEntryStatus,
    OcrResult,
    PurchaseOrderRecord,
)


def test_gate_entry_number_generation():
    """Verify GE-YYYYMMDD-<6-HEX-SUFFIX> format."""
    entry_num = generate_gate_entry_number()
    pattern = r"^GE-\d{8}-[0-9A-F]{6}$"
    assert re.match(pattern, entry_num), f"Entry number '{entry_num}' does not match pattern '{pattern}'"


def test_full_match_po_verification():
    """Test 100% match between extracted OCR and canonical PO database record."""
    po_repo = MockPoRepository()
    po_record = po_repo.find_po_by_number("PO-1001")
    assert po_record is not None

    ocr_res = OcrResult(
        po_number="PO-1001",
        supplier_name="Rolls-Royce Power Systems",
        material_description="Transformer Cores",
        total_quantity=12.0,
        po_date="2026-08-01",
        delivery_date="2026-08-15",
        confidence=0.98,
    )

    status, mismatches, po_num = GateVerificationService.compare_ocr_against_po(ocr_res, po_record)

    assert status == GateEntryStatus.PO_VERIFIED
    assert len(mismatches) == 0
    assert po_num == "PO-1001"


def test_field_mismatch_detection():
    """Test 6-field comparison identifying mismatched supplier and quantity returns UNSCHEDULED_ARRIVAL."""
    po_repo = MockPoRepository()
    po_record = po_repo.find_po_by_number("PO-1001")

    # Mismatched supplier name and total quantity
    ocr_res = OcrResult(
        po_number="PO-1001",
        supplier_name="Wrong Supplier Inc",
        material_description="Transformer Cores",
        total_quantity=999.0,
        po_date="2026-08-01",
        delivery_date="2026-08-15",
        confidence=0.95,
    )

    status, mismatches, po_num = GateVerificationService.compare_ocr_against_po(ocr_res, po_record)

    assert status == GateEntryStatus.UNSCHEDULED_ARRIVAL
    assert len(mismatches) == 2
    mismatched_names = {m.field_name for m in mismatches}
    assert "supplier_name" in mismatched_names
    assert "total_quantity" in mismatched_names


def test_unscheduled_arrival_missing_po():
    """When extracted PO is not found in DB, set status UNSCHEDULED_ARRIVAL."""
    po_repo = MockPoRepository()
    po_record = po_repo.find_po_by_number("NON-EXISTENT-PO")

    ocr_res = OcrResult(
        po_number="NON-EXISTENT-PO",
        supplier_name="Unknown Supplier",
        material_description="Unknown Item",
        total_quantity=10.0,
        po_date="2026-08-01",
        delivery_date="2026-08-01",
        confidence=0.90,
    )

    status, mismatches, po_num = GateVerificationService.compare_ocr_against_po(ocr_res, po_record)

    assert status == GateEntryStatus.UNSCHEDULED_ARRIVAL
    assert po_num is None

    entry = GateEntry.create(
        vehicle_plate="KA-01-MJ-8899",
        created_by="officer1",
        po_number=None,
        po_id=None,
        status=status,
    )

    assert entry.status == GateEntryStatus.UNSCHEDULED_ARRIVAL
    assert entry.po_id is None


def test_active_duplicate_entry_prevention():
    """Should reject duplicate active gate entry for same PO number, but allow same vehicle with different PO."""
    repo = InMemoryGateEntryRepository()

    existing_entry = GateEntry.create(
        vehicle_plate="MH-12-AB-1234",
        created_by="officer1",
        po_number="PO-1001",
        status=GateEntryStatus.UNSCHEDULED_ARRIVAL,
    )
    repo.save(existing_entry)

    active_entries = repo.find_active_by_po_or_plate(
        po_number="PO-1001", vehicle_plate="MH-12-AB-1234"
    )

    # 1. Duplicate PO should be rejected
    with pytest.raises(DomainRuleViolationException) as exc_info:
        GateVerificationService.check_duplicate_active_entry(
            active_entries, po_number="PO-1001"
        )
    assert "Active gate entry attempt" in str(exc_info.value)

    # 2. Same vehicle with different PO should be allowed without raising an exception
    GateVerificationService.check_duplicate_active_entry(
        active_entries, po_number="PO-9999", vehicle_plate="MH-12-AB-1234"
    )


def test_outbox_event_emitted_on_approval():
    """Verify GateEntryReadyForReceivingEvent is emitted upon approval."""
    entry = GateEntry.create(
        vehicle_plate="KA-05-AB-9999",
        created_by="officer1",
        po_number="PO-1002",
        status=GateEntryStatus.UNSCHEDULED_ARRIVAL,
    )


    assert len(entry.domain_events) == 0

    entry.approve(supervisor_id="super1", remarks="Documents verified manually")

    assert entry.status == GateEntryStatus.APPROVED
    assert len(entry.domain_events) == 1

    event = entry.domain_events[0]
    assert isinstance(event, GateEntryReadyForReceivingEvent)
    assert event.vehicle_plate == "KA-05-AB-9999"
    assert event.po_number == "PO-1002"
    assert "WAREHOUSE_MANAGER" in event.target_roles


def test_po_ocr_pipeline_image_validation():
    """Test image byte length and format validation."""
    engine = EnterprisePoOcrEngine()

    # Image too small (< 50 bytes)
    with pytest.raises(DomainRuleViolationException) as exc1:
        engine.preprocess_image(b"tiny")
    assert "too small" in str(exc1.value).lower()



def test_mark_entry_as_unscheduled_arrival():
    """Verify GateEntry transitions to UNSCHEDULED_ARRIVAL when marked by supervisor."""
    entry = GateEntry.create(
        vehicle_plate="KA-01-AB-1234",
        created_by="officer1",
        po_number="PO-1001",
        status=GateEntryStatus.UNSCHEDULED_ARRIVAL,
    )
    assert entry.status == GateEntryStatus.UNSCHEDULED_ARRIVAL

    entry.mark_unscheduled(supervisor_id="supervisor1", remarks="Moved to unscheduled")

    assert entry.status == GateEntryStatus.UNSCHEDULED_ARRIVAL
    assert entry.verified_by == "supervisor1"


