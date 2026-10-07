"""
Unit & Access Control Tests for Store Zones & Hierarchy.
Tests Zone CRUD, Sequential Code Generation, Store Manager Zone Isolation,
IDOR Defense, and Warehouse Global Hierarchy Visibility.
"""
import re
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.database.session import AsyncSessionFactory, engine
from app.database.base import Base
from app.main import app
from app.modules.store.infrastructure.persistence.models import StoreModel, StoreZoneModel


@pytest.fixture(autouse=True)
async def cleanup_engine():
    # 1. Ensure tables exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    # 2. Cleanup test data
    async with AsyncSessionFactory() as session:
        try:
            test_zones = (
                await session.execute(
                    select(StoreZoneModel).where(
                        StoreZoneModel.zone_name.like("Test %") | StoreZoneModel.zone_name.like("Zone %")
                    )
                )
            ).scalars().all()
            for z in test_zones:
                await session.delete(z)

            test_stores = (
                await session.execute(
                    select(StoreModel).where(
                        StoreModel.store_name.like("Test Zone %")
                    )
                )
            ).scalars().all()
            for s in test_stores:
                await session.delete(s)

            await session.commit()
        except Exception:
            await session.rollback()


@pytest.mark.asyncio
async def test_zone_crud_and_code_generation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {
            "X-User-Id": "00000000-0000-0000-0000-000000000001",
            "X-User-Name": "warehouse_user",
            "X-User-Roles": "WAREHOUSE,ADMIN",
        }

        # 1. Create a Test Store
        store_res = await client.post(
            "/api/v1/stores",
            json={
                "store_name": "Test Zone Electrical Store",
                "description": "Store for zone testing",
                "status": "ACTIVE",
            },
            headers=warehouse_headers,
        )
        assert store_res.status_code == 201
        store_data = store_res.json()
        store_id = store_data["id"]
        store_code = store_data["store_code"]

        # 2. Check next suggested zone code endpoint
        next_code_res = await client.get(f"/api/v1/stores/{store_id}/zones/next-code", headers=warehouse_headers)
        assert next_code_res.status_code == 200
        suggested_zone = next_code_res.json()["suggested_zone_code"]
        assert suggested_zone == f"{store_code}-Z01"

        # 3. Create Zone 1 (Auto-generated code)
        z1_res = await client.post(
            f"/api/v1/stores/{store_id}/zones",
            json={
                "zone_name": "Test High Voltage Bay",
                "description": "Panel and breaker racks",
            },
            headers=warehouse_headers,
        )
        assert z1_res.status_code == 201
        z1_data = z1_res.json()
        assert z1_data["zone_code"] == f"{store_code}-Z01"
        assert z1_data["zone_name"] == "Test High Voltage Bay"
        assert z1_data["status"] == "ACTIVE"
        z1_id = z1_data["id"]

        # 4. Create Zone 2 (Next auto-generated code)
        z2_res = await client.post(
            f"/api/v1/stores/{store_id}/zones",
            json={
                "zone_name": "Test Control Relays Area",
                "description": "Sensors and relays bin",
            },
            headers=warehouse_headers,
        )
        assert z2_res.status_code == 201
        z2_data = z2_res.json()
        assert z2_data["zone_code"] == f"{store_code}-Z02"

        # 5. Duplicate zone_code in same store should return 409 Conflict
        dup_res = await client.post(
            f"/api/v1/stores/{store_id}/zones",
            json={
                "zone_code": f"{store_code}-Z01",
                "zone_name": "Duplicate Zone Attempt",
            },
            headers=warehouse_headers,
        )
        assert dup_res.status_code == 409

        # 6. Get Zone by ID
        get_z1 = await client.get(f"/api/v1/zones/{z1_id}", headers=warehouse_headers)
        assert get_z1.status_code == 200
        assert get_z1.json()["zone_code"] == f"{store_code}-Z01"

        # 7. Update Zone details & verify immutability of store_id and zone_code
        upd_res = await client.put(
            f"/api/v1/zones/{z1_id}",
            json={
                "zone_name": "Test High Voltage Main Bay",
                "description": "Updated high voltage containment",
            },
            headers=warehouse_headers,
        )
        assert upd_res.status_code == 200
        upd_data = upd_res.json()
        assert upd_data["zone_name"] == "Test High Voltage Main Bay"
        assert upd_data["zone_code"] == f"{store_code}-Z01"
        assert upd_data["store_id"] == store_id

        # 8. Toggle Zone Status
        deact_res = await client.patch(
            f"/api/v1/zones/{z1_id}/status",
            json={"status": "INACTIVE"},
            headers=warehouse_headers,
        )
        assert deact_res.status_code == 200
        assert deact_res.json()["status"] == "INACTIVE"

        react_res = await client.patch(
            f"/api/v1/zones/{z1_id}/status",
            json={"status": "ACTIVE"},
            headers=warehouse_headers,
        )
        assert react_res.status_code == 200
        assert react_res.json()["status"] == "ACTIVE"


