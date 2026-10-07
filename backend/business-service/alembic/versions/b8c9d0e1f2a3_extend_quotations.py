"""extend_quotations

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-08-13 10:42:00.000000
"""
from typing import Sequence, Union

from alembic import op
from app.database.base import GUID
import sqlalchemy as sa


revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add columns to quotation table
    op.add_column('quotation', sa.Column('discount', sa.Numeric(precision=18, scale=4), nullable=True))
    op.add_column('quotation', sa.Column('tax', sa.Numeric(precision=18, scale=4), nullable=True))
    op.add_column('quotation', sa.Column('freight_charges', sa.Numeric(precision=18, scale=4), nullable=True))
    op.add_column('quotation', sa.Column('delivery_time', sa.String(length=128), nullable=True))
    op.add_column('quotation', sa.Column('expected_delivery_date', sa.Date(), nullable=True))
    op.add_column('quotation', sa.Column('payment_terms', sa.String(length=128), nullable=True))
    op.add_column('quotation', sa.Column('quotation_validity', sa.Date(), nullable=True))
    op.add_column('quotation', sa.Column('remarks', sa.String(length=500), nullable=True))

    # Create quotation_document table
    op.create_table(
        'quotation_document',
        sa.Column('id', GUID(length=36), nullable=False),
        sa.Column('quotation_id', GUID(length=36), nullable=False),
        sa.Column('document_type', sa.String(length=64), nullable=False),
        sa.Column('file_name', sa.String(length=256), nullable=False),
        sa.Column('file_url', sa.String(length=512), nullable=False),
        sa.ForeignKeyConstraint(['quotation_id'], ['quotation.id'], name=op.f('fk_quotation_document_quotation_id_quotation'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_quotation_document'))
    )


def downgrade() -> None:
    op.drop_table('quotation_document')
    op.drop_column('quotation', 'remarks')
    op.drop_column('quotation', 'quotation_validity')
    op.drop_column('quotation', 'payment_terms')
    op.drop_column('quotation', 'expected_delivery_date')
    op.drop_column('quotation', 'delivery_time')
    op.drop_column('quotation', 'freight_charges')
    op.drop_column('quotation', 'tax')
    op.drop_column('quotation', 'discount')
