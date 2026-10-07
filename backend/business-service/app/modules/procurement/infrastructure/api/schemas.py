from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Optional, Union

from pydantic import Field, field_validator

from app.common.api_model import ApiModel


class MasterDataCreate(ApiModel):
    name: str


class MasterDataResponse(ApiModel):
    id: int
    name: str


class NotificationResponse(ApiModel):
    id: str
    user_role: str
    title: str
    message: str
    link: Optional[str] = None
    is_read: bool = False
    created_at: datetime
    dock_code: Optional[str] = None
    dock_name: Optional[str] = None
    dock_location: Optional[str] = None
    dock_type: Optional[str] = None
    warehouse_name: Optional[str] = None
    allocation_time: Optional[Union[datetime, str]] = None
    gate_pass_number: Optional[str] = None
    vehicle_number: Optional[str] = None
    driver_name: Optional[str] = None
    driver_phone: Optional[str] = None
    asn_number: Optional[str] = None
    po_number: Optional[str] = None
    grn_number: Optional[str] = None
    supplier_name: Optional[str] = None
    notification_type: Optional[str] = None
    payload_json: Optional[str] = None



class SupplierAddressResponse(ApiModel):
    registered_address: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None


class SupplierContactResponse(ApiModel):
    primary_contact_name: Optional[str] = None
    primary_email: Optional[str] = None
    secondary_email: Optional[str] = None
    designation: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None


class SupplierBankInfoResponse(ApiModel):
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_holder_name: Optional[str] = None
    ifsc: Optional[str] = None
    branch: Optional[str] = None
    swift_bic: Optional[str] = None
    tds_section: Optional[str] = None


class SupplierDocumentResponse(ApiModel):
    document_type: Optional[str] = None
    file_name: Optional[str] = None
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    storage_path: Optional[str] = None
    upload_id: Optional[str] = None


class SupplierResponse(ApiModel):
    supplier_id: str
    supplier_code: Optional[str] = None
    supplier_name: str
    registered_company_name: Optional[str] = None
    vendor_type: Optional[str] = None
    category: List[str] = []
    industry: Optional[str] = None
    gstin: Optional[str] = None
    main_materials: List[str] = []
    payment_terms: Optional[str] = None
    credit_period_days: Optional[int] = None
    rating: Optional[Decimal] = None
    performance_score: Optional[Decimal] = None
    purchase_order_count: int = 0
    purchase_value: Decimal = Decimal("0")
    last_po_number: Optional[str] = None
    last_po_date: Optional[date] = None
    address: Optional[SupplierAddressResponse] = None
    contact: Optional[SupplierContactResponse] = None
    bank_info: Optional[SupplierBankInfoResponse] = None
    documents: List[SupplierDocumentResponse] = []
    remarks: Optional[str] = None
    status: Optional[str] = "Active"
    created_at: Optional[datetime] = None
    created_by: Optional[str] = None
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None


class AddressRequest(ApiModel):
    registered_address: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = "India"
    state: Optional[str] = None
    pincode: Optional[str] = None


class ContactRequest(ApiModel):
    primary_contact_name: str
    primary_email: str
    secondary_email: Optional[str] = None
    designation: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None


class BankInfoRequest(ApiModel):
    bank_name: str
    account_number: str
    account_holder_name: str
    ifsc: str
    branch: Optional[str] = None
    swift_bic: Optional[str] = None
    tds_section: Optional[str] = None


class DocumentRequest(ApiModel):
    document_type: str
    file_name: str
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    storage_path: str
    upload_id: str


class CreateSupplierRequest(ApiModel):
    supplier_name: str
    registered_company_name: Optional[str] = None
    vendor_type: Optional[str] = None
    category: List[str] = []
    industry: Optional[str] = None
    gstin: Optional[str] = None
    main_materials: List[str] = []
    payment_terms: Optional[str] = None
    credit_period_days: Optional[int] = None
    address: Optional[AddressRequest] = None
    contact: Optional[ContactRequest] = None
    bank_info: Optional[BankInfoRequest] = None
    documents: List[DocumentRequest] = []
    remarks: Optional[str] = None
    created_by: Optional[str] = None


