"""Create managed assembly units.

Revision ID: 20261028_assembly_units
Revises: 20261028_no_user_store
"""

from alembic import op
import sqlalchemy as sa


revision = "20261028_assembly_units"
down_revision = "20261028_no_user_store"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assembly_unit",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("unit_code", sa.String(64), nullable=False),
        sa.Column("unit_name", sa.String(128), nullable=False),
        sa.Column("description", sa.String(255), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("unit_code", name="uq_assembly_unit_code"),
    )
    op.create_index("ix_assembly_unit_unit_code", "assembly_unit", ["unit_code"])
    op.create_index("ix_assembly_unit_status", "assembly_unit", ["status"])


def downgrade() -> None:
    op.drop_index("ix_assembly_unit_status", table_name="assembly_unit")
    op.drop_index("ix_assembly_unit_unit_code", table_name="assembly_unit")
    op.drop_table("assembly_unit")
