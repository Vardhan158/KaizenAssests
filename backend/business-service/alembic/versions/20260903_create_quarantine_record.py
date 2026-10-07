"""Create quarantine_record and quarantine_audit tables

Revision ID: 20260903_quarantine_record
Revises: 20260902_putaway_store_zone
Create Date: 2026-09-03 07:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260903_quarantine_record"
down_revision: Union[str, None] = "20260902_putaway_store_zone"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "quarantine_record" not in existing_tables:
        op.create_table(
            "quarantine_record",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("quarantine_number", sa.String(64), unique=True, nullable=False, index=True),
            sa.Column("grn_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("grn.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("grn_number", sa.String(64), nullable=True, index=True),
            sa.Column("grn_line_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("grn_line.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("receiving_line_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("receiving_line.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("dock_assignment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dock_assignment.id", ondelete="SET NULL"), nullable=True),
            sa.Column("material_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("material.id", ondelete="SET NULL"), nullable=True),
            sa.Column("material_variant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("material_variant.id", ondelete="SET NULL"), nullable=True),
            sa.Column("item_code", sa.String(64), nullable=False, index=True),
            sa.Column("material_name", sa.String(256), nullable=False),
            sa.Column("variant_code", sa.String(128), nullable=True),
            sa.Column("damaged_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(32), nullable=False, server_default="PCS"),
            sa.Column("batch_number", sa.String(64), nullable=True),
            sa.Column("material_tag", sa.String(64), nullable=True),
            sa.Column("supplier_name", sa.String(256), nullable=True),
            sa.Column("po_number", sa.String(64), nullable=True),
            sa.Column("asn_number", sa.String(64), nullable=True),
            sa.Column("warehouse_id", sa.String(64), nullable=False, server_default="Main Warehouse"),
            sa.Column("reason", sa.String(256), nullable=False, server_default="Damaged on arrival"),
            sa.Column("receiving_notes", sa.Text(), nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="PENDING_REVIEW", index=True),
            sa.Column("disposition", sa.String(64), nullable=True),
            sa.Column("review_remarks", sa.Text(), nullable=True),
            sa.Column("reviewed_by", sa.String(128), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", sa.String(128), nullable=False, server_default="system"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )

    if "quarantine_audit" not in existing_tables:
        op.create_table(
            "quarantine_audit",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("quarantine_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("quarantine_record.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("previous_status", sa.String(32), nullable=False),
            sa.Column("new_status", sa.String(32), nullable=False),
            sa.Column("disposition", sa.String(64), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("performed_by", sa.String(128), nullable=False),
            sa.Column("performed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "quarantine_audit" in existing_tables:
        op.drop_table("quarantine_audit")
    if "quarantine_record" in existing_tables:
        op.drop_table("quarantine_record")
