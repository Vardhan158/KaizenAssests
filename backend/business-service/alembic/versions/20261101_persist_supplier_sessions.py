"""Persist random, expiring supplier sessions.

Revision ID: 20261101_supplier_sessions
Revises: 20261101_harden_auth
"""

from alembic import op
import sqlalchemy as sa


revision = "20261101_supplier_sessions"
down_revision = "20261101_harden_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("supplier_user")}
    if "auth_token_hash" not in columns:
        op.add_column("supplier_user", sa.Column("auth_token_hash", sa.String(length=64)))
    indexes = {index["name"] for index in inspector.get_indexes("supplier_user")}
    if "ix_supplier_user_auth_token_hash" not in indexes:
        op.create_index("ix_supplier_user_auth_token_hash", "supplier_user", ["auth_token_hash"])
    if "auth_token_expires_at" not in columns:
        op.add_column("supplier_user", sa.Column("auth_token_expires_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("supplier_user", "auth_token_expires_at")
    op.drop_index("ix_supplier_user_auth_token_hash", table_name="supplier_user")
    op.drop_column("supplier_user", "auth_token_hash")
