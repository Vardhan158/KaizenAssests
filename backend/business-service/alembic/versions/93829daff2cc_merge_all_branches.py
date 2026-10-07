"""merge_all_branches

Revision ID: 93829daff2cc
Revises: 20260904_store_dock_assign, 20260914_claim_lifecycle, 20260916_remove_seeded_stock, 9933281514d4
Create Date: 2026-09-07 16:35:55.780790
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '93829daff2cc'
down_revision: Union[str, None] = ('20260904_store_dock_assign', '20260914_claim_lifecycle', '20260916_remove_seeded_stock', '9933281514d4', '81d4f8688871')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
