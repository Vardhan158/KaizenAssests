"""convert main_material to main_materials list

Revision ID: f04c6ce3af9b
Revises: 3eb22e2a1768
Create Date: 2026-08-14 11:21:47.416624
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f04c6ce3af9b'
down_revision: Union[str, None] = '3eb22e2a1768'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE supplier DROP COLUMN IF EXISTS main_material"))
    conn.execute(sa.text("ALTER TABLE supplier ADD COLUMN IF NOT EXISTS main_materials JSON"))


def downgrade() -> None:
    op.drop_column('supplier', 'main_materials')
    op.add_column('supplier', sa.Column('main_material', sa.String(length=128), nullable=True))
