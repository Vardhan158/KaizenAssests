import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def main():
    url = "postgresql+asyncpg://ams_business:ams_business@localhost:5432/ams_business"
    engine = create_async_engine(url)

    try:
        async with engine.connect() as conn:
            print("Dropping all tables in ams_business...")
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
            await conn.execute(text("GRANT ALL ON SCHEMA public TO ams_business"))
            await conn.execute(text("GRANT ALL ON SCHEMA public TO public"))
            await conn.commit()
            print("Done.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
