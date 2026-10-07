"""Add damage reports and photos."""
from alembic import op
import sqlalchemy as sa

revision = "20260910_damage_reports"
down_revision = "20260909_goods_inspection"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("damage_report",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("gate_entry_id", sa.Uuid(), sa.ForeignKey("gate_entry.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("receiving_line_id", sa.Uuid(), sa.ForeignKey("receiving_line.id", ondelete="CASCADE"), nullable=False),
        sa.Column("material_code", sa.String(64), nullable=False),
        sa.Column("material_name", sa.String(256), nullable=True),
        sa.Column("po_number", sa.String(64), nullable=False),
        sa.Column("grn_number", sa.String(64), nullable=True),
        sa.Column("damaged_quantity", sa.Numeric(18, 4), nullable=False),
        sa.Column("damage_reason", sa.String(256), nullable=False),
        sa.Column("inspection_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("inspector", sa.String(128), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True),
    )
    op.create_index("ix_damage_report_gate_entry_id", "damage_report", ["gate_entry_id"])
    op.create_index("ix_damage_report_receiving_line_id", "damage_report", ["receiving_line_id"])
    op.create_index("ix_damage_report_po_number", "damage_report", ["po_number"])
    op.create_index("ix_damage_report_grn_number", "damage_report", ["grn_number"])
    op.create_table("damage_photo",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("damage_report_id", sa.Uuid(), sa.ForeignKey("damage_report.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(256), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=False),
        sa.Column("image_data", sa.LargeBinary(), nullable=False),
    )
    op.create_index("ix_damage_photo_damage_report_id", "damage_photo", ["damage_report_id"])


def downgrade() -> None:
    op.drop_table("damage_photo")
    op.drop_table("damage_report")
