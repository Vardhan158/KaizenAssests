"""Create store_manager_user table and seed initial standard store manager user accounts.

Revision ID: 20260902_create_store_manager_user
Revises: 20260902_create_store_zone
Create Date: 2026-09-02
"""
import hashlib
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "20260902_store_mgr_user"
down_revision: str = "20260902_create_store_zone"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if "store_manager_user" not in tables:
        op.create_table(
            "store_manager_user",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("store_id", UUID(as_uuid=True), sa.ForeignKey("store.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("employee_id", sa.String(64), nullable=False, unique=True),
            sa.Column("username", sa.String(64), nullable=False, unique=True),
            sa.Column("full_name", sa.String(128), nullable=False),
            sa.Column("email", sa.String(128), nullable=False, unique=True),
            sa.Column("password_hash", sa.String(256), nullable=False),
            sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_store_manager_user_store_id", "store_manager_user", ["store_id"])
        op.create_index("ix_store_manager_user_employee_id", "store_manager_user", ["employee_id"])
        op.create_index("ix_store_manager_user_username", "store_manager_user", ["username"])
        op.create_index("ix_store_manager_user_email", "store_manager_user", ["email"])
        op.create_index("ix_store_manager_user_status", "store_manager_user", ["status"])

        # Default password for seed managers is "password" (SHA-256)
        default_pwd_hash = hashlib.sha256("password".encode()).hexdigest()

        # Seed initial managers
        store_res = conn.execute(sa.text("SELECT id, store_code FROM store"))
        store_map = {row[1]: row[0] for row in store_res.fetchall()}

        initial_managers = [
            ("STR-001", "EMP-STORE-001", "store_manager_elec", "John Doe (Electrical)", "john.electrical@wms.local"),
            ("STR-002", "EMP-STORE-002", "store_manager_mech", "Sarah Jenkins (Mechanical)", "sarah.mechanical@wms.local"),
            ("STR-003", "EMP-STORE-003", "store_manager_inst", "Robert Chen (Instrumentation)", "robert.chen@wms.local"),
            ("STR-004", "EMP-STORE-004", "store_manager_spare", "Emily Davis (Spare Parts)", "emily.davis@wms.local"),
            ("STR-005", "EMP-STORE-005", "store_manager_raw", "Michael Scott (Raw Material)", "michael.scott@wms.local"),
        ]

        for s_code, emp_id, uname, full_name, email in initial_managers:
            if s_code in store_map:
                s_id = store_map[s_code]
                conn.execute(
                    sa.text(
                        """
                        INSERT INTO store_manager_user (id, store_id, employee_id, username, full_name, email, password_hash, status, created_at, updated_at)
                        VALUES (gen_random_uuid(), :store_id, :employee_id, :username, :full_name, :email, :password_hash, 'ACTIVE', now(), now())
                        ON CONFLICT (username) DO NOTHING;
                        """
                    ),
                    {
                        "store_id": s_id,
                        "employee_id": emp_id,
                        "username": uname,
                        "full_name": full_name,
                        "email": email,
                        "password_hash": default_pwd_hash,
                    },
                )


def downgrade() -> None:
    op.drop_table("store_manager_user")
