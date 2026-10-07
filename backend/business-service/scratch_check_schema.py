import asyncio
from app.database.session import AsyncSessionFactory
from sqlalchemy import text

async def check_cols():
    async with AsyncSessionFactory() as session:
        res = await session.execute(text("SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'assembly_order'"))
        for row in res.fetchall():
            print(row)

asyncio.run(check_cols())
