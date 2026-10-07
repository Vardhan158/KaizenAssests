from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260820_mr_outbound"
down_revision = "20260820_putaway_operator"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    if "material_request" not in existing_tables:
        op.create_table(
            "material_request",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("request_number", sa.String(64), unique=True, nullable=False),
            sa.Column("warehouse_id", sa.String(64), nullable=False),
            sa.Column("department", sa.String(128), nullable=False),
            sa.Column("requested_by", sa.String(128), nullable=False),
            sa.Column("status", sa.String(32), default="DRAFT", nullable=False),
            sa.Column("required_date", sa.DateTime(), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("approved_by", sa.String(128), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        )
    else:
        mr_cols = {c["name"] for c in inspector.get_columns("material_request")}
        if "approved_by" not in mr_cols:
            op.add_column("material_request", sa.Column("approved_by", sa.String(128), nullable=True))
        if "approved_at" not in mr_cols:
            op.add_column("material_request", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))

    if "material_request_item" not in existing_tables:
        op.create_table(
            "material_request_item",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("request_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("material_request.id", ondelete="CASCADE"), nullable=False),
            sa.Column("material_code", sa.String(64), nullable=False),
            sa.Column("material_name", sa.String(256), nullable=False),
            sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(32), nullable=False, server_default="PCS"),
        )

    if "stock_reservation" not in existing_tables:
        op.create_table(
            "stock_reservation",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("request_id", sa.Uuid(), sa.ForeignKey("material_request.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("request_item_id", sa.Uuid(), sa.ForeignKey("material_request_item.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("material_code", sa.String(64), nullable=False),
            sa.Column("warehouse_id", sa.String(64), nullable=False),
            sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(32), nullable=False),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("allocations", sa.JSON(), nullable=False),
            sa.Column("reserved_by", sa.String(128), nullable=False),
            sa.Column("reserved_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("request_item_id", name="uq_stock_reservation_request_item"),
        )
        op.create_index("ix_stock_reservation_request_id", "stock_reservation", ["request_id"])
        op.create_index("ix_stock_reservation_material_code", "stock_reservation", ["material_code"])

    if "pick_task" not in existing_tables:
        op.create_table(
            "pick_task",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("task_number", sa.String(64), nullable=False, unique=True),
            sa.Column("request_id", sa.Uuid(), sa.ForeignKey("material_request.id", ondelete="RESTRICT"), nullable=False, unique=True),
            sa.Column("request_number", sa.String(64), nullable=False),
            sa.Column("warehouse_id", sa.String(64), nullable=False),
            sa.Column("department", sa.String(64), nullable=False),
            sa.Column("items", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("created_by", sa.String(128), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_pick_task_task_number", "pick_task", ["task_number"])
        op.create_index("ix_pick_task_request_id", "pick_task", ["request_id"])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    if "pick_task" in existing_tables:
        op.drop_table("pick_task")
    if "stock_reservation" in existing_tables:
        op.drop_table("stock_reservation")
    if "material_request" in existing_tables:
        mr_cols = {c["name"] for c in inspector.get_columns("material_request")}
        if "approved_at" in mr_cols:
            op.drop_column("material_request", "approved_at")
        if "approved_by" in mr_cols:
            op.drop_column("material_request", "approved_by")
