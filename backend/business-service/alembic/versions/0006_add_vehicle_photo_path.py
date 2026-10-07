"""add vehicle_photo_path column to gate_entry table

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("gate_entry", sa.Column("vehicle_photo_path", sa.String(256), nullable=True))


def downgrade() -> None:
    op.drop_column("gate_entry", "vehicle_photo_path")
