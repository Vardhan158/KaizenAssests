"""add purchase-order detail fields

Revision ID: f1a2b3c4d5e6
Revises: e1f2a3b4c5d6
Create Date: 2026-08-13 16:50:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("purchase_order", sa.Column("department", sa.String(length=128), nullable=True))
    op.add_column("purchase_order", sa.Column("procurement_officer", sa.String(length=128), nullable=True))
    op.add_column("purchase_order", sa.Column("delivery_warehouse", sa.String(length=128), nullable=True))
    op.add_column("purchase_order", sa.Column("delivery_address", sa.Text(), nullable=True))
    op.add_column(
        "purchase_order",
        sa.Column("additional_charges", sa.Numeric(18, 2), nullable=False, server_default="0.0"),
    )


def downgrade() -> None:
    op.drop_column("purchase_order", "additional_charges")
    op.drop_column("purchase_order", "delivery_address")
    op.drop_column("purchase_order", "delivery_warehouse")
    op.drop_column("purchase_order", "procurement_officer")
    op.drop_column("purchase_order", "department")
