"""Material architecture database audit fixes

Revision ID: 20260831_mat_audit
Revises: 20260831_canon_mat
Create Date: 2026-08-31 11:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260831_mat_audit'
down_revision: Union[str, None] = '20260831_canon_mat'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    existing_tables = set(sa.inspect(op.get_bind()).get_table_names())
    # -------------------------------------------------------------------------
    # 1. Fix material_stock Uniqueness:
    # Drop legacy unique constraint on material_code alone
    # -------------------------------------------------------------------------
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'material_stock_material_code_key'
            ) THEN
                ALTER TABLE material_stock DROP CONSTRAINT material_stock_material_code_key;
            END IF;
        END $$;
    """)

    # Create composite unique index on material_stock (material_variant_id, warehouse_id)
    # and on (material_id, variant_code, warehouse_id)
    if "material_stock" in existing_tables:
        op.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_material_stock_variant_wh
            ON material_stock (material_variant_id, warehouse_id)
            WHERE material_variant_id IS NOT NULL;
        """)
        op.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_material_stock_mat_var_wh
            ON material_stock (material_id, variant_code, warehouse_id)
            WHERE material_id IS NOT NULL AND variant_code IS NOT NULL;
        """)

    # -------------------------------------------------------------------------
    # 2. Material Variant Duplicate Specifications Database Index:
    # Prevent duplicate defining specs (size, color, grade, spec) under same material
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_material_variant_defining_specs
        ON material_variant (
            material_id,
            COALESCE(LOWER(TRIM(size)), ''),
            COALESCE(LOWER(TRIM(color)), ''),
            COALESCE(LOWER(TRIM(grade)), ''),
            COALESCE(LOWER(TRIM(specification)), '')
        )
        WHERE status != 'Inactive';
    """)

    # -------------------------------------------------------------------------
    # 3. Performance Indexes on Foreign Key Columns across All Tables
    # -------------------------------------------------------------------------
    fk_indexes = [
        ("rfq_item", "rfq_id", "ix_rfq_item_rfq_id"),
        ("rfq_item", "material_id", "ix_rfq_item_material_id"),
        ("rfq_item", "material_variant_id", "ix_rfq_item_material_variant_id"),
        ("quotation_line", "quotation_id", "ix_quotation_line_quotation_id"),
        ("quotation_line", "material_id", "ix_quotation_line_material_id"),
        ("quotation_line", "material_variant_id", "ix_quotation_line_material_variant_id"),
        ("purchase_order_item", "purchase_order_id", "ix_purchase_order_item_po_id"),
        ("purchase_order_item", "material_id", "ix_purchase_order_item_material_id"),
        ("purchase_order_item", "material_variant_id", "ix_purchase_order_item_material_variant_id"),
        ("material_request_item", "request_id", "ix_material_request_item_request_id"),
        ("material_request_item", "material_id", "ix_material_request_item_material_id"),
        ("material_request_item", "material_variant_id", "ix_material_request_item_material_variant_id"),
        ("asn_line", "asn_id", "ix_asn_line_asn_id"),
        ("asn_line", "material_id", "ix_asn_line_material_id"),
        ("asn_line", "material_variant_id", "ix_asn_line_material_variant_id"),
        ("grn_line", "grn_id", "ix_grn_line_grn_id"),
        ("grn_line", "material_id", "ix_grn_line_material_id"),
        ("grn_line", "material_variant_id", "ix_grn_line_material_variant_id"),
        ("inventory_receipt_posting", "material_id", "ix_inventory_receipt_posting_material_id"),
        ("inventory_receipt_posting", "material_variant_id", "ix_inventory_receipt_posting_material_variant_id"),
        ("material_stock", "material_id", "ix_material_stock_material_id"),
        ("material_stock", "material_variant_id", "ix_material_stock_material_variant_id"),
        ("material_stock", "warehouse_id", "ix_material_stock_warehouse_id"),
    ]

    for table, col, idx_name in fk_indexes:
        if table not in existing_tables:
            continue
        op.execute(f"""
            CREATE INDEX IF NOT EXISTS {idx_name}
            ON {table} ({col});
        """)

    # -------------------------------------------------------------------------
    # 4. Clean up redundant duplicate foreign key constraint names if present
    # -------------------------------------------------------------------------
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'material_request_item_material_id_fkey'
            ) AND EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'fk_material_request_item_material_id'
            ) THEN
                ALTER TABLE material_request_item DROP CONSTRAINT material_request_item_material_id_fkey;
            END IF;

            IF EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'material_request_item_material_variant_id_fkey'
            ) AND EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'fk_material_request_item_material_variant_id'
            ) THEN
                ALTER TABLE material_request_item DROP CONSTRAINT material_request_item_material_variant_id_fkey;
            END IF;

            IF EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'purchase_order_item_material_id_fkey'
            ) AND EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'fk_purchase_order_item_material_id'
            ) THEN
                ALTER TABLE purchase_order_item DROP CONSTRAINT purchase_order_item_material_id_fkey;
            END IF;

            IF EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'purchase_order_item_material_variant_id_fkey'
            ) AND EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'fk_purchase_order_item_material_variant_id'
            ) THEN
                ALTER TABLE purchase_order_item DROP CONSTRAINT purchase_order_item_material_variant_id_fkey;
            END IF;

            IF EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'material_stock_material_id_fkey'
            ) AND EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'fk_material_stock_material_id'
            ) THEN
                ALTER TABLE material_stock DROP CONSTRAINT material_stock_material_id_fkey;
            END IF;

            IF EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'material_stock_material_variant_id_fkey'
            ) AND EXISTS (
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'fk_material_stock_material_variant_id'
            ) THEN
                ALTER TABLE material_stock DROP CONSTRAINT material_stock_material_variant_id_fkey;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    # Recreate legacy material_stock unique constraint if needed
    op.execute("""
        ALTER TABLE material_stock ADD CONSTRAINT material_stock_material_code_key UNIQUE (material_code);
    """)
    op.execute("DROP INDEX IF EXISTS uq_material_stock_variant_wh;")
    op.execute("DROP INDEX IF EXISTS uq_material_stock_mat_var_wh;")
    op.execute("DROP INDEX IF EXISTS uq_material_variant_defining_specs;")
