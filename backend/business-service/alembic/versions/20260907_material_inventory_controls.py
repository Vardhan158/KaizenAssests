"""Add material inventory and compliance controls."""
from alembic import op
import sqlalchemy as sa

revision = "20260907_inventory_controls"
down_revision = "20260906_price_thresholds"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("material", sa.Column("hsn_code", sa.String(16), nullable=True))
    op.add_column("material", sa.Column("gst_rate", sa.Numeric(5, 2), nullable=True))
    for name in ("minimum_stock", "maximum_stock", "reorder_level", "safety_stock"):
        op.add_column("material", sa.Column(name, sa.Numeric(18, 4), nullable=True))
    op.add_column("material", sa.Column("lead_time_days", sa.Integer(), nullable=True))
    for name in ("batch_controlled", "serial_controlled", "hazardous"):
        op.add_column("material", sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.false()))

def downgrade() -> None:
    for name in ("hazardous", "serial_controlled", "batch_controlled", "lead_time_days", "safety_stock", "reorder_level", "maximum_stock", "minimum_stock", "gst_rate", "hsn_code"):
        op.drop_column("material", name)
