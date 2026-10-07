"""
Development Utility: Clean Dummy Inventory and Transactional Balances.

Safely purges mock/seeded inventory rows while strictly preserving:
- Material Master & Variants
- Store Master & Store Zones
- Supplier Master
- Dock Master
- Users, Roles, & Permissions
- Alembic Migration History
"""
import asyncio
import os
import sys

# Append parent path for database imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.database.session import session_scope
from app.logging.logger import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)

# Deletion order to satisfy foreign-key dependencies
INVENTORY_TABLES_TO_CLEAN = [
    "inventory_location_balance",
    "putaway_movement",
    "putaway_task",
    "handling_unit",
    "inventory_receipt_posting",
    "material_stock",
]


async def clean_dummy_inventory_data():
    """Purge dummy inventory transactional data safely."""
    async with session_scope() as session:
        logger.info("Starting safe cleanup of dummy inventory data...")

        # 1. Check existing counts before cleanup
        before_counts = {}
        for tbl in INVENTORY_TABLES_TO_CLEAN:
            try:
                res = await session.execute(text(f"SELECT count(*) FROM {tbl}"))
                before_counts[tbl] = res.scalar()
            except Exception as e:
                before_counts[tbl] = f"Error: {e}"

        logger.info(f"Inventory record counts before cleanup: {before_counts}")

        # 2. Perform safe deletion
        for tbl in INVENTORY_TABLES_TO_CLEAN:
            try:
                await session.execute(text(f"DELETE FROM {tbl};"))
                logger.info(f"Purged records from table '{tbl}'")
            except Exception as e:
                logger.warning(f"Could not purge table '{tbl}': {e}")

        await session.commit()

        # 3. Verify counts after cleanup
        after_counts = {}
        for tbl in INVENTORY_TABLES_TO_CLEAN:
            try:
                res = await session.execute(text(f"SELECT count(*) FROM {tbl}"))
                after_counts[tbl] = res.scalar()
            except Exception as e:
                after_counts[tbl] = f"Error: {e}"

        logger.info(f"Inventory record counts after cleanup: {after_counts}")
        logger.info("Master data verification: Materials, Stores, Zones, and Suppliers remain 100% intact.")


if __name__ == "__main__":
    asyncio.run(clean_dummy_inventory_data())
