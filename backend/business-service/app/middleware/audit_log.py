from __future__ import annotations

import re
from urllib.parse import unquote

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.database.session import AsyncSessionFactory
from app.logging.logger import get_logger
from app.modules.admin.infrastructure.persistence.models import SystemAuditLogModel

logger = get_logger(__name__)

IGNORED_PATHS = {"/api/v1/admin/audit-logs"}


def _module_for_path(path: str) -> str:
    clean = path.removeprefix("/api/v1/").removeprefix("/api/")
    first = clean.split("/", 1)[0].replace("-", "_")
    aliases = {
        "gate_entries": "GATE",
        "receiving": "GRN",
        "storage": "WAREHOUSE",
        "inventory": "WAREHOUSE",
        "assembly_requisitions": "ASSEMBLY",
        "finished_goods": "ASSEMBLY",
    }
    return aliases.get(first, first.upper() or "SYSTEM")


def _target_reference(path: str) -> str | None:
    parts = [unquote(part) for part in path.split("/") if part]
    ignored = {"api", "v1", "header", "status", "complete", "approve", "reject"}
    candidates = [
        part for part in parts
        if part.lower() not in ignored
        and not re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}", part)
        and not part.isdigit()
    ]
    return candidates[-1][:255] if candidates else None


class AuditLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path.rstrip("/") or "/"
        method = request.method.upper()
        if (
            not path.startswith("/api/")
            or path in IGNORED_PATHS
            or method in {"OPTIONS", "HEAD"}
            or path in {"/api/health", "/api/v1/health"}
        ):
            return response

        # Authentication dependencies attach the verified identity to the request.
        # Headers remain a fallback for legacy and unauthenticated operational endpoints.
        user = getattr(request.state, "audit_user", None)
        actor = getattr(request.state, "audit_actor", None) or (getattr(user, "username", None) if user else None) or request.headers.get("X-User-Name") or request.headers.get("X-User-Username") or "Unknown"
        claims = getattr(user, "raw_claims", {}) if user else {}
        employee_id = getattr(request.state, "audit_employee_id", None) or claims.get("employee_id") or request.headers.get("X-Employee-Id")
        user_roles = getattr(user, "roles", None) if user else None
        roles = getattr(request.state, "audit_roles", None) or (",".join(user_roles) if user_roles else request.headers.get("X-User-Roles") or request.headers.get("X-User-Role"))
        lower_path = path.lower()
        if lower_path.endswith(("/login", "/dev-login", "/supplier-login", "/magic-login")):
            audit_action = "LOGIN"
        elif lower_path.endswith("/logout"):
            audit_action = "LOGOUT"
        else:
            audit_action = method
        try:
            async with AsyncSessionFactory() as session:
                session.add(SystemAuditLogModel(
                    actor_username=actor[:128],
                    actor_employee_id=employee_id[:64] if employee_id else None,
                    actor_roles=roles[:255] if roles else None,
                    module=_module_for_path(path),
                    action=audit_action,
                    request_path=path[:512],
                    target_reference=_target_reference(path),
                    status_code=response.status_code,
                    result="SUCCESS" if response.status_code < 400 else "FAILED",
                    request_id=getattr(request.state, "request_id", None),
                    ip_address=request.client.host[:64] if request.client else None,
                    user_agent=(request.headers.get("User-Agent") or "")[:1000] or None,
                ))
                await session.commit()
        except Exception as exc:
            logger.warning("Unable to persist audit log: %s", exc)
        return response
