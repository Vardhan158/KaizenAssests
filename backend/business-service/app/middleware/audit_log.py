from __future__ import annotations

from urllib.parse import unquote

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.database.session import AsyncSessionFactory
from app.logging.logger import get_logger
from app.modules.admin.infrastructure.persistence.models import SystemAuditLogModel

logger = get_logger(__name__)

MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


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
    candidates = [part for part in parts if part.lower() not in ignored]
    return candidates[-1][:255] if len(candidates) > 1 else None


class AuditLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.method.upper() not in MUTATING_METHODS or request.url.path.startswith("/api/v1/auth"):
            return response

        actor = request.headers.get("X-User-Name") or request.headers.get("X-User-Username") or "Unknown"
        employee_id = request.headers.get("X-Employee-Id")
        roles = request.headers.get("X-User-Roles") or request.headers.get("X-User-Role")
        try:
            async with AsyncSessionFactory() as session:
                session.add(SystemAuditLogModel(
                    actor_username=actor[:128],
                    actor_employee_id=employee_id[:64] if employee_id else None,
                    actor_roles=roles[:255] if roles else None,
                    module=_module_for_path(request.url.path),
                    action=request.method.upper(),
                    request_path=request.url.path[:512],
                    target_reference=_target_reference(request.url.path),
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
