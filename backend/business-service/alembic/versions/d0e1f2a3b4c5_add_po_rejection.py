"""add_po_rejection

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-08-13 11:20:00.000000
"""
from typing import Sequence, Union

from alembic import op
from app.database.base import GUID
import sqlalchemy as sa


revision: str = 'd0e1f2a3b4c5'
down_revision: Union[str, None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('purchase_order', sa.Column('rejection_reason', sa.String(length=500), nullable=True))
    op.add_column('purchase_order', sa.Column('finance_comments', sa.String(length=500), nullable=True))

    op.create_table(
        'purchase_order_approval_log',
        sa.Column('id', GUID(length=36), nullable=False),
        sa.Column('purchase_order_id', GUID(length=36), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('actor', sa.String(length=128), nullable=False),
        sa.Column('action_date', sa.DateTime(), nullable=False),
        sa.Column('reason', sa.String(length=500), nullable=True),
        sa.Column('comments', sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(['purchase_order_id'], ['purchase_order.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('purchase_order_approval_log')
    op.drop_column('purchase_order', 'finance_comments')
    op.drop_column('purchase_order', 'rejection_reason')
