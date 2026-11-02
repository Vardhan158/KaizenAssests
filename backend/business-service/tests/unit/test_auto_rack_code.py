import asyncio
from unittest.mock import AsyncMock, Mock
import uuid

from app.modules.warehouse.infrastructure.api.location_router import BinCreateRequest, _next_rack_code


def test_rack_creation_accepts_server_generated_code_without_position():
    payload = BinCreateRequest(bin_name="ZONE-A-BIN-001", bin_code="ZONE-A-BIN-001", capacity=80)
    assert payload.rack is None
    assert payload.position is None


def test_next_rack_uses_highest_sequence_including_legacy_bins():
    session = AsyncMock()
    session.execute.side_effect = [
        Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=["RACK-001", "RACK-003"])))),
        Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=["RACK-009", None, "CUSTOM"])))),
    ]
    assert asyncio.run(_next_rack_code(session, uuid.uuid4())) == "RACK-010"


def test_empty_zone_starts_at_rack_001():
    session = AsyncMock()
    session.execute.return_value = Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[]))))
    assert asyncio.run(_next_rack_code(session, uuid.uuid4())) == "RACK-001"
