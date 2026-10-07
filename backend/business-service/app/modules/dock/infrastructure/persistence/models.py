from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, GUID
from app.modules.store.infrastructure.persistence.models import StoreModel


class DockMasterModel(Base):
    __tablename__ = "dock_masters"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    dock_code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    dock_name: Mapped[str] = mapped_column(String(128), nullable=False)
    dock_type: Mapped[str] = mapped_column(String(32), nullable=False, default="RAW_MATERIAL", index=True)
    location: Mapped[str | None] = mapped_column(String(128), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="AVAILABLE", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    store_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)


class DockAllocationRequestModel(Base):
    __tablename__ = "dock_allocation_requests"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    existing_gate_pass_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    vendor_reference: Mapped[str | None] = mapped_column(String(256), nullable=True)
    vehicle_number: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    material_reference: Mapped[str | None] = mapped_column(String(256), nullable=True)
    material_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    security_approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    priority: Mapped[str] = mapped_column(String(32), nullable=False, default="NORMAL")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING_ALLOCATION", index=True)
    assigned_dock_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("dock_masters.id", ondelete="SET NULL"), nullable=True)
    assigned_store_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("store.id", ondelete="SET NULL"), nullable=True, index=True)
    assigned_store_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    assigned_store_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    assigned_store_manager_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    assigned_store_manager_username: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    assigned_store_manager_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    assigned_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    assigned_dock: Mapped[DockMasterModel | None] = relationship("DockMasterModel", foreign_keys=[assigned_dock_id])


class DockAllocationHistoryModel(Base):
    __tablename__ = "dock_allocation_history"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    allocation_request_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("dock_allocation_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    dock_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("dock_masters.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    previous_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    new_status: Mapped[str] = mapped_column(String(32), nullable=False)
    performed_by: Mapped[str] = mapped_column(String(128), nullable=False)
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)


class DockStatusHistoryModel(Base):
    __tablename__ = "dock_status_history"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    dock_id: Mapped[uuid.UUID | None] = mapped_column(GUID, ForeignKey("dock_masters.id", ondelete="SET NULL"), nullable=True)
    previous_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    new_status: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_by: Mapped[str] = mapped_column(String(128), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
