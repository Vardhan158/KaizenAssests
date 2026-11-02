import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from fastapi import HTTPException

from app.modules.receiving.infrastructure.persistence.repository_impl import SqlAlchemyGrnRepository
from app.modules.warehouse.infrastructure.api.location_router import _get_primary_warehouse, list_zones


class CompletedGrnLabelsTests(unittest.IsolatedAsyncioTestCase):
    async def test_completed_receipts_return_saved_damage_lots_without_writes(self):
        for status in ("COMPLETED", "POSTED", "GRN_POSTED", "RECEIVING_COMPLETE"):
            with self.subTest(status=status):
                lot = SimpleNamespace(id=uuid.uuid4(), damaged_quantity=10)
                grn = SimpleNamespace(status=status, lines=[SimpleNamespace(damage_lots=[lot])])
                session = SimpleNamespace(
                    execute=AsyncMock(return_value=Mock(scalar_one_or_none=Mock(return_value=grn))),
                    add=Mock(), flush=AsyncMock(),
                )
                result = await SqlAlchemyGrnRepository(session).create_or_get_damage_lots_for_grn(uuid.uuid4())
                self.assertEqual(result, [lot])
                session.add.assert_not_called()
                session.flush.assert_not_awaited()

    async def test_completed_receipt_without_saved_lots_returns_empty(self):
        grn = SimpleNamespace(status="COMPLETED", lines=[SimpleNamespace(damage_lots=[])])
        session = SimpleNamespace(execute=AsyncMock(return_value=Mock(scalar_one_or_none=Mock(return_value=grn))))
        self.assertEqual(await SqlAlchemyGrnRepository(session).create_or_get_damage_lots_for_grn(uuid.uuid4()), [])


class EmptyWarehouseZonesTests(unittest.IsolatedAsyncioTestCase):
    async def test_listing_zones_after_reset_returns_empty(self):
        session = SimpleNamespace(scalar=AsyncMock(return_value=None), execute=AsyncMock())
        result = await list_zones(None, SimpleNamespace(session=session))
        self.assertEqual(result, [])
        session.execute.assert_not_awaited()

    async def test_mutations_still_require_a_configured_warehouse(self):
        uow = SimpleNamespace(session=SimpleNamespace(scalar=AsyncMock(return_value=None)))
        with self.assertRaises(HTTPException) as error:
            await _get_primary_warehouse(uow)
        self.assertEqual(error.exception.status_code, 409)
