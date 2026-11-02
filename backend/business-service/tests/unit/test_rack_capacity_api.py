import tempfile
import unittest
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.main import app  # Register all ORM foreign-key targets.
from app.database.base import Base
from app.security.dependencies import CurrentUser
from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel, WarehouseZoneModel, WarehouseRackModel, WarehouseBinModel
from app.modules.receiving.infrastructure.persistence.models import GrnBatchModel, GrnBatchQrModel
from app.modules.storage.infrastructure.persistence.models import StorageLocationModel, InventoryLocationBalanceModel, InventoryMovementHistoryModel
from app.modules.storage.application.rack_capacity import install_rack_capacity, validate_rack_capacity
from app.modules.warehouse.infrastructure.api.location_router import (create_zone_bin, BinCreateRequest, rack_materials, list_zone_bins,
    update_rack_capacity, RackCapacityUpdate, empty_rack, EmptyRackRequest, move_rack_material, RackMoveRequest)


class RackCapacityApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.engine=create_async_engine("sqlite+aiosqlite:///"+str(Path(self.tmp.name)/"api.db"))
        async with self.engine.begin() as c:
            await c.run_sync(Base.metadata.create_all)
            await c.run_sync(install_rack_capacity)
        self.session=async_sessionmaker(self.engine,expire_on_commit=False)()
        self.uow=SimpleNamespace(session=self.session,rollback=self.session.rollback)
        self.user=CurrentUser(subject="warehouse",username="warehouse",roles=["WAREHOUSE"],permissions=[],raw_claims={})
        self.warehouse=WarehouseModel(warehouse_code="STR-TEST",warehouse_name="Test Warehouse",warehouse_id="WH-TEST",status="ACTIVE")
        self.session.add(self.warehouse);await self.session.flush()
        self.zone=WarehouseZoneModel(warehouse_ref_id=self.warehouse.id,zone_code="ZONE-001",zone_name="Zone Test",status="ACTIVE")
        self.session.add(self.zone);await self.session.flush()
        await self.create_rack("RACK-001",1)
    async def create_rack(self,rack,n):
        return await create_zone_bin(str(self.zone.id),BinCreateRequest(bin_code=f"ZONE-001-BIN-{n:03d}",bin_name=rack,rack=rack,capacity=80),self.user,self.uow)
    async def seed(self,q=60):
        bin_model=await self.session.scalar(select(WarehouseBinModel).where(WarehouseBinModel.rack=="RACK-001"))
        self.location=StorageLocationModel(location_code="LOC-TEST-1",warehouse_id=self.warehouse.warehouse_id,warehouse_ref_id=self.warehouse.id,
            zone_id=self.zone.id,bin_id=bin_model.id,zone=self.zone.zone_code,rack=bin_model.rack,bin=bin_model.bin_code,capacity=80,occupied_quantity=q)
        self.session.add(self.location);await self.session.flush()
        self.batch=GrnBatchModel(grn_line_id=uuid.uuid4(),batch_number="BATCH-TEST",batch_quantity=q,created_by="test")
        self.session.add(self.batch);await self.session.flush()
        self.qr=GrnBatchQrModel(batch_id=self.batch.id,item_code="MAT-TEST",qr_code="QR-TEST-BATCH",qr_payload="Material Code: MAT-TEST\nBatch Number: BATCH-TEST",generated_at=datetime.now(timezone.utc))
        self.session.add(self.qr)
        self.balance=InventoryLocationBalanceModel(material_code="MAT-TEST",material_name="Test Material",warehouse_id=self.warehouse.warehouse_id,
            storage_location_id=self.location.id,batch_number=self.batch.batch_number,quantity=q,available_quantity=q,uom="PCS",
            last_putaway_task_id=uuid.uuid4(),last_grn_number="GRN-TEST",updated_at=datetime.now(timezone.utc))
        self.session.add(self.balance);await self.session.flush()
        self.bin=bin_model
    async def rack(self):
        return await self.session.scalar(select(WarehouseRackModel).where(WarehouseRackModel.rack_code=="RACK-001").execution_options(populate_existing=True))
    async def asyncTearDown(self):
        await self.session.rollback();await self.session.close();await self.engine.dispose();self.tmp.cleanup()
    async def test_real_occupancy_and_material_qr(self):
        await self.seed();rack=await self.rack()
        data=await rack_materials(str(self.zone.id),str(rack.id),self.user,self.uow)
        self.assertEqual(data["occupied_quantity"],60);self.assertEqual(data["materials"][0]["material_qr"],"QR-TEST-BATCH")
        bins=await list_zone_bins(str(self.zone.id),self.user,self.uow)
        self.assertEqual(bins[0]["rack_capacity"]["available_capacity"],20)
    async def test_capacity_error_exact_message(self):
        await self.seed()
        with self.assertRaises(HTTPException) as error:await validate_rack_capacity(self.session,self.bin,Decimal(80),"PCS")
        self.assertEqual(error.exception.detail,"Rack capacity exceeded. Only 20 PCS can be stored.")
    async def test_edit_capacity_below_current_occupancy_rejected(self):
        await self.seed();rack=await self.rack()
        with self.assertRaises(HTTPException):await update_rack_capacity(str(self.zone.id),str(rack.id),RackCapacityUpdate(maximum_capacity=50,reason="Resize rack"),self.user,self.uow)
        result=await update_rack_capacity(str(self.zone.id),str(rack.id),RackCapacityUpdate(maximum_capacity=100,reason="Resize rack"),self.user,self.uow)
        self.assertEqual(result["available_capacity"],40)
    async def test_scan_pick_updates_stock_and_audit(self):
        await self.seed();rack=await self.rack()
        await move_rack_material(str(self.zone.id),str(rack.id),RackMoveRequest(source_scan=self.bin.qr_identifier,
            material_scan=self.qr.qr_payload,quantity=10,reason="Physical material issue"),self.user,self.uow)
        self.assertEqual((await self.rack()).occupied_quantity,50)
        self.assertEqual(self.balance.quantity,50)
        movement=await self.session.scalar(select(InventoryMovementHistoryModel))
        self.assertEqual(movement.performed_by,"warehouse")
    async def test_wrong_rack_or_material_qr_rejected(self):
        await self.seed();rack=await self.rack()
        for source,material in [("WRONG",self.qr.qr_code),(self.bin.qr_identifier,"WRONG")]:
            with self.assertRaises(HTTPException):await move_rack_material(str(self.zone.id),str(rack.id),RackMoveRequest(source_scan=source,material_scan=material,quantity=10,reason="Issue material"),self.user,self.uow)
        self.assertEqual((await self.rack()).occupied_quantity,60)
    async def test_empty_rack_audited_adjustment_and_no_inventory_deletion(self):
        await self.seed();rack=await self.rack()
        result=await empty_rack(str(self.zone.id),str(rack.id),EmptyRackRequest(confirm=True,reason="Approved stock write-off"),self.user,self.uow)
        self.assertEqual(result["occupied_quantity"],0)
        self.assertEqual(await self.session.scalar(select(func.count(InventoryLocationBalanceModel.id))),1)
        movement=await self.session.scalar(select(InventoryMovementHistoryModel))
        self.assertEqual(movement.movement_type,"ADJUSTMENT");self.assertIn("Approved stock write-off",movement.remarks)
    async def test_empty_rack_requires_authorization(self):
        rack=await self.rack()
        user=CurrentUser(subject="supplier",username="supplier",roles=["SUPPLIER"],permissions=[],raw_claims={})
        with self.assertRaises(HTTPException) as error:await empty_rack(str(self.zone.id),str(rack.id),EmptyRackRequest(confirm=True,reason="Bad adjustment"),user,self.uow)
        self.assertEqual(error.exception.status_code,403)
    async def test_transfer_real_stock_between_racks(self):
        await self.seed();destination=await self.create_rack("RACK-002",2);rack=await self.rack()
        await move_rack_material(str(self.zone.id),str(rack.id),RackMoveRequest(source_scan=self.bin.qr_identifier,
            destination_scan=destination["qr_identifier"],material_scan=self.qr.qr_code,quantity=20,reason="Rack reorganization"),self.user,self.uow)
        self.assertEqual((await self.rack()).occupied_quantity,40)
        destination_rack=await self.session.scalar(select(WarehouseRackModel).where(WarehouseRackModel.rack_code=="RACK-002"))
        self.assertEqual(destination_rack.occupied_quantity,20)

    async def test_inventory_adjustment_synchronizes_rack(self):
        from app.modules.storage.infrastructure.api.inventory_router import create_stock_adjustment, StockAdjustmentCreateRequest
        await self.seed()
        result = await create_stock_adjustment(StockAdjustmentCreateRequest(material_code="MAT-TEST", batch_number=self.batch.batch_number,
            location_code=self.location.location_code, adjustment_quantity=Decimal("-10"), reason="Cycle Count Variance", notes="Physical count verified"), self.user, self.uow)
        self.assertEqual(result["new_quantity"],50)
        self.assertEqual((await self.rack()).occupied_quantity,50)

    async def new_putaway(self, quantity):
        from app.modules.storage.infrastructure.persistence.models import PutawayTaskModel
        task = PutawayTaskModel(task_number="PT-REUSE-SPACE", item_code="MAT-OTHER", material_name="Other material",
            batch_number="BATCH-OTHER", quantity=quantity, uom="PCS", warehouse_id=self.warehouse.warehouse_id,
            status="PUTAWAY_PENDING", created_by="warehouse", created_at=datetime.now(timezone.utc))
        self.session.add(task)
        await self.session.flush()
        return task

    async def test_assembly_issue_frees_space_for_other_material_assignment_and_stock(self):
        from app.modules.storage.infrastructure.api.router import assign_storage_location, LocationAssignmentRequest, resolve_bin_qr, ResolveBinQrRequest
        await self.seed(80)
        self.bin.occupied_quantity = 80  # Deliberately stale legacy caches after Assembly issues ten units.
        self.balance.quantity -= 10
        self.balance.available_quantity -= 10
        await self.session.flush()
        rack = await self.rack()
        self.assertEqual(rack.occupied_quantity,70)
        scan = await resolve_bin_qr(ResolveBinQrRequest(bin_scan=self.bin.qr_identifier), self.user, self.uow)
        self.assertEqual((scan["capacity"],scan["occupied_quantity"],scan["available_capacity"]),(80,70,10))
        task = await self.new_putaway(10)
        await assign_storage_location(str(task.id),LocationAssignmentRequest(warehouse_ref_id=str(self.warehouse.id),
            zone_id=str(self.zone.id),bin_id=str(self.bin.id),quantity=Decimal(10)),self.user,self.uow)
        self.assertEqual(task.destination_bin_id,self.bin.id)
        self.assertEqual(self.location.occupied_quantity,70)
        self.session.add(InventoryLocationBalanceModel(material_code="MAT-OTHER", material_name="Other material",
            warehouse_id=self.warehouse.warehouse_id, storage_location_id=self.location.id,batch_number="BATCH-OTHER",
            quantity=10,available_quantity=10,uom="PCS",last_putaway_task_id=task.id,last_grn_number="GRN-OTHER",updated_at=datetime.now(timezone.utc)))
        await self.session.flush()
        data = await rack_materials(str(self.zone.id),str(rack.id),self.user,self.uow)
        self.assertEqual((data["occupied_quantity"],data["available_capacity"]),(80,0))
        self.assertEqual(len(data["materials"]),2)

    async def test_assignment_cannot_exceed_space_released_by_assembly_issue(self):
        from app.modules.storage.infrastructure.api.router import assign_storage_location, LocationAssignmentRequest
        await self.seed(80)
        self.balance.quantity=70;self.balance.available_quantity=70
        await self.session.flush()
        task=await self.new_putaway(11)
        with self.assertRaises(HTTPException) as error:
            await assign_storage_location(str(task.id),LocationAssignmentRequest(warehouse_ref_id=str(self.warehouse.id),
                zone_id=str(self.zone.id),bin_id=str(self.bin.id),quantity=Decimal(11)),self.user,self.uow)
        self.assertEqual(error.exception.detail,"Rack capacity exceeded. Only 10 PCS can be stored.")

    async def test_reserving_stock_does_not_release_physical_space(self):
        from app.modules.storage.infrastructure.api.router import resolve_bin_qr, ResolveBinQrRequest
        await self.seed(80)
        self.balance.available_quantity=70
        await self.session.flush()
        scan=await resolve_bin_qr(ResolveBinQrRequest(bin_scan=self.bin.qr_identifier),self.user,self.uow)
        self.assertEqual(scan["occupied_quantity"],80)
        self.assertEqual(scan["available_capacity"],0)

    async def test_location_assignment_uses_live_rack_instead_of_stale_location_cache(self):
        from app.modules.storage.infrastructure.api.router import assign_storage_location, LocationAssignmentRequest
        await self.seed(80)
        self.balance.quantity=70;self.balance.available_quantity=70
        await self.session.flush()
        self.assertEqual(self.location.occupied_quantity,80)
        task=await self.new_putaway(10)
        await assign_storage_location(str(task.id),LocationAssignmentRequest(location_id=str(self.location.id),quantity=Decimal(10)),self.user,self.uow)
        self.assertEqual(task.destination_location_id,self.location.id)

    async def test_http_bin_routes_include_real_rack_capacity(self):
        from httpx import AsyncClient, ASGITransport
        from app.database.session import get_uow
        from app.security.dependencies import get_current_user
        await self.seed(80)
        async def uow_override():
            yield self.uow
        app.dependency_overrides[get_uow] = uow_override
        app.dependency_overrides[get_current_user] = lambda: self.user
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get(f"/api/v1/zones/{self.zone.id}/bins")
                self.assertEqual(response.status_code,200)
                row = response.json()[0]
                self.assertEqual(row["rack_capacity"]["maximum_capacity"],80)
                self.assertEqual(row["rack_capacity"]["occupied_quantity"],80)
                details = await client.get(f"/api/v1/zones/{self.zone.id}/racks/{row['rack_capacity']['id']}/materials")
                self.assertEqual(details.status_code,200)
                self.assertEqual(details.json()["materials"][0]["material_code"],"MAT-TEST")
                self.balance.quantity=70;self.balance.available_quantity=70
                await self.session.flush()
                updated = await client.get(f"/api/v1/zones/{self.zone.id}/bins")
                self.assertEqual(updated.json()[0]["rack_capacity"]["available_capacity"],10)
        finally:
            app.dependency_overrides.pop(get_uow,None)
            app.dependency_overrides.pop(get_current_user,None)

    async def test_http_create_rack_uses_capacity_handler_and_unique_route(self):
        from httpx import AsyncClient, ASGITransport
        from app.database.session import get_uow
        from app.security.dependencies import get_current_user
        for method,path in [("GET","/api/v1/zones/{zone_id}/bins"),("POST","/api/v1/zones/{zone_id}/bins"),("GET","/api/v1/zones/{zone_id}/bins/next-code")]:
            matches=[r for r in app.routes if getattr(r,"path",None)==path and method in getattr(r,"methods",set())]
            self.assertEqual(len(matches),1)
            self.assertEqual(matches[0].endpoint.__module__,"app.modules.warehouse.infrastructure.api.location_router")
        async def uow_override():
            yield self.uow
        app.dependency_overrides[get_uow]=uow_override
        app.dependency_overrides[get_current_user]=lambda:self.user
        try:
            async with AsyncClient(transport=ASGITransport(app=app),base_url="http://test") as client:
                next_code=await client.get(f"/api/v1/zones/{self.zone.id}/bins/next-code")
                payload={"bin_name":"New Rack","bin_code":next_code.json()["suggested_bin_code"],"rack":"RACK-002","capacity":80,"position":"SHELF-02"}
                created=await client.post(f"/api/v1/zones/{self.zone.id}/bins",json=payload)
                self.assertEqual(created.status_code,201,created.text)
                listed=await client.get(f"/api/v1/zones/{self.zone.id}/bins")
                row=next(row for row in listed.json() if row["rack"]=="RACK-002")
                self.assertEqual(row["rack_capacity"]["maximum_capacity"],80)
                self.assertEqual(row["rack_capacity"]["occupied_quantity"],0)
                del payload["capacity"]
                rejected=await client.post(f"/api/v1/zones/{self.zone.id}/bins",json=payload)
                self.assertEqual(rejected.status_code,422)
        finally:
            app.dependency_overrides.pop(get_uow,None)
            app.dependency_overrides.pop(get_current_user,None)

    async def test_capacity_update_without_reason_keeps_audit(self):
        from app.modules.warehouse.infrastructure.persistence.models import RackOccupancyEventModel
        await self.seed(60)
        rack=await self.rack()
        result=await update_rack_capacity(str(self.zone.id),str(rack.id),RackCapacityUpdate(maximum_capacity=100),self.user,self.uow)
        self.assertEqual(result["maximum_capacity"],100)
        event=await self.session.scalar(select(RackOccupancyEventModel).where(RackOccupancyEventModel.rack_id==rack.id).order_by(RackOccupancyEventModel.id.desc()))
        self.assertEqual(event.reason,"Capacity 80 -> 100 PCS")
        self.assertEqual(event.actor,self.user.username)
