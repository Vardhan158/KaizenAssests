"""Production-safe HTTP response headers."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy", "camera=(self), microphone=(), geolocation=()"
        )
        # FastAPI's Swagger UI and ReDoc pages load their assets from CDNs and
        # use a small inline bootstrap script. Keep the strict API policy for
        # every other route, while allowing only the assets required by the
        # explicitly enabled documentation pages.
        if request.url.path in {"/docs", "/redoc"}:
            content_security_policy = (
                "default-src 'none'; "
                "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "img-src 'self' data: https://fastapi.tiangolo.com; "
                "connect-src 'self'; "
                "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
            )
        else:
            content_security_policy = (
                "default-src 'none'; frame-ancestors 'none'; "
                "base-uri 'none'; form-action 'self'"
            )
        response.headers.setdefault("Content-Security-Policy", content_security_policy)
        if request.url.scheme == "https":
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response
