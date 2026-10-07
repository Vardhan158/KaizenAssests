from dataclasses import dataclass, field
from datetime import datetime, timezone

@dataclass
class DomainEvent:
    occurred_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

@dataclass
class DispatchOrderCreated(DomainEvent):
    dispatch_id: str = ""
    dispatch_number: str = ""
    order_number: str = ""

@dataclass
class DispatchOrderStateChanged(DomainEvent):
    dispatch_id: str = ""
    status: str = ""

@dataclass
class GateExitReadyEvent(DomainEvent):
    dispatch_id: str = ""
    dispatch_number: str = ""
