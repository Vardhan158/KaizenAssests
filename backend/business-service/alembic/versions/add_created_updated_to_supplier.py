"""add_created_updated_to_supplier

Revision ID: add_created_updated_to_supplier
Revises: f4897dcf5268
Create Date: 2026-08-14 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'add_created_updated_to_supplier'
down_revision: Union[str, None] = 'f4897dcf5268'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
