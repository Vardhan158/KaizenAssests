"""
Pydantic schemas for the Gate Entry REST API.
Inherits from ApiModel to serialize camelCase on the wire.
Purged mock fallbacks. Fully supports dynamic PO OCR extraction & persistent gate pass creation.
"""
from __future__ import annotations

from typing import Any, List, Optional
from pydantic import Field, model_validator

from app.common.api_model import ApiModel
from app.modules.gate.domain.value_objects import GateEntryStatus


class FieldMismatchDto(ApiModel):
    field_name: str
    extracted_value: Any
    canonical_value: Any


class OcrResultDto(ApiModel):
    po_number: str
    supplier_name: str
    material_description: str
    total_quantity: float
    po_date: str
    delivery_date: str
    confidence: float
    line_items: List[dict[str, Any]] = Field(default_factory=list)


class PurchaseOrderRecordDto(ApiModel):
    po_number: str
    supplier_name: str
    material_description: str
    total_quantity: float
    po_date: str
    delivery_date: str
    status: str = "OPEN"


class CreateCustomPoRequest(ApiModel):
    po_number: str = Field(..., min_length=1, description="Unique PO Number, e.g. PO-1001")
    supplier_name: str = Field(..., min_length=1, description="Supplier Name")
    material_description: str = Field(..., min_length=1, description="Material Description")
    total_quantity: float = Field(..., gt=0, description="Total Quantity")
    po_date: str = Field(..., min_length=1, description="PO Date (YYYY-MM-DD)")
    delivery_date: str = Field(..., min_length=1, description="Delivery Date (YYYY-MM-DD)")


class PoOcrPreviewRequest(ApiModel):
    document_image_base64: Optional[str] = Field(default=None, description="Base64 PO document image")
    po_number_override: Optional[str] = Field(default=None, description="Optional manual PO number override")

    @model_validator(mode="after")
    def require_input(self) -> "PoOcrPreviewRequest":
        if not self.document_image_base64 and not self.po_number_override:
            raise ValueError("Provide a PO document image or a PO number to preview OCR verification.")
        return self


class PoOcrPreviewResponse(ApiModel):
    ocr_result: OcrResultDto
    computed_status: str
    mismatched_fields: List[FieldMismatchDto] = Field(default_factory=list)
    po_record: Optional[PurchaseOrderRecordDto] = None


class CreateGateEntryRequest(ApiModel):
    asn_reference: Optional[str] = Field(default=None, description="Existing ASN id or ASN number")
    vehicle_plate: Optional[str] = Field(default=None, description="Legacy/manual vehicle plate")
    po_number: Optional[str] = Field(default=None, description="Legacy/manual purchase order number")
    supplier_name: Optional[str] = Field(default=None, description="Extracted or input supplier name")
    material_description: Optional[str] = Field(default=None, description="Extracted or input material description")
    total_quantity: Optional[float] = Field(default=None, description="Extracted or input total quantity")
    po_date: Optional[str] = Field(default=None, description="Extracted or input PO date")
    delivery_date: Optional[str] = Field(default=None, description="Extracted or input delivery date")
    driver_name: Optional[str] = Field(default="Driver", description="Driver Name")
    document_image_base64: Optional[str] = Field(default=None, description="Base64 encoded PO document image")
    truck_photo_base64: Optional[str] = Field(default=None, description="Base64 encoded captured truck photo")


class VerifyGateEntryRequest(ApiModel):
    action: Optional[str] = Field(default=None, description="Action: APPROVE, REJECT, or UNSCHEDULED_ARRIVAL")
    remarks: Optional[str] = Field(default=None, description="Supervisor remarks")
    reason: Optional[str] = Field(default=None, description="Optional approval, rejection, or transition reason")
    approved: Optional[bool] = Field(default=None, exclude=True, description="Legacy frontend compatibility")
    notes: Optional[str] = Field(default=None, exclude=True, description="Legacy frontend compatibility")

    @model_validator(mode="after")
    def normalise_verification_request(self):
        if not self.action and self.approved is not None:
            self.action = "APPROVE" if self.approved else "UNSCHEDULED_ARRIVAL"
        if not self.remarks:
            self.remarks = self.notes or self.reason
        if not self.action:
            raise ValueError("Verification action is required")
        if not self.remarks:
            self.remarks = "Gate entry status updated"
        return self



