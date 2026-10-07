"""Alembic migration for canonical material master and variant flow across procurement, storage, receiving, and inventory.

Revision ID: 20260831_canon_mat
Revises: 20260831_mat_master
Create Date: 2026-08-31
"""
from alembic import op
import sqlalchemy as sa

revision = "20260831_canon_mat"
down_revision = "20260831_mat_master"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    existing_tables = set(sa.inspect(conn).get_table_names())

    # 1. Add material_id, material_variant_id, variant_code to transactional tables
    target_tables = [
        "rfq_item",
        "quotation_line",
        "asn_line",
        "grn_line",
        "inventory_receipt_posting",
        "return_line",
    ]

    for tbl in target_tables:
        if tbl not in existing_tables:
            continue
        for col_name, col_type in [
            ("material_id", "UUID"),
            ("material_variant_id", "UUID"),
            ("variant_code", "VARCHAR(128)"),
        ]:
            conn.execute(sa.text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS {col_name} {col_type}"))

    # 2. Add foreign keys
    for tbl in [
        "material_request_item",
        "rfq_item",
        "quotation_line",
        "purchase_order_item",
        "asn_line",
        "grn_line",
        "inventory_receipt_posting",
        "return_line",
        "material_stock",
    ]:
        if tbl not in existing_tables:
            continue
        conn.execute(sa.text(f"""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'fk_{tbl}_material_id'
                ) THEN
                    ALTER TABLE {tbl}
                    ADD CONSTRAINT fk_{tbl}_material_id
                    FOREIGN KEY (material_id) REFERENCES material(id) ON DELETE SET NULL;
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'fk_{tbl}_material_variant_id'
                ) THEN
                    ALTER TABLE {tbl}
                    ADD CONSTRAINT fk_{tbl}_material_variant_id
                    FOREIGN KEY (material_variant_id) REFERENCES material_variant(id) ON DELETE SET NULL;
                END IF;
            END $$;
        """))

    # 3. Migrate and link existing records by material_code / variant_code
    # Link material_request_item
    if "material_request_item" in existing_tables:
        conn.execute(sa.text("""
            UPDATE material_request_item mri
            SET material_id = m.id
            FROM material m
            WHERE mri.material_id IS NULL AND mri.material_code = m.material_code;
        """))
        conn.execute(sa.text("""
            UPDATE material_request_item mri
            SET material_variant_id = mv.id, variant_code = mv.variant_code
            FROM material_variant mv
            WHERE mri.material_variant_id IS NULL AND (mri.variant_code = mv.variant_code OR mri.material_id = mv.material_id);
        """))

    # Link rfq_item
    conn.execute(sa.text("""
        UPDATE rfq_item ri
        SET material_id = m.id
        FROM material m
        WHERE ri.material_id IS NULL AND ri.material_code = m.material_code;
    """))
    conn.execute(sa.text("""
        UPDATE rfq_item ri
        SET material_variant_id = mv.id, variant_code = mv.variant_code
        FROM material_variant mv
        WHERE ri.material_variant_id IS NULL AND (ri.variant_code = mv.variant_code OR ri.material_id = mv.material_id);
    """))

    # Link quotation_line
    conn.execute(sa.text("""
        UPDATE quotation_line ql
        SET material_id = m.id
        FROM material m
        WHERE ql.material_id IS NULL AND ql.item_code = m.material_code;
    """))
    conn.execute(sa.text("""
        UPDATE quotation_line ql
        SET material_variant_id = mv.id, variant_code = mv.variant_code, material_id = mv.material_id
        FROM material_variant mv
        WHERE ql.material_variant_id IS NULL AND (ql.item_code = mv.variant_code OR ql.variant_code = mv.variant_code);
    """))

    # Link purchase_order_item
    if "purchase_order_item" in existing_tables:
        conn.execute(sa.text("""
            UPDATE purchase_order_item poi
            SET material_id = m.id
            FROM material m
            WHERE poi.material_id IS NULL AND poi.material_code = m.material_code;
        """))
        conn.execute(sa.text("""
            UPDATE purchase_order_item poi
            SET material_variant_id = mv.id, variant_code = mv.variant_code
            FROM material_variant mv
            WHERE poi.material_variant_id IS NULL AND (poi.variant_code = mv.variant_code OR poi.material_id = mv.material_id);
        """))

    # Link material_stock
    if "material_stock" in existing_tables:
        conn.execute(sa.text("""
            UPDATE material_stock ms
            SET material_id = m.id
            FROM material m
            WHERE ms.material_id IS NULL AND ms.material_code = m.material_code;
        """))
        conn.execute(sa.text("""
            UPDATE material_stock ms
            SET material_variant_id = mv.id, variant_code = mv.variant_code
            FROM material_variant mv
            WHERE ms.material_variant_id IS NULL AND (ms.variant_code = mv.variant_code OR ms.material_id = mv.material_id);
        """))

    # Link asn_line
    conn.execute(sa.text("""
        UPDATE asn_line al
        SET material_id = m.id
        FROM material m
        WHERE al.material_id IS NULL AND al.item_code = m.material_code;
    """))
    conn.execute(sa.text("""
        UPDATE asn_line al
        SET material_variant_id = mv.id, variant_code = mv.variant_code, material_id = mv.material_id
        FROM material_variant mv
        WHERE al.material_variant_id IS NULL AND (al.item_code = mv.variant_code OR al.variant_code = mv.variant_code);
    """))

    # Link grn_line
    conn.execute(sa.text("""
        UPDATE grn_line gl
        SET material_id = m.id
        FROM material m
        WHERE gl.material_id IS NULL AND gl.item_code = m.material_code;
    """))
    conn.execute(sa.text("""
        UPDATE grn_line gl
        SET material_variant_id = mv.id, variant_code = mv.variant_code, material_id = mv.material_id
        FROM material_variant mv
        WHERE gl.material_variant_id IS NULL AND (gl.item_code = mv.variant_code OR gl.variant_code = mv.variant_code);
    """))

    # 4. Drop legacy raw_material_master table
    conn.execute(sa.text("DROP TABLE IF EXISTS raw_material_master CASCADE;"))


def downgrade():
    pass
