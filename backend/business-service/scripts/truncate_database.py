"""
Wipe all data from all PostgreSQL database tables while preserving schema and migrations.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import text
from app.database.session import session_scope


async def truncate_all():
    print("==================================================")
    print("TRUNCATING ALL TABLES IN POSTGRESQL DATABASE")
    print("==================================================")

    async with session_scope() as session:
        # Get all table names in public schema except alembic_version
        query = text("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
              AND table_type = 'BASE TABLE'
              AND table_name != 'alembic_version'
            ORDER BY table_name;
        """)
        res = await session.execute(query)
        tables = [r[0] for r in res.fetchall()]

        if not tables:
            print("No tables found in database.")
            return

        print(f"Found {len(tables)} tables to truncate:")
        for t in tables:
            print(f"  • {t}")

        # Disable triggers or truncate in cascade
        table_list_sql = ", ".join([f'"{t}"' for t in tables])
        truncate_sql = text(f"TRUNCATE TABLE {table_list_sql} RESTART IDENTITY CASCADE;")
        
        print("\nExecuting TRUNCATE CASCADE...")
        await session.execute(truncate_sql)
        await session.commit()
        print("[SUCCESS] All tables truncated successfully!")

        # Verify zero rows in all tables
        print("\nVerifying row counts:")
        total_remaining = 0
        for t in tables:
            count_res = await session.execute(text(f'SELECT COUNT(*) FROM "{t}"'))
            count = count_res.scalar()
            total_remaining += count
            if count > 0:
                print(f"  ! {t}: {count} rows")
        
        if total_remaining == 0:
            print("[SUCCESS] Confirmed: 0 rows in all 89 tables. Database is completely clean and empty.")
        else:
            print(f"Warning: {total_remaining} rows remaining.")


if __name__ == "__main__":
    asyncio.run(truncate_all())
