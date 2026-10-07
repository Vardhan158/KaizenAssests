"""
Domain events for the Gate Entry module.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from app.common.domain.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class GateEntryReadyForReceivingEvent(DomainEvent):
    gate_entry_id: str
    gate_entry_number: str
    po_number: str | None
    vehicle_plate: str
    status: str
    target_roles: list[str] = field(default_factory=lambda: ["WAREHOUSE_MANAGER", "GOODS_RECEIVING_DEPT"])
