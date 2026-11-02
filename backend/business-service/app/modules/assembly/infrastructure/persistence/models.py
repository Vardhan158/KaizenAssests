from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional
import uuid

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, GUID


class AssemblyUnitModel(Base):
    __tablename__ = "assembly_unit"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    unit_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    unit_name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


class AssemblyOrderModel(Base):
    __tablename__ = "assembly_order"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    order_number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    material_request_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material_request.id", ondelete="RESTRICT"), nullable=True)
    pick_task_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("pick_task.id", ondelete="RESTRICT"), nullable=True)
    material_issue_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("material_issue.id", ondelete="RESTRICT"), nullable=True)
    request_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    department: Mapped[str] = mapped_column(String(64), nullable=False, default="Assembly")
    product_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    bom_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("bill_of_materials.id", ondelete="SET NULL"), nullable=True, index=True)
    bom_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="NORMAL")
    required_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    assigned_team: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    assembly_steps: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    items: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PLANNED")
    putaway_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PUTAWAY_PENDING", index=True)
    planned_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("1"))
    completed_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    rejected_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    traceability_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    assigned_line: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    assigned_operator: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    material_received_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    material_received_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
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


class AssemblyMaterialReceiptModel(Base):
    __tablename__ = "assembly_material_receipt"
    __table_args__ = (UniqueConstraint("assembly_order_id", "material_code", name="uq_assembly_receipt_order_material"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    assembly_order_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("assembly_order.id", ondelete="RESTRICT"), nullable=False, index=True)
    material_issue_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("material_issue.id", ondelete="RESTRICT"), nullable=False, index=True)
    material_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    material_qr: Mapped[str | None] = mapped_column(String(128), nullable=True)
    issued_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    received_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False, default="PCS")
    received_by: Mapped[str] = mapped_column(String(128), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)


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


class AssemblyMaterialConsumptionEventModel(Base):
    """Append-only material consumption tied to the original warehouse batch."""

    __tablename__ = "assembly_material_consumption_event"
    __table_args__ = (
        CheckConstraint("actual_consumed > 0", name="ck_assembly_consumption_event_positive_qty"),
        CheckConstraint("length(trim(idempotency_key)) > 0", name="ck_assembly_consumption_event_idempotency_key"),
        CheckConstraint(
            "(material_qr IS NULL AND grn_batch_qr_id IS NULL) OR "
            "(material_qr IS NOT NULL AND grn_batch_qr_id IS NOT NULL)",
            name="ck_assembly_consumption_event_qr_pair",
        ),
        UniqueConstraint("idempotency_key", name="uq_assembly_consumption_event_idempotency"),
        Index("ix_assembly_material_consumption_event_order", "assembly_order_id"),
        Index("ix_assembly_material_consumption_event_order_time", "assembly_order_id", "consumed_at"),
        Index("ix_assembly_material_consumption_event_material", "material_code"),
        Index("ix_assembly_material_consumption_event_batch", "grn_batch_id"),
        Index("ix_assembly_material_consumption_event_batch_qr", "grn_batch_qr_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    assembly_order_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("assembly_order.id", ondelete="RESTRICT"), nullable=False
    )
    material_code: Mapped[str] = mapped_column(String(64), nullable=False)
    grn_batch_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("grn_batch.id", ondelete="RESTRICT"), nullable=False
    )
    grn_batch_qr_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID, ForeignKey("grn_batch_qr.id", ondelete="RESTRICT"), nullable=True
    )
    material_qr: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    actual_consumed: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    uom: Mapped[str] = mapped_column(String(32), nullable=False)
    consumed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    recorded_by: Mapped[str] = mapped_column(String(128), nullable=False)


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
    held_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING_INSPECTION")
    inspected_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    inspected_by_user_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    authorized_person_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
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
    section_supplier_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    section_main_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, unique=True)



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
    batch_number: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, unique=True, index=True)
    qr_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    qr_verified_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    warehouse_ref_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID, ForeignKey("warehouse_configuration.id", ondelete="SET NULL"), nullable=True, index=True
    )
    posted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


class FinishedGoodsSectionModel(Base):
    __tablename__ = "finished_goods_section"
    __table_args__ = (
        UniqueConstraint("finished_goods_id", "section_number", name="uq_fg_section_number"),
        CheckConstraint("section_number BETWEEN 1 AND 8", name="ck_fg_section_number"),
        CheckConstraint("status IN ('AVAILABLE', 'LOADED', 'DISPATCHED')", name="ck_fg_section_status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    finished_goods_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("assembly_finished_goods.id", ondelete="RESTRICT"), nullable=False, index=True)
    section_number: Mapped[int] = mapped_column(nullable=False)
    sub_id: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    qr_identity: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="AVAILABLE", nullable=False)
    gate_visit_id: Mapped[Optional[str]] = mapped_column(String(64), ForeignKey("finished_goods_pickup_gate_visit.id", ondelete="RESTRICT"), nullable=True)
    loaded_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    loaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    dispatched_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    dispatched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class AssemblyFinishedGoodsAllocationModel(Base):
    __tablename__ = "assembly_finished_goods_allocation"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    finished_goods_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("assembly_finished_goods.id", ondelete="RESTRICT"), nullable=False, index=True)
    dispatch_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("dispatch_order.id", ondelete="RESTRICT"), nullable=True, index=True)
    finished_goods_request_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("finished_goods_request.id", ondelete="RESTRICT"), nullable=True, index=True)
    dispatch_item_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("dispatch_item.id", ondelete="RESTRICT"), nullable=False, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ALLOCATED", index=True)
    allocated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)


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


class AssemblyLineModel(Base):
    __tablename__ = "assembly_line"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    work_centre_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


class AssemblyRoutingRevisionModel(Base):
    __tablename__ = "assembly_routing_revision"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    routing_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    revision_code: Mapped[str] = mapped_column(String(64), nullable=False)
    revision_number: Mapped[int] = mapped_column(nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    effective_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    effective_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    approved_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)

    operations: Mapped[list["AssemblyRoutingOperationModel"]] = relationship(
        "AssemblyRoutingOperationModel", back_populates="routing_revision", cascade="all, delete-orphan", lazy="selectin"
    )


class AssemblyRoutingOperationModel(Base):
    __tablename__ = "assembly_routing_operation"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    routing_revision_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("assembly_routing_revision.id", ondelete="CASCADE"), nullable=False, index=True
    )
    operation_code: Mapped[str] = mapped_column(String(64), nullable=False)
    sequence: Mapped[int] = mapped_column(nullable=False)
    operation_name: Mapped[str] = mapped_column(String(255), nullable=False)
    work_centre_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, nullable=True)
    expected_duration_minutes: Mapped[Optional[int]] = mapped_column(nullable=True)
    required_skill: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    qc_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    work_instruction: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sop_reference: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    tool_requirement: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    safety_instruction: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    required_materials: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    process_parameters: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    quality_checkpoints: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)

    routing_revision: Mapped["AssemblyRoutingRevisionModel"] = relationship(
        "AssemblyRoutingRevisionModel", back_populates="operations"
    )

