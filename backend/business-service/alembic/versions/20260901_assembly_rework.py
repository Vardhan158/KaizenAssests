"""Add assembly rework orders.

Revision ID: 20260901_assembly_rework
Revises: 20260831_assembly_quality
"""
from alembic import op
import sqlalchemy as sa

revision = "20260901_assembly_rework"
down_revision = "20260831_assembly_quality"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assembly_rework_order",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("assembly_order_id", sa.UUID(), nullable=False),
        sa.Column("rework_number", sa.String(80), nullable=False),
        sa.Column("reason_for_failure", sa.Text(), nullable=False),
        sa.Column("failed_quantity", sa.Numeric(18, 4), nullable=False),
        sa.Column("assigned_team", sa.String(128), nullable=False),
        sa.Column("assigned_worker", sa.String(128), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING"),
        sa.Column("final_result", sa.String(32), nullable=False, server_default="PENDING_INSPECTION"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["assembly_order_id"], ["assembly_order.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("rework_number"),
    )
    op.create_index("ix_assembly_rework_order", "assembly_rework_order", ["assembly_order_id"])
    op.create_index("ix_assembly_rework_number", "assembly_rework_order", ["rework_number"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_assembly_rework_number", table_name="assembly_rework_order")
    op.drop_index("ix_assembly_rework_order", table_name="assembly_rework_order")
    op.drop_table("assembly_rework_order")
