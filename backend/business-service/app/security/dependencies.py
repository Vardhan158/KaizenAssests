"""
FastAPI dependency-injection helpers for authentication and RBAC authorization.
Supports explicit test-only mock identities and persisted local sessions.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config.settings import get_settings
from app.security.jwt import TokenValidationError, decode_and_validate

_bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    subject: str
    username: str
    roles: list[str]
    permissions: list[str]
    raw_claims: dict


async def _resolve_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> CurrentUser:
    settings = get_settings()

    # 1. Check custom proxy/test headers (X-User-Roles, X-User-Role, X-User-Name, X-User-Id)
    roles_hdr = (
        request.headers.get("X-User-Roles")
        or request.headers.get("x-user-roles")
        or request.headers.get("X-User-Role")
        or request.headers.get("x-user-role")
    )
    if roles_hdr and settings.environment.lower() == "test":
        roles = [r.strip() for r in roles_hdr.split(",") if r.strip()]
        user_name = request.headers.get("X-User-Name") or request.headers.get("x-user-name") or request.headers.get("X-User-Username") or request.headers.get("x-user-username") or "test_user"
        user_id = request.headers.get("X-User-Id") or request.headers.get("x-user-id") or request.headers.get("X-User-Subject") or request.headers.get("x-user-subject") or user_name
        warehouse_code = request.headers.get("X-Warehouse-Code") or request.headers.get("x-warehouse-code") or request.headers.get("X-User-Warehouse-Code") or request.headers.get("x-user-warehouse-code")
        warehouse_ref_id = request.headers.get("X-Warehouse-Id") or request.headers.get("x-warehouse-id") or request.headers.get("X-User-Warehouse-Id") or request.headers.get("x-user-warehouse-id")
        emp_id = request.headers.get("X-Employee-Id") or request.headers.get("x-employee-id") or request.headers.get("X-User-Employee-Id") or request.headers.get("x-user-employee-id") or user_id
        claims = {}
        if warehouse_code:
            claims["warehouse_code"] = warehouse_code
        if warehouse_ref_id:
            claims["warehouse_ref_id"] = warehouse_ref_id
        if emp_id:
            claims["employee_id"] = emp_id
        roles_upper = {r.upper() for r in roles}
        perms = []
        if "WAREHOUSE" in roles_upper or "WAREHOUSE_MANAGER" in roles_upper:
            perms.extend(["gate:read", "gate:write", "gate:approve", "gate:verify", "gate:entry:read", "gate:entry:create", "storage:read", "storage:write", "receiving:read", "receiving:write", "returns:read", "returns:write", "warehouse:read", "warehouse:write"])
        if "GATE_SECURITY" in roles_upper:
            # Gate security also operates the outbound gate queue.  These are
            # read/execute permissions for dispatches that have already passed
            # warehouse loading and final verification.
            perms.extend(["gate:read", "gate:write", "gate:entry:read", "gate:entry:create", "gate:entry:verify", "dispatch:read", "dispatch:execute"])
        if "WAREHOUSE_OPERATOR" in roles_upper:
            perms.extend(["warehouse:read", "warehouse:write", "storage:read", "putaway:execute", "pickup:execute"])
        if "WAREHOUSE_OPERATOR" in roles_upper:
            perms.extend(["warehouse:read", "storage:read", "putaway:execute", "pickup:execute"])
        if "ASSEMBLY" in roles_upper:
            perms.extend(["material_request:create", "material_request:read"])

        return CurrentUser(
            subject=user_id,
            username=user_name,
            roles=roles,
            permissions=list(set(perms)),
            raw_claims=claims,
        )

    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = credentials.credentials
    if token.startswith("supplier-db-token-"):
        from sqlalchemy import select
        from app.common.persistence.models import SupplierUserModel
        from app.database.session import AsyncSessionFactory

        session_token = token.removeprefix("supplier-db-token-")
        token_hash = hashlib.sha256(session_token.encode()).hexdigest()
        async with AsyncSessionFactory() as session:
            supplier_account = (
                await session.execute(
                    select(SupplierUserModel).where(
                        SupplierUserModel.auth_token_hash == token_hash,
                        SupplierUserModel.auth_token_expires_at > datetime.now(timezone.utc),
                    )
                )
            ).scalar_one_or_none()
        if supplier_account is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")
        return CurrentUser(
            subject=str(supplier_account.id),
            username=supplier_account.username,
            roles=["SUPPLIER"],
            permissions=[],
            raw_claims={"supplier_id": str(supplier_account.supplier_id)},
        )

    if settings.environment.lower() in ("local", "dev", "test", "development"):
        if token == "mock-jwt-manager-token" and settings.environment.lower() == "test":
            return CurrentUser(
                subject="manager",
                username="manager",
                roles=["MANAGER"],
                permissions=["procurement:approve", "gate:approve"],
                raw_claims={},
            )
        if token.startswith("mock-jwt-db-user-"):
            session_token = token.removeprefix("mock-jwt-db-user-")
            from sqlalchemy import select
            from sqlalchemy.orm import selectinload
            from app.database.session import AsyncSessionFactory
            from app.modules.warehouse.infrastructure.persistence.models import UserAccountModel

            async with AsyncSessionFactory() as session:
                result = await session.execute(
                    select(UserAccountModel)
                    .options(selectinload(UserAccountModel.warehouse))
                    .where(
                        UserAccountModel.auth_token_hash == hashlib.sha256(session_token.encode()).hexdigest(),
                        UserAccountModel.status == "ACTIVE",
                        UserAccountModel.auth_token_expires_at > datetime.now(timezone.utc),
                    )
                )
                account = result.scalar_one_or_none()
            if account:
                role_key = account.role.strip().upper().replace(" ", "_")
                role = {
                    "SUPER_ADMIN": "ADMIN",
                    "ADMIN_OFFICER": "ADMIN",
                    "PROCUREMENT_MANAGER": "MANAGER",
                    "PROCUREMENT_OFFICER": "PROCUREMENT",
                    "WAREHOUSE_MANAGER": "WAREHOUSE_MANAGER",
                    "WAREHOUSE_OPERATOR": "WAREHOUSE_OPERATOR",
                    "WAREHOUSE_OPERATOR": "WAREHOUSE_OPERATOR",
                }.get(role_key, role_key)

                perms = []
                if role in ("ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE"):
                    perms = ["gate:read", "gate:write", "gate:approve", "gate:verify", "gate:entry:read", "gate:entry:create", "storage:read", "storage:write", "receiving:read", "receiving:write", "returns:read", "returns:write", "warehouse:read", "warehouse:write", "dispatch:read", "dispatch:write", "dispatch:execute"]
                elif role == "WAREHOUSE_OPERATOR":
                    perms = ["warehouse:read", "warehouse:write", "storage:read", "putaway:execute", "pickup:execute"]
                elif role == "WAREHOUSE_OPERATOR":
                    perms = ["warehouse:read", "storage:read", "putaway:execute", "pickup:execute"]
                elif role in ("ASSEMBLY", "ASSEMBLY_MANAGER"):
                    perms = ["material_request:create", "material_request:read", "assembly:read", "assembly:write"]
                elif role in ("DISPATCH", "DISPATCH_MANAGER"):
                    perms = ["dispatch:read", "dispatch:write", "dispatch:execute"]

                claims = {
                    "employee_id": account.employee_id,
                    "applications": account.applications or [],
                    "warehouse_ref_id": str(account.warehouse_ref_id) if account.warehouse_ref_id else None,
                    "warehouse_code": account.warehouse.warehouse_code if account.warehouse else None,
                    "warehouse_name": account.warehouse.warehouse_name if account.warehouse else None,
                }
                return CurrentUser(
                    subject=account.employee_id,
                    username=account.username,
                    roles=[role],
                    permissions=perms,
                    raw_claims=claims,
                )
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")
        if token == "mock-jwt-supplier-token" and settings.environment.lower() == "test":
            return CurrentUser(
                subject="supplier",
                username="supplier_partner",
                roles=["SUPPLIER"],
                permissions=[],
                raw_claims={"supplier_id": "sup-00001"},
            )
        if settings.environment.lower() != "test":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")
        elif token == "mock-jwt-warehouse-token":
            return CurrentUser(
                subject="warehouse_manager",
                username="warehouse_manager",
                roles=["WAREHOUSE", "ADMIN"],
                permissions=["gate:read", "gate:entry:create", "gate:entry:read", "gate:entry:verify", "gate:write", "warehouse:write"],
                raw_claims={},
            )
        elif token == "mock-jwt-gate-entry-token":
            return CurrentUser(
                subject="gate_security",
                username="gate_security",
                roles=["GATE_SECURITY"],
                permissions=["gate:read", "gate:write", "gate:verify", "gate:entry:create", "gate:entry:read", "gate:entry:verify", "dispatch:read", "dispatch:execute"],
                raw_claims={},
            )
        elif token == "mock-jwt-grn-token":
            return CurrentUser(
                subject="grn_officer",
                username="grn_officer",
                roles=["GRN", "WAREHOUSE"],
                permissions=["gate:read", "gate:entry:create", "gate:entry:read", "gate:entry:verify", "gate:write", "warehouse:write"],
                raw_claims={},
            )
        elif token == "mock-jwt-warehouse-token":
            return CurrentUser(
                subject="warehouse",
                username="warehouse",
                roles=["WAREHOUSE", "ADMIN"],
                permissions=["gate:write", "gate:entry:create", "gate:entry:read", "gate:entry:verify"],
                raw_claims={},
            )
        elif token == "mock-jwt-gate-entry-token" or token == "mock-jwt-grn-token":
            return CurrentUser(
                subject="gate_operator",
                username="gate_operator",
                roles=["GATE_OPERATOR", "ADMIN"],
                permissions=["gate:write", "gate:entry:create", "gate:entry:read", "gate:entry:verify"],
                raw_claims={},
            )
        elif token == "mock-jwt-warehouse-token":
            return CurrentUser(
                subject="warehouse",
                username="warehouse",
                roles=["WAREHOUSE"],
                permissions=[
                    "gate:read",
                    "gate:write",
                    "gate:approve",
                    "gate:verify",
                    "gate:entry:read",
                    "gate:entry:create",
                    "storage:read",
                    "storage:write",
                    "receiving:read",
                    "receiving:write",
                    "returns:read",
                    "returns:write",
                    "warehouse:read",
                    "warehouse:write",
                ],
                raw_claims={},
            )
        elif token == "mock-jwt-warehouse-token":
            return CurrentUser(
                subject="warehouse",
                username="warehouse",
                roles=["WAREHOUSE"],
                permissions=[
                    "gate:read",
                    "gate:write",
                    "gate:verify",
                    "gate:approve",
                    "receiving:read",
                ],
                raw_claims={},
            )
        elif token == "mock-jwt-gate-entry-token":
            return CurrentUser(
                subject="gate_security",
                username="gate_security",
                roles=["GATE_SECURITY"],
                permissions=["gate:read", "gate:write", "gate:verify", "receiving:read"],
                raw_claims={},
            )
        elif token == "mock-jwt-warehouse-operator-token":
            return CurrentUser(
                subject="EMP-KEEPER-001",
                username="warehouse_keeper_mech",
                roles=["WAREHOUSE_OPERATOR"],
                permissions=["warehouse:read", "storage:read", "putaway:execute", "pickup:execute"],
                raw_claims={"warehouse_code": "WH-001", "employee_id": "EMP-KEEPER-001"},
            )
        elif token == "mock-jwt-warehouse-operator-token":
            claims = {"warehouse_code": "WH-001", "employee_id": "EMP-WAREHOUSE_OPERATOR-001", "username": "warehouse_operator_elec"}
            try:
                from sqlalchemy import select, or_, func
                from sqlalchemy.orm import selectinload
                from app.database.session import AsyncSessionFactory
                from app.modules.warehouse.infrastructure.persistence.models import UserAccountModel

                async with AsyncSessionFactory() as session:
                    stmt = (
                        select(UserAccountModel)
                        .options(selectinload(UserAccountModel.warehouse))
                        .where(
                            or_(
                                UserAccountModel.employee_id == "EMP-WAREHOUSE_OPERATOR-001",
                                UserAccountModel.username == "warehouse_operator_elec",
                            )
                        )
                    )
                    res = await session.execute(stmt)
                    mgr = res.scalars().first()
                    if mgr:
                        claims["warehouse_ref_id"] = str(mgr.warehouse_ref_id)
                        claims["employee_id"] = mgr.employee_id
                        claims["full_name"] = mgr.full_name
                        if mgr.warehouse:
                            claims["warehouse_code"] = mgr.warehouse.warehouse_code
            except Exception:
                pass

            return CurrentUser(
                subject=claims.get("employee_id", "EMP-WAREHOUSE_OPERATOR-001"),
                username="warehouse_operator_elec",
                roles=["WAREHOUSE_OPERATOR"],
                permissions=["warehouse:read", "warehouse:write", "storage:read", "putaway:execute", "pickup:execute"],
                raw_claims=claims,
            )
        elif token.startswith("mock-jwt-warehouse-operator-") or token.startswith("mock-jwt-warehouse-operator-"):
            is_keeper = token.startswith("mock-jwt-warehouse-operator-")
            prefix = "mock-jwt-warehouse-operator-" if is_keeper else "mock-jwt-warehouse-operator-"
            mgr_key = token.removeprefix(prefix)
            claims = {"employee_id": mgr_key}
            role_name = "WAREHOUSE_OPERATOR" if is_keeper else "WAREHOUSE_OPERATOR"
            username = f"{role_name.lower()}_{mgr_key.lower()}"
            roles = [role_name]
            permissions = ["warehouse:read", "storage:read", "putaway:execute", "pickup:execute"]
            if not is_keeper:
                permissions.append("warehouse:write")

            try:
                from sqlalchemy import select, or_, func
                from sqlalchemy.orm import selectinload
                from app.database.session import AsyncSessionFactory
                from app.modules.warehouse.infrastructure.persistence.models import UserAccountModel

                async with AsyncSessionFactory() as session:
                    key_lower = mgr_key.strip().lower()
                    stmt = (
                        select(UserAccountModel)
                        .options(selectinload(UserAccountModel.warehouse))
                        .where(
                            or_(
                                func.lower(UserAccountModel.employee_id) == key_lower,
                                func.lower(UserAccountModel.username) == key_lower,
                                func.lower(UserAccountModel.full_name) == key_lower,
                                func.lower(UserAccountModel.email) == key_lower,
                                func.lower(UserAccountModel.username) == f"warehouse_operator_{key_lower}",
                                func.lower(UserAccountModel.username) == f"warehouse_keeper_{key_lower}",
                                func.lower(UserAccountModel.username) == f"warehouse_mgr_{key_lower}",
                            )
                        )
                        .order_by(UserAccountModel.created_at.desc())
                    )
                    res = await session.execute(stmt)
                    mgr = res.scalars().first()
                    if mgr:
                        username = mgr.username
                        claims["warehouse_ref_id"] = str(mgr.warehouse_ref_id)
                        claims["employee_id"] = mgr.employee_id
                        claims["full_name"] = mgr.full_name
                        if mgr.warehouse:
                            claims["warehouse_code"] = mgr.warehouse.warehouse_code
            except Exception as e:
                pass

            if "warehouse_code" not in claims:
                code_map = {"elec": "WH-001", "mech": "WH-001", "inst": "STR-003", "spare": "STR-004", "raw": "STR-005"}
                claims["warehouse_code"] = code_map.get(mgr_key.lower(), f"STR-{mgr_key.upper()}")

            return CurrentUser(
                subject=claims.get("employee_id", mgr_key),
                username=username,
                roles=roles,
                permissions=permissions,
                raw_claims=claims,
            )
        elif token in ("mock-jwt-assembly-token", "mock-jwt-assembly-manager-token"):
            return CurrentUser(
                subject="EMP-ASSEMBLY-001",
                username="assembly_manager",
                roles=["ASSEMBLY_MANAGER", "ASSEMBLY"],
                permissions=["material_request:create", "material_request:read", "assembly:read", "assembly:write"],
                raw_claims={"department": "Assembly", "employee_id": "EMP-ASSEMBLY-001"},
            )
        elif token in ("mock-jwt-dispatch-token", "mock-jwt-dispatch-manager-token"):
            return CurrentUser(
                subject="EMP-DISPATCH-001",
                username="dispatch_manager",
                roles=["DISPATCH", "DISPATCH_MANAGER", "WAREHOUSE"],
                permissions=["dispatch:read", "dispatch:write", "dispatch:execute", "gate:read"],
                raw_claims={"department": "Dispatch", "employee_id": "EMP-DISPATCH-001"},
            )

    try:
        claims = await decode_and_validate(token)
        user = CurrentUser(
            subject=claims.get("sub", ""),
            username=claims.get("username", claims.get("sub", "")),
            roles=claims.get("roles", []),
            permissions=claims.get("permissions", []),
            raw_claims=claims,
        )
        if roles_hdr and settings.environment.lower() == "test":
            roles = [r.strip() for r in roles_hdr.split(",") if r.strip()]
            user_name = request.headers.get("X-User-Name") or request.headers.get("x-user-name") or request.headers.get("X-User-Username") or request.headers.get("x-user-username") or user.username
            user_id = request.headers.get("X-User-Id") or request.headers.get("x-user-id") or request.headers.get("X-User-Subject") or request.headers.get("x-user-subject") or user.subject
            warehouse_code = request.headers.get("X-Warehouse-Code") or request.headers.get("x-warehouse-code") or request.headers.get("X-User-Warehouse-Code") or request.headers.get("x-user-warehouse-code")
            warehouse_ref_id = request.headers.get("X-Warehouse-Id") or request.headers.get("x-warehouse-id") or request.headers.get("X-User-Warehouse-Id") or request.headers.get("x-user-warehouse-id")
            emp_id = request.headers.get("X-Employee-Id") or request.headers.get("x-employee-id") or request.headers.get("X-User-Employee-Id") or request.headers.get("x-user-employee-id") or user.subject
            claims_override = dict(claims)
            if warehouse_code:
                claims_override["warehouse_code"] = warehouse_code
            if warehouse_ref_id:
                claims_override["warehouse_ref_id"] = warehouse_ref_id
            if emp_id:
                claims_override["employee_id"] = emp_id
            roles_upper = {r.upper() for r in roles}
            perms = list(user.permissions)
            if "WAREHOUSE" in roles_upper or "WAREHOUSE_MANAGER" in roles_upper:
                perms.extend(["gate:read", "gate:write", "gate:approve", "gate:verify", "gate:entry:read", "gate:entry:create", "storage:read", "storage:write", "receiving:read", "receiving:write", "returns:read", "returns:write", "warehouse:read", "warehouse:write"])
            if "GATE_SECURITY" in roles_upper:
                perms.extend(["gate:read", "gate:write", "gate:entry:read", "gate:entry:create", "gate:entry:verify"])
            if "WAREHOUSE_OPERATOR" in roles_upper:
                perms.extend(["warehouse:read", "warehouse:write", "storage:read", "putaway:execute", "pickup:execute"])
            if "WAREHOUSE_OPERATOR" in roles_upper:
                perms.extend(["warehouse:read", "storage:read", "putaway:execute", "pickup:execute"])
            if "ASSEMBLY" in roles_upper:
                perms.extend(["material_request:create", "material_request:read"])
            user = CurrentUser(
                subject=user_id,
                username=user_name,
                roles=roles,
                permissions=list(dict.fromkeys(perms)),
                raw_claims=claims_override,
            )
        return user
    except Exception as exc:
        if isinstance(exc, TokenValidationError):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid",
        ) from exc


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> CurrentUser:
    """Resolve the request user and expose it to request-scoped middleware."""
    user = await _resolve_current_user(request, credentials)
    request.state.audit_user = user
    return user


def require_permission(*permissions: str):
    async def _checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        user_roles = set(user.roles)
        if "ADMIN" in user_roles or "WAREHOUSE" in user_roles or "PROCUREMENT" in user_roles or "GRN" in user_roles or "DISPATCH" in user_roles or "DISPATCH_MANAGER" in user_roles:
            return user
        if "GATE_SECURITY" in user_roles and any(
            permission in {"gate:read", "gate:write", "gate:verify", "gate:entry:read", "gate:entry:create", "gate:entry:verify"}
            for permission in permissions
        ):
            return user
        if any(p in user.permissions for p in permissions):
            return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Missing required permission: {', '.join(permissions)}",
        )

    return _checker

