"""
Supplier Domain Events.
"""
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class SupplierCreatedEvent:
    supplier_id: str
    supplier_code: str
    supplier_name: str
    occurred_at: datetime = datetime.now(timezone.utc)


@dataclass(frozen=True)
class SupplierUpdatedEvent:
    supplier_id: str
    supplier_code: str
    status: str
    occurred_at: datetime = datetime.now(timezone.utc)
