"""
SQLAlchemy ORM models shared across WMS modules (Supplier, PO, ASN, Material, Notification, etc.)
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
import uuid

from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, ForeignKey, Integer, JSON, Numeric, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship, synonym

from app.database.base import Base, GUID


rfq_supplier_link = Table(
    "rfq_supplier_link",
    Base.metadata,
    Column("rfq_id", GUID, ForeignKey("rfq.id"), primary_key=True),
    Column("supplier_id", GUID, ForeignKey("supplier.id"), primary_key=True),
)


class VendorTypeModel(Base):
    __tablename__ = "vendor_type"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)


class SupplierCategoryModel(Base):
    __tablename__ = "supplier_category"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)


class SupplierModel(Base):
    __tablename__ = "supplier"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    supplier_name: Mapped[str] = mapped_column(String(128), nullable=False)
    registered_company_name: Mapped[str] = mapped_column(String(256), nullable=False, unique=True)
    vendor_type: Mapped[str] = mapped_column(String(64), nullable=False)
    category: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    industry: Mapped[str] = mapped_column(String(64), nullable=False)
    gstin: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    supplier_code: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True, nullable=True)
    main_materials: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    rating: Mapped[float] = mapped_column(Numeric(3, 2), default=0.0, nullable=False)
    performance_score: Mapped[float] = mapped_column(Numeric(5, 2), default=0.0, nullable=False)
    payment_terms: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    credit_period_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    remarks: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="Active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    created_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
    updated_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    address: Mapped[Optional["SupplierAddressModel"]] = relationship(
        "SupplierAddressModel", back_populates="supplier", uselist=False, cascade="all, delete-orphan"
    )
    contact: Mapped[Optional["SupplierContactModel"]] = relationship(
        "SupplierContactModel", back_populates="supplier", uselist=False, cascade="all, delete-orphan"
    )
    bank_info: Mapped[Optional["SupplierBankInfoModel"]] = relationship(
        "SupplierBankInfoModel", back_populates="supplier", uselist=False, cascade="all, delete-orphan"
    )
    documents: Mapped[List["SupplierDocumentModel"]] = relationship(
        "SupplierDocumentModel", back_populates="supplier", cascade="all, delete-orphan"
    )

    rfqs: Mapped[List["RfqModel"]] = relationship(
        "RfqModel", secondary=rfq_supplier_link, back_populates="suppliers"
    )


class SupplierAddressModel(Base):
    __tablename__ = "supplier_address"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    supplier_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("supplier.id", ondelete="CASCADE"), nullable=False)
    registered_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    pincode: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    supplier: Mapped["SupplierModel"] = relationship("SupplierModel", back_populates="address")


class SupplierContactModel(Base):
    __tablename__ = "supplier_contact"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    supplier_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("supplier.id", ondelete="CASCADE"), nullable=False)
    primary_contact_name: Mapped[str] = mapped_column(String(128), nullable=False)
    primary_email: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    secondary_email: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    designation: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, unique=True)
    website: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    supplier: Mapped["SupplierModel"] = relationship("SupplierModel", back_populates="contact")


class SupplierBankInfoModel(Base):
    __tablename__ = "supplier_bank_info"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    supplier_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("supplier.id", ondelete="CASCADE"), nullable=False)
    bank_name: Mapped[str] = mapped_column(String(128), nullable=False)
    account_number: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    account_holder_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    ifsc: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    branch: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    swift_bic: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    tds_section: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    supplier: Mapped["SupplierModel"] = relationship("SupplierModel", back_populates="bank_info")


class SupplierDocumentModel(Base):
    __tablename__ = "supplier_document"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    supplier_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("supplier.id", ondelete="CASCADE"), nullable=False)
    document_type: Mapped[str] = mapped_column(String(64), nullable=False)
    file_name: Mapped[str] = mapped_column(String(256), nullable=False)
    file_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    upload_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    supplier: Mapped["SupplierModel"] = relationship("SupplierModel", back_populates="documents")


class MaterialModel(Base):
    __tablename__ = "material"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    material_code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    category: Mapped[str] = mapped_column(String(128), nullable=False, default="General")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    base_uom: Mapped[str] = mapped_column(String(32), default="PCS", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="Active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    created_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
    updated_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    variants: Mapped[List["MaterialVariantModel"]] = relationship(
        "MaterialVariantModel", back_populates="material", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def code(self) -> str:
        return self.material_code

    @property
    def name(self) -> str:
        return self.material_name


class MaterialVariantModel(Base):
    __tablename__ = "material_variant"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    material_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("material.id", ondelete="CASCADE"), nullable=False, index=True
    )
    variant_code: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    size: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    color: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    grade: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    specification: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    uom: Mapped[str] = mapped_column(String(32), default="PCS", nullable=False)
    attributes: Mapped[Optional[dict]] = mapped_column(JSON, default=dict, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="Active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    created_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
    updated_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    material: Mapped["MaterialModel"] = relationship("MaterialModel", back_populates="variants")


supplier_material_link = Table(
    "supplier_material_link",
    Base.metadata,
    Column("supplier_id", GUID, ForeignKey("supplier.id", ondelete="CASCADE"), primary_key=True),
    Column("material_id", GUID, ForeignKey("material.id", ondelete="CASCADE"), primary_key=True),
)


class RfqModel(Base):
    __tablename__ = "rfq"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    rfq_number: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    rfq_date: Mapped[date] = mapped_column(Date, nullable=False)
    material_request_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    required_delivery_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    warehouse: Mapped[str] = mapped_column(String(128), nullable=False)
    procurement_officer: Mapped[str] = mapped_column(String(128), nullable=False)
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    closing_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    selected_supplier_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("supplier.id"), nullable=True)
    selection_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    selected_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    selection_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    selection_comments: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    items: Mapped[List[RfqItemModel]] = relationship(
        "RfqItemModel", back_populates="rfq", cascade="all, delete-orphan"
    )

    suppliers: Mapped[List["SupplierModel"]] = relationship(
        "SupplierModel", secondary=rfq_supplier_link, back_populates="rfqs"
    )


class RfqItemModel(Base):
    __tablename__ = "rfq_item"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    rfq_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("rfq.id", ondelete="CASCADE"), nullable=False)
    material_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material.id", ondelete="SET NULL"), nullable=True)
    material_variant_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material_variant.id", ondelete="SET NULL"), nullable=True)
    material_code: Mapped[str] = mapped_column(String(64), nullable=False)
    variant_code: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    category: Mapped[str] = mapped_column(String(128), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(64), nullable=False)
    required_delivery_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    warehouse: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    special_requirements: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    rfq: Mapped[RfqModel] = relationship("RfqModel", back_populates="items")
    material: Mapped[Optional["MaterialModel"]] = relationship("MaterialModel")
    variant: Mapped[Optional["MaterialVariantModel"]] = relationship("MaterialVariantModel")


class QuotationModel(Base):
    __tablename__ = "quotation"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    rfq_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("rfq.id"), nullable=False)
    supplier_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("supplier.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    discount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    tax: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    freight_charges: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    additional_charges: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    delivery_time: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    expected_delivery_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    payment_terms: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    mode_of_payment: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    warranty: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    quotation_validity: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    remarks: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    lines: Mapped[List[QuotationLineModel]] = relationship(back_populates="quotation", cascade="all, delete-orphan")
    documents: Mapped[List[QuotationDocumentModel]] = relationship(back_populates="quotation", cascade="all, delete-orphan")
    supplier: Mapped[SupplierModel] = relationship()


class QuotationDocumentModel(Base):
    __tablename__ = "quotation_document"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    quotation_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("quotation.id", ondelete="CASCADE"), nullable=False
    )
    document_type: Mapped[str] = mapped_column(String(64), nullable=False)
    file_name: Mapped[str] = mapped_column(String(256), nullable=False)
    file_url: Mapped[str] = mapped_column(String(512), nullable=False)

    quotation: Mapped[QuotationModel] = relationship(back_populates="documents")


class QuotationLineModel(Base):
    __tablename__ = "quotation_line"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    quotation_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("quotation.id"), nullable=False)
    material_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material.id", ondelete="SET NULL"), nullable=True)
    material_variant_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material_variant.id", ondelete="SET NULL"), nullable=True)
    item_code: Mapped[str] = mapped_column(String(64), nullable=False)
    variant_code: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)

    quotation: Mapped[QuotationModel] = relationship(back_populates="lines")
    material: Mapped[Optional["MaterialModel"]] = relationship("MaterialModel")
    variant: Mapped[Optional["MaterialVariantModel"]] = relationship("MaterialVariantModel")


class AsnModel(Base):
    __tablename__ = "asn"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    supplier_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("supplier.id"), nullable=True)
    asn_number: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    po_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    po_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    warehouse_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    vehicle_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    driver_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    driver_contact: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    expected_arrival_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    shipment_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    transporter: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    number_of_packages: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    package_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    shipping_method: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    shipment_type: Mapped[str] = mapped_column(String(32), nullable=False, default="STANDARD")
    replacement_request_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("replacement_request.id"), nullable=True)
    invoice_number: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    invoice_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    challan_number: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    challan_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    logistics: Mapped[Optional[list[dict]]] = mapped_column(JSON, nullable=True)

    lines: Mapped[List[AsnLineModel]] = relationship(back_populates="asn", cascade="all, delete-orphan")
    documents: Mapped[List[AsnDocumentModel]] = relationship(back_populates="asn", cascade="all, delete-orphan")


class ReplacementRequestModel(Base):
    __tablename__ = "replacement_request"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    request_number: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    supplier_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("supplier.id"), nullable=False, index=True)
    purchase_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("purchase_order.id"), nullable=True)
    original_asn_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("asn.id"), nullable=True)
    item_code: Mapped[str] = mapped_column(String(128), nullable=False)
    item_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    replacement_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    reason: Mapped[str] = mapped_column(String(256), nullable=False)
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    request_date: Mapped[date] = mapped_column(Date, default=date.today, nullable=False)
    supplier_response_due_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    replacement_dispatch_due_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="SENT_TO_SUPPLIER")
    supplier_response_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    extension_requested_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    disputed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now, nullable=False)


class AsnDocumentModel(Base):
    __tablename__ = "asn_document"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    asn_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("asn.id", ondelete="CASCADE"), nullable=False)
    document_type: Mapped[str] = mapped_column(String(64), nullable=False)
    file_name: Mapped[str] = mapped_column(String(256), nullable=False)
    file_url: Mapped[str] = mapped_column(String(512), nullable=False)
    uploaded_by: Mapped[str] = mapped_column(String(128), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    asn: Mapped[AsnModel] = relationship(back_populates="documents")


class AsnLineModel(Base):
    __tablename__ = "asn_line"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    asn_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("asn.id"), nullable=False)
    material_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material.id", ondelete="SET NULL"), nullable=True)
    material_variant_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material_variant.id", ondelete="SET NULL"), nullable=True)
    item_code: Mapped[str] = mapped_column(String(64), nullable=False)
    variant_code: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    shipped_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    material_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    uom: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    asn: Mapped[AsnModel] = relationship(back_populates="lines")
    material: Mapped[Optional["MaterialModel"]] = relationship("MaterialModel")
    variant: Mapped[Optional["MaterialVariantModel"]] = relationship("MaterialVariantModel")


class PurchaseOrderModel(Base):
    __tablename__ = "purchase_order"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    po_number: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    po_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CREATED")
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    rfq_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("rfq.id"), nullable=True)
    quotation_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("quotation.id"), nullable=True)
    supplier_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("supplier.id"), nullable=True)

    supplier_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    warehouse_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    expected_delivery_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    payment_terms: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    delivery_terms: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    warranty: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    billing_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    attachments: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    procurement_officer: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    department: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    supplier_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    supplier_contact_person: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    supplier_phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    supplier_email: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    supplier_gstin: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    supplier_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    delivery_warehouse_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    delivery_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    subtotal: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    freight_charges: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    additional_charges: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))

    selection_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    procurement_comments: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    selection_date: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.now)
    selected_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)

    items: Mapped[List["PurchaseOrderItemModel"]] = relationship(
        "PurchaseOrderItemModel", back_populates="purchase_order", cascade="all, delete-orphan"
    )

    history: Mapped[List["POApprovalHistoryModel"]] = relationship(
        "POApprovalHistoryModel", back_populates="purchase_order", cascade="all, delete-orphan"
    )
    revisions: Mapped[List["PORevisionModel"]] = relationship(
        "PORevisionModel", back_populates="purchase_order", cascade="all, delete-orphan"
    )

    rfq: Mapped[Optional["RfqModel"]] = relationship("RfqModel")
    quotation: Mapped[Optional["QuotationModel"]] = relationship("QuotationModel")


class POApprovalHistoryModel(Base):
    __tablename__ = "po_approval_history"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    purchase_order_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("purchase_order.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(128), nullable=False)
    comments: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    purchase_order: Mapped[PurchaseOrderModel] = relationship("PurchaseOrderModel", back_populates="history")


class PORevisionModel(Base):
    __tablename__ = "po_revision"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    purchase_order_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("purchase_order.id", ondelete="CASCADE"), nullable=False)
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    changed_field: Mapped[str] = mapped_column(String(128), nullable=False)
    old_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    new_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    changed_by: Mapped[str] = mapped_column(String(128), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    purchase_order: Mapped[PurchaseOrderModel] = relationship("PurchaseOrderModel", back_populates="revisions")


class PurchaseOrderItemModel(Base):
    __tablename__ = "purchase_order_item"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    purchase_order_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("purchase_order.id"), nullable=False)
    material_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material.id", ondelete="SET NULL"), nullable=True)
    material_variant_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material_variant.id", ondelete="SET NULL"), nullable=True)
    material_code: Mapped[str] = mapped_column(String(64), nullable=False)
    variant_code: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    material_name: Mapped[str] = mapped_column(String(255), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    discount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    tax: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")

    purchase_order: Mapped[PurchaseOrderModel] = relationship("PurchaseOrderModel", back_populates="items")
    material: Mapped[Optional["MaterialModel"]] = relationship("MaterialModel")
    variant: Mapped[Optional["MaterialVariantModel"]] = relationship("MaterialVariantModel")


class MaterialRequestModel(Base):
    __tablename__ = "material_request"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    request_number: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False)
    department: Mapped[str] = mapped_column(String(64), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    priority: Mapped[str] = mapped_column(String(32), nullable=False, default="MEDIUM")
    required_date: Mapped[date] = mapped_column(Date, nullable=False)
    suggested_supplier: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    attachments: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    approval_history: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)

    items: Mapped[List["MaterialRequestItemModel"]] = relationship(
        "MaterialRequestItemModel", back_populates="request", cascade="all, delete-orphan"
    )


class MaterialRequestItemModel(Base):
    __tablename__ = "material_request_item"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("material_request.id", ondelete="CASCADE"), nullable=False
    )
    material_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material.id", ondelete="SET NULL"), nullable=True)
    material_variant_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material_variant.id", ondelete="SET NULL"), nullable=True)
    material_code: Mapped[str] = mapped_column(String(64), nullable=False)
    variant_code: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    is_custom: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    custom_material_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    request: Mapped[MaterialRequestModel] = relationship("MaterialRequestModel", back_populates="items")
    material: Mapped[Optional["MaterialModel"]] = relationship("MaterialModel")
    variant: Mapped[Optional["MaterialVariantModel"]] = relationship("MaterialVariantModel")

    item_code = synonym("material_code")
    item_name = synonym("material_name")


class MaterialStockModel(Base):
    __tablename__ = "material_stock"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    material_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID, ForeignKey("material.id", ondelete="SET NULL"), nullable=True, index=True
    )
    material_variant_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID, ForeignKey("material_variant.id", ondelete="SET NULL"), nullable=True, index=True
    )
    material_code: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    material_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    variant_code: Mapped[Optional[str]] = mapped_column(String(128), index=True, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    warehouse_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, default="Main Warehouse")
    on_hand: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    allocated: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    available: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    reorder_point: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)

    material: Mapped[Optional["MaterialModel"]] = relationship("MaterialModel")
    variant: Mapped[Optional["MaterialVariantModel"]] = relationship("MaterialVariantModel")

    available_quantity = synonym("available")
    on_hand_quantity = synonym("on_hand")
    allocated_quantity = synonym("allocated")


class QuotationMagicLinkModel(Base):
    __tablename__ = "quotation_magic_link"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    token: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    rfq_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("rfq.id", ondelete="CASCADE"), nullable=False)
    supplier_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("supplier.id", ondelete="CASCADE"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)


class FinishedGoodsRequestModel(Base):
    __tablename__ = "finished_goods_request"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    request_number: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    material_code: Mapped[str] = mapped_column(String(64), nullable=False)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    variant_code: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    warehouse: Mapped[str] = mapped_column(String(128), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(128), nullable=False)
    department: Mapped[str] = mapped_column(String(128), nullable=False)
    priority: Mapped[str] = mapped_column(String(32), nullable=False, default="MEDIUM")
    required_date: Mapped[date] = mapped_column(Date, nullable=False)
    requested_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="SUBMITTED")
    work_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, nullable=True)
    work_order_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    completed_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class NotificationModel(Base):
    __tablename__ = "notification"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    user_role: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    link: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    dock_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    dock_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    dock_location: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    dock_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    warehouse_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    allocation_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    gate_pass_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    vehicle_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    driver_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    driver_phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    asn_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    po_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    grn_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    supplier_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    notification_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    payload_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class PickTaskModel(Base):
    __tablename__ = "pick_task"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    request_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, nullable=True)
    request_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    material_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    material_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    quantity: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    uom: Mapped[Optional[str]] = mapped_column(String(32), default="PCS")
    status: Mapped[Optional[str]] = mapped_column(String(64), default="PICKED")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class MaterialIssueModel(Base):
    __tablename__ = "material_issue"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    pick_task_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("pick_task.id"), nullable=True)
    requisition_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    material_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    material_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    quantity: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4), nullable=True)
    uom: Mapped[Optional[str]] = mapped_column(String(32), default="PCS")
    status: Mapped[Optional[str]] = mapped_column(String(64), default="ISSUED")
    issued_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    received_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
