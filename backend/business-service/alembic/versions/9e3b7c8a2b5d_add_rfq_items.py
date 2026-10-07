"""add_rfq_items

Revision ID: 9e3b7c8a2b5d
Revises: 6dd90401f80c
Create Date: 2026-08-13 10:15:00.000000
"""
from typing import Sequence, Union

from alembic import op
from app.database.base import GUID
import sqlalchemy as sa


revision: str = '9e3b7c8a2b5d'
down_revision: Union[str, None] = '6dd90401f80c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'rfq_item',
        sa.Column('id', GUID(length=36), nullable=False),
        sa.Column('rfq_id', GUID(length=36), nullable=False),
        sa.Column('material_code', sa.String(length=64), nullable=False),
        sa.Column('material_name', sa.String(length=256), nullable=False),
        sa.Column('category', sa.String(length=128), nullable=False),
        sa.Column('quantity', sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column('uom', sa.String(length=64), nullable=False),
        sa.Column('required_delivery_date', sa.Date(), nullable=False),
        sa.Column('warehouse', sa.String(length=128), nullable=False),
        sa.Column('special_requirements', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['rfq_id'], ['rfq.id'], name=op.f('fk_rfq_item_rfq_id_rfq'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_rfq_item'))
    )


def downgrade() -> None:
    op.drop_table('rfq_item')
