"""add supplier primary and secondary email

Revision ID: f3a4b5c6d7e8
Revises: f2a3b4c5d6e7
Create Date: 2026-08-13 21:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename email to primary_email and add secondary_email
    op.alter_column("supplier_contact", "email", new_column_name="primary_email")
    op.add_column("supplier_contact", sa.Column("secondary_email", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("supplier_contact", "secondary_email")
    op.alter_column("supplier_contact", "primary_email", new_column_name="email")
