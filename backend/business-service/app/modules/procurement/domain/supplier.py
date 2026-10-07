"""
Supplier aggregate root and associated domain entities/value objects for Steps 1-4.
Enforces business rules across Company Profile, Address & Contacts, Banking & Tax, and Documents.
Zero framework dependencies.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional
from app.common.domain.exceptions import DomainRuleViolationException
from app.modules.procurement.domain.value_objects import SupplierId


@dataclass(frozen=True)
class SupplierAddress:
    registered_address: str
    city: str
    country: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.registered_address or not str(self.registered_address).strip():
            raise DomainRuleViolationException("Registered Address is mandatory and cannot be empty")
        if not self.city or not str(self.city).strip():
            raise DomainRuleViolationException("City is mandatory and cannot be empty")


@dataclass(frozen=True)
class SupplierContact:
    primary_contact_name: str
    primary_email: str
    secondary_email: Optional[str] = None
    designation: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.primary_contact_name or not str(self.primary_contact_name).strip():
            raise DomainRuleViolationException("Primary Contact Name is mandatory and cannot be empty")
        if not self.primary_email or not str(self.primary_email).strip():
            raise DomainRuleViolationException("Primary Email is mandatory and cannot be empty")


@dataclass(frozen=True)
class SupplierBankInfo:
    bank_name: str
    account_number: str
    account_holder_name: Optional[str] = None
    ifsc: Optional[str] = None
    branch: Optional[str] = None
    swift_bic: Optional[str] = None
    tds_section: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.bank_name or not str(self.bank_name).strip():
            raise DomainRuleViolationException("Bank Name is mandatory and cannot be empty")
        if not self.account_number or not str(self.account_number).strip():
            raise DomainRuleViolationException("Account Number is mandatory and cannot be empty")


ALLOWED_DOCUMENT_TYPES = {
    "GST_CERTIFICATE",
    "CANCELLED_CHEQUE",
    "MSME_CERTIFICATE",
    "ISO_CERTIFICATE",
    "VENDOR_CODE_OF_CONDUCT",
}


@dataclass(frozen=True)
class SupplierDocument:
    document_type: str
    file_name: str
    storage_path: str
    upload_id: Optional[str] = None
    file_type: Optional[str] = None
    file_size: Optional[int] = None

    def __post_init__(self) -> None:
        if not self.document_type or not str(self.document_type).strip():
            raise DomainRuleViolationException("Document Type is mandatory")
        if not self.file_name or not str(self.file_name).strip():
            raise DomainRuleViolationException("File Name is mandatory")
        # Validate format
        allowed_exts = (".pdf", ".jpg", ".jpeg")
        lower_name = self.file_name.lower()
        if not any(lower_name.endswith(ext) for ext in allowed_exts):
            raise DomainRuleViolationException("Invalid document format. Only PDF and JPG files are allowed.")
        # Validate size (max 20
        # MB)
        max_size_bytes = 20 * 1024 * 1024
        if self.file_size is not None and self.file_size > max_size_bytes:
            raise DomainRuleViolationException("Document size exceeds maximum limit of 20 MB.")


from app.common.domain.aggregate_root import AggregateRoot
from app.common.domain.events import DomainEvent
from app.modules.procurement.domain.events import SupplierCreatedEvent


class Supplier(AggregateRoot):
    def __init__(
        self,
        id: SupplierId,
        supplier_name: str,
        registered_company_name: str,
        vendor_type: str,
        category: List[str],
        industry: str,
        gstin: str,
        supplier_code: Optional[str] = None,
        main_materials: Optional[List[str]] = None,
        rating: float = 0.0,
        performance_score: float = 0.0,
        address: Optional[SupplierAddress] = None,
        contact: Optional[SupplierContact] = None,
        bank_info: Optional[SupplierBankInfo] = None,
        documents: Optional[List[SupplierDocument]] = None,
        remarks: Optional[str] = None,
        status: str = "Active",
        created_by: Optional[str] = None,
        created_at: Optional[datetime] = None,
        updated_by: Optional[str] = None,
        updated_at: Optional[datetime] = None,
    ) -> None:
        super().__init__()
        self.id = id
        self.supplier_name = supplier_name
        self.registered_company_name = registered_company_name
        self.vendor_type = vendor_type
        self.category = category
        self.industry = industry
        self.gstin = gstin
        self.supplier_code = supplier_code
        self.main_materials = main_materials or []
        self.rating = rating
        self.performance_score = performance_score
        self.address = address
        self.contact = contact
        self.bank_info = bank_info
        self.documents = documents or []
        self.remarks = remarks
        self.status = status
        self.created_by = created_by
        self.created_at = created_at or datetime.now()
        self.updated_by = updated_by
        self.updated_at = updated_at or datetime.now()

    def update(
        self,
        supplier_name: Optional[str] = None,
        registered_company_name: Optional[str] = None,
        vendor_type: Optional[str] = None,
        category: Optional[List[str]] = None,
        industry: Optional[str] = None,
        gstin: Optional[str] = None,
        main_materials: Optional[List[str]] = None,
        address: Optional[SupplierAddress] = None,
        contact: Optional[SupplierContact] = None,
        bank_info: Optional[SupplierBankInfo] = None,
        documents: Optional[List[SupplierDocument]] = None,
        remarks: Optional[str] = None,
        updated_by: Optional[str] = None,
    ) -> None:
        if supplier_name is not None:
            self.supplier_name = supplier_name.strip()
        if registered_company_name is not None:
            self.registered_company_name = registered_company_name.strip()
        if vendor_type is not None:
            self.vendor_type = vendor_type.strip()
        if category is not None:
            self.category = category
        if industry is not None:
            self.industry = industry.strip()
        if gstin is not None:
            self.gstin = gstin.strip()
        if main_materials is not None:
            self.main_materials = main_materials
        if address is not None:
            self.address = address
        if contact is not None:
            self.contact = contact
        if bank_info is not None:
            self.bank_info = bank_info
        if documents is not None:
            self.documents = documents
        if remarks is not None:
            self.remarks = remarks.strip() if remarks else None

        self.updated_by = updated_by
        self.updated_at = datetime.now()

    def block(self) -> None:
        self.status = "Blocked"
   
    def unblock(self) -> None:
        self.status = "Active"

    @staticmethod
    def create(
        supplier_id: SupplierId,
        supplier_name: str,
        registered_company_name: str,
        vendor_type: str,
        category: List[str],
        industry: str,
        gstin: str,
        supplier_code: Optional[str] = None,
        main_materials: Optional[List[str]] = None,
        address: Optional[SupplierAddress] = None,
        contact: Optional[SupplierContact] = None,
        bank_info: Optional[SupplierBankInfo] = None,
        documents: Optional[List[SupplierDocument]] = None,
        remarks: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> "Supplier":
        """Factory method to create a new Supplier aggregate after validating Step 1-4 mandatory fields."""
        fields = {
            "Supplier Name": supplier_name,
            "Registered Company Name": registered_company_name,
            "Vendor Type": vendor_type,
            "Industry": industry,
            "GSTIN": gstin,
        }
        for name, value in fields.items():
            if value is None or not str(value).strip():
                raise DomainRuleViolationException(f"{name} is mandatory and cannot be empty")

        if not category:
            raise DomainRuleViolationException("At least one Category is mandatory")

        # Enforce Cancelled Cheque
        has_cheque = any(d.document_type == "Cancelled Cheque" for d in (documents or []))
        if not has_cheque:
            raise DomainRuleViolationException("Cancelled Cheque is a mandatory document for registration")

        supplier = Supplier(
            id=supplier_id,
            supplier_name=supplier_name.strip(),
            registered_company_name=registered_company_name.strip(),
            vendor_type=vendor_type.strip(),
            category=category,
            industry=industry.strip(),
            gstin=gstin.strip(),
            supplier_code=supplier_code,
            main_materials=main_materials or [],
            rating=0.0,
            performance_score=0.0,
            address=address,
            contact=contact,
            bank_info=bank_info,
            documents=documents or [],
            remarks=remarks.strip() if remarks else None,
            status="Pending Approval",
            created_by=created_by,
        )

        event = SupplierCreatedEvent(
            supplier_id=str(supplier.id),
            supplier_name=supplier.supplier_name,
            registered_company_name=supplier.registered_company_name,
            vendor_type=supplier.vendor_type,
            category=supplier.category,
            industry=supplier.industry,
            gstin=supplier.gstin,
            occurred_at=DomainEvent.now(),
        )
        supplier._register_event(event)
        return supplier

    @staticmethod
    def rehydrate(
        id: SupplierId,
        supplier_name: str,
        registered_company_name: str,
        vendor_type: str,
        category: List[str],
        industry: str,
        gstin: str,
        supplier_code: Optional[str] = None,
        main_materials: Optional[List[str]] = None,
        rating: float = 0.0,
        performance_score: float = 0.0,
        address: Optional[SupplierAddress] = None,
        contact: Optional[SupplierContact] = None,
        bank_info: Optional[SupplierBankInfo] = None,
        documents: Optional[List[SupplierDocument]] = None,
        remarks: Optional[str] = None,
        status: str = "Active",
        created_by: Optional[str] = None,
        created_at: Optional[datetime] = None,
        updated_by: Optional[str] = None,
        updated_at: Optional[datetime] = None,
    ) -> "Supplier":
        """Reconstruct Supplier aggregate from stored database rows."""
        return Supplier(
            id=id,
            supplier_name=supplier_name,
            registered_company_name=registered_company_name,
            vendor_type=vendor_type,
            category=category,
            industry=industry,
            gstin=gstin,
            supplier_code=supplier_code,
            main_materials=main_materials or [],
            rating=rating,
            performance_score=performance_score,
            address=address,
            contact=contact,
            bank_info=bank_info,
            documents=documents or [],
            remarks=remarks,
            status=status,
            created_by=created_by,
            created_at=created_at,
            updated_by=updated_by,
            updated_at=updated_at,
        )
