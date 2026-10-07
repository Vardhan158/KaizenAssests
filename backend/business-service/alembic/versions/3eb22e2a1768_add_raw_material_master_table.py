"""add raw material master table

Revision ID: 3eb22e2a1768
Revises: f20fc6276065
Create Date: 2026-08-14 11:11:42.518526
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3eb22e2a1768'
down_revision: Union[str, None] = 'f20fc6276065'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create raw_material_master table
    op.create_table(
        "raw_material_master",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name")
    )

def downgrade() -> None:
    op.drop_table("raw_material_master")
