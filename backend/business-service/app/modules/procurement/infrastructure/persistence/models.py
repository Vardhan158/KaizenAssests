from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum as SQLEnum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database.base import Base


class SupplierModel(Base):
    __tablename__ = "supplier"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), unique=True, nullable=False, index=True)
    supplier_code = Column(String(64), unique=True, nullable=True, index=True)
    name = Column(String(255), nullable=False)
    contact_name = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(64), nullable=True)
    address = Column(Text, nullable=True)
    status = Column(String(32), default="ACTIVE", nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class SupplierUserModel(Base):
    __tablename__ = "supplier_user"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    supplier_id = Column(UUID(as_uuid=True), ForeignKey("supplier.id"), nullable=False)
    username = Column(String(128), unique=True, nullable=False)
    email = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    password_hash = Column(String(256), nullable=False)
    status = Column(String(32), default="ACTIVE", nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class SupplierContactModel(Base):
    __tablename__ = "supplier_contact"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    supplier_id = Column(UUID(as_uuid=True), ForeignKey("supplier.id"), nullable=False)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PurchaseOrderModel(Base):
    __tablename__ = "purchase_order"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    po_number = Column(String(64), unique=True, nullable=False, index=True)
    supplier_id = Column(UUID(as_uuid=True), ForeignKey("supplier.id"), nullable=True)
    order_date = Column(Date, nullable=True)
    status = Column(String(32), default="OPEN", nullable=False)
    total_amount = Column(Numeric(18, 4), default=Decimal("0"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class PoLineItemModel(Base):
    __tablename__ = "po_line_item"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    po_id = Column(UUID(as_uuid=True), ForeignKey("purchase_order.id"), nullable=False)
    material_code = Column(String(64), nullable=False)
    quantity = Column(Numeric(18, 4), nullable=False)
    unit_price = Column(Numeric(18, 4), default=Decimal("0"))


class AsnModel(Base):
    __tablename__ = "asn"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asn_number = Column(String(64), unique=True, nullable=False, index=True)
    po_id = Column(String(64), nullable=True)
    supplier_id = Column(UUID(as_uuid=True), ForeignKey("supplier.id"), nullable=True)
    shipment_date = Column(Date, nullable=True)
    driver_name = Column(String(128), nullable=True)
    driver_contact = Column(String(32), nullable=True)
    transporter = Column(String(128), nullable=True)
    warehouse_id = Column(String(64), nullable=True)
    status = Column(String(32), default="EXPECTED", nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class AsnLineItemModel(Base):
    __tablename__ = "asn_line_item"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asn_id = Column(UUID(as_uuid=True), ForeignKey("asn.id"), nullable=False)
    material_code = Column(String(64), nullable=False)
    quantity = Column(Numeric(18, 4), nullable=False)


class MaterialModel(Base):
    __tablename__ = "material"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), unique=True, nullable=False, index=True)
    material_code = Column(String(64), unique=True, nullable=True, index=True)
    name = Column(String(256), nullable=False)
    material_name = Column(String(256), nullable=True)
    description = Column(Text, nullable=True)
    category = Column(String(64), nullable=True)
    base_uom = Column(String(32), default="PCS", nullable=False)
    uom = Column(String(32), default="PCS", nullable=False)
    status = Column(String(32), default="Active", nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class MaterialVariantModel(Base):
    __tablename__ = "material_variant"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    material_id = Column(UUID(as_uuid=True), ForeignKey("material.id"), nullable=False)
    variant_code = Column(String(64), unique=True, nullable=False)
    variant_name = Column(String(256), nullable=False)


class MaterialStockModel(Base):
    __tablename__ = "material_stock"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    material_code = Column(String(64), nullable=False, index=True)
    material_name = Column(String(256), nullable=True)
    category = Column(String(128), nullable=True)
    uom = Column(String(32), default="PCS")
    warehouse_id = Column(String(64), nullable=False, default="MAIN", index=True)
    on_hand = Column(Numeric(18, 4), default=Decimal("0"))
    allocated = Column(Numeric(18, 4), default=Decimal("0"))
    available = Column(Numeric(18, 4), default=Decimal("0"))
    on_hand_quantity = Column(Numeric(18, 4), default=Decimal("0"))
    available_quantity = Column(Numeric(18, 4), default=Decimal("0"))
    reserved_quantity = Column(Numeric(18, 4), default=Decimal("0"))
    quarantine_quantity = Column(Numeric(18, 4), default=Decimal("0"))
    reorder_point = Column(Numeric(18, 4), default=Decimal("10"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class MaterialRequestItemModel(Base):
    __tablename__ = "material_request_item"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id = Column(UUID(as_uuid=True), ForeignKey("material_request.id"), nullable=False, index=True)
    material_code = Column(String(64), nullable=False)
    material_name = Column(String(256), nullable=True)
    quantity = Column(Numeric(18, 4), nullable=False)
    uom = Column(String(32), nullable=False)


class MaterialRequestModel(Base):
    __tablename__ = "material_request"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_number = Column(String(64), unique=True, nullable=False, index=True)
    department = Column(String(128), nullable=True)
    requested_by = Column(String(128), nullable=True)
    material_code = Column(String(64), nullable=False)
    material_name = Column(String(256), nullable=True)
    quantity = Column(Numeric(18, 4), nullable=False)
    uom = Column(String(32), default="PCS")
    status = Column(String(32), default="PENDING", nullable=False)
    assembly_order_number = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    items = relationship("MaterialRequestItemModel", cascade="all, delete-orphan")


class PickTaskModel(Base):
    __tablename__ = "pick_task"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_number = Column(String(64), unique=True, nullable=False, index=True)
    request_id = Column(UUID(as_uuid=True), ForeignKey("material_request.id"), nullable=False, index=True)
    request_number = Column(String(64), nullable=False, index=True)
    warehouse_id = Column(String(64), nullable=False)
    department = Column(String(64), nullable=False)
    items = Column(JSONB, nullable=False)
    status = Column(String(32), nullable=False)
    destination = Column(String(128), nullable=False, default="Production Staging Area")
    created_by = Column(String(128), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)


class MaterialIssueModel(Base):
    """Persisted issue handoff created when a warehouse pick is issued."""

    __tablename__ = "material_issue"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    issue_number = Column(String(64), unique=True, nullable=False, index=True)
    pick_task_id = Column(UUID(as_uuid=True), nullable=False, unique=True)
    request_id = Column(UUID(as_uuid=True), ForeignKey("material_request.id"), nullable=False)
    department = Column(String(64), nullable=False)
    items = Column(JSONB, nullable=False)
    issued_by = Column(String(128), nullable=False)
    received_by = Column(String(128), nullable=False)
    issued_at = Column(DateTime(timezone=True), nullable=False)


class MaterialIssueItemModel(Base):
    __tablename__ = "material_issue_item"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    issue_id = Column(UUID(as_uuid=True), ForeignKey("material_issue.id"), nullable=False)
    material_code = Column(String(64), nullable=False)
    quantity = Column(Numeric(18, 4), nullable=False)


class FinishedGoodsRequestModel(Base):
    __tablename__ = "finished_goods_request"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_number = Column(String(64), unique=True, nullable=False, index=True)
    product_name = Column(String(256), nullable=False)
    quantity = Column(Numeric(18, 4), nullable=False)
    status = Column(String(32), default="PENDING", nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class NotificationModel(Base):
    __tablename__ = "notification"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_role = Column(String(64), nullable=False, index=True)
    title = Column(String(256), nullable=False)
    message = Column(Text, nullable=False)
    link = Column(String(256), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class AuditLogModel(Base):
    __tablename__ = "audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    action = Column(String(128), nullable=False)
    details = Column(Text, nullable=True)
    user = Column(String(128), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
