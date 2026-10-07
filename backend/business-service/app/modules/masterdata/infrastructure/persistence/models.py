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
