"""Add assembly finished goods inventory postings.

Revision ID: 20260902_assembly_fg
Revises: 20260901_assembly_rework
"""
from alembic import op
import sqlalchemy as sa

revision = "20260902_assembly_fg"
down_revision = "20260901_assembly_rework"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assembly_finished_goods",
        sa.Column("id", sa.UUID(), nullable=False), sa.Column("assembly_order_id", sa.UUID(), nullable=False),
        sa.Column("product_code", sa.String(64), nullable=False), sa.Column("product_name", sa.String(255), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 4), nullable=False), sa.Column("uom", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="AVAILABLE"),
        sa.Column("warehouse_id", sa.String(64), nullable=False), sa.Column("location_code", sa.String(64), nullable=False),
        sa.Column("on_hand_before", sa.Numeric(18, 4), nullable=False), sa.Column("on_hand_after", sa.Numeric(18, 4), nullable=False),
        sa.Column("posted_at", sa.DateTime(), nullable=False), sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["assembly_order_id"], ["assembly_order.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("assembly_order_id"),
    )
    op.create_index("ix_assembly_fg_order", "assembly_finished_goods", ["assembly_order_id"], unique=True)
    op.create_index("ix_assembly_fg_product", "assembly_finished_goods", ["product_code"])


def downgrade() -> None:
    op.drop_index("ix_assembly_fg_product", table_name="assembly_finished_goods")
    op.drop_index("ix_assembly_fg_order", table_name="assembly_finished_goods")
    op.drop_table("assembly_finished_goods")
