"""
DomainEvent base - direct counterpart of com.ams.common.domain.DomainEvent.
Implementations are frozen dataclasses (the Python equivalent of a Java
record): immutable, structural equality, no framework imports.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True, kw_only=True)
class DomainEvent:
    occurred_at: datetime

    @staticmethod
    def now() -> datetime:
        return datetime.now(timezone.utc)
