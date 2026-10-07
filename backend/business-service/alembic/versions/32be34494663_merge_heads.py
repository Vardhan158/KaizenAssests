"""merge heads

Revision ID: 32be34494663
Revises: 80f7621726bc, add_created_updated_to_supplier
Create Date: 2026-08-15 10:44:57.863480
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '32be34494663'
down_revision: Union[str, None] = ('80f7621726bc', 'add_created_updated_to_supplier')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
