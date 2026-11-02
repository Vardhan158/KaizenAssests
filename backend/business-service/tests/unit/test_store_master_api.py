"""Warehouse API regressions on an isolated in-memory database; run with unittest."""
import unittest
from types import SimpleNamespace
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.main import app as production_app
from app.database.session import get_uow
from app.security.dependencies import get_current_user
from app.modules.warehouse.infrastructure.api.router import router, zone_router
from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel, WarehouseZoneModel, WarehouseBinModel

class WarehouseMasterApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            for model in [WarehouseModel, WarehouseZoneModel, WarehouseBinModel]:
                await connection.run_sync(model.__table__.create)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.include_router(zone_router)
        async def uow():
            async with self.sessions() as session:
                yield SimpleNamespace(session=session)
                await session.commit()
        self.app.dependency_overrides[get_uow] = uow
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(roles=["WAREHOUSE"], permissions=[])
        self.client = AsyncClient(transport=ASGITransport(app=self.app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.engine.dispose()

    async def test_create_list_detail_and_next_code(self):
        self.assertTrue(any(route.path == "/api/v1/warehouse/next-code" for route in production_app.routes))
        response = await self.client.get("/api/v1/warehouse/next-code")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["suggested_warehouse_code"], "STR-00001")
        created = await self.client.post("/api/v1/warehouse", json={"warehouse_name":"WARE", "warehouse_id":"PLANT", "warehouse_type":"RAW_MATERIAL"})
        self.assertEqual(created.status_code, 201, created.text)
        warehouse = created.json()
        self.assertEqual(warehouse["warehouse_code"], "STR-00001")
        self.assertEqual(warehouse["warehouse_id"], "PLANT")
        self.assertEqual((await self.client.get("/api/v1/warehouse")).json()[0]["id"], warehouse["id"])
        self.assertEqual((await self.client.get("/api/v1/warehouse/"+warehouse["id"])).json()["warehouse_name"], "WARE")
        self.assertEqual((await self.client.get("/api/v1/warehouse/next-code")).json()["suggested_warehouse_code"], "STR-00002")
        self.assertEqual((await self.client.get("/api/v1/warehouse?search=missing")).json(), [])

    async def test_duplicate_code_returns_conflict(self):
        payload = {"warehouse_name":"WARE", "warehouse_id":"PLANT", "warehouse_code":"STR-00001"}
        self.assertEqual((await self.client.post("/api/v1/warehouse", json=payload)).status_code,201)
        self.assertEqual((await self.client.post("/api/v1/warehouse", json=payload)).status_code,409)

    async def test_permission_and_required_location(self):
        self.assertEqual((await self.client.post("/api/v1/warehouse", json={"warehouse_name":"WARE"})).status_code,422)
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(roles=["SUPPLIER"], permissions=[])
        self.assertEqual((await self.client.get("/api/v1/warehouse/next-code")).status_code,403)

    async def test_warehouse_zone_bin_flow(self):
        warehouse = (await self.client.post("/api/v1/warehouse", json={"warehouse_name":"WARE", "warehouse_id":"PLANT"})).json()
        root = "/api/v1/warehouse/" + warehouse["id"]
        next_zone = await self.client.get(root + "/zones/next-code")
        self.assertEqual(next_zone.status_code, 200)
        created = await self.client.post(root + "/zones", json={"zone_name":"zone-B", "zone_code":next_zone.json()["suggested_zone_code"]})
        self.assertEqual(created.status_code, 201, created.text)
        zone = created.json()
        self.assertEqual((await self.client.get(root+"/zones")).json()[0]["zone_name"], "zone-B")
        self.assertEqual((await self.client.get(root+"/bins")).json(), [])
        zone_root = "/api/v1/zones/" + zone["id"]
        suggested = (await self.client.get(zone_root+"/bins/next-code")).json()["suggested_bin_code"]
        response = await self.client.post(zone_root+"/bins", json={"bin_name":"Shelf bin", "rack":"R01", "position":"S01", "capacity":100})
        self.assertEqual(response.status_code,201,response.text)
        item = response.json()
        self.assertEqual(item["bin_code"], suggested)
        self.assertEqual(item["warehouse_ref_id"],warehouse["id"])
        self.assertTrue(item["qr_identifier"])
        self.assertEqual((await self.client.get(zone_root+"/bins")).json()[0]["id"],item["id"])
        self.assertEqual((await self.client.get(root+"/bins")).json()[0]["id"],item["id"])
        self.assertNotEqual((await self.client.get(zone_root+"/bins/next-code")).json()["suggested_bin_code"],suggested)
        duplicate = await self.client.post(zone_root+"/bins",json={"bin_name":"Duplicate", "bin_code":suggested})
        self.assertEqual(duplicate.status_code,409)

    async def test_missing_zone_and_zone_name_validation(self):
        warehouse = (await self.client.post("/api/v1/warehouse", json={"warehouse_name":"WARE", "warehouse_id":"PLANT"})).json()
        response = await self.client.post("/api/v1/warehouse/"+warehouse["id"]+"/zones",json={"zone_name":"   "})
        self.assertEqual(response.status_code,422)
        self.assertEqual((await self.client.get("/api/v1/zones/missing/bins")).status_code,404)

    async def test_putaway_resolves_printed_bin_qr_and_checks_warehouse(self):
        from app.modules.storage.infrastructure.api.router import resolve_bin_qr, ResolveBinQrRequest
        from fastapi import HTTPException
        import uuid
        warehouse = (await self.client.post("/api/v1/warehouse",json={"warehouse_name":"WARE", "warehouse_id":"PLANT"})).json()
        zone = (await self.client.post("/api/v1/warehouse/"+warehouse["id"]+"/zones",json={"zone_name":"Zone B"})).json()
        qr = "QR-BIN-STR-00001-ZONE-001-001"
        item = (await self.client.post("/api/v1/zones/"+zone["id"]+"/bins",json={"bin_name":"Bin 001", "bin_code":"001", "qr_identifier":qr})).json()
        async with self.sessions() as session:
            uow = SimpleNamespace(session=session)
            user = SimpleNamespace(roles=["ADMIN"], permissions=[])
            for scan in [qr, qr.lower(), "  " + qr + "  "]:
                result = await resolve_bin_qr(ResolveBinQrRequest(bin_scan=scan,warehouse_ref_id=warehouse["id"]),user=user,uow=uow)
                self.assertTrue(result["valid"])
                self.assertEqual(result["bin_id"],item["id"])
            with self.assertRaises(HTTPException) as error:
                await resolve_bin_qr(ResolveBinQrRequest(bin_scan=qr,warehouse_ref_id=str(uuid.uuid4())),user=user,uow=uow)
            self.assertEqual(error.exception.status_code,422)
            stored = await session.get(WarehouseBinModel, uuid.UUID(item["id"]))
            stored.status = "INACTIVE"
            await session.flush()
            with self.assertRaises(HTTPException) as error:
                await resolve_bin_qr(ResolveBinQrRequest(bin_scan=qr),user=user,uow=uow)
            self.assertEqual(error.exception.status_code,409)
