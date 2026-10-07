"""init receiving tables (purchase_order, purchase_order_line, grn, grn_line) + seed PO

Revision ID: 0001
Revises:
Create Date: 2026-08-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "purchase_order",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("po_number", sa.String(64), nullable=False, unique=True),
    )
    op.create_table(
        "purchase_order_line",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("purchase_order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("purchase_order.id"), nullable=False),
        sa.Column("item_code", sa.String(64), nullable=False),
        sa.Column("ordered_quantity", sa.Numeric(18, 4), nullable=False),
    )
    op.create_table(
        "grn",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("po_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
    )
    op.create_table(
        "grn_line",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("grn_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("grn.id"), nullable=False),
        sa.Column("item_code", sa.String(64), nullable=False),
        sa.Column("received_quantity", sa.Numeric(18, 4), nullable=False),
        sa.Column("ordered_quantity", sa.Numeric(18, 4), nullable=True),
    )





    op.execute(
        """
        INSERT INTO purchase_order (id, po_number)
        VALUES ('11111111-1111-1111-1111-111111111111', 'PO-1001')
        """
    )
    op.execute(
        """
        INSERT INTO purchase_order_line (id, purchase_order_id, item_code, ordered_quantity)
        VALUES ('22222222-2222-2222-2222-222222222222',
                '11111111-1111-1111-1111-111111111111', 'ITEM-A', 100)
        """
    )


def downgrade() -> None:
    op.drop_table("grn_line")
    op.drop_table("grn")
    op.drop_table("purchase_order_line")
    op.drop_table("purchase_order")
