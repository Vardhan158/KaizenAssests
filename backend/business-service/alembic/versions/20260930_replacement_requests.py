"""Create supplier replacement request workflow table."""
from alembic import op
import sqlalchemy as sa

revision = "20260930_replacement_requests"
down_revision = "f4897dcf5268"
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    existing_asn_columns = {column["name"] for column in sa.inspect(bind).get_columns("asn")}
    for column in (
        sa.Column("shipment_type", sa.String(32), nullable=False, server_default="STANDARD"),
        sa.Column("replacement_request_id", sa.UUID(), nullable=True),
        sa.Column("original_asn_id", sa.UUID(), nullable=True),
    ):
        if column.name not in existing_asn_columns:
            op.add_column("asn", column)
    if "replacement_request" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "replacement_request",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("request_number", sa.String(64), nullable=False, unique=True),
        sa.Column("supplier_id", sa.UUID(), sa.ForeignKey("supplier.id"), nullable=False),
        sa.Column("purchase_order_id", sa.UUID(), sa.ForeignKey("purchase_order.id"), nullable=True),
        sa.Column("original_asn_id", sa.UUID(), sa.ForeignKey("asn.id"), nullable=True),
        sa.Column("item_code", sa.String(128), nullable=False),
        sa.Column("item_name", sa.String(256)),
        sa.Column("replacement_quantity", sa.Numeric(18, 4), nullable=False),
        sa.Column("uom", sa.String(32), nullable=False, server_default="PCS"),
        sa.Column("reason", sa.String(256), nullable=False),
        sa.Column("remarks", sa.Text()),
        sa.Column("request_date", sa.Date(), nullable=False),
        sa.Column("supplier_response_due_at", sa.DateTime()),
        sa.Column("replacement_dispatch_due_at", sa.DateTime()),
        sa.Column("status", sa.String(32), nullable=False, server_default="SENT_TO_SUPPLIER"),
        sa.Column("supplier_response_at", sa.DateTime()),
        sa.Column("accepted_at", sa.DateTime()),
        sa.Column("extension_requested_at", sa.DateTime()),
        sa.Column("disputed_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_replacement_request_request_number", "replacement_request", ["request_number"], unique=True)
    op.create_index("ix_replacement_request_supplier_id", "replacement_request", ["supplier_id"])

def downgrade():
    op.drop_column("asn", "original_asn_id")
    op.drop_column("asn", "replacement_request_id")
    op.drop_column("asn", "shipment_type")
    op.drop_table("replacement_request")
