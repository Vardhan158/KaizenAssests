import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database.session import engine
from app.database.base import Base

# Import all models to register them on Base.metadata
from app.events import outbox_model  # noqa: F401
from app.common.persistence import models as common_models  # noqa: F401
from app.modules.gate.infrastructure.persistence import models as gate_models  # noqa: F401
from app.modules.receiving.infrastructure.persistence import models as receiving_models  # noqa: F401
from app.modules.returns.infrastructure.persistence import models as returns_models  # noqa: F401
from app.modules.storage.infrastructure.persistence import models as storage_models  # noqa: F401
from app.modules.warehouse.infrastructure.persistence import models as warehouse_models  # noqa: F401
from app.modules.assembly.infrastructure.persistence import models as assembly_models  # noqa: F401
from app.modules.dispatch.infrastructure.persistence import models as dispatch_models  # noqa: F401

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Database tables initialized successfully via Base.metadata.create_all.")

if __name__ == "__main__":
    asyncio.run(init_db())
