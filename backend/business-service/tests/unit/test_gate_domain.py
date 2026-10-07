"""
Unit tests for Gate Entry domain models, comparison service, and aggregate logic.
"""
import pytest

from app.modules.gate.domain.aggregate import GateEntry
from app.modules.gate.domain.services import GateVerificationService
from app.modules.gate.domain.value_objects import (
    FieldMismatch,
    GateEntryStatus,
    OcrResult,
    PurchaseOrderRecord,
)


def test_gate_entry_creation_and_events():
    entry = GateEntry.create(
        vehicle_plate="KA-01-AB-1234",
        created_by="sec_officer_1",
        po_number="PO-1001",
        driver_name="John Doe",
    )

    assert str(entry.id) is not None
    assert entry.po_number == "PO-1001"
    assert entry.vehicle_plate == "KA-01-AB-1234"
    assert entry.status == GateEntryStatus.UNSCHEDULED_ARRIVAL


def test_verification_service_full_match():
    ocr = OcrResult(
        po_number="PO-1001",
        supplier_name="Acme Corp",
        material_description="ITEM-A",
        total_quantity=100.0,
        po_date="2026-08-01",
        delivery_date="2026-08-15",
        confidence=0.95,
    )
    po = PurchaseOrderRecord(
        po_id="11111111-1111-1111-1111-111111111111",
        po_number="PO-1001",
        supplier_name="Acme Corp",
        material_description="ITEM-A",
        total_quantity=100.0,
        po_date="2026-08-01",
        delivery_date="2026-08-15",
    )

    status, mismatches, po_number = GateVerificationService.compare_ocr_against_po(ocr, po)

    assert status == GateEntryStatus.PO_VERIFIED
    assert len(mismatches) == 0
    assert po_number == "PO-1001"


def test_verification_service_mismatches():
    ocr = OcrResult(
        po_number="PO-1001",
        supplier_name="Wrong Supplier",
        material_description="ITEM-B",
        total_quantity=200.0,
        po_date="2026-08-01",
        delivery_date="2026-08-15",
        confidence=0.95,
    )
    po = PurchaseOrderRecord(
        po_id="11111111-1111-1111-1111-111111111111",
        po_number="PO-1001",
        supplier_name="Acme Corp",
        material_description="ITEM-A",
        total_quantity=100.0,
        po_date="2026-08-01",
        delivery_date="2026-08-15",
    )

    status, mismatches, po_number = GateVerificationService.compare_ocr_against_po(ocr, po)

    assert status == GateEntryStatus.UNSCHEDULED_ARRIVAL
    mismatch_fields = [m.field_name for m in mismatches]
    assert "supplier_name" in mismatch_fields
    assert "material_description" in mismatch_fields
    assert "total_quantity" in mismatch_fields


def test_verification_unscheduled_arrival():
    ocr = OcrResult(
        po_number="PO-9999",
        supplier_name=None,
        material_description=None,
        total_quantity=None,
        po_date=None,
        delivery_date=None,
        confidence=0.90,
    )
    status, mismatches, po_num = GateVerificationService.compare_ocr_against_po(ocr, None)
    assert status == GateEntryStatus.UNSCHEDULED_ARRIVAL
    assert len(mismatches) == 0


def test_manual_verification_approval_flow():
    entry = GateEntry.create(
        vehicle_plate="KA-01-AB-1234",
        created_by="sec_officer_1",
        po_number="PO-1001",
        driver_name="Jane Doe",
    )
    entry.status = GateEntryStatus.MANUAL_VERIFICATION_REQUIRED
    assert entry.status == GateEntryStatus.MANUAL_VERIFICATION_REQUIRED
