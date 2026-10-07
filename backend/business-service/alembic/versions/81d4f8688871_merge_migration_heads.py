"""merge migration heads

Revision ID: 81d4f8688871
Revises: 246123db4a01, 3e9f76cfa211
Create Date: 2026-09-02 12:39:32.554076
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '81d4f8688871'
down_revision: Union[str, None] = ('246123db4a01', '3e9f76cfa211')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
