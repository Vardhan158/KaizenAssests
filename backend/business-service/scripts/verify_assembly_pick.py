"""Verify physical pick with saved bin QR on a disposable SQLite database copy."""
import asyncio
from decimal import Decimal
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from fastapi import HTTPException
from app.main import app
from app.common.persistence.models import PickTaskModel, MaterialStockModel
from app.modules.warehouse.infrastructure.persistence.models import WarehouseBinModel
from app.modules.storage.infrastructure.persistence.models import InventoryLocationBalanceModel, StorageLocationModel
from app.modules.assembly.infrastructure.api.router import complete_assembly_picking_task, AssemblyPickConfirmationPayload

class CopyUnitOfWork:
    def __init__(self, session): self.session = session
    async def __aenter__(self): return self
    async def __aexit__(self, kind, value, tb):
        if kind: await self.session.rollback()
    async def commit(self): await self.session.commit()

async def verify(database):
    with tempfile.TemporaryDirectory() as folder:
        clone = Path(folder)/"pick-test.db"
        with closing(sqlite3.connect(database.resolve().as_uri()+"?mode=ro",uri=True)) as source, closing(sqlite3.connect(clone)) as destination:
            source.backup(destination)
        engine = create_async_engine("sqlite+aiosqlite:///"+clone.as_posix())
        try:
            async with async_sessionmaker(engine,expire_on_commit=False)() as session:
                task = (await session.execute(select(PickTaskModel).where(PickTaskModel.department=="Assembly").limit(1))).scalar_one()
                task_id = str(task.id)
                item = task.items[0]
                code = item["material_code"]
                quantity = Decimal(str(item["requested_quantity"]))
                balance, bin = (await session.execute(select(InventoryLocationBalanceModel,WarehouseBinModel).join(StorageLocationModel, StorageLocationModel.id==InventoryLocationBalanceModel.storage_location_id).join(WarehouseBinModel,WarehouseBinModel.id==StorageLocationModel.bin_id).where(InventoryLocationBalanceModel.material_code==code,InventoryLocationBalanceModel.available_quantity>=quantity).limit(1))).one()
                # Recreate a pending pick only inside the disposable copy if
                # the operator has already completed the source task.
                if task.status == "COMPLETED":
                    task.status = "PENDING"
                    task.completed_at = None
                    balance.quantity += quantity
                    balance.available_quantity += quantity
                    stock = (await session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code==code))).scalars().first()
                    stock.available_quantity += quantity
                    stock.on_hand_quantity += quantity
                    await session.commit()
                balance_id, stock_before = balance.id, balance.available_quantity
                payload = dict(material_scan=code, quantity=quantity)
                uow = CopyUnitOfWork(session)
                user = SimpleNamespace(username="regression-test")
                try:
                    await complete_assembly_picking_task(task_id, AssemblyPickConfirmationPayload(zone_scan="INVALID-BIN",**payload), uow=uow,current_user=user)
                    raise AssertionError("Invalid bin was accepted")
                except HTTPException as exc:
                    assert exc.status_code==409
                # Rollback expires ORM objects; keep the printed label as a plain value.
                bin = (await session.execute(select(WarehouseBinModel).where(WarehouseBinModel.id==StorageLocationModel.bin_id,StorageLocationModel.id==InventoryLocationBalanceModel.storage_location_id,InventoryLocationBalanceModel.id==balance_id))).scalar_one()
                response = await complete_assembly_picking_task(task_id, AssemblyPickConfirmationPayload(zone_scan=bin.qr_identifier,**payload),uow=uow,current_user=user)
                assert response["status"]=="COMPLETED"
                balance = await session.get(InventoryLocationBalanceModel,balance_id)
                await session.refresh(balance)
                assert balance.available_quantity==stock_before-quantity
                stock = (await session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code==code))).scalars().first()
                assert stock.available_quantity==balance.available_quantity
                print("PASS: invalid bin rejected; printed bin QR accepted; physical pick completed; bin and aggregate stock decremented on disposable copy")
        finally:
            await engine.dispose()

if __name__=="__main__": asyncio.run(verify(Path(sys.argv[1] if len(sys.argv)>1 else "wms.db")))
