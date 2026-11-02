import tempfile
import unittest
from pathlib import Path
from datetime import date, timedelta
from decimal import Decimal
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.main import app
from app.database.base import Base
from app.database.session import get_uow
from app.security.dependencies import get_current_user, CurrentUser
from app.modules.assembly.infrastructure.persistence.models import BillOfMaterialsModel, BillOfMaterialsItemModel, AssemblyOrderModel
from app.common.persistence.models import MaterialRequestItemModel, MaterialStockModel

class TestUow:
    def __init__(self, session): self.session=session
    async def __aenter__(self): return self
    async def __aexit__(self, exc_type, exc, tb):
        if exc_type: await self.session.rollback()
    async def commit(self): await self.session.commit()
    async def rollback(self): await self.session.rollback()

class AssemblyBomQuantityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.engine=create_async_engine("sqlite+aiosqlite:///"+str(Path(self.tmp.name)/"bom.db"))
        async with self.engine.begin() as c: await c.run_sync(Base.metadata.create_all)
        self.session=async_sessionmaker(self.engine,expire_on_commit=False)()
        self.uow=TestUow(self.session)
        user=CurrentUser(subject="assembly",username="assembly",roles=["ASSEMBLY"],permissions=[],raw_claims={})
        async def uow_override(): yield self.uow
        app.dependency_overrides[get_uow]=uow_override
        app.dependency_overrides[get_current_user]=lambda:user
        bom=BillOfMaterialsModel(bom_number="BOM-TEST",product_code="FG-TEST",product_name="Test Product",status="ACTIVE")
        self.session.add(bom);await self.session.flush()
        for code,qty,uom in [("MAT-100",100,"PCS"),("MAT-2",2,"PCS"),("MAT-KG",Decimal("0.25"),"KG")]:
            self.session.add(BillOfMaterialsItemModel(bom_id=bom.id,material_code=code,material_name=code,quantity_per_unit=qty,uom=uom))
            self.session.add(MaterialStockModel(
                material_code=code,
                on_hand_quantity=Decimal("100000"),
                available_quantity=Decimal("100000"),
                uom=uom,
            ))
        await self.session.commit()
        self.client=AsyncClient(transport=ASGITransport(app=app),base_url="http://test")
    async def asyncTearDown(self):
        app.dependency_overrides.pop(get_uow,None);app.dependency_overrides.pop(get_current_user,None)
        await self.client.aclose();await self.session.close();await self.engine.dispose();self.tmp.cleanup()
    async def test_preview_multiplies_each_component_and_never_clamps_100_to_10(self):
        for quantity in (1,10,100):
            response=await self.client.get(f"/api/v1/assembly/products/FG-TEST/bom?quantity={quantity}")
            self.assertEqual(response.status_code,200,response.text)
            data=response.json();self.assertEqual(data["target_quantity"],quantity)
            rows={r["material_code"]:r for r in data["materials"]}
            for code,per_unit in [("MAT-100",100),("MAT-2",2),("MAT-KG",0.25)]:
                self.assertEqual(rows[code]["required_quantity"],quantity*per_unit)
                self.assertEqual(rows[code]["shortage"],max(0,quantity*per_unit-100000))
    async def test_saved_request_matches_bom_and_keeps_production_target(self):
        response=await self.client.post("/api/v1/assembly/material-requests",json={"product_code":"FG-TEST","target_quantity":100,"required_date":(date.today()+timedelta(days=7)).isoformat()})
        self.assertEqual(response.status_code,201,response.text)
        data=response.json();self.assertEqual(data["target_quantity"],100)
        expected={"MAT-100":10000,"MAT-2":200,"MAT-KG":25}
        self.assertEqual({i["material_code"]:i["quantity"] for i in data["items"]},expected)
        persisted=(await self.session.scalars(select(MaterialRequestItemModel))).all()
        self.assertEqual({i.material_code:float(i.quantity) for i in persisted},expected)
        order=await self.session.scalar(select(AssemblyOrderModel))
        self.assertEqual(order.planned_quantity,100)

    async def test_add_material_persists_component_and_updates_preview(self):
        from app.common.persistence.models import MaterialModel
        self.session.add(MaterialModel(material_code="MAT-NEW",material_name="New Component",base_uom="KG",status="Active"))
        self.session.add(MaterialStockModel(
            material_code="MAT-NEW",
            on_hand_quantity=Decimal("1000"),
            available_quantity=Decimal("1000"),
            uom="KG",
        ))
        await self.session.commit()
        response=await self.client.post("/api/v1/assembly/products/FG-TEST/bom/materials",json={"material_code":"MAT-NEW","quantity_per_unit":2.5})
        self.assertEqual(response.status_code,201,response.text)
        await self.session.commit()
        preview=await self.client.get("/api/v1/assembly/products/FG-TEST/bom?quantity=10")
        row=next(i for i in preview.json()["materials"] if i["material_code"]=="MAT-NEW")
        self.assertEqual(row["required_quantity"],25);self.assertEqual(row["uom"],"KG")
        duplicate=await self.client.post("/api/v1/assembly/products/FG-TEST/bom/materials",json={"material_code":"MAT-NEW","quantity_per_unit":1})
        self.assertEqual(duplicate.status_code,409)
        invalid=await self.client.post("/api/v1/assembly/products/FG-TEST/bom/materials",json={"material_code":"MAT-NEW","quantity_per_unit":0})
        self.assertEqual(invalid.status_code,422)

    async def test_create_product_duplicate_name_check_works_on_sqlite(self):
        payload = {
            "product_code": "FG-FAN-001",
            "product_name": "Fan",
            "components": [{
                "material_code": "MAT-2",
                "material_name": "MAT-2",
                "quantity_per_unit": 1,
                "uom": "PCS",
            }],
        }
        created = await self.client.post("/api/v1/assembly/products", json=payload)
        self.assertEqual(created.status_code, 201, created.text)

        payload["product_code"] = "FG-FAN-002"
        payload["product_name"] = "  fAn  "
        duplicate = await self.client.post("/api/v1/assembly/products", json=payload)
        self.assertEqual(duplicate.status_code, 400, duplicate.text)
        self.assertIn("already exists", duplicate.json()["detail"])

    async def test_edit_material_updates_preview(self):
        response = await self.client.put("/api/v1/assembly/products/FG-TEST/bom/materials", json={"material_code": "MAT-2", "quantity_per_unit": 3})
        self.assertEqual(response.status_code, 200, response.text)
        await self.session.commit()
        preview = await self.client.get("/api/v1/assembly/products/FG-TEST/bom?quantity=10")
        row = next(item for item in preview.json()["materials"] if item["material_code"] == "MAT-2")
        self.assertEqual(row["required_quantity"], 30)
        invalid = await self.client.put("/api/v1/assembly/products/FG-TEST/bom/materials", json={"material_code": "MAT-2", "quantity_per_unit": 0})
        self.assertEqual(invalid.status_code, 422)

    async def test_add_material_rejects_unknown_master_and_unauthorized_role(self):
        unknown=await self.client.post("/api/v1/assembly/products/FG-TEST/bom/materials",json={"material_code":"UNKNOWN","quantity_per_unit":1})
        self.assertEqual(unknown.status_code,422)
        app.dependency_overrides[get_current_user]=lambda:CurrentUser(subject="supplier",username="supplier",roles=["SUPPLIER"],permissions=[],raw_claims={})
        denied=await self.client.post("/api/v1/assembly/products/FG-TEST/bom/materials",json={"material_code":"MAT-100","quantity_per_unit":1})
        self.assertEqual(denied.status_code,403)


    async def test_rejected_request_status_is_consistent_across_production_and_dashboard(self):
        from app.common.persistence.models import MaterialRequestModel
        created=await self.client.post("/api/v1/assembly/material-requests",json={"product_code":"FG-TEST","target_quantity":10,"required_date":(date.today()+timedelta(days=7)).isoformat()})
        self.assertEqual(created.status_code,201,created.text)
        req=await self.session.scalar(select(MaterialRequestModel))
        req.status="REJECTED"
        await self.session.commit()
        orders=await self.client.get("/api/v1/assembly/production/orders")
        self.assertEqual(orders.status_code,200,orders.text)
        self.assertEqual(orders.json()[0]["status"],"REJECTED")
        self.assertFalse(orders.json()[0]["can_start"])
        rejected=await self.client.get("/api/v1/assembly/production/orders?status=REJECTED")
        self.assertEqual(len(rejected.json()),1)
        pending=await self.client.get("/api/v1/assembly/production/orders?status=MATERIAL_PENDING")
        self.assertEqual(pending.json(),[])
        dashboard=await self.client.get("/api/v1/assembly/dashboard")
        self.assertEqual(dashboard.status_code,200,dashboard.text)
        data=dashboard.json()
        self.assertEqual(data["active_orders"][0]["status"],"REJECTED")
        self.assertEqual(data["kpis"]["material_pending"],0)
        self.assertEqual(data["kpis"]["open_orders"],0)
        self.assertEqual(data["needs_attention"],[])
