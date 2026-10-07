"""Restore the historical storage-location revision marker.

The storage_location.location_code column and its unique index are already
created by 20260819_gate_entry_asn_reference. Some existing databases were
stamped with this later revision before its file was lost from source control,
so this compatibility revision intentionally has no schema operations.

Revision ID: 20260821_storage_location_code
Revises: 20260820_material_issue
"""


revision = "20260821_storage_location_code"
down_revision = "20260820_material_issue"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
