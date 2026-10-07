import asyncio
from app.database.session import AsyncSessionFactory
from app.modules.receiving.infrastructure.persistence.models import GrnModel
from app.modules.storage.infrastructure.persistence.models import (
    PutawayMovementModel, HandlingUnitModel, InventoryIssueTransactionModel, PutawayTaskModel
)
from sqlalchemy import select

async def test():
    async with AsyncSessionFactory() as session:
        grns = (await session.execute(select(GrnModel))).scalars().all()
        for g in grns:
            print('GRN:', g.grn_number, 'Supplier:', g.supplier_name, 'PO:', g.po_number, 'Status:', g.status, 'Created:', g.created_at)
        movs = (await session.execute(select(PutawayMovementModel))).scalars().all()
        for m in movs:
            print('MOV:', m.material_code, 'PutawayTaskID:', m.putaway_task_id, 'Batch:', m.batch_lot, 'Dest:', m.destination_location)
        hus = (await session.execute(select(HandlingUnitModel))).scalars().all()
        for h in hus:
            print('HU:', h.barcode_value, 'Item:', h.item_code, 'GRN:', h.grn_number, 'Batch:', h.batch_number, 'Loc:', h.current_location)
        issues = (await session.execute(select(InventoryIssueTransactionModel))).scalars().all()
        for i in issues:
            print('ISSUE:', i.issue_number, 'Item:', i.material_code, 'Qty:', i.quantity, 'Store:', i.store_code)
        pts = (await session.execute(select(PutawayTaskModel))).scalars().all()
        for p in pts:
            print('PUTAWAY_TASK:', p.task_number, 'Item:', p.item_code, 'Qty:', p.quantity, 'Status:', p.status)

if __name__ == "__main__":
    asyncio.run(test())
