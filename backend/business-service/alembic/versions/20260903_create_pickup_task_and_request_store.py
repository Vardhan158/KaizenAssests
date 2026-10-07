"""Create pickup_task, inventory_issue_transaction tables and add store columns to material_request

Revision ID: 20260903_pickup_task_and_store
Revises: 20260903_quarantine_record
Create Date: 2026-09-03 08:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260903_pickup_task_and_store"
down_revision: Union[str, None] = "20260903_quarantine_record"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # 1. Add store columns to material_request
    if "material_request" in existing_tables:
        mr_cols = [c["name"] for c in inspector.get_columns("material_request")]
        if "assigned_store_id" not in mr_cols:
            op.add_column(
                "material_request",
                sa.Column("assigned_store_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("store.id", ondelete="SET NULL"), nullable=True),
            )
        if "assigned_store_code" not in mr_cols:
            op.add_column("material_request", sa.Column("assigned_store_code", sa.String(64), nullable=True))
        if "assigned_store_name" not in mr_cols:
            op.add_column("material_request", sa.Column("assigned_store_name", sa.String(256), nullable=True))
        if "assigned_by" not in mr_cols:
            op.add_column("material_request", sa.Column("assigned_by", sa.String(128), nullable=True))
        if "assigned_at" not in mr_cols:
            op.add_column("material_request", sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True))
        if "priority" not in mr_cols:
            op.add_column("material_request", sa.Column("priority", sa.String(32), server_default="MEDIUM", nullable=False))

    # 2. Create pickup_task table
    if "pickup_task" not in existing_tables:
        op.create_table(
            "pickup_task",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("task_number", sa.String(64), unique=True, nullable=False, index=True),
            sa.Column("request_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("material_request.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("request_number", sa.String(64), nullable=False, index=True),
            sa.Column("store_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("store.id", ondelete="RESTRICT"), nullable=False, index=True),
            sa.Column("store_code", sa.String(64), nullable=False, index=True),
            sa.Column("store_name", sa.String(256), nullable=False),
            sa.Column("department", sa.String(64), nullable=False, server_default="Assembly"),
            sa.Column("material_code", sa.String(64), nullable=False, index=True),
            sa.Column("material_name", sa.String(256), nullable=False),
            sa.Column("requested_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("picked_quantity", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("uom", sa.String(32), nullable=False, server_default="PCS"),
            sa.Column("priority", sa.String(32), nullable=False, server_default="MEDIUM"),
            sa.Column("required_date", sa.Date(), nullable=True),
            sa.Column("suggested_zone_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("store_zone.id", ondelete="SET NULL"), nullable=True),
            sa.Column("suggested_zone_code", sa.String(64), nullable=True),
            sa.Column("picked_zone_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("store_zone.id", ondelete="SET NULL"), nullable=True),
            sa.Column("picked_zone_code", sa.String(64), nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="ASSIGNED_TO_STORE", index=True),
            sa.Column("assigned_by", sa.String(128), nullable=False),
            sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("started_by", sa.String(128), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_by", sa.String(128), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )

    # 3. Create inventory_issue_transaction table
    if "inventory_issue_transaction" not in existing_tables:
        op.create_table(
            "inventory_issue_transaction",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("issue_number", sa.String(64), unique=True, nullable=False, index=True),
            sa.Column("request_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("material_request.id", ondelete="SET NULL"), nullable=True),
            sa.Column("request_number", sa.String(64), nullable=True),
            sa.Column("pickup_task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pickup_task.id", ondelete="SET NULL"), nullable=True),
            sa.Column("store_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("store.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("store_code", sa.String(64), nullable=False),
            sa.Column("zone_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("store_zone.id", ondelete="SET NULL"), nullable=True),
            sa.Column("zone_code", sa.String(64), nullable=True),
            sa.Column("material_code", sa.String(64), nullable=False, index=True),
            sa.Column("material_name", sa.String(256), nullable=False),
            sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(32), nullable=False, server_default="PCS"),
            sa.Column("recipient_department", sa.String(64), nullable=False, server_default="Assembly"),
            sa.Column("stock_before", sa.Numeric(18, 4), nullable=False),
            sa.Column("stock_after", sa.Numeric(18, 4), nullable=False),
            sa.Column("issued_by", sa.String(128), nullable=False),
            sa.Column("issued_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "inventory_issue_transaction" in existing_tables:
        op.drop_table("inventory_issue_transaction")
    if "pickup_task" in existing_tables:
        op.drop_table("pickup_task")
