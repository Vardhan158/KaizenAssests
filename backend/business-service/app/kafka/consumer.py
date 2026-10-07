"""
Generic Kafka consumer runner used by background workers.
"""
from __future__ import annotations

from typing import Awaitable, Callable

from aiokafka import AIOKafkaConsumer

from app.config.settings import get_settings
from app.logging.logger import get_logger

logger = get_logger(__name__)


async def run_consumer(
    topics: list[str],
    group_id: str,
    handler: Callable[[str, bytes], Awaitable[None]],
) -> None:
    settings = get_settings()
    consumer = AIOKafkaConsumer(
        *topics,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id=group_id,
        security_protocol=settings.kafka_security_protocol,
        enable_auto_commit=False,
        auto_offset_reset="earliest",
    )
    try:
        await consumer.start()
    except Exception as exc:
        logger.debug(f"Kafka consumer skipped (Kafka offline or unavailable): {exc}")
        # Explicitly stop to avoid 'Unclosed AIOKafkaConsumer' warnings
        try: await consumer.stop()
        except Exception: pass
        return

    logger.info("Kafka consumer started", extra={"extra_fields": {"topics": topics, "group_id": group_id}})
    try:
        async for message in consumer:
            await handler(message.topic, message.value)
            await consumer.commit()
    finally:
        await consumer.stop()
