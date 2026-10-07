"""Drop obsolete pr_id column from rfq table and ensure optional columns exist.

Revision ID: 20260819_rfq_fix
Revises: 20260819_gate
"""
from alembic import op
import sqlalchemy as sa

revision = "20260819_rfq_fix"
down_revision = "20260819_gate"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE rfq DROP COLUMN IF EXISTS pr_id CASCADE"))
    conn.execute(sa.text("ALTER TABLE rfq ADD COLUMN IF NOT EXISTS material_request_number VARCHAR(64)"))
    conn.execute(sa.text("ALTER TABLE rfq ADD COLUMN IF NOT EXISTS required_delivery_date DATE"))
    conn.execute(sa.text("ALTER TABLE rfq ADD COLUMN IF NOT EXISTS remarks TEXT"))


def downgrade() -> None:
    op.add_column("rfq", sa.Column("pr_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.drop_column("rfq", "remarks")
    op.drop_column("rfq", "required_delivery_date")
    op.drop_column("rfq", "material_request_number")
