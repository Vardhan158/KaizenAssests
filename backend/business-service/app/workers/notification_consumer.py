"""
Background consumer for the `notification` module - counterpart of
com.ams.platform.notification.infrastructure.api.EventWebhookController.

Phase 1 (Java) received events over an HTTP webhook. This service instead
subscribes to every domain-event topic on Kafka and calls the exact same
RecordIncomingEventUseCase that the webhook called - the application and
domain layers underneath are unchanged by the transport swap, matching the
migration note left in the original controller's docstring.
"""
from __future__ import annotations

from app.config.settings import get_settings
from app.database.session import session_scope
from app.kafka.consumer import run_consumer
from app.logging.logger import get_logger
from app.modules.notification.application.use_cases import RecordIncomingEventUseCase
from app.modules.notification.infrastructure.persistence.repository_impl import (
    SqlAlchemyNotificationLogRepository,
)

logger = get_logger(__name__)


async def _handle_message(topic: str, payload: bytes) -> None:
    async with session_scope() as session:
        repo = SqlAlchemyNotificationLogRepository(session)
        use_case = RecordIncomingEventUseCase(repo)
        await use_case.handle(payload.decode("utf-8"))


async def start_notification_consumer() -> None:
    settings = get_settings()
    topics = [
        f"{settings.kafka_topic_prefix}.goods-received-event",
        f"{settings.kafka_topic_prefix}.return-requested-event",
    ]
    await run_consumer(topics=topics, group_id=settings.kafka_consumer_group, handler=_handle_message)
