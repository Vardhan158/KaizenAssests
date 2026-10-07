"""Add store_id and zone_id foreign keys to storage_location table

Revision ID: 20260902_storage_loc_zone
Revises: 20260902_store_mgr_user
Create Date: 2026-09-02 17:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260902_storage_loc_zone"
down_revision: Union[str, None] = "20260902_store_mgr_user"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "storage_location" in existing_tables:
        columns = [c["name"] for c in inspector.get_columns("storage_location")]

        if "store_id" not in columns:
            op.add_column(
                "storage_location",
                sa.Column("store_id", postgresql.UUID(as_uuid=True), nullable=True),
            )
            op.create_foreign_key(
                "fk_storage_location_store_id",
                "storage_location",
                "store",
                ["store_id"],
                ["id"],
                ondelete="SET NULL",
            )
            op.create_index(
                "ix_storage_location_store_id",
                "storage_location",
                ["store_id"],
            )

        if "zone_id" not in columns:
            op.add_column(
                "storage_location",
                sa.Column("zone_id", postgresql.UUID(as_uuid=True), nullable=True),
            )
            op.create_foreign_key(
                "fk_storage_location_zone_id",
                "storage_location",
                "store_zone",
                ["zone_id"],
                ["id"],
                ondelete="SET NULL",
            )
            op.create_index(
                "ix_storage_location_zone_id",
                "storage_location",
                ["zone_id"],
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "storage_location" in existing_tables:
        columns = [c["name"] for c in inspector.get_columns("storage_location")]

        if "zone_id" in columns:
            op.drop_index("ix_storage_location_zone_id", table_name="storage_location")
            op.drop_constraint("fk_storage_location_zone_id", "storage_location", type_="foreignkey")
            op.drop_column("storage_location", "zone_id")

        if "store_id" in columns:
            op.drop_index("ix_storage_location_store_id", table_name="storage_location")
            op.drop_constraint("fk_storage_location_store_id", "storage_location", type_="foreignkey")
            op.drop_column("storage_location", "store_id")
