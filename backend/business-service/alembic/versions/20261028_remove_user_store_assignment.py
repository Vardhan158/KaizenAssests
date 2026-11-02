"""Make managed accounts warehouse-wide by removing their Store FK.

Revision ID: 20261028_no_user_store
Revises: 20261028_user_work_scope
"""

from alembic import op
import sqlalchemy as sa


revision = "20261028_no_user_store"
down_revision = "20261028_user_work_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = {column["name"] for column in inspector.get_columns("store_manager_user")}
    if "store_id" not in columns:
        return
    for fk in inspector.get_foreign_keys("store_manager_user"):
        if "store_id" in (fk.get("constrained_columns") or []) and fk.get("name"):
            op.drop_constraint(fk["name"], "store_manager_user", type_="foreignkey")
    indexes = {index["name"] for index in inspector.get_indexes("store_manager_user")}
    if "ix_store_manager_user_store_id" in indexes:
        op.drop_index("ix_store_manager_user_store_id", table_name="store_manager_user")
    op.drop_column("store_manager_user", "store_id")


def downgrade() -> None:
    op.add_column("store_manager_user", sa.Column("store_id", sa.UUID(), nullable=True))
    op.create_index("ix_store_manager_user_store_id", "store_manager_user", ["store_id"])
    op.create_foreign_key(
        "fk_store_manager_user_store_id_store",
        "store_manager_user",
        "store",
        ["store_id"],
        ["id"],
        ondelete="RESTRICT",
    )
