"""Link gate entries to their source ASN.

Revision ID: 20260819_gate_asn
Revises: 20260819_gate
"""
from alembic import op
import sqlalchemy as sa

revision = "20260819_gate_asn"
down_revision = "20260819_gate"
branch_labels = None
depends_on = None


def upgrade() -> None:
    dock_table = op.create_table(
        "warehouse_dock",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("dock_number", sa.String(length=32), nullable=False),
        sa.Column("warehouse_id", sa.String(length=64), nullable=False),
        sa.Column("dock_type", sa.String(length=64), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("dock_number"),
    )
    op.create_index("ix_warehouse_dock_dock_number", "warehouse_dock", ["dock_number"], unique=True)
    op.create_index("ix_warehouse_dock_warehouse_id", "warehouse_dock", ["warehouse_id"])
    op.create_index("ix_warehouse_dock_status", "warehouse_dock", ["status"])
    import uuid
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    op.bulk_insert(dock_table, [
        {"id": uuid.uuid4(), "dock_number": "DOCK-01", "warehouse_id": "WH-PUNE-01", "dock_type": "GENERAL", "capacity": 20, "status": "AVAILABLE", "created_at": now, "updated_at": now},
        {"id": uuid.uuid4(), "dock_number": "DOCK-02", "warehouse_id": "WH-PUNE-01", "dock_type": "PALLETISED", "capacity": 30, "status": "OCCUPIED", "created_at": now, "updated_at": now},
        {"id": uuid.uuid4(), "dock_number": "DOCK-03", "warehouse_id": "WH-PUNE-01", "dock_type": "GENERAL", "capacity": 20, "status": "AVAILABLE", "created_at": now, "updated_at": now},
        {"id": uuid.uuid4(), "dock_number": "DOCK-04", "warehouse_id": "WH-PUNE-01", "dock_type": "HEAVY_VEHICLE", "capacity": 40, "status": "MAINTENANCE", "created_at": now, "updated_at": now},
    ])
    op.add_column("gate_entry", sa.Column("asn_id", sa.UUID(), nullable=True))
    op.add_column("gate_entry", sa.Column("assigned_dock_id", sa.String(length=32), nullable=True))
    op.create_foreign_key("fk_gate_entry_asn_id", "gate_entry", "asn", ["asn_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_gate_entry_asn_id", "gate_entry", ["asn_id"])
    op.create_index("ix_gate_entry_assigned_dock_id", "gate_entry", ["assigned_dock_id"])
    op.execute("UPDATE gate_entry SET status = 'AWAITING_DOCK' WHERE status = 'GATE_ENTRY_APPROVED'")
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
        sa.ForeignKeyConstraint(["gate_entry_id"], ["gate_entry.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["asn_id"], ["asn.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["po_id"], ["purchase_order.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["dock_number"], ["warehouse_dock.dock_number"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["prepared_grn_id"], ["grn.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("gate_entry_id"),
        sa.UniqueConstraint("prepared_grn_id"),
    )
    op.create_index("ix_dock_assignment_gate_entry_id", "dock_assignment", ["gate_entry_id"], unique=True)
    op.create_index("ix_dock_assignment_asn_id", "dock_assignment", ["asn_id"])
    op.create_index("ix_dock_assignment_po_id", "dock_assignment", ["po_id"])
    op.create_index("ix_dock_assignment_dock_number", "dock_assignment", ["dock_number"])
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
        sa.Column("inspection_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("condition_notes", sa.Text(), nullable=True),
        sa.Column("condition_checked_by", sa.String(length=128), nullable=True),
        sa.Column("condition_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recorded_by", sa.String(length=128), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["dock_assignment_id"], ["dock_assignment.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("dock_assignment_id", "item_code", name="uq_receiving_line_assignment_item"),
    )
    op.create_index("ix_receiving_line_dock_assignment_id", "receiving_line", ["dock_assignment_id"])
    policy_table = op.create_table(
        "quantity_verification_policy",
        sa.Column("policy_key", sa.String(length=32), primary_key=True),
        sa.Column("shortage_tolerance", sa.Numeric(18, 4), nullable=False),
        sa.Column("excess_tolerance", sa.Numeric(18, 4), nullable=False),
        sa.Column("updated_by", sa.String(length=128), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.bulk_insert(policy_table, [{"policy_key": "DEFAULT", "shortage_tolerance": 0, "excess_tolerance": 0, "updated_by": "SYSTEM", "updated_at": now}])
    op.add_column("grn", sa.Column("grn_number", sa.String(length=64), nullable=True))
    op.add_column("grn", sa.Column("asn_id", sa.UUID(), nullable=True))
    op.add_column("grn", sa.Column("asn_number", sa.String(length=64), nullable=True))
    op.add_column("grn", sa.Column("supplier_name", sa.String(length=255), nullable=True))
    op.add_column("grn", sa.Column("vehicle_number", sa.String(length=64), nullable=True))
    op.add_column("grn", sa.Column("warehouse_id", sa.String(length=64), nullable=True))
    op.add_column("grn", sa.Column("dock_number", sa.String(length=32), nullable=True))
    op.add_column("grn", sa.Column("posted_by", sa.String(length=128), nullable=True))
    op.add_column("grn", sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("grn", sa.Column("verification_notes", sa.Text(), nullable=True))
    op.create_index("ix_grn_grn_number", "grn", ["grn_number"], unique=True)
    op.add_column("grn_line", sa.Column("accepted_quantity", sa.Numeric(18, 4), nullable=True))
    op.add_column("grn_line", sa.Column("damaged_quantity", sa.Numeric(18, 4), nullable=True))
    op.add_column("grn_line", sa.Column("material_name", sa.String(length=256), nullable=True))
    op.add_column("grn_line", sa.Column("uom", sa.String(length=32), nullable=True))
    op.add_column("grn_line", sa.Column("rejected_quantity", sa.Numeric(18, 4), nullable=True))
    op.add_column("grn_line", sa.Column("quality_result", sa.String(length=32), nullable=True))
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
        sa.ForeignKeyConstraint(["grn_id"], ["grn.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("grn_id", "item_code", name="uq_inventory_posting_grn_item"),
    )
    op.create_index("ix_inventory_receipt_posting_grn_id", "inventory_receipt_posting", ["grn_id"])
    location_table = op.create_table(
        "storage_location",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("location_code", sa.String(length=64), nullable=False),
        sa.Column("warehouse_id", sa.String(length=64), nullable=False),
        sa.Column("zone", sa.String(length=128), nullable=False),
        sa.Column("rack", sa.String(length=64), nullable=False),
        sa.Column("bin", sa.String(length=64), nullable=False),
        sa.Column("capacity", sa.Numeric(18, 4), nullable=False),
        sa.Column("occupied_quantity", sa.Numeric(18, 4), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("location_code"),
        sa.UniqueConstraint("warehouse_id", "zone", "rack", "bin", name="uq_storage_location_path"),
    )
    op.create_index("ix_storage_location_location_code", "storage_location", ["location_code"], unique=True)
    op.create_index("ix_storage_location_warehouse_id", "storage_location", ["warehouse_id"])
    op.bulk_insert(location_table, [
        {"id": uuid.uuid4(), "location_code": "WH-01-RM-A-05", "warehouse_id": "WH-01", "zone": "Raw Material Zone", "rack": "Rack A", "bin": "Bin 05", "capacity": 10000, "occupied_quantity": 0, "active": True},
        {"id": uuid.uuid4(), "location_code": "WH-01-RM-A-06", "warehouse_id": "WH-01", "zone": "Raw Material Zone", "rack": "Rack A", "bin": "Bin 06", "capacity": 10000, "occupied_quantity": 0, "active": True},
        {"id": uuid.uuid4(), "location_code": "WH-PUNE-01-RM-A-05", "warehouse_id": "WH-PUNE-01", "zone": "Raw Material Zone", "rack": "Rack A", "bin": "Bin 05", "capacity": 10000, "occupied_quantity": 0, "active": True},
        {"id": uuid.uuid4(), "location_code": "WH-PUNE-01-RM-B-01", "warehouse_id": "WH-PUNE-01", "zone": "Raw Material Zone", "rack": "Rack B", "bin": "Bin 01", "capacity": 20000, "occupied_quantity": 0, "active": True},
    ])
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
        sa.ForeignKeyConstraint(["grn_id"], ["grn.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["destination_location_id"], ["storage_location.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("task_number"),
        sa.UniqueConstraint("grn_id", "item_code", name="uq_putaway_task_grn_item"),
    )
    op.create_index("ix_putaway_task_task_number", "putaway_task", ["task_number"], unique=True)
    op.create_index("ix_putaway_task_grn_id", "putaway_task", ["grn_id"])
    op.create_index("ix_putaway_task_status", "putaway_task", ["status"])
    op.create_index("ix_putaway_task_destination_location_id", "putaway_task", ["destination_location_id"])
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
        sa.ForeignKeyConstraint(["putaway_task_id"], ["putaway_task.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("putaway_task_id"),
    )
    op.create_index("ix_putaway_movement_putaway_task_id", "putaway_movement", ["putaway_task_id"], unique=True)
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
        sa.ForeignKeyConstraint(["storage_location_id"], ["storage_location.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["last_putaway_task_id"], ["putaway_task.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("material_code", "storage_location_id", name="uq_inventory_location_material_bin"),
    )
    op.create_index("ix_inventory_location_balance_material_code", "inventory_location_balance", ["material_code"])
    op.create_index("ix_inventory_location_balance_warehouse_id", "inventory_location_balance", ["warehouse_id"])
    op.create_index("ix_inventory_location_balance_storage_location_id", "inventory_location_balance", ["storage_location_id"])
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
        sa.ForeignKeyConstraint(["gate_entry_id"], ["gate_entry.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["dock_assignment_id"], ["dock_assignment.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["asn_id"], ["asn.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["po_id"], ["purchase_order.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["grn_id"], ["grn.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("gate_entry_id"),
        sa.UniqueConstraint("dock_assignment_id"),
    )
    op.create_index("ix_vehicle_exit_approval_gate_entry_id", "vehicle_exit_approval", ["gate_entry_id"], unique=True)
    op.create_table(
        "gate_exit",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("gate_entry_id", sa.UUID(), nullable=False),
        sa.Column("exit_approval_id", sa.UUID(), nullable=False),
        sa.Column("vehicle_number", sa.String(length=32), nullable=False),
        sa.Column("completed_by", sa.String(length=128), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gate_entry_id"], ["gate_entry.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["exit_approval_id"], ["vehicle_exit_approval.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("gate_entry_id"),
        sa.UniqueConstraint("exit_approval_id"),
    )
    op.create_index("ix_gate_exit_gate_entry_id", "gate_exit", ["gate_entry_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_gate_exit_gate_entry_id", table_name="gate_exit")
    op.drop_table("gate_exit")
    op.drop_index("ix_vehicle_exit_approval_gate_entry_id", table_name="vehicle_exit_approval")
    op.drop_table("vehicle_exit_approval")
    op.drop_index("ix_inventory_location_balance_storage_location_id", table_name="inventory_location_balance")
    op.drop_index("ix_inventory_location_balance_warehouse_id", table_name="inventory_location_balance")
    op.drop_index("ix_inventory_location_balance_material_code", table_name="inventory_location_balance")
    op.drop_table("inventory_location_balance")
    op.drop_index("ix_putaway_movement_putaway_task_id", table_name="putaway_movement")
    op.drop_table("putaway_movement")
    op.drop_index("ix_putaway_task_destination_location_id", table_name="putaway_task")
    op.drop_index("ix_putaway_task_status", table_name="putaway_task")
    op.drop_index("ix_putaway_task_grn_id", table_name="putaway_task")
    op.drop_index("ix_putaway_task_task_number", table_name="putaway_task")
    op.drop_table("putaway_task")
    op.drop_index("ix_storage_location_warehouse_id", table_name="storage_location")
    op.drop_index("ix_storage_location_location_code", table_name="storage_location")
    op.drop_table("storage_location")
    op.drop_index("ix_inventory_receipt_posting_grn_id", table_name="inventory_receipt_posting")
    op.drop_table("inventory_receipt_posting")
    op.drop_column("grn_line", "quality_result")
    op.drop_column("grn_line", "rejected_quantity")
    op.drop_column("grn_line", "uom")
    op.drop_column("grn_line", "material_name")
    op.drop_column("grn_line", "damaged_quantity")
    op.drop_column("grn_line", "accepted_quantity")
    op.drop_index("ix_grn_grn_number", table_name="grn")
    op.drop_column("grn", "verification_notes")
    op.drop_column("grn", "posted_at")
    op.drop_column("grn", "posted_by")
    op.drop_column("grn", "dock_number")
    op.drop_column("grn", "warehouse_id")
    op.drop_column("grn", "vehicle_number")
    op.drop_column("grn", "supplier_name")
    op.drop_column("grn", "asn_number")
    op.drop_column("grn", "asn_id")
    op.drop_column("grn", "grn_number")
    op.drop_table("quantity_verification_policy")
    op.drop_index("ix_receiving_line_dock_assignment_id", table_name="receiving_line")
    op.drop_table("receiving_line")
    op.drop_index("ix_dock_assignment_dock_number", table_name="dock_assignment")
    op.drop_index("ix_dock_assignment_po_id", table_name="dock_assignment")
    op.drop_index("ix_dock_assignment_asn_id", table_name="dock_assignment")
    op.drop_index("ix_dock_assignment_gate_entry_id", table_name="dock_assignment")
    op.drop_table("dock_assignment")
    op.execute("UPDATE gate_entry SET status = 'GATE_ENTRY_APPROVED' WHERE status = 'AWAITING_DOCK'")
    op.drop_index("ix_gate_entry_assigned_dock_id", table_name="gate_entry")
    op.drop_index("ix_gate_entry_asn_id", table_name="gate_entry")
    op.drop_constraint("fk_gate_entry_asn_id", "gate_entry", type_="foreignkey")
    op.drop_column("gate_entry", "asn_id")
    op.drop_column("gate_entry", "assigned_dock_id")
    op.drop_index("ix_warehouse_dock_status", table_name="warehouse_dock")
    op.drop_index("ix_warehouse_dock_warehouse_id", table_name="warehouse_dock")
    op.drop_index("ix_warehouse_dock_dock_number", table_name="warehouse_dock")
    op.drop_table("warehouse_dock")
