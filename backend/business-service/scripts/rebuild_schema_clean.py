import asyncio
import sys
import os

# Add app to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy.ext.asyncio import create_async_engine
from app.database.base import Base
# Import all models to ensure they are registered with Base.metadata
import app.modules.procurement.infrastructure.persistence.models
import app.modules.gate.infrastructure.persistence.models
import app.modules.receiving.infrastructure.persistence.models
import app.modules.storage.infrastructure.persistence.models
import app.modules.notification.infrastructure.persistence.models
import app.modules.returns.infrastructure.persistence.models

async def main():
    url = "postgresql+asyncpg://ams_business:ams_business@localhost:5432/ams_business"
    engine = create_async_engine(url)

    try:
        async with engine.begin() as conn:
            print("Dropping all tables (clean start)...")
            await conn.run_sync(Base.metadata.drop_all)

            print("Creating all tables from models...")
            # This ensures all columns have the types defined in the models (GUID -> UUID)
            await conn.run_sync(Base.metadata.create_all)
            print("Schema created successfully.")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
