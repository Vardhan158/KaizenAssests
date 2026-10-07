"""Print canonical material code/name pairs for diagnostics."""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select

from app.database.session import session_scope
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialRequestItemModel,
    MaterialStockModel,
)


async def main() -> None:
    async with session_scope() as session:
        for model in (MaterialRequestItemModel, MaterialStockModel):
            result = await session.execute(
                select(model.material_code, model.material_name).order_by(model.material_code)
            )
            print(model.__tablename__, result.all())


if __name__ == "__main__":
    asyncio.run(main())
