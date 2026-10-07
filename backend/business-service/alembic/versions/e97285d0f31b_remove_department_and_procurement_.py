"""remove department and procurement_officer add priority and remarks to purchase_order

Revision ID: e97285d0f31b
Revises: f04c6ce3af9b
Create Date: 2026-08-14 11:58:51.499015
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e97285d0f31b'
down_revision: Union[str, None] = 'f04c6ce3af9b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove columns
    op.drop_column('purchase_order', 'department')
    op.drop_column('purchase_order', 'procurement_officer')
    # Add new columns
    op.add_column('purchase_order', sa.Column('priority', sa.String(length=32), nullable=True, server_default='Normal'))
    op.add_column('purchase_order', sa.Column('remarks', sa.Text(), nullable=True))


def downgrade() -> None:
    # Remove added columns
    op.drop_column('purchase_order', 'remarks')
    op.drop_column('purchase_order', 'priority')
    # Add back removed columns
    op.add_column('purchase_order', sa.Column('department', sa.String(length=128), nullable=True))
    op.add_column('purchase_order', sa.Column('procurement_officer', sa.String(length=128), nullable=True))
