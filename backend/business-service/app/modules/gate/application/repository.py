"""
Repository Port Interfaces for Gate Entry module.
"""
from __future__ import annotations

from typing import Optional, Protocol

from app.modules.gate.domain.aggregate import GateEntry
from app.modules.gate.domain.enums import GateEntryStatus
from app.modules.gate.domain.services import PurchaseOrderDetails
from app.modules.gate.domain.value_objects import GateEntryId, VehicleNumber


class GateEntryRepository(Protocol):
    async def save(self, gate_entry: GateEntry) -> None: ...

    async def find_by_id(self, gate_entry_id: GateEntryId) -> Optional[GateEntry]: ...

    async def find_active_by_po_and_vehicle(
        self, po_number: str, vehicle_number: VehicleNumber
    ) -> Optional[GateEntry]: ...

    async def list_entries(
        self,
        status: GateEntryStatus | None = None,
        po_number: str | None = None,
        vehicle_number: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[GateEntry]: ...


class PurchaseOrderLookupRepository(Protocol):
    """
    Interface for querying the existing project Purchase Order database table/service.
    """

    async def find_po_details_by_number(self, po_number: str) -> Optional[PurchaseOrderDetails]: ...
