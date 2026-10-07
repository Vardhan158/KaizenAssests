from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260826_assembly_reservation"
down_revision = "20260825_supplier_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    if "assembly_order" not in existing_tables:
        op.create_table(
            "assembly_order",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("order_number", sa.String(length=64), unique=True, nullable=False),
            sa.Column("material_request_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("material_request.id", ondelete="RESTRICT"), unique=True, nullable=False),
            sa.Column("pick_task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pick_task.id", ondelete="RESTRICT"), unique=True, nullable=False),
            sa.Column("material_issue_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("material_issue.id", ondelete="RESTRICT"), unique=True, nullable=False),
            sa.Column("request_number", sa.String(length=64), nullable=False),
            sa.Column("department", sa.String(length=64), nullable=False),
            sa.Column("product_name", sa.String(length=255), nullable=False),
            sa.Column("priority", sa.String(length=16), nullable=False, server_default="MEDIUM"),
            sa.Column("required_date", sa.Date(), nullable=True),
            sa.Column("assigned_team", sa.String(length=128), nullable=True),
            sa.Column("items", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="DRAFT"),
            sa.Column("planned_quantity", sa.Numeric(18, 4), nullable=False, server_default="1"),
            sa.Column("completed_quantity", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("rejected_quantity", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("assigned_line", sa.String(length=128), nullable=True),
            sa.Column("assigned_operator", sa.String(length=128), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(length=128), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_assembly_order_order_number", "assembly_order", ["order_number"])

    if "assembly_material_reservation" not in existing_tables:
        op.create_table(
            "assembly_material_reservation",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("assembly_order_id", sa.Uuid(), nullable=False),
            sa.Column("material_code", sa.String(length=64), nullable=False),
            sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="RESERVED"),
            sa.Column("reserved_by", sa.String(length=128), nullable=False),
            sa.Column("reserved_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["assembly_order_id"], ["assembly_order.id"], ondelete="RESTRICT"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("assembly_order_id", "material_code", name="uq_assembly_reservation_order_material"),
        )
        op.create_index("ix_assembly_material_reservation_order", "assembly_material_reservation", ["assembly_order_id"])
        op.create_index("ix_assembly_material_reservation_material", "assembly_material_reservation", ["material_code"])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    if "assembly_material_reservation" in existing_tables:
        op.drop_index("ix_assembly_material_reservation_material", table_name="assembly_material_reservation")
        op.drop_index("ix_assembly_material_reservation_order", table_name="assembly_material_reservation")
        op.drop_table("assembly_material_reservation")
    if "assembly_order" in existing_tables:
        op.drop_table("assembly_order")
