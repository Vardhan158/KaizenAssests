"""
SQLAlchemy ORM models for Store Master, Store Zones, Store Bins, and real Store Manager User accounts.
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


class StoreModel(Base):
    __tablename__ = "store"
    __table_args__ = (UniqueConstraint("store_code", name="uq_store_code"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    store_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    store_name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    store_manager_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    store_manager_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE", index=True)
    store_type: Mapped[str] = mapped_column(String(64), nullable=False, default="RAW_MATERIAL", index=True)
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

    zones: Mapped[List[StoreZoneModel]] = relationship(
        "StoreZoneModel",
        back_populates="store",
        cascade="all, delete-orphan",
        order_by="StoreZoneModel.zone_code.asc()",
    )

    bins: Mapped[List[StoreBinModel]] = relationship(
        "StoreBinModel",
        back_populates="store",
        cascade="all, delete-orphan",
        order_by="StoreBinModel.bin_code.asc()",
    )



class StoreZoneModel(Base):
    __tablename__ = "store_zone"
    __table_args__ = (UniqueConstraint("store_id", "zone_code", name="uq_store_zone_code"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    store_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("store.id", ondelete="RESTRICT"),
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

    store: Mapped[StoreModel] = relationship("StoreModel", back_populates="zones")
    bins: Mapped[List[StoreBinModel]] = relationship(
        "StoreBinModel",
        back_populates="zone",
        cascade="all, delete-orphan",
        order_by="StoreBinModel.bin_code.asc()",
    )


class StoreBinModel(Base):
    __tablename__ = "store_bin"
    __table_args__ = (
        UniqueConstraint("zone_id", "bin_code", name="uq_store_zone_bin_code"),
        UniqueConstraint("store_id", "bin_code", name="uq_store_bin_code_scoped"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    store_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("store.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    zone_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("store_zone.id", ondelete="RESTRICT"),
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

    store: Mapped[StoreModel] = relationship("StoreModel", back_populates="bins")
    zone: Mapped[StoreZoneModel] = relationship("StoreZoneModel", back_populates="bins")


class StoreManagerUserModel(Base):
    __tablename__ = "store_manager_user"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(128), nullable=False)
    email: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    role: Mapped[str] = mapped_column(String(64), nullable=False, default="Store Manager")
    shift_name: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    assembly_unit_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    applications: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=lambda: ["WMS"])
    page_permissions: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)
    auth_token_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
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

    # Compatibility only while legacy integrations are migrated. Accounts are
    # warehouse-wide and are never scoped to a Store.
    @property
    def store_id(self):
        return None

    @property
    def store(self):
        return None


class StoreRackModel(Base):
    """One shared PCS capacity for every legacy bin belonging to a zone/rack."""
    __tablename__ = "store_rack"
    __table_args__ = (
        UniqueConstraint("zone_id", "rack_code", name="uq_store_rack_zone_code"),
        CheckConstraint("maximum_capacity > 0 AND maximum_capacity = CAST(maximum_capacity AS INTEGER)", name="rack_positive_capacity"),
        CheckConstraint("occupied_quantity >= 0 AND occupied_quantity <= maximum_capacity", name="rack_occupancy_bounds"),
    )
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    zone_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("store_zone.id", ondelete="RESTRICT"), nullable=False)
    rack_code: Mapped[str] = mapped_column(String(64), nullable=False)
    maximum_capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    occupied_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0, server_default="0")


class RackOccupancyEventModel(Base):
    __tablename__ = "rack_occupancy_event"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rack_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("store_rack.id", ondelete="RESTRICT"), nullable=False, index=True)
    balance_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    quantity_delta: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    actor: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
