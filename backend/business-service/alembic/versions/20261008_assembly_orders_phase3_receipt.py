"""add material_received_by and material_received_at to assembly_order for Step 2 Material Receipt

Revision ID: 20261008_assembly_phase3_rec
Revises: 20261008_assembly_phase2_bom
Create Date: 2026-10-08 11:10:00
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20261008_assembly_phase3_rec'
down_revision = '20261008_assembly_phase2_bom'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column('assembly_order', sa.Column('material_received_by', sa.String(length=128), nullable=True))
    op.add_column('assembly_order', sa.Column('material_received_at', sa.DateTime(), nullable=True))

def downgrade() -> None:
    op.drop_column('assembly_order', 'material_received_at')
    op.drop_column('assembly_order', 'material_received_by')
