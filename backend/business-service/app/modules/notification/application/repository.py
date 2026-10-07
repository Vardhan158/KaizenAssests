from __future__ import annotations
from typing import Protocol

from app.modules.notification.domain.incoming_event import IncomingEvent


class NotificationLogRepository(Protocol):
    async def save(self, event: IncomingEvent) -> None: ...
