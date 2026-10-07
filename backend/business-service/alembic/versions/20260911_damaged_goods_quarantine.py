"""Track damaged-goods quarantine disposition."""
from alembic import op
import sqlalchemy as sa

revision = "20260911_damage_quarantine"
down_revision = "20260910_damage_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("receiving_line", sa.Column("disposition_status", sa.String(32), nullable=True))
    op.add_column("receiving_line", sa.Column("quarantine_location", sa.String(128), nullable=True))
    op.add_column("receiving_line", sa.Column("quarantined_by", sa.String(128), nullable=True))
    op.add_column("receiving_line", sa.Column("quarantined_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_receiving_line_disposition_status", "receiving_line", ["disposition_status"])


def downgrade() -> None:
    op.drop_index("ix_receiving_line_disposition_status", table_name="receiving_line")
    for name in ("quarantined_at", "quarantined_by", "quarantine_location", "disposition_status"):
        op.drop_column("receiving_line", name)
