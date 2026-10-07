"""add_supplier_users

Revision ID: a7b8c9d0e1f2
Revises: 9e3b7c8a2b5d
Create Date: 2026-08-13 10:25:00.000000
"""
from typing import Sequence, Union

from alembic import op
from app.database.base import GUID
import sqlalchemy as sa


revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, None] = '9e3b7c8a2b5d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'supplier_user',
        sa.Column('id', GUID(length=36), nullable=False),
        sa.Column('supplier_id', GUID(length=36), nullable=False),
        sa.Column('username', sa.String(length=64), nullable=False),
        sa.Column('password_hash', sa.String(length=256), nullable=False),
        sa.Column('must_change_password', sa.Boolean(), nullable=False, server_default='1'),
        sa.ForeignKeyConstraint(['supplier_id'], ['supplier.id'], name=op.f('fk_supplier_user_supplier_id_supplier'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_supplier_user')),
        sa.UniqueConstraint('supplier_id', name=op.f('uq_supplier_user_supplier_id'))
    )
    op.create_index(op.f('ix_supplier_user_username'), 'supplier_user', ['username'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_supplier_user_username'), table_name='supplier_user')
    op.drop_table('supplier_user')