class UpdateSupplierRequest(ApiModel):
    supplier_name: Optional[str] = None
    registered_company_name: Optional[str] = None
    vendor_type: Optional[str] = None
    category: Optional[List[str]] = None
    industry: Optional[str] = None
    gstin: Optional[str] = None
    main_materials: Optional[List[str]] = None
    payment_terms: Optional[str] = None
    credit_period_days: Optional[int] = None
    address: Optional[AddressRequest] = None
    contact: Optional[ContactRequest] = None
    bank_info: Optional[BankInfoRequest] = None
    documents: Optional[List[DocumentRequest]] = None
    remarks: Optional[str] = None


class SupplierStatusRequest(ApiModel):
    status: str
    remarks: Optional[str] = None




class RfqItemSchema(ApiModel):
    material_id: Optional[str] = None
    material_variant_id: Optional[str] = None
    material_code: str
    variant_code: Optional[str] = None
    material_name: str
    category: Optional[str] = None
    quantity: Decimal
    uom: str
    required_delivery_date: Optional[date] = None
    warehouse: Optional[str] = None
    special_requirements: Optional[str] = None


class CreateRfqRequest(ApiModel):
    rfq_date: Optional[date] = Field(default_factory=date.today)
    material_request_number: Optional[str] = None
    required_delivery_date: Optional[date] = None
    warehouse: Optional[str] = None
    procurement_officer: Optional[str] = None
    remarks: Optional[str] = None
    supplier_ids: List[str]
    items: List[RfqItemSchema]


class RfqResponse(ApiModel):
    id: str
    rfq_number: str
    rfq_date: date
    material_request_number: Optional[str] = None
    required_delivery_date: Optional[date] = None
    warehouse: Optional[str] = None
    procurement_officer: Optional[str] = None
    remarks: Optional[str] = None
    status: str
    items: List[RfqItemSchema] = []
    suppliers: List[SupplierResponse] = []
    supplier_emails: List[str] = []
    created_at: Optional[datetime] = None




class QuotationLineSchema(ApiModel):
    material_id: Optional[str] = None
    material_variant_id: Optional[str] = None
    item_code: str
    variant_code: Optional[str] = None
    quantity: Decimal
    unit_price: Decimal
    material_name: Optional[str] = None
    uom: Optional[str] = None


class QuotationDocumentSchema(ApiModel):
    document_type: str
    file_name: str
    file_url: str


class SubmitQuotationRequest(ApiModel):
    rfq_id: str
    supplier_id: str
    lines: List[QuotationLineSchema]
    status: str = "SUBMITTED"
    discount: Decimal = Field(default=Decimal("0.0"), ge=0)
    tax: Decimal = Field(default=Decimal("0.0"), ge=0, le=100)
    freight_charges: Decimal = Field(default=Decimal("0.0"), ge=0)
    additional_charges: Decimal = Field(default=Decimal("0.0"), ge=0)
    delivery_time: Optional[str] = None
    expected_delivery_date: Optional[date] = None
    payment_terms: Optional[str] = None
    mode_of_payment: Optional[str] = None
    warranty: Optional[str] = None
    quotation_validity: Optional[date] = None
    remarks: Optional[str] = None
    documents: List[QuotationDocumentSchema] = []


class QuotationResponse(ApiModel):
    id: str
    rfq_id: Optional[str] = None
    supplier_id: Optional[str] = None
    status: Optional[str] = None
    lines: List[QuotationLineSchema] = []
    discount: Optional[Decimal] = None
    tax: Optional[Decimal] = None
    freight_charges: Optional[Decimal] = None
    additional_charges: Optional[Decimal] = None
    total_amount: Optional[Decimal] = None
    delivery_time: Optional[str] = None
    expected_delivery_date: Optional[date] = None
    payment_terms: Optional[str] = None
    mode_of_payment: Optional[str] = None
    warranty: Optional[str] = None
    quotation_validity: Optional[date] = None
    remarks: Optional[str] = None
    documents: List[QuotationDocumentSchema] = []
    supplier_info: Optional[SupplierResponse] = None
    created_at: Optional[datetime] = None




