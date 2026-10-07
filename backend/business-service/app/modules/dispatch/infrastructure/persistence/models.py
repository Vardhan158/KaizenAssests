from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import Column, String, Numeric, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from app.database.base import Base, GUID

class DispatchModel(Base):
    __tablename__ = "dispatch_order"

    id = Column(GUID, primary_key=True)
    dispatch_number = Column(String(64), unique=True, index=True, nullable=False)
    order_number = Column(String(64), index=True, nullable=False)
    customer_name = Column(String(255), nullable=False)
    warehouse_id = Column(String(64), nullable=False, default="WH-01")
    dispatch_type = Column(String(64), nullable=True, default="Standard")
    status = Column(String(32), nullable=False, default="DRAFT")
    driver_id = Column(String(36), nullable=True)
    vehicle_id = Column(String(36), nullable=True)
    route_code = Column(String(64), nullable=True)
    delivery_address = Column(Text, nullable=True)
    destination = Column(Text, nullable=True)
    scheduled_date = Column(DateTime(timezone=True), nullable=True)
    expected_delivery_date = Column(DateTime(timezone=True), nullable=True)
    priority = Column(String(32), nullable=False, default="Normal")
    contact_person = Column(String(128), nullable=True)
    contact_phone = Column(String(32), nullable=True)
    delivery_instructions = Column(Text, nullable=True)
    transport_mode = Column(String(64), nullable=True, default="Road")
    transport_type = Column(String(64), nullable=True, default="Full Truckload")
    transporter = Column(String(128), nullable=True)
    notes = Column(Text, nullable=True)

    # GPS Telemetry fields
    current_location = Column(String(255), nullable=True, default="Bangalore Origin")
    distance_travelled_km = Column(Numeric(10, 2), nullable=False, default=0.0)
    remaining_distance_km = Column(Numeric(10, 2), nullable=False, default=140.0)
    eta_minutes = Column(Numeric(10, 2), nullable=False, default=180.0)
    route_path = Column(String(255), nullable=True, default="Bangalore - Ramanagara - Mandya - Mysore")
    route_deviation = Column(String(128), nullable=True, default="None (On Track)")
    driver_status = Column(String(64), nullable=True, default="Active / Driving")

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    items = relationship("DispatchItemModel", back_populates="dispatch_order", cascade="all, delete-orphan")


class DispatchItemModel(Base):
    __tablename__ = "dispatch_item"

    id = Column(GUID, primary_key=True)
    dispatch_order_id = Column(GUID, ForeignKey("dispatch_order.id", ondelete="CASCADE"), nullable=False)
    material_code = Column(String(64), nullable=False)
    material_name = Column(String(255), nullable=False)
    quantity_ordered = Column(Numeric(18, 4), nullable=False, default=0)
    quantity_available = Column(Numeric(18, 4), nullable=False, default=0)
    quantity_reserved = Column(Numeric(18, 4), nullable=False, default=0)
    quantity_picked = Column(Numeric(18, 4), nullable=False, default=0)
    quantity_packed = Column(Numeric(18, 4), nullable=False, default=0)
    quantity_loaded = Column(Numeric(18, 4), nullable=False, default=0)
    quantity_pending = Column(Numeric(18, 4), nullable=False, default=0)
    uom = Column(String(32), nullable=False, default="PCS")
    batch = Column(String(64), nullable=True)
    bin = Column(String(64), nullable=True)
    status = Column(String(32), nullable=False, default="PENDING")

    dispatch_order = relationship("DispatchModel", back_populates="items")


class DispatchPodModel(Base):
    __tablename__ = "dispatch_pod"

    id = Column(GUID, primary_key=True)
    dispatch_order_id = Column(GUID, ForeignKey("dispatch_order.id", ondelete="CASCADE"), nullable=False, unique=True)
    delivery_datetime = Column(DateTime(timezone=True), nullable=False)
    receiver_name = Column(String(128), nullable=False)
    signature = Column(Text, nullable=False)
    delivery_photo = Column(String(255), nullable=True)
    delivered_quantity = Column(Numeric(18, 4), nullable=False, default=0)
    damaged_quantity = Column(Numeric(18, 4), nullable=False, default=0)
    remarks = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    dispatch_order = relationship("DispatchModel", backref="pod")


class DriverModel(Base):
    __tablename__ = "driver"

    id = Column(GUID, primary_key=True)
    driver_name = Column(String(128), nullable=False)
    license_number = Column(String(64), unique=True, index=True, nullable=False)
    phone = Column(String(32), nullable=False)
    email = Column(String(128), nullable=True)
    license_type = Column(String(32), nullable=False, default="Heavy")
    is_active = Column(Boolean, nullable=False, default=True)
    photo_path = Column(String(255), nullable=True)
    address = Column(Text, nullable=True)
    aadhaar_number = Column(String(32), unique=True, nullable=True)
    status = Column(String(32), nullable=False, default="AVAILABLE")
    rating = Column(Numeric(3, 2), nullable=False, default=5.0)
    assigned_vehicle_id = Column(String(36), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class VehicleModel(Base):
    __tablename__ = "vehicle"

    id = Column(GUID, primary_key=True)
    vehicle_number = Column(String(64), unique=True, index=True, nullable=False)
    vehicle_type = Column(String(64), nullable=False, default="Truck")
    ownership_type = Column(String(64), nullable=False, default="Owned")
    capacity_tons = Column(Numeric(10, 2), nullable=False, default=10.0)
    is_active = Column(Boolean, nullable=False, default=True)
    insurance_valid = Column(Boolean, nullable=False, default=True)
    fitness_valid = Column(Boolean, nullable=False, default=True)
    permit_valid = Column(Boolean, nullable=False, default=True)
    puc_valid = Column(Boolean, nullable=False, default=True)
    gps_available = Column(Boolean, nullable=False, default=True)
    rc_number = Column(String(64), nullable=True)
    chassis_number = Column(String(64), nullable=True)
    registration_date = Column(String(32), nullable=True)
    registration_expiry_date = Column(String(32), nullable=True)
    insurance_expiry = Column(String(32), nullable=True)
    fitness_expiry = Column(String(32), nullable=True)
    permit_expiry = Column(String(32), nullable=True)
    puc_expiry = Column(String(32), nullable=True)
    rc_book_number = Column(String(64), nullable=True)
    status = Column(String(32), nullable=False, default="AVAILABLE")
    current_driver_id = Column(String(36), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
