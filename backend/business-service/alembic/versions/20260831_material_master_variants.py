"""Implement production-quality Material Master with Variants.

Revision ID: 20260831_material_master_variants
Revises: 20260820_putaway_operator
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import app.database.base

revision = "20260831_mat_master"
down_revision = "20260820_putaway_operator"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # 1. Evolve 'material' table
    # Check if table exists, create or alter columns
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS material (
            id UUID PRIMARY KEY,
            material_code VARCHAR(64) UNIQUE NOT NULL,
            material_name VARCHAR(256) NOT NULL,
            category VARCHAR(128) NOT NULL DEFAULT 'General',
            description TEXT,
            base_uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
            status VARCHAR(32) NOT NULL DEFAULT 'Active',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_by VARCHAR(64),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_by VARCHAR(64)
        )
    """))

    # In case material table existed previously with 'code' and 'name' columns
    for col_def in [
        ("material_code", "VARCHAR(64)"),
        ("material_name", "VARCHAR(256)"),
        ("base_uom", "VARCHAR(32) DEFAULT 'PCS'"),
        ("status", "VARCHAR(32) DEFAULT 'Active'"),
        ("created_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
        ("created_by", "VARCHAR(64)"),
        ("updated_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
        ("updated_by", "VARCHAR(64)"),
    ]:
        try:
            conn.execute(sa.text(f"ALTER TABLE material ADD COLUMN IF NOT EXISTS {col_def[0]} {col_def[1]}"))
        except Exception:
            pass

    # Copy legacy 'code' / 'name' values to 'material_code' / 'material_name' if needed
    try:
        conn.execute(sa.text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name='material' AND column_name='code'
                ) THEN
                    ALTER TABLE material ALTER COLUMN code DROP NOT NULL;
                    UPDATE material SET material_code = code WHERE material_code IS NULL;
                END IF;
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name='material' AND column_name='name'
                ) THEN
                    ALTER TABLE material ALTER COLUMN name DROP NOT NULL;
                    UPDATE material SET material_name = name WHERE material_name IS NULL;
                END IF;
            END $$;
        """))
    except Exception:
        pass

    try:
        conn.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS ix_material_material_code ON material (material_code)"))
    except Exception:
        pass

    # 2. Create 'material_variant' table
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS material_variant (
            id UUID PRIMARY KEY,
            material_id UUID NOT NULL REFERENCES material(id) ON DELETE CASCADE,
            variant_code VARCHAR(128) UNIQUE NOT NULL,
            size VARCHAR(128),
            color VARCHAR(64),
            grade VARCHAR(128),
            specification TEXT,
            uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
            attributes JSONB DEFAULT '{}'::jsonb,
            status VARCHAR(32) NOT NULL DEFAULT 'Active',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_by VARCHAR(64),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_by VARCHAR(64)
        )
    """))

    try:
        conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_material_variant_material_id ON material_variant (material_id)"))
        conn.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS ix_material_variant_variant_code ON material_variant (variant_code)"))
    except Exception:
        pass

    # 3. Data migration: ensure all materials have at least one variant
    conn.execute(sa.text("""
        INSERT INTO material_variant (
            id, material_id, variant_code, uom, status, created_at, updated_at
        )
        SELECT 
            gen_random_uuid(),
            m.id,
            COALESCE(m.material_code, m.id::text) || '-V001',
            COALESCE(m.base_uom, 'PCS'),
            COALESCE(m.status, 'Active'),
            NOW(),
            NOW()
        FROM material m
        WHERE NOT EXISTS (
            SELECT 1 FROM material_variant mv WHERE mv.material_id = m.id
        )
    """))

    # 4. Add foreign keys and variant tracking to material_request_item
    if inspector.has_table("material_request_item"):
        for col_def in [
            ("material_id", "UUID REFERENCES material(id) ON DELETE SET NULL"),
            ("material_variant_id", "UUID REFERENCES material_variant(id) ON DELETE SET NULL"),
            ("variant_code", "VARCHAR(128)"),
        ]:
            conn.execute(sa.text(f"ALTER TABLE material_request_item ADD COLUMN IF NOT EXISTS {col_def[0]} {col_def[1]}"))

    # 5. Add foreign keys and variant tracking to purchase_order_item
    if inspector.has_table("purchase_order_item"):
        for col_def in [
            ("material_id", "UUID REFERENCES material(id) ON DELETE SET NULL"),
            ("material_variant_id", "UUID REFERENCES material_variant(id) ON DELETE SET NULL"),
            ("variant_code", "VARCHAR(128)"),
        ]:
            conn.execute(sa.text(f"ALTER TABLE purchase_order_item ADD COLUMN IF NOT EXISTS {col_def[0]} {col_def[1]}"))

    # 6. Add variant tracking to material_stock
    if inspector.has_table("material_stock"):
        for col_def in [
            ("material_id", "UUID REFERENCES material(id) ON DELETE SET NULL"),
            ("material_variant_id", "UUID REFERENCES material_variant(id) ON DELETE SET NULL"),
            ("variant_code", "VARCHAR(128)"),
        ]:
            conn.execute(sa.text(f"ALTER TABLE material_stock ADD COLUMN IF NOT EXISTS {col_def[0]} {col_def[1]}"))


def downgrade() -> None:
    conn = op.get_bind()
    for table in ["material_stock", "purchase_order_item", "material_request_item"]:
        for col in ["variant_code", "material_variant_id", "material_id"]:
            try:
                conn.execute(sa.text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {col}"))
            except Exception:
                pass

    conn.execute(sa.text("DROP TABLE IF EXISTS material_variant CASCADE"))
