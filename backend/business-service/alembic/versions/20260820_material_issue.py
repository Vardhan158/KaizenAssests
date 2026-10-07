"""Add internal production material issue records."""
from alembic import op
import sqlalchemy as sa

revision = "20260820_material_issue"
down_revision = "20260820_pick_execution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("material_issue",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("issue_number", sa.String(64), nullable=False, unique=True),
        sa.Column("pick_task_id", sa.Uuid(), sa.ForeignKey("pick_task.id", ondelete="RESTRICT"), nullable=False, unique=True),
        sa.Column("request_id", sa.Uuid(), sa.ForeignKey("material_request.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("department", sa.String(64), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("issued_by", sa.String(128), nullable=False),
        sa.Column("received_by", sa.String(128), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False))


def downgrade() -> None:
    op.drop_table("material_issue")
