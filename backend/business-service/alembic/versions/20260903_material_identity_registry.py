"""Create the application-wide material-code registry.

Revision ID: 20260903_material_identity
Revises: 20260902_assembly_fg
"""
from alembic import op
import sqlalchemy as sa


revision = "20260903_material_identity"
down_revision = "20260902_assembly_fg"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def upgrade() -> None:
    if "material_identity" not in _inspector().get_table_names():
        op.create_table(
            "material_identity",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("normalized_name", sa.String(length=256), nullable=False),
            sa.Column("material_code", sa.String(length=64), nullable=False),
            sa.Column("display_name", sa.String(length=256), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("normalized_name"),
            sa.UniqueConstraint("material_code"),
        )
        op.create_index("ix_material_identity_normalized_name", "material_identity", ["normalized_name"])
        op.create_index("ix_material_identity_material_code", "material_identity", ["material_code"])


def downgrade() -> None:
    op.drop_index("ix_material_identity_material_code", table_name="material_identity")
    op.drop_index("ix_material_identity_normalized_name", table_name="material_identity")
    op.drop_table("material_identity")
