"""Add material price thresholds.

Revision ID: 20260906_price_thresholds
Revises: 20260905_material_sub_categories
"""
from alembic import op
import sqlalchemy as sa

revision = "20260906_price_thresholds"
down_revision = "20260905_material_sub_categories"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("material", sa.Column("minimum_price", sa.Numeric(18, 4), nullable=True))
    op.add_column("material", sa.Column("standard_price", sa.Numeric(18, 4), nullable=True))
    op.add_column("material", sa.Column("maximum_price", sa.Numeric(18, 4), nullable=True))
    op.add_column("material", sa.Column("currency", sa.String(3), nullable=False, server_default="INR"))
    op.add_column("material", sa.Column("price_effective_from", sa.Date(), nullable=True))
    op.add_column("material", sa.Column("price_effective_to", sa.Date(), nullable=True))
    op.add_column("material", sa.Column("price_threshold_status", sa.String(16), nullable=False, server_default="Active"))
    op.add_column("material", sa.Column("approval_required_above_threshold", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("material", sa.Column("last_purchase_price", sa.Numeric(18, 4), nullable=True))

def downgrade() -> None:
    for column in ("last_purchase_price", "approval_required_above_threshold", "price_threshold_status", "price_effective_to", "price_effective_from", "currency", "maximum_price", "standard_price", "minimum_price"):
        op.drop_column("material", column)
