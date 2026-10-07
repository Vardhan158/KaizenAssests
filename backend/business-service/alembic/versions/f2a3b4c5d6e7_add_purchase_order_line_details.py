"""add purchase-order line detail fields

Revision ID: f2a3b4c5d6e7
Revises: f1a2b3c4d5e6
Create Date: 2026-08-13 16:55:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("purchase_order_line", sa.Column("material_name", sa.String(length=256), nullable=True))
    op.add_column("purchase_order_line", sa.Column("category", sa.String(length=128), nullable=True))
    op.add_column("purchase_order_line", sa.Column("uom", sa.String(length=64), nullable=True))
    op.add_column(
        "purchase_order_line",
        sa.Column("discount", sa.Numeric(18, 4), nullable=False, server_default="0.0"),
    )
    op.add_column(
        "purchase_order_line",
        sa.Column("tax", sa.Numeric(18, 4), nullable=False, server_default="0.0"),
    )


def downgrade() -> None:
    op.drop_column("purchase_order_line", "tax")
    op.drop_column("purchase_order_line", "discount")
    op.drop_column("purchase_order_line", "uom")
    op.drop_column("purchase_order_line", "category")
    op.drop_column("purchase_order_line", "material_name")
