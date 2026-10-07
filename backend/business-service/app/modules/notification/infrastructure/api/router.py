"""
Legacy HTTP webhook - counterpart of EventWebhookController.java. Kept as a
backward-compatible ingress path (e.g. for services outside the Kafka
cluster, or local dev without Kafka running); the primary path in this
architecture is the Kafka consumer in app/workers/notification_consumer.py,
which calls the exact same RecordIncomingEventUseCase.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.database.session import UnitOfWork, get_uow
from app.modules.notification.application.use_cases import RecordIncomingEventUseCase
from app.modules.notification.infrastructure.persistence.repository_impl import (
    SqlAlchemyNotificationLogRepository,
)

router = APIRouter(prefix="/webhooks", tags=["notification"])


@router.post("/events", status_code=200)
async def receive(request: Request, uow: UnitOfWork = Depends(get_uow)) -> None:
    raw_payload = (await request.body()).decode("utf-8")
    repo = SqlAlchemyNotificationLogRepository(uow.session)
    use_case = RecordIncomingEventUseCase(repo)
    await use_case.handle(raw_payload)
