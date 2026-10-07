"""Add detailed goods inspection fields to receiving lines."""
from alembic import op
import sqlalchemy as sa

revision = "20260909_goods_inspection"
down_revision = "20260908_material_barcode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("receiving_line", sa.Column("physical_condition_ok", sa.Boolean(), nullable=True))
    op.add_column("receiving_line", sa.Column("packaging_ok", sa.Boolean(), nullable=True))
    op.add_column("receiving_line", sa.Column("specifications_ok", sa.Boolean(), nullable=True))
    op.add_column("receiving_line", sa.Column("serial_batch_number", sa.String(128), nullable=True))
    op.add_column("receiving_line", sa.Column("serial_batch_verified", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    for name in ("serial_batch_verified", "serial_batch_number", "specifications_ok", "packaging_ok", "physical_condition_ok"):
        op.drop_column("receiving_line", name)
