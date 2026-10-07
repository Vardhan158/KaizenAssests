"""Add Finished Goods QR, Store relation, and support for FG Putaway Tasks

Revision ID: 20260923_fg_putaway_genealogy
Revises: 20260921_po_rfq_totals
Create Date: 2026-09-23 14:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260923_fg_putaway_genealogy"
down_revision: Union[str, None] = "20260921_po_rfq_totals"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. Update putaway_task: make grn_id and grn_number nullable for internal/FG putaways
    if "putaway_task" in tables:
        pt_cols = {c["name"]: c for c in inspector.get_columns("putaway_task")}
        
        # Make grn_id nullable
        if "grn_id" in pt_cols and not pt_cols["grn_id"].get("nullable", True):
            op.alter_column("putaway_task", "grn_id", nullable=True)

        # Make grn_number nullable
        if "grn_number" in pt_cols and not pt_cols["grn_number"].get("nullable", True):
            op.alter_column("putaway_task", "grn_number", nullable=True)

        # Add finished_goods_id to putaway_task if not exists
        if "finished_goods_id" not in pt_cols:
            op.add_column(
                "putaway_task",
                sa.Column("finished_goods_id", postgresql.UUID(as_uuid=True), nullable=True),
            )
            op.create_foreign_key(
                "fk_putaway_task_finished_goods_id",
                "putaway_task",
                "assembly_finished_goods",
                ["finished_goods_id"],
                ["id"],
                ondelete="SET NULL",
            )
            op.create_index(
                "ix_putaway_task_finished_goods_id",
                "putaway_task",
                ["finished_goods_id"],
                unique=False,
            )

    # 2. Update assembly_finished_goods: add qr_code, serial_number, store_id
    if "assembly_finished_goods" in tables:
        afg_cols = {c["name"]: c for c in inspector.get_columns("assembly_finished_goods")}

        if "qr_code" not in afg_cols:
            op.add_column("assembly_finished_goods", sa.Column("qr_code", sa.String(255), nullable=True))
            op.create_index("ix_assembly_finished_goods_qr_code", "assembly_finished_goods", ["qr_code"], unique=False)

        if "serial_number" not in afg_cols:
            op.add_column("assembly_finished_goods", sa.Column("serial_number", sa.String(128), nullable=True))
            op.create_index("ix_assembly_finished_goods_serial_number", "assembly_finished_goods", ["serial_number"], unique=False)

        if "store_id" not in afg_cols:
            op.add_column("assembly_finished_goods", sa.Column("store_id", postgresql.UUID(as_uuid=True), nullable=True))
            op.create_foreign_key(
                "fk_assembly_finished_goods_store_id",
                "assembly_finished_goods",
                "store",
                ["store_id"],
                ["id"],
                ondelete="SET NULL",
            )
            op.create_index("ix_assembly_finished_goods_store_id", "assembly_finished_goods", ["store_id"], unique=False)

    # 3. Update store table: add store_type column if not present
    if "store" in tables:
        store_cols = {c["name"]: c for c in inspector.get_columns("store")}
        if "store_type" not in store_cols:
            op.add_column("store", sa.Column("store_type", sa.String(64), nullable=False, server_default="RAW_MATERIAL"))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "store" in tables:
        store_cols = {c["name"]: c for c in inspector.get_columns("store")}
        if "store_type" in store_cols:
            op.drop_column("store", "store_type")

    if "assembly_finished_goods" in tables:
        afg_cols = {c["name"]: c for c in inspector.get_columns("assembly_finished_goods")}
        if "store_id" in afg_cols:
            op.drop_constraint("fk_assembly_finished_goods_store_id", "assembly_finished_goods", type_="foreignkey")
            op.drop_index("ix_assembly_finished_goods_store_id", table_name="assembly_finished_goods")
            op.drop_column("assembly_finished_goods", "store_id")
        if "serial_number" in afg_cols:
            op.drop_index("ix_assembly_finished_goods_serial_number", table_name="assembly_finished_goods")
            op.drop_column("assembly_finished_goods", "serial_number")
        if "qr_code" in afg_cols:
            op.drop_index("ix_assembly_finished_goods_qr_code", table_name="assembly_finished_goods")
            op.drop_column("assembly_finished_goods", "qr_code")

    if "putaway_task" in tables:
        pt_cols = {c["name"]: c for c in inspector.get_columns("putaway_task")}
        if "finished_goods_id" in pt_cols:
            op.drop_constraint("fk_putaway_task_finished_goods_id", "putaway_task", type_="foreignkey")
            op.drop_index("ix_putaway_task_finished_goods_id", table_name="putaway_task")
            op.drop_column("putaway_task", "finished_goods_id")
