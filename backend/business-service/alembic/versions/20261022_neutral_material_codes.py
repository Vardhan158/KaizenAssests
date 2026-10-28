"""Restore the missing neutral-material-codes revision marker.

The deployed database is already stamped with this revision, but the original
migration file was absent from the repository. Its data changes have therefore
already run; this marker reconnects that database to the migration graph.

Revision ID: 20261022_neutral_material_codes
Revises: 20261016_qc_inspector_audit, 20261021_rack_capacity, b4e9e5db57cc
"""

from collections.abc import Sequence


revision: str = "20261022_neutral_material_codes"
down_revision: tuple[str, str, str] = (
    "20261016_qc_inspector_audit",
    "20261021_rack_capacity",
    "b4e9e5db57cc",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
