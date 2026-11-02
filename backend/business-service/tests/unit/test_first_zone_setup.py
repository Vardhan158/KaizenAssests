import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.database.base import Base
from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel, WarehouseZoneModel, WarehouseBinModel
from app.modules.warehouse.infrastructure.api.location_router import (
    ZoneCreateRequest, create_unscoped_zone, next_unscoped_zone_code,
)
from app.security.dependencies import CurrentUser


class FirstZoneSetupTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(lambda sync: Base.metadata.create_all(sync, tables=[
                WarehouseModel.__table__, WarehouseZoneModel.__table__, WarehouseBinModel.__table__,
            ]))
        self.session = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.uow = SimpleNamespace(session=self.session, rollback=self.session.rollback)
        self.user = CurrentUser("warehouse", "warehouse", ["WAREHOUSE_MANAGER"], [], {})

    async def asyncTearDown(self):
        await self.session.close()
        await self.engine.dispose()

    async def test_code_preview_does_not_create_warehouse(self):
        self.assertEqual(await next_unscoped_zone_code(self.user, self.uow), {"suggested_zone_code": "ZONE-001"})
        self.assertEqual(await self.session.scalar(select(func.count(WarehouseModel.id))), 0)

    async def test_first_zone_initializes_warehouse_and_second_zone_reuses_it(self):
        first = await create_unscoped_zone(ZoneCreateRequest(
            zone_name="Zone A", warehouse_name="Pune DC", warehouse_id="Plant 1200",
        ), self.user, self.uow)
        self.assertEqual(first["zone_code"], "ZONE-001")
        self.assertEqual(await next_unscoped_zone_code(self.user, self.uow), {"suggested_zone_code": "ZONE-002"})
        second = await create_unscoped_zone(ZoneCreateRequest(zone_name="Zone B"), self.user, self.uow)
        self.assertEqual(second["zone_code"], "ZONE-002")
        self.assertEqual(await self.session.scalar(select(func.count(WarehouseModel.id))), 1)

    async def test_first_zone_requires_explicit_warehouse_details(self):
        with self.assertRaises(HTTPException) as error:
            await create_unscoped_zone(ZoneCreateRequest(zone_name="Zone A"), self.user, self.uow)
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(await self.session.scalar(select(func.count(WarehouseModel.id))), 0)

    async def test_unauthorized_user_cannot_initialize_warehouse(self):
        user = CurrentUser("supplier", "supplier", ["SUPPLIER"], [], {})
        with self.assertRaises(HTTPException) as error:
            await create_unscoped_zone(ZoneCreateRequest(
                zone_name="Zone A", warehouse_name="Pune DC", warehouse_id="Plant 1200",
            ), user, self.uow)
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(await self.session.scalar(select(func.count(WarehouseModel.id))), 0)
