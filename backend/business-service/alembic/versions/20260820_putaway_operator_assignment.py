"""Add warehouse operator assignment to putaway tasks.

Revision ID: 20260820_putaway_operator
Revises: 20260819_rfq_fix, 20260820_handling_units
"""
from alembic import op
import sqlalchemy as sa


revision = "20260820_putaway_operator"
down_revision = ("20260819_rfq_fix", "20260820_handling_units")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("putaway_task", sa.Column("assigned_to", sa.String(length=128), nullable=True))
    op.add_column("putaway_task", sa.Column("assigned_by", sa.String(length=128), nullable=True))
    op.add_column("putaway_task", sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("putaway_task", sa.Column("material_category", sa.String(length=128), nullable=True))
    op.add_column("putaway_task", sa.Column("handling_requirement", sa.String(length=128), nullable=True))
    op.add_column("putaway_task", sa.Column("rotation_policy", sa.String(length=16), nullable=True))
    op.add_column("putaway_task", sa.Column("placement_metadata", sa.JSON(), nullable=True))
    op.create_index("ix_putaway_task_assigned_to", "putaway_task", ["assigned_to"], unique=False)
    op.execute("UPDATE putaway_task SET status = 'OPEN' WHERE status = 'PUTAWAY_PENDING'")
    op.add_column("putaway_movement", sa.Column("material_code", sa.String(length=64), nullable=True))
    op.add_column("putaway_movement", sa.Column("material_name", sa.String(length=256), nullable=True))
    op.add_column("putaway_movement", sa.Column("source_location", sa.String(length=128), nullable=True))
    op.add_column("putaway_movement", sa.Column("destination_location", sa.String(length=128), nullable=True))
    op.add_column("putaway_movement", sa.Column("batch_lot", sa.String(length=128), nullable=True))
    op.add_column("putaway_movement", sa.Column("serial_number", sa.String(length=128), nullable=True))
    op.add_column("putaway_movement", sa.Column("container_pallet", sa.String(length=128), nullable=True))


def downgrade() -> None:
    for column in ("container_pallet", "serial_number", "batch_lot", "destination_location", "source_location", "material_name", "material_code"):
        op.drop_column("putaway_movement", column)
    op.execute("UPDATE putaway_task SET status = 'PUTAWAY_PENDING' WHERE status = 'OPEN'")
    op.drop_index("ix_putaway_task_assigned_to", table_name="putaway_task")
    op.drop_column("putaway_task", "assigned_at")
    op.drop_column("putaway_task", "assigned_by")
    op.drop_column("putaway_task", "assigned_to")
    op.drop_column("putaway_task", "placement_metadata")
    op.drop_column("putaway_task", "rotation_policy")
    op.drop_column("putaway_task", "handling_requirement")
    op.drop_column("putaway_task", "material_category")
