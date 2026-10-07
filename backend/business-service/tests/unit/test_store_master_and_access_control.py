"""
Unit & Access Control Tests for Store Master module.
Tests Auto-Generated Sequential Store Identifiers (STR-001, STR-002, etc.),
Store Code Immutability, Concurrent Creation, Global Warehouse Visibility,
Store Manager Isolation, and IDOR Defense.
"""
import asyncio
import re
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.database.session import AsyncSessionFactory, engine
from app.database.base import Base
from app.main import app
from app.modules.store.infrastructure.persistence.models import StoreModel


@pytest.fixture(autouse=True)
async def cleanup_engine():
    # 1. Ensure store table exists
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    # 2. Cleanup test stores
    async with AsyncSessionFactory() as session:
        try:
            test_stores = (
                await session.execute(
                    select(StoreModel).where(
                        StoreModel.store_name.like("Test %") | StoreModel.store_name.like("Concurrent %")
                    )
                )
            ).scalars().all()
            for store in test_stores:
                await session.delete(store)
            await session.commit()
        except Exception:
            await session.rollback()


@pytest.mark.asyncio
async def test_auto_generated_sequential_store_code_and_immutability():
    """
    Verify:
    1. First Store receives a generated code (e.g. STR-001 or next sequential code).
    2. Second Store receives a different sequential code (STR-002, etc.).
    3. Store Code is not editable via API (remains immutable).
    4. Store Name can still be modified without affecting Store Code.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {
            "X-User-Id": "00000000-0000-0000-0000-000000000001",
            "X-User-Name": "warehouse_user",
            "X-User-Roles": "WAREHOUSE,ADMIN",
        }

        # 1. Check next suggested code endpoint
        next_code_res = await client.get("/api/v1/stores/next-code", headers=warehouse_headers)
        assert next_code_res.status_code == 200
        suggested = next_code_res.json()["suggested_store_code"]
        assert re.match(r"^STR-\d{3,}$", suggested)

        # 2. Create First Store (without client-provided store_code)
        create_res1 = await client.post(
            "/api/v1/stores",
            json={
                "store_name": "Test Electrical Workshop Store",
                "description": "Storage for motors and switchgears",
                "warehouse_id": "Main Warehouse",
                "store_manager_name": "Lead Electrician",
                "status": "ACTIVE",
            },
            headers=warehouse_headers,
        )
        assert create_res1.status_code == 201, create_res1.text
        data1 = create_res1.json()
        code1 = data1["store_code"]
        assert re.match(r"^STR-\d{3,}$", code1)
        assert data1["id"] is not None
        assert data1["store_name"] == "Test Electrical Workshop Store"

        # 3. Create Second Store (without client-provided store_code)
        create_res2 = await client.post(
            "/api/v1/stores",
            json={
                "store_name": "Test Mechanical Tooling Store",
                "description": "Storage for precision drills and lathes",
                "warehouse_id": "Main Warehouse",
                "status": "ACTIVE",
            },
            headers=warehouse_headers,
        )
        assert create_res2.status_code == 201, create_res2.text
        data2 = create_res2.json()
        code2 = data2["store_code"]
        assert re.match(r"^STR-\d{3,}$", code2)
        assert code1 != code2

        seq1 = int(re.match(r"^STR-(\d+)$", code1).group(1))
        seq2 = int(re.match(r"^STR-(\d+)$", code2).group(1))
        assert seq2 == seq1 + 1

        # 4. Attempt to modify Store Code via PUT / PATCH (Immutability check)
        store1_id = data1["id"]
        update_attempt = await client.put(
            f"/api/v1/stores/{store1_id}",
            json={
                "store_code": "STR-CUSTOM-HACKED",
                "store_name": "Test Electrical Workshop Store Renamed",
                "description": "Updated description",
            },
            headers=warehouse_headers,
        )
        assert update_attempt.status_code == 200
        updated_data = update_attempt.json()
        # Verify store_code remained unchanged!
        assert updated_data["store_code"] == code1
        assert updated_data["store_name"] == "Test Electrical Workshop Store Renamed"
        assert updated_data["description"] == "Updated description"

        # 5. Verify database record directly
        get_res = await client.get(f"/api/v1/stores/{store1_id}", headers=warehouse_headers)
        assert get_res.status_code == 200
        assert get_res.json()["store_code"] == code1


@pytest.mark.asyncio
async def test_concurrent_store_creation_unique_codes():
    """
    Verify that concurrent store creations do not generate duplicate codes.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {
            "X-User-Roles": "WAREHOUSE,ADMIN",
            "X-User-Name": "warehouse_user",
        }

        async def create_single_store(index: int):
            return await client.post(
                "/api/v1/stores",
                json={
                    "store_name": f"Concurrent Test Store {index}",
                    "description": f"Concurrent test payload {index}",
                    "status": "ACTIVE",
                },
                headers=warehouse_headers,
            )

        # Launch 5 concurrent creations
        responses = await asyncio.gather(*[create_single_store(i) for i in range(5)])

        created_codes = []
        for r in responses:
            assert r.status_code == 201, r.text
            created_codes.append(r.json()["store_code"])

        # All 5 generated codes must be distinct and unique
        assert len(created_codes) == 5
        assert len(set(created_codes)) == 5
        for code in created_codes:
            assert re.match(r"^STR-\d{3,}$", code)


