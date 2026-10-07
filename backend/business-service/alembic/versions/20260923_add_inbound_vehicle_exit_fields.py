"""Add exited_at and exited_by to gate_entry table.

Revision ID: 20260923_inbound_exit
Revises: 20260923_fg_putaway_genealogy
Create Date: 2026-09-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260923_inbound_exit"
down_revision: Union[str, Sequence[str], None] = "20260923_fg_putaway_genealogy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "gate_entry" in tables:
        cols = {c["name"] for c in inspector.get_columns("gate_entry")}
        if "exited_at" not in cols:
            op.add_column(
                "gate_entry",
                sa.Column("exited_at", sa.DateTime(timezone=True), nullable=True),
            )
        if "exited_by" not in cols:
            op.add_column(
                "gate_entry",
                sa.Column("exited_by", sa.String(length=128), nullable=True),
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "gate_entry" in tables:
        cols = {c["name"] for c in inspector.get_columns("gate_entry")}
        if "exited_by" in cols:
            op.drop_column("gate_entry", "exited_by")
        if "exited_at" in cols:
            op.drop_column("gate_entry", "exited_at")
