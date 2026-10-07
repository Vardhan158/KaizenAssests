"""Create store_zone table and seed initial standard store zones.

Revision ID: 20260902_create_store_zone
Revises: 20260902_create_store
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "20260902_create_store_zone"
down_revision: str = "20260902_create_store"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if "store_zone" not in tables:
        op.create_table(
            "store_zone",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("store_id", UUID(as_uuid=True), sa.ForeignKey("store.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("zone_code", sa.String(64), nullable=False),
            sa.Column("zone_name", sa.String(128), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("store_id", "zone_code", name="uq_store_zone_code"),
        )
        op.create_index("ix_store_zone_store_id", "store_zone", ["store_id"])
        op.create_index("ix_store_zone_zone_code", "store_zone", ["zone_code"])
        op.create_index("ix_store_zone_status", "store_zone", ["status"])

        # Seed standard initial zones for default stores
        # 1. Fetch existing stores
        store_res = conn.execute(sa.text("SELECT id, store_code FROM store"))
        store_map = {row[1]: row[0] for row in store_res.fetchall()}

        initial_zones = [
            # STR-001 (Electrical Store)
            ("STR-001", "STR-001-Z01", "High Voltage Bay", "Switchgears, high voltage cables, and power units"),
            ("STR-001", "STR-001-Z02", "Control & Relays Area", "Circuit breakers, contactors, and control relays"),
            ("STR-001", "STR-001-Z03", "Wiring & Harness Bin", "Cable spools, wire harnesses, and connectors"),
            # STR-002 (Mechanical Store)
            ("STR-002", "STR-002-Z01", "Heavy Machinery Bay", "Electric motors, hydraulic pumps, and gearboxes"),
            ("STR-002", "STR-002-Z02", "Bearings & Fasteners Rack", "High precision roller bearings, seals, and bolts"),
            # STR-003 (Instrumentation Store)
            ("STR-003", "STR-003-Z01", "Sensors & Transmitters Rack", "Pressure, temperature, and level transmitters"),
            ("STR-003", "STR-003-Z02", "Calibration & Diagnostics Lab", "Diagnostic equipment, flow meters, and gauges"),
            # STR-004 (Spare Parts Store)
            ("STR-004", "STR-004-Z01", "Critical Overhaul Spares", "Turbine blades, pump impellers, and wear plates"),
            ("STR-004", "STR-004-Z02", "Consumables & Gaskets", "O-rings, mechanical seals, gaskets, and filters"),
            # STR-005 (Raw Material Store)
            ("STR-005", "STR-005-Z01", "Heavy Steel Bar Yard", "Structural steel, solid rods, and heavy bars"),
            ("STR-005", "STR-005-Z02", "Sheet Metal & Tubing Stacks", "Alloy plates, stainless tubes, and pipe stacks"),
        ]

        for s_code, z_code, z_name, z_desc in initial_zones:
            if s_code in store_map:
                s_id = store_map[s_code]
                conn.execute(
                    sa.text(
                        """
                        INSERT INTO store_zone (id, store_id, zone_code, zone_name, description, status, created_at, updated_at)
                        VALUES (gen_random_uuid(), :store_id, :zone_code, :zone_name, :description, 'ACTIVE', now(), now())
                        ON CONFLICT (store_id, zone_code) DO NOTHING;
                        """
                    ),
                    {"store_id": s_id, "zone_code": z_code, "zone_name": z_name, "description": z_desc},
                )


def downgrade() -> None:
    op.drop_table("store_zone")
