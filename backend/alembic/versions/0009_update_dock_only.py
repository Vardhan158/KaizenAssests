"""update dock management to dock-only model

Revision ID: 0009_update_dock_only
Revises: 0008_init_dock_allocation
Create Date: 2026-08-31
"""
from alembic import op
import sqlalchemy as sa

revision = "0009_update_dock_only"
down_revision = "0008_init_dock_allocation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. Add dock_type to dock_masters if not existing
    if "dock_masters" in tables:
        columns = [c["name"] for c in inspector.get_columns("dock_masters")]
        if "dock_type" not in columns:
            op.add_column("dock_masters", sa.Column("dock_type", sa.String(32), nullable=False, server_default="RAW_MATERIAL"))
            op.create_index("ix_dock_masters_dock_type", "dock_masters", ["dock_type"])
        if "capacity" in columns:
            op.drop_column("dock_masters", "capacity")

    # 2. Add timestamp columns & remove assigned_bay_id from dock_allocation_requests
    if "dock_allocation_requests" in tables:
        columns = [c["name"] for c in inspector.get_columns("dock_allocation_requests")]
        if "arrived_at" not in columns:
            op.add_column("dock_allocation_requests", sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True))
        if "started_at" not in columns:
            op.add_column("dock_allocation_requests", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
        if "released_at" not in columns:
            op.add_column("dock_allocation_requests", sa.Column("released_at", sa.DateTime(timezone=True), nullable=True))
        if "assigned_bay_id" in columns:
            op.drop_column("dock_allocation_requests", "assigned_bay_id")

    # 3. Remove bay_id from dock_allocation_history if existing
    if "dock_allocation_history" in tables:
        columns = [c["name"] for c in inspector.get_columns("dock_allocation_history")]
        if "bay_id" in columns:
            op.drop_column("dock_allocation_history", "bay_id")

    # 4. Remove bay_id from dock_status_history if existing
    if "dock_status_history" in tables:
        columns = [c["name"] for c in inspector.get_columns("dock_status_history")]
        if "bay_id" in columns:
            op.drop_column("dock_status_history", "bay_id")

    # 5. Drop dock_bays table if existing
    if "dock_bays" in tables:
        op.drop_table("dock_bays")


def downgrade() -> None:
    pass
