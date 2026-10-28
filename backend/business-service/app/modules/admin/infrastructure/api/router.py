from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import desc, func, or_, select

from app.common.persistence.models import AsnModel, FinishedGoodsRequestModel, SupplierModel, SupplierUserModel
from app.database.session import UnitOfWork, get_uow
from app.modules.assembly.infrastructure.persistence.models import AssemblyOrderModel, AssemblyUnitModel
from app.modules.gate.infrastructure.persistence.models import GateEntryModel
from app.modules.receiving.infrastructure.persistence.models import GrnModel
from app.modules.store.infrastructure.persistence.models import StoreManagerUserModel
from app.security.dependencies import CurrentUser, get_current_user
from app.modules.admin.infrastructure.persistence.models import SystemAuditLogModel

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

ADMIN_ROLES = {"ADMIN", "SUPERUSER", "SUPER_ADMIN"}
MANAGED_ROLES = [
    {"value": "SUPPLIER", "label": "Supplier"},
    {"value": "WAREHOUSE_MANAGER", "label": "Warehouse Manager"},
    {"value": "GATE_SECURITY", "label": "Gate Security"},
    {"value": "GRN", "label": "GRN / Receiving"},
    {"value": "ASSEMBLY_MANAGER", "label": "Assembly Manager"},
    {"value": "QUALITY", "label": "Quality Inspector"},
]
ROLE_VALUES = {item["value"] for item in MANAGED_ROLES}


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    roles = {role.strip().upper() for role in user.roles}
    if not roles.intersection(ADMIN_ROLES):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return user


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    full_name: str = Field(min_length=2, max_length=128)
    email: str = Field(min_length=3, max_length=128)
    password: str = Field(min_length=8, max_length=128)
    role: str
    shift_name: str | None = Field(default=None, max_length=64)
    assembly_unit_code: str | None = Field(default=None, max_length=64)
    page_permissions: dict[str, str] = Field(default_factory=dict)

    @field_validator("page_permissions")
    @classmethod
    def validate_page_permissions(cls, value: dict[str, str]) -> dict[str, str]:
        normalized = {str(key): str(access).upper() for key, access in value.items()}
        if any(access not in {"READ", "WRITE"} for access in normalized.values()):
            raise ValueError("Page access must be READ or WRITE")
        return normalized


class UserUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=64)
    full_name: str | None = Field(default=None, min_length=2, max_length=128)
    email: str | None = Field(default=None, min_length=3, max_length=128)
    role: str | None = None
    shift_name: str | None = Field(default=None, max_length=64)
    assembly_unit_code: str | None = Field(default=None, max_length=64)
    status: str | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    page_permissions: dict[str, str] | None = None


class AssemblyUnitCreate(BaseModel):
    unit_code: str = Field(min_length=2, max_length=64)
    unit_name: str = Field(min_length=2, max_length=128)
    description: str | None = Field(default=None, max_length=255)


def serialize_user(account: StoreManagerUserModel) -> dict:
    return {
        "id": str(account.id),
        "employee_id": account.employee_id,
        "username": account.username,
        "full_name": account.full_name,
        "email": account.email,
        "role": account.role.strip().upper().replace(" ", "_"),
        "shift_name": account.shift_name,
        "assembly_unit_code": account.assembly_unit_code,
        "status": account.status,
        "page_permissions": account.page_permissions or {},
        "last_login": account.last_login,
        "created_at": account.created_at,
    }


def is_current_account(account: StoreManagerUserModel, user: CurrentUser) -> bool:
    """Match every identity shape emitted by the supported auth providers."""
    stable_candidates = {
        user.subject.strip().lower(),
        str(user.raw_claims.get("employee_id", "")).strip().lower(),
    }
    account_ids = {str(account.id).lower(), account.employee_id.lower()}
    if (stable_candidates - {""}).intersection(account_ids):
        return True

    # When the provider supplied an employee ID, it is authoritative. Falling
    # back to username here can mistake an operational account named "admin"
    # for the configured development administrator.
    if str(user.raw_claims.get("employee_id", "")).strip():
        return False
    return user.username.strip().lower() == account.username.lower()


