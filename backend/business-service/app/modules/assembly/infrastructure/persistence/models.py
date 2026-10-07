from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional
import uuid

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, GUID


class AssemblyOrderModel(Base):
    __tablename__ = "assembly_order"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    order_number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    material_request_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("material_request.id", ondelete="RESTRICT"), unique=True, nullable=False)
    pick_task_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("pick_task.id", ondelete="RESTRICT"), unique=True, nullable=False)
    material_issue_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("material_issue.id", ondelete="RESTRICT"), unique=True, nullable=False)
    request_number: Mapped[str] = mapped_column(String(64), nullable=False)
    department: Mapped[str] = mapped_column(String(64), nullable=False)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="MEDIUM")
    required_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    assigned_team: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    assembly_steps: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    items: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    putaway_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PUTAWAY_PENDING", index=True)
    planned_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("1"))
    completed_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    rejected_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    assigned_line: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    assigned_operator: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


class AssemblyMaterialReservationModel(Base):
    __tablename__ = "assembly_material_reservation"
    __table_args__ = (
        UniqueConstraint("assembly_order_id", "material_code", name="uq_assembly_reservation_order_material"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    assembly_order_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("assembly_order.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    material_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="RESERVED")
    reserved_by: Mapped[str] = mapped_column(String(128), nullable=False)
    reserved_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)


class AssemblyTeamModel(Base):
    __tablename__ = "assembly_team"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    team_leader: Mapped[str] = mapped_column(String(128), nullable=False)
    workers: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    shift: Mapped[str] = mapped_column(String(64), nullable=False)
    workstation: Mapped[str] = mapped_column(String(64), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


class AssemblyMaterialConsumptionModel(Base):
    __tablename__ = "assembly_material_consumption"
    __table_args__ = (
        UniqueConstraint("assembly_order_id", "material_code", name="uq_assembly_consumption_order_material"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    assembly_order_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("assembly_order.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    material_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    expected_per_unit: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    assembled_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    actual_consumed: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False)
    recorded_by: Mapped[str] = mapped_column(String(128), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


class AssemblyScrapModel(Base):
    __tablename__ = "assembly_scrap"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    assembly_order_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("assembly_order.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    material_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    employee_team: Mapped[str] = mapped_column(String(128), nullable=False)
    approval_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING_APPROVAL")
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    approved_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class AssemblyQualityInspectionModel(Base):
    __tablename__ = "assembly_quality_inspection"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    assembly_order_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("assembly_order.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True
    )
    produced_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    passed_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    failed_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    rework_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING_INSPECTION")
    inspected_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    inspected_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


class AssemblyReworkOrderModel(Base):
    __tablename__ = "assembly_rework_order"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    assembly_order_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("assembly_order.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    rework_number: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    reason_for_failure: Mapped[str] = mapped_column(Text, nullable=False)
    failed_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    assigned_team: Mapped[str] = mapped_column(String(128), nullable=False)
    assigned_worker: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    final_result: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING_INSPECTION")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


class AssemblyFinishedGoodsModel(Base):
    __tablename__ = "assembly_finished_goods"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    assembly_order_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("assembly_order.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True
    )
    product_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="AVAILABLE")
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False)
    location_code: Mapped[str] = mapped_column(String(64), nullable=False)
    on_hand_before: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    on_hand_after: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    qr_code: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    serial_number: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    store_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID, ForeignKey("store.id", ondelete="SET NULL"), nullable=True, index=True
    )
    posted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


class BillOfMaterialsModel(Base):
    __tablename__ = "bill_of_materials"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    bom_number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    product_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="Assembly")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)

    items: Mapped[list["BillOfMaterialsItemModel"]] = relationship(
        "BillOfMaterialsItemModel", back_populates="bom", cascade="all, delete-orphan", lazy="selectin"
    )


class BillOfMaterialsItemModel(Base):
    __tablename__ = "bill_of_materials_item"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    bom_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("bill_of_materials.id", ondelete="CASCADE"), nullable=False, index=True
    )
    material_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, nullable=True)
    material_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    variant_code: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    quantity_per_unit: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)

    bom: Mapped["BillOfMaterialsModel"] = relationship("BillOfMaterialsModel", back_populates="items")

