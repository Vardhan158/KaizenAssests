"""
Unit tests for Phase 3: Store Manager Accounts, Authentication, and Store-Scoped Access Control.
"""
from __future__ import annotations

import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, or_

from app.database.session import AsyncSessionFactory
from app.main import create_app
from app.modules.store.infrastructure.persistence.models import (
    StoreManagerUserModel,
    StoreModel,
    StoreZoneModel,
)


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def seeded_stores():
    """Ensure standard STR-001 and STR-002 stores and managers exist."""
    async with AsyncSessionFactory() as session:
        # STR-001
        res1 = await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-001"))
        s1 = res1.scalar_one_or_none()
        if not s1:
            s1 = StoreModel(
                id=uuid.uuid4(),
                store_code="STR-001",
                store_name="Electrical Store",
                status="ACTIVE",
            )
            session.add(s1)
            await session.flush()

        # STR-002
        res2 = await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-002"))
        s2 = res2.scalar_one_or_none()
        if not s2:
            s2 = StoreModel(
                id=uuid.uuid4(),
                store_code="STR-002",
                store_name="Mechanical Store",
                status="ACTIVE",
            )
            session.add(s2)
            await session.flush()

        # Ensure zone in STR-002
        z2_res = await session.execute(select(StoreZoneModel).where(StoreZoneModel.store_id == s2.id))
        z2 = z2_res.scalars().first()
        if not z2:
            z2 = StoreZoneModel(
                id=uuid.uuid4(),
                store_id=s2.id,
                zone_code="STR-002-Z01",
                zone_name="Heavy Machining Bay",
                status="ACTIVE",
            )
            session.add(z2)
            await session.flush()

        # Ensure Manager EMP-STORE-001 for STR-001
        mgr1_res = await session.execute(
            select(StoreManagerUserModel).where(StoreManagerUserModel.employee_id == "EMP-STORE-001")
        )
        mgr1 = mgr1_res.scalar_one_or_none()
        if not mgr1:
            import hashlib
            mgr1 = StoreManagerUserModel(
                id=uuid.uuid4(),
                store_id=s1.id,
                employee_id="EMP-STORE-001",
                username="store_manager_elec",
                full_name="John Doe (Electrical)",
                email="john.electrical@wms.local",
                password_hash=hashlib.sha256("password".encode()).hexdigest(),
                status="ACTIVE",
            )
            session.add(mgr1)
            await session.flush()
        else:
            import hashlib
            mgr1.username = "store_manager_elec"
            mgr1.password_hash = hashlib.sha256("password".encode()).hexdigest()
            mgr1.status = "ACTIVE"
            await session.flush()

        # Ensure Manager EMP-STORE-002 for STR-002
        mgr2_res = await session.execute(
            select(StoreManagerUserModel).where(StoreManagerUserModel.employee_id == "EMP-STORE-002")
        )
        mgr2 = mgr2_res.scalar_one_or_none()
        if not mgr2:
            import hashlib
            mgr2 = StoreManagerUserModel(
                id=uuid.uuid4(),
                store_id=s2.id,
                employee_id="EMP-STORE-002",
                username="store_manager_mech",
                full_name="Sarah Jenkins (Mechanical)",
                email="sarah.mechanical@wms.local",
                password_hash=hashlib.sha256("password".encode()).hexdigest(),
                status="ACTIVE",
            )
            session.add(mgr2)
            await session.flush()
        else:
            import hashlib
            mgr2.username = "store_manager_mech"
            mgr2.password_hash = hashlib.sha256("password".encode()).hexdigest()
            mgr2.status = "ACTIVE"
            await session.flush()

        await session.commit()
        return {"store1": s1, "store2": s2, "zone2": z2, "mgr1": mgr1, "mgr2": mgr2}


@pytest.mark.asyncio
async def test_store_manager_creation_authorization(client: AsyncClient, seeded_stores):
    """Warehouse/Admin can create a Store Manager; unauthorized user is rejected."""
    store1 = seeded_stores["store1"]
    new_emp_id = f"EMP-TEST-{uuid.uuid4().hex[:6].upper()}"
    new_uname = f"mgr_test_{uuid.uuid4().hex[:6]}"
    new_email = f"{new_uname}@wms.local"

    payload = {
        "full_name": "Test Manager",
        "employee_id": new_emp_id,
        "username": new_uname,
        "email": new_email,
        "password": "securepassword123",
        "store_id": str(store1.id),
        "status": "ACTIVE",
    }

    # 1. Warehouse user creates manager -> 201 Created
    headers_wh = {"Authorization": "Bearer mock-jwt-warehouse-token"}
    resp_create = await client.post("/api/v1/stores/managers", json=payload, headers=headers_wh)
    assert resp_create.status_code == 201, f"Expected 201, got {resp_create.status_code}: {resp_create.text}"
    created_data = resp_create.json()
    assert created_data["employee_id"] == new_emp_id
    assert created_data["username"] == new_uname
    assert created_data["store_id"] == str(store1.id)

    # 2. Store Manager attempts to create another manager -> 403 Forbidden
    headers_mgr = {"Authorization": "Bearer mock-jwt-store-manager-EMP-STORE-001"}
    resp_forbidden = await client.post(
        "/api/v1/stores/managers",
        json={
            "full_name": "Unauthorized Attempt",
            "employee_id": f"EMP-UNAUTH-{uuid.uuid4().hex[:4]}",
            "username": f"unauth_{uuid.uuid4().hex[:4]}",
            "email": f"unauth_{uuid.uuid4().hex[:4]}@wms.local",
            "password": "password",
            "store_id": str(store1.id),
        },
        headers=headers_mgr,
    )
    assert resp_forbidden.status_code == 403


