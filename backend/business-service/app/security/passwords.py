"""Adaptive password hashing with transparent legacy-hash migration."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets


ALGORITHM = "pbkdf2_sha256"
DEFAULT_ITERATIONS = 600_000
SALT_BYTES = 16


def hash_password(password: str, *, iterations: int = DEFAULT_ITERATIONS) -> str:
    if not password:
        raise ValueError("Password must not be empty")
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "$".join(
        (
            ALGORITHM,
            str(iterations),
            base64.urlsafe_b64encode(salt).decode("ascii").rstrip("="),
            base64.urlsafe_b64encode(digest).decode("ascii").rstrip("="),
        )
    )


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iteration_text, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != ALGORITHM:
            return False
        iterations = int(iteration_text)
        if iterations < 100_000:
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), _decode(salt_text), iterations
        )
        return hmac.compare_digest(actual, _decode(digest_text))
    except (TypeError, ValueError):
        return False


def is_legacy_sha256(encoded: str) -> bool:
    return len(encoded) == 64 and all(char in "0123456789abcdefABCDEF" for char in encoded)


def verify_with_legacy(password: str, encoded: str) -> tuple[bool, bool]:
    """Return (valid, needs_rehash), accepting legacy SHA-256 only for migration."""
    if encoded.startswith(f"{ALGORITHM}$"):
        return verify_password(password, encoded), False
    if is_legacy_sha256(encoded):
        legacy = hashlib.sha256(password.encode("utf-8")).hexdigest()
        valid = hmac.compare_digest(legacy, encoded.lower())
        return valid, valid
    return False, False
