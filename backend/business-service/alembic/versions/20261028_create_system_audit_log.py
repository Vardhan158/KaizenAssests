"""Create centralized system audit log.

Revision ID: 20261028_system_audit
Revises: 20261028_assembly_units
"""

from alembic import op
import sqlalchemy as sa

revision = "20261028_system_audit"
down_revision = "20261028_assembly_units"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_audit_log",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("actor_username", sa.String(128), nullable=False),
        sa.Column("actor_employee_id", sa.String(64)),
        sa.Column("actor_roles", sa.String(255)),
        sa.Column("module", sa.String(64), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("request_path", sa.String(512), nullable=False),
        sa.Column("target_reference", sa.String(255)),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("result", sa.String(32), nullable=False),
        sa.Column("request_id", sa.String(64)),
        sa.Column("ip_address", sa.String(64)),
        sa.Column("user_agent", sa.Text()),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    for column in ("actor_username", "actor_employee_id", "module", "action", "target_reference", "status_code", "result", "request_id", "occurred_at"):
        op.create_index(f"ix_system_audit_log_{column}", "system_audit_log", [column])


def downgrade() -> None:
    op.drop_table("system_audit_log")
