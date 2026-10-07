import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def check_db(dbname):
    url = f"postgresql+asyncpg://ams_business:ams_business@localhost:5432/{dbname}"
    engine = create_async_engine(url)
    try:
        async with engine.connect() as conn:
            res = await conn.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))
            tables = [row[0] for row in res.fetchall()]
            print(f"Database: {dbname}, Tables: {tables}")
            if 'app_user' in tables or 'auth_user' in tables:
                print(f"*** FOUND AUTH TABLES IN {dbname} ***")
    except Exception as e:
        # print(f"Failed to connect to {dbname}: {e}")
        pass
    finally:
        await engine.dispose()

async def main():
    dbs = ['postgres', 'todo_db', 'warehouse_core', 'logistics_returns', 'platform', 'supplier_flow', 'wms_ams', 'supplier_management_db', 'supplier_enterprise_db', 'ams_business']
    for db in dbs:
        await check_db(db)

if __name__ == "__main__":
    asyncio.run(main())
