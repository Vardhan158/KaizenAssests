"""add_rfq_selection

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-08-13 10:55:00.000000
"""
from typing import Sequence, Union

from alembic import op
from app.database.base import GUID
import sqlalchemy as sa


revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('rfq', sa.Column('selected_supplier_id', GUID(length=36), nullable=True))
    op.add_column('rfq', sa.Column('selection_date', sa.Date(), nullable=True))
    op.add_column('rfq', sa.Column('selected_by', sa.String(length=128), nullable=True))
    op.add_column('rfq', sa.Column('selection_reason', sa.String(length=500), nullable=True))
    op.add_column('rfq', sa.Column('selection_comments', sa.String(length=500), nullable=True))
    op.create_foreign_key(op.f('fk_rfq_selected_supplier_id_supplier'), 'rfq', 'supplier', ['selected_supplier_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint(op.f('fk_rfq_selected_supplier_id_supplier'), 'rfq', type_='foreignkey')
    op.drop_column('rfq', 'selection_comments')
    op.drop_column('rfq', 'selection_reason')
    op.drop_column('rfq', 'selected_by')
    op.drop_column('rfq', 'selection_date')
    op.drop_column('rfq', 'selected_supplier_id')
