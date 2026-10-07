import datetime
import hashlib
import uuid
from decimal import Decimal
import pytest
from fastapi import HTTPException
from httpx import AsyncClient, ASGITransport
from starlette.requests import Request
from fastapi.security import HTTPAuthorizationCredentials
from app.main import app
from app.config.settings import get_settings
from app.database.session import session_scope
from app.security.dependencies import get_current_user
from app.modules.procurement.infrastructure.persistence.models import MaterialModel, MaterialStockModel
from app.modules.receiving.infrastructure.persistence.models import GrnModel
from app.modules.storage.infrastructure.persistence.models import PutawayTaskModel
from app.modules.store.infrastructure.persistence.models import StoreModel, StoreZoneModel, StoreManagerUserModel


@pytest.mark.asyncio
async def test_dev_login_case_insensitivity_and_auth_rules():
    settings = get_settings()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Warehouse login with lowercase
        wh_res = await client.post(
            "/api/v1/procurement/auth/dev-login",
            json={"username": settings.warehouse_username.lower(), "password": settings.warehouse_password},
        )
        assert wh_res.status_code == 200, wh_res.text
        assert "WAREHOUSE" in wh_res.json()["roles"]

        # 2. Warehouse login with uppercase
        wh_caps = await client.post(
            "/api/v1/procurement/auth/dev-login",
            json={"username": settings.warehouse_username.upper(), "password": settings.warehouse_password},
        )
        assert wh_caps.status_code == 200, wh_caps.text
        assert "WAREHOUSE" in wh_caps.json()["roles"]

        # 3. Invalid password must return 401
        inv_res = await client.post(
            "/api/v1/procurement/auth/dev-login",
            json={"username": settings.warehouse_username, "password": "definitely_wrong_password"},
        )
        assert inv_res.status_code == 401
        assert "Invalid username or password" in inv_res.json()["detail"]


@pytest.mark.asyncio
async def test_dev_login_is_disabled_outside_authorized_environments(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "production")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            "/api/v1/procurement/auth/dev-login",
            json={"username": settings.manager_username, "password": settings.manager_password},
        )

    assert res.status_code == 403
    assert "Development login is disabled" in res.json()["detail"]


