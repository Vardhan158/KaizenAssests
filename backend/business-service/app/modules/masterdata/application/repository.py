"""
Supplier Repository interface protocol.
"""
from typing import Protocol
from app.modules.masterdata.domain.supplier import Supplier


class SupplierRepositoryProtocol(Protocol):
    async def save(self, supplier: Supplier) -> Supplier:
        ...

    async def get_by_id(self, supplier_id: str) -> Supplier | None:
        ...

    async def get_by_code(self, supplier_code: str) -> Supplier | None:
        ...

    async def list_all(
        self,
        category: str | None = None,
        status: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[Supplier], int]:
        ...
