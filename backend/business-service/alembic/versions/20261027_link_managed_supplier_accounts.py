"""Link admin-managed supplier accounts to supplier master records.

Revision ID: 20261027_link_suppliers
Revises: 20261027_remove_john_doe
"""

from alembic import op
import sqlalchemy as sa


revision = "20261027_link_suppliers"
down_revision = "20261027_remove_john_doe"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            WITH missing_accounts AS (
                SELECT
                    smu.id AS account_id,
                    smu.employee_id,
                    smu.username,
                    smu.full_name,
                    smu.password_hash,
                    gen_random_uuid() AS supplier_id
                FROM store_manager_user smu
                LEFT JOIN supplier_user su
                  ON lower(su.username) = lower(smu.username)
                WHERE upper(replace(smu.role, ' ', '_')) = 'SUPPLIER'
                  AND su.id IS NULL
            ), inserted_suppliers AS (
                INSERT INTO supplier (
                    id, supplier_name, registered_company_name, vendor_type,
                    category, industry, gstin, supplier_code, rating,
                    performance_score, status, created_at, updated_at
                )
                SELECT
                    supplier_id,
                    full_name,
                    full_name || ' (' || employee_id || ')',
                    'MANUFACTURER',
                    '[]'::json,
                    'GENERAL',
                    'AUTO-' || upper(substr(replace(supplier_id::text, '-', ''), 1, 12)),
                    'SUP-' || replace(employee_id, 'EMP-', ''),
                    0,
                    0,
                    'Active',
                    now(),
                    now()
                FROM missing_accounts
                RETURNING id
            )
            INSERT INTO supplier_user (
                id, supplier_id, username, password_hash, must_change_password
            )
            SELECT
                gen_random_uuid(), supplier_id, username, password_hash, false
            FROM missing_accounts
            """
        )
    )


def downgrade() -> None:
    # Supplier operational records may reference these identities after use,
    # so the ownership mapping is intentionally retained on downgrade.
    pass
