"""Create store master table and seed standard initial stores.

Revision ID: 20260902_create_store
Revises: 20260831_ensure_mat_cols
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "20260902_create_store"
down_revision: str = "20260831_ensure_mat_cols"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if "store" not in tables:
        op.create_table(
            "store",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("store_code", sa.String(64), nullable=False, unique=True),
            sa.Column("store_name", sa.String(128), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("warehouse_id", sa.String(64), nullable=False, server_default="Main Warehouse"),
            sa.Column("store_manager_id", sa.String(128), nullable=True),
            sa.Column("store_manager_name", sa.String(128), nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_store_store_code", "store", ["store_code"])
        op.create_index("ix_store_store_name", "store", ["store_name"])
        op.create_index("ix_store_warehouse_id", "store", ["warehouse_id"])
        op.create_index("ix_store_status", "store", ["status"])

        # Seed initial default stores
        initial_stores = [
            ("STR-001", "Electrical Store", "Electrical components, cables, switchgears, and wiring", "EMP-STORE-001", "John Doe (Electrical)"),
            ("STR-002", "Mechanical Store", "Mechanical parts, motors, pumps, bearings, and fasteners", "EMP-STORE-002", "Sarah Jenkins (Mechanical)"),
            ("STR-003", "Instrumentation Store", "Sensors, gauges, transmitters, and analytical instruments", "EMP-STORE-003", "Robert Chen (Instrumentation)"),
            ("STR-004", "Spare Parts Store", "Critical maintenance spares, replacement kits, and consumables", "EMP-STORE-004", "Emily Davis (Spare Parts)"),
            ("STR-005", "Raw Material Store", "Raw metal stock, sheets, pipes, ingots, and bulk materials", "EMP-STORE-005", "Michael Scott (Raw Material)"),
        ]
        for code, name, desc, mgr_id, mgr_name in initial_stores:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO store (id, store_code, store_name, description, warehouse_id, store_manager_id, store_manager_name, status, created_at, updated_at)
                    VALUES (gen_random_uuid(), :code, :name, :desc, 'Main Warehouse', :mgr_id, :mgr_name, 'ACTIVE', now(), now())
                    ON CONFLICT (store_code) DO NOTHING;
                    """
                ),
                {"code": code, "name": name, "desc": desc, "mgr_id": mgr_id, "mgr_name": mgr_name},
            )


def downgrade() -> None:
    op.drop_table("store")
