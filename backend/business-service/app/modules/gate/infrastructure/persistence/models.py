"""
SQLAlchemy ORM models for Gate Entry module.
Uses GUID and JSONType to support PostgreSQL in production and SQLite in testing.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, LargeBinary, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, GUID

JSONType = JSON().with_variant(JSONB, "postgresql")


class DockModel(Base):
    __tablename__ = "warehouse_dock"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    dock_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    dock_type: Mapped[str] = mapped_column(String(64), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="AVAILABLE", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class DockAssignmentModel(Base):
    __tablename__ = "dock_assignment"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    gate_entry_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("gate_entry.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True)
    asn_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("asn.id", ondelete="RESTRICT"), nullable=True, index=True)
    po_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("purchase_order.id", ondelete="RESTRICT"), nullable=True, index=True)
    vehicle_number: Mapped[str] = mapped_column(String(32), nullable=False)
    dock_number: Mapped[str] = mapped_column(String(32), ForeignKey("warehouse_dock.dock_number", ondelete="RESTRICT"), nullable=False, index=True)
    assigned_store_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store.id", ondelete="SET NULL"), nullable=True, index=True)
    assigned_store_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    assigned_store_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    assigned_store_manager_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    assigned_store_manager_username: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    assigned_store_manager_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    assigned_by: Mapped[str] = mapped_column(String(128), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    movement_started_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    movement_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dock_checked_in_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    dock_arrival_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    unloading_started_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    unloading_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    quality_inspected_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    quality_inspected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    quality_decision: Mapped[str | None] = mapped_column(String(16), nullable=True)
    quality_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    quality_issue_image_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    quality_issue_filename: Mapped[str | None] = mapped_column(String(256), nullable=True)
    quality_issue_content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    quality_issue_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    quality_issue_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    quality_issue_forwarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    prepared_grn_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("grn.id", ondelete="RESTRICT"), nullable=True, unique=True)
    receiving_completed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    receiving_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dock_released_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    dock_released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ReceivingLineModel(Base):
    __tablename__ = "receiving_line"
    __table_args__ = (UniqueConstraint("dock_assignment_id", "item_code", name="uq_receiving_line_assignment_item"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    dock_assignment_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("dock_assignment.id", ondelete="CASCADE"), nullable=False, index=True)
    item_code: Mapped[str] = mapped_column(String(64), nullable=False)
    material_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    uom: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ordered_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    shipped_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    received_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    verification_status: Mapped[str] = mapped_column(String(16), nullable=False)
    exception_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    good_quantity: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    damaged_quantity: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    rejected_quantity: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    condition_result: Mapped[str | None] = mapped_column(String(32), nullable=True)
    inspection_required: Mapped[bool] = mapped_column(nullable=False, default=False)
    physical_condition_ok: Mapped[bool | None] = mapped_column(nullable=True)
    packaging_ok: Mapped[bool | None] = mapped_column(nullable=True)
    specifications_ok: Mapped[bool | None] = mapped_column(nullable=True)
    serial_batch_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    serial_batch_verified: Mapped[bool] = mapped_column(nullable=False, default=False)
    disposition_status: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    quarantine_location: Mapped[str | None] = mapped_column(String(128), nullable=True)
    quarantined_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    quarantined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    condition_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_checked_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    condition_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recorded_by: Mapped[str] = mapped_column(String(128), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class DamageReportModel(Base):
    __tablename__ = "damage_report"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    report_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    gate_entry_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("gate_entry.id", ondelete="RESTRICT"), nullable=False, index=True)
    receiving_line_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("receiving_line.id", ondelete="CASCADE"), nullable=False, index=True)
    material_code: Mapped[str] = mapped_column(String(64), nullable=False)
    material_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    po_number: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    grn_number: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    damaged_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    received_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    damage_reason: Mapped[str] = mapped_column(String(256), nullable=False)
    inspection_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    inspector: Mapped[str] = mapped_column(String(128), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING_PROCUREMENT", index=True)
    submitted_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SupplierDamageClaimModel(Base):
    __tablename__ = "supplier_damage_claim"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    claim_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    damage_report_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("damage_report.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True)
    supplier_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("supplier.id", ondelete="RESTRICT"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="SUPPLIER_SENT", index=True)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    supplier_response: Mapped[str | None] = mapped_column(String(32), nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(32), nullable=True)
    supplier_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    return_required: Mapped[bool] = mapped_column(nullable=False, default=False)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ReplacementShipmentModel(Base):
    __tablename__ = "replacement_shipment"
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    shipment_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    claim_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("supplier_damage_claim.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True)
    expected_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    vehicle_number: Mapped[str] = mapped_column(String(32), nullable=False)
    expected_arrival: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="IN_TRANSIT", index=True)
    gate_entry_number: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    gate_recorded_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    gate_recorded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replacement_grn_number: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    received_quantity: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    accepted_quantity: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    damaged_quantity: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    received_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    inspected_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    inspected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    putaway_location: Mapped[str | None] = mapped_column(String(128), nullable=True)
    putaway_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    putaway_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    inventory_posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SupplierReturnModel(Base):
    __tablename__ = "supplier_return"
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    return_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    claim_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("supplier_damage_claim.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="AWAITING_GATE_EXIT", index=True)
    vehicle_number: Mapped[str] = mapped_column(String(32), nullable=False)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    gate_exit_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    gate_exit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DamagePhotoModel(Base):
    __tablename__ = "damage_photo"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    damage_report_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("damage_report.id", ondelete="CASCADE"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(256), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    image_data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)


class VehicleExitApprovalModel(Base):
    __tablename__ = "vehicle_exit_approval"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    gate_entry_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("gate_entry.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True)
    dock_assignment_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("dock_assignment.id", ondelete="RESTRICT"), nullable=False, unique=True)
    asn_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("asn.id", ondelete="RESTRICT"), nullable=False)
    po_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("purchase_order.id", ondelete="RESTRICT"), nullable=False)
    grn_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("grn.id", ondelete="RESTRICT"), nullable=False)
    vehicle_number: Mapped[str] = mapped_column(String(32), nullable=False)
    driver_name: Mapped[str] = mapped_column(String(128), nullable=False)
    exit_document_reference: Mapped[str] = mapped_column(String(128), nullable=False)
    approved_by: Mapped[str] = mapped_column(String(128), nullable=False)
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class GateExitModel(Base):
    __tablename__ = "gate_exit"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    gate_entry_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("gate_entry.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True)
    exit_approval_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("vehicle_exit_approval.id", ondelete="RESTRICT"), nullable=False, unique=True)
    vehicle_number: Mapped[str] = mapped_column(String(32), nullable=False)
    completed_by: Mapped[str] = mapped_column(String(128), nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class QuantityVerificationPolicyModel(Base):
    __tablename__ = "quantity_verification_policy"

    policy_key: Mapped[str] = mapped_column(String(32), primary_key=True, default="DEFAULT")
    shortage_tolerance: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    excess_tolerance: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    updated_by: Mapped[str] = mapped_column(String(128), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class GateEntryModel(Base):
    __tablename__ = "gate_entry"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    gate_entry_number: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    po_id: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)
    asn_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("asn.id", ondelete="RESTRICT"), nullable=True, index=True)
    assigned_dock_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    po_number: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    vehicle_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)

    driver_name: Mapped[str] = mapped_column(String(128), nullable=False)
    driver_license_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    driver_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)

    driver_photo_path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    po_document_path: Mapped[str] = mapped_column(String(256), nullable=False)
    vehicle_photo_path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    po_document_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    vehicle_photo_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    verification_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    mismatched_fields: Mapped[dict | list | None] = mapped_column(JSONType, nullable=True)
    reasons: Mapped[dict | list | None] = mapped_column(JSONType, nullable=True)

    # ANPR results
    anpr_detected_vehicle: Mapped[str | None] = mapped_column(String(32), nullable=True)
    anpr_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    anpr_metadata: Mapped[dict | None] = mapped_column(JSONType, nullable=True)

    # OCR results
    ocr_po_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ocr_supplier_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ocr_product_material: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ocr_quantity: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    ocr_po_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ocr_expected_delivery_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ocr_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    ocr_raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_line_items: Mapped[list | None] = mapped_column(JSONType, nullable=True)

    # User & audit fields
    security_officer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    verified_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    manual_verification_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    exited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    exited_by: Mapped[str | None] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    audit_logs: Mapped[list["GateEntryAuditLogModel"]] = relationship(
        "GateEntryAuditLogModel", back_populates="gate_entry", cascade="all, delete-orphan"
    )


class GateEntryAuditLogModel(Base):
    __tablename__ = "gate_entry_audit_log"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    gate_entry_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("gate_entry.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    performed_by: Mapped[str] = mapped_column(String(64), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    details: Mapped[dict | None] = mapped_column(JSONType, nullable=True)

    gate_entry: Mapped["GateEntryModel"] = relationship("GateEntryModel", back_populates="audit_logs")
