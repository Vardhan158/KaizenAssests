"""
Local JWT validation against the Java auth-service's JWKS endpoint.

Per the migration requirement, this service validates tokens LOCALLY on
every request using the auth-service's public signing key, instead of
calling the auth-service synchronously per request. The JWKS document is
fetched once and cached for `jwks_cache_ttl_seconds`; only a key-id miss
(e.g. after key rotation) forces a re-fetch.
"""
from __future__ import annotations

import time
from typing import Any

import httpx
from jose import jwt
from jose.exceptions import JWTError

from app.config.settings import get_settings
from app.logging.logger import get_logger

logger = get_logger(__name__)

_jwks_cache: dict[str, Any] = {"keys": None, "fetched_at": 0.0}


class TokenValidationError(Exception):
    pass


async def _get_jwks() -> dict:
    settings = get_settings()
    now = time.monotonic()
    if _jwks_cache["keys"] is not None and (now - _jwks_cache["fetched_at"]) < settings.jwks_cache_ttl_seconds:
        return _jwks_cache["keys"]

    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(settings.jwt_jwks_url)
        resp.raise_for_status()
        jwks = resp.json()
    _jwks_cache["keys"] = jwks
    _jwks_cache["fetched_at"] = now
    logger.info("Refreshed JWKS cache from auth-service")
    return jwks


async def _find_key(kid: str) -> dict | None:
    jwks = await _get_jwks()
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    # Key-id miss: force a refresh once (covers rotation) before giving up.
    _jwks_cache["fetched_at"] = 0.0
    jwks = await _get_jwks()
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


async def decode_and_validate(token: str) -> dict:
    """
    Returns the decoded claims (sub, roles, permissions, exp, ...) or
    raises TokenValidationError. Callers should treat any failure as 401.
    """
    settings = get_settings()
    try:
        unverified_header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise TokenValidationError("Malformed token header") from exc

    kid = unverified_header.get("kid")
    if not kid:
        raise TokenValidationError("Token header missing 'kid'")

    key = await _find_key(kid)
    if key is None:
        raise TokenValidationError(f"Unknown signing key id: {kid}")

    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=[settings.jwt_algorithm],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
        )
    except JWTError as exc:
        raise TokenValidationError(str(exc)) from exc

    return claims
