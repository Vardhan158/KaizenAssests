"""
Assigns a request-scoped correlation id (reused from the incoming
X-Request-Id header when present) so every log line, database call, and
Kafka publish tied to a request can be joined by that id downstream in
ClickHouse - consistent with the rest of the platform's observability
pipeline.
"""
from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-Id", str(uuid.uuid4()))
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response
