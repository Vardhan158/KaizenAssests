import asyncio
import os
import sys

# Add the parent directory to sys.path so we can import app modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.database.session import session_scope
from app.logging.logger import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)

async def wipe_procurement_data():
    """
    Wipes all data related to the Procurement Management module.
    """
    # Order matters for non-cascade deletes, but we'll use CASCADE where possible.
    # We list all tables identified as procurement-related.
    tables_to_wipe = [
        "po_approval_history",
        "purchase_order_item",
        "purchase_order",
        "asn_document",
        "asn_line",
        "asn",
        "quotation_document",
        "quotation_line",
        "quotation",
        "rfq_item",
        "rfq_supplier_link",
        "rfq",
        "supplier_user",
        "supplier_document",
        "supplier_bank_info",
        "supplier_contact",
        "supplier_address",
        "supplier_material_link",
        "supplier",
        "material_request_item",
        "material_request",
        "material_stock",
        "arrival_notification",
        "raw_material_master",
        "supplier_category",
        "vendor_type",
        "material"
    ]

    async with session_scope() as session:
        logger.info("Starting Procurement data wipe...")

        # 1. Clear notifications specific to procurement roles if the table exists
        try:
            await session.execute(text("DELETE FROM notification WHERE user_role IN ('PROCUREMENT', 'FINANCE', 'WAREHOUSE')"))
            logger.info("Cleared procurement-related notifications.")
        except Exception as e:
            logger.warning(f"Could not clear notifications (table might not exist or schema differs): {e}")

        # 2. Truncate identified tables
        for table in tables_to_wipe:
            try:
                # Check if table exists
                check_query = text(f"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '{table}')")
                result = await session.execute(check_query)
                exists = result.scalar()

                if exists:
                    logger.info(f"Wiping table: {table}")
                    # Using TRUNCATE with CASCADE to handle any remaining FK constraints
                    await session.execute(text(f"TRUNCATE TABLE {table} CASCADE"))
                    logger.info(f"Successfully wiped {table}")
                else:
                    logger.info(f"Table {table} does not exist, skipping.")
            except Exception as e:
                logger.error(f"Failed to wipe table {table}: {e}")

        await session.commit()
        logger.info("Procurement data wipe complete.")

if __name__ == "__main__":
    print("!!! WARNING: THIS WILL PERMANENTLY DELETE ALL PROCUREMENT MANAGEMENT DATA !!!")
    confirm = input("Are you sure you want to proceed? (yes/no): ")
    if confirm.lower() == 'yes':
        asyncio.run(wipe_procurement_data())
    else:
        print("Operation cancelled.")
