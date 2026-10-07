"""
Kafka producer wrapper - the Python counterpart of
com.ams.common.outbox.EventDeliveryClient / HttpEventDeliveryClient.

This is deliberately the ONLY module that knows Kafka is how events leave
this service. Swapping the broker or wire format means touching this file
and nothing in domain/application code, exactly like the original design
intent documented in the Java HttpEventDeliveryClient docstring.
"""
from __future__ import annotations

from aiokafka import AIOKafkaProducer

from app.config.settings import get_settings
from app.logging.logger import get_logger

logger = get_logger(__name__)

_producer: AIOKafkaProducer | None = None


def _topic_for(event_type: str) -> str:
    settings = get_settings()
    # e.g. ams.goods-received, ams.return-requested
    slug = "".join(
        f"-{c.lower()}" if c.isupper() else c for c in event_type
    ).lstrip("-")
    return f"{settings.kafka_topic_prefix}.{slug}"


async def start_producer() -> None:
    global _producer
    settings = get_settings()
    _producer = AIOKafkaProducer(
        bootstrap_servers=settings.kafka_bootstrap_servers,
        client_id=settings.kafka_client_id,
        security_protocol=settings.kafka_security_protocol,
        enable_idempotence=True,
        acks="all",
    )
    try:
        await _producer.start()
        logger.info("Kafka producer started")
    except Exception:
        # Avoid unclosed producer warning if start fails
        try: await _producer.stop()
        except: pass
        _producer = None
        raise


async def stop_producer() -> None:
    global _producer
    if _producer is not None:
        await _producer.stop()
        _producer = None
        logger.info("Kafka producer stopped")


def is_producer_available() -> bool:
    return _producer is not None


async def publish(event_type: str, key: str, payload: bytes) -> None:
    if _producer is None:
        raise RuntimeError("Kafka producer is not available")
    topic = _topic_for(event_type)
    await _producer.send_and_wait(topic, value=payload, key=key.encode("utf-8"))
