"""Link gate entries to their source ASN.

Revision ID: 20260819_gate_asn
Revises: 20260819_gate

This version is reconciliation-safe for development databases where some
tables/columns may already have been created outside Alembic.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "20260819_gate_asn"
down_revision = "20260819_gate"
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _inspector():
    return sa.inspect(op.get_bind())


def _table_exists(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _column_exists(table_name: str, column_name: str) -> bool:
    if not _table_exists(table_name):
        return False

    return any(
        column["name"] == column_name
        for column in _inspector().get_columns(table_name)
    )


def _index_exists(table_name: str, index_name: str) -> bool:
    if not _table_exists(table_name):
        return False

    return any(
        index.get("name") == index_name
        for index in _inspector().get_indexes(table_name)
    )


def _foreign_key_exists(
    table_name: str,
    constrained_columns: list[str],
    referred_table: str,
) -> bool:
    if not _table_exists(table_name):
        return False

    expected_columns = tuple(constrained_columns)

    for foreign_key in _inspector().get_foreign_keys(table_name):
        columns = tuple(foreign_key.get("constrained_columns") or [])
        target = foreign_key.get("referred_table")

        if columns == expected_columns and target == referred_table:
            return True

    return False


def _require_columns(table_name: str, required_columns: set[str]) -> None:
    """Fail clearly instead of silently using an incompatible existing table."""

    if not _table_exists(table_name):
        raise RuntimeError(f"Required table {table_name!r} does not exist.")

    existing_columns = {
        column["name"]
        for column in _inspector().get_columns(table_name)
    }

    missing = required_columns - existing_columns

    if missing:
        raise RuntimeError(
            f"Existing table {table_name!r} has an incompatible schema. "
            f"Missing columns: {', '.join(sorted(missing))}"
        )


def _insert_if_missing(
    table_name: str,
    key_column: str,
    key_value,
    values: dict,
) -> None:
    """Insert a seed row only when its business key is not already present."""

    bind = op.get_bind()

    exists = bind.execute(
        sa.text(
            f'SELECT 1 FROM "{table_name}" '
            f'WHERE "{key_column}" = :key_value LIMIT 1'
        ),
        {"key_value": key_value},
    ).first()

    if exists:
        return

    columns = list(values.keys())
    column_sql = ", ".join(f'"{column}"' for column in columns)
    value_sql = ", ".join(f":{column}" for column in columns)

    bind.execute(
        sa.text(
            f'INSERT INTO "{table_name}" ({column_sql}) '
            f"VALUES ({value_sql})"
        ),
        values,
    )


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:
    now = datetime.now(timezone.utc)

    # =======================================================================
    # 1. WAREHOUSE DOCK
    # =======================================================================

    if not _table_exists("warehouse_dock"):
        op.create_table(
            "warehouse_dock",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("dock_number", sa.String(length=32), nullable=False),
            sa.Column("warehouse_id", sa.String(length=64), nullable=False),
            sa.Column("dock_type", sa.String(length=64), nullable=False),
            sa.Column("capacity", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "dock_number",
                name="uq_warehouse_dock_dock_number",
            ),
        )

    _require_columns(
        "warehouse_dock",
        {
            "id",
            "dock_number",
            "warehouse_id",
            "dock_type",
            "capacity",
            "status",
            "created_at",
            "updated_at",
        },
    )

    if not _index_exists(
        "warehouse_dock",
        "ix_warehouse_dock_dock_number",
    ):
        op.create_index(
            "ix_warehouse_dock_dock_number",
            "warehouse_dock",
            ["dock_number"],
            unique=True,
        )

    if not _index_exists(
        "warehouse_dock",
        "ix_warehouse_dock_warehouse_id",
    ):
        op.create_index(
            "ix_warehouse_dock_warehouse_id",
            "warehouse_dock",
            ["warehouse_id"],
        )

    if not _index_exists(
        "warehouse_dock",
        "ix_warehouse_dock_status",
    ):
        op.create_index(
            "ix_warehouse_dock_status",
            "warehouse_dock",
            ["status"],
        )

    default_docks = [
        {
            "id": uuid.uuid4(),
            "dock_number": "DOCK-01",
            "warehouse_id": "WH-PUNE-01",
            "dock_type": "GENERAL",
            "capacity": 20,
            "status": "AVAILABLE",
            "created_at": now,
            "updated_at": now,
        },
        {
            "id": uuid.uuid4(),
            "dock_number": "DOCK-02",
            "warehouse_id": "WH-PUNE-01",
            "dock_type": "PALLETISED",
            "capacity": 30,
            "status": "OCCUPIED",
            "created_at": now,
            "updated_at": now,
        },
        {
            "id": uuid.uuid4(),
            "dock_number": "DOCK-03",
            "warehouse_id": "WH-PUNE-01",
            "dock_type": "GENERAL",
            "capacity": 20,
            "status": "AVAILABLE",
            "created_at": now,
            "updated_at": now,
        },
        {
            "id": uuid.uuid4(),
            "dock_number": "DOCK-04",
            "warehouse_id": "WH-PUNE-01",
            "dock_type": "HEAVY_VEHICLE",
            "capacity": 40,
            "status": "MAINTENANCE",
            "created_at": now,
            "updated_at": now,
        },
    ]

    for dock in default_docks:
        _insert_if_missing(
            "warehouse_dock",
            "dock_number",
            dock["dock_number"],
            dock,
        )

    # =======================================================================
    # 2. GATE ENTRY
    # =======================================================================

    if not _column_exists("gate_entry", "asn_id"):
        op.add_column(
            "gate_entry",
            sa.Column("asn_id", sa.UUID(), nullable=True),
        )

    if not _column_exists("gate_entry", "assigned_dock_id"):
        op.add_column(
            "gate_entry",
            sa.Column(
                "assigned_dock_id",
                sa.String(length=32),
                nullable=True,
            ),
        )

    if not _foreign_key_exists(
        "gate_entry",
        ["asn_id"],
        "asn",
    ):
        op.create_foreign_key(
            "fk_gate_entry_asn_id",
            "gate_entry",
            "asn",
            ["asn_id"],
            ["id"],
            ondelete="RESTRICT",
        )

    if not _index_exists("gate_entry", "ix_gate_entry_asn_id"):
        op.create_index(
            "ix_gate_entry_asn_id",
            "gate_entry",
            ["asn_id"],
        )

    if not _index_exists(
        "gate_entry",
        "ix_gate_entry_assigned_dock_id",
    ):
        op.create_index(
            "ix_gate_entry_assigned_dock_id",
            "gate_entry",
            ["assigned_dock_id"],
        )

    op.execute(
        """
        UPDATE gate_entry
        SET status = 'AWAITING_DOCK'
        WHERE status = 'GATE_ENTRY_APPROVED'
        """
    )

    # =======================================================================
    # 3. DOCK ASSIGNMENT
    # =======================================================================

    if not _table_exists("dock_assignment"):
        op.create_table(
            "dock_assignment",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("gate_entry_id", sa.UUID(), nullable=False),
            sa.Column("asn_id", sa.UUID(), nullable=False),
            sa.Column("po_id", sa.UUID(), nullable=False),
            sa.Column("vehicle_number", sa.String(length=32), nullable=False),
            sa.Column("dock_number", sa.String(length=32), nullable=False),
            sa.Column("assigned_by", sa.String(length=128), nullable=False),
            sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("movement_started_by", sa.String(length=128), nullable=True),
            sa.Column("movement_started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("dock_checked_in_by", sa.String(length=128), nullable=True),
            sa.Column("dock_arrival_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("unloading_started_by", sa.String(length=128), nullable=True),
            sa.Column("unloading_started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("quality_inspected_by", sa.String(length=128), nullable=True),
            sa.Column("quality_inspected_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("quality_decision", sa.String(length=16), nullable=True),
            sa.Column("quality_notes", sa.Text(), nullable=True),
            sa.Column("prepared_grn_id", sa.UUID(), nullable=True),
            sa.Column("receiving_completed_by", sa.String(length=128), nullable=True),
            sa.Column("receiving_completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("dock_released_by", sa.String(length=128), nullable=True),
            sa.Column("dock_released_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["gate_entry_id"],
                ["gate_entry.id"],
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["asn_id"],
                ["asn.id"],
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["po_id"],
                ["purchase_order.id"],
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["dock_number"],
                ["warehouse_dock.dock_number"],
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["prepared_grn_id"],
                ["grn.id"],
                ondelete="RESTRICT",
            ),
            sa.UniqueConstraint("gate_entry_id"),
            sa.UniqueConstraint("prepared_grn_id"),
        )

    if not _index_exists(
        "dock_assignment",
        "ix_dock_assignment_gate_entry_id",
    ):
        op.create_index(
            "ix_dock_assignment_gate_entry_id",
            "dock_assignment",
            ["gate_entry_id"],
            unique=True,
        )

    if not _index_exists(
        "dock_assignment",
        "ix_dock_assignment_asn_id",
    ):
        op.create_index(
            "ix_dock_assignment_asn_id",
            "dock_assignment",
            ["asn_id"],
        )

    if not _index_exists(
        "dock_assignment",
        "ix_dock_assignment_po_id",
    ):
        op.create_index(
            "ix_dock_assignment_po_id",
            "dock_assignment",
            ["po_id"],
        )

    if not _index_exists(
        "dock_assignment",
        "ix_dock_assignment_dock_number",
    ):
        op.create_index(
            "ix_dock_assignment_dock_number",
            "dock_assignment",
            ["dock_number"],
        )

    # =======================================================================
    # 4. RECEIVING LINE
    # =======================================================================

    if not _table_exists("receiving_line"):
        op.create_table(
            "receiving_line",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("dock_assignment_id", sa.UUID(), nullable=False),
            sa.Column("item_code", sa.String(length=64), nullable=False),
            sa.Column("material_name", sa.String(length=256), nullable=True),
            sa.Column("uom", sa.String(length=32), nullable=True),
            sa.Column("ordered_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("shipped_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("received_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("verification_status", sa.String(length=16), nullable=False),
            sa.Column("exception_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("good_quantity", sa.Numeric(18, 4), nullable=True),
            sa.Column("damaged_quantity", sa.Numeric(18, 4), nullable=True),
            sa.Column("rejected_quantity", sa.Numeric(18, 4), nullable=True),
            sa.Column("condition_result", sa.String(length=32), nullable=True),
            sa.Column(
                "inspection_required",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column("condition_notes", sa.Text(), nullable=True),
            sa.Column("condition_checked_by", sa.String(length=128), nullable=True),
            sa.Column("condition_checked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("recorded_by", sa.String(length=128), nullable=False),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["dock_assignment_id"],
                ["dock_assignment.id"],
                ondelete="CASCADE",
            ),
            sa.UniqueConstraint(
                "dock_assignment_id",
                "item_code",
                name="uq_receiving_line_assignment_item",
            ),
        )

    if not _index_exists(
        "receiving_line",
        "ix_receiving_line_dock_assignment_id",
    ):
        op.create_index(
            "ix_receiving_line_dock_assignment_id",
            "receiving_line",
            ["dock_assignment_id"],
        )

    # =======================================================================
    # 5. QUANTITY VERIFICATION POLICY
    # =======================================================================

    if not _table_exists("quantity_verification_policy"):
        op.create_table(
            "quantity_verification_policy",
            sa.Column("policy_key", sa.String(length=32), primary_key=True),
            sa.Column("shortage_tolerance", sa.Numeric(18, 4), nullable=False),
            sa.Column("excess_tolerance", sa.Numeric(18, 4), nullable=False),
            sa.Column("updated_by", sa.String(length=128), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )

    _insert_if_missing(
        "quantity_verification_policy",
        "policy_key",
        "DEFAULT",
        {
            "policy_key": "DEFAULT",
            "shortage_tolerance": 0,
            "excess_tolerance": 0,
            "updated_by": "SYSTEM",
            "updated_at": now,
        },
    )

    # =======================================================================
    # 6. GRN HEADER COLUMNS
    #
    # NOTE:
    # grn.dock_number is a plain String column.
    # It is NOT linked to dock_assignment and can be entered manually in GRN.
    # =======================================================================

    grn_columns = [
        ("grn_number", sa.Column("grn_number", sa.String(length=64), nullable=True)),
        ("asn_id", sa.Column("asn_id", sa.UUID(), nullable=True)),
        ("asn_number", sa.Column("asn_number", sa.String(length=64), nullable=True)),
        ("supplier_name", sa.Column("supplier_name", sa.String(length=255), nullable=True)),
        ("vehicle_number", sa.Column("vehicle_number", sa.String(length=64), nullable=True)),
        ("warehouse_id", sa.Column("warehouse_id", sa.String(length=64), nullable=True)),
        ("dock_number", sa.Column("dock_number", sa.String(length=32), nullable=True)),
        ("posted_by", sa.Column("posted_by", sa.String(length=128), nullable=True)),
        ("posted_at", sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True)),
        ("verification_notes", sa.Column("verification_notes", sa.Text(), nullable=True)),
    ]

    for column_name, column in grn_columns:
        if not _column_exists("grn", column_name):
            op.add_column("grn", column)

    if not _index_exists("grn", "ix_grn_grn_number"):
        op.create_index(
            "ix_grn_grn_number",
            "grn",
            ["grn_number"],
            unique=True,
        )

    # =======================================================================
    # 7. GRN LINE COLUMNS
    # =======================================================================

    grn_line_columns = [
        (
            "accepted_quantity",
            sa.Column("accepted_quantity", sa.Numeric(18, 4), nullable=True),
        ),
        (
            "damaged_quantity",
            sa.Column("damaged_quantity", sa.Numeric(18, 4), nullable=True),
        ),
        (
            "material_name",
            sa.Column("material_name", sa.String(length=256), nullable=True),
        ),
        (
            "uom",
            sa.Column("uom", sa.String(length=32), nullable=True),
        ),
        (
            "rejected_quantity",
            sa.Column("rejected_quantity", sa.Numeric(18, 4), nullable=True),
        ),
        (
            "quality_result",
            sa.Column("quality_result", sa.String(length=32), nullable=True),
        ),
    ]

    for column_name, column in grn_line_columns:
        if not _column_exists("grn_line", column_name):
            op.add_column("grn_line", column)

    # =======================================================================
    # 8. INVENTORY RECEIPT POSTING
    # =======================================================================

    if not _table_exists("inventory_receipt_posting"):
        op.create_table(
            "inventory_receipt_posting",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("grn_id", sa.UUID(), nullable=False),
            sa.Column("grn_number", sa.String(length=64), nullable=False),
            sa.Column("po_id", sa.UUID(), nullable=False),
            sa.Column("po_number", sa.String(length=64), nullable=False),
            sa.Column("asn_id", sa.UUID(), nullable=False),
            sa.Column("asn_number", sa.String(length=64), nullable=False),
            sa.Column("supplier_name", sa.String(length=255), nullable=False),
            sa.Column("item_code", sa.String(length=64), nullable=False),
            sa.Column("material_name", sa.String(length=256), nullable=False),
            sa.Column("uom", sa.String(length=32), nullable=False),
            sa.Column("warehouse_id", sa.String(length=64), nullable=False),
            sa.Column("posted_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("on_hand_before", sa.Numeric(18, 4), nullable=False),
            sa.Column("on_hand_after", sa.Numeric(18, 4), nullable=False),
            sa.Column("posted_by", sa.String(length=128), nullable=False),
            sa.Column("posted_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["grn_id"],
                ["grn.id"],
                ondelete="RESTRICT",
            ),
            sa.UniqueConstraint(
                "grn_id",
                "item_code",
                name="uq_inventory_posting_grn_item",
            ),
        )

    if not _index_exists(
        "inventory_receipt_posting",
        "ix_inventory_receipt_posting_grn_id",
    ):
        op.create_index(
            "ix_inventory_receipt_posting_grn_id",
            "inventory_receipt_posting",
            ["grn_id"],
        )

    # =======================================================================
    # =======================================================================
    # 9. STORAGE LOCATION
    #
    # Reconcile an older storage_location table with the current
    # StorageLocationModel.
    # =======================================================================

    storage_location_created_now = False

    if not _table_exists("storage_location"):
        op.create_table(
            "storage_location",

            sa.Column(
                "id",
                sa.UUID(),
                primary_key=True,
            ),

            sa.Column(
                "location_code",
                sa.String(length=64),
                nullable=False,
            ),

            sa.Column(
                "warehouse_id",
                sa.String(length=64),
                nullable=False,
            ),

            sa.Column(
                "zone",
                sa.String(length=128),
                nullable=False,
            ),

            sa.Column(
                "rack",
                sa.String(length=64),
                nullable=False,
            ),

            sa.Column(
                "bin",
                sa.String(length=64),
                nullable=False,
            ),

            sa.Column(
                "capacity",
                sa.Numeric(18, 4),
                nullable=False,
            ),

            sa.Column(
                "occupied_quantity",
                sa.Numeric(18, 4),
                nullable=False,
                server_default="0",
            ),

            sa.Column(
                "active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),

            sa.UniqueConstraint(
                "location_code",
                name="uq_storage_location_location_code",
            ),

            sa.UniqueConstraint(
                "warehouse_id",
                "zone",
                "rack",
                "bin",
                name="uq_storage_location_path",
            ),
        )

        storage_location_created_now = True

    else:
        # ---------------------------------------------------------------
        # Existing table found.
        #
        # Verify that the important old columns exist before changing it.
        # ---------------------------------------------------------------

        _require_columns(
            "storage_location",
            {
                "id",
                "warehouse_id",
                "zone",
                "rack",
                "bin",
                "capacity",
                "occupied_quantity",
            },
        )

        # ---------------------------------------------------------------
        # Add location_code if the old table does not contain it.
        #
        # Add it nullable first because existing rows need a value.
        # ---------------------------------------------------------------

        if not _column_exists(
            "storage_location",
            "location_code",
        ):
            op.add_column(
                "storage_location",
                sa.Column(
                    "location_code",
                    sa.String(length=64),
                    nullable=True,
                ),
            )

            # -----------------------------------------------------------
            # Give every existing row a guaranteed unique location code.
            #
            # Example:
            # LEGACY-a8e942...
            #
            # This avoids deleting or overwriting existing storage data.
            # -----------------------------------------------------------

            op.execute(
                """
                UPDATE storage_location
                SET location_code =
                    'LEGACY-' ||
                    REPLACE(id::text, '-', '')
                WHERE location_code IS NULL
                """
            )

            # Now existing records have values, so make it NOT NULL.
            op.alter_column(
                "storage_location",
                "location_code",
                existing_type=sa.String(length=64),
                nullable=False,
            )

        # ---------------------------------------------------------------
        # Add active if the old table does not contain it.
        # ---------------------------------------------------------------

        if not _column_exists(
            "storage_location",
            "active",
        ):
            op.add_column(
                "storage_location",
                sa.Column(
                    "active",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                ),
            )

    # ===================================================================
    # STORAGE LOCATION INDEXES
    # ===================================================================

    if not _index_exists(
        "storage_location",
        "ix_storage_location_location_code",
    ):
        op.create_index(
            "ix_storage_location_location_code",
            "storage_location",
            ["location_code"],
            unique=True,
        )

    if not _index_exists(
        "storage_location",
        "ix_storage_location_warehouse_id",
    ):
        op.create_index(
            "ix_storage_location_warehouse_id",
            "storage_location",
            ["warehouse_id"],
        )

    # ===================================================================
    # DEFAULT STORAGE LOCATIONS
    #
    # Seed only when this migration created a brand-new table.
    #
    # If an older storage_location table already existed, preserve its
    # existing data and do not insert rows because the legacy table might
    # contain additional required columns.
    # ===================================================================

    if storage_location_created_now:

        default_locations = [
            {
                "id": uuid.uuid4(),
                "location_code": "WH-01-RM-A-05",
                "warehouse_id": "WH-01",
                "zone": "Raw Material Zone",
                "rack": "Rack A",
                "bin": "Bin 05",
                "capacity": 10000,
                "occupied_quantity": 0,
                "active": True,
            },
            {
                "id": uuid.uuid4(),
                "location_code": "WH-01-RM-A-06",
                "warehouse_id": "WH-01",
                "zone": "Raw Material Zone",
                "rack": "Rack A",
                "bin": "Bin 06",
                "capacity": 10000,
                "occupied_quantity": 0,
                "active": True,
            },
            {
                "id": uuid.uuid4(),
                "location_code": "WH-PUNE-01-RM-A-05",
                "warehouse_id": "WH-PUNE-01",
                "zone": "Raw Material Zone",
                "rack": "Rack A",
                "bin": "Bin 05",
                "capacity": 10000,
                "occupied_quantity": 0,
                "active": True,
            },
            {
                "id": uuid.uuid4(),
                "location_code": "WH-PUNE-01-RM-B-01",
                "warehouse_id": "WH-PUNE-01",
                "zone": "Raw Material Zone",
                "rack": "Rack B",
                "bin": "Bin 01",
                "capacity": 20000,
                "occupied_quantity": 0,
                "active": True,
            },
        ]

        for location in default_locations:
            _insert_if_missing(
                "storage_location",
                "location_code",
                location["location_code"],
                location,
            )

    # =======================================================================
    # 10. PUTAWAY TASK
    # =======================================================================

    if not _table_exists("putaway_task"):
        op.create_table(
            "putaway_task",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("task_number", sa.String(length=64), nullable=False),
            sa.Column("grn_id", sa.UUID(), nullable=False),
            sa.Column("grn_number", sa.String(length=64), nullable=False),
            sa.Column("item_code", sa.String(length=64), nullable=False),
            sa.Column("material_name", sa.String(length=256), nullable=False),
            sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(length=32), nullable=False),
            sa.Column("warehouse_id", sa.String(length=64), nullable=False),
            sa.Column("source_location", sa.String(length=64), nullable=False),
            sa.Column("destination_location_id", sa.UUID(), nullable=True),
            sa.Column("destination_zone", sa.String(length=128), nullable=True),
            sa.Column("destination_rack", sa.String(length=64), nullable=True),
            sa.Column("destination_bin", sa.String(length=64), nullable=True),
            sa.Column("location_assigned_by", sa.String(length=128), nullable=True),
            sa.Column("location_assigned_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("started_by", sa.String(length=128), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_by", sa.String(length=128), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", sa.String(length=128), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["grn_id"],
                ["grn.id"],
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["destination_location_id"],
                ["storage_location.id"],
                ondelete="RESTRICT",
            ),
            sa.UniqueConstraint("task_number"),
            sa.UniqueConstraint(
                "grn_id",
                "item_code",
                name="uq_putaway_task_grn_item",
            ),
        )

    for index_name, columns, unique in [
        ("ix_putaway_task_task_number", ["task_number"], True),
        ("ix_putaway_task_grn_id", ["grn_id"], False),
        ("ix_putaway_task_status", ["status"], False),
        (
            "ix_putaway_task_destination_location_id",
            ["destination_location_id"],
            False,
        ),
    ]:
        if not _index_exists("putaway_task", index_name):
            op.create_index(
                index_name,
                "putaway_task",
                columns,
                unique=unique,
            )

    # =======================================================================
    # 11. PUTAWAY MOVEMENT
    # =======================================================================

    if not _table_exists("putaway_movement"):
        op.create_table(
            "putaway_movement",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("putaway_task_id", sa.UUID(), nullable=False),
            sa.Column("material_scan", sa.String(length=64), nullable=False),
            sa.Column("location_scan", sa.String(length=64), nullable=False),
            sa.Column("confirmed_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(length=32), nullable=False),
            sa.Column("inventory_available_before", sa.Numeric(18, 4), nullable=False),
            sa.Column("inventory_available_after", sa.Numeric(18, 4), nullable=False),
            sa.Column("confirmed_by", sa.String(length=128), nullable=False),
            sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["putaway_task_id"],
                ["putaway_task.id"],
                ondelete="RESTRICT",
            ),
            sa.UniqueConstraint("putaway_task_id"),
        )

    if not _index_exists(
        "putaway_movement",
        "ix_putaway_movement_putaway_task_id",
    ):
        op.create_index(
            "ix_putaway_movement_putaway_task_id",
            "putaway_movement",
            ["putaway_task_id"],
            unique=True,
        )

    # =======================================================================
    # 12. INVENTORY LOCATION BALANCE
    # =======================================================================

    if not _table_exists("inventory_location_balance"):
        op.create_table(
            "inventory_location_balance",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("material_code", sa.String(length=64), nullable=False),
            sa.Column("material_name", sa.String(length=256), nullable=False),
            sa.Column("warehouse_id", sa.String(length=64), nullable=False),
            sa.Column("storage_location_id", sa.UUID(), nullable=False),
            sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("available_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(length=32), nullable=False),
            sa.Column("last_putaway_task_id", sa.UUID(), nullable=False),
            sa.Column("last_grn_number", sa.String(length=64), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["storage_location_id"],
                ["storage_location.id"],
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["last_putaway_task_id"],
                ["putaway_task.id"],
                ondelete="RESTRICT",
            ),
            sa.UniqueConstraint(
                "material_code",
                "storage_location_id",
                name="uq_inventory_location_material_bin",
            ),
        )

    for index_name, columns in [
        (
            "ix_inventory_location_balance_material_code",
            ["material_code"],
        ),
        (
            "ix_inventory_location_balance_warehouse_id",
            ["warehouse_id"],
        ),
        (
            "ix_inventory_location_balance_storage_location_id",
            ["storage_location_id"],
        ),
    ]:
        if not _index_exists(
            "inventory_location_balance",
            index_name,
        ):
            op.create_index(
                index_name,
                "inventory_location_balance",
                columns,
            )

    # =======================================================================
    # 13. VEHICLE EXIT APPROVAL
    # =======================================================================

    if not _table_exists("vehicle_exit_approval"):
        op.create_table(
            "vehicle_exit_approval",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("gate_entry_id", sa.UUID(), nullable=False),
            sa.Column("dock_assignment_id", sa.UUID(), nullable=False),
            sa.Column("asn_id", sa.UUID(), nullable=False),
            sa.Column("po_id", sa.UUID(), nullable=False),
            sa.Column("grn_id", sa.UUID(), nullable=False),
            sa.Column("vehicle_number", sa.String(length=32), nullable=False),
            sa.Column("driver_name", sa.String(length=128), nullable=False),
            sa.Column("exit_document_reference", sa.String(length=128), nullable=False),
            sa.Column("approved_by", sa.String(length=128), nullable=False),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["gate_entry_id"],
                ["gate_entry.id"],
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["dock_assignment_id"],
                ["dock_assignment.id"],
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["asn_id"],
                ["asn.id"],
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["po_id"],
                ["purchase_order.id"],
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["grn_id"],
                ["grn.id"],
                ondelete="RESTRICT",
            ),
            sa.UniqueConstraint("gate_entry_id"),
            sa.UniqueConstraint("dock_assignment_id"),
        )

    if not _index_exists(
        "vehicle_exit_approval",
        "ix_vehicle_exit_approval_gate_entry_id",
    ):
        op.create_index(
            "ix_vehicle_exit_approval_gate_entry_id",
            "vehicle_exit_approval",
            ["gate_entry_id"],
            unique=True,
        )

    # =======================================================================
    # 14. GATE EXIT
    # =======================================================================

    if not _table_exists("gate_exit"):
        op.create_table(
            "gate_exit",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("gate_entry_id", sa.UUID(), nullable=False),
            sa.Column("exit_approval_id", sa.UUID(), nullable=False),
            sa.Column("vehicle_number", sa.String(length=32), nullable=False),
            sa.Column("completed_by", sa.String(length=128), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["gate_entry_id"],
                ["gate_entry.id"],
                ondelete="RESTRICT",
            ),
            sa.ForeignKeyConstraint(
                ["exit_approval_id"],
                ["vehicle_exit_approval.id"],
                ondelete="RESTRICT",
            ),
            sa.UniqueConstraint("gate_entry_id"),
            sa.UniqueConstraint("exit_approval_id"),
        )

    if not _index_exists(
        "gate_exit",
        "ix_gate_exit_gate_entry_id",
    ):
        op.create_index(
            "ix_gate_exit_gate_entry_id",
            "gate_exit",
            ["gate_entry_id"],
            unique=True,
        )


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------

def downgrade() -> None:
    """
    Conservative downgrade.

    This migration is being used to reconcile a development database that may
    already contain some of these objects. Automatically dropping those objects
    could destroy pre-existing data, so downgrade is intentionally blocked.
    """
    raise RuntimeError(
        "Downgrade is disabled for 20260819_gate_asn because this "
        "reconciliation-safe migration may reuse pre-existing database objects."
    )
