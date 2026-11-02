"""
SQLAlchemy ORM models for Warehouse Master, Warehouse Zones, Warehouse Bins, and real Warehouse Operator User accounts.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import List

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from sqlalchemy import CheckConstraint, Integer, func

from app.database.base import Base, GUID


class WarehouseModel(Base):
    __tablename__ = "warehouse_configuration"
    __table_args__ = (
        UniqueConstraint("warehouse_code", name="uq_warehouse_code"),
        UniqueConstraint("singleton_key", name="uq_single_warehouse"),
        CheckConstraint("singleton_key = 1", name="single_warehouse_only"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    warehouse_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    warehouse_name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    warehouse_operator_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    warehouse_operator_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE", index=True)
    warehouse_type: Mapped[str] = mapped_column(String(64), nullable=False, default="RAW_MATERIAL", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    zones: Mapped[List[WarehouseZoneModel]] = relationship(
        "WarehouseZoneModel",
        back_populates="warehouse",
        cascade="all, delete-orphan",
        order_by="WarehouseZoneModel.zone_code.asc()",
    )

    bins: Mapped[List[WarehouseBinModel]] = relationship(
        "WarehouseBinModel",
        back_populates="warehouse",
        cascade="all, delete-orphan",
        order_by="WarehouseBinModel.bin_code.asc()",
    )

    managers: Mapped[List[UserAccountModel]] = relationship(
        "UserAccountModel",
        back_populates="warehouse",
        cascade="all, delete-orphan",
    )


class WarehouseZoneModel(Base):
    __tablename__ = "warehouse_zone"
    __table_args__ = (UniqueConstraint("warehouse_ref_id", "zone_code", name="uq_warehouse_zone_code"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    warehouse_ref_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("warehouse_configuration.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    zone_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    zone_name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    warehouse: Mapped[WarehouseModel] = relationship("WarehouseModel", back_populates="zones")
    bins: Mapped[List[WarehouseBinModel]] = relationship(
        "WarehouseBinModel",
        back_populates="zone",
        cascade="all, delete-orphan",
        order_by="WarehouseBinModel.bin_code.asc()",
    )


class WarehouseBinModel(Base):
    __tablename__ = "warehouse_bin"
    __table_args__ = (
        UniqueConstraint("zone_id", "bin_code", name="uq_warehouse_zone_bin_code"),
        UniqueConstraint("warehouse_ref_id", "bin_code", name="uq_warehouse_bin_code_scoped"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    warehouse_ref_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("warehouse_configuration.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    zone_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("warehouse_zone.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    bin_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    bin_name: Mapped[str] = mapped_column(String(128), nullable=False)
    rack: Mapped[str | None] = mapped_column(String(64), nullable=True)
    shelf: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # shelf is retained for backwards compatibility; level is the canonical WMS term.
    position: Mapped[str | None] = mapped_column(String(64), nullable=True)
    storage_type: Mapped[str] = mapped_column(String(64), nullable=False, default="GENERAL")
    capacity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("1000.0"))
    maximum_weight: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    maximum_volume: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    allowed_material_category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    hazardous_material_permitted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    temperature_requirement: Mapped[str | None] = mapped_column(String(128), nullable=True)
    qr_identifier: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True, index=True)
    occupied_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0.0"))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="AVAILABLE", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    warehouse: Mapped[WarehouseModel] = relationship("WarehouseModel", back_populates="bins")
    zone: Mapped[WarehouseZoneModel] = relationship("WarehouseZoneModel", back_populates="bins")


class UserAccountModel(Base):
    __tablename__ = "user_account"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    warehouse_ref_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID,
        ForeignKey("warehouse_configuration.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    employee_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(128), nullable=False)
    email: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    role: Mapped[str] = mapped_column(String(64), nullable=False, default="Warehouse Operator")
    shift_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    assembly_unit_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    applications: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=lambda: ["WMS"])
    page_permissions: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    auth_token_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    auth_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_login_attempts: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    warehouse: Mapped[WarehouseModel] = relationship("WarehouseModel", back_populates="managers")


class WarehouseRackModel(Base):
    """One shared PCS capacity for every legacy bin belonging to a zone/rack."""
    __tablename__ = "warehouse_rack"
    __table_args__ = (
        UniqueConstraint("zone_id", "rack_code", name="uq_warehouse_rack_zone_code"),
        CheckConstraint("maximum_capacity > 0 AND maximum_capacity = CAST(maximum_capacity AS INTEGER)", name="rack_positive_capacity"),
        CheckConstraint("occupied_quantity >= 0 AND occupied_quantity <= maximum_capacity", name="rack_occupancy_bounds"),
    )
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    zone_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("warehouse_zone.id", ondelete="RESTRICT"), nullable=False)
    rack_code: Mapped[str] = mapped_column(String(64), nullable=False)
    maximum_capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    occupied_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0, server_default="0")


class RackOccupancyEventModel(Base):
    __tablename__ = "rack_occupancy_event"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rack_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("warehouse_rack.id", ondelete="RESTRICT"), nullable=False, index=True)
    balance_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    quantity_delta: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    actor: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
