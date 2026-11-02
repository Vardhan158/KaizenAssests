"""Database-free regressions for summary of stock after putaway."""
import unittest
import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from app.modules.storage.infrastructure.api.inventory_router import get_warehouse_inventory_summary


def result(rows):
    value = MagicMock()
    value.scalars.return_value.all.return_value = rows
    value.all.return_value = rows
    return value


class WarehouseSummaryTests(unittest.IsolatedAsyncioTestCase):
    async def summary(self, *, quantity=90, reserved=0, empty=False, batch_filter=None, movement_batch=None):
        balance = SimpleNamespace(id=uuid.uuid4(), material_code="MAT-LAPT-001", material_name="Laptop", quantity=Decimal(quantity), available_quantity=Decimal(quantity), batch_number="LOT-001", last_grn_number="GRN-2026-001", uom="PCS", updated_at=None)
        location = SimpleNamespace(location_code="WH/ZONE/BIN-001", warehouse_ref_id=None, zone_id=None, bin_id=None, bin="BIN-001", zone="ZONE-001", warehouse_id="WH-1")
        reservations = [SimpleNamespace(status="RESERVED", material_code="MAT-LAPT-001", reserved_quantity=Decimal(reserved), allocations=[{"location_code":location.location_code,"batch_number":"LOT-001","quantity":reserved}])] if reserved else []
        movement_rows = [(movement_batch, "PUTAWAY", Decimal(quantity))] if movement_batch else []
        session = AsyncMock()
        session.execute.side_effect = [result([]),result([]),result([]),result([]),result([]),result(reservations),result([]),result([] if empty else [(balance,location)])] + ([] if empty else [result(movement_rows),result([])])
        user = SimpleNamespace(username="warehouse",roles=["WAREHOUSE"],permissions=[],raw_claims={})
        with patch("app.modules.storage.infrastructure.api.inventory_router._resolve_user_warehouse_context",new=AsyncMock(return_value=(None,None))):
            return await get_warehouse_inventory_summary(user=user,uow=SimpleNamespace(session=session))

    async def test_putaway_stock_is_available_without_removed_quarantine_lookup(self):
        rows = await self.summary()
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["available_quantity"],90)
        self.assertEqual(rows[0]["quarantined_quantity"],0)
        self.assertEqual(rows[0]["stock_status"],"AVAILABLE")

    async def test_batch_reservations_are_still_deducted(self):
        rows = await self.summary(reserved=10)
        self.assertEqual(rows[0]["on_hand_quantity"],90)
        self.assertEqual(rows[0]["reserved_quantity"],10)
        self.assertEqual(rows[0]["available_quantity"],80)

    async def test_empty_inventory_returns_empty_summary(self):
        self.assertEqual(await self.summary(empty=True),[])

    async def test_movement_batch_does_not_override_batch_filter(self):
        rows = await self.summary(batch_filter="LOT-001", movement_batch="OTHER-LOT")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["batch_number"], "LOT-001")
