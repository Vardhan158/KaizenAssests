"""merge_receiving_and_material_heads

Revision ID: 3e9f76cfa211
Revises: 20260831_ensure_mat_cols, 7ee0fa74c468
Create Date: 2026-09-01 15:22:40.860118
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3e9f76cfa211'
down_revision: Union[str, None] = ('20260831_ensure_mat_cols', '7ee0fa74c468')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
