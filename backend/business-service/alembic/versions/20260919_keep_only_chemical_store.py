"""Keep only chemical store and remove all other stores.

Revision ID: 20260919_keep_only_chemical_store
Revises: 20260918_dock_store
Create Date: 2026-09-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "20260919_chem_store_only"
down_revision: str = "20260918_add_store_to_dock_and_allocation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if "store" not in tables:
        return

    # 1. Identify the Chemical Store (by name ILIKE '%chemical%' or code 'STR-001')
    res = conn.execute(
        sa.text(
            """
            SELECT id, store_code, store_name 
            FROM store 
            WHERE store_name ILIKE '%chemical%' OR store_code = 'STR-001'
            ORDER BY CASE WHEN store_name ILIKE '%chemical%' THEN 1 ELSE 2 END
            LIMIT 1;
            """
        )
    ).fetchone()

    if res:
        chem_store_id = res[0]
        # Standardize name and code
        conn.execute(
            sa.text(
                """
                UPDATE store 
                SET store_name = 'Chemical Store', store_code = 'STR-001', status = 'ACTIVE'
                WHERE id = :cid;
                """
            ),
            {"cid": chem_store_id},
        )
    else:
        # If no store exists, create the Chemical Store
        chem_store_id = conn.execute(
            sa.text(
                """
                INSERT INTO store (id, store_code, store_name, description, warehouse_id, store_manager_name, status, created_at, updated_at)
                VALUES (gen_random_uuid(), 'STR-001', 'Chemical Store', 'Chemicals, hazardous materials, and safety equipment', 'Main Warehouse', 'Gayle', 'ACTIVE', now(), now())
                RETURNING id;
                """
            )
        ).scalar()

    # 2. Reassign or clean child records for any non-chemical stores
    # a. store_zone & store_bin
    if "store_bin" in tables:
        conn.execute(
            sa.text(
                """
                DELETE FROM store_bin 
                WHERE store_id != :cid;
                """
            ),
            {"cid": chem_store_id},
        )
    if "store_zone" in tables:
        conn.execute(
            sa.text(
                """
                DELETE FROM store_zone 
                WHERE store_id != :cid;
                """
            ),
            {"cid": chem_store_id},
        )

    # b. store_manager_user (keep only managers assigned to Chemical Store)
    if "store_manager_user" in tables:
        conn.execute(
            sa.text(
                """
                DELETE FROM store_manager_user 
                WHERE store_id != :cid;
                """
            ),
            {"cid": chem_store_id},
        )

    # c. putaway_task: destination_store_id
    if "putaway_task" in tables:
        conn.execute(
            sa.text(
                """
                UPDATE putaway_task 
                SET destination_store_id = NULL 
                WHERE destination_store_id IS NOT NULL AND destination_store_id != :cid;
                """
            ),
            {"cid": chem_store_id},
        )

    # d. dock_assignment: assigned_store_id
    if "dock_assignment" in tables:
        conn.execute(
            sa.text(
                """
                UPDATE dock_assignment 
                SET assigned_store_id = NULL, assigned_store_code = NULL, assigned_store_name = NULL 
                WHERE assigned_store_id IS NOT NULL AND assigned_store_id != :cid;
                """
            ),
            {"cid": chem_store_id},
        )

    # e. dock_masters: assign chemical docks (CH-01, CH-02) to Chemical Store, clear non-chemical references
    if "dock_masters" in tables:
        conn.execute(
            sa.text(
                """
                UPDATE dock_masters 
                SET store_id = :cid 
                WHERE dock_code IN ('CH-01', 'CH-02') OR dock_type IN ('CHEMICAL_HAZARDOUS', 'CHEMICAL', 'HAZARDOUS_ITEMS');
                """
            ),
            {"cid": chem_store_id},
        )
        conn.execute(
            sa.text(
                """
                UPDATE dock_masters 
                SET store_id = NULL 
                WHERE store_id IS NOT NULL AND store_id != :cid;
                """
            ),
            {"cid": chem_store_id},
        )

    # f. dock_allocation_requests
    if "dock_allocation_requests" in tables:
        conn.execute(
            sa.text(
                """
                UPDATE dock_allocation_requests 
                SET assigned_store_id = NULL, assigned_store_code = NULL, assigned_store_name = NULL 
                WHERE assigned_store_id IS NOT NULL AND assigned_store_id != :cid;
                """
            ),
            {"cid": chem_store_id},
        )

    # g. assembly_requisition
    if "assembly_requisition" in tables:
        conn.execute(
            sa.text(
                """
                UPDATE assembly_requisition 
                SET assigned_store_id = NULL 
                WHERE assigned_store_id IS NOT NULL AND assigned_store_id != :cid;
                """
            ),
            {"cid": chem_store_id},
        )

    # h. pickup_task & inventory_issue_transaction
    if "pickup_task" in tables:
        conn.execute(
            sa.text(
                """
                DELETE FROM pickup_task 
                WHERE store_id != :cid;
                """
            ),
            {"cid": chem_store_id},
        )
    if "inventory_issue_transaction" in tables:
        conn.execute(
            sa.text(
                """
                DELETE FROM inventory_issue_transaction 
                WHERE store_id != :cid;
                """
            ),
            {"cid": chem_store_id},
        )

    # i. storage_location
    if "storage_location" in tables:
        conn.execute(
            sa.text(
                """
                UPDATE storage_location 
                SET store_id = NULL 
                WHERE store_id IS NOT NULL AND store_id != :cid;
                """
            ),
            {"cid": chem_store_id},
        )

    # 3. Permanently remove all other stores from the store table
    conn.execute(
        sa.text(
            """
            DELETE FROM store 
            WHERE id != :cid;
            """
        ),
        {"cid": chem_store_id},
    )


def downgrade() -> None:
    pass
