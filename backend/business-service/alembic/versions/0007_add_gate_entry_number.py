"""add gate_entry_number column to gate_entry table

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("gate_entry", sa.Column("gate_entry_number", sa.String(64), nullable=True))
    op.create_index("ix_gate_entry_gate_entry_number", "gate_entry", ["gate_entry_number"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_gate_entry_gate_entry_number", table_name="gate_entry")
    op.drop_column("gate_entry", "gate_entry_number")