@pytest.mark.asyncio
async def test_store_manager_login_flow(client: AsyncClient, seeded_stores):
    """Store Manager can log in with username, employee ID, and status checks."""
    store1 = seeded_stores["store1"]

    # 1. Login with username and password
    login_resp = await client.post(
        "/api/v1/procurement/auth/dev-login",
        json={"username": "store_manager_elec", "password": "password"},
    )
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    data = login_resp.json()
    assert "token" in data
    assert "STORE_MANAGER" in data["roles"]
    assert data["employee_id"] == "EMP-STORE-001"
    assert data["store_id"] == str(store1.id)

    # 2. Login with employee_id and password
    login_emp_resp = await client.post(
        "/api/v1/procurement/auth/dev-login",
        json={"username": "EMP-STORE-001", "password": "password"},
    )
    assert login_emp_resp.status_code == 200
    assert login_emp_resp.json()["token"] == data["token"]

    # 3. Invalid password -> 401 Unauthorized
    login_bad_pwd = await client.post(
        "/api/v1/procurement/auth/dev-login",
        json={"username": "store_manager_elec", "password": "wrong_password_999"},
    )
    assert login_bad_pwd.status_code == 401


@pytest.mark.asyncio
async def test_store_manager_inactive_status_rejection(client: AsyncClient, seeded_stores):
    """Inactive Store Manager login is rejected."""
    store1 = seeded_stores["store1"]
    inactive_emp_id = f"EMP-INACTIVE-{uuid.uuid4().hex[:4].upper()}"
    inactive_uname = f"inactive_{uuid.uuid4().hex[:4]}"

    # Create inactive manager
    headers_wh = {"Authorization": "Bearer mock-jwt-warehouse-token"}
    await client.post(
        "/api/v1/stores/managers",
        json={
            "full_name": "Inactive Manager",
            "employee_id": inactive_emp_id,
            "username": inactive_uname,
            "email": f"{inactive_uname}@wms.local",
            "password": "password",
            "store_id": str(store1.id),
            "status": "INACTIVE",
        },
        headers=headers_wh,
    )

    # Login should be rejected
    resp = await client.post(
        "/api/v1/procurement/auth/dev-login",
        json={"username": inactive_uname, "password": "password"},
    )
    assert resp.status_code == 401
    assert "inactive" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_store_manager_scoped_access_and_idor_protection(client: AsyncClient, seeded_stores):
    """Manager A accesses Store A & Zones A only; access to Store B or Zone B returns 403."""
    store1 = seeded_stores["store1"]
    store2 = seeded_stores["store2"]
    zone2 = seeded_stores["zone2"]

    headers_mgr1 = {"Authorization": "Bearer mock-jwt-store-manager-EMP-STORE-001"}

    # 1. GET /api/v1/stores/me returns Store 1
    resp_me = await client.get("/api/v1/stores/me", headers=headers_mgr1)
    assert resp_me.status_code == 200
    assert resp_me.json()["id"] == str(store1.id)
    assert resp_me.json()["store_code"] == "STR-001"

    # 2. Manager 1 accesses own Store 1 -> 200 OK
    resp_s1 = await client.get(f"/api/v1/stores/{store1.id}", headers=headers_mgr1)
    assert resp_s1.status_code == 200

    # 3. Manager 1 attempts to access Store 2 -> 403 Forbidden
    resp_s2 = await client.get(f"/api/v1/stores/{store2.id}", headers=headers_mgr1)
    assert resp_s2.status_code == 403

    # 4. Manager 1 attempts to list Store 2 zones -> 403 Forbidden
    resp_s2_zones = await client.get(f"/api/v1/stores/{store2.id}/zones", headers=headers_mgr1)
    assert resp_s2_zones.status_code == 403

    # 5. Manager 1 attempts to access direct Zone in Store 2 -> 403 Forbidden
    resp_z2 = await client.get(f"/api/v1/zones/{zone2.id}", headers=headers_mgr1)
    assert resp_z2.status_code == 403

    # 6. Manager 1 creates Zone in Store 1 -> 201 Created
    resp_z1_create = await client.post(
        f"/api/v1/stores/{store1.id}/zones",
        json={"zone_name": "Electrical Testing Rack"},
        headers=headers_mgr1,
    )
    assert resp_z1_create.status_code == 201

    # 7. Manager 1 attempts to create Zone in Store 2 -> 403 Forbidden
    resp_z2_create = await client.post(
        f"/api/v1/stores/{store2.id}/zones",
        json={"zone_name": "Unauthorized Zone"},
        headers=headers_mgr1,
    )
    assert resp_z2_create.status_code == 403


