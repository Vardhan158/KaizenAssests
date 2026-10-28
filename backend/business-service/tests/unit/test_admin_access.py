from types import SimpleNamespace
import uuid

import pytest
from fastapi import HTTPException

from app.modules.admin.infrastructure.api.router import (
    MANAGED_ROLES,
    generate_employee_id,
    is_current_account,
    require_admin,
)
from app.security.dependencies import CurrentUser


def make_user(*, subject: str = "user-id", username: str = "person", roles: list[str] | None = None, employee_id: str = "") -> CurrentUser:
    return CurrentUser(
        subject=subject,
        username=username,
        roles=roles or [],
        permissions=[],
        raw_claims={"employee_id": employee_id} if employee_id else {},
    )


def test_require_admin_accepts_supported_roles_case_insensitively() -> None:
    user = make_user(roles=["super_admin"])

    assert require_admin(user) is user


def test_require_admin_rejects_non_admin() -> None:
    with pytest.raises(HTTPException) as exc_info:
        require_admin(make_user(roles=["WAREHOUSE_MANAGER"]))

    assert exc_info.value.status_code == 403


def test_managed_roles_are_limited_to_operational_accounts() -> None:
    assert MANAGED_ROLES == [
        {"value": "SUPPLIER", "label": "Supplier"},
        {"value": "WAREHOUSE_MANAGER", "label": "Warehouse Manager"},
        {"value": "GATE_SECURITY", "label": "Gate Security"},
        {"value": "GRN", "label": "GRN / Receiving"},
        {"value": "ASSEMBLY_MANAGER", "label": "Assembly Manager"},
    ]


def test_generate_employee_id_uses_stable_unique_format() -> None:
    first = generate_employee_id()
    second = generate_employee_id()

    assert first.startswith("EMP-")
    assert len(first) == 16
    assert first[4:].isalnum()
    assert first == first.upper()
    assert first != second


@pytest.mark.parametrize("identity_source", ["id", "subject_employee", "username", "claim"])
def test_is_current_account_supports_auth_identity_shapes(identity_source: str) -> None:
    account_id = uuid.uuid4()
    account = SimpleNamespace(id=account_id, employee_id="EMP-42", username="Admin.User")
    kwargs = {"subject": "someone-else", "username": "someone-else"}
    if identity_source == "id":
        kwargs["subject"] = str(account_id)
    elif identity_source == "subject_employee":
        kwargs["subject"] = "emp-42"
    elif identity_source == "username":
        kwargs["username"] = "ADMIN.USER"
    else:
        kwargs["employee_id"] = "emp-42"

    assert is_current_account(account, make_user(**kwargs))


def test_is_current_account_rejects_another_user() -> None:
    account = SimpleNamespace(id=uuid.uuid4(), employee_id="EMP-42", username="admin.user")

    assert not is_current_account(account, make_user(subject="different", username="other"))


def test_is_current_account_does_not_confuse_matching_username_with_different_employee() -> None:
    account = SimpleNamespace(id=uuid.uuid4(), employee_id="EMP-42", username="admin")

    assert not is_current_account(
        account,
        make_user(subject="ADMIN", username="admin", employee_id="ADMIN"),
    )
