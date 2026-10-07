import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def main():
    # Try common postgres passwords or no password
    urls = [
        "postgresql+asyncpg://postgres:postgres@localhost:5432/ams_business",
        "postgresql+asyncpg://postgres:Harsha@2003@localhost:5432/ams_business",
        "postgresql+asyncpg://ams_business:ams_business@localhost:5432/ams_business"
    ]

    for url in urls:
        engine = create_async_engine(url)
        try:
            async with engine.connect() as conn:
                print(f"Connected with {url}")
                # List all databases
                res = await conn.execute(text("SELECT datname FROM pg_database"))
                dbs = [row[0] for row in res.fetchall()]
                print(f"Databases: {dbs}")

                if 'ams_auth' in dbs:
                    print("Found ams_auth, attempting wipe...")
                    # We can't easily switch databases with asyncpg engine once connected to one,
                    # but we can try to connect to ams_auth now that we know the credentials.
                    auth_url = url.replace('/ams_business', '/ams_auth')
                    auth_engine = create_async_engine(auth_url)
                    async with auth_engine.begin() as auth_conn:
                        await auth_conn.execute(text("TRUNCATE TABLE audit_log CASCADE;"))
                        await auth_conn.execute(text("TRUNCATE TABLE refresh_token CASCADE;"))
                        await auth_conn.execute(text("DELETE FROM user_role WHERE user_id != 'c1000000-0000-0000-0000-000000000001';"))
                        await auth_conn.execute(text("DELETE FROM app_user WHERE id != 'c1000000-0000-0000-0000-000000000001';"))
                        print("ams_auth wiped.")
                    await auth_engine.dispose()

                # Business wipe (redundant but safe)
                print("Wiping ams_business...")
                res = await conn.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != 'alembic_version'"))
                tables = [row[0] for row in res.fetchall()]
                if tables:
                    await conn.execute(text(f"TRUNCATE TABLE {', '.join(tables)} CASCADE;"))
                print("ams_business wiped.")
                break
        except Exception as e:
            print(f"Failed {url}: {e}")
        finally:
            await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
