"""Add shift and assembly-unit assignments to managed users.

Revision ID: 20261028_user_work_scope
Revises: 20261027_link_suppliers
"""

from alembic import op
import sqlalchemy as sa


revision = "20261028_user_work_scope"
down_revision = "20261027_link_suppliers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("store_manager_user", sa.Column("shift_name", sa.String(length=64), nullable=True))
    op.add_column("store_manager_user", sa.Column("assembly_unit_code", sa.String(length=64), nullable=True))
    op.create_index("ix_store_manager_user_shift_name", "store_manager_user", ["shift_name"])
    op.create_index("ix_store_manager_user_assembly_unit_code", "store_manager_user", ["assembly_unit_code"])


def downgrade() -> None:
    op.drop_index("ix_store_manager_user_assembly_unit_code", table_name="store_manager_user")
    op.drop_index("ix_store_manager_user_shift_name", table_name="store_manager_user")
    op.drop_column("store_manager_user", "assembly_unit_code")
    op.drop_column("store_manager_user", "shift_name")
