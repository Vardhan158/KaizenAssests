"""allow dock assignments without purchase orders

PO references are optional because dock allocation is driven by ASN/gate
entry data. Existing databases still have the original NOT NULL constraint.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261009_dock_assignment_po_optional"
down_revision: Union[str, Sequence[str], None] = "20261006_asn_logistics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"]: column for column in sa.inspect(bind).get_columns("dock_assignment")}
    if "po_id" in columns and columns["po_id"].get("nullable") is False:
        op.alter_column("dock_assignment", "po_id", nullable=True)


def downgrade() -> None:
    op.alter_column("dock_assignment", "po_id", nullable=False)
