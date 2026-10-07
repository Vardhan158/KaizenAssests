"""
SqlAlchemyReturnRepository - counterpart of JpaReturnRepository.java.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.events.outbox_repository import to_outbox_row
from app.modules.returns.application.repository import ReturnRepository
from app.modules.returns.domain.return_line import ReturnLine
from app.modules.returns.domain.return_reason import ReturnReason
from app.modules.returns.domain.return_request import ReturnRequest
from app.modules.returns.domain.return_status import ReturnStatus
from app.modules.returns.domain.value_objects import ReturnId
from app.modules.returns.infrastructure.persistence.models import ReturnLineModel, ReturnModel


class SqlAlchemyReturnRepository(ReturnRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(self, return_request: ReturnRequest) -> None:
        entity = ReturnModel(id=return_request.id.value, status=return_request.status.value)
        for line in return_request.lines:
            entity.lines.append(
                ReturnLineModel(item_code=line.item_code, quantity=line.quantity, reason=line.reason.value)
            )
        self._session.add(entity)

        for event in return_request.domain_events:
            self._session.add(to_outbox_row("ReturnRequest", str(return_request.id), event))

        await self._session.flush()

    async def find_by_id(self, return_id: ReturnId) -> Optional[ReturnRequest]:
        result = await self._session.execute(
            select(ReturnModel).options(selectinload(ReturnModel.lines)).where(ReturnModel.id == return_id.value)
        )
        entity = result.scalar_one_or_none()
        if entity is None:
            return None
        lines = [
            ReturnLine(item_code=l.item_code, quantity=l.quantity, reason=ReturnReason(l.reason))
            for l in entity.lines
        ]
        return ReturnRequest.rehydrate(ReturnId.of(entity.id), ReturnStatus(entity.status), lines)
