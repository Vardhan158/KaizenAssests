"""Remove legacy hardcoded dock master records.

Revision ID: 20260915_remove_seeded_docks
Revises: 20260831_ensure_mat_cols
Create Date: 2026-09-02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260915_remove_seeded_docks"
down_revision = "20260831_ensure_mat_cols"
branch_labels = None
depends_on = None


SEEDED_DOCKS = """
    VALUES
      ('RM-01', 'Raw Material Dock 01', 'RAW_MATERIAL', 'North Warehouse'),
      ('RM-02', 'Raw Material Dock 02', 'RAW_MATERIAL', 'East Warehouse'),
      ('CH-01', 'Chemical/Hazardous Dock 01', 'CHEMICAL_HAZARDOUS', 'South Warehouse'),
      ('CH-02', 'Chemical/Hazardous Dock 02', 'CHEMICAL_HAZARDOUS', 'South Warehouse'),
      ('EL-01', 'Electrical Dock 01', 'ELECTRICAL', 'North Warehouse'),
      ('EL-02', 'Electrical Dock 02', 'ELECTRICAL', 'North Warehouse'),
      ('EC-01', 'Electronics Dock 01', 'ELECTRONICS', 'West Warehouse'),
      ('EC-02', 'Electronics Dock 02', 'ELECTRONICS', 'West Warehouse'),
      ('MR-01', 'Main Receiving Dock', 'MAIN_RECEIVING', 'North Warehouse')
"""


def upgrade() -> None:
    connection = op.get_bind()
    if "dock_masters" not in sa.inspect(connection).get_table_names():
        return

    # Match the complete legacy seed signature and preserve any dock that has
    # ever been assigned. This avoids deleting user-created or operational data
    # that happens to reuse one part of a demo record.
    connection.execute(sa.text(f"""
        WITH seeded(code, name, type, location) AS ({SEEDED_DOCKS}),
        removable AS (
          SELECT d.id
          FROM dock_masters d
          JOIN seeded s ON s.code = d.dock_code
            AND s.name = d.dock_name
            AND s.type = d.dock_type
            AND s.location = d.location
          WHERE d.status = 'AVAILABLE'
            AND d.is_active = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM dock_allocation_requests r
              WHERE r.assigned_dock_id = d.id
            )
        )
        UPDATE dock_status_history
        SET dock_id = NULL
        WHERE dock_id IN (SELECT id FROM removable)
    """))
    connection.execute(sa.text(f"""
        WITH seeded(code, name, type, location) AS ({SEEDED_DOCKS})
        DELETE FROM dock_masters d
        USING seeded s
        WHERE s.code = d.dock_code
          AND s.name = d.dock_name
          AND s.type = d.dock_type
          AND s.location = d.location
          AND d.status = 'AVAILABLE'
          AND d.is_active = TRUE
          AND NOT EXISTS (
            SELECT 1 FROM dock_allocation_requests r
            WHERE r.assigned_dock_id = d.id
          )
    """))


def downgrade() -> None:
    # Removed demo data is intentionally not recreated.
    pass
