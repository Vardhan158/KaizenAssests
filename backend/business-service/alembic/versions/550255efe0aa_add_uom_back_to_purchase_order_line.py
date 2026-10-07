"""add uom back to purchase order line

Revision ID: 550255efe0aa
Revises: 1f68ebae7969
Create Date: 2026-08-14 12:43:23.418260
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '550255efe0aa'
down_revision: Union[str, None] = '1f68ebae7969'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('purchase_order_line', sa.Column('uom', sa.String(length=32), nullable=True, server_default='PCS'))


def downgrade() -> None:
    op.drop_column('purchase_order_line', 'uom')
