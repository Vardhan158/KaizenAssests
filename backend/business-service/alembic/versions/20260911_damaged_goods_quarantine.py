"""Track damaged-goods quarantine disposition."""
from alembic import op
import sqlalchemy as sa

revision = "20260911_damage_quarantine"
down_revision = "20260910_damage_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("receiving_line")}
    columns = [
        ("disposition_status", sa.String(32)),
        ("quarantine_location", sa.String(128)),
        ("quarantined_by", sa.String(128)),
        ("quarantined_at", sa.DateTime(timezone=True)),
    ]
    for name, column_type in columns:
        if name not in existing:
            op.add_column("receiving_line", sa.Column(name, column_type, nullable=True))
    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("receiving_line")}
    if "ix_receiving_line_disposition_status" not in indexes:
        op.create_index("ix_receiving_line_disposition_status", "receiving_line", ["disposition_status"])


def downgrade() -> None:
    op.drop_index("ix_receiving_line_disposition_status", table_name="receiving_line")
    for name in ("quarantined_at", "quarantined_by", "quarantine_location", "disposition_status"):
        op.drop_column("receiving_line", name)
