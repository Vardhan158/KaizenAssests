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

async def wipe_grn_data():
    """
    Wipes all data from GRN and Goods Receiving module tables in PostgreSQL database.
    """
    async with session_scope() as session:
        grn_tables = [
            "grn_damage_qr",
            "grn_damage_lot",
            "grn_batch_qr",
            "grn_batch",
            "grn_damage_evidence",
            "grn_line",
            "inventory_receipt_posting",
            "grn",
        ]

        existing_tables = []
        for tbl in grn_tables:
            res = await session.execute(
                text("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=:t);"),
                {"t": tbl},
            )
            if res.scalar():
                existing_tables.append(tbl)

        if existing_tables:
            logger.warning(f"Truncating GRN tables: {', '.join(existing_tables)}")
            stmt = text(f"TRUNCATE TABLE {', '.join(existing_tables)} CASCADE;")
            await session.execute(stmt)
            await session.commit()
            logger.info("Successfully wiped all GRN module database data.")
            print(f"Successfully wiped all GRN module database data from tables: {', '.join(existing_tables)}")
        else:
            logger.info("No GRN tables found in database.")
            print("No GRN tables found in database.")

if __name__ == "__main__":
    asyncio.run(wipe_grn_data())
