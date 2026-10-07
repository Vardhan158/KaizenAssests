"""
CreateSupplierCommand - input DTO for CreateSupplierUseCase.
Plain, immutable dataclasses for Steps 1-4 supplier onboarding data.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional


@dataclass(frozen=True)
class AddressCommand:
    registered_address: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None


@dataclass(frozen=True)
class ContactCommand:
    primary_contact_name: str
    primary_email: str
    secondary_email: Optional[str] = None
    designation: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None


@dataclass(frozen=True)
class BankInfoCommand:
    bank_name: str
    account_number: str
    account_holder_name: Optional[str] = None
    ifsc: Optional[str] = None
    branch: Optional[str] = None
    swift_bic: Optional[str] = None
    tds_section: Optional[str] = None


@dataclass(frozen=True)
class DocumentCommand:
    document_type: str
    file_name: str
    storage_path: str
    upload_id: Optional[str] = None
    file_type: Optional[str] = None
    file_size: Optional[int] = None


@dataclass(frozen=True)
class CreateSupplierCommand:
    supplier_name: str
    registered_company_name: str
    vendor_type: str
    category: List[str]
    industry: str
    gstin: str
    main_materials: Optional[List[str]] = None
    address: Optional[AddressCommand] = None
    contact: Optional[ContactCommand] = None
    bank_info: Optional[BankInfoCommand] = None
    documents: Optional[List[DocumentCommand]] = None
    remarks: Optional[str] = None
    created_by: Optional[str] = None


@dataclass(frozen=True)
class UpdateSupplierCommand:
    supplier_id: str
    supplier_name: Optional[str] = None
    registered_company_name: Optional[str] = None
    vendor_type: Optional[str] = None
    category: Optional[List[str]] = None
    industry: Optional[str] = None
    gstin: Optional[str] = None
    main_materials: Optional[List[str]] = None
    address: Optional[AddressCommand] = None
    contact: Optional[ContactCommand] = None
    bank_info: Optional[BankInfoCommand] = None
    documents: Optional[List[DocumentCommand]] = None
    remarks: Optional[str] = None
    updated_by: Optional[str] = None


# --- RFQ ---

@dataclass(frozen=True)
class RfqItemCommand:
    material_code: str
    material_name: str
    category: str
    quantity: Decimal
    uom: str
    material_id: Optional[str] = None
    material_variant_id: Optional[str] = None
    variant_code: Optional[str] = None
    required_delivery_date: Optional[date] = None
    warehouse: Optional[str] = None
    special_requirements: Optional[str] = None


@dataclass(frozen=True)
class CreateRfqCommand:
    rfq_date: date
    warehouse: str
    procurement_officer: str
    supplier_ids: List[str]
    items: List[RfqItemCommand]
    material_request_number: Optional[str] = None
    required_delivery_date: Optional[date] = None
    remarks: Optional[str] = None


# --- Quotation ---

@dataclass(frozen=True)
class QuotationLineCommand:
    item_code: str
    quantity: Decimal
    unit_price: Decimal
    material_id: Optional[str] = None
    material_variant_id: Optional[str] = None
    variant_code: Optional[str] = None
    material_name: Optional[str] = None
    uom: Optional[str] = None


@dataclass(frozen=True)
class QuotationDocumentCommand:
    document_type: str
    file_name: str
    file_url: str


@dataclass(frozen=True)
class SubmitQuotationCommand:
    rfq_id: str
    supplier_id: str
    lines: List[QuotationLineCommand]
    status: str = "SUBMITTED"
    discount: Optional[Decimal] = None
    tax: Optional[Decimal] = None
    freight_charges: Optional[Decimal] = None
    additional_charges: Optional[Decimal] = None
    delivery_time: Optional[str] = None
    expected_delivery_date: Optional[date] = None
    payment_terms: Optional[str] = None
    mode_of_payment: Optional[str] = None
    warranty: Optional[str] = None
    quotation_validity: Optional[date] = None
    remarks: Optional[str] = None
    documents: Optional[List[QuotationDocumentCommand]] = None


# --- Purchase Order ---

# --- ASN ---

@dataclass(frozen=True)
class AsnLineCommand:
    item_code: str
    shipped_quantity: Decimal
    material_name: Optional[str] = None
    uom: Optional[str] = None


@dataclass(frozen=True)
class AsnDocumentCommand:
    document_type: str
    file_name: str
    file_url: str
    uploaded_by: str


@dataclass(frozen=True)
class CreateAsnCommand:
    asn_number: str
    lines: List[AsnLineCommand]
    po_id: Optional[str] = None
    po_number: Optional[str] = None
    vehicle_number: Optional[str] = None
    expected_arrival_at: Optional[datetime] = None
    shipment_date: Optional[date] = None
    driver_name: Optional[str] = None
    driver_contact: Optional[str] = None
    transporter: Optional[str] = None
    number_of_packages: Optional[int] = None
    package_type: Optional[str] = None
    shipping_method: Optional[str] = None
    status: str = "SUBMITTED"
    documents: List[AsnDocumentCommand] = field(default_factory=list)
    supplier_id: Optional[str] = None
    logistics: Optional[List[dict]] = None