class AsnLineSchema(ApiModel):
    material_id: Optional[str] = None
    material_variant_id: Optional[str] = None
    item_code: str
    variant_code: Optional[str] = None
    shipped_quantity: Decimal
    material_name: Optional[str] = None
    uom: Optional[str] = None


class AsnDocumentSchema(ApiModel):
    document_type: str
    file_name: str
    file_url: str
    uploaded_by: str
    uploaded_at: Optional[datetime] = None


class CreateAsnRequest(ApiModel):
    asn_number: str
    lines: List[AsnLineSchema]
    po_id: Optional[str] = None
    po_number: Optional[str] = None
    vehicle_number: Optional[str] = None
    expected_arrival_at: Optional[str] = None
    shipment_date: Optional[str] = None
    driver_name: Optional[str] = None
    driver_contact: Optional[str] = None
    transporter: Optional[str] = None
    number_of_packages: Optional[int] = None
    package_type: Optional[str] = None
    shipping_method: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[date] = None
    challan_number: Optional[str] = None
    challan_date: Optional[date] = None
    shipment_type: Optional[str] = "STANDARD"
    return_reason: Optional[str] = None
    refund_days: Optional[int] = None
    return_method: Optional[str] = None
    original_asn_number: Optional[str] = None
    replacement_reason: Optional[str] = None
    replacement_for_asn: Optional[str] = None
    replacement_dispatch_date: Optional[date] = None
    replacement_request_id: Optional[str] = None
    status: Optional[str] = "SUBMITTED"
    documents: List[AsnDocumentSchema] = []
    logistics: Optional[List[dict]] = None


class AsnResponse(ApiModel):
    id: str
    asn_number: str
    status: str
    lines: List[AsnLineSchema]
    po_id: Optional[str] = None
    po_number: Optional[str] = None
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    vehicle_number: Optional[str] = None
    expected_arrival_at: Optional[datetime] = None
    shipment_date: Optional[date] = None
    driver_name: Optional[str] = None
    driver_contact: Optional[str] = None
    transporter: Optional[str] = None
    number_of_packages: Optional[int] = None
    package_type: Optional[str] = None
    shipping_method: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[date] = None
    challan_number: Optional[str] = None
    challan_date: Optional[date] = None
    documents: List[AsnDocumentSchema] = []
    logistics: Optional[List[dict]] = None
    warehouse_status: Optional[str] = None
    warehouse_status_updated_at: Optional[datetime] = None
    assigned_dock_id: Optional[str] = None
    created_at: datetime


class ReplacementRequestResponse(ApiModel):
    id: str
    request_number: str
    supplier_id: str
    purchase_order_id: Optional[str] = None
    original_asn_id: Optional[str] = None
    item_code: str
    item_name: Optional[str] = None
    replacement_quantity: Decimal
    uom: str
    reason: str
    remarks: Optional[str] = None
    request_date: date
    supplier_response_due_at: Optional[datetime] = None
    replacement_dispatch_due_at: Optional[datetime] = None
    status: str
    supplier_response_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    extension_requested_at: Optional[datetime] = None
    disputed_at: Optional[datetime] = None
    created_at: datetime




class POApprovalHistorySchema(ApiModel):
    status: str
    actor_name: str
    comments: Optional[str] = None
    created_at: datetime


class PORevisionSchema(ApiModel):
    revision_number: int
    changed_field: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    changed_by: str
    changed_at: datetime
    reason: str


class PurchaseOrderAmendmentLine(ApiModel):
    material_code: str
    quantity: Optional[Decimal] = None
    unit_price: Optional[Decimal] = None
    discount: Optional[Decimal] = None
    tax: Optional[Decimal] = None


