"""
Domain service for Gate Verification rules, 6-field OCR comparison, and active duplicate detection.
"""
from __future__ import annotations

from typing import List, Optional, Tuple

from app.common.domain.exceptions import DomainRuleViolationException
from app.modules.gate.domain.aggregate import GateEntry
from app.modules.gate.domain.value_objects import (
    FieldMismatch,
    GateEntryStatus,
    OcrResult,
    PurchaseOrderRecord,
)


class GateVerificationService:
    @staticmethod
    def compare_ocr_against_po(
        ocr_result: OcrResult,
        po_record: Optional[PurchaseOrderRecord],
    ) -> Tuple[GateEntryStatus, List[FieldMismatch], Optional[str]]:
        """
        Executes 6-field automated matching between extracted OCR result and canonical database record.
        Fields compared:
          1. PO Number
          2. Supplier Name
          3. Material Description
          4. Total Quantity
          5. PO Date
          6. Delivery Date

        Returns:
          (GateEntryStatus, list of FieldMismatch, canonical_po_number)
        """
        # IF PO NOT FOUND -> UNSCHEDULED_ARRIVAL
        if po_record is None or not ocr_result.po_number:
            return (GateEntryStatus.UNSCHEDULED_ARRIVAL, [], None)

        mismatches: List[FieldMismatch] = []

        # Helper normalizers
        def norm_str(val: Optional[str]) -> str:
            return (val or "").strip().upper()

        def norm_num(val: Optional[float]) -> float:
            return float(val or 0.0)

        # 1. PO Number
        if norm_str(ocr_result.po_number) != norm_str(po_record.po_number):
            mismatches.append(
                FieldMismatch("po_number", ocr_result.po_number, po_record.po_number)
            )

        # 2. Supplier Name
        if norm_str(ocr_result.supplier_name) != norm_str(po_record.supplier_name):
            mismatches.append(
                FieldMismatch("supplier_name", ocr_result.supplier_name, po_record.supplier_name)
            )

        # 3. Material Description
        if norm_str(ocr_result.material_description) != norm_str(po_record.material_description):
            mismatches.append(
                FieldMismatch(
                    "material_description",
                    ocr_result.material_description,
                    po_record.material_description,
                )
            )

        # 4. Total Quantity
        if abs(norm_num(ocr_result.total_quantity) - norm_num(po_record.total_quantity)) > 1e-4:
            mismatches.append(
                FieldMismatch(
                    "total_quantity",
                    ocr_result.total_quantity,
                    po_record.total_quantity,
                )
            )

        # 5. PO Date
        if norm_str(ocr_result.po_date) != norm_str(po_record.po_date):
            mismatches.append(
                FieldMismatch("po_date", ocr_result.po_date, po_record.po_date)
            )

        # 6. Delivery Date
        if norm_str(ocr_result.delivery_date) != norm_str(po_record.delivery_date):
            mismatches.append(
                FieldMismatch(
                    "delivery_date", ocr_result.delivery_date, po_record.delivery_date
                )
            )

        if mismatches:
            return (
                GateEntryStatus.UNSCHEDULED_ARRIVAL,
                mismatches,
                po_record.po_number,
            )

        return (GateEntryStatus.PO_VERIFIED, [], po_record.po_number)

    @staticmethod
    def check_duplicate_active_entry(
        active_entries: List[GateEntry],
        po_number: Optional[str],
        vehicle_plate: Optional[str] = None,
    ) -> None:
        """
        Active Duplicate Prevention: Detect an active/open Gate Entry attempt for
        the same PO and vehicle. A PO may legitimately arrive in more than one
        vehicle, so a different vehicle must be allowed through the gate.
        """
        terminal_statuses = {
            GateEntryStatus.VEHICLE_EXITED,
            GateEntryStatus.GATE_EXIT_COMPLETED,
            GateEntryStatus.CHECKED_OUT,
            GateEntryStatus.REJECTED,
            GateEntryStatus.DENIED_ENTRY,
        }

        for entry in active_entries:
            if entry.status not in terminal_statuses:
                if (
                    po_number
                    and vehicle_plate
                    and entry.po_number
                    and entry.vehicle_plate
                    and entry.po_number.upper() == po_number.upper()
                    and entry.vehicle_plate.upper() == vehicle_plate.upper()
                ):
                    raise DomainRuleViolationException(
                        f"Active gate entry attempt ({entry.gate_entry_number}) already exists for "
                        f"PO '{po_number}' and vehicle '{vehicle_plate}'"
                    )


from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from app.modules.gate.domain.enums import MismatchField, VerificationResultType
from app.modules.gate.domain.value_objects import AnprResult, VerificationResult


@dataclass(frozen=True)
class PurchaseOrderDetails:
    po_id: str
    po_number: str
    supplier_name: str
    product_material: str
    total_quantity: Decimal
    po_date: Optional[date] = None
    expected_delivery_date: Optional[date] = None


class GateEntryVerificationDomainService:
    def __init__(self, anpr_confidence_threshold: float = 0.85):
        self.anpr_confidence_threshold = anpr_confidence_threshold

    def verify(
        self,
        vehicle_number: str,
        anpr_result: Optional[AnprResult] = None,
        ocr_result: Optional[OcrResult] = None,
        po_details: Optional[PurchaseOrderDetails] = None,
    ) -> VerificationResult:
        if po_details is None or ocr_result is None or not ocr_result.po_number:
            return VerificationResult(
                status=GateEntryStatus.UNSCHEDULED_ARRIVAL,
                verification_type=VerificationResultType.UNSCHEDULED_PO,
                mismatched_fields=[],
                reasons=["PO not found in database"],
            )

        mismatches: list[MismatchField] = []
        if ocr_result.supplier_name and po_details.supplier_name and ocr_result.supplier_name.strip().upper() != po_details.supplier_name.strip().upper():
            mismatches.append(MismatchField.SUPPLIER_NAME)
        ocr_material = getattr(ocr_result, "material_description", getattr(ocr_result, "product_material", None))
        if ocr_material and po_details.product_material and ocr_material.strip().upper() != po_details.product_material.strip().upper():
            mismatches.append(MismatchField.PRODUCT_MATERIAL)
        ocr_qty = getattr(ocr_result, "total_quantity", getattr(ocr_result, "quantity", None))
        if ocr_qty is not None and po_details.total_quantity is not None and Decimal(str(ocr_qty)) != Decimal(str(po_details.total_quantity)):
            mismatches.append(MismatchField.QUANTITY)

        low_anpr = anpr_result is not None and anpr_result.confidence < self.anpr_confidence_threshold
        if mismatches or low_anpr:
            return VerificationResult(
                status=GateEntryStatus.MANUAL_VERIFICATION_REQUIRED,
                verification_type=VerificationResultType.MISMATCHED if mismatches else VerificationResultType.LOW_CONFIDENCE,
                mismatched_fields=mismatches,
                reasons=["Mismatches detected" if mismatches else "Low ANPR confidence"],
            )

        return VerificationResult(
            status=GateEntryStatus.PO_VERIFIED,
            verification_type=VerificationResultType.MATCHED,
            mismatched_fields=[],
            reasons=[],
        )

