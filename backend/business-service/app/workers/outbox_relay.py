"""
Outbox relay - counterpart of com.ams.common.outbox.OutboxRelay.
"""
from __future__ import annotations

from app.config.settings import get_settings
from app.database.session import session_scope
from app.events.outbox_repository import fetch_undelivered, mark_delivered
from app.kafka.producer import publish, is_producer_available
from app.logging.logger import get_logger

logger = get_logger(__name__)


async def relay_once() -> None:
    if not is_producer_available():
        # Skip relay if Kafka is offline to avoid log noise in local dev
        return

    settings = get_settings()
    async with session_scope() as session:
        events = await fetch_undelivered(session, settings.outbox_batch_size)
        if not events:
            return

        delivered_ids = []
        for event in events:
            try:
                await publish(
                    event_type=event.event_type,
                    key=event.aggregate_id,
                    payload=event.payload.encode("utf-8")
                )
                delivered_ids.append(event.id)
                logger.debug(f"Relayed event {event.id} ({event.event_type})")
            except Exception as e:
                logger.error(f"Failed to relay event {event.id}: {e}")

        if delivered_ids:
            await mark_delivered(session, delivered_ids)
            await session.commit()
            logger.info(f"Relayed {len(delivered_ids)} events to Kafka")