class PurchaseOrderAmendmentRequest(ApiModel):
    reason: str = Field(..., min_length=1)
    changes: dict[str, Any] = {}
    items: List[PurchaseOrderAmendmentLine] = []


class PurchaseOrderItemSchema(ApiModel):
    material_id: Optional[str] = None
    material_variant_id: Optional[str] = None
    material_code: str
    variant_code: Optional[str] = None
    material_name: Optional[str] = None
    category: Optional[str] = None
    quantity: Decimal
    unit_price: Decimal
    discount: Decimal = Decimal("0.0")
    tax: Decimal = Decimal("0.0")
    uom: str


class PurchaseOrderResponse(ApiModel):
    id: str
    po_number: str
    po_date: date
    status: str
    revision_number: int = 1
    rfq_id: Optional[str] = None
    supplier_id: Optional[str] = None
    quotation_id: Optional[str] = None
    supplier_name: Optional[str] = None
    warehouse_id: Optional[str] = None
    total_amount: Decimal
    expected_delivery_date: Optional[date] = None
    payment_terms: Optional[str] = None
    delivery_terms: Optional[str] = None
    warranty: Optional[str] = None
    billing_address: Optional[str] = None
    notes: Optional[str] = None
    attachments: List[dict] = []
    procurement_officer: Optional[str] = None
    department: Optional[str] = None
    supplier_code: Optional[str] = None
    supplier_contact_person: Optional[str] = None
    supplier_phone: Optional[str] = None
    supplier_email: Optional[str] = None
    supplier_gstin: Optional[str] = None
    supplier_address: Optional[str] = None
    delivery_warehouse_name: Optional[str] = None
    delivery_address: Optional[str] = None
    subtotal: Decimal = Decimal("0.0")
    discount_amount: Decimal = Decimal("0.0")
    tax_amount: Decimal = Decimal("0.0")
    freight_charges: Decimal = Decimal("0.0")
    additional_charges: Decimal = Decimal("0.0")
    rfq_number: Optional[str] = None
    tax_percentage: Decimal = Decimal("0.0")
    selection_reason: Optional[str] = None
    procurement_comments: Optional[str] = None
    selection_date: Optional[datetime] = None
    selected_by: Optional[str] = None
    rejection_reason: Optional[str] = None
    quotation: Optional[QuotationResponse] = None
    items: List[PurchaseOrderItemSchema] = []
    history: List[POApprovalHistorySchema] = []
    revisions: List[PORevisionSchema] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class FinanceApprovalResponse(ApiModel):
    id: str
    po_id: str
    po_number: str
    rfq_id: Optional[str] = None
    rfq_number: Optional[str] = None
    supplier_name: str
    total_amount: Decimal
    status: str
    requested_by: str
    requested_at: datetime
    approved_at: Optional[datetime] = None
    approver_name: Optional[str] = None
    comments: Optional[str] = None
    po_details: Optional[PurchaseOrderResponse] = None




class MaterialRequestItemSchema(ApiModel):
    id: Optional[str] = None
    material_id: Optional[str] = None
    material_variant_id: Optional[str] = None
    material_code: Optional[str] = None
    variant_code: Optional[str] = None
    material_name: Optional[str] = None
    category: Optional[str] = None
    quantity: Decimal = Field(..., gt=0, description="Quantity must be strictly greater than zero")
    uom: str = Field("PCS", min_length=1, description="Unit of measurement")
    is_custom: Optional[bool] = False
    custom_material_name: Optional[str] = None
    category: Optional[str] = None

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, v: Decimal) -> Decimal:
        if v <= Decimal("0"):
            raise ValueError("Quantity must be strictly greater than zero")
        return v

    @field_validator("uom")
    @classmethod
    def validate_uom(cls, v: str) -> str:
        clean = v.strip().upper()
        if not clean:
            raise ValueError("UOM cannot be empty")
        return clean


