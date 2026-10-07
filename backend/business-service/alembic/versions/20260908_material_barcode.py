"""Add searchable material barcode."""
from alembic import op
import sqlalchemy as sa

revision = "20260908_material_barcode"
down_revision = "20260907_inventory_controls"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("material", sa.Column("barcode", sa.String(64), nullable=True))
    op.create_unique_constraint("uq_material_barcode", "material", ["barcode"])

def downgrade() -> None:
    op.drop_constraint("uq_material_barcode", "material", type_="unique")
    op.drop_column("material", "barcode")
