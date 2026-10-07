"""Add missing columns to storage_location, grn, and grn_line tables.

Revision ID: 20260917_storage_grn_columns
Revises: 93829daff2cc
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260917_storage_grn_columns"
down_revision = "93829daff2cc"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _table_exists(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _column_exists(table_name: str, column_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    return any(c["name"] == column_name for c in _inspector().get_columns(table_name))


def _index_exists(table_name: str, index_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    return any(ix["name"] == index_name for ix in _inspector().get_indexes(table_name))


def upgrade() -> None:
    # 0. Expand alembic_version.version_num to support revisions > 32 characters
    op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(128)")

    # 1. storage_location
    if _table_exists("storage_location"):
        if not _column_exists("storage_location", "location_code"):
            op.add_column(
                "storage_location",
                sa.Column("location_code", sa.String(64), nullable=True),
            )
            op.execute(
                """
                UPDATE storage_location
                SET location_code = COALESCE(
                    warehouse_id || '-' || zone || '-' || rack || '-' || bin,
                    'LOC-' || substr(id::text, 1, 8)
                )
                WHERE location_code IS NULL
                """
            )
            op.alter_column(
                "storage_location",
                "location_code",
                nullable=False,
            )

        if not _index_exists("storage_location", "ix_storage_location_location_code"):
            op.create_index(
                "ix_storage_location_location_code",
                "storage_location",
                ["location_code"],
                unique=True,
            )

    # 2. grn
    if _table_exists("grn"):
        grn_cols = [
            ("grn_number", sa.Column("grn_number", sa.String(64), nullable=True)),
            ("asn_id", sa.Column("asn_id", postgresql.UUID(as_uuid=True), nullable=True)),
            ("asn_number", sa.Column("asn_number", sa.String(64), nullable=True)),
            ("supplier_name", sa.Column("supplier_name", sa.String(255), nullable=True)),
            ("vehicle_number", sa.Column("vehicle_number", sa.String(64), nullable=True)),
            ("warehouse_id", sa.Column("warehouse_id", sa.String(64), nullable=True)),
            ("dock_number", sa.Column("dock_number", sa.String(32), nullable=True)),
            ("posted_by", sa.Column("posted_by", sa.String(128), nullable=True)),
            ("posted_at", sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True)),
            ("verification_notes", sa.Column("verification_notes", sa.Text(), nullable=True)),
        ]
        for col_name, col_def in grn_cols:
            if not _column_exists("grn", col_name):
                op.add_column("grn", col_def)

        if not _index_exists("grn", "ix_grn_grn_number"):
            op.create_index(
                "ix_grn_grn_number",
                "grn",
                ["grn_number"],
                unique=True,
            )

    # 3. grn_line
    if _table_exists("grn_line"):
        grn_line_cols = [
            ("material_name", sa.Column("material_name", sa.String(256), nullable=True)),
            ("uom", sa.Column("uom", sa.String(32), nullable=True)),
            ("accepted_quantity", sa.Column("accepted_quantity", sa.Numeric(18, 4), nullable=True)),
            ("rejected_quantity", sa.Column("rejected_quantity", sa.Numeric(18, 4), nullable=False, server_default="0")),
            ("quality_result", sa.Column("quality_result", sa.String(32), nullable=True)),
        ]
        for col_name, col_def in grn_line_cols:
            if not _column_exists("grn_line", col_name):
                op.add_column("grn_line", col_def)


def downgrade() -> None:
    pass
