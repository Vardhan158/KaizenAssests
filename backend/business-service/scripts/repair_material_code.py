"""Repair a material code consistently across procurement records."""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, update

from app.database.session import session_scope
from app.modules.procurement.infrastructure.persistence.models import (
    AsnLineModel,
    MaterialRequestItemModel,
    MaterialStockModel,
    PurchaseOrderItemModel,
    QuotationLineModel,
    RfqItemModel,
    StockReservationModel,
)


async def repair(old_code: str, new_code: str) -> None:
    async with session_scope() as session:
        conflict = await session.execute(
            select(MaterialRequestItemModel.id).where(
                MaterialRequestItemModel.material_code == new_code
            ).limit(1)
        )
        if conflict.scalar_one_or_none() is not None:
            raise RuntimeError(f"Cannot repair: {new_code} is already assigned")

        material_code_models = (
            MaterialRequestItemModel,
            RfqItemModel,
            PurchaseOrderItemModel,
            StockReservationModel,
            MaterialStockModel,
        )
        item_code_models = (QuotationLineModel, AsnLineModel)
        changed = 0
        for model in material_code_models:
            result = await session.execute(
                update(model).where(model.material_code == old_code).values(material_code=new_code)
            )
            changed += result.rowcount
        for model in item_code_models:
            result = await session.execute(
                update(model).where(model.item_code == old_code).values(item_code=new_code)
            )
            changed += result.rowcount
        print(f"Updated {changed} record(s): {old_code} -> {new_code}")


if __name__ == "__main__":
    asyncio.run(repair("MAT-003", "MAT-001"))
