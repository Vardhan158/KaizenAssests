"""add notification details

Revision ID: 246123db4a01

Revises: 20260831_ensure_mat_cols

Create Date: 2026-09-01 13:45:51.153337

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "246123db4a01"

down_revision: Union[str, None] = "20260831_ensure_mat_cols"

branch_labels: Union[str, Sequence[str], None] = None

depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    notification_cols = {
        column["name"]
        for column in inspector.get_columns("notification")
    }
    if "details" not in notification_cols:
        op.add_column(
            "notification",
            sa.Column("details", sa.JSON(), nullable=True)
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    notification_cols = {
        column["name"]
        for column in inspector.get_columns("notification")
    }

    columns_to_remove = [
        "po_number",
        "asn_number",
        "driver_phone",
        "driver_name",
        "vehicle_number",
        "gate_pass_number",
        "allocation_time",
        "warehouse_name",
        "dock_type",
        "dock_location",
        "dock_name",
        "dock_code",
    ]

    for column_name in columns_to_remove:
        if column_name in notification_cols:
            op.drop_column("notification", column_name)