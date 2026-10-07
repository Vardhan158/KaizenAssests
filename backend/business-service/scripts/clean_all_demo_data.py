"""
Clean All Demo / Dummy / Test Data from WMS Business Database.

Safely purges all transactional, operational, and master demo records while strictly preserving:
1. Database schema, tables, foreign keys, indexes, triggers, and sequences.
2. Alembic migration tracking history (alembic_version).
3. Configuration and system reference lookup tables:
   - quantity_verification_policy
   - supplier_category
   - vendor_type
"""
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import asyncio
import logging
from sqlalchemy import text
from app.database.session import session_scope

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("cleanup")

PRESERVED_TABLES = {
    "alembic_version",
    "quantity_verification_policy",
    "supplier_category",
    "vendor_type",
}

async def clean_database():
    logger.info("==================================================")
    logger.info("STARTING COMPLETE CLEANUP OF DEMO DATA IN WMS DB")
    logger.info("==================================================")

    async with session_scope() as session:
        # Discover all public tables
        query = text("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        """)
        res = await session.execute(query)
        all_tables = [r[0] for r in res.fetchall()]
        
        tables_to_truncate = [t for t in all_tables if t not in PRESERVED_TABLES]
        logger.info(f"Discovered {len(all_tables)} total tables in database.")
        logger.info(f"Preserving {len(PRESERVED_TABLES)} system/reference tables: {sorted(list(PRESERVED_TABLES))}")
        logger.info(f"Targeting {len(tables_to_truncate)} tables for truncation.")

        if tables_to_truncate:
            # Build TRUNCATE statement with CASCADE to handle foreign key dependencies cleanly
            table_list_sql = ", ".join(f'"{t}"' for t in tables_to_truncate)
            truncate_stmt = f"TRUNCATE TABLE {table_list_sql} CASCADE;"
            logger.info("Executing TRUNCATE CASCADE on business tables...")
            await session.execute(text(truncate_stmt))
            await session.commit()
            logger.info("TRUNCATE CASCADE completed successfully.")

    # Verification phase
    logger.info("==================================================")
    logger.info("VERIFYING POST-CLEANUP ROW COUNTS:")
    logger.info("==================================================")

    async with session_scope() as session:
        total_remaining_rows = 0
        cleaned_tables_count = 0

        for t in all_tables:
            c = await session.execute(text(f'SELECT COUNT(*) FROM "{t}"'))
            count = c.scalar()
            if t in PRESERVED_TABLES:
                logger.info(f"[PRESERVED REFERENCE] {t}: {count} rows")
            else:
                if count == 0:
                    cleaned_tables_count += 1
                else:
                    logger.warning(f"[NON-ZERO WARNING] {t}: {count} rows remaining!")
                    total_remaining_rows += count

        logger.info("==================================================")
        logger.info(f"Cleanup Summary: {cleaned_tables_count}/{len(tables_to_truncate)} business tables verified clean (0 rows).")
        logger.info(f"Preserved tables: {len(PRESERVED_TABLES)} reference tables intact.")
        if total_remaining_rows == 0:
            logger.info("STATUS: SUCCESS - All business and demo data completely removed!")
        else:
            logger.error(f"STATUS: WARNING - {total_remaining_rows} non-reference rows remain.")
        logger.info("==================================================")

if __name__ == "__main__":
    asyncio.run(clean_database())
