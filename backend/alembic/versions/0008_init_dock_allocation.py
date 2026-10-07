"""init dock allocation tables

Revision ID: 0008_init_dock_allocation
Revises: 20260820_putaway_operator
Create Date: 2026-08-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0008_init_dock_allocation"
down_revision = "20260820_putaway_operator"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create dock_masters table
    op.create_table(
        "dock_masters",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("dock_code", sa.String(32), nullable=False),
        sa.Column("dock_name", sa.String(128), nullable=False),
        sa.Column("dock_type", sa.String(32), nullable=False, server_default="RAW_MATERIAL"),
        sa.Column("location", sa.String(128), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="AVAILABLE"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_dock_masters_dock_code", "dock_masters", ["dock_code"], unique=True)
    op.create_index("ix_dock_masters_dock_type", "dock_masters", ["dock_type"])
    op.create_index("ix_dock_masters_status", "dock_masters", ["status"])

    # 2. Create dock_allocation_requests table
    op.create_table(
        "dock_allocation_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("existing_gate_pass_id", sa.String(128), nullable=False),
        sa.Column("vendor_reference", sa.String(256), nullable=True),
        sa.Column("vehicle_number", sa.String(64), nullable=False),
        sa.Column("material_reference", sa.String(256), nullable=True),
        sa.Column("material_description", sa.Text(), nullable=True),
        sa.Column("quantity", sa.Numeric(18, 4), nullable=True),
        sa.Column("security_approved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("priority", sa.String(32), nullable=False, server_default="NORMAL"),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING"),
        sa.Column("assigned_dock_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dock_masters.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_by", sa.String(128), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_dock_alloc_req_gate_pass", "dock_allocation_requests", ["existing_gate_pass_id"])
    op.create_index("ix_dock_alloc_req_vehicle", "dock_allocation_requests", ["vehicle_number"])
    op.create_index("ix_dock_alloc_req_status", "dock_allocation_requests", ["status"])

    # 3. Create dock_allocation_history table
    op.create_table(
        "dock_allocation_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("allocation_request_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dock_allocation_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("dock_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dock_masters.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("previous_status", sa.String(32), nullable=True),
        sa.Column("new_status", sa.String(32), nullable=False),
        sa.Column("performed_by", sa.String(128), nullable=False),
        sa.Column("performed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True),
    )
    op.create_index("ix_dock_alloc_hist_req_id", "dock_allocation_history", ["allocation_request_id"])

    # 4. Create dock_status_history table
    op.create_table(
        "dock_status_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("dock_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dock_masters.id", ondelete="SET NULL"), nullable=True),
        sa.Column("previous_status", sa.String(32), nullable=True),
        sa.Column("new_status", sa.String(32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("changed_by", sa.String(128), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("dock_status_history")
    op.drop_index("ix_dock_alloc_hist_req_id", table_name="dock_allocation_history")
    op.drop_table("dock_allocation_history")
    op.drop_index("ix_dock_alloc_req_status", table_name="dock_allocation_requests")
    op.drop_index("ix_dock_alloc_req_vehicle", table_name="dock_allocation_requests")
    op.drop_index("ix_dock_alloc_req_gate_pass", table_name="dock_allocation_requests")
    op.drop_table("dock_allocation_requests")
    op.drop_index("ix_dock_masters_status", table_name="dock_masters")
    op.drop_index("ix_dock_masters_dock_type", table_name="dock_masters")
    op.drop_index("ix_dock_masters_dock_code", table_name="dock_masters")
    op.drop_table("dock_masters")
