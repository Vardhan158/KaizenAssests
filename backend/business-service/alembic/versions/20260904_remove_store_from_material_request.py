"""Remove assigned_store columns from material_request table

Revision ID: 20260904_rm_store_mr
Revises: 20260903_create_store_bin
Create Date: 2026-09-04 12:45:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260904_rm_store_mr"
down_revision: Union[str, None] = "20260903_create_store_bin"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "material_request" in existing_tables:
        cols = [c["name"] for c in inspector.get_columns("material_request")]
        
        # Drop foreign key if exists
        fks = inspector.get_foreign_keys("material_request")
        for fk in fks:
            if "assigned_store_id" in fk.get("constrained_columns", []):
                op.drop_constraint(fk["name"], "material_request", type_="foreignkey")
                break
                
        if "assigned_store_id" in cols:
            op.drop_column("material_request", "assigned_store_id")
        if "assigned_store_code" in cols:
            op.drop_column("material_request", "assigned_store_code")
        if "assigned_store_name" in cols:
            op.drop_column("material_request", "assigned_store_name")
        if "assigned_by" in cols:
            op.drop_column("material_request", "assigned_by")
        if "assigned_at" in cols:
            op.drop_column("material_request", "assigned_at")


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "material_request" in existing_tables:
        cols = [c["name"] for c in inspector.get_columns("material_request")]
        if "assigned_store_id" not in cols:
            op.add_column("material_request", sa.Column("assigned_store_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("store.id", ondelete="SET NULL"), nullable=True))
        if "assigned_store_code" not in cols:
            op.add_column("material_request", sa.Column("assigned_store_code", sa.String(64), nullable=True))
        if "assigned_store_name" not in cols:
            op.add_column("material_request", sa.Column("assigned_store_name", sa.String(256), nullable=True))
        if "assigned_by" not in cols:
            op.add_column("material_request", sa.Column("assigned_by", sa.String(128), nullable=True))
        if "assigned_at" not in cols:
            op.add_column("material_request", sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True))