class GateEntryResponse(ApiModel):
    id: str
    gate_entry_number: str
    vehicle_plate: str
    status: str
    created_by: str
    driver_name: Optional[str] = None
    driver_phone: Optional[str] = None
    po_id: Optional[str] = None
    po_number: Optional[str] = None
    po_status: Optional[str] = None
    asn_id: Optional[str] = None
    asn_number: Optional[str] = None
    asn_status: Optional[str] = None
    assigned_dock_id: Optional[str] = None
    supplier_name: Optional[str] = None
    material_description: Optional[str] = None
    total_quantity: Optional[float] = None
    document_image_base64: Optional[str] = None
    truck_photo_base64: Optional[str] = None
    ocr_result: Optional[OcrResultDto] = None
    mismatched_fields: List[FieldMismatchDto] = Field(default_factory=list)
    verified_by: Optional[str] = None
    exited_at: Optional[str] = None
    exited_by: Optional[str] = None
    created_at: str
    updated_at: str


class AssignDockRequest(ApiModel):
    dock_id: str = Field(..., min_length=1, max_length=64)
    store_id: Optional[str] = Field(default=None, max_length=64, description="Assigned Store ID or Code")


class CreateDockRequest(ApiModel):
    dock_number: str = Field(..., min_length=1, max_length=32)
    warehouse_id: str = Field(..., min_length=1, max_length=64)
    dock_type: str = Field(..., min_length=1, max_length=64)
    capacity: int = Field(..., gt=0)
    status: str = "AVAILABLE"


class UpdateDockRequest(ApiModel):
    warehouse_id: Optional[str] = Field(default=None, min_length=1, max_length=64)
    dock_type: Optional[str] = Field(default=None, min_length=1, max_length=64)
    capacity: Optional[int] = Field(default=None, gt=0)
    status: Optional[str] = None


class ReceivingQuantityItem(ApiModel):
    item_code: str = Field(..., min_length=1, max_length=64)
    received_quantity: float = Field(..., ge=0)


class RecordReceivingRequest(ApiModel):
    items: List[ReceivingQuantityItem] = Field(..., min_length=1)


class UpdateQuantityVerificationPolicyRequest(ApiModel):
    shortage_tolerance: float = Field(..., ge=0)
    excess_tolerance: float = Field(..., ge=0)


class MaterialConditionItem(ApiModel):
    item_code: str = Field(..., min_length=1, max_length=64)
    good_quantity: float = Field(..., ge=0)
    damaged_quantity: float = Field(default=0, ge=0)
    rejected_quantity: float = Field(default=0, ge=0)
    inspection_required: bool = False
    physical_condition_ok: bool
    packaging_ok: bool
    specifications_ok: bool
    serial_batch_number: Optional[str] = Field(default=None, max_length=128)
    serial_batch_verified: bool = False
    notes: Optional[str] = Field(default=None, max_length=1000)


class RecordMaterialConditionRequest(ApiModel):
    items: List[MaterialConditionItem] = Field(..., min_length=1)


class QualityInspectionDecisionRequest(ApiModel):
    decision: str = Field(..., pattern="^(PASS|FAIL)$")
    notes: Optional[str] = Field(default=None, max_length=2000)


class PostGrnRequest(ApiModel):
    verification_notes: Optional[str] = Field(default=None, max_length=2000)


class ApproveVehicleExitRequest(ApiModel):
    exit_document_reference: str = Field(..., min_length=1, max_length=128)
    asn_verified: bool
    po_verified: bool
    grn_verified: bool
    receiving_verified: bool
    vehicle_verified: bool
    driver_verified: bool