@pytest.mark.asyncio
async def test_store_manager_zone_isolation_and_idor_defense():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {
            "X-User-Roles": "WAREHOUSE,ADMIN",
            "X-User-Name": "warehouse_user",
        }

        # 1. Create Store Alpha and Zone Alpha-1
        res_a = await client.post(
            "/api/v1/stores",
            json={
                "store_name": "Test Zone Store Alpha",
                "store_manager_id": "EMP-MGR-ZONE-A",
                "store_manager_name": "Alpha Zone Manager",
            },
            headers=warehouse_headers,
        )
        assert res_a.status_code == 201
        store_a = res_a.json()

        z_a_res = await client.post(
            f"/api/v1/stores/{store_a['id']}/zones",
            json={"zone_name": "Test Alpha Primary Rack"},
            headers=warehouse_headers,
        )
        assert z_a_res.status_code == 201
        zone_a = z_a_res.json()

        # 2. Create Store Beta and Zone Beta-1
        res_b = await client.post(
            "/api/v1/stores",
            json={
                "store_name": "Test Zone Store Beta",
                "store_manager_id": "EMP-MGR-ZONE-B",
                "store_manager_name": "Beta Zone Manager",
            },
            headers=warehouse_headers,
        )
        assert res_b.status_code == 201
        store_b = res_b.json()

        z_b_res = await client.post(
            f"/api/v1/stores/{store_b['id']}/zones",
            json={"zone_name": "Test Beta Heavy Bay"},
            headers=warehouse_headers,
        )
        assert z_b_res.status_code == 201
        zone_b = z_b_res.json()

        # 3. Authenticate as Store Manager A (assigned to Store Alpha)
        mgr_a_headers = {
            "X-User-Id": "00000000-0000-0000-0000-000000000010",
            "X-User-Name": "store_mgr_zone_alpha",
            "X-User-Roles": "STORE_MANAGER",
            "X-Employee-Id": "EMP-MGR-ZONE-A",
            "X-Store-Id": store_a["id"],
            "X-Store-Code": store_a["store_code"],
        }

        # 4. Manager A lists zones in Store A -> 200 OK
        list_own = await client.get(f"/api/v1/stores/{store_a['id']}/zones", headers=mgr_a_headers)
        assert list_own.status_code == 200
        own_zone_ids = [z["id"] for z in list_own.json()]
        assert zone_a["id"] in own_zone_ids

        # 5. Manager A creates Zone in Store A -> 201 Created
        create_own_z2 = await client.post(
            f"/api/v1/stores/{store_a['id']}/zones",
            json={"zone_name": "Test Alpha Secondary Rack"},
            headers=mgr_a_headers,
        )
        assert create_own_z2.status_code == 201

        # 6. IDOR ATTACK: Manager A attempts to list zones in Store B -> 403 Forbidden
        list_idor = await client.get(f"/api/v1/stores/{store_b['id']}/zones", headers=mgr_a_headers)
        assert list_idor.status_code == 403
        assert "Access denied" in list_idor.json()["detail"]

        # 7. IDOR ATTACK: Manager A attempts to create zone in Store B -> 403 Forbidden
        create_idor = await client.post(
            f"/api/v1/stores/{store_b['id']}/zones",
            json={"zone_name": "Unauthorized Injected Zone"},
            headers=mgr_a_headers,
        )
        assert create_idor.status_code == 403

        # 8. IDOR ATTACK: Manager A attempts to get Zone B by direct ID -> 403 Forbidden
        get_idor = await client.get(f"/api/v1/zones/{zone_b['id']}", headers=mgr_a_headers)
        assert get_idor.status_code == 403

        # 9. IDOR ATTACK: Manager A attempts to modify Zone B -> 403 Forbidden
        put_idor = await client.put(
            f"/api/v1/zones/{zone_b['id']}",
            json={"zone_name": "Hacked Zone Name"},
            headers=mgr_a_headers,
        )
        assert put_idor.status_code == 403

        # 10. IDOR ATTACK: Manager A attempts to toggle status of Zone B -> 403 Forbidden
        status_idor = await client.patch(
            f"/api/v1/zones/{zone_b['id']}/status",
            json={"status": "INACTIVE"},
            headers=mgr_a_headers,
        )
        assert status_idor.status_code == 403


@pytest.mark.asyncio
async def test_warehouse_global_hierarchy_view():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {
            "X-User-Roles": "WAREHOUSE,ADMIN",
            "X-User-Name": "warehouse_user",
        }

        res = await client.get("/api/v1/stores/hierarchy/all", headers=warehouse_headers)
        assert res.status_code == 200
        data = res.json()
        assert len(data) >= 1
        for store in data:
            assert "id" in store
            assert "store_code" in store
            assert "zones" in store
            assert isinstance(store["zones"], list)
