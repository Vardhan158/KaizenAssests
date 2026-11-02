"""
Unit & Access Control Tests for Warehouse Master module.
Tests Auto-Generated Sequential Warehouse Identifiers (STR-001, STR-002, etc.),
Warehouse Code Immutability, Concurrent Creation, Global Warehouse Visibility,
Warehouse Operator Isolation, and IDOR Defense.
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
from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel


@pytest.fixture(autouse=True)
async def cleanup_engine():
    # 1. Ensure warehouse table exists
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    # 2. Cleanup test warehouses
    async with AsyncSessionFactory() as session:
        try:
            test_warehouses = (
                await session.execute(
                    select(WarehouseModel).where(
                        WarehouseModel.warehouse_name.like("Test %") | WarehouseModel.warehouse_name.like("Concurrent %")
                    )
                )
            ).scalars().all()
            for warehouse in test_warehouses:
                await session.delete(warehouse)
            await session.commit()
        except Exception:
            await session.rollback()


@pytest.mark.asyncio
async def test_auto_generated_sequential_warehouse_code_and_immutability():
    """
    Verify:
    1. First Warehouse receives a generated code (e.g. STR-001 or next sequential code).
    2. Second Warehouse receives a different sequential code (STR-002, etc.).
    3. Warehouse Code is not editable via API (remains immutable).
    4. Warehouse Name can still be modified without affecting Warehouse Code.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {
            "X-User-Id": "00000000-0000-0000-0000-000000000001",
            "X-User-Name": "warehouse_user",
            "X-User-Roles": "WAREHOUSE,ADMIN",
        }

        # 1. Check next suggested code endpoint
        next_code_res = await client.get("/api/v1/warehouse/next-code", headers=warehouse_headers)
        assert next_code_res.status_code == 200
        suggested = next_code_res.json()["suggested_warehouse_code"]
        assert re.match(r"^STR-\d{3,}$", suggested)

        # 2. Create First Warehouse (without client-provided warehouse_code)
        create_res1 = await client.post(
            "/api/v1/warehouse",
            json={
                "warehouse_name": "Test Electrical Workshop Warehouse",
                "description": "Storage for motors and switchgears",
                "warehouse_id": "Main Warehouse",
                "warehouse_operator_name": "Lead Electrician",
                "status": "ACTIVE",
            },
            headers=warehouse_headers,
        )
        assert create_res1.status_code == 201, create_res1.text
        data1 = create_res1.json()
        code1 = data1["warehouse_code"]
        assert re.match(r"^STR-\d{3,}$", code1)
        assert data1["id"] is not None
        assert data1["warehouse_name"] == "Test Electrical Workshop Warehouse"

        # 3. Create Second Warehouse (without client-provided warehouse_code)
        create_res2 = await client.post(
            "/api/v1/warehouse",
            json={
                "warehouse_name": "Test Mechanical Tooling Warehouse",
                "description": "Storage for precision drills and lathes",
                "warehouse_id": "Main Warehouse",
                "status": "ACTIVE",
            },
            headers=warehouse_headers,
        )
        assert create_res2.status_code == 201, create_res2.text
        data2 = create_res2.json()
        code2 = data2["warehouse_code"]
        assert re.match(r"^STR-\d{3,}$", code2)
        assert code1 != code2

        seq1 = int(re.match(r"^STR-(\d+)$", code1).group(1))
        seq2 = int(re.match(r"^STR-(\d+)$", code2).group(1))
        assert seq2 == seq1 + 1

        # 4. Attempt to modify Warehouse Code via PUT / PATCH (Immutability check)
        store1_id = data1["id"]
        update_attempt = await client.put(
            f"/api/v1/warehouse/{store1_id}",
            json={
                "warehouse_code": "STR-CUSTOM-HACKED",
                "warehouse_name": "Test Electrical Workshop Warehouse Renamed",
                "description": "Updated description",
            },
            headers=warehouse_headers,
        )
        assert update_attempt.status_code == 200
        updated_data = update_attempt.json()
        # Verify warehouse_code remained unchanged!
        assert updated_data["warehouse_code"] == code1
        assert updated_data["warehouse_name"] == "Test Electrical Workshop Warehouse Renamed"
        assert updated_data["description"] == "Updated description"

        # 5. Verify database record directly
        get_res = await client.get(f"/api/v1/warehouse/{store1_id}", headers=warehouse_headers)
        assert get_res.status_code == 200
        assert get_res.json()["warehouse_code"] == code1


