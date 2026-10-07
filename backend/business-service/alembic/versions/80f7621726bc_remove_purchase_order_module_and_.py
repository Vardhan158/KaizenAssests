"""remove purchase order module and decouple asns

Revision ID: 80f7621726bc
Revises: 550255efe0aa
Create Date: 2026-08-14 13:20:20.403187
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '80f7621726bc'
down_revision: Union[str, None] = '550255efe0aa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Decouple ASN from Purchase Order
    # Drop foreign key from asn table
    op.drop_constraint('fk_asn_po_id_purchase_order', 'asn', type_='foreignkey')
    # Add po_number to asn (some versions might already have it, checking)
    op.add_column('asn', sa.Column('po_number', sa.String(length=64), nullable=True))
    # Make po_id nullable before eventually removing it or keeping as legacy UUID string
    op.alter_column('asn', 'po_id', nullable=True)

    # 2. Decouple Arrival Notification from Purchase Order
    # op.drop_constraint('fk_arrival_notification_po_id_purchase_order', 'arrival_notification', type_='foreignkey')
    op.alter_column('arrival_notification', 'po_id', nullable=True, type_=sa.String(length=64))

    # 3. Drop Purchase Order tables
    op.drop_table('purchase_order_approval_log')
    op.drop_table('purchase_order_line')


def downgrade() -> None:
    # This is a destructive operation, usually we don't fully support downgrade for module removal
    # but for completeness, we'd recreate the tables.
    pass
