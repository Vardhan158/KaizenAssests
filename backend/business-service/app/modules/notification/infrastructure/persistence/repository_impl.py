"""
SqlAlchemyNotificationLogRepository - counterpart of
JpaNotificationLogRepository.java.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.notification.application.repository import NotificationLogRepository
from app.modules.notification.domain.incoming_event import IncomingEvent
from app.modules.notification.infrastructure.persistence.models import NotificationLogModel


class SqlAlchemyNotificationLogRepository(NotificationLogRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(self, event: IncomingEvent) -> None:
        self._session.add(NotificationLogModel(raw_payload=event.raw_payload, received_at=event.received_at))
        await self._session.flush()
