"""Repair assembly QC audit columns on legacy databases.

Revision ID: 20261027_assembly_qc
Revises: 20261027_inventory_ledger
Create Date: 2026-10-27
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20261027_assembly_qc"
down_revision: str = "20261027_inventory_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "assembly_quality_inspection" not in inspector.get_table_names():
        return
    columns = {
        column["name"] for column in inspector.get_columns("assembly_quality_inspection")
    }
    if "inspected_by_user_id" not in columns:
        op.add_column(
            "assembly_quality_inspection",
            sa.Column("inspected_by_user_id", sa.String(length=255), nullable=True),
        )
    if "authorized_person_confirmed" not in columns:
        op.add_column(
            "assembly_quality_inspection",
            sa.Column(
                "authorized_person_confirmed",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    # Preserve QC audit data on downgrade.
    pass
