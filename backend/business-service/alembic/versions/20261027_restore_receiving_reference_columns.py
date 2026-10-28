"""Restore PO and ASN reference columns on legacy receiving tables.

Revision ID: 20261027_receiving_refs
Revises: 20261022_neutral_material_codes
Create Date: 2026-10-27
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20261027_receiving_refs"
down_revision: str = "20261022_neutral_material_codes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


REFERENCE_COLUMNS = (
    ("po_id", "UUID"),
    ("po_number", "VARCHAR(64)"),
    ("asn_id", "UUID"),
    ("asn_number", "VARCHAR(64)"),
)

SUPPLIER_COLUMNS = (
    ("supplier_code", "VARCHAR(64)"),
    ("main_materials", "JSONB"),
    ("rating", "NUMERIC(3, 2) NOT NULL DEFAULT 0"),
    ("performance_score", "NUMERIC(5, 2) NOT NULL DEFAULT 0"),
    ("payment_terms", "VARCHAR(128)"),
    ("credit_period_days", "INTEGER"),
    ("created_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
    ("updated_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
    ("updated_by", "VARCHAR(64)"),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    for table_name in ("grn", "inventory_receipt_posting"):
        if table_name not in existing_tables:
            continue
        for column_name, column_type in REFERENCE_COLUMNS:
            bind.execute(
                sa.text(
                    f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS "
                    f"{column_name} {column_type}"
                )
            )
            bind.execute(
                sa.text(
                    f"ALTER TABLE {table_name} ALTER COLUMN {column_name} DROP NOT NULL"
                )
            )

    if "grn" in existing_tables:
        bind.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_grn_po_id ON grn (po_id)"))
        bind.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_grn_po_number ON grn (po_number)"))

    if "supplier" in existing_tables:
        for column_name, column_type in SUPPLIER_COLUMNS:
            bind.execute(
                sa.text(
                    f"ALTER TABLE supplier ADD COLUMN IF NOT EXISTS "
                    f"{column_name} {column_type}"
                )
            )
        bind.execute(
            sa.text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_supplier_supplier_code "
                "ON supplier (supplier_code) WHERE supplier_code IS NOT NULL"
            )
        )


def downgrade() -> None:
    # These columns predate this repair migration and may contain production
    # references, so downgrade intentionally preserves them.
    pass
