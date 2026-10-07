"""Add pick task execution fields."""
from alembic import op
import sqlalchemy as sa

revision = "20260820_pick_execution"
down_revision = "20260820_mr_outbound"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("pick_task", sa.Column("destination", sa.String(128), nullable=False, server_default="Production Staging Area"))
    op.add_column("pick_task", sa.Column("assigned_to", sa.String(128), nullable=True))
    op.add_column("pick_task", sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("pick_task", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("pick_task", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("pick_task", sa.Column("completed_by", sa.String(128), nullable=True))


def downgrade() -> None:
    for column in ("completed_by", "completed_at", "started_at", "assigned_at", "assigned_to", "destination"):
        op.drop_column("pick_task", column)
