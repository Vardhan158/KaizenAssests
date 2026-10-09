"""assembly order phase 1 schema adjustments

Revision ID: 20261007_assembly_orders_phase1
Revises: 20261006_asn_logistics
Create Date: 2026-10-07
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa


revision: str = "20261007_assembly_orders_phase1"
down_revision: Union[str, Sequence[str], None] = "20261006_asn_logistics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("assembly_order")}

    # Make foreign keys and legacy request columns nullable
    op.alter_column("assembly_order", "material_request_id", nullable=True)
    op.alter_column("assembly_order", "pick_task_id", nullable=True)
    op.alter_column("assembly_order", "material_issue_id", nullable=True)
    op.alter_column("assembly_order", "request_number", nullable=True)
    op.alter_column("assembly_order", "department", server_default="Assembly", nullable=False)

    # Add product_code, product_id, uom if not present
    if "product_code" not in cols:
        op.add_column("assembly_order", sa.Column("product_code", sa.String(64), nullable=True, index=True))
    if "product_id" not in cols:
        op.add_column("assembly_order", sa.Column("product_id", sa.String(64), nullable=True))
    if "uom" not in cols:
        op.add_column("assembly_order", sa.Column("uom", sa.String(32), server_default="PCS", nullable=False))

    # Seed assembly lines if empty
    op.execute("""
        INSERT INTO assembly_line (id, code, name, status, created_at, updated_at)
        SELECT gen_random_uuid(), 'LINE-01', 'Assembly Line 01', 'ACTIVE', NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM assembly_line WHERE code = 'LINE-01');
    """)
    op.execute("""
        INSERT INTO assembly_line (id, code, name, status, created_at, updated_at)
        SELECT gen_random_uuid(), 'LINE-02', 'Assembly Line 02', 'ACTIVE', NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM assembly_line WHERE code = 'LINE-02');
    """)

    # Seed Industrial Pump Controller BOM (FG-IPC-001) if not present
    op.execute("""
        DO $$
        DECLARE
            v_bom_id uuid := gen_random_uuid();
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM bill_of_materials WHERE product_code = 'FG-IPC-001') THEN
                INSERT INTO bill_of_materials (id, bom_number, product_code, product_name, description, status, created_by, created_at, updated_at)
                VALUES (v_bom_id, 'BOM-20261007-0001', 'FG-IPC-001', 'Industrial Pump Controller', 'Industrial Pump Controller Standard BOM', 'ACTIVE', 'System', NOW(), NOW());

                INSERT INTO bill_of_materials_item (id, bom_id, material_code, material_name, quantity_per_unit, uom, created_at)
                VALUES 
                    (gen_random_uuid(), v_bom_id, 'PCB-CTRL-01', 'Controller PCB', 1.0, 'PCS', NOW()),
                    (gen_random_uuid(), v_bom_id, 'HSG-ALUM-01', 'Housing', 1.0, 'PCS', NOW()),
                    (gen_random_uuid(), v_bom_id, 'WR-HRN-01', 'Wiring Harness', 1.0, 'PCS', NOW()),
                    (gen_random_uuid(), v_bom_id, 'CONN-SET-01', 'Connector Set', 2.0, 'PCS', NOW()),
                    (gen_random_uuid(), v_bom_id, 'SCR-M4-01', 'M4 Screw', 8.0, 'PCS', NOW());
            END IF;
        END $$;
    """)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("assembly_order")}

    if "uom" in cols:
        op.drop_column("assembly_order", "uom")
    if "product_id" in cols:
        op.drop_column("assembly_order", "product_id")
    if "product_code" in cols:
        op.drop_column("assembly_order", "product_code")
