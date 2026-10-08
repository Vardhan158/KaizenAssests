"""add bom_id and bom_number to assembly_order for Phase 2 BOM reference preservation

Revision ID: 20261008_assembly_orders_phase2_bom
Revises: 20261007_assembly_orders_phase1
Create Date: 2026-10-08 10:35:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20261008_assembly_phase2_bom'
down_revision = '20261007_assembly_orders_phase1'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Add bom_id and bom_number to assembly_order table
    op.add_column('assembly_order', sa.Column('bom_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('bill_of_materials.id', ondelete='SET NULL'), nullable=True))
    op.add_column('assembly_order', sa.Column('bom_number', sa.String(length=64), nullable=True))
    op.create_index('ix_assembly_order_bom_id', 'assembly_order', ['bom_id'], unique=False)
    op.create_index('ix_assembly_order_bom_number', 'assembly_order', ['bom_number'], unique=False)

def downgrade() -> None:
    op.drop_index('ix_assembly_order_bom_number', table_name='assembly_order')
    op.drop_index('ix_assembly_order_bom_id', table_name='assembly_order')
    op.drop_column('assembly_order', 'bom_number')
    op.drop_column('assembly_order', 'bom_id')
