"""
Base class for domain aggregates - counterpart of
com.ams.common.domain.AggregateRoot. Collects domain events raised while a
business operation runs so the persistence adapter can save them as outbox
rows alongside the aggregate's own state change, in the same DB transaction.
"""
from __future__ import annotations

from typing import List

from app.common.domain.events import DomainEvent


class AggregateRoot:
    def __init__(self) -> None:
        self._domain_events: List[DomainEvent] = []

    def _register_event(self, event: DomainEvent) -> None:
        self._domain_events.append(event)

    @property
    def domain_events(self) -> List[DomainEvent]:
        return list(self._domain_events)

    def clear_events(self) -> None:
        self._domain_events.clear()
