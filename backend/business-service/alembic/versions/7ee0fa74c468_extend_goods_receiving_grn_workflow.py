"""Extend Goods Receiving / GRN workflow.

Revision ID: 7ee0fa74c468
Revises: 20260820_putaway_operator
Create Date: 2026-08-27

This migration intentionally contains GRN/receiving changes only.
It does NOT drop or modify Storage, Putaway, Handling Unit,
Procurement, Supplier, RFQ, Notification, or unrelated tables.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7ee0fa74c468"
down_revision: Union[str, None] = "20260820_putaway_operator"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    # ------------------------------------------------------------------
    # 2. GRN document uploads
    # ------------------------------------------------------------------
    if "grn_document" not in existing_tables:
        op.create_table(
            "grn_document",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("grn_id", sa.UUID(), nullable=False),
            sa.Column("document_type", sa.String(length=64), nullable=False),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("file_path", sa.String(length=512), nullable=False),
            sa.Column("uploaded_by", sa.String(length=128), nullable=False),
            sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["grn_id"],
                ["grn.id"],
                name="fk_grn_document_grn_id_grn",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint(
                "id",
                name="pk_grn_document",
            ),
        )

    bind.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_grn_document_grn_id ON grn_document (grn_id)"))

    # ------------------------------------------------------------------
    # 3. GRN batches
    # ------------------------------------------------------------------
    if "grn_batch" not in existing_tables:
        op.create_table(
            "grn_batch",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("grn_line_id", sa.UUID(), nullable=False),
            sa.Column("batch_number", sa.String(length=64), nullable=False),
            sa.Column(
                "batch_quantity",
                sa.Numeric(precision=18, scale=4),
                nullable=False,
            ),
            sa.Column("created_by", sa.String(length=128), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["grn_line_id"],
                ["grn_line.id"],
                name="fk_grn_batch_grn_line_id_grn_line",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint(
                "id",
                name="pk_grn_batch",
            ),
        )

    bind.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_grn_batch_batch_number ON grn_batch (batch_number)"))
    bind.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_grn_batch_grn_line_id ON grn_batch (grn_line_id)"))

    # ------------------------------------------------------------------
    # 4. Damage evidence / multiple photos
    # ------------------------------------------------------------------
    if "grn_damage_evidence" not in existing_tables:
        op.create_table(
            "grn_damage_evidence",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("grn_line_id", sa.UUID(), nullable=False),
            sa.Column(
                "damaged_quantity",
                sa.Numeric(precision=18, scale=4),
                nullable=False,
            ),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("file_path", sa.String(length=512), nullable=False),
            sa.Column("uploaded_by", sa.String(length=128), nullable=False),
            sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["grn_line_id"],
                ["grn_line.id"],
                name="fk_grn_damage_evidence_grn_line_id_grn_line",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint(
                "id",
                name="pk_grn_damage_evidence",
            ),
        )

    bind.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_grn_damage_evidence_grn_line_id ON grn_damage_evidence (grn_line_id)"))

    # ------------------------------------------------------------------
    # 5. One batch -> one QR code
    # ------------------------------------------------------------------
    if "grn_batch_qr" not in existing_tables:
        op.create_table(
            "grn_batch_qr",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("batch_id", sa.UUID(), nullable=False),
            sa.Column("qr_code", sa.String(length=128), nullable=False),
            sa.Column("qr_payload", sa.Text(), nullable=False),
            sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["batch_id"],
                ["grn_batch.id"],
                name="fk_grn_batch_qr_batch_id_grn_batch",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint(
                "id",
                name="pk_grn_batch_qr",
            ),
        )

    bind.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_grn_batch_qr_batch_id ON grn_batch_qr (batch_id)"))
    bind.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_grn_batch_qr_qr_code ON grn_batch_qr (qr_code)"))

    # ------------------------------------------------------------------
    # 6. GRN header fields
    # ------------------------------------------------------------------
    grn_cols = {c["name"] for c in inspector.get_columns("grn")}
    if "gate_entry_id" not in grn_cols:
        bind.execute(sa.text("ALTER TABLE grn ADD COLUMN IF NOT EXISTS gate_entry_id UUID"))
    if "gate_entry_number" not in grn_cols:
        bind.execute(sa.text("ALTER TABLE grn ADD COLUMN IF NOT EXISTS gate_entry_number VARCHAR(64)"))
    if "supplier_company_name" not in grn_cols:
        bind.execute(sa.text("ALTER TABLE grn ADD COLUMN IF NOT EXISTS supplier_company_name VARCHAR(255)"))
    if "warehouse_name" not in grn_cols:
        bind.execute(sa.text("ALTER TABLE grn ADD COLUMN IF NOT EXISTS warehouse_name VARCHAR(255)"))
    if "driver_name" not in grn_cols:
        bind.execute(sa.text("ALTER TABLE grn ADD COLUMN IF NOT EXISTS driver_name VARCHAR(128)"))
    if "invoice_number" not in grn_cols:
        bind.execute(sa.text("ALTER TABLE grn ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(128)"))
    if "receipt_type" not in grn_cols:
        bind.execute(sa.text("ALTER TABLE grn ADD COLUMN IF NOT EXISTS receipt_type VARCHAR(32) DEFAULT 'PO_RECEIPT' NOT NULL"))
    if "receipt_date" not in grn_cols:
        bind.execute(sa.text("ALTER TABLE grn ADD COLUMN IF NOT EXISTS receipt_date TIMESTAMPTZ"))
    if "received_by" not in grn_cols:
        bind.execute(sa.text("ALTER TABLE grn ADD COLUMN IF NOT EXISTS received_by VARCHAR(128)"))
    if "created_at" not in grn_cols:
        bind.execute(sa.text("ALTER TABLE grn ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL"))
    if "updated_at" not in grn_cols:
        bind.execute(sa.text("ALTER TABLE grn ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL"))

    # Safely create indexes on grn
    bind.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_grn_po_id ON grn (po_id)"))
    bind.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_grn_po_number ON grn (po_number)"))

    # ------------------------------------------------------------------
    # 7. GRN line workflow fields
# ------------------------------------------------------------------
    grn_line_cols = {c["name"] for c in inspector.get_columns("grn_line")}

    if "material_category" not in grn_line_cols:
        bind.execute(sa.text("ALTER TABLE grn_line ADD COLUMN IF NOT EXISTS material_category VARCHAR(128)"))

    if "good_quantity" not in grn_line_cols:
        bind.execute(sa.text("ALTER TABLE grn_line ADD COLUMN IF NOT EXISTS good_quantity NUMERIC(18, 4) DEFAULT 0 NOT NULL"))

    if "quality_approved_quantity" not in grn_line_cols:
        bind.execute(sa.text("ALTER TABLE grn_line ADD COLUMN IF NOT EXISTS quality_approved_quantity NUMERIC(18, 4) DEFAULT 0 NOT NULL"))

    if "balance_quantity" not in grn_line_cols:
        bind.execute(sa.text("ALTER TABLE grn_line ADD COLUMN IF NOT EXISTS balance_quantity NUMERIC(18, 4) DEFAULT 0 NOT NULL"))

    if "damaged_quantity" not in grn_line_cols:
        bind.execute(sa.text("ALTER TABLE grn_line ADD COLUMN IF NOT EXISTS damaged_quantity NUMERIC(18, 4) DEFAULT 0 NOT NULL"))

    bind.execute(sa.text("UPDATE grn_line SET damaged_quantity = 0 WHERE damaged_quantity IS NULL"))

    bind.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_grn_line_grn_id ON grn_line (grn_id)"))
    bind.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_grn_line_item_code ON grn_line (item_code)"))
def downgrade() -> None:
    pass
