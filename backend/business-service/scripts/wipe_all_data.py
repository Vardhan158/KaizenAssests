import asyncio
import re
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def try_connect(base_url, ports=[5432, 5433]):
    last_error = None
    for port in ports:
        # Replace port in URL
        url = re.sub(r':\d+/', f':{port}/', base_url)
        if ':' not in base_url.split('@')[1].split('/')[0]:
             # If no port specified in base_url, add it
             url = base_url.replace('/localhost/', f'/localhost:{port}/').replace('/127.0.0.1/', f'/127.0.0.1:{port}/')

        engine = create_async_engine(url)
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return engine, url
        except Exception as e:
            last_error = e
            await engine.dispose()
            continue
    raise Exception(f"Could not connect to {base_url} on ports {ports}. Last error: {last_error}")

async def wipe_business(engine):
    print("--- Wiping ams_business ---")
    async with engine.begin() as conn:
        query = text("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
              AND table_name != 'alembic_version';
        """)
        result = await conn.execute(query)
        tables = [row[0] for row in result.fetchall()]
        if not tables:
            print("No tables found to wipe in ams_business.")
            return

        print(f"Found {len(tables)} tables. Truncating...")
        # TRUNCATE TABLE T1, T2, ... CASCADE;
        await conn.execute(text(f"TRUNCATE TABLE {', '.join(tables)} CASCADE;"))

        # Verification
        print("Verifying ams_business wipe...")
        for table in tables[:5]: # Check first 5 tables
            count_res = await conn.execute(text(f"SELECT COUNT(*) FROM {table}"))
            count = count_res.scalar()
            print(f"  Table {table}: {count} rows")
    print("ams_business wipe complete.")

async def wipe_auth(engine):
    print("--- Wiping ams_auth ---")
    async with engine.begin() as conn:
        print("Truncating logs and tokens...")
        await conn.execute(text("TRUNCATE TABLE audit_log CASCADE;"))
        await conn.execute(text("TRUNCATE TABLE refresh_token CASCADE;"))

        print("Deleting users (except admin)...")
        await conn.execute(text("DELETE FROM user_role WHERE user_id != 'c1000000-0000-0000-0000-000000000001';"))
        await conn.execute(text("DELETE FROM app_user WHERE id != 'c1000000-0000-0000-0000-000000000001';"))

        print("Ensuring admin user is enabled...")
        await conn.execute(text("UPDATE app_user SET enabled = TRUE WHERE id = 'c1000000-0000-0000-0000-000000000001';"))

        # Verification
        user_count = await conn.execute(text("SELECT COUNT(*) FROM app_user"))
        log_count = await conn.execute(text("SELECT COUNT(*) FROM audit_log"))
        print(f"  Users remaining: {user_count.scalar()}")
        print(f"  Audit logs remaining: {log_count.scalar()}")
    print("ams_auth wipe complete.")

async def main():
    business_url = "postgresql+asyncpg://ams_business:ams_business@localhost:5432/ams_business"
    auth_url = "postgresql+asyncpg://ams_auth:ams_auth@localhost:5432/ams_auth"

    print("Starting data wipe...")

    try:
        b_engine, b_url = await try_connect(business_url)
        print(f"Connected to Business DB at {b_url}")
        await wipe_business(b_engine)
        await b_engine.dispose()
    except Exception as e:
        print(f"CRITICAL ERROR (Business DB): {e}")

    try:
        a_engine, a_url = await try_connect(auth_url)
        print(f"Connected to Auth DB at {a_url}")
        await wipe_auth(a_engine)
        await a_engine.dispose()
    except Exception as e:
        print(f"CRITICAL ERROR (Auth DB): {e}")

    print("\nAll tasks finished.")

if __name__ == "__main__":
    asyncio.run(main())
