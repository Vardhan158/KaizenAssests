"""Ensure finished_goods_request table and BOM attachment columns exist.

Revision ID: 20260926_finished_goods_request
Revises: 20260925_init_dispatch
Create Date: 2026-09-26 10:00:00.000000

"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260926_finished_goods_request"
down_revision = "20260925_init_dispatch"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "finished_goods_request" not in tables:
        op.create_table(
            "finished_goods_request",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("request_number", sa.String(64), nullable=False, unique=True, index=True),
            sa.Column("warehouse_id", sa.String(64), nullable=False, server_default="MAIN"),
            sa.Column("finished_goods_code", sa.String(64), nullable=True),
            sa.Column("finished_goods_name", sa.String(255), nullable=False),
            sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(32), nullable=False, server_default="PCS"),
            sa.Column("required_date", sa.Date(), nullable=False),
            sa.Column("requested_by", sa.String(128), nullable=False),
            sa.Column("status", sa.String(32), nullable=False, server_default="SENT_TO_ASSEMBLY"),
            sa.Column("bom_attachment_url", sa.String(512), nullable=True),
            sa.Column("bom_attachment_name", sa.String(256), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        )
    else:
        existing_cols = {c["name"] for c in inspector.get_columns("finished_goods_request")}
        if "bom_attachment_url" not in existing_cols:
            op.add_column("finished_goods_request", sa.Column("bom_attachment_url", sa.String(512), nullable=True))
        if "bom_attachment_name" not in existing_cols:
            op.add_column("finished_goods_request", sa.Column("bom_attachment_name", sa.String(256), nullable=True))
        if "finished_goods_code" not in existing_cols:
            op.add_column("finished_goods_request", sa.Column("finished_goods_code", sa.String(64), nullable=True))


def downgrade() -> None:
    pass
