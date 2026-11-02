"""Add per-page access settings to staff accounts.

Revision ID: 20261027_user_permissions
Revises: 20261027_assembly_qc
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20261027_user_permissions"
down_revision = "20261027_assembly_qc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "store_manager_user",
        sa.Column(
            "page_permissions",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("store_manager_user", "page_permissions")