class CreateMaterialRequest(ApiModel):
    request_number: Optional[str] = None
    warehouse_id: str = Field(..., min_length=1, description="Warehouse identifier")
    department: str = Field(..., min_length=1, description="Department name")
    requested_by: str = Field(..., min_length=1, description="Requester user name")
    priority: Optional[str] = "MEDIUM"
    required_date: date
    remarks: Optional[str] = None
    suggested_supplier: Optional[str] = None
    attachments: List[dict] = []
    items: List[MaterialRequestItemSchema] = Field(..., min_length=1, description="Requested materials list")

    @field_validator("items")
    @classmethod
    def validate_items(cls, v: List[MaterialRequestItemSchema]) -> List[MaterialRequestItemSchema]:
        if not v or len(v) == 0:
            raise ValueError("Material Request must contain at least one item")
        return v

    @field_validator("warehouse_id", "department", "requested_by")
    @classmethod
    def validate_non_empty_strings(cls, v: str) -> str:
        clean = v.strip()
        if not clean:
            raise ValueError("Field cannot be empty")
        return clean


class SupplierSelectionRequest(ApiModel):
    supplier_id: str
    quotation_id: Optional[str] = None
    selection_reason: str
    selection_comments: Optional[str] = None


class MaterialRequestResponse(ApiModel):
    id: str
    request_number: str
    warehouse_id: str
    department: str
    requested_by: str
    status: str
    priority: str = "MEDIUM"
    required_date: date
    remarks: Optional[str] = None
    suggested_supplier: Optional[str] = None
    attachments: List[dict] = []
    approval_history: List[dict] = []
    items: List[MaterialRequestItemSchema] = []
    created_at: datetime
    updated_at: Optional[datetime] = None


class MaterialRequestStatusRequest(ApiModel):
    status: str
    comments: Optional[str] = None
    actor: Optional[str] = None


class CreateFinishedGoodsRequest(ApiModel):
    warehouse_id: str = Field(..., min_length=1, description="Warehouse identifier")
    finished_goods_code: Optional[str] = None
    finished_goods_name: str = Field(..., min_length=1, description="Finished goods name")
    quantity: Decimal = Field(..., gt=0, description="Quantity must be strictly greater than zero")
    uom: str = Field("PCS", min_length=1, description="Unit of measurement")
    required_date: date
    requested_by: str = Field(..., min_length=1, description="Requester user name")
    remarks: Optional[str] = None

    @field_validator("warehouse_id", "finished_goods_name", "requested_by", "uom")
    @classmethod
    def validate_required_text(cls, v: str) -> str:
        clean = v.strip()
        if not clean:
            raise ValueError("Field cannot be empty")
        return clean

    @field_validator("uom")
    @classmethod
    def normalize_uom(cls, v: str) -> str:
        return v.strip().upper()


class FinishedGoodsRequestResponse(ApiModel):
    id: str
    request_number: str
    warehouse_id: str
    finished_goods_code: Optional[str] = None
    finished_goods_name: str
    quantity: Decimal
    uom: str
    required_date: date
    requested_by: str
    status: str
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class MaterialStockResponse(ApiModel):
    id: str
    material_id: Optional[str] = None
    material_variant_id: Optional[str] = None
    material_code: str
    variant_code: Optional[str] = None
    material_name: str
    category: str
    on_hand: Decimal
    allocated: Decimal
    available: Decimal
    uom: str
    warehouse_id: str
    reorder_point: Decimal
    updated_at: datetime


class ArrivalNotificationResponse(ApiModel):
    id: str
    asn_id: str
    asn_number: str
    po_id: Optional[str] = None
    po_number: str
    warehouse_id: str
    supplier_name: str
    vehicle_number: str
    expected_arrival_time: datetime
    driver_phone: Optional[str] = None
    message: Optional[str] = None
    status: str
    created_at: datetime




class ProcurementTrendItem(ApiModel):
    month: str
    pos: int


