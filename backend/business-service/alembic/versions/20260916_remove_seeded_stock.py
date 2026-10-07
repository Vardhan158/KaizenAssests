"""Remove legacy hardcoded warehouse inventory records.

Revision ID: 20260916_remove_seeded_stock
Revises: 20260915_remove_seeded_docks
Create Date: 2026-09-02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260916_remove_seeded_stock"
down_revision = "20260915_remove_seeded_docks"
branch_labels = None
depends_on = None


SEEDED_STOCK = """
    VALUES
      ('MAT-001', 'Steel Pipe 2"', 'Raw Materials', 1240, 'MTR'),
      ('MAT-002', 'Aluminum Sheet', 'Raw Materials', 850, 'SQM'),
      ('COMP-08', 'Bearing 6205', 'Components', 3200, 'PCS'),
      ('HDW-12', 'M12 Bolt', 'Hardware', 15000, 'PCS')
"""


def upgrade() -> None:
    connection = op.get_bind()
    if "material_stock" not in sa.inspect(connection).get_table_names():
        return

    # Delete only untouched demo rows. Any record changed by a real stock
    # operation is retained, even when it shares a seeded material code.
    connection.execute(sa.text(f"""
        WITH seeded(code, name, category, quantity, uom) AS ({SEEDED_STOCK})
        DELETE FROM material_stock stock
        USING seeded
        WHERE stock.material_code = seeded.code
          AND stock.material_name = seeded.name
          AND stock.category = seeded.category
          AND stock.on_hand = seeded.quantity
          AND stock.allocated = 0
          AND stock.available = seeded.quantity
          AND stock.uom = seeded.uom
          AND stock.warehouse_id = 'Main Warehouse'
          AND stock.material_id IS NULL
          AND stock.material_variant_id IS NULL
    """))


def downgrade() -> None:
    # Removed demo data is intentionally not recreated.
    pass
