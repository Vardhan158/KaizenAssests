"""Repair idempotency and batch columns used by inventory ledger models.

Revision ID: 20261027_inventory_ledger
Revises: 20261027_inventory_batch
Create Date: 2026-10-27
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20261027_inventory_ledger"
down_revision: str = "20261027_inventory_batch"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _add_columns(table_name: str, definitions: tuple[tuple[str, sa.types.TypeEngine], ...]) -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if table_name not in tables:
        return
    columns = {column["name"] for column in sa.inspect(bind).get_columns(table_name)}
    for column_name, column_type in definitions:
        if column_name not in columns:
            op.add_column(table_name, sa.Column(column_name, column_type, nullable=True))


def _add_index(table_name: str, index_name: str, column_name: str, *, unique: bool = False) -> None:
    bind = op.get_bind()
    if table_name not in sa.inspect(bind).get_table_names():
        return
    indexes = {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}
    if index_name not in indexes:
        op.create_index(index_name, table_name, [column_name], unique=unique)


def upgrade() -> None:
    _add_columns(
        "putaway_movement",
        (
            ("confirmation_id", sa.String(length=64)),
            ("confirmation_hash", sa.String(length=64)),
        ),
    )
    _add_index(
        "putaway_movement",
        "ix_putaway_movement_confirmation_id",
        "confirmation_id",
        unique=True,
    )

    _add_columns(
        "inventory_issue_transaction",
        (
            ("confirmation_id", sa.String(length=64)),
            ("confirmation_hash", sa.String(length=64)),
            ("batch_number", sa.String(length=128)),
            ("source_location_id", sa.Uuid()),
        ),
    )
    _add_index(
        "inventory_issue_transaction",
        "ix_inventory_issue_transaction_confirmation_id",
        "confirmation_id",
        unique=True,
    )
    _add_index(
        "inventory_issue_transaction",
        "ix_inventory_issue_transaction_batch_number",
        "batch_number",
    )
    _add_index(
        "inventory_issue_transaction",
        "ix_inventory_issue_transaction_source_location_id",
        "source_location_id",
    )

    _add_columns(
        "inventory_movement_history",
        (
            ("confirmation_id", sa.String(length=64)),
            ("confirmation_hash", sa.String(length=64)),
        ),
    )
    _add_index(
        "inventory_movement_history",
        "ix_inventory_movement_history_confirmation_id",
        "confirmation_id",
        unique=True,
    )


def downgrade() -> None:
    # Preserve idempotency keys and audit history on downgrade.
    pass
