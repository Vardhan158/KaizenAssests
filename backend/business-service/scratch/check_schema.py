import asyncio
from sqlalchemy import text
from app.database.session import AsyncSessionFactory

async def check_schema():
    async with AsyncSessionFactory() as session:
        res = await session.execute(text("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'assembly_order';
        """))
        for row in res.fetchall():
            print(row)

if __name__ == "__main__":
    asyncio.run(check_schema())
