from __future__ import annotations
from typing import Protocol, Sequence
from app.modules.dispatch.domain.dispatch import DispatchOrder, DispatchStatus
from app.modules.dispatch.domain.driver import Driver
from app.modules.dispatch.domain.vehicle import Vehicle

class DispatchRepository(Protocol):
    async def save(self, order: DispatchOrder) -> DispatchOrder:
        ...

    async def get_by_id(self, dispatch_id: str) -> DispatchOrder | None:
        ...

    async def get_by_number(self, dispatch_number: str) -> DispatchOrder | None:
        ...

    async def list_all(
        self,
        status: DispatchStatus | str | None = None,
        warehouse_id: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[DispatchOrder], int]:
        ...

    async def get_ready_for_gate_exit(self) -> list[DispatchOrder]:
        ...

    async def count_by_status(self) -> dict[str, int]:
        ...

class DriverRepository(Protocol):
    async def save(self, driver: Driver) -> Driver:
        ...

    async def get_by_id(self, driver_id: str) -> Driver | None:
        ...

    async def list_all(self, status: str | None = None) -> list[Driver]:
        ...

    async def delete(self, driver_id: str) -> bool:
        ...

class VehicleRepository(Protocol):
    async def save(self, vehicle: Vehicle) -> Vehicle:
        ...

    async def get_by_id(self, vehicle_id: str) -> Vehicle | None:
        ...

    async def list_all(self, status: str | None = None) -> list[Vehicle]:
        ...

    async def delete(self, vehicle_id: str) -> bool:
        ...
