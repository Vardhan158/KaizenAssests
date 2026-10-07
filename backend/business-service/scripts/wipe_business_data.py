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

async def wipe_all_business_data():
    """
    Wipes all data from the business database while preserving the schema and migrations.
    """
    async with session_scope() as session:
        # Get all tables in the public schema
        # We exclude alembic_version to keep the migration state
        query = text("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
              AND table_name != 'alembic_version';
        """)

        result = await session.execute(query)
        tables = [row[0] for row in result.fetchall()]

        if not tables:
            logger.info("No tables found to wipe.")
            return

        logger.warning(f"Preparing to wipe {len(tables)} tables: {', '.join(tables)}")

        # We use CASCADE to handle foreign key dependencies
        truncate_query = text(f"TRUNCATE TABLE {', '.join(tables)} CASCADE;")

        try:
            await session.execute(truncate_query)
            await session.commit()
            logger.info("Successfully wiped all business data.")
        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to wipe business data: {e}")
            raise

if __name__ == "__main__":
    force = "--force" in sys.argv
    if not force:
        print("!!! WARNING: THIS WILL PERMANENTLY DELETE ALL BUSINESS DATA !!!")
        confirm = input("Are you sure you want to proceed? (yes/no): ")
    else:
        confirm = "yes"

    if confirm.lower() == 'yes':
        asyncio.run(wipe_all_business_data())
    else:
        print("Operation cancelled.")
