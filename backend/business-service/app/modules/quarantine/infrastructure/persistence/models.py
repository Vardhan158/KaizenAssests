import datetime
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, GUID


class QuarantineRecordModel(Base):
    __tablename__ = "quarantine_record"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    quarantine_number: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    grn_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("grn.id", ondelete="SET NULL"), nullable=True, index=True)
    grn_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    grn_line_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("grn_line.id", ondelete="SET NULL"), nullable=True, index=True)
    receiving_line_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("receiving_line.id", ondelete="SET NULL"), nullable=True, index=True)
    dock_assignment_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("dock_assignment.id", ondelete="SET NULL"), nullable=True)
    material_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material.id", ondelete="SET NULL"), nullable=True)
    material_variant_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material_variant.id", ondelete="SET NULL"), nullable=True)
    item_code: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    variant_code: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    damaged_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), default="PCS", nullable=False)
    batch_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    material_tag: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    supplier_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    po_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    asn_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    warehouse_id: Mapped[str] = mapped_column(String(64), default="Main Warehouse", nullable=False)
    reason: Mapped[str] = mapped_column(String(256), default="Damaged on arrival", nullable=False)
    receiving_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="PENDING_REVIEW", index=True, nullable=False)
    disposition: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    review_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    reviewed_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(128), default="system", nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc), onupdate=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)

    audits: Mapped[list["QuarantineAuditModel"]] = relationship(
        back_populates="quarantine_record", cascade="all, delete-orphan", order_by="QuarantineAuditModel.performed_at.desc()"
    )


class QuarantineAuditModel(Base):
    __tablename__ = "quarantine_audit"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    quarantine_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("quarantine_record.id", ondelete="CASCADE"), nullable=False, index=True)
    previous_status: Mapped[str] = mapped_column(String(32), nullable=False)
    new_status: Mapped[str] = mapped_column(String(32), nullable=False)
    disposition: Mapped[str] = mapped_column(String(64), nullable=False)
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    performed_by: Mapped[str] = mapped_column(String(128), nullable=False)
    performed_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)

    quarantine_record: Mapped["QuarantineRecordModel"] = relationship(back_populates="audits")
