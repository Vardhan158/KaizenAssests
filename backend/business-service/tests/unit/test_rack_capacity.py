"""Real SQLite transactions: capacity cannot be bypassed through another stock flow."""
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from decimal import Decimal
from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from pydantic import ValidationError
from app.modules.storage.application.rack_capacity import install_rack_capacity
from app.modules.warehouse.infrastructure.api.location_router import BinCreateRequest, RackCapacityUpdate, EmptyRackRequest, _rack_response
from types import SimpleNamespace


class RackCapacityDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.engine = create_engine("sqlite:///" + str(Path(self.tmp.name) / "test.db"), connect_args={"timeout": 10})
        self.zone, self.bin1, self.bin2, self.loc1, self.loc2 = [str(uuid.uuid4()) for _ in range(5)]
        with self.engine.begin() as c:
            c.exec_driver_sql("CREATE TABLE warehouse_zone(id varchar(36) PRIMARY KEY)")
            c.exec_driver_sql("CREATE TABLE warehouse_bin(id varchar(36) PRIMARY KEY, zone_id varchar(36), rack varchar(64), capacity numeric)")
            c.exec_driver_sql("CREATE TABLE storage_location(id varchar(36) PRIMARY KEY, bin_id varchar(36))")
            c.exec_driver_sql("CREATE TABLE inventory_location_balance(id varchar(36) PRIMARY KEY, storage_location_id varchar(36), material_code text, batch_number text, quantity numeric NOT NULL, available_quantity numeric NOT NULL, uom text)")
            c.execute(text("INSERT INTO warehouse_zone VALUES(:id)"), {"id":self.zone})
            for b,l,r in [(self.bin1,self.loc1,"RACK-001"),(self.bin2,self.loc2,"RACK-002")]:
                c.execute(text("INSERT INTO warehouse_bin VALUES(:b,:z,:r,80)"), {"b":b,"z":self.zone,"r":r})
                c.execute(text("INSERT INTO storage_location VALUES(:l,:b)"), {"l":l,"b":b})
            install_rack_capacity(c)
    def tearDown(self):
        self.engine.dispose(); self.tmp.cleanup()
    def add(self, quantity, location=None, material="MAT-A", batch="B1", c=None, uom="PCS"):
        values={"id":str(uuid.uuid4()),"l":location or self.loc1,"m":material,"b":batch,"q":quantity,"u":uom}
        sql=text("INSERT INTO inventory_location_balance VALUES(:id,:l,:m,:b,:q,:q,:u)")
        if c is not None: c.execute(sql,values)
        else:
            with self.engine.begin() as connection: connection.execute(sql,values)
        return values["id"]
    def occupancy(self,rack="RACK-001"):
        with self.engine.connect() as c:
            return c.execute(text("SELECT occupied_quantity,maximum_capacity FROM warehouse_rack WHERE rack_code=:r"),{"r":rack}).one()
    def change(self,id,q):
        with self.engine.begin() as c: c.execute(text("UPDATE inventory_location_balance SET quantity=:q,available_quantity=:q WHERE id=:id"),{"q":q,"id":id})
    def test_empty_partial_and_full(self):
        self.assertEqual(self.occupancy(),(0,80));self.add(60);self.assertEqual(self.occupancy(),(60,80));self.add(20,batch="B2");self.assertEqual(self.occupancy(),(80,80))
    def test_exceeded_capacity_rolls_back_stock_and_history(self):
        self.add(60)
        with self.assertRaises(DBAPIError): self.add(80)
        self.assertEqual(self.occupancy(),(60,80))
        with self.engine.connect() as c: self.assertEqual(c.scalar(text("SELECT count(*) FROM rack_occupancy_event")),1)
    def test_multiple_materials_and_batches_share_one_limit(self):
        self.add(30);self.add(40,material="MAT-B",batch="B2")
        with self.assertRaises(DBAPIError):self.add(11,material="MAT-C")
        self.assertEqual(self.occupancy(),(70,80))
    def test_partial_and_complete_pick(self):
        id=self.add(80);self.change(id,60);self.assertEqual(self.occupancy(),(60,80));self.change(id,0);self.assertEqual(self.occupancy(),(0,80))
    def test_negative_quantities_are_rejected(self):
        id=self.add(20)
        with self.assertRaises(DBAPIError):self.change(id,-1)
        self.assertEqual(self.occupancy(),(20,80))
    def test_fractional_or_non_pcs_stock_is_rejected(self):
        for q,uom in [(1.5,"PCS"),(10,"KG")]:
            with self.subTest(q=q),self.assertRaises(DBAPIError):self.add(q,uom=uom)
    def test_capacity_cannot_drop_below_occupancy(self):
        self.add(60)
        with self.assertRaises(DBAPIError),self.engine.begin() as c:c.exec_driver_sql("UPDATE warehouse_rack SET maximum_capacity=50 WHERE rack_code='RACK-001'")
    def test_transfer_updates_both_racks(self):
        id=self.add(60)
        with self.engine.begin() as c:
            c.execute(text("UPDATE inventory_location_balance SET quantity=40,available_quantity=40 WHERE id=:id"),{"id":id})
            self.add(20,self.loc2,c=c)
        self.assertEqual(self.occupancy(),(40,80));self.assertEqual(self.occupancy("RACK-002"),(20,80))
    def test_failed_transfer_rolls_back_source(self):
        id=self.add(60);self.add(80,self.loc2)
        with self.assertRaises(DBAPIError),self.engine.begin() as c:
            c.execute(text("UPDATE inventory_location_balance SET quantity=40,available_quantity=40 WHERE id=:id"),{"id":id})
            self.add(20,self.loc2,c=c)
        self.assertEqual(self.occupancy(),(60,80));self.assertEqual(self.occupancy("RACK-002"),(80,80))
    def test_concurrent_putaways_do_not_overallocate(self):
        self.add(60);barrier=Barrier(2)
        def write():
            barrier.wait()
            try:self.add(15);return True
            except DBAPIError:return False
        with ThreadPoolExecutor(max_workers=2) as pool: outcomes=list(pool.map(lambda _:write(),range(2)))
        self.assertEqual(sorted(outcomes),[False,True]);self.assertEqual(self.occupancy(),(75,80))
    def test_adjustment_and_delete_remain_audited(self):
        id=self.add(60);self.change(id,40)
        with self.engine.begin() as c:c.execute(text("DELETE FROM inventory_location_balance WHERE id=:id"),{"id":id})
        self.assertEqual(self.occupancy(),(0,80))
        with self.engine.connect() as c:self.assertEqual(c.scalar(text("SELECT sum(quantity_delta) FROM rack_occupancy_event")),0)
    def test_existing_racks_backfilled_from_real_balances_once(self):
        self.add(20)
        with self.engine.begin() as c:install_rack_capacity(c)
        self.assertEqual(self.occupancy(),(20,80))
    def test_multiple_legacy_bins_share_one_rack(self):
        with self.engine.begin() as c:
            c.execute(text("UPDATE warehouse_bin SET rack='RACK-001' WHERE id=:id"),{"id":self.bin2})
        self.add(60);self.add(20,self.loc2)
        with self.assertRaises(DBAPIError):self.add(1,self.loc2)
        self.assertEqual(self.occupancy(),(80,80))


