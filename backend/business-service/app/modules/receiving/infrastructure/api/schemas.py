"""
Pydantic v2 request/response schemas for the Goods Receiving / GRN module.

This file keeps the original ConfirmGrn* schemas for backward compatibility
and adds the page-wise schemas required for the extended GRN workflow:

1. GRN header / PO context
2. Item receiving
3. Damage evidence
4. Quality inspection
5. Batch creation
6. Batch QR
7. Documents
8. GRN completion
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, field_validator

from app.common.api_model import ApiModel


# ============================================================================
# COMMON TYPES
# ============================================================================

ReceiptType = Literal["PO_RECEIPT", "UNEXPECTED_DELIVERY"]

GrnStatus = Literal[
    "DRAFT",
    "PARTIALLY_COMPLETED",
    "RECEIVING_COMPLETE",
    "COMPLETED",
]

NonNegativeQuantity = Annotated[
    Decimal,
    Field(ge=Decimal("0")),
]

PositiveQuantity = Annotated[
    Decimal,
    Field(gt=Decimal("0")),
]


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None

    value = value.strip()
    return value or None


# ============================================================================
# LEGACY / EXISTING CONFIRM-GRN API
#
# Keep these classes because the existing receiving router/use-case can
# already import and use them.
# ============================================================================

class ConfirmGrnLineRequest(ApiModel):
    item_code: str = Field(min_length=1, max_length=64)
    quantity: PositiveQuantity

    @field_validator("item_code")
    @classmethod
    def clean_item_code(cls, value: str) -> str:
        value = value.strip()

        if not value:
            raise ValueError("item_code is required")

        return value


class ConfirmGrnRequest(ApiModel):
    po_id: str = Field(min_length=1)
    lines: list[ConfirmGrnLineRequest] = Field(min_length=1)


class GrnResponse(ApiModel):
    grn_id: str
    status: str


# ============================================================================
# PAGE 1 - GRN HEADER / PO CONTEXT
# ============================================================================

class DockOptionResponse(ApiModel):
    dock_number: str
    warehouse_id: str
    dock_type: str | None = None
    capacity: int | None = None
    status: str | None = None


class GrnHistoryItemResponse(ApiModel):
    grn_id: str
    grn_number: str
    receipt_date: datetime | None = None
    vehicle_number: str | None = None
    driver_name: str | None = None
    dock_number: str | None = None
    received_quantity: Decimal = Decimal("0")
    accepted_quantity: Decimal = Decimal("0")
    rejected_quantity: Decimal = Decimal("0")
    cumulative_received: Decimal = Decimal("0")
    balance_quantity: Decimal = Decimal("0")
    status: str = "COMPLETED"


class PoProgressResponse(ApiModel):
    po_quantity: Decimal = Decimal("0")
    cumulative_received: Decimal = Decimal("0")
    cumulative_accepted: Decimal = Decimal("0")
    cumulative_rejected: Decimal = Decimal("0")
    balance_quantity: Decimal = Decimal("0")
    percentage_received: Decimal = Decimal("0")
    po_status: str = "OPEN"


class GrnContextLineResponse(ApiModel):
    item_code: str
    material_name: str | None = None
    material_category: str | None = None
    uom: str | None = None
    variant_code: str | None = None
    size: str | None = None
    color: str | None = None
    grade: str | None = None

    ordered_quantity: Decimal | None = None
    cumulative_received_quantity: Decimal = Decimal("0")
    cumulative_accepted_quantity: Decimal = Decimal("0")
    cumulative_rejected_quantity: Decimal = Decimal("0")
    received_quantity: Decimal = Decimal("0")
    good_quantity: Decimal = Decimal("0")
    damaged_quantity: Decimal = Decimal("0")
    rejected_quantity: Decimal = Decimal("0")
    quality_approved_quantity: Decimal = Decimal("0")
    balance_quantity: Decimal = Decimal("0")


class GrnContextResponse(ApiModel):
    """
    Information returned after the user enters/selects a PO.

    For PO_RECEIPT, supplier/ASN/gate/vehicle information should normally
    be populated by the backend from existing records.

    receiving_dock is intentionally NOT auto-copied from Gate Entry.
    The UI should load dock_options and let the receiving user choose one.
    """

    receipt_type: ReceiptType = "PO_RECEIPT"

    po_id: str | None = None
    po_number: str | None = None

    grn_id: str | None = None
    grn_number: str | None = None
    grn_status: str | None = None

    asn_id: str | None = None
    asn_number: str | None = None

    gate_entry_id: str | None = None
    gate_entry_number: str | None = None

    supplier_name: str | None = None
    supplier_company_name: str | None = None
    supplier_email: str | None = None

    warehouse_id: str | None = None
    warehouse_name: str | None = None

    vehicle_number: str | None = None
    driver_name: str | None = None
    invoice_number: str | None = None

    received_by: str | None = None

    dock_options: list[DockOptionResponse] = Field(default_factory=list)
    prefilled_dock_number: str | None = None
    field_sources: dict | None = None
    lines: list[GrnContextLineResponse] = Field(default_factory=list)
    grn_history: list[GrnHistoryItemResponse] = Field(default_factory=list)
    po_progress: PoProgressResponse | None = None


class CreateGrnHeaderRequest(ApiModel):
    """
    Saves/creates the GRN header.

    grn_number and received_by are deliberately absent:
    - grn_number must be generated/reused by the backend.
    - received_by must come from the authenticated user.

    For PO_RECEIPT, the backend should treat supplier/ASN/gate/vehicle
    values as authoritative from the existing PO/ASN/Gate data.

    For UNEXPECTED_DELIVERY, the optional manual fields can be used.
    """

    receipt_type: ReceiptType = "PO_RECEIPT"

    grn_id: str | None = None
    po_id: str | None = None
    po_number: str | None = Field(default=None, max_length=64)

    gate_entry_id: str | None = None
    gate_entry_number: str | None = Field(default=None, max_length=64)

    # Manual receiving dock selected on the GRN page.
    dock_number: str = Field(min_length=1, max_length=32)

    invoice_number: str | None = Field(default=None, max_length=128)

    # Manual/fallback values, especially for unexpected deliveries.
    supplier_name: str | None = Field(default=None, max_length=255)
    supplier_company_name: str | None = Field(default=None, max_length=255)
    warehouse_id: str | None = Field(default=None, max_length=64)
    warehouse_name: str | None = Field(default=None, max_length=255)
    vehicle_number: str | None = Field(default=None, max_length=64)
    driver_name: str | None = Field(default=None, max_length=128)

    verification_notes: str | None = None

    @field_validator(
        "grn_id",
        "po_id",
        "po_number",
        "gate_entry_id",
        "gate_entry_number",
        "invoice_number",
        "supplier_name",
        "supplier_company_name",
        "warehouse_id",
        "warehouse_name",
        "vehicle_number",
        "driver_name",
        "verification_notes",
    )
    @classmethod
    def clean_optional_fields(cls, value: str | None) -> str | None:
        return _clean_optional_text(value)

    @field_validator("dock_number")
    @classmethod
    def clean_dock_number(cls, value: str) -> str:
        value = value.strip()

        if not value:
            raise ValueError("dock_number is required")

        return value


class GrnHeaderResponse(ApiModel):
    grn_id: str
    grn_number: str | None = None

    receipt_type: str
    status: str

    po_id: str | None = None
    po_number: str | None = None

    asn_id: str | None = None
    asn_number: str | None = None

    gate_entry_id: str | None = None
    gate_entry_number: str | None = None

    supplier_name: str | None = None
    supplier_company_name: str | None = None

    warehouse_id: str | None = None
    warehouse_name: str | None = None
    dock_number: str | None = None

    vehicle_number: str | None = None
    driver_name: str | None = None
    invoice_number: str | None = None

    receipt_date: datetime | None = None
    received_by: str | None = None

    verification_notes: str | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None


class UpdateGrnStepRequest(ApiModel):
    current_step: int = Field(ge=1, le=6)
    max_completed_step: int | None = Field(default=None, ge=0, le=6)


class UpdateGrnStepResponse(ApiModel):
    grn_id: str
    status: str
    current_step: int
    max_completed_step: int
    completed_steps: list[int] = Field(default_factory=list)


# ============================================================================
# PAGE 2 - ITEM RECEIVING DETAILS
# ============================================================================

class GrnLineReceivingRequest(ApiModel):
    """
    Quantity values submitted for one GRN material line.

    Business rules such as:
        received = good + damaged
        balance = ordered - cumulative received
    should be calculated/validated centrally in the application/use-case
    layer, not trusted from the frontend.
    """

    item_code: str = Field(min_length=1, max_length=64)
    material_name: str | None = Field(default=None, max_length=256)
    material_category: str | None = Field(default=None, max_length=128)
    variant_code: str | None = Field(default=None, max_length=128)
    uom: str | None = Field(default=None, max_length=32)

    good_quantity: NonNegativeQuantity = Decimal("0")
    damaged_quantity: NonNegativeQuantity = Decimal("0")
    allow_over_receipt: bool = False
    over_receipt_reason: str | None = None

    @field_validator("item_code")
    @classmethod
    def clean_item_code(cls, value: str) -> str:
        value = value.strip()

        if not value:
            raise ValueError("item_code is required")

        return value


class UpdateGrnLinesRequest(ApiModel):
    lines: list[GrnLineReceivingRequest] = Field(min_length=1)
    allow_over_receipt: bool = False
    over_receipt_reason: str | None = None


class DamageEvidenceResponse(ApiModel):
    evidence_id: str
    grn_line_id: str

    damaged_quantity: Decimal
    reason: str | None = None
    remarks: str | None = None

    file_name: str
    file_path: str

    uploaded_by: str
    uploaded_at: datetime


class GrnLineResponse(ApiModel):
    grn_line_id: str | None = None
    item_code: str

    material_name: str | None = None
    material_category: str | None = None
    uom: str | None = None
    variant_code: str | None = None
    size: str | None = None
    color: str | None = None
    grade: str | None = None

    ordered_quantity: Decimal | None = None
    received_quantity: Decimal = Decimal("0")

    good_quantity: Decimal = Decimal("0")
    damaged_quantity: Decimal = Decimal("0")

    accepted_quantity: Decimal | None = None
    rejected_quantity: Decimal = Decimal("0")
    quality_approved_quantity: Decimal = Decimal("0")

    balance_quantity: Decimal = Decimal("0")
    quality_result: str | None = None
    damage_lots: list[GrnDamageLotResponse] = Field(default_factory=list)
    damage_evidence: list[DamageEvidenceResponse] = Field(default_factory=list)


class UpdateGrnLinesResponse(ApiModel):
    grn_id: str
    grn_number: str | None = None
    status: str
    lines: list[GrnLineResponse]


# ============================================================================
# PAGE 3 - DAMAGE EVIDENCE
# ============================================================================

class DamageEvidenceMetadataRequest(ApiModel):
    """
    Metadata accompanying an uploaded damage image/file.

    The binary file itself should be handled by FastAPI UploadFile.
    file_path must be generated by the backend after securely storing
    the upload; the client should not provide arbitrary server paths.
    """

    damaged_quantity: PositiveQuantity
    reason: str | None = Field(default=None, max_length=1000)
    remarks: str | None = Field(default=None, max_length=2000)

    @field_validator("reason", "remarks")
    @classmethod
    def clean_optional_fields(cls, value: str | None) -> str | None:
        return _clean_optional_text(value)


# ============================================================================
# PAGE 4 - QUALITY INSPECTION
# ============================================================================

class QualityInspectionLineRequest(ApiModel):
    """
    Keep quality_result as a string for compatibility with the project's
    existing receiving/quality logic. The application service should define
    the allowed decisions in one central place.
    """

    grn_line_id: str | None = None
    item_code: str | None = None
    quality_result: str = Field(min_length=1, max_length=32)

    accepted_quantity: NonNegativeQuantity = Decimal("0")
    rejected_quantity: NonNegativeQuantity = Decimal("0")
    quality_approved_quantity: NonNegativeQuantity = Decimal("0")
    good_quantity: NonNegativeQuantity | None = None
    damaged_quantity: NonNegativeQuantity | None = None

    @field_validator("quality_result")
    @classmethod
    def normalize_quality_result(cls, value: str) -> str:
        value = value.strip().upper()

        if not value:
            raise ValueError("quality_result is required")

        return value


class QualityInspectionRequest(ApiModel):
    lines: list[QualityInspectionLineRequest] = Field(min_length=1)


class QualityInspectionLineResponse(ApiModel):
    grn_line_id: str
    item_code: str
    quality_result: str | None = None
    accepted_quantity: Decimal | None = None
    rejected_quantity: Decimal | None = None
    quality_approved_quantity: Decimal | None = None


class QualityInspectionResponse(ApiModel):
    grn_id: str
    status: str
    lines: list[QualityInspectionLineResponse]


# ============================================================================
# PAGE 5 - BATCH CREATION
# ============================================================================

class BatchQuantityRequest(ApiModel):
    """
    Client provides only the quantity.

    batch_number should be generated by the backend/database-safe service
    so concurrent users cannot generate duplicate batch numbers.
    """

    batch_quantity: PositiveQuantity


class CreateGrnBatchesRequest(ApiModel):
    grn_line_id: str = Field(min_length=1)
    batches: list[BatchQuantityRequest] = Field(min_length=1)


class GrnBatchResponse(ApiModel):
    batch_id: str
    grn_line_id: str
    batch_number: str
    batch_quantity: Decimal

    created_by: str
    created_at: datetime


# ============================================================================
# PAGE 6 - BATCH QR
# ============================================================================

class GrnBatchQrResponse(ApiModel):
    qr_id: str
    item_code: str | None = None
    batch_id: str | None = None
    qr_code: str
    qr_payload: str
    generated_at: datetime


class BatchWithQrResponse(ApiModel):
    batch: GrnBatchResponse
    qr: GrnBatchQrResponse | None = None


# ============================================================================
# DAMAGED GOODS QR & DAMAGE LOT SCHEMAS
# ============================================================================

class GrnDamageQrResponse(ApiModel):
    qr_id: str
    damage_lot_id: str
    grn_line_id: str
    grn_number: str
    item_code: str
    qr_code: str
    qr_payload: str
    generated_by: str | None = None
    generated_at: datetime


class GrnDamageLotResponse(ApiModel):
    damage_lot_id: str
    grn_line_id: str
    damage_lot_number: str
    damaged_quantity: Decimal
    uom: str | None = None
    reason: str | None = None
    qa_status: str | None = None
    quarantine_location: str | None = None
    status: str
    created_by: str
    created_at: datetime
    qr: GrnDamageQrResponse | None = None


class DamageItemPayload(ApiModel):
    item_code: str | None = None
    material_name: str | None = None
    damaged_quantity: Decimal | float | str | None = None
    uom: str | None = "PCS"
    reason: str | None = None
    damage_lot_number: str | None = None
    quarantine_location: str | None = None
    photo_ids: list[str] = []
    photo_id: str | None = None


class GrnDamageVendorNotifyRequest(ApiModel):
    supplier_email: str | None = None
    custom_remarks: str | None = None
    notify_procurement: bool = True
    damage_items: list[DamageItemPayload] = []
    photo_ids: list[str] = []


class GrnDamageVendorNotifyResponse(ApiModel):
    status: str
    grn_number: str
    vendor_email: str
    supplier_email: str = ""
    procurement_email: str = ""
    supplier_status: str = "FAILED"  # SENT | FAILED | NOT_CONFIGURED
    procurement_status: str = "FAILED"  # SENT | FAILED | NOT_CONFIGURED
    supplier_error: str | None = None
    procurement_error: str | None = None
    email_delivered: bool
    email_html_url: str | None = None
    procurement_notified: bool
    summary: str | None = None


# ============================================================================
# PAGE 7 - DOCUMENTS
# ============================================================================

class GrnDocumentMetadataRequest(ApiModel):
    """
    Metadata accompanying UploadFile.

    file_name/file_path/uploaded_by are populated by the backend.
    """

    document_type: str = Field(min_length=1, max_length=64)

    @field_validator("document_type")
    @classmethod
    def normalize_document_type(cls, value: str) -> str:
        value = value.strip().upper()

        if not value:
            raise ValueError("document_type is required")

        return value


class GrnDocumentResponse(ApiModel):
    document_id: str
    grn_id: str

    document_type: str
    file_name: str
    file_path: str

    uploaded_by: str
    uploaded_at: datetime


# ============================================================================
# PAGE 8 - COMPLETE GRN
# ============================================================================

class CompleteGrnRequest(ApiModel):
    verification_notes: str | None = Field(default=None, max_length=4000)

    @field_validator("verification_notes")
    @classmethod
    def clean_notes(cls, value: str | None) -> str | None:
        return _clean_optional_text(value)


class CompleteGrnResponse(ApiModel):
    grn_id: str
    grn_number: str | None = None

    status: str
    po_status: str | None = None

    posted_by: str | None = None
    posted_at: datetime | None = None

    message: str | None = None
    procurement_notified: bool = False
    vendor_email_sent: bool = False
    total_ordered_qty: float | None = None
    total_good_qty: float | None = None
    total_damaged_qty: float | None = None
    total_pending_delivery_qty: float | None = None
    total_acceptable_qty_outstanding: float | None = None


# ============================================================================
# COMPLETE GRN DETAIL RESPONSE
# ============================================================================

class GrnDetailResponse(ApiModel):
    grn_id: str

    grn_number: str | None = None
    status: str
    receipt_type: str = "PO_RECEIPT"

    po_id: str | None = None
    po_number: str | None = None

    asn_id: str | None = None
    asn_number: str | None = None

    gate_entry_id: str | None = None
    gate_entry_number: str | None = None

    supplier_name: str | None = None
    supplier_company_name: str | None = None
    supplier_email: str | None = None

    warehouse_id: str | None = None
    warehouse_name: str | None = None
    dock_number: str | None = None

    vehicle_number: str | None = None
    driver_name: str | None = None
    invoice_number: str | None = None

    receipt_date: datetime | None = None
    received_by: str | None = None

    posted_by: str | None = None
    posted_at: datetime | None = None

    verification_notes: str | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None
    current_step: int = 1
    max_completed_step: int = 0

    lines: list[GrnLineResponse] = Field(default_factory=list)
    documents: list[GrnDocumentResponse] = Field(default_factory=list)


# ============================================================================
# OPTIONAL LIST / SUMMARY RESPONSES
# ============================================================================

class GrnSummaryResponse(ApiModel):
    grn_id: str
    grn_number: str | None = None

    po_number: str | None = None
    supplier_name: str | None = None
    supplier_company_name: str | None = None
    supplier_email: str | None = None

    receipt_type: str
    status: str

    warehouse_name: str | None = None
    dock_number: str | None = None
    vehicle_number: str | None = None
    driver_name: str | None = None

    receipt_date: datetime | None = None
    received_by: str | None = None
    current_step: int = 1
    max_completed_step: int = 0


class GrnListResponse(ApiModel):
    items: list[GrnSummaryResponse] = Field(default_factory=list)
    total: int = 0


# ============================================================================
# QR SCAN RESULT / LOOKUP RESPONSE
# ============================================================================

class QrScanLookupResponse(ApiModel):
    qr_id: str
    grn_number: str
    po_number: str
    material_code: str
    material_name: str
    variant_code: str | None = None
    size: str | None = None
    color: str | None = None
    grade: str | None = None
    specification: str | None = None
    uom: str
    supplier_code: str | None = None
    supplier_name: str
    receipt_date: str | None = None
    warehouse_name: str | None = None
    category: str | None = None
    batch_number: str | None = None
    received_quantity: float
    accepted_quantity: float
    damaged_quantity: float
    rejected_quantity: float = 0.0
    batch_quantity: float | None = None
    inspection_status: str
    stock_status: str
    summary: str
