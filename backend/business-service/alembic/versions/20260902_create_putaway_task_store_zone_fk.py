"""Add destination_store_id and destination_zone_id foreign keys to putaway_task table

Revision ID: 20260902_putaway_store_zone
Revises: 20260902_storage_loc_zone
Create Date: 2026-09-02 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260902_putaway_store_zone"
down_revision: Union[str, None] = "20260902_storage_loc_zone"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "putaway_task" in existing_tables:
        columns = [c["name"] for c in inspector.get_columns("putaway_task")]

        if "destination_store_id" not in columns:
            op.add_column(
                "putaway_task",
                sa.Column("destination_store_id", postgresql.UUID(as_uuid=True), nullable=True),
            )
            if "store" in existing_tables:
                op.create_foreign_key(
                    "fk_putaway_task_destination_store_id",
                    "putaway_task",
                    "store",
                    ["destination_store_id"],
                    ["id"],
                    ondelete="SET NULL",
                )
            op.create_index(
                "ix_putaway_task_destination_store_id",
                "putaway_task",
                ["destination_store_id"],
            )

        if "destination_zone_id" not in columns:
            op.add_column(
                "putaway_task",
                sa.Column("destination_zone_id", postgresql.UUID(as_uuid=True), nullable=True),
            )
            if "store_zone" in existing_tables:
                op.create_foreign_key(
                    "fk_putaway_task_destination_zone_id",
                    "putaway_task",
                    "store_zone",
                    ["destination_zone_id"],
                    ["id"],
                    ondelete="SET NULL",
                )
            op.create_index(
                "ix_putaway_task_destination_zone_id",
                "putaway_task",
                ["destination_zone_id"],
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "putaway_task" in existing_tables:
        columns = [c["name"] for c in inspector.get_columns("putaway_task")]

        if "destination_zone_id" in columns:
            try:
                op.drop_constraint("fk_putaway_task_destination_zone_id", "putaway_task", type_="foreignkey")
            except Exception:
                pass
            try:
                op.drop_index("ix_putaway_task_destination_zone_id", table_name="putaway_task")
            except Exception:
                pass
            op.drop_column("putaway_task", "destination_zone_id")

        if "destination_store_id" in columns:
            try:
                op.drop_constraint("fk_putaway_task_destination_store_id", "putaway_task", type_="foreignkey")
            except Exception:
                pass
            try:
                op.drop_index("ix_putaway_task_destination_store_id", table_name="putaway_task")
            except Exception:
                pass
            op.drop_column("putaway_task", "destination_store_id")
