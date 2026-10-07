import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def cleanup():
    engine = create_async_engine("postgresql+asyncpg://ams_business:ams_business@localhost:5432/ams_business")
    async with engine.begin() as conn:
        print("Dropping existing dock tables if present...")
        await conn.execute(text("DROP TABLE IF EXISTS dock_status_history CASCADE;"))
        await conn.execute(text("DROP TABLE IF EXISTS dock_allocation_history CASCADE;"))
        await conn.execute(text("DROP TABLE IF EXISTS dock_allocation_requests CASCADE;"))
        await conn.execute(text("DROP TABLE IF EXISTS dock_bays CASCADE;"))
        await conn.execute(text("DROP TABLE IF EXISTS dock_masters CASCADE;"))
        print("Cleanup completed.")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(cleanup())
