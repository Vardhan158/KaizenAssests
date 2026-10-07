"""Add persistent handling units for receiving labels and putaway scans.

Revision ID: 20260820_handling_units
Revises: 20260819_gate_reconcile
"""

from alembic import op
import sqlalchemy as sa


revision = "20260820_handling_units"
down_revision = "20260819_gate_reconcile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "handling_unit",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("hu_number", sa.String(64), nullable=False),
        sa.Column("barcode_value", sa.String(128), nullable=False),
        sa.Column("receiving_line_id", sa.UUID(), nullable=False),
        sa.Column("grn_line_id", sa.UUID(), nullable=True),
        sa.Column("item_code", sa.String(64), nullable=False),
        sa.Column("material_name", sa.String(256), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
        sa.Column("uom", sa.String(32), nullable=False),
        sa.Column("batch_number", sa.String(128), nullable=True),
        sa.Column("supplier_name", sa.String(255), nullable=False),
        sa.Column("po_number", sa.String(64), nullable=False),
        sa.Column("asn_number", sa.String(64), nullable=False),
        sa.Column("grn_number", sa.String(64), nullable=True),
        sa.Column("warehouse_id", sa.String(64), nullable=False),
        sa.Column("current_location", sa.String(128), nullable=False, server_default="RECEIVING_AREA"),
        sa.Column("status", sa.String(32), nullable=False, server_default="LABEL_GENERATED"),
        sa.Column("generated_by", sa.String(128), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["receiving_line_id"], ["receiving_line.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["grn_line_id"], ["grn_line.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hu_number"), sa.UniqueConstraint("barcode_value"),
        sa.UniqueConstraint("receiving_line_id"), sa.UniqueConstraint("grn_line_id"),
    )
    for column in ("hu_number", "barcode_value", "receiving_line_id", "grn_line_id", "item_code", "status"):
        op.create_index(f"ix_handling_unit_{column}", "handling_unit", [column], unique=column in {"hu_number", "barcode_value", "receiving_line_id", "grn_line_id"})
    op.add_column("putaway_task", sa.Column("handling_unit_id", sa.UUID(), nullable=True))
    op.create_foreign_key("fk_putaway_task_handling_unit", "putaway_task", "handling_unit", ["handling_unit_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_putaway_task_handling_unit_id", "putaway_task", ["handling_unit_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_putaway_task_handling_unit_id", table_name="putaway_task")
    op.drop_constraint("fk_putaway_task_handling_unit", "putaway_task", type_="foreignkey")
    op.drop_column("putaway_task", "handling_unit_id")
    for column in ("status", "item_code", "grn_line_id", "receiving_line_id", "barcode_value", "hu_number"):
        op.drop_index(f"ix_handling_unit_{column}", table_name="handling_unit")
    op.drop_table("handling_unit")
