import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import uuid
import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from app.modules.warehouse.infrastructure.api import location_router as router


def setup(monkeypatch, occupied=0):
    rack = SimpleNamespace(id=uuid.uuid4(), zone_id=uuid.uuid4(), rack_code="RACK-001", occupied_quantity=occupied)
    monkeypatch.setattr(router, "_require_location_write", Mock())
    monkeypatch.setattr(router, "_rack_in_zone", AsyncMock(return_value=rack))
    monkeypatch.setattr(router, "_lock_rack", AsyncMock(return_value=rack))
    session = AsyncMock()
    session.scalars.return_value = Mock(all=Mock(return_value=[]))
    return rack, SimpleNamespace(session=session, rollback=AsyncMock())


def test_occupied_rack_cannot_be_deleted(monkeypatch):
    rack,uow=setup(monkeypatch,20)
    with pytest.raises(HTTPException) as error:
        asyncio.run(router.delete_rack(str(rack.zone_id),str(rack.id),SimpleNamespace(),uow))
    assert error.value.status_code==409
    uow.session.delete.assert_not_awaited()


def test_empty_unreferenced_rack_can_be_deleted(monkeypatch):
    rack,uow=setup(monkeypatch)
    result=asyncio.run(router.delete_rack(str(rack.zone_id),str(rack.id),SimpleNamespace(),uow))
    assert result["deleted"] is True
    uow.session.delete.assert_awaited_once_with(rack)


def test_reference_error_rolls_back_deletion(monkeypatch):
    rack,uow=setup(monkeypatch)
    uow.session.flush.side_effect=IntegrityError("delete",{},Exception())
    with pytest.raises(HTTPException) as error:
        asyncio.run(router.delete_rack(str(rack.zone_id),str(rack.id),SimpleNamespace(),uow))
    assert error.value.status_code==409
    uow.rollback.assert_awaited_once()