class ProcurementStatsResponse(ApiModel):
    active_suppliers: int
    total_suppliers: int
    open_pos: int
    pending_material_requests: int = 0
    pending_material_request_sources: List[str] = []
    pending_supplier_registrations: int = 0
    expiring_supplier_documents: int = 0
    pending_approvals: int = 0
    pending_quotations: int = 0
    awaiting_supplier_confirmation: int = 0
    overdue_pos: int = 0
    partially_received_pos: int = 0
    rfqs_closing_today: int = 0
    asns_expected_today: int = 0
    compliance_rate: Optional[float] = None
    compliance_target: float
    total_po_value: Decimal
    trend: List[ProcurementTrendItem] = []


class GlobalSearchItem(ApiModel):
    id: str
    type: str
    title: str
    subtitle: str
    link: str


class GlobalSearchResponse(ApiModel):
    results: List[GlobalSearchItem]




class SupplierLoginRequest(ApiModel):
    username: str
    password: str


class SupplierLoginResponse(ApiModel):
    token: str
    supplier_id: str
    must_change_password: bool
    username: str


class MagicLoginRequest(ApiModel):
    token: str


class MagicLoginResponse(ApiModel):
    token: str
    supplier_id: str
    supplierId: str
    username: str
    must_change_password: bool
    roles: List[str] = ["SUPPLIER"]
    rfq_id: Optional[str] = None
    po_id: Optional[str] = None
    link_type: Optional[str] = "RFQ"
    email: Optional[str] = None
    expires_in_hours: Optional[float] = None


class ChangePasswordRequest(ApiModel):
    username: str
    old_password: str
    new_password: str


class DevLoginRequest(ApiModel):
    username: str
    password: str


class DamagedMaterialPhotoSchema(ApiModel):
    id: str
    file_name: str
    url: str


class DamagedMaterialItemSchema(ApiModel):
    item_code: str
    material_name: str
    damaged_quantity: float
    uom: str
    reason: str
    photos: List[DamagedMaterialPhotoSchema] = []


class NotificationHistoryItemSchema(ApiModel):
    recipient_type: str
    recipient: str
    status: str
    sent_at: str


class PoDamagedGoodsResponse(ApiModel):
    has_damaged_goods: bool
    po_number: Optional[str] = None
    grn_number: Optional[str] = None
    grn_id: Optional[str] = None
    supplier_name: Optional[str] = None
    warehouse_name: Optional[str] = None
    damage_reported_at: Optional[str] = None
    damaged_materials_count: int = 0
    total_damaged_quantity: float = 0.0
    status: str = "Damage Reported"
    supplier_notification_status: str = "Sent"
    procurement_notification_status: str = "Sent"
    materials: List[DamagedMaterialItemSchema] = []
    notification_history: List[NotificationHistoryItemSchema] = []


class CreateFinishedGoodsRequestSchema(ApiModel):
    warehouse_id: Optional[str] = "MAIN"
    finished_goods_code: Optional[str] = None
    finished_goods_name: str
    quantity: Decimal = Field(..., gt=0, description="Quantity must be greater than 0")
    uom: Optional[str] = "PCS"
    required_date: Optional[date] = None
    requested_by: Optional[str] = None
    requested_date: Optional[date] = None
    bom_attachment_url: Optional[str] = None
    bom_attachment_name: Optional[str] = None
    remarks: Optional[str] = None


class FinishedGoodsRequestResponse(ApiModel):
    id: str
    request_number: str
    warehouse_id: str
    finished_goods_code: Optional[str] = None
    product_code: Optional[str] = None
    finished_goods_name: str
    product_name: str
    quantity: float
    requested_quantity: float
    uom: str
    required_date: Optional[str] = None
    requested_by: str
    requested_date: Optional[str] = None
    created_by: str
    status: str
    bom_attachment_url: Optional[str] = None
    bom_attachment_name: Optional[str] = None
    remarks: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    fg_store_available: float = 0.0
    available_quantity: float = 0.0
    shortage: float = 0.0
    shortage_quantity: float = 0.0


