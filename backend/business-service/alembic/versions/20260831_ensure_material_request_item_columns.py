"""Ensure material_id, material_variant_id, and variant_code columns exist in material_request_item, purchase_order_item, and material_stock.

Revision ID: 20260831_ensure_mat_cols
Revises: 0009_update_dock_only
Create Date: 2026-08-31
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260831_ensure_mat_cols"
down_revision: str = "0009_update_dock_only"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    # 1. material_request_item
    if "material_request_item" in tables:
        for col_name, col_type in [
            ("material_id", "UUID REFERENCES material(id) ON DELETE SET NULL"),
            ("material_variant_id", "UUID REFERENCES material_variant(id) ON DELETE SET NULL"),
            ("variant_code", "VARCHAR(128)"),
        ]:
            conn.execute(sa.text(f"ALTER TABLE material_request_item ADD COLUMN IF NOT EXISTS {col_name} {col_type}"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_material_request_item_material_id ON material_request_item (material_id)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_material_request_item_material_variant_id ON material_request_item (material_variant_id)"))

    # 2. purchase_order_item
    if "purchase_order_item" in tables:
        for col_name, col_type in [
            ("material_id", "UUID REFERENCES material(id) ON DELETE SET NULL"),
            ("material_variant_id", "UUID REFERENCES material_variant(id) ON DELETE SET NULL"),
            ("variant_code", "VARCHAR(128)"),
        ]:
            conn.execute(sa.text(f"ALTER TABLE purchase_order_item ADD COLUMN IF NOT EXISTS {col_name} {col_type}"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_purchase_order_item_material_id ON purchase_order_item (material_id)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_purchase_order_item_material_variant_id ON purchase_order_item (material_variant_id)"))

    # 3. material_stock
    if "material_stock" in tables:
        for col_name, col_type in [
            ("material_id", "UUID REFERENCES material(id) ON DELETE SET NULL"),
            ("material_variant_id", "UUID REFERENCES material_variant(id) ON DELETE SET NULL"),
            ("variant_code", "VARCHAR(128)"),
        ]:
            conn.execute(sa.text(f"ALTER TABLE material_stock ADD COLUMN IF NOT EXISTS {col_name} {col_type}"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_material_stock_material_id ON material_stock (material_id)"))
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_material_stock_material_variant_id ON material_stock (material_variant_id)"))


def downgrade() -> None:
    conn = op.get_bind()
    for table in ["material_request_item", "purchase_order_item", "material_stock"]:
        for col in ["variant_code", "material_variant_id", "material_id"]:
            try:
                conn.execute(sa.text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {col}"))
            except Exception:
                pass