@pytest.mark.asyncio
async def test_warehouse_global_visibility_and_putaway_endpoints(client: AsyncClient, seeded_stores):
    """Warehouse user views all stores/zones/managers and putaway/inventory endpoints continue working."""
    headers_wh = {"Authorization": "Bearer mock-jwt-warehouse-token"}

    # 1. List all managers
    mgrs_resp = await client.get("/api/v1/stores/managers", headers=headers_wh)
    assert mgrs_resp.status_code == 200
    assert len(mgrs_resp.json()) >= 2

    # 2. Hierarchy view sees all stores
    hier_resp = await client.get("/api/v1/stores/hierarchy/all", headers=headers_wh)
    assert hier_resp.status_code == 200
    assert len(hier_resp.json()) >= 2

    # 3. Existing inventory locations endpoint works (200 OK)
    loc_resp = await client.get("/api/storage/putaway-tasks/inventory-locations", headers=headers_wh)
    assert loc_resp.status_code == 200

    # 4. Existing inventory transactions endpoint works (200 OK)
    tx_resp = await client.get("/api/gate-entries/inventory-transactions", headers=headers_wh)
    assert tx_resp.status_code == 200


@pytest.mark.asyncio
async def test_chemical_manager_login_and_role_resolution(client: AsyncClient, seeded_stores):
    """
    Verify that Chemical_manager logs in as STORE_MANAGER (never ADMIN) and lands on their assigned Store.
    """
    store1 = seeded_stores["store1"]

    # 1. Provision Chemical Store & Chemical_manager
    headers_wh = {"Authorization": "Bearer mock-jwt-warehouse-token"}
    create_store_resp = await client.post(
        "/api/v1/stores",
        json={"store_name": "Chemical Store", "description": "Chemicals and Hazmat"},
        headers=headers_wh,
    )
    assert create_store_resp.status_code == 201
    chem_store = create_store_resp.json()

    create_mgr_resp = await client.post(
        "/api/v1/stores/managers",
        json={
            "full_name": "Chemical_manager",
            "employee_id": f"EMP-CHEM-{uuid.uuid4().hex[:4].upper()}",
            "username": f"chem_user_{uuid.uuid4().hex[:4]}",
            "email": f"chem_{uuid.uuid4().hex[:4]}@wms.local",
            "password": "password",
            "store_id": chem_store["id"],
            "status": "ACTIVE",
        },
        headers=headers_wh,
    )
    assert create_mgr_resp.status_code == 201
    chem_mgr = create_mgr_resp.json()

    # 2. Login as "Chemical_manager" (using full_name / display name or username)
    login_resp = await client.post(
        "/api/v1/procurement/auth/dev-login",
        json={"username": "Chemical_manager", "password": "password"},
    )
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    login_data = login_resp.json()

    # CRITICAL: Role MUST be STORE_MANAGER, never ADMIN
    assert login_data["roles"] == ["STORE_MANAGER"]
    assert "ADMIN" not in login_data["roles"]
    assert login_data["employee_id"] == chem_mgr["employee_id"]
    assert login_data["store_id"] == chem_store["id"]
    assert login_data["token"].startswith("mock-jwt-store-manager-")

    # 3. Access My Store using issued token
    headers_chem = {"Authorization": f"Bearer {login_data['token']}"}
    my_store_resp = await client.get("/api/v1/stores/me", headers=headers_chem)
    assert my_store_resp.status_code == 200
    assert my_store_resp.json()["id"] == chem_store["id"]
    assert my_store_resp.json()["store_name"] == "Chemical Store"

    # 4. Cross-store access rejected: Chemical Manager attempts to access Store 1
    cross_resp = await client.get(f"/api/v1/stores/{store1.id}", headers=headers_chem)
    assert cross_resp.status_code == 403

    # 5. Warehouse login verification
    wh_login = await client.post(
        "/api/v1/procurement/auth/dev-login",
        json={"username": "warehouse", "password": "warehouse123"},
    )
    assert wh_login.status_code == 200
    assert wh_login.json()["roles"] == ["WAREHOUSE"]

