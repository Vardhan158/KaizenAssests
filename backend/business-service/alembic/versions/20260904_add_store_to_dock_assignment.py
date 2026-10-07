"""Add assigned store columns to dock_assignment table

Revision ID: 20260904_store_dock_assign
Revises: 20260904_rm_store_mr
Create Date: 2026-09-04 13:10:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260904_store_dock_assign"
down_revision: Union[str, None] = "20260904_rm_store_mr"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "dock_assignment" in existing_tables:
        cols = [c["name"] for c in inspector.get_columns("dock_assignment")]
        if "assigned_store_id" not in cols:
            op.add_column(
                "dock_assignment",
                sa.Column(
                    "assigned_store_id",
                    postgresql.UUID(as_uuid=True),
                    sa.ForeignKey("store.id", ondelete="SET NULL"),
                    nullable=True,
                ),
            )
            op.create_index(
                "ix_dock_assignment_assigned_store_id",
                "dock_assignment",
                ["assigned_store_id"],
            )

        if "assigned_store_code" not in cols:
            op.add_column(
                "dock_assignment",
                sa.Column("assigned_store_code", sa.String(64), nullable=True),
            )
            op.create_index(
                "ix_dock_assignment_assigned_store_code",
                "dock_assignment",
                ["assigned_store_code"],
            )

        if "assigned_store_name" not in cols:
            op.add_column(
                "dock_assignment",
                sa.Column("assigned_store_name", sa.String(128), nullable=True),
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "dock_assignment" in existing_tables:
        cols = [c["name"] for c in inspector.get_columns("dock_assignment")]
        if "assigned_store_name" in cols:
            op.drop_column("dock_assignment", "assigned_store_name")
        if "assigned_store_code" in cols:
            op.drop_index("ix_dock_assignment_assigned_store_code", table_name="dock_assignment")
            op.drop_column("dock_assignment", "assigned_store_code")
        if "assigned_store_id" in cols:
            op.drop_index("ix_dock_assignment_assigned_store_id", table_name="dock_assignment")
            op.drop_constraint(
                "dock_assignment_assigned_store_id_fkey",
                "dock_assignment",
                type_="foreignkey",
            )
            op.drop_column("dock_assignment", "assigned_store_id")