@pytest.mark.asyncio
async def test_concurrent_warehouse_creation_unique_codes():
    """
    Verify that concurrent warehouse creations do not generate duplicate codes.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {
            "X-User-Roles": "WAREHOUSE,ADMIN",
            "X-User-Name": "warehouse_user",
        }

        async def create_single_warehouse(index: int):
            return await client.post(
                "/api/v1/warehouse",
                json={
                    "warehouse_name": f"Concurrent Test Warehouse {index}",
                    "description": f"Concurrent test payload {index}",
                    "status": "ACTIVE",
                },
                headers=warehouse_headers,
            )

        # Launch 5 concurrent creations
        responses = await asyncio.gather(*[create_single_warehouse(i) for i in range(5)])

        created_codes = []
        for r in responses:
            assert r.status_code == 201, r.text
            created_codes.append(r.json()["warehouse_code"])

        # All 5 generated codes must be distinct and unique
        assert len(created_codes) == 5
        assert len(set(created_codes)) == 5
        for code in created_codes:
            assert re.match(r"^STR-\d{3,}$", code)


@pytest.mark.asyncio
async def test_warehouse_operator_options_list():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {
            "X-User-Roles": "WAREHOUSE",
            "X-User-Name": "warehouse_user",
        }
        res = await client.get("/api/v1/warehouse/managers", headers=headers)
        assert res.status_code == 200
        managers = res.json()
        assert len(managers) >= 5
        assert any(m["manager_id"] == "EMP-WAREHOUSE_OPERATOR-001" for m in managers)


@pytest.mark.asyncio
async def test_warehouse_operator_isolation_and_idor_protection():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {"X-User-Roles": "WAREHOUSE,ADMIN", "X-User-Name": "warehouse_user"}

        # Create Warehouse A
        res_a = await client.post(
            "/api/v1/warehouse",
            json={
                "warehouse_name": "Test Warehouse Alpha",
                "warehouse_operator_id": "EMP-MGR-ALPHA",
                "warehouse_operator_name": "Alpha Manager",
                "status": "ACTIVE",
            },
            headers=warehouse_headers,
        )
        assert res_a.status_code == 201
        warehouse_a = res_a.json()

        # Create Warehouse B
        res_b = await client.post(
            "/api/v1/warehouse",
            json={
                "warehouse_name": "Test Warehouse Beta",
                "warehouse_operator_id": "EMP-MGR-BETA",
                "warehouse_operator_name": "Beta Manager",
                "status": "ACTIVE",
            },
            headers=warehouse_headers,
        )
        assert res_b.status_code == 201
        warehouse_b = res_b.json()

        # Headers for Warehouse Operator A
        manager_a_headers = {
            "X-User-Id": "00000000-0000-0000-0000-000000000002",
            "X-User-Name": "warehouse_mgr_alpha",
            "X-User-Roles": "WAREHOUSE_OPERATOR",
            "X-Employee-Id": "EMP-MGR-ALPHA",
            "X-Warehouse-Id": warehouse_a["id"],
            "X-Warehouse-Code": warehouse_a["warehouse_code"],
        }

        # 1. Global Warehouse lists all warehouses
        wh_list = await client.get("/api/v1/warehouse", headers=warehouse_headers)
        assert wh_list.status_code == 200
        all_warehouse_ref_ids = [s["id"] for s in wh_list.json()]
        assert warehouse_a["id"] in all_warehouse_ref_ids
        assert warehouse_b["id"] in all_warehouse_ref_ids

        # 2. Warehouse Operator A lists warehouses -> gets ONLY Warehouse A
        mgr_list = await client.get("/api/v1/warehouse", headers=manager_a_headers)
        assert mgr_list.status_code == 200
        mgr_warehouse_ref_ids = [s["id"] for s in mgr_list.json()]
        assert warehouse_a["id"] in mgr_warehouse_ref_ids
        assert warehouse_b["id"] not in mgr_warehouse_ref_ids

        # 3. Warehouse Operator A gets /me -> returns Warehouse A
        me_res = await client.get("/api/v1/warehouse/me", headers=manager_a_headers)
        assert me_res.status_code == 200
        assert me_res.json()["id"] == warehouse_a["id"]

        # 4. Warehouse Operator A accesses own Warehouse A by ID and Code -> 200 OK
        access_own_id = await client.get(f"/api/v1/warehouse/{warehouse_a['id']}", headers=manager_a_headers)
        assert access_own_id.status_code == 200

        access_own_code = await client.get(f"/api/v1/warehouse/{warehouse_a['warehouse_code']}", headers=manager_a_headers)
        assert access_own_code.status_code == 200

        # 5. IDOR ATTACK: Warehouse Operator A attempts to access Warehouse B by ID -> 403 Forbidden
        idor_id_attack = await client.get(f"/api/v1/warehouse/{warehouse_b['id']}", headers=manager_a_headers)
        assert idor_id_attack.status_code == 403
        assert "Access denied" in idor_id_attack.json()["detail"]

        # 6. IDOR ATTACK: Warehouse Operator A attempts to access Warehouse B by Code -> 403 Forbidden
        idor_code_attack = await client.get(f"/api/v1/warehouse/{warehouse_b['warehouse_code']}", headers=manager_a_headers)
        assert idor_code_attack.status_code == 403
        assert "Access denied" in idor_code_attack.json()["detail"]

        # 7. Warehouse Operator attempts to create a Warehouse -> 403 Forbidden
        create_attack = await client.post(
            "/api/v1/warehouse",
            json={"warehouse_name": "Unauthorized Warehouse"},
            headers=manager_a_headers,
        )
        assert create_attack.status_code == 403

        # 8. Warehouse Operator attempts to modify Warehouse B -> 403 Forbidden
        modify_attack = await client.put(
            f"/api/v1/warehouse/{warehouse_b['id']}",
            json={"warehouse_name": "Tampered Warehouse Name"},
            headers=manager_a_headers,
        )
        assert modify_attack.status_code == 403

        # 9. Warehouse Operator attempts to toggle status -> 403 Forbidden
        status_attack = await client.patch(
            f"/api/v1/warehouse/{warehouse_b['id']}/status",
            json={"status": "INACTIVE"},
            headers=manager_a_headers,
        )
        assert status_attack.status_code == 403
