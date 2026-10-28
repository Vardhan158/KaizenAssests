"""Repair batch-aware inventory balances on legacy databases.

Revision ID: 20261027_inventory_batch
Revises: 20261027_receiving_refs
Create Date: 2026-10-27
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20261027_inventory_batch"
down_revision: str = "20261027_receiving_refs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "inventory_location_balance" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("inventory_location_balance")}
    if "batch_number" not in columns:
        op.add_column(
            "inventory_location_balance",
            sa.Column("batch_number", sa.String(length=128), nullable=True),
        )
    op.execute(
        sa.text(
            "UPDATE inventory_location_balance SET batch_number = 'UNTRACKED' "
            "WHERE batch_number IS NULL OR batch_number = ''"
        )
    )

    inspector = sa.inspect(bind)
    constraints = {
        constraint.get("name")
        for constraint in inspector.get_unique_constraints("inventory_location_balance")
    }
    if "uq_inventory_location_material_bin" in constraints:
        op.drop_constraint(
            "uq_inventory_location_material_bin",
            "inventory_location_balance",
            type_="unique",
        )
    if "uq_inventory_location_material_bin_batch" not in constraints:
        op.create_unique_constraint(
            "uq_inventory_location_material_bin_batch",
            "inventory_location_balance",
            ["material_code", "storage_location_id", "batch_number"],
        )

    indexes = {
        index["name"] for index in sa.inspect(bind).get_indexes("inventory_location_balance")
    }
    if "ix_inventory_location_balance_batch_number" not in indexes:
        op.create_index(
            "ix_inventory_location_balance_batch_number",
            "inventory_location_balance",
            ["batch_number"],
        )
    op.alter_column(
        "inventory_location_balance",
        "batch_number",
        existing_type=sa.String(length=128),
        nullable=False,
        server_default="UNTRACKED",
    )


def downgrade() -> None:
    # Batch lineage may now contain live data, so preserve it on downgrade.
    pass
