"""Add persisted login lockout and session-expiry fields.

Revision ID: 20261101_harden_auth
Revises: 20261028_system_audit, 20261037_fg_section_numbering
"""

from alembic import op
import sqlalchemy as sa


revision = "20261101_harden_auth"
down_revision = ("20261028_system_audit", "20261037_fg_section_numbering")
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    table_name = "user_account" if insp.has_table("user_account") else ("store_manager_user" if insp.has_table("store_manager_user") else None)
    if not table_name:
        return
    columns = {column["name"] for column in insp.get_columns(table_name)}
    if "auth_token_expires_at" not in columns:
        op.add_column(table_name, sa.Column("auth_token_expires_at", sa.DateTime(timezone=True)))
    if "failed_login_attempts" not in columns:
        op.add_column(
            table_name,
            sa.Column("failed_login_attempts", sa.Integer(), server_default="0", nullable=False),
        )
    if "locked_until" not in columns:
        op.add_column(table_name, sa.Column("locked_until", sa.DateTime(timezone=True)))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    table_name = "user_account" if insp.has_table("user_account") else ("store_manager_user" if insp.has_table("store_manager_user") else None)
    if not table_name:
        return
    op.drop_column(table_name, "locked_until")
    op.drop_column(table_name, "failed_login_attempts")
    op.drop_column(table_name, "auth_token_expires_at")
