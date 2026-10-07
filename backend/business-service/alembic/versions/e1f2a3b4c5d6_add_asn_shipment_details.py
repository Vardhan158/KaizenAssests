"""add_asn_shipment_details

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-08-13 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, None] = 'd0e1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asn', sa.Column('transporter', sa.String(length=128), nullable=True))
    op.add_column('asn', sa.Column('number_of_packages', sa.Integer(), nullable=True))
    op.add_column('asn', sa.Column('package_type', sa.String(length=64), nullable=True))
    # Check if shipping_method column already exists from a previous run or manual edit
    op.add_column('asn', sa.Column('shipping_method', sa.String(length=64), nullable=True))
    op.add_column('asn', sa.Column('warehouse_id', sa.String(length=64), nullable=True))

    # Add columns to asn_line
    op.add_column('asn_line', sa.Column('material_name', sa.String(length=256), nullable=True))
    op.add_column('asn_line', sa.Column('uom', sa.String(length=64), nullable=True))

    # Create arrival_notification table
    op.create_table('arrival_notification',
        sa.Column('id', sa.String(length=128), nullable=False),
        sa.Column('asn_id', sa.UUID(), nullable=False),
        sa.Column('asn_number', sa.String(length=64), nullable=False),
        sa.Column('po_id', sa.UUID(), nullable=False),
        sa.Column('po_number', sa.String(length=64), nullable=False),
        sa.Column('warehouse_id', sa.String(length=64), nullable=False),
        sa.Column('supplier_name', sa.String(length=128), nullable=False),
        sa.Column('vehicle_number', sa.String(length=64), nullable=False),
        sa.Column('expected_arrival_time', sa.DateTime(), nullable=False),
        sa.Column('driver_phone', sa.String(length=32), nullable=True),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('recipients', sa.String(length=256), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['asn_id'], ['asn.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

    # Create asn_document table
    op.create_table('asn_document',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('asn_id', sa.UUID(), nullable=False),
        sa.Column('document_type', sa.String(length=64), nullable=False),
        sa.Column('file_name', sa.String(length=256), nullable=False),
        sa.Column('file_url', sa.String(length=512), nullable=False),
        sa.Column('uploaded_by', sa.String(length=128), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['asn_id'], ['asn.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('arrival_notification')
    op.drop_table('asn_document')
    op.drop_column('asn_line', 'uom')
    op.drop_column('asn_line', 'material_name')

    op.drop_column('asn', 'warehouse_id')
    op.drop_column('asn', 'shipping_method')
    op.drop_column('asn', 'package_type')
    op.drop_column('asn', 'number_of_packages')
    op.drop_column('asn', 'transporter')
