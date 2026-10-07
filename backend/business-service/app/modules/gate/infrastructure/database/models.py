"""
SQLAlchemy ORM Database Models for PostgreSQL.
Extracted from: C:\\Users\\a\\Downloads\\ams-wms-platform_till gateentry\\...\\app\\modules\\gate_entry & notification
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class AdvanceShippingNoticeModel(Base):
    __tablename__ = "advance_shipping_notice"

    __table_args__ = (
        Index("ix_asn_po_id", "purchase_order_id"),
        Index("ix_asn_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    purchase_order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    asn_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    vendor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    expected_delivery_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    vehicle_number: Mapped[str] = mapped_column(String(30), nullable=False)
    driver_name: Mapped[str] = mapped_column(String(100), nullable=False)
    driver_phone: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    remarks: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    gate_entries: Mapped[List[GateEntryModel]] = relationship("GateEntryModel", back_populates="asn", cascade="all, delete-orphan")
    notification_schedules: Mapped[List[NotificationScheduleModel]] = relationship("NotificationScheduleModel", back_populates="asn", cascade="all, delete-orphan")
    notifications: Mapped[List[NotificationModel]] = relationship("NotificationModel", back_populates="asn", cascade="all, delete-orphan")


class GateEntryModel(Base):
    __tablename__ = "gate_entry"

    __table_args__ = (
        Index("ix_gate_entry_asn_id", "asn_id"),
        Index("ix_gate_entry_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asn_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("advance_shipping_notice.id"), nullable=False)
    gate_entry_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    vehicle_number: Mapped[str] = mapped_column(String(30), nullable=False)
    security_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    entry_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    remarks: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    asn: Mapped[AdvanceShippingNoticeModel] = relationship("AdvanceShippingNoticeModel", back_populates="gate_entries")


class NotificationScheduleModel(Base):
    __tablename__ = "notification_schedule"

    __table_args__ = (
        Index("ix_notification_schedule_asn_id", "asn_id"),
        Index("ix_notification_schedule_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asn_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("advance_shipping_notice.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    notify_before_days: Mapped[int] = mapped_column(Integer, nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    asn: Mapped[AdvanceShippingNoticeModel] = relationship("AdvanceShippingNoticeModel", back_populates="notification_schedules")


class NotificationModel(Base):
    __tablename__ = "notification"

    __table_args__ = (
        Index("ix_notification_asn_id", "asn_id"),
        Index("ix_notification_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asn_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("advance_shipping_notice.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    asn: Mapped[AdvanceShippingNoticeModel] = relationship("AdvanceShippingNoticeModel", back_populates="notifications")


class PurchaseOrderModel(Base):
    __tablename__ = "purchase_orders"

    po_number: Mapped[str] = mapped_column(String(50), primary_key=True)
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False)
    material_description: Mapped[str] = mapped_column(Text, nullable=False)
    total_quantity: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    po_date: Mapped[str] = mapped_column(Date, nullable=False)
    delivery_date: Mapped[str] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="OPEN")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
