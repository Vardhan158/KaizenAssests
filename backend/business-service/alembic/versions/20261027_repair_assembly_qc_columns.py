"""Repair assembly quality inspection audit columns.

Revision ID: 20261027_assembly_qc
Revises: 20261016_qc_inspector_audit, 20261021_rack_capacity, b4e9e5db57cc
"""

from alembic import context, op
import sqlalchemy as sa


revision = "20261027_assembly_qc"
down_revision = (
    "20261016_qc_inspector_audit",
    "20261021_rack_capacity",
    "b4e9e5db57cc",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = set() if context.is_offline_mode() else {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("assembly_quality_inspection")
    }
    if "inspected_by_user_id" not in columns:
        op.add_column(
            "assembly_quality_inspection",
            sa.Column("inspected_by_user_id", sa.String(255), nullable=True),
        )
    if "authorized_person_confirmed" not in columns:
        op.add_column(
            "assembly_quality_inspection",
            sa.Column(
                "authorized_person_confirmed",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            ),
        )


def downgrade() -> None:
    # These columns originate in 20261016_qc_inspector_audit. This repair
    # revision must not remove schema owned by its parent migration.
    pass
