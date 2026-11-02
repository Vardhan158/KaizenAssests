"""Remove the legacy seeded John Doe store-manager account.

Revision ID: 20261027_remove_john_doe
Revises: 20261027_user_permissions
"""

from alembic import op
import sqlalchemy as sa


revision = "20261027_remove_john_doe"
down_revision = "20261027_user_permissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Match every original seed value so a real account that reused only one
    # identifier is never removed accidentally.
    conn.execute(
        sa.text(
            """
            DELETE FROM store_manager_user
            WHERE employee_id = 'EMP-STORE-001'
              AND username = 'store_manager_elec'
              AND full_name = 'John Doe (Electrical)'
              AND email = 'john.electrical@wms.local'
            """
        )
    )
    conn.execute(
        sa.text(
            """
            UPDATE store
            SET store_manager_id = NULL,
                store_manager_name = NULL,
                updated_at = now()
            WHERE store_code = 'STR-001'
              AND store_manager_id = 'EMP-STORE-001'
              AND store_manager_name = 'John Doe (Electrical)'
            """
        )
    )


def downgrade() -> None:
    # This cleanup intentionally does not recreate a default-password account.
    pass
