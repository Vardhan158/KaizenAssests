"""Init finished goods dispatch, driver, vehicle, and POD tables.

Revision ID: 20260925_init_dispatch
Revises: 20260923_inbound_exit
Create Date: 2026-09-25 10:00:00.000000

"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260925_init_dispatch"
down_revision = "20260923_inbound_exit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "dispatch_order" not in tables:
        op.create_table(
            "dispatch_order",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("dispatch_number", sa.String(64), nullable=False, unique=True, index=True),
            sa.Column("order_number", sa.String(64), nullable=False, index=True),
            sa.Column("customer_name", sa.String(255), nullable=False),
            sa.Column("warehouse_id", sa.String(64), nullable=False, server_default="WH-01"),
            sa.Column("dispatch_type", sa.String(64), nullable=True, server_default="Standard"),
            sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
            sa.Column("driver_id", sa.String(36), nullable=True),
            sa.Column("vehicle_id", sa.String(36), nullable=True),
            sa.Column("route_code", sa.String(64), nullable=True),
            sa.Column("delivery_address", sa.Text, nullable=True),
            sa.Column("destination", sa.Text, nullable=True),
            sa.Column("scheduled_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expected_delivery_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("priority", sa.String(32), nullable=False, server_default="Normal"),
            sa.Column("contact_person", sa.String(128), nullable=True),
            sa.Column("contact_phone", sa.String(32), nullable=True),
            sa.Column("delivery_instructions", sa.Text, nullable=True),
            sa.Column("transport_mode", sa.String(64), nullable=True, server_default="Road"),
            sa.Column("transport_type", sa.String(64), nullable=True, server_default="Full Truckload"),
            sa.Column("transporter", sa.String(128), nullable=True),
            sa.Column("notes", sa.Text, nullable=True),
            sa.Column("current_location", sa.String(255), nullable=True, server_default="Bangalore Origin"),
            sa.Column("distance_travelled_km", sa.Numeric(10, 2), nullable=False, server_default="0.0"),
            sa.Column("remaining_distance_km", sa.Numeric(10, 2), nullable=False, server_default="140.0"),
            sa.Column("eta_minutes", sa.Numeric(10, 2), nullable=False, server_default="180.0"),
            sa.Column("route_path", sa.String(255), nullable=True, server_default="Bangalore - Ramanagara - Mandya - Mysore"),
            sa.Column("route_deviation", sa.String(128), nullable=True, server_default="None (On Track)"),
            sa.Column("driver_status", sa.String(64), nullable=True, server_default="Active / Driving"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        )

    if "dispatch_item" not in tables:
        op.create_table(
            "dispatch_item",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("dispatch_order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dispatch_order.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("material_code", sa.String(64), nullable=False),
            sa.Column("material_name", sa.String(255), nullable=False),
            sa.Column("quantity_ordered", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("quantity_available", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("quantity_reserved", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("quantity_picked", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("quantity_packed", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("quantity_loaded", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("quantity_pending", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("uom", sa.String(32), nullable=False, server_default="PCS"),
            sa.Column("batch", sa.String(64), nullable=True),
            sa.Column("bin", sa.String(64), nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="PENDING"),
        )

    if "dispatch_pod" not in tables:
        op.create_table(
            "dispatch_pod",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("dispatch_order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dispatch_order.id", ondelete="CASCADE"), nullable=False, unique=True),
            sa.Column("delivery_datetime", sa.DateTime(timezone=True), nullable=False),
            sa.Column("receiver_name", sa.String(128), nullable=False),
            sa.Column("signature", sa.Text, nullable=False),
            sa.Column("delivery_photo", sa.String(255), nullable=True),
            sa.Column("delivered_quantity", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("damaged_quantity", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("remarks", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        )

    if "driver" not in tables:
        op.create_table(
            "driver",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("driver_name", sa.String(128), nullable=False),
            sa.Column("license_number", sa.String(64), nullable=False, unique=True, index=True),
            sa.Column("phone", sa.String(32), nullable=False),
            sa.Column("email", sa.String(128), nullable=True),
            sa.Column("license_type", sa.String(32), nullable=False, server_default="Heavy"),
            sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
            sa.Column("photo_path", sa.String(255), nullable=True),
            sa.Column("address", sa.Text, nullable=True),
            sa.Column("aadhaar_number", sa.String(32), unique=True, nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="AVAILABLE"),
            sa.Column("rating", sa.Numeric(3, 2), nullable=False, server_default="5.0"),
            sa.Column("assigned_vehicle_id", sa.String(36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        )

    if "vehicle" not in tables:
        op.create_table(
            "vehicle",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("vehicle_number", sa.String(64), nullable=False, unique=True, index=True),
            sa.Column("vehicle_type", sa.String(64), nullable=False, server_default="Truck"),
            sa.Column("ownership_type", sa.String(64), nullable=False, server_default="Owned"),
            sa.Column("capacity_tons", sa.Numeric(10, 2), nullable=False, server_default="10.0"),
            sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
            sa.Column("insurance_valid", sa.Boolean, nullable=False, server_default=sa.text("true")),
            sa.Column("fitness_valid", sa.Boolean, nullable=False, server_default=sa.text("true")),
            sa.Column("permit_valid", sa.Boolean, nullable=False, server_default=sa.text("true")),
            sa.Column("puc_valid", sa.Boolean, nullable=False, server_default=sa.text("true")),
            sa.Column("gps_available", sa.Boolean, nullable=False, server_default=sa.text("true")),
            sa.Column("rc_number", sa.String(64), nullable=True),
            sa.Column("chassis_number", sa.String(64), nullable=True),
            sa.Column("registration_date", sa.String(32), nullable=True),
            sa.Column("registration_expiry_date", sa.String(32), nullable=True),
            sa.Column("insurance_expiry", sa.String(32), nullable=True),
            sa.Column("fitness_expiry", sa.String(32), nullable=True),
            sa.Column("permit_expiry", sa.String(32), nullable=True),
            sa.Column("puc_expiry", sa.String(32), nullable=True),
            sa.Column("rc_book_number", sa.String(64), nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="AVAILABLE"),
            sa.Column("current_driver_id", sa.String(36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "dispatch_pod" in tables:
        op.drop_table("dispatch_pod")
    if "dispatch_item" in tables:
        op.drop_table("dispatch_item")
    if "dispatch_order" in tables:
        op.drop_table("dispatch_order")
    if "vehicle" in tables:
        op.drop_table("vehicle")
    if "driver" in tables:
        op.drop_table("driver")
