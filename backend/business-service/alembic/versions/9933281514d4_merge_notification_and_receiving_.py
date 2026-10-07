"""merge notification and receiving migration heads

Revision ID: 9933281514d4
Revises: 246123db4a01, 3e9f76cfa211
Create Date: 2026-09-02 12:17:53.873780
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9933281514d4'
down_revision: Union[str, None] = ('246123db4a01', '3e9f76cfa211')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
