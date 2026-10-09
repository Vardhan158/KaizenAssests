"""Add detailed goods inspection fields to receiving lines."""
from alembic import op
import sqlalchemy as sa

revision = "20260909_goods_inspection"
down_revision = "20260908_material_barcode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("receiving_line")}
    columns = [
        ("physical_condition_ok", sa.Boolean(), True, None),
        ("packaging_ok", sa.Boolean(), True, None),
        ("specifications_ok", sa.Boolean(), True, None),
        ("serial_batch_number", sa.String(128), True, None),
        ("serial_batch_verified", sa.Boolean(), False, sa.false()),
    ]
    for name, column_type, nullable, default in columns:
        if name not in existing:
            op.add_column("receiving_line", sa.Column(name, column_type, nullable=nullable, server_default=default))


def downgrade() -> None:
    for name in ("serial_batch_verified", "serial_batch_number", "specifications_ok", "packaging_ok", "physical_condition_ok"):
        op.drop_column("receiving_line", name)
