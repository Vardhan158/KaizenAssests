"""Create assembly_requisition and assembly_requisition_item tables and update pickup_task

Revision ID: 20260903_assembly_requisition
Revises: 20260903_pickup_task_and_store
Create Date: 2026-09-03 08:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260903_assembly_requisition"
down_revision: Union[str, None] = "20260903_pickup_task_and_store"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # 1. Create assembly_requisition table
    if "assembly_requisition" not in existing_tables:
        op.create_table(
            "assembly_requisition",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("requisition_number", sa.String(64), unique=True, nullable=False, index=True),
            sa.Column("warehouse_id", sa.String(64), nullable=False, server_default="Main Warehouse"),
            sa.Column("department", sa.String(64), nullable=False, server_default="Assembly"),
            sa.Column("requested_by", sa.String(128), nullable=False),
            sa.Column("priority", sa.String(32), nullable=False, server_default="MEDIUM"),
            sa.Column("required_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(32), nullable=False, server_default="PENDING", index=True),
            sa.Column("assigned_store_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("store.id", ondelete="SET NULL"), nullable=True),
            sa.Column("assigned_store_code", sa.String(64), nullable=True),
            sa.Column("assigned_store_name", sa.String(256), nullable=True),
            sa.Column("assigned_by", sa.String(128), nullable=True),
            sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )

    # 2. Create assembly_requisition_item table
    if "assembly_requisition_item" not in existing_tables:
        op.create_table(
            "assembly_requisition_item",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("requisition_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("assembly_requisition.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("material_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("material.id", ondelete="SET NULL"), nullable=True),
            sa.Column("material_variant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("material_variant.id", ondelete="SET NULL"), nullable=True),
            sa.Column("material_code", sa.String(64), nullable=False, index=True),
            sa.Column("variant_code", sa.String(128), nullable=True),
            sa.Column("material_name", sa.String(256), nullable=False),
            sa.Column("requested_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("issued_quantity", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("uom", sa.String(32), nullable=False, server_default="PCS"),
        )

    # 3. Clean test data and update pickup_task table
    if "pickup_task" in existing_tables:
        op.execute("TRUNCATE TABLE pickup_task CASCADE")
        pck_cols = [c["name"] for c in inspector.get_columns("pickup_task")]
        if "requisition_id" not in pck_cols:
            if "request_id" in pck_cols:
                op.execute("ALTER TABLE pickup_task DROP CONSTRAINT IF EXISTS pickup_task_request_id_fkey")
                op.execute("ALTER TABLE pickup_task RENAME COLUMN request_id TO requisition_id")
            else:
                op.add_column("pickup_task", sa.Column("requisition_id", postgresql.UUID(as_uuid=True), nullable=False))

            op.execute("""
                ALTER TABLE pickup_task 
                ADD CONSTRAINT pickup_task_requisition_id_fkey 
                FOREIGN KEY (requisition_id) REFERENCES assembly_requisition(id) ON DELETE CASCADE
            """)

        if "requisition_number" not in pck_cols and "request_number" in pck_cols:
            op.execute("ALTER TABLE pickup_task RENAME COLUMN request_number TO requisition_number")

    # 4. Clean test data and update inventory_issue_transaction table
    if "inventory_issue_transaction" in existing_tables:
        op.execute("TRUNCATE TABLE inventory_issue_transaction CASCADE")
        issue_cols = [c["name"] for c in inspector.get_columns("inventory_issue_transaction")]
        if "requisition_id" not in issue_cols:
            if "request_id" in issue_cols:
                op.execute("ALTER TABLE inventory_issue_transaction DROP CONSTRAINT IF EXISTS inventory_issue_transaction_request_id_fkey")
                op.execute("ALTER TABLE inventory_issue_transaction RENAME COLUMN request_id TO requisition_id")
            else:
                op.add_column("inventory_issue_transaction", sa.Column("requisition_id", postgresql.UUID(as_uuid=True), nullable=True))

            op.execute("""
                ALTER TABLE inventory_issue_transaction 
                ADD CONSTRAINT inventory_issue_transaction_requisition_id_fkey 
                FOREIGN KEY (requisition_id) REFERENCES assembly_requisition(id) ON DELETE SET NULL
            """)

        if "requisition_number" not in issue_cols and "request_number" in issue_cols:
            op.execute("ALTER TABLE inventory_issue_transaction RENAME COLUMN request_number TO requisition_number")


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "assembly_requisition_item" in existing_tables:
        op.drop_table("assembly_requisition_item")
    if "assembly_requisition" in existing_tables:
        op.drop_table("assembly_requisition")