@pytest.mark.asyncio
async def test_store_manager_options_list():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {
            "X-User-Roles": "WAREHOUSE",
            "X-User-Name": "warehouse_user",
        }
        res = await client.get("/api/v1/stores/managers", headers=headers)
        assert res.status_code == 200
        managers = res.json()
        assert len(managers) >= 5
        assert any(m["manager_id"] == "EMP-STORE-001" for m in managers)


@pytest.mark.asyncio
async def test_store_manager_isolation_and_idor_protection():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {"X-User-Roles": "WAREHOUSE,ADMIN", "X-User-Name": "warehouse_user"}

        # Create Store A
        res_a = await client.post(
            "/api/v1/stores",
            json={
                "store_name": "Test Store Alpha",
                "store_manager_id": "EMP-MGR-ALPHA",
                "store_manager_name": "Alpha Manager",
                "status": "ACTIVE",
            },
            headers=warehouse_headers,
        )
        assert res_a.status_code == 201
        store_a = res_a.json()

        # Create Store B
        res_b = await client.post(
            "/api/v1/stores",
            json={
                "store_name": "Test Store Beta",
                "store_manager_id": "EMP-MGR-BETA",
                "store_manager_name": "Beta Manager",
                "status": "ACTIVE",
            },
            headers=warehouse_headers,
        )
        assert res_b.status_code == 201
        store_b = res_b.json()

        # Headers for Store Manager A
        manager_a_headers = {
            "X-User-Id": "00000000-0000-0000-0000-000000000002",
            "X-User-Name": "store_mgr_alpha",
            "X-User-Roles": "STORE_MANAGER",
            "X-Employee-Id": "EMP-MGR-ALPHA",
            "X-Store-Id": store_a["id"],
            "X-Store-Code": store_a["store_code"],
        }

        # 1. Global Warehouse lists all stores
        wh_list = await client.get("/api/v1/stores", headers=warehouse_headers)
        assert wh_list.status_code == 200
        all_store_ids = [s["id"] for s in wh_list.json()]
        assert store_a["id"] in all_store_ids
        assert store_b["id"] in all_store_ids

        # 2. Store Manager A lists stores -> gets ONLY Store A
        mgr_list = await client.get("/api/v1/stores", headers=manager_a_headers)
        assert mgr_list.status_code == 200
        mgr_store_ids = [s["id"] for s in mgr_list.json()]
        assert store_a["id"] in mgr_store_ids
        assert store_b["id"] not in mgr_store_ids

        # 3. Store Manager A gets /me -> returns Store A
        me_res = await client.get("/api/v1/stores/me", headers=manager_a_headers)
        assert me_res.status_code == 200
        assert me_res.json()["id"] == store_a["id"]

        # 4. Store Manager A accesses own Store A by ID and Code -> 200 OK
        access_own_id = await client.get(f"/api/v1/stores/{store_a['id']}", headers=manager_a_headers)
        assert access_own_id.status_code == 200

        access_own_code = await client.get(f"/api/v1/stores/{store_a['store_code']}", headers=manager_a_headers)
        assert access_own_code.status_code == 200

        # 5. IDOR ATTACK: Store Manager A attempts to access Store B by ID -> 403 Forbidden
        idor_id_attack = await client.get(f"/api/v1/stores/{store_b['id']}", headers=manager_a_headers)
        assert idor_id_attack.status_code == 403
        assert "Access denied" in idor_id_attack.json()["detail"]

        # 6. IDOR ATTACK: Store Manager A attempts to access Store B by Code -> 403 Forbidden
        idor_code_attack = await client.get(f"/api/v1/stores/{store_b['store_code']}", headers=manager_a_headers)
        assert idor_code_attack.status_code == 403
        assert "Access denied" in idor_code_attack.json()["detail"]

        # 7. Store Manager attempts to create a Store -> 403 Forbidden
        create_attack = await client.post(
            "/api/v1/stores",
            json={"store_name": "Unauthorized Store"},
            headers=manager_a_headers,
        )
        assert create_attack.status_code == 403

        # 8. Store Manager attempts to modify Store B -> 403 Forbidden
        modify_attack = await client.put(
            f"/api/v1/stores/{store_b['id']}",
            json={"store_name": "Tampered Store Name"},
            headers=manager_a_headers,
        )
        assert modify_attack.status_code == 403

        # 9. Store Manager attempts to toggle status -> 403 Forbidden
        status_attack = await client.patch(
            f"/api/v1/stores/{store_b['id']}/status",
            json={"status": "INACTIVE"},
            headers=manager_a_headers,
        )
        assert status_attack.status_code == 403
