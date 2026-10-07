"""Persist complete material-master fields.

Revision ID: 20260904_material_master
Revises: 20260903_material_identity
"""
from alembic import op
import sqlalchemy as sa

revision = "20260904_material_master"
down_revision = "20260903_material_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("material")}

    for col_name, col_def in [
        ("sub_category", sa.Column("sub_category", sa.String(64), nullable=True)),
        ("material_type", sa.Column("material_type", sa.String(64), nullable=False, server_default="Raw Material")),
        ("uom", sa.Column("uom", sa.String(32), nullable=False, server_default="Nos")),
        ("status", sa.Column("status", sa.String(16), nullable=False, server_default="Active")),
    ]:
        if col_name not in cols:
            op.add_column("material", col_def)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("material")}

    for col_name in ["sub_category", "material_type", "uom"]:
        if col_name in cols:
            op.drop_column("material", col_name)
