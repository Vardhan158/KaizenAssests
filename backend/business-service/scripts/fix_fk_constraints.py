import asyncio
from sqlalchemy import text
from app.database.session import engine

async def main():
    async with engine.begin() as conn:
        print("Checking constraints...")
        # Get all foreign key constraints on pickup_task
        res = await conn.execute(text("""
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'pickup_task'::regclass
            AND contype = 'f'
        """))
        for row in res.fetchall():
            conname = row[0]
            print(f"Dropping constraint {conname} on pickup_task")
            await conn.execute(text(f'ALTER TABLE pickup_task DROP CONSTRAINT IF EXISTS "{conname}"'))

        # Re-add correct FKs
        await conn.execute(text("""
            ALTER TABLE pickup_task
            ADD CONSTRAINT fk_pickup_task_requisition_id_assembly_requisition
            FOREIGN KEY (requisition_id) REFERENCES assembly_requisition(id) ON DELETE CASCADE
        """))
        await conn.execute(text("""
            ALTER TABLE pickup_task
            ADD CONSTRAINT fk_pickup_task_store_id_store
            FOREIGN KEY (store_id) REFERENCES store(id) ON DELETE RESTRICT
        """))

        # Check inventory_issue_transaction constraints
        res2 = await conn.execute(text("""
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'inventory_issue_transaction'::regclass
            AND contype = 'f'
        """))
        for row in res2.fetchall():
            conname = row[0]
            print(f"Dropping constraint {conname} on inventory_issue_transaction")
            await conn.execute(text(f'ALTER TABLE inventory_issue_transaction DROP CONSTRAINT IF EXISTS "{conname}"'))

        await conn.execute(text("""
            ALTER TABLE inventory_issue_transaction
            ADD CONSTRAINT fk_inventory_issue_transaction_requisition_id_assembly_requisition
            FOREIGN KEY (requisition_id) REFERENCES assembly_requisition(id) ON DELETE SET NULL
        """))
        await conn.execute(text("""
            ALTER TABLE inventory_issue_transaction
            ADD CONSTRAINT fk_inventory_issue_transaction_store_id_store
            FOREIGN KEY (store_id) REFERENCES store(id) ON DELETE RESTRICT
        """))
        po_cols = [
            ("rfq_id", "UUID REFERENCES rfq(id) ON DELETE SET NULL"),
            ("supplier_id", "UUID REFERENCES supplier(id) ON DELETE SET NULL"),
            ("supplier_name", "VARCHAR(255)"),
            ("warehouse_id", "VARCHAR(64)"),
            ("total_amount", "NUMERIC(18, 4) DEFAULT 0"),
            ("expected_delivery_date", "DATE"),
            ("payment_terms", "VARCHAR(128)"),
            ("procurement_officer", "VARCHAR(128)"),
            ("department", "VARCHAR(128)"),
            ("supplier_code", "VARCHAR(64)"),
            ("supplier_contact_person", "VARCHAR(128)"),
            ("supplier_phone", "VARCHAR(32)"),
            ("supplier_email", "VARCHAR(128)"),
            ("supplier_gstin", "VARCHAR(32)"),
            ("supplier_address", "TEXT"),
            ("delivery_warehouse_name", "VARCHAR(128)"),
            ("delivery_address", "TEXT"),
            ("subtotal", "NUMERIC(18, 4) DEFAULT 0"),
            ("discount_amount", "NUMERIC(18, 4) DEFAULT 0"),
            ("tax_amount", "NUMERIC(18, 4) DEFAULT 0"),
            ("freight_charges", "NUMERIC(18, 4) DEFAULT 0"),
            ("additional_charges", "NUMERIC(18, 4) DEFAULT 0"),
            ("selection_reason", "VARCHAR(500)"),
            ("procurement_comments", "TEXT"),
            ("selection_date", "TIMESTAMP"),
            ("selected_by", "VARCHAR(128)"),
            ("rejection_reason", "TEXT"),
            ("updated_at", "TIMESTAMP DEFAULT now()"),
        ]
        for col, col_type in po_cols:
            try:
                await conn.execute(text(f"ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS {col} {col_type}"))
            except Exception as e:
                print(f"Error adding {col}: {e}")

        req_cols = [
            ("assembly_requisition_item", "is_custom", "BOOLEAN DEFAULT FALSE"),
            ("assembly_requisition_item", "custom_material_name", "VARCHAR"),
            ("material_request_item", "is_custom", "BOOLEAN DEFAULT FALSE"),
            ("material_request_item", "custom_material_name", "VARCHAR"),
        ]
        for tbl, col, col_type in req_cols:
            try:
                await conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS {col} {col_type}"))
                print(f"Added column {col} to {tbl}")
            except Exception as e:
                print(f"Error adding {col} to {tbl}: {e}")

        print("Constraints and columns fixed successfully!")

if __name__ == "__main__":
    asyncio.run(main())