class RackCapacityValidationTests(unittest.TestCase):
    def test_creation_requires_capacity_without_shelf(self):
        payload={"bin_code":"ZONE-001-BIN-001","bin_name":"Rack","rack":"RACK-001","capacity":80}
        self.assertIsNone(BinCreateRequest(**payload).position)
        for capacity in (0,-1,1.5,True,None):
            with self.subTest(capacity=capacity),self.assertRaises(ValidationError):BinCreateRequest(**{**payload,"capacity":capacity})
        del payload["capacity"]
        with self.assertRaises(ValidationError):BinCreateRequest(**payload)
    def test_empty_requires_confirmation_and_reason(self):
        for payload in ({"reason":"Approved adjustment"},{"confirm":True,"reason":"  "}):
            with self.assertRaises(ValidationError):EmptyRackRequest(**payload)
    def test_status_and_percentage(self):
        for occupied,status,percent in [(0,"Empty",0),(60,"Partially Occupied",75),(80,"Full",100)]:
            result=_rack_response(SimpleNamespace(id=uuid.uuid4(),rack_code="RACK-001",maximum_capacity=80,occupied_quantity=Decimal(occupied)))
            self.assertEqual(result["occupancy_status"],status);self.assertEqual(result["occupancy_percentage"],percent);self.assertEqual(result["available_capacity"],80-occupied)
