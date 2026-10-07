"""Add damage report numbering and procurement workflow status."""
from alembic import op
import sqlalchemy as sa

revision = "20260912_damage_report_workflow"
down_revision = "20260911_damage_quarantine"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("damage_report", sa.Column("report_number", sa.String(32), nullable=True))
    op.add_column("damage_report", sa.Column("received_quantity", sa.Numeric(18, 4), nullable=True))
    op.add_column("damage_report", sa.Column("status", sa.String(32), nullable=False, server_default="PENDING_PROCUREMENT"))
    op.execute("""WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY inspection_date, id) AS sequence
        FROM damage_report
    )
    UPDATE damage_report AS report
    SET report_number = 'DR-' || LPAD(numbered.sequence::text, 5, '0'),
        received_quantity = report.damaged_quantity
    FROM numbered WHERE numbered.id = report.id""")
    op.alter_column("damage_report", "report_number", nullable=False)
    op.alter_column("damage_report", "received_quantity", nullable=False)
    op.create_unique_constraint("uq_damage_report_report_number", "damage_report", ["report_number"])
    op.create_index("ix_damage_report_report_number", "damage_report", ["report_number"])
    op.create_index("ix_damage_report_status", "damage_report", ["status"])


def downgrade() -> None:
    op.drop_index("ix_damage_report_status", table_name="damage_report")
    op.drop_index("ix_damage_report_report_number", table_name="damage_report")
    op.drop_constraint("uq_damage_report_report_number", "damage_report", type_="unique")
    for name in ("status", "received_quantity", "report_number"):
        op.drop_column("damage_report", name)
