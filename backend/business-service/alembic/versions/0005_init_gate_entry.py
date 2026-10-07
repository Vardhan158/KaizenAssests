"""init gate_entry and gate_entry_audit_log tables

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add reference columns to existing purchase_order table if not present
    op.add_column("purchase_order", sa.Column("supplier_name", sa.String(128), nullable=True))
    op.add_column("purchase_order", sa.Column("po_date", sa.Date(), nullable=True))
    op.add_column("purchase_order", sa.Column("expected_delivery_date", sa.Date(), nullable=True))

    op.create_table(
        "gate_entry",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("po_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("po_number", sa.String(64), nullable=False),
        sa.Column("vehicle_number", sa.String(32), nullable=False),
        sa.Column("driver_name", sa.String(128), nullable=False),
        sa.Column("driver_license_number", sa.String(64), nullable=True),
        sa.Column("driver_phone", sa.String(32), nullable=True),
        sa.Column("driver_photo_path", sa.String(256), nullable=False),
        sa.Column("po_document_path", sa.String(256), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("verification_type", sa.String(32), nullable=True),
        sa.Column("mismatched_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("reasons", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("anpr_detected_vehicle", sa.String(32), nullable=True),
        sa.Column("anpr_confidence", sa.Numeric(5, 4), nullable=True),
        sa.Column("anpr_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("ocr_po_number", sa.String(64), nullable=True),
        sa.Column("ocr_supplier_name", sa.String(128), nullable=True),
        sa.Column("ocr_product_material", sa.String(128), nullable=True),
        sa.Column("ocr_quantity", sa.Numeric(18, 4), nullable=True),
        sa.Column("ocr_po_date", sa.String(32), nullable=True),
        sa.Column("ocr_expected_delivery_date", sa.String(32), nullable=True),
        sa.Column("ocr_confidence", sa.Numeric(5, 4), nullable=True),
        sa.Column("ocr_raw_text", sa.Text(), nullable=True),
        sa.Column("security_officer_id", sa.String(64), nullable=False),
        sa.Column("verified_by_user_id", sa.String(64), nullable=True),
        sa.Column("manual_verification_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_index("idx_gate_entry_po_number", "gate_entry", ["po_number"])
    op.create_index("idx_gate_entry_vehicle_number", "gate_entry", ["vehicle_number"])
    op.create_index("idx_gate_entry_status", "gate_entry", ["status"])

    op.create_table(
        "gate_entry_audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("gate_entry_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("gate_entry.id"), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("performed_by", sa.String(64), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("gate_entry_audit_log")
    op.drop_index("idx_gate_entry_status", table_name="gate_entry")
    op.drop_index("idx_gate_entry_vehicle_number", table_name="gate_entry")
    op.drop_index("idx_gate_entry_po_number", table_name="gate_entry")
    op.drop_table("gate_entry")
    op.drop_column("purchase_order", "expected_delivery_date")
    op.drop_column("purchase_order", "po_date")
    op.drop_column("purchase_order", "supplier_name")