def generate_employee_id() -> str:
    """Generate a compact, database-safe employee identifier."""
    return f"EMP-{uuid.uuid4().hex[:12].upper()}"


@router.get("/overview")
async def overview(
    _: CurrentUser = Depends(require_admin),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    async def count(model, *conditions) -> int:
        result = await uow.session.execute(select(func.count()).select_from(model).where(*conditions))
        return int(result.scalar_one())

    accounts = (await uow.session.execute(
        select(StoreManagerUserModel).order_by(StoreManagerUserModel.role, StoreManagerUserModel.full_name)
    )).scalars().all()
    total_users = len(accounts)
    active_users = await count(StoreManagerUserModel, StoreManagerUserModel.status == "ACTIVE")
    operation_totals = {
        "gate_entries": await count(GateEntryModel),
        "grns": await count(GrnModel),
        "assembly_orders": await count(AssemblyOrderModel),
    }

    module_definitions = {
        "WAREHOUSE_MANAGER": ("Warehouse", "/inventory?tab=dashboard", "Inventory and store operations"),
        "GATE_SECURITY": ("Gate", "/gate-dashboard", "Vehicle entry, verification and exit"),
        "GRN": ("GRN / Receiving", "/grn?tab=dashboard", "Goods receipt and receiving reports"),
        "ASSEMBLY_MANAGER": ("Assembly", "/assembly-dashboard", "Production, quality and finished goods"),
        "QUALITY": ("Quality", "/assembly/quality", "Incoming and finished-goods quality"),
        "SUPPLIER": ("Suppliers", "/supplier-dashboard", "ASN and finished-goods dispatches"),
    }
    grouped_modules: dict[str, dict] = {}
    assembly_units = (await uow.session.execute(
        select(AssemblyUnitModel).order_by(AssemblyUnitModel.unit_code)
    )).scalars().all()
    if assembly_units:
        grouped_modules["Assembly"] = {
            "key": "ASSEMBLY_MANAGER",
            "name": "Assembly",
            "route": "/assembly-dashboard",
            "description": "Independent production units, quality and finished goods",
            "users": [],
            "assembly_units": [
                {
                    "code": unit.unit_code,
                    "name": unit.unit_name,
                    "route": f"/assembly-dashboard?assembly_unit={unit.unit_code}",
                    "status": unit.status,
                    "users": [],
                }
                for unit in assembly_units
            ],
        }
    for account in accounts:
        role = account.role.strip().upper().replace(" ", "_")
        if role in {"DISPATCH", "DISPATCH_MANAGER"}:
            continue
        if role == "ASSEMBLY_MANAGER" and not (account.assembly_unit_code or "").strip():
            continue
        title, route, description = module_definitions.get(
            role, (role.replace("_", " ").title(), "/admin/users", "Module users and access")
        )
        module = grouped_modules.setdefault(title, {
            "key": role,
            "name": title,
            "route": route,
            "description": description,
            "users": [],
            "assembly_units": [],
        })
        identities = [account.username.lower(), account.employee_id.lower()]
        work_items = 0
        if role == "ASSEMBLY_MANAGER":
            work_items = await count(
                AssemblyOrderModel,
                or_(
                    func.lower(AssemblyOrderModel.created_by).in_(identities),
                    func.lower(AssemblyOrderModel.assigned_operator).in_(identities),
                ),
            )
        elif role == "GATE_SECURITY":
            work_items = await count(
                GateEntryModel,
                or_(
                    func.lower(GateEntryModel.security_officer_id).in_(identities),
                    func.lower(GateEntryModel.verified_by_user_id).in_(identities),
                ),
            )
        elif role == "GRN":
            work_items = await count(
                GrnModel,
                or_(
                    func.lower(GrnModel.received_by).in_(identities),
                    func.lower(GrnModel.posted_by).in_(identities),
                ),
            )
        user_data = serialize_user(account)
        user_data["kpis"] = {
            "work_items": work_items,
            "pages": len(account.page_permissions or {}),
        }
        if role == "ASSEMBLY_MANAGER":
            unit_code = account.assembly_unit_code.strip().upper()
            unit = next((item for item in module["assembly_units"] if item["code"] == unit_code), None)
            if unit is None:
                unit = {
                    "code": unit_code,
                    "name": unit_code.replace("_", " ").title(),
                    "route": f"/assembly-dashboard?assembly_unit={unit_code}",
                    "users": [],
                }
                module["assembly_units"].append(unit)
            unit["users"].append(user_data)
        else:
            module["users"].append(user_data)

    return {
        "users": {"total": total_users, "active": active_users, "inactive": total_users - active_users},
        "operations": operation_totals,
        "modules": list(grouped_modules.values()),
    }


@router.get("/roles")
async def roles(_: CurrentUser = Depends(require_admin)) -> list[dict[str, str]]:
    return MANAGED_ROLES


@router.get("/assembly-units")
async def assembly_units(
    _: CurrentUser = Depends(require_admin),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    rows = (await uow.session.execute(
        select(AssemblyUnitModel).order_by(AssemblyUnitModel.unit_code)
    )).scalars().all()
    return [
        {
            "id": str(unit.id),
            "code": unit.unit_code,
            "name": unit.unit_name,
            "description": unit.description,
            "status": unit.status,
        }
        for unit in rows
    ]


@router.get("/audit-logs")
async def audit_logs(
    module: str | None = Query(default=None, max_length=64),
    actor: str | None = Query(default=None, max_length=128),
    action: str | None = Query(default=None, max_length=32),
    result: str | None = Query(default=None, max_length=32),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: CurrentUser = Depends(require_admin),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    conditions = []
    if module:
        conditions.append(func.upper(SystemAuditLogModel.module) == module.strip().upper())
    if actor:
        conditions.append(SystemAuditLogModel.actor_username.ilike(f"%{actor.strip()}%"))
    if action:
        conditions.append(func.upper(SystemAuditLogModel.action) == action.strip().upper())
    if result:
        conditions.append(func.upper(SystemAuditLogModel.result) == result.strip().upper())
    total = int((await uow.session.execute(
        select(func.count()).select_from(SystemAuditLogModel).where(*conditions)
    )).scalar_one())
    rows = (await uow.session.execute(
        select(SystemAuditLogModel)
        .where(*conditions)
        .order_by(desc(SystemAuditLogModel.occurred_at))
        .limit(limit)
        .offset(offset)
    )).scalars().all()
    return {
        "total": total,
        "items": [
            {
                "id": str(row.id),
                "actor_username": row.actor_username,
                "actor_employee_id": row.actor_employee_id,
                "actor_roles": row.actor_roles,
                "module": row.module,
                "action": row.action,
                "request_path": row.request_path,
                "target_reference": row.target_reference,
                "status_code": row.status_code,
                "result": row.result,
                "request_id": row.request_id,
                "ip_address": row.ip_address,
                "occurred_at": row.occurred_at,
            }
            for row in rows
        ],
    }


@router.post("/assembly-units", status_code=status.HTTP_201_CREATED)
async def create_assembly_unit(
    payload: AssemblyUnitCreate,
    _: CurrentUser = Depends(require_admin),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    code = payload.unit_code.strip().upper().replace(" ", "-")
    duplicate = await uow.session.execute(
        select(AssemblyUnitModel.id).where(func.upper(AssemblyUnitModel.unit_code) == code)
    )
    if duplicate.first():
        raise HTTPException(status_code=409, detail="Assembly unit code already exists")
    unit = AssemblyUnitModel(
        unit_code=code,
        unit_name=payload.unit_name.strip(),
        description=(payload.description or "").strip() or None,
        status="ACTIVE",
    )
    uow.session.add(unit)
    await uow.commit()
    return {"id": str(unit.id), "code": unit.unit_code, "name": unit.unit_name, "description": unit.description, "status": unit.status}


@router.get("/suppliers")
async def suppliers(
    _: CurrentUser = Depends(require_admin),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    supplier_rows = (await uow.session.execute(
        select(SupplierModel).order_by(SupplierModel.supplier_name)
    )).scalars().all()
    asn_counts = dict((await uow.session.execute(
        select(AsnModel.supplier_id, func.count(AsnModel.id))
        .where(AsnModel.supplier_id.is_not(None))
        .group_by(AsnModel.supplier_id)
    )).all())
    dispatch_counts = dict((await uow.session.execute(
        select(FinishedGoodsRequestModel.supplier_id, func.count(FinishedGoodsRequestModel.id))
        .where(FinishedGoodsRequestModel.supplier_id.is_not(None))
        .group_by(FinishedGoodsRequestModel.supplier_id)
    )).all())
    usernames = dict((await uow.session.execute(
        select(SupplierUserModel.supplier_id, SupplierUserModel.username)
    )).all())

    return [
        {
            "id": str(supplier.id),
            "supplier_code": supplier.supplier_code,
            "supplier_name": supplier.supplier_name,
            "registered_company_name": supplier.registered_company_name,
            "username": usernames.get(supplier.id),
            "vendor_type": supplier.vendor_type,
            "industry": supplier.industry,
            "category": supplier.category or [],
            "main_materials": supplier.main_materials or [],
            "gstin": supplier.gstin,
            "status": supplier.status,
            "rating": float(supplier.rating or 0),
            "performance_score": float(supplier.performance_score or 0),
            "asn_count": int(asn_counts.get(supplier.id, 0)),
            "dispatch_count": int(dispatch_counts.get(str(supplier.id), 0)),
            "created_at": supplier.created_at,
        }
        for supplier in supplier_rows
    ]


@router.get("/users")
async def users(
    _: CurrentUser = Depends(require_admin),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    result = await uow.session.execute(
        select(StoreManagerUserModel).order_by(StoreManagerUserModel.created_at.desc())
    )
    return [serialize_user(account) for account in result.scalars().all()]


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    _: CurrentUser = Depends(require_admin),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    role = payload.role.strip().upper().replace(" ", "_")
    if role not in ROLE_VALUES:
        raise HTTPException(status_code=422, detail="Unsupported role")
    if role == "ASSEMBLY_MANAGER" and not (payload.assembly_unit_code or "").strip():
        raise HTTPException(status_code=422, detail="Assembly unit code is required for Assembly Managers")
    if role == "ASSEMBLY_MANAGER":
        unit = (await uow.session.execute(
            select(AssemblyUnitModel.id).where(
                func.upper(AssemblyUnitModel.unit_code) == payload.assembly_unit_code.strip().upper()
            )
        )).first()
        if not unit:
            raise HTTPException(status_code=422, detail="Selected Assembly Unit does not exist")

    duplicate = await uow.session.execute(
        select(StoreManagerUserModel.id).where(
            or_(
                func.lower(StoreManagerUserModel.username) == payload.username.strip().lower(),
                func.lower(StoreManagerUserModel.email) == payload.email.strip().lower(),
            )
        )
    )
    if duplicate.first():
        raise HTTPException(status_code=409, detail="Username or email already exists")

    account = StoreManagerUserModel(
        employee_id=generate_employee_id(),
        username=payload.username.strip(),
        full_name=payload.full_name.strip(),
        email=payload.email.strip().lower(),
        password_hash=hashlib.sha256(payload.password.encode()).hexdigest(),
        role=role,
        shift_name=(payload.shift_name or "").strip() or None,
        assembly_unit_code=(payload.assembly_unit_code or "").strip().upper() or None,
        applications=["WMS"],
        page_permissions=payload.page_permissions,
        status="ACTIVE",
    )
    uow.session.add(account)
    if role == "SUPPLIER":
        supplier_id = uuid.uuid4()
        supplier = SupplierModel(
            id=supplier_id,
            supplier_name=payload.full_name.strip(),
            registered_company_name=f"{payload.full_name.strip()} ({account.employee_id})",
            vendor_type="MANUFACTURER",
            category=[],
            industry="GENERAL",
            gstin=f"AUTO-{uuid.uuid4().hex[:12].upper()}",
            supplier_code=f"SUP-{account.employee_id.removeprefix('EMP-')}",
            status="Active",
        )
        uow.session.add(supplier)
        uow.session.add(
            SupplierUserModel(
                supplier_id=supplier_id,
                username=account.username,
                password_hash=account.password_hash,
                must_change_password=False,
            )
        )
    await uow.commit()
    return serialize_user(account)


@router.patch("/users/{user_id}")
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    current_user: CurrentUser = Depends(require_admin),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    account = await uow.session.get(StoreManagerUserModel, user_id)
    if not account:
        raise HTTPException(status_code=404, detail="User not found")
    current_account = is_current_account(account, current_user)
    supplier_user = (await uow.session.execute(
        select(SupplierUserModel).where(
            func.lower(SupplierUserModel.username) == account.username.lower()
        )
    )).scalars().first()
    if payload.username is not None or payload.email is not None:
        username = (payload.username or account.username).strip()
        email = (payload.email or account.email).strip().lower()
        duplicate = await uow.session.execute(
            select(StoreManagerUserModel.id).where(
                StoreManagerUserModel.id != account.id,
                or_(
                    func.lower(StoreManagerUserModel.username) == username.lower(),
                    func.lower(StoreManagerUserModel.email) == email,
                ),
            )
        )
        if duplicate.first():
            raise HTTPException(status_code=409, detail="Username or email already exists")
        account.username = username
        account.email = email
        if supplier_user is not None:
            supplier_user.username = username
    if payload.full_name is not None:
        account.full_name = payload.full_name.strip()
    if payload.role is not None:
        role = payload.role.strip().upper().replace(" ", "_")
        if role not in ROLE_VALUES:
            raise HTTPException(status_code=422, detail="Unsupported role")
        if current_account and role not in ADMIN_ROLES:
            raise HTTPException(status_code=422, detail="You cannot remove your own administrator access")
        account.role = role
    if payload.shift_name is not None:
        account.shift_name = payload.shift_name.strip() or None
    if payload.assembly_unit_code is not None:
        account.assembly_unit_code = payload.assembly_unit_code.strip().upper() or None
    if account.role.strip().upper().replace(" ", "_") == "ASSEMBLY_MANAGER" and not account.assembly_unit_code:
        raise HTTPException(status_code=422, detail="Assembly unit code is required for Assembly Managers")
    if account.role.strip().upper().replace(" ", "_") == "ASSEMBLY_MANAGER":
        unit = (await uow.session.execute(
            select(AssemblyUnitModel.id).where(
                func.upper(AssemblyUnitModel.unit_code) == account.assembly_unit_code.upper()
            )
        )).first()
        if not unit:
            raise HTTPException(status_code=422, detail="Selected Assembly Unit does not exist")
    if payload.status is not None:
        next_status = payload.status.strip().upper()
        if next_status not in {"ACTIVE", "INACTIVE"}:
            raise HTTPException(status_code=422, detail="Status must be ACTIVE or INACTIVE")
        if current_account and next_status == "INACTIVE":
            raise HTTPException(status_code=422, detail="You cannot deactivate your own account")
        account.status = next_status
    if payload.password is not None:
        account.password_hash = hashlib.sha256(payload.password.encode()).hexdigest()
        account.auth_token_hash = None
        if supplier_user is not None:
            supplier_user.password_hash = account.password_hash
    if payload.page_permissions is not None:
        normalized = {str(key): str(access).upper() for key, access in payload.page_permissions.items()}
        if any(access not in {"READ", "WRITE"} for access in normalized.values()):
            raise HTTPException(status_code=422, detail="Page access must be READ or WRITE")
        account.page_permissions = normalized
    account.updated_at = datetime.now(account.updated_at.tzinfo or timezone.utc) if account.updated_at else datetime.now(timezone.utc)
    await uow.commit()
    return serialize_user(account)
