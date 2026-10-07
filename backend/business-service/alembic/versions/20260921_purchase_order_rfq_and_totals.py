"""Add rfq_id, total_amount, warehouse_id, and updated_at to purchase_order table.

Revision ID: 20260921_po_rfq_totals
Revises: 20260920_dock_sm_move_hist
Create Date: 2026-09-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260921_po_rfq_totals"
down_revision: Union[str, None] = "20260920_dock_sm_move_hist"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def _column_exists(table_name: str, column_name: str) -> bool:
    return any(c["name"] == column_name for c in _inspector().get_columns(table_name))


def _index_exists(table_name: str, index_name: str) -> bool:
    return any(ix["name"] == index_name for ix in _inspector().get_indexes(table_name))


def upgrade() -> None:
    # 1. Add rfq_id to purchase_order
    if not _column_exists("purchase_order", "rfq_id"):
        op.add_column(
            "purchase_order",
            sa.Column(
                "rfq_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("rfq.id", name=op.f("fk_purchase_order_rfq_id_rfq")),
                nullable=True,
            ),
        )

    if not _index_exists("purchase_order", "ix_purchase_order_rfq_id"):
        op.create_index(
            "ix_purchase_order_rfq_id",
            "purchase_order",
            ["rfq_id"],
            unique=False,
        )

    # 2. Add total_amount to purchase_order
    if not _column_exists("purchase_order", "total_amount"):
        op.add_column(
            "purchase_order",
            sa.Column(
                "total_amount",
                sa.Numeric(precision=18, scale=4),
                nullable=False,
                server_default="0.0",
            ),
        )
        # Backfill existing rows if any
        if _column_exists("purchase_order", "subtotal"):
            op.execute(
                """
                UPDATE purchase_order
                SET total_amount = COALESCE(subtotal, 0.0) - COALESCE(discount_amount, 0.0) + COALESCE(tax_amount, 0.0) + COALESCE(freight_charges, 0.0) + COALESCE(additional_charges, 0.0)
                WHERE total_amount = 0.0 AND subtotal IS NOT NULL
                """
            )

    # 3. Add warehouse_id to purchase_order
    if not _column_exists("purchase_order", "warehouse_id"):
        op.add_column(
            "purchase_order",
            sa.Column("warehouse_id", sa.String(length=64), nullable=True),
        )
        # Backfill warehouse_id from delivery_warehouse_name or delivery_warehouse if available
        if _column_exists("purchase_order", "delivery_warehouse_name") and _column_exists("purchase_order", "delivery_warehouse"):
            op.execute(
                """
                UPDATE purchase_order
                SET warehouse_id = COALESCE(delivery_warehouse_name, delivery_warehouse)
                WHERE warehouse_id IS NULL
                """
            )
        elif _column_exists("purchase_order", "delivery_warehouse"):
            op.execute(
                """
                UPDATE purchase_order
                SET warehouse_id = delivery_warehouse
                WHERE warehouse_id IS NULL
                """
            )
        elif _column_exists("purchase_order", "delivery_warehouse_name"):
            op.execute(
                """
                UPDATE purchase_order
                SET warehouse_id = delivery_warehouse_name
                WHERE warehouse_id IS NULL
                """
            )

    # 4. Add updated_at to purchase_order
    if not _column_exists("purchase_order", "updated_at"):
        op.add_column(
            "purchase_order",
            sa.Column(
                "updated_at",
                sa.DateTime(),
                nullable=True,
                server_default=sa.func.now(),
            ),
        )


def downgrade() -> None:
    if _index_exists("purchase_order", "ix_purchase_order_rfq_id"):
        op.drop_index("ix_purchase_order_rfq_id", table_name="purchase_order")

    if _column_exists("purchase_order", "updated_at"):
        op.drop_column("purchase_order", "updated_at")

    if _column_exists("purchase_order", "warehouse_id"):
        op.drop_column("purchase_order", "warehouse_id")

    if _column_exists("purchase_order", "total_amount"):
        op.drop_column("purchase_order", "total_amount")

    if _column_exists("purchase_order", "rfq_id"):
        op.drop_column("purchase_order", "rfq_id")
