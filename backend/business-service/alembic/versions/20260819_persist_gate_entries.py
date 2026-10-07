"""Persist complete gate-entry details.

Revision ID: 20260819_gate
Revises: 8c4c48db6de0
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260819_gate"
down_revision = "8c4c48db6de0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE gate_entry ADD COLUMN IF NOT EXISTS gate_entry_number VARCHAR(64)"))
    conn.execute(sa.text("ALTER TABLE gate_entry ADD COLUMN IF NOT EXISTS po_document_data BYTEA"))
    conn.execute(sa.text("ALTER TABLE gate_entry ADD COLUMN IF NOT EXISTS vehicle_photo_data BYTEA"))
    conn.execute(sa.text("ALTER TABLE gate_entry ADD COLUMN IF NOT EXISTS ocr_line_items JSONB"))
    conn.execute(sa.text("UPDATE gate_entry SET gate_entry_number = 'GE-LEGACY-' || upper(substr(replace(id::text, '-', ''), 1, 12)) WHERE gate_entry_number IS NULL"))
    conn.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS ix_gate_entry_gate_entry_number ON gate_entry (gate_entry_number)"))


def downgrade() -> None:
    op.drop_index("ix_gate_entry_gate_entry_number", table_name="gate_entry")
    op.drop_column("gate_entry", "ocr_line_items")
    op.drop_column("gate_entry", "vehicle_photo_data")
    op.drop_column("gate_entry", "po_document_data")
    op.drop_column("gate_entry", "gate_entry_number")
