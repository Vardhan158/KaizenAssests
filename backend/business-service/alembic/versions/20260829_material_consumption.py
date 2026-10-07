"""Record expected and actual assembly material consumption.

Revision ID: 20260829_material_consumption
Revises: 20260828_assembly_workforce
"""

from alembic import op
import sqlalchemy as sa


revision = "20260829_material_consumption"
down_revision = "20260828_assembly_workforce"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assembly_material_consumption",
        sa.Column("id", sa.Uuid(), nullable=False), sa.Column("assembly_order_id", sa.Uuid(), nullable=False),
        sa.Column("material_code", sa.String(length=64), nullable=False),
        sa.Column("expected_per_unit", sa.Numeric(18, 4), nullable=False),
        sa.Column("assembled_quantity", sa.Numeric(18, 4), nullable=False),
        sa.Column("actual_consumed", sa.Numeric(18, 4), nullable=False),
        sa.Column("uom", sa.String(length=32), nullable=False),
        sa.Column("recorded_by", sa.String(length=128), nullable=False),
        sa.Column("recorded_at", sa.DateTime(), nullable=False), sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["assembly_order_id"], ["assembly_order.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("assembly_order_id", "material_code", name="uq_assembly_consumption_order_material"),
    )
    op.create_index("ix_assembly_consumption_order", "assembly_material_consumption", ["assembly_order_id"])
    op.create_index("ix_assembly_consumption_material", "assembly_material_consumption", ["material_code"])


def downgrade() -> None:
    op.drop_index("ix_assembly_consumption_material", table_name="assembly_material_consumption")
    op.drop_index("ix_assembly_consumption_order", table_name="assembly_material_consumption")
    op.drop_table("assembly_material_consumption")
