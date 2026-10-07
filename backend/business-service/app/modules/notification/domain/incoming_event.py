"""
IncomingEvent - counterpart of IncomingEvent.java. A record of one event
delivered to this module, whether via the legacy HTTP webhook or (now) a
Kafka topic subscription. This module doesn't need a rich aggregate - its
job is "durably record what arrived, then let something else act on it"
(paging a human, sending an email, ERP sync, etc. - add here as it grows).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from app.common.domain.exceptions import DomainRuleViolationException


@dataclass(frozen=True)
class IncomingEvent:
    raw_payload: str
    received_at: datetime

    @staticmethod
    def receive(raw_payload: str | None) -> "IncomingEvent":
        if not raw_payload or not raw_payload.strip():
            raise DomainRuleViolationException("Incoming event payload must not be empty")
        return IncomingEvent(raw_payload=raw_payload, received_at=datetime.now(timezone.utc))
