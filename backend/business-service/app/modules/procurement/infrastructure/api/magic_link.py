import base64
import hashlib
import hmac
import json
import random
import string
import time
from typing import Any, Dict, Optional, Tuple
from sqlalchemy import select

MAGIC_LINK_SECRET = "nexus-wms-procurement-magic-link-secret-key-2026"
MAGIC_LINK_DEFAULT_VALIDITY_SECONDS = 24 * 60 * 60  # 24 hours

# In-memory fast cache for instant resolution & fallback resilience
_SHORT_CODE_CACHE: Dict[str, Dict[str, Any]] = {}


def generate_short_code(length: int = 8) -> str:
    """Generates a compact, URL-safe alphanumeric short code (e.g. 'k8X9m2Pq')."""
    chars = string.ascii_letters + string.digits
    return "".join(random.choices(chars, k=length))


def generate_quotation_magic_token(
    supplier_id: str,
    username: str,
    rfq_id: str,
    email: str,
    validity_seconds: int = MAGIC_LINK_DEFAULT_VALIDITY_SECONDS,
) -> str:
    """
    Generates a cryptographically signed URL-safe token valid for `validity_seconds` (default 24 hours).
    Format: <base64url_payload>.<hmac_signature>
    """
    now = int(time.time())
    expires_at = now + validity_seconds
    payload = {
        "sub": username,
        "supplier_id": str(supplier_id),
        "rfq_id": str(rfq_id),
        "email": email,
        "iat": now,
        "exp": expires_at,
        "purpose": "quotation_submission",
    }
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    payload_b64 = (
        base64.urlsafe_b64encode(payload_json.encode("utf-8"))
        .decode("utf-8")
        .rstrip("=")
    )

    sig = hmac.new(
        MAGIC_LINK_SECRET.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return f"{payload_b64}.{sig}"


def verify_quotation_magic_token(
    token: str,
) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    """
    Verifies signature and checks 24-hour expiration.
    Returns: (is_valid: bool, payload: dict | None, error_message: str | None)
    """
    if not token or "." not in token:
        return False, None, "Invalid token format."

    parts = token.strip().split(".")
    if len(parts) != 2:
        return False, None, "Invalid token structure."

    payload_b64, signature = parts[0], parts[1]

    expected_sig = hmac.new(
        MAGIC_LINK_SECRET.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(signature, expected_sig):
        return False, None, "Invalid or tampered access link."

    try:
        padded_b64 = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload_json = base64.urlsafe_b64decode(
            padded_b64.encode("utf-8")
        ).decode("utf-8")
        payload = json.loads(payload_json)
    except Exception:
        return False, None, "Failed to decode link payload."

    exp = payload.get("exp")
    if not exp or not isinstance(exp, (int, float)):
        return False, None, "Link is missing expiration timestamp."

    now = int(time.time())
    if now > exp:
        return (
            False,
            payload,
            "This access link has expired after 24 hours. Please request a new link from procurement.",
        )

    return True, payload, None


async def create_quotation_short_link(
    session,
    supplier_id: str,
    username: str,
    rfq_id: str,
    email: str,
    validity_seconds: int = MAGIC_LINK_DEFAULT_VALIDITY_SECONDS,
) -> Tuple[str, str]:
    """
    Creates a compact 8-character short link and full signature token,
    persisting to both PostgreSQL and memory cache.
    Returns: (short_code: str, full_token: str)
    """
    from app.modules.procurement.infrastructure.persistence.models import QuotationMagicLinkModel

    now = int(time.time())
    expires_at = now + validity_seconds
    code = generate_short_code(8)
    full_token = generate_quotation_magic_token(
        supplier_id=supplier_id,
        username=username,
        rfq_id=rfq_id,
        email=email,
        validity_seconds=validity_seconds,
    )

    payload_dict = {
        "sub": username,
        "supplier_id": str(supplier_id),
        "rfq_id": str(rfq_id),
        "email": email,
        "iat": now,
        "exp": expires_at,
        "code": code,
        "token": full_token,
    }
    _SHORT_CODE_CACHE[code] = payload_dict

    try:
        link_record = QuotationMagicLinkModel(
            code=code,
            rfq_id=str(rfq_id),
            po_id=None,
            link_type="RFQ",
            supplier_id=str(supplier_id),
            username=username,
            email=email,
            token=full_token,
            created_at=now,
            expires_at=expires_at,
        )
        session.add(link_record)
        await session.flush()
    except Exception:
        # Memory cache guarantees link resolution even if DB flush is deferred
        pass

    return code, full_token


async def create_po_short_link(
    session,
    supplier_id: str,
    username: str,
    po_id: str,
    email: str,
    validity_seconds: int = MAGIC_LINK_DEFAULT_VALIDITY_SECONDS,
) -> Tuple[str, str]:
    """
    Creates a compact 8-character short link and full signature token for Purchase Order access,
    persisting to both PostgreSQL and memory cache.
    Returns: (short_code: str, full_token: str)
    """
    from app.modules.procurement.infrastructure.persistence.models import QuotationMagicLinkModel

    now = int(time.time())
    expires_at = now + validity_seconds
    code = generate_short_code(8)

    payload = {
        "sub": username,
        "supplier_id": str(supplier_id),
        "po_id": str(po_id),
        "email": email,
        "iat": now,
        "exp": expires_at,
        "purpose": "purchase_order_access",
        "link_type": "PO",
    }
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    payload_b64 = (
        base64.urlsafe_b64encode(payload_json.encode("utf-8"))
        .decode("utf-8")
        .rstrip("=")
    )
    sig = hmac.new(
        MAGIC_LINK_SECRET.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    full_token = f"{payload_b64}.{sig}"

    payload_dict = {
        "sub": username,
        "supplier_id": str(supplier_id),
        "po_id": str(po_id),
        "link_type": "PO",
        "email": email,
        "iat": now,
        "exp": expires_at,
        "code": code,
        "token": full_token,
    }
    _SHORT_CODE_CACHE[code] = payload_dict

    try:
        link_record = QuotationMagicLinkModel(
            code=code,
            rfq_id=None,
            po_id=str(po_id),
            link_type="PO",
            supplier_id=str(supplier_id),
            username=username,
            email=email,
            token=full_token,
            created_at=now,
            expires_at=expires_at,
        )
        session.add(link_record)
        await session.flush()
    except Exception:
        pass

    return code, full_token


async def resolve_quotation_short_code(
    session,
    code: str,
) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    """
    Resolves an 8-character short code, validating 24h expiration.
    Returns: (is_valid: bool, payload: dict | None, error_message: str | None)
    """
    clean_code = (code or "").strip()
    if not clean_code:
        return False, None, "Short code is required."

    now = int(time.time())

    # 1. Check in-memory fast cache
    if clean_code in _SHORT_CODE_CACHE:
        cached = _SHORT_CODE_CACHE[clean_code]
        exp = cached.get("exp", 0)
        if now > exp:
            return (
                False,
                cached,
                "This access link has expired after 24 hours. Please request a new link from procurement.",
            )
        return True, cached, None

    # 2. Check PostgreSQL database
    try:
        from app.modules.procurement.infrastructure.persistence.models import QuotationMagicLinkModel

        stmt = select(QuotationMagicLinkModel).where(QuotationMagicLinkModel.code == clean_code)
        res = await session.execute(stmt)
        record = res.scalar_one_or_none()
        if record:
            payload = {
                "sub": record.username,
                "supplier_id": record.supplier_id,
                "rfq_id": record.rfq_id,
                "po_id": record.po_id,
                "link_type": getattr(record, "link_type", None) or ("PO" if record.po_id else "RFQ"),
                "email": record.email,
                "iat": record.created_at,
                "exp": record.expires_at,
                "code": record.code,
                "token": record.token,
            }
            _SHORT_CODE_CACHE[clean_code] = payload
            if now > record.expires_at:
                return (
                    False,
                    payload,
                    "This access link has expired after 24 hours. Please request a new link from procurement.",
                )
            return True, payload, None
    except Exception:
        pass

    return False, None, "Invalid or unknown access code."


async def resolve_magic_token_or_code(
    session,
    token_or_code: str,
) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    """
    Resolves either a compact short code (e.g. 'k8X9m2Pq') or a full HMAC token.
    """
    raw = (token_or_code or "").strip()
    if not raw:
        return False, None, "Token or link code is missing."

    # If it contains a dot, it's a signed JWT / HMAC token
    if "." in raw:
        return verify_quotation_magic_token(raw)

    # Otherwise treat as short code
    return await resolve_quotation_short_code(session, raw)

