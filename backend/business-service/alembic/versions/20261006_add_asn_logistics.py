"""add logistics metadata to advance shipment notices

Revision ID: 20261006_asn_logistics
Revises: 20260926_finished_goods_request, 20260930_replacement_requests
Create Date: 2026-10-06
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261006_asn_logistics"
down_revision: Union[str, Sequence[str], None] = (
    "20260926_finished_goods_request",
    "20260930_replacement_requests",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("asn")}
    if "logistics" not in columns:
        op.add_column("asn", sa.Column("logistics", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("asn")}
    if "logistics" in columns:
        op.drop_column("asn", "logistics")
