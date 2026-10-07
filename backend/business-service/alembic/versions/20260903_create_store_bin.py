"""Create store_bin table and add bin_id references to storage_location and putaway_task

Revision ID: 20260903_create_store_bin
Revises: 20260903_assembly_requisition
Create Date: 2026-09-03 16:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260903_create_store_bin"
down_revision: Union[str, None] = "20260903_assembly_requisition"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # 1. Create store_bin table
    if "store_bin" not in existing_tables:
        op.create_table(
            "store_bin",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("store_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("store.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("zone_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("store_zone.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("bin_code", sa.String(64), nullable=False),
            sa.Column("bin_name", sa.String(128), nullable=False),
            sa.Column("rack", sa.String(64), nullable=True),
            sa.Column("shelf", sa.String(64), nullable=True),
            sa.Column("capacity", sa.Numeric(18, 4), server_default="1000.0", nullable=False),
            sa.Column("occupied_quantity", sa.Numeric(18, 4), server_default="0.0", nullable=False),
            sa.Column("status", sa.String(32), server_default="ACTIVE", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("zone_id", "bin_code", name="uq_store_zone_bin_code"),
            sa.UniqueConstraint("store_id", "bin_code", name="uq_store_bin_code_scoped"),
        )
        op.create_index("ix_store_bin_store_id", "store_bin", ["store_id"])
        op.create_index("ix_store_bin_zone_id", "store_bin", ["zone_id"])
        op.create_index("ix_store_bin_bin_code", "store_bin", ["bin_code"])
        op.create_index("ix_store_bin_status", "store_bin", ["status"])

    # 2. Add bin_id to storage_location table if missing
    sl_cols = [c["name"] for c in inspector.get_columns("storage_location")]
    if "bin_id" not in sl_cols:
        op.add_column("storage_location", sa.Column("bin_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("store_bin.id", ondelete="SET NULL"), nullable=True))
        op.create_index("ix_storage_location_bin_id", "storage_location", ["bin_id"])

    # 3. Add destination_bin_id & destination_bin_code to putaway_task if missing
    pt_cols = [c["name"] for c in inspector.get_columns("putaway_task")]
    if "destination_bin_id" not in pt_cols:
        op.add_column("putaway_task", sa.Column("destination_bin_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("store_bin.id", ondelete="SET NULL"), nullable=True))
        op.create_index("ix_putaway_task_destination_bin_id", "putaway_task", ["destination_bin_id"])
    if "destination_bin_code" not in pt_cols:
        op.add_column("putaway_task", sa.Column("destination_bin_code", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("putaway_task", "destination_bin_code")
    op.drop_column("putaway_task", "destination_bin_id")
    op.drop_column("storage_location", "bin_id")
    op.drop_table("store_bin")
