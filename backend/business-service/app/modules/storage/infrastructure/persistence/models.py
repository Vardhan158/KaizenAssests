"""
SQLAlchemy ORM models for the Storage module (Putaway & Locations).
"""
from __future__ import annotations

from datetime import datetime, timezone, date
from decimal import Decimal
import uuid
from typing import List, Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, GUID


class StorageLocationModel(Base):
    __tablename__ = "storage_location"
    __table_args__ = (UniqueConstraint("warehouse_id", "zone", "rack", "bin", name="uq_storage_location_path"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    location_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    store_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store.id", ondelete="SET NULL"), nullable=True, index=True)
    zone_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store_zone.id", ondelete="SET NULL"), nullable=True, index=True)
    bin_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store_bin.id", ondelete="SET NULL"), nullable=True, index=True)
    zone: Mapped[str] = mapped_column(String(128), nullable=False)
    rack: Mapped[str] = mapped_column(String(64), nullable=False)
    bin: Mapped[str] = mapped_column(String(64), nullable=False)
    capacity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    occupied_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class PutawayTaskModel(Base):
    __tablename__ = "putaway_task"
    __table_args__ = (UniqueConstraint("grn_id", "item_code", "batch_number", name="uq_putaway_task_grn_item_batch"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    task_number: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    grn_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("grn.id", ondelete="RESTRICT"), nullable=True, index=True)
    grn_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    finished_goods_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("assembly_finished_goods.id", ondelete="SET NULL"), nullable=True, index=True)
    handling_unit_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("handling_unit.id", ondelete="RESTRICT"), nullable=True, unique=True, index=True)

    item_code: Mapped[str] = mapped_column(String(64), nullable=False)
    batch_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_location: Mapped[str] = mapped_column(String(64), nullable=False, default="RECEIVING_AREA")
    destination_store_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store.id", ondelete="SET NULL"), nullable=True, index=True)
    destination_zone_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store_zone.id", ondelete="SET NULL"), nullable=True, index=True)
    destination_bin_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store_bin.id", ondelete="SET NULL"), nullable=True, index=True)
    destination_location_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("storage_location.id", ondelete="RESTRICT"), nullable=True, index=True)
    destination_zone: Mapped[str | None] = mapped_column(String(128), nullable=True)
    destination_rack: Mapped[str | None] = mapped_column(String(64), nullable=True)
    destination_bin: Mapped[str | None] = mapped_column(String(64), nullable=True)
    destination_bin_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    location_assigned_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    location_assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    assigned_to: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    assigned_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    material_category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    handling_requirement: Mapped[str | None] = mapped_column(String(128), nullable=True)
    rotation_policy: Mapped[str | None] = mapped_column(String(16), nullable=True)
    placement_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="OPEN", index=True)
    started_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class HandlingUnitModel(Base):
    __tablename__ = "handling_unit"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    hu_number: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    barcode_value: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    receiving_line_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("receiving_line.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True)
    grn_line_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("grn_line.id", ondelete="RESTRICT"), nullable=True, unique=True, index=True)
    item_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False)
    batch_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False)
    po_number: Mapped[str] = mapped_column(String(64), nullable=False)
    asn_number: Mapped[str] = mapped_column(String(64), nullable=False)
    grn_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False)
    current_location: Mapped[str] = mapped_column(String(128), nullable=False, default="RECEIVING_AREA")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="LABEL_GENERATED", index=True)
    generated_by: Mapped[str] = mapped_column(String(128), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PutawayMovementModel(Base):
    __tablename__ = "putaway_movement"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    putaway_task_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("putaway_task.id", ondelete="RESTRICT"), nullable=False, index=True)
    material_scan: Mapped[str] = mapped_column(String(64), nullable=False)
    location_scan: Mapped[str] = mapped_column(String(64), nullable=False)
    material_code: Mapped[str] = mapped_column(String(64), nullable=False)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    source_location: Mapped[str] = mapped_column(String(128), nullable=False)
    destination_location: Mapped[str] = mapped_column(String(128), nullable=False)
    batch_lot: Mapped[str | None] = mapped_column(String(128), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    container_pallet: Mapped[str | None] = mapped_column(String(128), nullable=True)
    confirmed_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False)
    inventory_available_before: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    inventory_available_after: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    confirmed_by: Mapped[str] = mapped_column(String(128), nullable=False)
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class InventoryLocationBalanceModel(Base):
    __tablename__ = "inventory_location_balance"
    __table_args__ = (UniqueConstraint("material_code", "storage_location_id", name="uq_inventory_location_material_bin"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    material_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    storage_location_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("storage_location.id", ondelete="RESTRICT"), nullable=False, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    available_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    uom: Mapped[str] = mapped_column(String(32), nullable=False)
    last_putaway_task_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("putaway_task.id", ondelete="RESTRICT"), nullable=False)
    last_grn_number: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AssemblyRequisitionModel(Base):
    __tablename__ = "assembly_requisition"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    requisition_number: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False, default="Main Warehouse")
    department: Mapped[str] = mapped_column(String(64), nullable=False, default="Assembly")
    requested_by: Mapped[str] = mapped_column(String(128), nullable=False)
    priority: Mapped[str] = mapped_column(String(32), nullable=False, default="MEDIUM")
    required_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", index=True)
    assigned_store_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store.id", ondelete="SET NULL"), nullable=True)
    assigned_store_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    assigned_store_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    assigned_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    items: Mapped[List["AssemblyRequisitionItemModel"]] = relationship(
        "AssemblyRequisitionItemModel", back_populates="requisition", cascade="all, delete-orphan"
    )


