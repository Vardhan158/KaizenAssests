import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def main():
    url = "postgresql+asyncpg://ams_business:ams_business@localhost:5432/ams_business"
    engine = create_async_engine(url)

    # List of tables and their ID columns that should be UUID
    # Based on procurement models and typical project structure
    targets = [
        ("supplier", "id"),
        ("supplier_address", "id"),
        ("supplier_contact", "id"),
        ("supplier_bank_info", "id"),
        ("supplier_document", "id"),
        ("material", "id"),
        ("rfq", "id"),
        ("rfq_item", "id"),
        ("quotation", "id"),
        ("quotation_line", "id"),
        ("asn", "id"),
        ("asn_line", "id"),
        ("purchase_order", "id"),
        ("purchase_order_item", "id"),
        ("material_request", "id"),
        ("material_request_item", "id"),
        ("stock_reservation", "id"),
        ("pick_task", "id"),
        ("material_issue", "id"),
        ("material_stock", "id"),
        ("notification", "id"),
        ("gate_entry", "id"),
        ("warehouse_dock", "id"),
        ("dock_assignment", "id"),
        ("receiving_line", "id"),
        ("grn", "id"),
        ("grn_line", "id"),
        ("inventory_receipt_posting", "id")
    ]

    # Foreign keys that also need to be UUID
    fks = [
        ("supplier_address", "supplier_id"),
        ("supplier_contact", "supplier_id"),
        ("supplier_bank_info", "supplier_id"),
        ("supplier_document", "supplier_id"),
        ("rfq", "selected_supplier_id"),
        ("rfq_item", "rfq_id"),
        ("quotation", "rfq_id"),
        ("quotation", "supplier_id"),
        ("quotation_line", "quotation_id"),
        ("asn", "supplier_id"),
        ("asn_line", "asn_id"),
        ("purchase_order", "rfq_id"),
        ("purchase_order", "supplier_id"),
        ("purchase_order_item", "purchase_order_id"),
        ("material_request_item", "request_id"),
        ("stock_reservation", "request_id"),
        ("stock_reservation", "request_item_id"),
        ("pick_task", "request_id"),
        ("material_issue", "pick_task_id"),
        ("material_issue", "request_id"),
        ("arrival_notification", "asn_id"),
        ("dock_assignment", "gate_entry_id"),
        ("dock_assignment", "asn_id"),
        ("dock_assignment", "po_id"),
        ("receiving_line", "dock_assignment_id"),
        ("grn", "po_id"),
        ("grn", "asn_id"),
        ("grn_line", "grn_id"),
        ("inventory_receipt_posting", "grn_id"),
        ("inventory_receipt_posting", "po_id"),
        ("inventory_receipt_posting", "asn_id")
    ]

    try:
        async with engine.begin() as conn:
            print("Checking and fixing column types...")

            # Helper to check if a column exists and what its type is
            async def get_col_info(table, col):
                q = text(f"""
                    SELECT data_type
                    FROM information_schema.columns
                    WHERE table_name = '{table}' AND column_name = '{col}'
                """)
                res = await conn.execute(q)
                row = res.fetchone()
                return row[0] if row else None

            all_columns = targets + fks
            # Remove duplicates while preserving order
            unique_columns = []
            seen = set()
            for t, c in all_columns:
                if (t, c) not in seen:
                    unique_columns.append((t, c))
                    seen.add((t, c))

            for table, col in unique_columns:
                data_type = await get_col_info(table, col)
                if data_type and data_type != 'uuid':
                    print(f"Fixing {table}.{col}: current type is {data_type}, changing to uuid")
                    try:
                        # Drop constraints first if they exist?
                        # Actually Postgres allows ALTER TYPE if USING is provided,
                        # but FKs can be tricky.
                        await conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE UUID USING {col}::uuid"))
                        print(f"  Successfully converted {table}.{col}")
                    except Exception as e:
                        print(f"  Failed to convert {table}.{col}: {e}")

            print("Done.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
