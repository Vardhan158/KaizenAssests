from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from app.common.domain.events import DomainEvent


@dataclass(frozen=True)
class RequestedLine:
    item_code: str
    quantity: Decimal
    reason: str


@dataclass(frozen=True, kw_only=True)
class ReturnRequestedEvent(DomainEvent):
    return_id: str
    lines: list[RequestedLine]
