import asyncio
import os
import sys


sys.path.append(os.getcwd())

from sqlalchemy import text
from app.database.session import session_scope
from app.logging.logger import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)

async def cleanup_gate_data():
    tables_to_clean = [
        "gate_entry_audit_log",
        "gate_entry_ocr_results",
        "gate_entry_field_mismatches",
        "gate_entry",
        "gate_entries"
    ]

    async with session_scope() as session:
        for table in tables_to_clean:
            try:
                
                check_query = text(f"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '{table}')")
                result = await session.execute(check_query)
                exists = result.scalar()

                if exists:
                    logger.info(f"Cleaning table: {table}")
                    await session.execute(text(f"DELETE FROM {table}"))
                    logger.info(f"Successfully deleted all data from {table}")
                else:
                    logger.info(f"Table {table} does not exist, skipping.")
            except Exception as e:
                logger.error(f"Failed to clean table {table}: {e}")

        await session.commit()

    print("\nGate entry data cleanup complete.")

if __name__ == "__main__":
    asyncio.run(cleanup_gate_data())
