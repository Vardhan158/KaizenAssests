"""Add executable steps to assembly work orders.

Revision ID: 20260827_assembly_steps
Revises: 20260826_assembly_reservation
"""

import json

from alembic import op
import sqlalchemy as sa


revision = "20260827_assembly_steps"
down_revision = "20260826_assembly_reservation"
branch_labels = None
depends_on = None

STEP_NAMES = [
    "Housing preparation", "PCB installation", "Cable connection",
    "Component installation", "Testing", "Final assembly",
]


def upgrade() -> None:
    op.add_column("assembly_order", sa.Column("assembly_steps", sa.JSON(), nullable=False, server_default="[]"))
    steps = [{"id": str(index), "sequence": index, "name": name, "status": "NOT_STARTED", "started_at": None, "completed_at": None}
             for index, name in enumerate(STEP_NAMES, start=1)]
    op.execute(sa.text("UPDATE assembly_order SET assembly_steps = CAST(:steps AS JSON)").bindparams(steps=json.dumps(steps)))


def downgrade() -> None:
    op.drop_column("assembly_order", "assembly_steps")
