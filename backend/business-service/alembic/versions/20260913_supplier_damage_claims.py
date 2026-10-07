"""Add damage report submission and supplier claims."""
from alembic import op
import sqlalchemy as sa

revision = "20260913_supplier_claims"
down_revision = "20260912_damage_report_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("damage_report", sa.Column("submitted_by", sa.String(128), nullable=True))
    op.add_column("damage_report", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table("supplier_damage_claim",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("claim_number", sa.String(32), nullable=False),
        sa.Column("damage_report_id", sa.Uuid(), sa.ForeignKey("damage_report.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("supplier_id", sa.Uuid(), sa.ForeignKey("supplier.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_by", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("claim_number"), sa.UniqueConstraint("damage_report_id"),
    )
    for column in ("claim_number", "damage_report_id", "supplier_id", "status"):
        op.create_index(f"ix_supplier_damage_claim_{column}", "supplier_damage_claim", [column])


def downgrade() -> None:
    op.drop_table("supplier_damage_claim")
    op.drop_column("damage_report", "submitted_at")
    op.drop_column("damage_report", "submitted_by")
