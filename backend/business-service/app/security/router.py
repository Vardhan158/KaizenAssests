"""
Authentication API router.
Provides development login (/auth/dev-login), supplier authentication,
password changing, and magic-link authentication for Nexus WMS / AMS.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import random
import secrets
import string
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.common.persistence.models import QuotationMagicLinkModel, SupplierUserModel
from app.config.settings import get_settings
from app.database.session import UnitOfWork, get_uow
from app.logging.logger import get_logger
from app.modules.store.infrastructure.persistence.models import StoreManagerUserModel

logger = get_logger(__name__)

router = APIRouter()

MAGIC_LINK_SECRET = "nexus-wms-procurement-magic-link-secret-key-2026"
MAGIC_LINK_DEFAULT_VALIDITY_SECONDS = 24 * 60 * 60  # 24 hours
_SHORT_CODE_CACHE: Dict[str, Dict[str, Any]] = {}


# --- Request / Response Schemas ---

class DevLoginRequest(BaseModel):
    username: str
    password: str


class SupplierLoginRequest(BaseModel):
    username: str
    password: str


class SupplierLoginResponse(BaseModel):
    token: str
    supplier_id: str
    must_change_password: bool
    username: str


class ChangePasswordRequest(BaseModel):
    username: str
    old_password: str
    new_password: str


class MagicLoginRequest(BaseModel):
    token: str


class MagicLoginResponse(BaseModel):
    token: str
    supplier_id: str
    supplierId: str
    username: str
    must_change_password: bool = False
    roles: List[str] = ["SUPPLIER"]
    rfq_id: Optional[str] = None
    po_id: Optional[str] = None
    link_type: Optional[str] = "RFQ"
    email: Optional[str] = None
    expires_in_hours: Optional[float] = None


# --- Magic Token Helpers ---

def verify_quotation_magic_token(token: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    if not token or "." not in token:
        return False, None, "Invalid token format."

    parts = token.split(".", 1)
    if len(parts) != 2:
        return False, None, "Invalid token structure."

    payload_b64, signature = parts
    expected_sig = hmac.new(
        MAGIC_LINK_SECRET.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_sig, signature):
        return False, None, "Invalid token signature."

    try:
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload_json = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        payload = json.loads(payload_json)
    except Exception as e:
        return False, None, f"Failed to decode token payload: {e}"

    exp = payload.get("exp", 0)
    now = int(time.time())
    if now > exp:
        return False, payload, "Token has expired."

    return True, payload, None


async def resolve_quotation_short_code(session, code: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    clean_code = (code or "").strip()
    if not clean_code:
        return False, None, "Short code is required."

    cached = _SHORT_CODE_CACHE.get(clean_code)
    now = int(time.time())
    if cached:
        if now > cached.get("expires_at", 0):
            return False, cached, "Short code has expired."
        return True, cached, None

    try:
        stmt = select(QuotationMagicLinkModel).where(QuotationMagicLinkModel.code == clean_code)
        res = await session.execute(stmt)
        record = res.scalar_one_or_none()
        if not record:
            return False, None, "Link not found or invalid."

        if now > record.expires_at:
            return False, None, "Link has expired."

        data = {
            "sub": record.username,
            "supplier_id": record.supplier_id,
            "rfq_id": record.rfq_id,
            "po_id": record.po_id,
            "link_type": record.link_type,
            "email": record.email,
            "exp": record.expires_at,
        }
        _SHORT_CODE_CACHE[clean_code] = data
        return True, data, None
    except Exception as e:
        logger.warning(f"Error querying quotation_magic_link: {e}")
        return False, None, "Error resolving link."


async def resolve_magic_token_or_code(session, token_or_code: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    raw = (token_or_code or "").strip()
    if not raw:
        return False, None, "Token or link code is missing."

    if "." in raw:
        return verify_quotation_magic_token(raw)

    return await resolve_quotation_short_code(session, raw)


# --- Endpoints ---

@router.post("/dev-login")
@router.post("/login")
async def dev_login(
    request: DevLoginRequest,
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """
    Development login endpoint. Authenticates system roles and configured store managers.
    """
    settings = get_settings()
    if settings.environment.lower() not in {"local", "test", "development", "dev"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Development login is disabled outside local/test/development environments.",
        )

    req_username = (request.username or "").strip()
    req_password = request.password or ""
    req_lower = req_username.lower()
    req_upper = req_username.upper()
    req_unspaced = req_lower.replace("_", " ")

    # 1. Query StoreManagerUserModel
    account_result = await uow.session.execute(
        select(StoreManagerUserModel)
        .options(selectinload(StoreManagerUserModel.store))
        .where(
            or_(
                func.lower(StoreManagerUserModel.username) == req_lower,
                func.upper(StoreManagerUserModel.employee_id) == req_upper,
                func.lower(StoreManagerUserModel.full_name) == req_lower,
                func.lower(StoreManagerUserModel.full_name) == req_unspaced,
                func.replace(func.lower(StoreManagerUserModel.full_name), " ", "_") == req_lower,
            )
        )
        .order_by(StoreManagerUserModel.created_at.desc())
    )
    account = account_result.scalars().first()

    if account:
        if account.status and account.status.upper() != "ACTIVE":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Account is inactive",
            )

        expected_hash = hashlib.sha256(req_password.encode()).hexdigest()
        is_password_valid = (
            account.password_hash == expected_hash
            or req_password in ("Store@123", "password", "Admin@123", "warehouse123", "manager123")
        )
        if not is_password_valid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )

        session_token = secrets.token_urlsafe(48)
        account.auth_token_hash = hashlib.sha256(session_token.encode()).hexdigest()
        account.last_login = datetime.now(timezone.utc)
        await uow.commit()

        role_key = (account.role or "STORE_MANAGER").strip().upper().replace(" ", "_")
        role = {
            "SUPER_ADMIN": "ADMIN",
            "ADMIN_OFFICER": "ADMIN",
            "PROCUREMENT_MANAGER": "MANAGER",
            "PROCUREMENT_OFFICER": "PROCUREMENT",
            "WAREHOUSE_MANAGER": "WAREHOUSE_MANAGER",
            "STORE_OPERATOR": "STORE_KEEPER",
            "STORE_MANAGER": "STORE_MANAGER",
        }.get(role_key, role_key)

        token = (
            f"mock-jwt-store-manager-{account.employee_id}"
            if role == "STORE_MANAGER"
            else (
                f"mock-jwt-store-keeper-{account.employee_id}"
                if role == "STORE_KEEPER"
                else f"mock-jwt-db-user-{session_token}"
            )
        )

        return {
            "token": token,
            "username": account.username,
            "full_name": account.full_name,
            "employee_id": account.employee_id,
            "roles": [role],
            "store_id": str(account.store_id) if account.store_id else None,
            "store_code": account.store.store_code if account.store else None,
            "store_name": account.store.store_name if account.store else None,
            "applications": account.applications or [],
        }

    # 2. Configured dev credentials lookup
    normalized_username = req_lower
    admin_uname = getattr(settings, "admin_username", "admin").lower()
    wh_uname = getattr(settings, "warehouse_username", "warehouse").lower()
    proc_uname = getattr(settings, "procurement_username", "procurement").lower()
    fin_uname = getattr(settings, "finance_username", "finance").lower()
    mgr_uname = getattr(settings, "manager_username", "manager").lower()
    sup_uname = getattr(settings, "supplier_username", "supplier").lower()
    gate_sec_uname = getattr(settings, "gate_security_username", "gate_security").lower()
    gate_ent_uname = getattr(settings, "gate_entry_username", "gate_entry").lower()
    asm_uname = getattr(settings, "assembly_manager_username", "assembly_manager").lower()
    grn_uname = getattr(settings, "grn_username", "grn").lower()
    disp_uname = getattr(settings, "dispatch_username", "dispatch").lower()

    if normalized_username == admin_uname and req_password in (getattr(settings, "admin_password", "admin123"), "admin123", "password", "Admin@123"):
        return {
            "token": "mock-jwt-admin-token",
            "username": getattr(settings, "admin_username", "admin"),
            "roles": ["ADMIN"],
        }
    elif normalized_username == proc_uname and req_password in (getattr(settings, "procurement_password", "procur123"), "procur123", "password"):
        return {
            "token": "mock-jwt-procurement-token",
            "username": getattr(settings, "procurement_username", "procurement"),
            "roles": ["PROCUREMENT"],
        }
    elif normalized_username == fin_uname and req_password in (getattr(settings, "finance_password", "finance123"), "finance123", "password"):
        return {
            "token": "mock-jwt-finance-token",
            "username": getattr(settings, "finance_username", "finance"),
            "roles": ["FINANCE"],
        }
    elif normalized_username == wh_uname and req_password in (getattr(settings, "warehouse_password", "warehouse123"), "warehouse123", "password"):
        return {
            "token": "mock-jwt-warehouse-token",
            "username": getattr(settings, "warehouse_username", "warehouse"),
            "roles": ["WAREHOUSE"],
        }
    elif (
        normalized_username in (gate_sec_uname, gate_ent_uname, "gate_entry", "gate_security", "gate")
        and req_password in (getattr(settings, "gate_security_password", "gate123"), getattr(settings, "gate_entry_password", "gate123"), "gate123", "password")
    ):
        return {
            "token": "mock-jwt-gate-entry-token",
            "username": req_username,
            "roles": ["GATE_SECURITY"],
        }
    elif (
        normalized_username in (asm_uname, "assembly", "assembly_manager")
        and req_password in (getattr(settings, "assembly_manager_password", "assembly123"), "assembly123", "password")
    ):
        return {
            "token": "mock-jwt-assembly-manager-token",
            "username": getattr(settings, "assembly_manager_username", req_username),
            "roles": ["ASSEMBLY_MANAGER"],
        }
    elif normalized_username == sup_uname and req_password in (getattr(settings, "supplier_password", "supplier123"), "supplier123", "password"):
        return {
            "token": "mock-jwt-supplier-token",
            "username": getattr(settings, "supplier_username", "supplier"),
            "roles": ["SUPPLIER"],
        }
    elif (
        normalized_username in (grn_uname, "grn", "grn_manager", "operations_manager")
        and req_password in (getattr(settings, "grn_password", "123456"), "123456", "password", "grn123")
    ):
        return {
            "token": "mock-jwt-grn-token",
            "username": req_username,
            "roles": ["GRN"],
        }
    elif (
        normalized_username in (mgr_uname, "manager", "mgr", "procurement_manager")
        and req_password in (getattr(settings, "manager_password", "manager123"), "manager123", "Manager@123", "password", "Admin@123")
    ):
        return {
            "token": "mock-jwt-manager-token",
            "username": req_username,
            "roles": ["MANAGER"],
        }
    elif (
        normalized_username in (disp_uname, "dispatch", "dispatch_manager")
        and req_password in (getattr(settings, "dispatch_password", "dispatch123"), "dispatch123", "password")
    ):
        return {
            "token": "mock-jwt-dispatch-token",
            "username": req_username,
            "roles": ["DISPATCH"],
        }
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )


@router.post("/supplier-login", response_model=SupplierLoginResponse)
async def supplier_login(
    request: SupplierLoginRequest,
    uow: UnitOfWork = Depends(get_uow),
) -> SupplierLoginResponse:
    password_hash = hashlib.sha256(request.password.encode()).hexdigest()
    stmt = select(SupplierUserModel).where(
        SupplierUserModel.username == request.username,
        SupplierUserModel.password_hash == password_hash,
    )
    result = await uow.session.execute(stmt)
    user = result.scalars().first()

    if not user:
        settings = get_settings()
        if request.username == getattr(settings, "supplier_username", "supplier") and request.password in (
            getattr(settings, "supplier_password", "supplier123"),
            "supplier123",
            "password",
        ):
            return SupplierLoginResponse(
                token="mock-jwt-supplier-token",
                supplier_id="default-supplier-id",
                must_change_password=False,
                username=request.username,
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid supplier username or password",
        )

    return SupplierLoginResponse(
        token=f"supplier-mock-token-{user.id}-{user.supplier_id}",
        supplier_id=str(user.supplier_id),
        must_change_password=user.must_change_password,
        username=user.username,
    )


@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    old_hash = hashlib.sha256(request.old_password.encode()).hexdigest()
    stmt = select(SupplierUserModel).where(
        SupplierUserModel.username == request.username,
        SupplierUserModel.password_hash == old_hash,
    )
    result = await uow.session.execute(stmt)
    user = result.scalars().first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid old password",
        )

    new_hash = hashlib.sha256(request.new_password.encode()).hexdigest()
    user.password_hash = new_hash
    user.must_change_password = False
    await uow.session.flush()
    await uow.commit()
    return {"success": True}


@router.post("/magic-login", response_model=MagicLoginResponse)
async def magic_login(
    request: MagicLoginRequest,
    uow: UnitOfWork = Depends(get_uow),
) -> MagicLoginResponse:
    valid, payload, error_message = await resolve_magic_token_or_code(uow.session, request.token)
    if not valid or not payload:
        is_expired = "expired" in (error_message or "").lower()
        raise HTTPException(
            status_code=status.HTTP_410_GONE if is_expired else status.HTTP_400_BAD_REQUEST,
            detail=error_message or "Invalid or expired quotation access link.",
        )

    username = payload.get("sub")
    supplier_id_str = payload.get("supplier_id")
    rfq_id_str = payload.get("rfq_id")
    po_id_str = payload.get("po_id")
    link_type_str = payload.get("link_type") or ("PO" if po_id_str else "RFQ")
    email = payload.get("email")
    exp = payload.get("exp", 0)

    stmt = select(SupplierUserModel).where(SupplierUserModel.username == username)
    result = await uow.session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user and supplier_id_str:
        try:
            sup_uuid = uuid.UUID(supplier_id_str)
            user_stmt = select(SupplierUserModel).where(SupplierUserModel.supplier_id == sup_uuid)
            res2 = await uow.session.execute(user_stmt)
            user = res2.scalar_one_or_none()
        except Exception:
            pass

    if not user and supplier_id_str:
        try:
            sup_uuid = uuid.UUID(supplier_id_str)
            user = SupplierUserModel(
                id=uuid.uuid4(),
                supplier_id=sup_uuid,
                username=username or f"sup_{supplier_id_str[:8]}",
                password_hash=hashlib.sha256(secrets.token_hex(16).encode()).hexdigest(),
                must_change_password=False,
            )
            uow.session.add(user)
            await uow.session.flush()
            await uow.commit()
        except Exception as prov_err:
            logger.warning(f"Could not persist supplier user in session: {prov_err}")
            try:
                await uow.session.rollback()
            except Exception:
                pass

    user_id_str = str(user.id) if user else str(uuid.uuid4())
    effective_supplier_id = str(user.supplier_id) if user else str(supplier_id_str or "")
    effective_username = user.username if user else (username or "supplier")
    now = int(time.time())
    expires_in_hours = max(round((exp - now) / 3600, 1), 0.0)

    return MagicLoginResponse(
        token=f"supplier-mock-token-{user_id_str}-{effective_supplier_id}",
        supplier_id=effective_supplier_id,
        supplierId=effective_supplier_id,
        username=effective_username,
        must_change_password=False,
        roles=["SUPPLIER"],
        rfq_id=rfq_id_str,
        po_id=po_id_str,
        link_type=link_type_str,
        email=email,
        expires_in_hours=expires_in_hours,
    )


@router.get("/verify-magic-token")
async def verify_magic_token_endpoint(
    token: str = Query(...),
    uow: UnitOfWork = Depends(get_uow),
):
    valid, payload, error_message = await resolve_magic_token_or_code(uow.session, token)
    if not valid or not payload:
        is_expired = "expired" in (error_message or "").lower()
        return {
            "valid": False,
            "expired": is_expired,
            "error": error_message,
        }

    now = int(time.time())
    exp = payload.get("exp", 0)
    return {
        "valid": True,
        "expired": False,
        "rfq_id": payload.get("rfq_id"),
        "po_id": payload.get("po_id"),
        "link_type": payload.get("link_type") or ("PO" if payload.get("po_id") else "RFQ"),
        "supplier_id": payload.get("supplier_id"),
        "username": payload.get("sub"),
        "email": payload.get("email"),
        "expires_at": exp,
        "expires_in_hours": max(round((exp - now) / 3600, 1), 0.0),
    }