@pytest.mark.asyncio
async def test_invalid_bearer_does_not_trust_x_user_roles_in_prod(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "production")

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [
                ("x-user-roles", "ADMIN"),
                ("x-user-name", "override-user"),
            ],
        }
    )
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="bad-token")

    with pytest.raises(HTTPException) as exc:
        await get_current_user(request, credentials)

    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_handling_unit_lookup_and_putaway_zone_uuid_completion():
    test_uid = uuid.uuid4().hex[:6].upper()
    store_id = uuid.uuid4()
    other_store_id = uuid.uuid4()
    zone_id = uuid.uuid4()
    grn_id = uuid.uuid4()
    task_id = uuid.uuid4()
    mat_code = f"MAT-TEST-{test_uid}"
    emp_id = f"EMP-{test_uid}"

    async with session_scope() as session:
        # 1. Stores
        store = StoreModel(
            id=store_id,
            store_code=f"STR-{test_uid}",
            store_name=f"Store {test_uid}",
            warehouse_id="WH-001",
            status="ACTIVE",
        )
        session.add(store)

        other_store = StoreModel(
            id=other_store_id,
            store_code=f"STR-OTH-{test_uid}",
            store_name=f"Other Store {test_uid}",
            warehouse_id="WH-001",
            status="ACTIVE",
        )
        session.add(other_store)
        await session.flush()

        # 2. Store Manager User
        mgr = StoreManagerUserModel(
            id=uuid.uuid4(),
            store_id=store.id,
            employee_id=emp_id,
            username=f"mgr_{test_uid.lower()}",
            full_name=f"Manager {test_uid}",
            email=f"mgr_{test_uid.lower()}@nexuswms.com",
            password_hash=hashlib.sha256(b"store123").hexdigest(),
            status="ACTIVE",
        )
        session.add(mgr)

        # 3. Zone
        zone = StoreZoneModel(
            id=zone_id,
            store_id=store.id,
            zone_code=f"ZON-{test_uid}",
            zone_name=f"Zone {test_uid}",
            status="ACTIVE",
        )
        session.add(zone)

        # 4. Material & MaterialStock
        mat = MaterialModel(
            id=uuid.uuid4(),
            material_code=mat_code,
            material_name=f"Test Material {test_uid}",
            category="TEST",
            base_uom="NOS",
            status="Active",
        )
        session.add(mat)
        await session.flush()

        stock = MaterialStockModel(
            id=uuid.uuid4(),
            material_id=mat.id,
            material_code=mat_code,
            material_name=mat.material_name,
            category="TEST",
            on_hand=Decimal("10.0"),
            allocated=Decimal("0.0"),
            available=Decimal("0.0"),
            uom="NOS",
            warehouse_id="WH-001",
            reorder_point=Decimal("5.0"),
        )
        session.add(stock)

        # 5. GRN
        grn = GrnModel(
            id=grn_id,
            grn_number=f"GRN-{test_uid}",
            po_number=f"PO-{test_uid}",
            asn_number=f"ASN-{test_uid}",
            supplier_name="Test Supplier",
            warehouse_id="WH-001",
            status="GRN_POSTED",
        )
        session.add(grn)
        await session.flush()

        # 6. Putaway Task assigned to store
        task = PutawayTaskModel(
            id=task_id,
            task_number=f"PUT-{test_uid}",
            grn_id=grn.id,
            grn_number=f"GRN-{test_uid}",
            item_code=mat_code,
            material_name=f"Test Material {test_uid}",
            quantity=Decimal("10.0"),
            uom="NOS",
            warehouse_id="WH-001",
            source_location="RECEIVING-DOCK",
            destination_store_id=store.id,
            destination_zone_id=zone.id,
            status="ASSIGNED_TO_STORE",
            created_by="warehouse_clerk",
            created_at=datetime.datetime.now(datetime.timezone.utc),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Login as the newly created Store Manager with DB credentials
        login_res = await client.post(
            "/api/v1/procurement/auth/dev-login",
            json={"username": f"mgr_{test_uid.lower()}", "password": "store123"},
        )
        assert login_res.status_code == 200, login_res.text
        mgr_token = login_res.json()["token"]
        mgr_headers = {"Authorization": f"Bearer {mgr_token}"}

        # 2. Store Manager completes Putaway using raw Zone UUID (Resolving 422 issue)
        complete_res = await client.post(
            f"/api/storage/putaway-tasks/{task_id}/complete",
            json={
                "material_scan": mat_code,
                "location_scan": str(zone_id),  # Raw Zone UUID string
                "quantity": 10.0,
            },
            headers=mgr_headers,
        )
        assert complete_res.status_code == 200, complete_res.text
        assert complete_res.json()["status"] == "PUTAWAY_COMPLETED"
        assert complete_res.json()["destination_zone"] == f"ZON-{test_uid}"

        # 3. Cross-Store Rejection Test: create second task assigned to other_store_id
        task2_id = uuid.uuid4()
        grn2_id = uuid.uuid4()
        async with session_scope() as session:
            grn2 = GrnModel(
                id=grn2_id,
                grn_number=f"GRN2-{test_uid}",
                po_number=f"PO2-{test_uid}",
                asn_number=f"ASN2-{test_uid}",
                supplier_name="Test Supplier 2",
                warehouse_id="WH-001",
                status="GRN_POSTED",
            )
            session.add(grn2)
            await session.flush()

            task2 = PutawayTaskModel(
                id=task2_id,
                task_number=f"PUT2-{test_uid}",
                grn_id=grn2.id,
                grn_number=f"GRN2-{test_uid}",
                item_code=mat_code,
                material_name=f"Test Material {test_uid}",
                quantity=Decimal("5.0"),
                uom="NOS",
                warehouse_id="WH-001",
                source_location="RECEIVING-DOCK",
                destination_store_id=other_store_id,
                destination_zone_id=None,
                status="ASSIGNED_TO_STORE",
                created_by="warehouse_clerk",
                created_at=datetime.datetime.now(datetime.timezone.utc),
            )
            session.add(task2)
            await session.commit()

        # Attempt to complete task2 (which belongs to other_store_id) as Manager of store_id -> Expect 403 Forbidden
        cross_res = await client.post(
            f"/api/storage/putaway-tasks/{task2_id}/complete",
            json={
                "material_scan": mat_code,
                "location_scan": str(zone_id),
                "quantity": 5.0,
            },
            headers=mgr_headers,
        )
        assert cross_res.status_code == 403, cross_res.text
        assert "assigned to your Store" in cross_res.json()["detail"] or "Cannot complete Putaway" in cross_res.json()["detail"]
