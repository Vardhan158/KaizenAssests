"""
Helpers for writing and polling outbox rows. Kept framework-light: a plain
function that a module's SQLAlchemy repository calls inside its own `save()`
(same pattern JpaGrnRepository used with OutboxEventRepository), plus a
query used by the relay worker.
"""
from __future__ import annotations

import json
from typing import Sequence

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.domain.events import DomainEvent
from app.events.outbox_model import OutboxEventModel


def to_outbox_row(aggregate_type: str, aggregate_id: str, event: DomainEvent) -> OutboxEventModel:
    payload = json.dumps(_event_to_dict(event), default=str)
    return OutboxEventModel(
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        event_type=type(event).__name__,
        payload=payload,
        occurred_at=event.occurred_at,
        delivered=False,
    )


def _event_to_dict(event: DomainEvent) -> dict:
    from dataclasses import asdict

    return asdict(event)


async def fetch_undelivered(session: AsyncSession, limit: int) -> Sequence[OutboxEventModel]:
    result = await session.execute(
        select(OutboxEventModel)
        .where(OutboxEventModel.delivered.is_(False))
        .order_by(OutboxEventModel.occurred_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    return result.scalars().all()


async def mark_delivered(session: AsyncSession, ids: list) -> None:
    if not ids:
        return
    await session.execute(
        update(OutboxEventModel)
        .where(OutboxEventModel.id.in_(ids))
        .values(delivered=True, delivered_at=DomainEvent.now())
    )
