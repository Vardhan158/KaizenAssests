"""
Supplier SQLAlchemy ORM Model.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, Float, Integer, String
from app.database.base import Base


class SupplierModel(Base):
    __tablename__ = "suppliers"

    id = Column(String(64), primary_key=True, index=True)
    supplier_code = Column(String(64), unique=True, nullable=False, index=True)
    supplier_name = Column(String(255), nullable=False, index=True)
    category = Column(String(100), nullable=False, default="General")
    contact_person = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    address = Column(String(500), nullable=True)
    gst_number = Column(String(100), nullable=True)
    payment_terms = Column(String(100), nullable=True, default="NET30")
    bank_details = Column(String(500), nullable=True)
    status = Column(String(50), nullable=False, default="ACTIVE")
    on_time_delivery_rate = Column(Float, nullable=False, default=100.0)
    quality_score = Column(Float, nullable=False, default=5.0)
    total_orders_fulfilled = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

class ProductModel(Base):
    __tablename__ = "products"

    id = Column(String(64), primary_key=True, index=True)
    product_code = Column(String(64), unique=True, nullable=False, index=True)
    product_name = Column(String(255), nullable=False, index=True)
    product_type = Column(String(100), nullable=False, default="Finished Good")
    category = Column(String(100), nullable=True)
    uom = Column(String(50), nullable=False, default="PCS")
    tracking = Column(String(100), nullable=True, default="Serial Number")
    status = Column(String(50), nullable=False, default="ACTIVE")
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

class BOMModel(Base):
    __tablename__ = "boms"

    id = Column(String(64), primary_key=True, index=True)
    bom_code = Column(String(64), unique=True, nullable=False, index=True)
    product_code = Column(String(64), nullable=False, index=True) # References ProductModel.product_code
    revision = Column(String(50), nullable=False, default="REV-01")
    status = Column(String(50), nullable=False, default="ACTIVE")
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

class BOMItemModel(Base):
    __tablename__ = "bom_items"

    id = Column(String(64), primary_key=True, index=True)
    bom_code = Column(String(64), nullable=False, index=True) # References BOMModel.bom_code
    material_code = Column(String(64), nullable=False) # e.g. RM-HSG-001
    material_name = Column(String(255), nullable=True)
    quantity = Column(Float, nullable=False)
    uom = Column(String(50), nullable=False, default="PCS")
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

class RoutingModel(Base):
    __tablename__ = "routings"

    id = Column(String(64), primary_key=True, index=True)
    routing_code = Column(String(64), unique=True, nullable=False, index=True)
    product_code = Column(String(64), nullable=False, index=True)
    revision = Column(String(50), nullable=False, default="REV-01")
    status = Column(String(50), nullable=False, default="ACTIVE")
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

class RoutingOperationModel(Base):
    __tablename__ = "routing_operations"

    id = Column(String(64), primary_key=True, index=True)
    routing_code = Column(String(64), nullable=False, index=True) # References RoutingModel.routing_code
    sequence = Column(Integer, nullable=False) # e.g., 10, 20, 30
    operation_code = Column(String(64), nullable=False) # e.g., OP-030
    operation_name = Column(String(255), nullable=False) # e.g., Wiring Harness Installation
    work_centre = Column(String(100), nullable=True)
    expected_time_minutes = Column(Integer, nullable=True)
    required_skill = Column(String(100), nullable=True)
    qc_required = Column(String(10), nullable=False, default="NO")
    material_consumption = Column(String(500), nullable=True) # Could be a JSON structure mapping material required
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
