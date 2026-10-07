"""add vendor type and supplier category tables

Revision ID: f20fc6276065
Revises: f3a4b5c6d7e8
Create Date: 2026-08-14 11:03:29.934493
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f20fc6276065'
down_revision: Union[str, None] = 'f3a4b5c6d7e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create vendor_type table
    op.create_table(
        "vendor_type",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name")
    )
    # Create supplier_category table
    op.create_table(
        "supplier_category",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name")
    )

    # Seed default values
    op.execute("INSERT INTO vendor_type (name) VALUES ('Manufacturer'), ('Distributor'), ('Service Provider')")
    op.execute("INSERT INTO supplier_category (name) VALUES ('Raw Materials'), ('Packaging'), ('Finished Goods'), ('Consumables')")


def downgrade() -> None:
    op.drop_table("supplier_category")
    op.drop_table("vendor_type")
