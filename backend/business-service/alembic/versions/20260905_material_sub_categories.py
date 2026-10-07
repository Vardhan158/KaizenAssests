"""Persist selectable material sub-categories.

Revision ID: 20260905_material_sub_categories
Revises: 20260904_material_master
"""
from alembic import op
import sqlalchemy as sa


revision = "20260905_material_sub_categories"
down_revision = "20260904_material_master"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "material_sub_category",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.execute(
        """
        INSERT INTO material_sub_category (name)
        SELECT DISTINCT TRIM(sub_category)
        FROM material
        WHERE sub_category IS NOT NULL AND TRIM(sub_category) <> ''
        """
    )


def downgrade() -> None:
    op.drop_table("material_sub_category")
