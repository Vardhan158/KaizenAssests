"""merge gate entry and supplier heads

Revision ID: 8811455d5036
Revises: f4897dcf5268, 0007
Create Date: 2026-08-12 18:31:29.541022
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8811455d5036'
down_revision: Union[str, None] = ('f4897dcf5268', '0007')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
