"""Backfill and require automatically generated supplier codes.

Revision ID: 20260825_supplier_codes
Revises: 20260821_storage_location_code
"""

from alembic import op
import sqlalchemy as sa


revision = "20260825_supplier_codes"
down_revision = "20260821_storage_location_code"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    cols = {c["name"] for c in inspector.get_columns("supplier")}
    if "supplier_code" not in cols:
        op.add_column("supplier", sa.Column("supplier_code", sa.String(length=64), nullable=True))

    rows = connection.execute(
        sa.text(
            "SELECT id, supplier_code FROM supplier "
            "ORDER BY created_at NULLS LAST, id"
        )
    ).fetchall()

    used = set()
    for row in rows:
        code = row.supplier_code
        if code and code.startswith("SUP-") and code[4:].isdigit():
            used.add(int(code[4:]))

    next_sequence = 1
    for row in rows:
        if row.supplier_code:
            continue
        while next_sequence in used:
            next_sequence += 1
        connection.execute(
            sa.text("UPDATE supplier SET supplier_code = :code WHERE id = :id"),
            {"code": f"SUP-{next_sequence:05d}", "id": row.id},
        )
        used.add(next_sequence)
        next_sequence += 1

    op.alter_column(
        "supplier",
        "supplier_code",
        existing_type=sa.String(length=64),
        nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "supplier",
        "supplier_code",
        existing_type=sa.String(length=64),
        nullable=True,
    )
