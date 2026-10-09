"""Add damage reports and photos."""
from alembic import op
import sqlalchemy as sa

revision = "20260910_damage_reports"
down_revision = "20260909_goods_inspection"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT to_regclass('public.damage_report')")).scalar() is not None:
        return
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "damage_report" not in tables:
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
    existing_indexes = {index["name"] for index in inspector.get_indexes("damage_report")} if "damage_report" in tables else set()
    for name, columns in [
        ("ix_damage_report_gate_entry_id", ["gate_entry_id"]),
        ("ix_damage_report_receiving_line_id", ["receiving_line_id"]),
        ("ix_damage_report_po_number", ["po_number"]),
        ("ix_damage_report_grn_number", ["grn_number"]),
    ]:
        if name not in existing_indexes:
            op.create_index(name, "damage_report", columns)
    if "damage_photo" not in tables:
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
