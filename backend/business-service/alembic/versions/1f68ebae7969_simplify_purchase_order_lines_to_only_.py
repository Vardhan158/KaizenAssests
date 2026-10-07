"""simplify purchase order lines to only quantity

Revision ID: 1f68ebae7969
Revises: e97285d0f31b
Create Date: 2026-08-14 12:20:43.990647
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '1f68ebae7969'
down_revision: Union[str, None] = 'e97285d0f31b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove extra columns from purchase_order_line
    op.drop_column('purchase_order_line', 'unit_price')
    op.drop_column('purchase_order_line', 'material_name')
    op.drop_column('purchase_order_line', 'category')
    op.drop_column('purchase_order_line', 'uom')
    op.drop_column('purchase_order_line', 'discount')
    op.drop_column('purchase_order_line', 'tax')


def downgrade() -> None:
    # Add back columns with defaults where necessary
    op.add_column('purchase_order_line', sa.Column('tax', sa.NUMERIC(precision=18, scale=4), server_default=sa.text('0.0'), autoincrement=False, nullable=False))
    op.add_column('purchase_order_line', sa.Column('discount', sa.NUMERIC(precision=18, scale=4), server_default=sa.text('0.0'), autoincrement=False, nullable=False))
    op.add_column('purchase_order_line', sa.Column('uom', sa.VARCHAR(length=64), autoincrement=False, nullable=True))
    op.add_column('purchase_order_line', sa.Column('category', sa.VARCHAR(length=128), autoincrement=False, nullable=True))
    op.add_column('purchase_order_line', sa.Column('material_name', sa.VARCHAR(length=256), autoincrement=False, nullable=True))
    op.add_column('purchase_order_line', sa.Column('unit_price', sa.NUMERIC(precision=18, scale=4), autoincrement=False, nullable=False, server_default='0'))
