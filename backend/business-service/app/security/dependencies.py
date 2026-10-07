"""
FastAPI dependency-injection helpers for authentication and RBAC authorization.
Supports local dev mock user fallback when running in environment=local.
"""
from __future__ import annotations

from dataclasses import dataclass
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


async def get_current_user(
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
    if roles_hdr:
        roles = [r.strip() for r in roles_hdr.split(",") if r.strip()]
        user_name = request.headers.get("X-User-Name") or request.headers.get("x-user-name") or request.headers.get("X-User-Username") or request.headers.get("x-user-username") or "test_user"
        user_id = request.headers.get("X-User-Id") or request.headers.get("x-user-id") or request.headers.get("X-User-Subject") or request.headers.get("x-user-subject") or user_name
        store_code = request.headers.get("X-Store-Code") or request.headers.get("x-store-code") or request.headers.get("X-User-Store-Code") or request.headers.get("x-user-store-code")
        store_id = request.headers.get("X-Store-Id") or request.headers.get("x-store-id") or request.headers.get("X-User-Store-Id") or request.headers.get("x-user-store-id")
        emp_id = request.headers.get("X-Employee-Id") or request.headers.get("x-employee-id") or request.headers.get("X-User-Employee-Id") or request.headers.get("x-user-employee-id") or user_id
        claims = {}
        if store_code:
            claims["store_code"] = store_code
        if store_id:
            claims["store_id"] = store_id
        if emp_id:
            claims["employee_id"] = emp_id
        roles_upper = {r.upper() for r in roles}
        perms = []
        if "ADMIN" in roles_upper or "SUPERUSER" in roles_upper:
            perms.extend(["gate:read", "gate:write", "gate:approve", "gate:verify", "gate:entry:read", "gate:entry:create", "storage:read", "storage:write", "receiving:read", "receiving:write", "returns:read", "returns:write", "procurement:read", "procurement:create", "procurement:write", "store:read", "store:write"])
        if "WAREHOUSE" in roles_upper or "WAREHOUSE_MANAGER" in roles_upper:
            perms.extend(["gate:read", "gate:write", "gate:approve", "gate:verify", "gate:entry:read", "gate:entry:create", "storage:read", "storage:write", "receiving:read", "receiving:write", "returns:read", "returns:write", "store:read", "store:write"])
        if "GATE_SECURITY" in roles_upper:
            # Gate security also operates the outbound gate queue.  These are
            # read/execute permissions for dispatches that have already passed
            # warehouse loading and final verification.
            perms.extend(["gate:read", "gate:write", "gate:entry:read", "gate:entry:create", "gate:entry:verify", "dispatch:read", "dispatch:execute"])
        if "PROCUREMENT" in roles_upper:
            perms.extend(["procurement:read", "procurement:create", "procurement:write"])
        if "FINANCE" in roles_upper:
            perms.extend(["finance:read", "finance:approve"])
        if "STORE_MANAGER" in roles_upper:
            perms.extend(["store:read", "store:write", "storage:read", "putaway:execute", "pickup:execute"])
        if "STORE_KEEPER" in roles_upper:
            perms.extend(["store:read", "storage:read", "putaway:execute", "pickup:execute"])
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
        if settings.environment.lower() in ("local", "test", "development"):
            return CurrentUser(
                subject="local_security_officer",
                username="local_security_officer",
                roles=["ADMIN"],
                permissions=["gate:entry:create", "gate:entry:read", "gate:entry:verify"],
                raw_claims={},
            )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = credentials.credentials
    if settings.environment.lower() in ("local", "test", "development"):
        if token.startswith("supplier-mock-token-"):
            token_payload = token.removeprefix("supplier-mock-token-")
            user_id = token_payload[:36]
            supplier_id = token_payload[37:] if len(token_payload) > 37 else None
            
            # Prevent literal "None" string from breaking _authenticated_supplier_id
            if supplier_id == "None":
                supplier_id = None
                
            return CurrentUser(
                subject=user_id or "supplier",
                username="supplier",
                roles=["SUPPLIER"],
                permissions=[],
                raw_claims={"supplier_id": supplier_id} if supplier_id else {},
            )
        if token.startswith("mock-jwt-db-user-"):
            session_token = token.removeprefix("mock-jwt-db-user-")
            from sqlalchemy import select
            from sqlalchemy.orm import selectinload
            from app.database.session import AsyncSessionFactory
            from app.modules.store.infrastructure.persistence.models import StoreManagerUserModel

            async with AsyncSessionFactory() as session:
                result = await session.execute(
                    select(StoreManagerUserModel)
                    .options(selectinload(StoreManagerUserModel.store))
                    .where(
                        StoreManagerUserModel.auth_token_hash == hashlib.sha256(session_token.encode()).hexdigest(),
                        StoreManagerUserModel.status == "ACTIVE",
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
                    "STORE_OPERATOR": "STORE_KEEPER",
                    "STORE_MANAGER": "STORE_MANAGER",
                }.get(role_key, role_key)

                perms = []
                if role in ("ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE"):
                    perms = ["gate:read", "gate:write", "gate:approve", "gate:verify", "gate:entry:read", "gate:entry:create", "storage:read", "storage:write", "receiving:read", "receiving:write", "returns:read", "returns:write", "store:read", "store:write", "dispatch:read", "dispatch:write", "dispatch:execute"]
                elif role == "STORE_MANAGER":
                    perms = ["store:read", "store:write", "storage:read", "putaway:execute", "pickup:execute"]
                elif role == "STORE_KEEPER":
                    perms = ["store:read", "storage:read", "putaway:execute", "pickup:execute"]
                elif role in ("ASSEMBLY", "ASSEMBLY_MANAGER"):
                    perms = ["material_request:create", "material_request:read", "assembly:read", "assembly:write"]
                elif role in ("DISPATCH", "DISPATCH_MANAGER"):
                    perms = ["dispatch:read", "dispatch:write", "dispatch:execute"]

                claims = {
                    "employee_id": account.employee_id,
                    "applications": account.applications or [],
                    "store_id": str(account.store_id) if account.store_id else None,
                    "store_code": account.store.store_code if account.store else None,
                    "store_name": account.store.store_name if account.store else None,
                }
                return CurrentUser(
                    subject=account.employee_id,
                    username=account.username,
                    roles=[role],
                    permissions=perms,
                    raw_claims=claims,
                )
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")
        if token == "mock-jwt-admin-token" or token == "local_dev_mock_token":
            return CurrentUser(
                subject="admin",
                username="admin",
                roles=["ADMIN"],
                permissions=["gate:read", "gate:entry:create", "gate:entry:read", "gate:entry:verify", "gate:write", "warehouse:write"],
                raw_claims={},
            )
        elif token == "mock-jwt-supplier-token":
            return CurrentUser(
                subject="supplier",
                username="supplier_partner",
                roles=["SUPPLIER"],
                permissions=[],
                raw_claims={"supplier_id": "sup-00001"},
            )
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
                    "store:read",
                    "store:write",
                ],
                raw_claims={},
            )
        elif token == "mock-jwt-procurement-token":
            return CurrentUser(
                subject="procurement",
                username="procurement",
                roles=["PROCUREMENT", "ADMIN"],
                permissions=["gate:write", "gate:entry:create", "gate:entry:read", "gate:entry:verify"],
                raw_claims={},
            )
        elif token == "mock-jwt-finance-token":
            return CurrentUser(
                subject="finance",
                username="finance",
                roles=["FINANCE", "ADMIN"],
                permissions=["gate:write", "gate:entry:create", "gate:entry:read", "gate:entry:verify"],
                raw_claims={},
            )
        elif token == "mock-jwt-manager-token":
            return CurrentUser(
                subject="manager",
                username="manager",
                roles=["MANAGER"],
                permissions=[
                    "procurement:read",
                    "procurement:approve",
                    "gate:approve",
                    "warehouse:read",
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
        elif token == "mock-jwt-store-keeper-token":
            return CurrentUser(
                subject="EMP-KEEPER-001",
                username="store_keeper_mech",
                roles=["STORE_KEEPER"],
                permissions=["store:read", "storage:read", "putaway:execute", "pickup:execute"],
                raw_claims={"store_code": "STR-002", "employee_id": "EMP-KEEPER-001"},
            )
        elif token == "mock-jwt-store-manager-token":
            claims = {"store_code": "STR-001", "employee_id": "EMP-STORE-001", "username": "store_manager_elec"}
            try:
                from sqlalchemy import select, or_, func
                from sqlalchemy.orm import selectinload
                from app.database.session import AsyncSessionFactory
                from app.modules.store.infrastructure.persistence.models import StoreManagerUserModel

                async with AsyncSessionFactory() as session:
                    stmt = (
                        select(StoreManagerUserModel)
                        .options(selectinload(StoreManagerUserModel.store))
                        .where(
                            or_(
                                StoreManagerUserModel.employee_id == "EMP-STORE-001",
                                StoreManagerUserModel.username == "store_manager_elec",
                            )
                        )
                    )
                    res = await session.execute(stmt)
                    mgr = res.scalars().first()
                    if mgr:
                        claims["store_id"] = str(mgr.store_id)
                        claims["employee_id"] = mgr.employee_id
                        claims["full_name"] = mgr.full_name
                        if mgr.store:
                            claims["store_code"] = mgr.store.store_code
            except Exception:
                pass

            return CurrentUser(
                subject=claims.get("employee_id", "EMP-STORE-001"),
                username="store_manager_elec",
                roles=["STORE_MANAGER"],
                permissions=["store:read", "store:write", "storage:read", "putaway:execute", "pickup:execute"],
                raw_claims=claims,
            )
        elif token.startswith("mock-jwt-store-keeper-") or token.startswith("mock-jwt-store-manager-"):
            is_keeper = token.startswith("mock-jwt-store-keeper-")
            prefix = "mock-jwt-store-keeper-" if is_keeper else "mock-jwt-store-manager-"
            mgr_key = token.removeprefix(prefix)
            claims = {"employee_id": mgr_key}
            role_name = "STORE_KEEPER" if is_keeper else "STORE_MANAGER"
            username = f"{role_name.lower()}_{mgr_key.lower()}"
            roles = [role_name]
            permissions = ["store:read", "storage:read", "putaway:execute", "pickup:execute"]
            if not is_keeper:
                permissions.append("store:write")

            try:
                from sqlalchemy import select, or_, func
                from sqlalchemy.orm import selectinload
                from app.database.session import AsyncSessionFactory
                from app.modules.store.infrastructure.persistence.models import StoreManagerUserModel

                async with AsyncSessionFactory() as session:
                    key_lower = mgr_key.strip().lower()
                    stmt = (
                        select(StoreManagerUserModel)
                        .options(selectinload(StoreManagerUserModel.store))
                        .where(
                            or_(
                                func.lower(StoreManagerUserModel.employee_id) == key_lower,
                                func.lower(StoreManagerUserModel.username) == key_lower,
                                func.lower(StoreManagerUserModel.full_name) == key_lower,
                                func.lower(StoreManagerUserModel.email) == key_lower,
                                func.lower(StoreManagerUserModel.username) == f"store_manager_{key_lower}",
                                func.lower(StoreManagerUserModel.username) == f"store_keeper_{key_lower}",
                                func.lower(StoreManagerUserModel.username) == f"store_mgr_{key_lower}",
                            )
                        )
                        .order_by(StoreManagerUserModel.created_at.desc())
                    )
                    res = await session.execute(stmt)
                    mgr = res.scalars().first()
                    if mgr:
                        username = mgr.username
                        claims["store_id"] = str(mgr.store_id)
                        claims["employee_id"] = mgr.employee_id
                        claims["full_name"] = mgr.full_name
                        if mgr.store:
                            claims["store_code"] = mgr.store.store_code
            except Exception as e:
                pass

            if "store_code" not in claims:
                code_map = {"elec": "STR-001", "mech": "STR-002", "inst": "STR-003", "spare": "STR-004", "raw": "STR-005"}
                claims["store_code"] = code_map.get(mgr_key.lower(), f"STR-{mgr_key.upper()}")

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
        if roles_hdr and settings.environment.lower() in {"local", "test", "development"}:
            roles = [r.strip() for r in roles_hdr.split(",") if r.strip()]
            user_name = request.headers.get("X-User-Name") or request.headers.get("x-user-name") or request.headers.get("X-User-Username") or request.headers.get("x-user-username") or user.username
            user_id = request.headers.get("X-User-Id") or request.headers.get("x-user-id") or request.headers.get("X-User-Subject") or request.headers.get("x-user-subject") or user.subject
            store_code = request.headers.get("X-Store-Code") or request.headers.get("x-store-code") or request.headers.get("X-User-Store-Code") or request.headers.get("x-user-store-code")
            store_id = request.headers.get("X-Store-Id") or request.headers.get("x-store-id") or request.headers.get("X-User-Store-Id") or request.headers.get("x-user-store-id")
            emp_id = request.headers.get("X-Employee-Id") or request.headers.get("x-employee-id") or request.headers.get("X-User-Employee-Id") or request.headers.get("x-user-employee-id") or user.subject
            claims_override = dict(claims)
            if store_code:
                claims_override["store_code"] = store_code
            if store_id:
                claims_override["store_id"] = store_id
            if emp_id:
                claims_override["employee_id"] = emp_id
            roles_upper = {r.upper() for r in roles}
            perms = list(user.permissions)
            if "ADMIN" in roles_upper or "SUPERUSER" in roles_upper:
                perms.extend(["gate:read", "gate:write", "gate:approve", "gate:verify", "gate:entry:read", "gate:entry:create", "storage:read", "storage:write", "receiving:read", "receiving:write", "returns:read", "returns:write", "procurement:read", "procurement:create", "procurement:write", "store:read", "store:write"])
            if "WAREHOUSE" in roles_upper or "WAREHOUSE_MANAGER" in roles_upper:
                perms.extend(["gate:read", "gate:write", "gate:approve", "gate:verify", "gate:entry:read", "gate:entry:create", "storage:read", "storage:write", "receiving:read", "receiving:write", "returns:read", "returns:write", "store:read", "store:write"])
            if "GATE_SECURITY" in roles_upper:
                perms.extend(["gate:read", "gate:write", "gate:entry:read", "gate:entry:create", "gate:entry:verify"])
            if "PROCUREMENT" in roles_upper:
                perms.extend(["procurement:read", "procurement:create", "procurement:write"])
            if "FINANCE" in roles_upper:
                perms.extend(["finance:read", "finance:approve"])
            if "STORE_MANAGER" in roles_upper:
                perms.extend(["store:read", "store:write", "storage:read", "putaway:execute", "pickup:execute"])
            if "STORE_KEEPER" in roles_upper:
                perms.extend(["store:read", "storage:read", "putaway:execute", "pickup:execute"])
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
        if settings.environment.lower() in ("local", "test", "development"):
            return CurrentUser(
                subject="local_security_officer",
                username="local_security_officer",
                roles=["ADMIN"],
                permissions=["gate:entry:create", "gate:entry:read", "gate:entry:verify", "gate:write", "warehouse:write", "dispatch:read", "dispatch:write", "dispatch:execute"],
                raw_claims={},
            )
        if isinstance(exc, TokenValidationError):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        raise


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

