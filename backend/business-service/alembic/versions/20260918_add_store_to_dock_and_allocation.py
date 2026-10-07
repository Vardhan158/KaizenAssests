"""Add store columns to dock_masters and dock_allocation_requests.

Revision ID: 20260918_add_store_to_dock_and_allocation
Revises: 20260917_storage_grn_columns
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260918_add_store_to_dock_and_allocation"
down_revision = "20260917_storage_grn_columns"
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


def upgrade() -> None:
    if _table_exists("dock_masters"):
        if not _column_exists("dock_masters", "store_id"):
            op.add_column(
                "dock_masters",
                sa.Column(
                    "store_id",
                    postgresql.UUID(as_uuid=True),
                    sa.ForeignKey("store.id", ondelete="SET NULL"),
                    nullable=True,
                ),
            )
            op.create_index("ix_dock_masters_store_id", "dock_masters", ["store_id"])

    if _table_exists("dock_allocation_requests"):
        if not _column_exists("dock_allocation_requests", "assigned_store_id"):
            op.add_column(
                "dock_allocation_requests",
                sa.Column(
                    "assigned_store_id",
                    postgresql.UUID(as_uuid=True),
                    sa.ForeignKey("store.id", ondelete="SET NULL"),
                    nullable=True,
                ),
            )
            op.create_index("ix_dock_alloc_req_assigned_store_id", "dock_allocation_requests", ["assigned_store_id"])

        if not _column_exists("dock_allocation_requests", "assigned_store_code"):
            op.add_column(
                "dock_allocation_requests",
                sa.Column("assigned_store_code", sa.String(length=64), nullable=True),
            )
            op.create_index("ix_dock_alloc_req_assigned_store_code", "dock_allocation_requests", ["assigned_store_code"])

        if not _column_exists("dock_allocation_requests", "assigned_store_name"):
            op.add_column(
                "dock_allocation_requests",
                sa.Column("assigned_store_name", sa.String(length=128), nullable=True),
            )


def downgrade() -> None:
    if _table_exists("dock_allocation_requests"):
        if _column_exists("dock_allocation_requests", "assigned_store_name"):
            op.drop_column("dock_allocation_requests", "assigned_store_name")
        if _column_exists("dock_allocation_requests", "assigned_store_code"):
            op.drop_index("ix_dock_alloc_req_assigned_store_code", table_name="dock_allocation_requests")
            op.drop_column("dock_allocation_requests", "assigned_store_code")
        if _column_exists("dock_allocation_requests", "assigned_store_id"):
            op.drop_index("ix_dock_alloc_req_assigned_store_id", table_name="dock_allocation_requests")
            op.drop_column("dock_allocation_requests", "assigned_store_id")

    if _table_exists("dock_masters"):
        if _column_exists("dock_masters", "store_id"):
            op.drop_index("ix_dock_masters_store_id", table_name="dock_masters")
            op.drop_column("dock_masters", "store_id")
