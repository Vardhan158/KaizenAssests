"""Add assembly teams and workforce management.

Revision ID: 20260828_assembly_workforce
Revises: 20260827_assembly_steps
"""

from alembic import op
import sqlalchemy as sa


revision = "20260828_assembly_workforce"
down_revision = "20260827_assembly_steps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assembly_team",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("team_leader", sa.String(length=128), nullable=False),
        sa.Column("workers", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("shift", sa.String(length=64), nullable=False),
        sa.Column("workstation", sa.String(length=64), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("name"),
    )
    op.create_index("ix_assembly_team_name", "assembly_team", ["name"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_assembly_team_name", table_name="assembly_team")
    op.drop_table("assembly_team")
