"""
SQLAlchemy ORM models for the Goods Receiving / GRN module.

Workflow:
Purchase Order
    -> GRN Header
    -> GRN Lines
    -> Damage Evidence
    -> Quality Inspection
    -> Batch Creation
    -> Document Upload
    -> Batch-wise QR Generation
    -> Inventory Receipt Posting

Important business rules:
1. One PO -> One GRN
2. Receiving Dock is manually selected in the GRN module
3. Partial receipt updates the same GRN
4. Each GRN can contain multiple material lines
5. Each GRN line can have multiple damage evidences
6. Each GRN line can have multiple batches
7. One Batch -> One QR Code
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)

from app.database.base import Base, GUID


# ============================================================
# 1. GRN HEADER
# ============================================================


class GrnModel(Base):
    """
    Main Goods Receipt Note table.

    Business rule:
        One PO -> One GRN

    If material is partially received, this same GRN remains open
    with status PARTIALLY_COMPLETED.

    When the remaining quantity is received, the same GRN is updated.
    """

    __tablename__ = "grn"

    # --------------------------------------------------------
    # Primary Key
    # --------------------------------------------------------

    id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        primary_key=True,
        default=uuid.uuid4,
    )

    # --------------------------------------------------------
    # Purchase Order Reference
    # --------------------------------------------------------

    po_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        nullable=True,
        unique=False,
        index=True,
    )

    po_number: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        unique=False,
        index=True,
    )

    # --------------------------------------------------------
    # GRN Number
    # --------------------------------------------------------

    grn_number: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        unique=True,
        index=True,
    )

    # --------------------------------------------------------
    # ASN Reference
    # --------------------------------------------------------

    asn_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        nullable=True,
    )

    asn_number: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )

    # --------------------------------------------------------
    # Gate Entry Reference
    # --------------------------------------------------------

    gate_entry_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        nullable=True,
    )

    gate_entry_number: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )

    # --------------------------------------------------------
    # Supplier Information
    # --------------------------------------------------------

    supplier_name: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )

    supplier_company_name: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )

    # --------------------------------------------------------
    # Warehouse Information
    # --------------------------------------------------------

    warehouse_id: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )

    warehouse_name: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )

    # --------------------------------------------------------
    # Receiving Dock
    #
    # IMPORTANT:
    # This is manually selected/entered in GRN Page 1.
    #
    # DO NOT use:
    # ForeignKey("warehouse_dock.dock_number")
    #
    # DO NOT automatically copy:
    # dock_assignment.dock_number
    # --------------------------------------------------------

    dock_number: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
    )

    # --------------------------------------------------------
    # Vehicle / Driver Information
    # Normally auto-fetched from ASN.
    # --------------------------------------------------------

    vehicle_number: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )

    driver_name: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
    )

    # --------------------------------------------------------
    # Invoice
    # --------------------------------------------------------

    invoice_number: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
    )

    # --------------------------------------------------------
    # Receipt Type
    #
    # PO_RECEIPT
    # UNEXPECTED_DELIVERY
    # --------------------------------------------------------

    receipt_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="PO_RECEIPT",
        server_default="PO_RECEIPT",
    )

    # --------------------------------------------------------
    # Receipt Information
    # --------------------------------------------------------

    receipt_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    received_by: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
    )

    # --------------------------------------------------------
    # GRN Status
    #
    # DRAFT
    # PARTIALLY_COMPLETED
    # RECEIVING_COMPLETE
    # COMPLETED
    # --------------------------------------------------------

    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="DRAFT",
        server_default="DRAFT",
    )

    # --------------------------------------------------------
    # Inventory Posting Information
    # Existing project fields
    # --------------------------------------------------------

    posted_by: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
    )

    posted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    verification_notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # --------------------------------------------------------
    # Audit Fields
    # --------------------------------------------------------

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # --------------------------------------------------------
    # Relationships
    # --------------------------------------------------------

    lines: Mapped[list["GrnLineModel"]] = relationship(
        back_populates="grn",
        cascade="all, delete-orphan",
    )

    documents: Mapped[list["GrnDocumentModel"]] = relationship(
        back_populates="grn",
        cascade="all, delete-orphan",
    )

    receiving_sessions: Mapped[list["GrnReceivingSessionModel"]] = relationship(
        back_populates="grn",
        cascade="all, delete-orphan",
    )

    documents: Mapped[list["GrnDocumentModel"]] = relationship(
        back_populates="grn",
        cascade="all, delete-orphan",
    )

    receiving_sessions: Mapped[list["GrnReceivingSessionModel"]] = relationship(
        back_populates="grn",
        cascade="all, delete-orphan",
    )


# ============================================================
# 2. GRN ITEM / MATERIAL RECEIVING DETAILS
# ============================================================


# ============================================================
# 2. GRN ITEM / MATERIAL RECEIVING DETAILS
# ============================================================


class GrnLineModel(Base):
    """
    Stores each material received against a GRN.

    Example:

    PO Quantity      = 100
    Good Quantity    = 80
    Damaged Quantity = 10
    Balance Quantity = 10
    """

    __tablename__ = "grn_line"

    # --------------------------------------------------------
    # Primary Key
    # --------------------------------------------------------

    id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        primary_key=True,
        default=uuid.uuid4,
    )

    # --------------------------------------------------------
    # GRN Reference
    # --------------------------------------------------------

    grn_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey(
            "grn.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    # --------------------------------------------------------
    # Material Information
    # --------------------------------------------------------

    item_code: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    material_name: Mapped[Optional[str]] = mapped_column(
        String(256),
        nullable=True,
    )

    material_category: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
    )

    variant_code: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
    )

    uom: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
    )

    # --------------------------------------------------------
    # Purchase Order Quantity
    # --------------------------------------------------------

    ordered_quantity: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(18, 4),
        nullable=True,
    )

    # --------------------------------------------------------
    # Physical Received Quantity
    #
    # received_quantity =
    # good_quantity + damaged_quantity
    # --------------------------------------------------------

    received_quantity: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
        default=Decimal("0"),
        server_default="0",
    )

    # --------------------------------------------------------
    # Good Quantity
    # --------------------------------------------------------

    good_quantity: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
        default=Decimal("0"),
        server_default="0",
    )

    # --------------------------------------------------------
    # Damaged Quantity
    # --------------------------------------------------------

    damaged_quantity: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
        default=Decimal("0"),
        server_default="0",
    )

    # --------------------------------------------------------
    # Accepted Quantity
    #
    # Existing field retained for compatibility.
    # --------------------------------------------------------

    accepted_quantity: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(18, 4),
        nullable=True,
    )

    # --------------------------------------------------------
    # Rejected Quantity
    # --------------------------------------------------------

    rejected_quantity: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
        default=Decimal("0"),
        server_default="0",
    )

    # --------------------------------------------------------
    # Quality Approved Quantity
    #
    # Only this approved quantity should be used for
    # batch creation.
    # --------------------------------------------------------

    quality_approved_quantity: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
        default=Decimal("0"),
        server_default="0",
    )

    # --------------------------------------------------------
    # Balance Quantity
    #
    # Concept:
    #
    # PO Quantity - Total Accounted Quantity
    # --------------------------------------------------------

    balance_quantity: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
        default=Decimal("0"),
        server_default="0",
    )

    # --------------------------------------------------------
    # Quality Status
    #
    # Possible examples:
    # PENDING
    # ACCEPTED
    # REJECTED
    # HOLD
    # --------------------------------------------------------

    quality_result: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
    )

    # --------------------------------------------------------
    # Relationships
    # --------------------------------------------------------

    grn: Mapped["GrnModel"] = relationship(
        back_populates="lines",
    )

    damage_evidence: Mapped[
        list["GrnDamageEvidenceModel"]
    ] = relationship(
        back_populates="grn_line",
        cascade="all, delete-orphan",
    )

    batches: Mapped[
        list["GrnBatchModel"]
    ] = relationship(
        back_populates="grn_line",
        cascade="all, delete-orphan",
    )

    damage_lots: Mapped[
        list["GrnDamageLotModel"]
    ] = relationship(
        back_populates="grn_line",
        cascade="all, delete-orphan",
    )


# ============================================================
# 3. DAMAGED GOODS / PHOTO EVIDENCE
# ============================================================


class GrnDamageEvidenceModel(Base):
    """
    Stores evidence for damaged materials.

    Damaged quantity is obtained from the GRN line.
    The user should not manually re-enter damaged quantity
    on the Damage Evidence page.
    """

    __tablename__ = "grn_damage_evidence"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        primary_key=True,
        default=uuid.uuid4,
    )

    # --------------------------------------------------------
    # GRN Line Reference
    # --------------------------------------------------------

    grn_line_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey(
            "grn_line.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    # --------------------------------------------------------
    # Damage Information
    # --------------------------------------------------------

    damaged_quantity: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
    )

    reason: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    remarks: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # --------------------------------------------------------
    # Photo / File
    # --------------------------------------------------------

    file_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    file_path: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
    )

    # --------------------------------------------------------
    # Upload Information
    # --------------------------------------------------------

    uploaded_by: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
    )

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # --------------------------------------------------------
    # Relationship
    # --------------------------------------------------------

    grn_line: Mapped["GrnLineModel"] = relationship(
        back_populates="damage_evidence",
    )


# ============================================================
# 4. BATCH CREATION
# ============================================================


class GrnBatchModel(Base):
    """Stores batches created from quality-approved quantity."""

    __tablename__ = "grn_batch"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        primary_key=True,
        default=uuid.uuid4,
    )

    # --------------------------------------------------------
    # GRN Line Reference
    # --------------------------------------------------------

    grn_line_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey(
            "grn_line.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    # --------------------------------------------------------
    # Batch Information
    # --------------------------------------------------------

    batch_number: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True,
    )

    batch_quantity: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
    )

    # --------------------------------------------------------
    # Audit Information
    # --------------------------------------------------------

    created_by: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # --------------------------------------------------------
    # Relationships
    # --------------------------------------------------------

    grn_line: Mapped["GrnLineModel"] = relationship(
        back_populates="batches",
    )

    # Material-wise QR Code (shared across all batches of the same material)
    qr_code: Mapped[
        Optional["GrnBatchQrModel"]
    ] = relationship(
        primaryjoin="foreign(GrnBatchModel.grn_line_id) == foreign(GrnLineModel.id)",
        secondary="grn_line",
        secondaryjoin="foreign(GrnLineModel.item_code) == foreign(GrnBatchQrModel.item_code)",
        uselist=False,
        viewonly=True,
    )


# ============================================================
# 5. GRN DOCUMENT UPLOAD
# ============================================================


class GrnDocumentModel(Base):
    """
    Stores receiving-related documents.

    Examples:
    INVOICE
    DELIVERY_CHALLAN
    PACKING_LIST
    DAMAGE_PHOTO
    QUALITY_DOCUMENT
    OTHER
    """

    __tablename__ = "grn_document"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        primary_key=True,
        default=uuid.uuid4,
    )

    # --------------------------------------------------------
    # GRN Reference
    # --------------------------------------------------------

    grn_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey(
            "grn.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    # --------------------------------------------------------
    # Document Information
    # --------------------------------------------------------

    document_type: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    file_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    file_path: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
    )

    # --------------------------------------------------------
    # Upload Information
    # --------------------------------------------------------

    uploaded_by: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
    )

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # --------------------------------------------------------
    # Relationship
    # --------------------------------------------------------

    grn: Mapped["GrnModel"] = relationship(
        back_populates="documents",
    )


# ============================================================
# 6. MATERIAL-WISE QR CODE
# ============================================================


class GrnBatchQrModel(Base):
    """Stores the material-wise QR code shared by batches of the same item."""

    __tablename__ = "grn_batch_qr"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        primary_key=True,
        default=uuid.uuid4,
    )

    # --------------------------------------------------------
    # Optional Batch Reference
    # --------------------------------------------------------

    batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey(
            "grn_batch.id",
            ondelete="SET NULL",
        ),
        nullable=True,
        index=True,
    )

    # --------------------------------------------------------
    # Material Information (Primary Unique Key for QR)
    # --------------------------------------------------------

    item_code: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True,
    )

    # --------------------------------------------------------
    # QR Information
    # --------------------------------------------------------

    qr_code: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        unique=True,
        index=True,
    )

    qr_payload: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


# ============================================================
# 6B. DAMAGED GOODS LOT & DAMAGE QR CODE
# ============================================================


class GrnDamageLotModel(Base):
    """Stores damage lots created for damaged or rejected material lines."""

    __tablename__ = "grn_damage_lot"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        primary_key=True,
        default=uuid.uuid4,
    )

    grn_line_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey(
            "grn_line.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    damage_lot_number: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True,
    )

    damaged_quantity: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
    )

    uom: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
    )

    reason: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    qa_status: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
        default="REJECTED",
    )

    quarantine_location: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        default="QUARANTINE-ZONE-A",
    )

    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="DAMAGED",
        server_default="DAMAGED",
    )

    created_by: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    grn_line: Mapped["GrnLineModel"] = relationship(
        back_populates="damage_lots",
    )

    qr_code: Mapped[Optional["GrnDamageQrModel"]] = relationship(
        back_populates="damage_lot",
        uselist=False,
        cascade="all, delete-orphan",
    )


class GrnDamageQrModel(Base):
    """
    Stores unique QR code for a Damage Lot.
    """

    __tablename__ = "grn_damage_qr"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        primary_key=True,
        default=uuid.uuid4,
    )

    damage_lot_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey(
            "grn_damage_lot.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        unique=True,
        index=True,
    )

    grn_line_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey(
            "grn_line.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    grn_number: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    item_code: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    qr_code: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        unique=True,
        index=True,
    )

    qr_payload: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    generated_by: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
    )

    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    damage_lot: Mapped["GrnDamageLotModel"] = relationship(
        back_populates="qr_code",
    )


# ============================================================
# 7. INVENTORY RECEIPT POSTING
# ============================================================


class InventoryReceiptPostingModel(Base):
    """
    Existing inventory posting model.

    Stores inventory quantity movement created after
    GRN receiving / posting.
    """

    __tablename__ = "inventory_receipt_posting"

    # --------------------------------------------------------
    # Prevent duplicate inventory posting for the same
    # GRN + Material.
    # --------------------------------------------------------

    __table_args__ = (
        UniqueConstraint(
            "grn_id",
            "item_code",
            name="uq_inventory_posting_grn_item",
        ),
    )

    # --------------------------------------------------------
    # Primary Key
    # --------------------------------------------------------

    id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        primary_key=True,
        default=uuid.uuid4,
    )

    # --------------------------------------------------------
    # GRN Reference
    # --------------------------------------------------------

    grn_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey(
            "grn.id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )

    grn_number: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    # --------------------------------------------------------
    # PO Reference
    # --------------------------------------------------------

    po_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        nullable=True,
    )

    po_number: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )

    # --------------------------------------------------------
    # ASN Reference
    # --------------------------------------------------------

    asn_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        nullable=True,
    )

    asn_number: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )

    # --------------------------------------------------------
    # Supplier
    # --------------------------------------------------------

    supplier_name: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )

    # --------------------------------------------------------
    # Material
    # --------------------------------------------------------

    item_code: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    material_name: Mapped[Optional[str]] = mapped_column(
        String(256),
        nullable=True,
    )

    uom: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
    )

    # --------------------------------------------------------
    # Warehouse
    # --------------------------------------------------------

    warehouse_id: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )

    # --------------------------------------------------------
    # Inventory Quantity
    # --------------------------------------------------------

    posted_quantity: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
    )

    on_hand_before: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
    )

    on_hand_after: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
    )

    # --------------------------------------------------------
    # Posting Audit
    # --------------------------------------------------------

    posted_by: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
    )

    posted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )


# ============================================================
# 8. MULTI-SESSION RECEIVING / TRUCK ARRIVALS
# ============================================================


class GrnReceivingSessionModel(Base):
    """Captures each receiving session or truck arrival for multi-delivery POs."""

    __tablename__ = "grn_receiving_session"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        primary_key=True,
        default=uuid.uuid4,
    )

    grn_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey(
            "grn.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    gate_entry_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey(
            "gate_entry.id",
        ),
        nullable=False,
        index=True,
    )

    asn_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey(
            "asn.id",
        ),
        nullable=True,
    )

    vehicle_number: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    driver_name: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
    )

    session_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    grn: Mapped["GrnModel"] = relationship(
        back_populates="receiving_sessions",
    )
