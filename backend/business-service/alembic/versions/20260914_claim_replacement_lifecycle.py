"""Add supplier response, replacement receipt, and return lifecycle."""
from alembic import op
import sqlalchemy as sa
revision = "20260914_claim_lifecycle"
down_revision = "20260913_supplier_claims"
branch_labels = None
depends_on = None

def upgrade() -> None:
    for column in (
        sa.Column("supplier_response", sa.String(32)), sa.Column("resolution", sa.String(32)),
        sa.Column("supplier_remarks", sa.Text()), sa.Column("return_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("responded_at", sa.DateTime(timezone=True)), sa.Column("closed_by", sa.String(128)), sa.Column("closed_at", sa.DateTime(timezone=True)),
    ): op.add_column("supplier_damage_claim", column)
    op.create_table("replacement_shipment",
        sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("shipment_number", sa.String(32), nullable=False, unique=True),
        sa.Column("claim_id", sa.Uuid(), sa.ForeignKey("supplier_damage_claim.id", ondelete="RESTRICT"), nullable=False, unique=True),
        sa.Column("expected_quantity", sa.Numeric(18,4), nullable=False), sa.Column("vehicle_number", sa.String(32), nullable=False),
        sa.Column("expected_arrival", sa.DateTime(timezone=True)), sa.Column("status", sa.String(32), nullable=False),
        sa.Column("gate_entry_number", sa.String(64), unique=True), sa.Column("gate_recorded_by", sa.String(128)), sa.Column("gate_recorded_at", sa.DateTime(timezone=True)),
        sa.Column("replacement_grn_number", sa.String(64), unique=True), sa.Column("received_quantity", sa.Numeric(18,4)),
        sa.Column("accepted_quantity", sa.Numeric(18,4)), sa.Column("damaged_quantity", sa.Numeric(18,4)),
        sa.Column("received_by", sa.String(128)), sa.Column("received_at", sa.DateTime(timezone=True)),
        sa.Column("inspected_by", sa.String(128)), sa.Column("inspected_at", sa.DateTime(timezone=True)),
        sa.Column("putaway_location", sa.String(128)), sa.Column("putaway_by", sa.String(128)), sa.Column("putaway_at", sa.DateTime(timezone=True)),
        sa.Column("inventory_posted_at", sa.DateTime(timezone=True)))
    for c in ("shipment_number","claim_id","status"): op.create_index(f"ix_replacement_shipment_{c}", "replacement_shipment", [c])
    op.create_table("supplier_return",
        sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("return_number", sa.String(32), nullable=False, unique=True),
        sa.Column("claim_id", sa.Uuid(), sa.ForeignKey("supplier_damage_claim.id", ondelete="RESTRICT"), nullable=False, unique=True),
        sa.Column("quantity", sa.Numeric(18,4), nullable=False), sa.Column("status", sa.String(32), nullable=False),
        sa.Column("vehicle_number", sa.String(32), nullable=False), sa.Column("created_by", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("gate_exit_by", sa.String(128)), sa.Column("gate_exit_at", sa.DateTime(timezone=True)))
    for c in ("return_number","claim_id","status"): op.create_index(f"ix_supplier_return_{c}", "supplier_return", [c])

def downgrade() -> None:
    op.drop_table("supplier_return"); op.drop_table("replacement_shipment")
    for name in ("closed_at","closed_by","responded_at","return_required","supplier_remarks","resolution","supplier_response"): op.drop_column("supplier_damage_claim", name)