class AssemblyRequisitionItemModel(Base):
    __tablename__ = "assembly_requisition_item"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    requisition_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("assembly_requisition.id", ondelete="CASCADE"), nullable=False, index=True)
    material_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("material.id", ondelete="SET NULL"), nullable=True)
    material_variant_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("material_variant.id", ondelete="SET NULL"), nullable=True)
    material_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    variant_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    requested_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    reserved_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    issued_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    is_custom: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    custom_material_name: Mapped[str | None] = mapped_column(String(256), nullable=True)

    requisition: Mapped[AssemblyRequisitionModel] = relationship("AssemblyRequisitionModel", back_populates="items")


class AssemblyStockReservationModel(Base):
    __tablename__ = "assembly_stock_reservation"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    requisition_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("assembly_requisition.id", ondelete="CASCADE"), nullable=False, index=True)
    requisition_item_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("assembly_requisition_item.id", ondelete="CASCADE"), nullable=False, index=True)
    requisition_number: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    material_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    required_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    reserved_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="RESERVED FOR ASSEMBLY", index=True)
    store_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store.id", ondelete="SET NULL"), nullable=True, index=True)
    store_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    store_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    zone_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bin_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    location_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    storage_location_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("storage_location.id", ondelete="SET NULL"), nullable=True)
    reserved_by: Mapped[str] = mapped_column(String(128), nullable=False)
    reserved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    requisition: Mapped[AssemblyRequisitionModel] = relationship("AssemblyRequisitionModel")
    requisition_item: Mapped[AssemblyRequisitionItemModel] = relationship("AssemblyRequisitionItemModel")


class PickupTaskModel(Base):
    __tablename__ = "pickup_task"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    task_number: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    requisition_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("assembly_requisition.id", ondelete="CASCADE"), nullable=False, index=True)
    requisition_number: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    store_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("store.id", ondelete="RESTRICT"), nullable=False, index=True)
    store_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    store_name: Mapped[str] = mapped_column(String(256), nullable=False)
    department: Mapped[str] = mapped_column(String(64), nullable=False, default="Assembly")
    material_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    requested_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    picked_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    priority: Mapped[str] = mapped_column(String(32), nullable=False, default="MEDIUM")
    required_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    suggested_zone_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store_zone.id", ondelete="SET NULL"), nullable=True)
    suggested_zone_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    picked_zone_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store_zone.id", ondelete="SET NULL"), nullable=True)
    picked_zone_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ASSIGNED_TO_STORE", index=True)
    assigned_by: Mapped[str] = mapped_column(String(128), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    started_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)


class InventoryIssueTransactionModel(Base):
    __tablename__ = "inventory_issue_transaction"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    issue_number: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    requisition_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("assembly_requisition.id", ondelete="SET NULL"), nullable=True)
    requisition_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pickup_task_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("pickup_task.id", ondelete="SET NULL"), nullable=True)
    store_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("store.id", ondelete="RESTRICT"), nullable=False)
    store_code: Mapped[str] = mapped_column(String(64), nullable=False)
    zone_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store_zone.id", ondelete="SET NULL"), nullable=True)
    zone_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    material_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    recipient_department: Mapped[str] = mapped_column(String(64), nullable=False, default="Assembly")
    stock_before: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    stock_after: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    issued_by: Mapped[str] = mapped_column(String(128), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class InventoryMovementHistoryModel(Base):
    """
    Authoritative audit history for all physical and systemic inventory movements:
    PUTAWAY, TAKEAWAY, TRANSFER, RETURN, DISPOSITION.
    Captures Material QR, source & destination locations/bins, quantities, performing user & role.
    """
    __tablename__ = "inventory_movement_history"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    movement_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)  # PUTAWAY, TAKEAWAY, TRANSFER
    material_code: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    material_name: Mapped[str] = mapped_column(String(256), nullable=False)
    material_qr: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    grn_number: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    batch_lot: Mapped[str | None] = mapped_column(String(128), nullable=True)
    from_location: Mapped[str] = mapped_column(String(128), nullable=False)
    to_location: Mapped[str] = mapped_column(String(128), nullable=False)
    from_bin_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store_bin.id", ondelete="SET NULL"), nullable=True)
    to_bin_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store_bin.id", ondelete="SET NULL"), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    stock_before: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    stock_after: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    performed_by: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    user_role: Mapped[str | None] = mapped_column(String(64), nullable=True)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False, default="MAIN")
    store_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store.id", ondelete="SET NULL"), nullable=True, index=True)
    store_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    reference_document: Mapped[str | None] = mapped_column(String(128), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)



