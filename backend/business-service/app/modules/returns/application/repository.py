from __future__ import annotations
from typing import Optional, Protocol

from app.modules.returns.domain.return_request import ReturnRequest
from app.modules.returns.domain.value_objects import ReturnId


class ReturnRepository(Protocol):
    async def save(self, return_request: ReturnRequest) -> None: ...
    async def find_by_id(self, return_id: ReturnId) -> Optional[ReturnRequest]: ...
