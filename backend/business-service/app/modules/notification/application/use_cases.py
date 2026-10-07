"""
RecordIncomingEventUseCase - counterpart of RecordIncomingEventUseCase.java.
Everything warehouse-core/receiving and returns publish arrives here via
Kafka (see app/workers/notification_consumer.py) instead of the Phase 1
HTTP webhook, but the use case itself - and the persistence port below it -
is unchanged by that transport swap.
"""
from __future__ import annotations

from app.modules.notification.application.repository import NotificationLogRepository
from app.modules.notification.domain.incoming_event import IncomingEvent


class RecordIncomingEventUseCase:
    def __init__(self, notification_log_repository: NotificationLogRepository) -> None:
        self._notification_log_repository = notification_log_repository

    async def handle(self, raw_payload: str) -> None:
        event = IncomingEvent.receive(raw_payload)
        await self._notification_log_repository.save(event)
