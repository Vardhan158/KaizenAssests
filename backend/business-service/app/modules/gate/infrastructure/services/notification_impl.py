"""
Notification gateway implementation for Gate Entry module.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.events.outbox_repository import to_outbox_row
from app.modules.gate.application.interfaces import NotificationGateway
from app.modules.gate.domain.events import DomainEvent


@dataclass(kw_only=True)
class GateEntryReadyForReceivingEvent(DomainEvent):
    gate_entry_id: str = ""
    po_number: str = ""
    vehicle_number: str = ""
    recipient_roles: list[str] = field(default_factory=lambda: ["WAREHOUSE_MANAGER", "GOODS_RECEIVING_DEPT"])


class OutboxNotificationGateway(NotificationGateway):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def notify_ready_for_receiving(
        self, gate_entry_id: str, po_number: str, vehicle_number: str, details: dict
    ) -> None:
        event = GateEntryReadyForReceivingEvent(
            gate_entry_id=gate_entry_id,
            po_number=po_number,
            vehicle_number=vehicle_number,
            recipient_roles=["WAREHOUSE_MANAGER", "GOODS_RECEIVING_DEPT"],
        )
        self._session.add(to_outbox_row("GateEntryNotification", gate_entry_id, event))
        await self._session.flush()
