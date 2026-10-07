"""Add assembly quality inspection.

Revision ID: 20260831_assembly_quality
Revises: 20260830_assembly_scrap
"""
from alembic import op
import sqlalchemy as sa

revision = "20260831_assembly_quality"
down_revision = "20260830_assembly_scrap"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assembly_quality_inspection",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("assembly_order_id", sa.UUID(), nullable=False),
        sa.Column("produced_quantity", sa.Numeric(18, 4), nullable=False),
        sa.Column("passed_quantity", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("failed_quantity", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("rework_quantity", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING_INSPECTION"),
        sa.Column("inspected_by", sa.String(128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("inspected_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["assembly_order_id"], ["assembly_order.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("assembly_order_id"),
    )
    op.create_index("ix_assembly_quality_order", "assembly_quality_inspection", ["assembly_order_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_assembly_quality_order", table_name="assembly_quality_inspection")
    op.drop_table("assembly_quality_inspection")
