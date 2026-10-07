"""Add assembly scrap and wastage records.

Revision ID: 20260830_assembly_scrap
Revises: 20260829_material_consumption
"""

from alembic import op
import sqlalchemy as sa


revision = "20260830_assembly_scrap"
down_revision = "20260829_material_consumption"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assembly_scrap",
        sa.Column("id", sa.Uuid(), nullable=False), sa.Column("assembly_order_id", sa.Uuid(), nullable=False),
        sa.Column("material_code", sa.String(length=64), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 4), nullable=False), sa.Column("uom", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False), sa.Column("employee_team", sa.String(length=128), nullable=False),
        sa.Column("approval_required", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="PENDING_APPROVAL"),
        sa.Column("recorded_at", sa.DateTime(), nullable=False), sa.Column("approved_by", sa.String(length=128), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["assembly_order_id"], ["assembly_order.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_assembly_scrap_order", "assembly_scrap", ["assembly_order_id"])
    op.create_index("ix_assembly_scrap_material", "assembly_scrap", ["material_code"])


def downgrade() -> None:
    op.drop_index("ix_assembly_scrap_material", table_name="assembly_scrap")
    op.drop_index("ix_assembly_scrap_order", table_name="assembly_scrap")
    op.drop_table("assembly_scrap")
