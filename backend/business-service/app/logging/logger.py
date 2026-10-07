"""
Structured logging setup. Uses stdlib logging with an optional JSON
formatter so log lines are directly ingestible by the same Vector /
ClickHouse observability pipeline the rest of the platform uses.
"""
import logging
import sys
import json
from datetime import datetime, timezone

from app.config.settings import get_settings


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        extra = getattr(record, "extra_fields", None)
        if extra:
            payload.update(extra)
        return json.dumps(payload)


def configure_logging() -> None:
    settings = get_settings()
    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())

    handler = logging.StreamHandler(sys.stdout)
    if settings.log_json:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
        )
    root.handlers = [handler]

    # Quiet noisy libraries down unless the whole app is in DEBUG.
    if settings.log_level.upper() != "DEBUG":
        for noisy in ("sqlalchemy.engine", "aiokafka", "httpx", "apscheduler", "uvicorn.access"):
            logging.getLogger(noisy).setLevel(logging.ERROR)

        # Also silence specific noisy loggers that don't follow the prefix rule
        logging.getLogger("apscheduler.executors.default").setLevel(logging.ERROR)
        logging.getLogger("apscheduler.scheduler").setLevel(logging.ERROR)
        logging.getLogger("aiokafka").setLevel(logging.CRITICAL)
        logging.getLogger("app.kafka.consumer").setLevel(logging.CRITICAL)
        logging.getLogger("asyncio").setLevel(logging.CRITICAL)
        logging.getLogger("uvicorn.access").setLevel(logging.ERROR)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
