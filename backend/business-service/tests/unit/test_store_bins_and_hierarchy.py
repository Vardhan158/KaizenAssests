"""
Unit & Access Control Tests for Store Bins & Location Hierarchy.
Tests:
- Bin Sequential Code Generation (BIN-{zone_code}-001, 002)
- Bin CRUD and Status Management
- Bin QR Code Generation & Scan Lookup
- Store Manager IDOR Defense and Store Isolation
- 3-Level Hierarchy View (Store -> Zone -> Bin)
- Putaway Verification and Execution against exact Bins
"""
import datetime
import json
import re
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.database.session import AsyncSessionFactory, engine
from app.database.base import Base
from app.main import app
from app.modules.store.infrastructure.persistence.models import StoreBinModel, StoreModel, StoreZoneModel


@pytest.fixture(autouse=True)
async def cleanup_engine():
    # 1. Ensure tables exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    # 2. Cleanup test data
    async with AsyncSessionFactory() as session:
        try:
            test_bins = (
                await session.execute(
                    select(StoreBinModel).where(
                        StoreBinModel.bin_name.like("Test %") | StoreBinModel.bin_name.like("Bin %")
                    )
                )
            ).scalars().all()
            for b in test_bins:
                await session.delete(b)

            test_zones = (
                await session.execute(
                    select(StoreZoneModel).where(
                        StoreZoneModel.zone_name.like("Test Bin %") | StoreZoneModel.zone_name.like("Test %")
                    )
                )
            ).scalars().all()
            for z in test_zones:
                await session.delete(z)

            test_stores = (
                await session.execute(
                    select(StoreModel).where(
                        StoreModel.store_name.like("Test Bin Store %")
                    )
                )
            ).scalars().all()
            for s in test_stores:
                await session.delete(s)

            await session.commit()
        except Exception:
            await session.rollback()


@pytest.mark.asyncio
async def test_bin_crud_and_code_generation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {
            "X-User-Id": "00000000-0000-0000-0000-000000000001",
            "X-User-Name": "warehouse_user",
            "X-User-Roles": "WAREHOUSE,ADMIN",
        }

        # 1. Create Store
        store_res = await client.post(
            "/api/v1/stores",
            json={
                "store_name": "Test Bin Store Electrical",
                "description": "Store for bin testing",
                "status": "ACTIVE",
            },
            headers=warehouse_headers,
        )
        assert store_res.status_code == 201
        store = store_res.json()

        # 2. Create Zone
        zone_res = await client.post(
            f"/api/v1/stores/{store['id']}/zones",
            json={
                "zone_name": "Test Bin High Voltage Bay",
                "description": "Panel bay for testing bins",
            },
            headers=warehouse_headers,
        )
        assert zone_res.status_code == 201
        zone = zone_res.json()

        # 3. Check Next Bin Code Endpoint
        next_code_res = await client.get(
            f"/api/v1/zones/{zone['id']}/bins/next-code",
            headers=warehouse_headers,
        )
        assert next_code_res.status_code == 200
        clean_zone = zone["zone_code"].replace(" ", "").upper()
        expected_bin_001 = f"BIN-{clean_zone}-001"
        assert next_code_res.json()["suggested_bin_code"] == expected_bin_001

        # 4. Create Bin 1 (Auto-generated code)
        bin1_res = await client.post(
            f"/api/v1/zones/{zone['id']}/bins",
            json={
                "bin_name": "Test Shelf 01 Primary",
                "rack": "R01",
                "shelf": "S01",
                "capacity": 500.0,
            },
            headers=warehouse_headers,
        )
        assert bin1_res.status_code == 201
        bin1 = bin1_res.json()
        assert bin1["bin_code"] == expected_bin_001
        assert bin1["bin_name"] == "Test Shelf 01 Primary"
        assert bin1["rack"] == "R01"
        assert bin1["shelf"] == "S01"
        assert float(bin1["capacity"]) == 500.0
        assert float(bin1["occupied_quantity"]) == 0.0
        assert bin1["status"] == "ACTIVE"

        # 5. Check Next Bin Code Endpoint increments to 002
        next_code_2_res = await client.get(
            f"/api/v1/zones/{zone['id']}/bins/next-code",
            headers=warehouse_headers,
        )
        assert next_code_2_res.status_code == 200
        assert next_code_2_res.json()["suggested_bin_code"] == f"BIN-{clean_zone}-002"

        # 6. Create Bin 2
        bin2_res = await client.post(
            f"/api/v1/zones/{zone['id']}/bins",
            json={
                "bin_name": "Test Shelf 02 Heavy",
                "rack": "R01",
                "shelf": "S02",
                "capacity": 1000.0,
            },
            headers=warehouse_headers,
        )
        assert bin2_res.status_code == 201
        bin2 = bin2_res.json()
        assert bin2["bin_code"] == f"BIN-{clean_zone}-002"

        # 7. List Bins in Zone
        list_res = await client.get(f"/api/v1/zones/{zone['id']}/bins", headers=warehouse_headers)
        assert list_res.status_code == 200
        bins_list = list_res.json()
        assert len(bins_list) == 2
        bin_codes = [b["bin_code"] for b in bins_list]
        assert bin1["bin_code"] in bin_codes
        assert bin2["bin_code"] in bin_codes

        # 8. List Bins for Store
        store_bins_res = await client.get(f"/api/v1/stores/{store['id']}/bins", headers=warehouse_headers)
        assert store_bins_res.status_code == 200
        assert len(store_bins_res.json()) == 2

        # 9. Get Single Bin
        get_bin_res = await client.get(f"/api/v1/bins/{bin1['id']}", headers=warehouse_headers)
        assert get_bin_res.status_code == 200
        assert get_bin_res.json()["id"] == bin1["id"]

        # 10. Update Bin
        put_bin_res = await client.put(
            f"/api/v1/bins/{bin1['id']}",
            json={
                "bin_name": "Test Shelf 01 Updated Label",
                "capacity": 750.0,
            },
            headers=warehouse_headers,
        )
        assert put_bin_res.status_code == 200
        assert put_bin_res.json()["bin_name"] == "Test Shelf 01 Updated Label"
        assert float(put_bin_res.json()["capacity"]) == 750.0

        # 11. Toggle Bin Status
        patch_status_res = await client.patch(
            f"/api/v1/bins/{bin1['id']}/status",
            json={"status": "INACTIVE"},
            headers=warehouse_headers,
        )
        assert patch_status_res.status_code == 200
        assert patch_status_res.json()["status"] == "INACTIVE"


@pytest.mark.asyncio
async def test_bin_qr_and_scan_lookup():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {
            "X-User-Roles": "WAREHOUSE,ADMIN",
            "X-User-Name": "warehouse_user",
        }

        # Setup Store, Zone, Bin
        store_res = await client.post(
            "/api/v1/stores",
            json={"store_name": "Test Bin Store QR Test", "status": "ACTIVE"},
            headers=warehouse_headers,
        )
        store = store_res.json()

        zone_res = await client.post(
            f"/api/v1/stores/{store['id']}/zones",
            json={"zone_name": "Test Bin QR Zone"},
            headers=warehouse_headers,
        )
        zone = zone_res.json()

        bin_res = await client.post(
            f"/api/v1/zones/{zone['id']}/bins",
            json={"bin_name": "Test Bin QR Target", "rack": "R05", "shelf": "S03"},
            headers=warehouse_headers,
        )
        bin_data = bin_res.json()

        # 1. Fetch Bin QR
        qr_res = await client.get(f"/api/v1/bins/{bin_data['id']}/qr", headers=warehouse_headers)
        assert qr_res.status_code == 200
        qr_payload_res = qr_res.json()
        assert qr_payload_res["bin_id"] == bin_data["id"]
        assert qr_payload_res["bin_code"] == bin_data["bin_code"]
        assert qr_payload_res["zone_id"] == zone["id"]
        assert qr_payload_res["store_id"] == store["id"]
        assert "qr_payload" in qr_payload_res

        parsed = json.loads(qr_payload_res["qr_payload"])
        assert parsed["type"] == "BIN_QR"
        assert parsed["bin_code"] == bin_data["bin_code"]

        # 2. Server-Side Scan Lookup with JSON QR payload
        scan_res = await client.post(
            "/api/v1/bins/scan-lookup",
            json={"scan_value": qr_payload_res["qr_payload"]},
            headers=warehouse_headers,
        )
        assert scan_res.status_code == 200
        assert scan_res.json()["bin_id"] == bin_data["id"]

        # 3. Server-Side Scan Lookup with raw bin_code
        scan_code_res = await client.post(
            "/api/v1/bins/scan-lookup",
            json={"scan_value": bin_data["bin_code"]},
            headers=warehouse_headers,
        )
        assert scan_code_res.status_code == 200
        assert scan_code_res.json()["bin_id"] == bin_data["id"]

        # 4. Server-Side Scan Lookup with raw UUID
        scan_uuid_res = await client.post(
            "/api/v1/bins/scan-lookup",
            json={"scan_value": bin_data["id"]},
            headers=warehouse_headers,
        )
        assert scan_uuid_res.status_code == 200
        assert scan_uuid_res.json()["bin_code"] == bin_data["bin_code"]


@pytest.mark.asyncio
async def test_store_manager_bin_isolation_and_idor():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {
            "X-User-Roles": "WAREHOUSE,ADMIN",
            "X-User-Name": "warehouse_user",
        }

        # 1. Create Store Alpha & Store Beta
        res_a = await client.post(
            "/api/v1/stores",
            json={"store_name": "Test Bin Store Alpha"},
            headers=warehouse_headers,
        )
        store_a = res_a.json()

        res_b = await client.post(
            "/api/v1/stores",
            json={"store_name": "Test Bin Store Beta"},
            headers=warehouse_headers,
        )
        store_b = res_b.json()

        # 2. Create Zones and Bins in Store Alpha & Store Beta
        za_res = await client.post(f"/api/v1/stores/{store_a['id']}/zones", json={"zone_name": "Test Alpha Zone"}, headers=warehouse_headers)
        zone_a = za_res.json()
        ba_res = await client.post(f"/api/v1/zones/{zone_a['id']}/bins", json={"bin_name": "Test Alpha Bin 1"}, headers=warehouse_headers)
        bin_a = ba_res.json()

        zb_res = await client.post(f"/api/v1/stores/{store_b['id']}/zones", json={"zone_name": "Test Beta Zone"}, headers=warehouse_headers)
        zone_b = zb_res.json()
        bb_res = await client.post(f"/api/v1/zones/{zone_b['id']}/bins", json={"bin_name": "Test Beta Bin 1"}, headers=warehouse_headers)
        bin_b = bb_res.json()

        # 3. Authenticate as Store Manager Alpha
        mgr_a_headers = {
            "X-User-Id": "00000000-0000-0000-0000-000000000020",
            "X-User-Name": "store_mgr_bin_alpha",
            "X-User-Roles": "STORE_MANAGER",
            "X-Employee-Id": "EMP-MGR-BIN-A",
            "X-Store-Id": store_a["id"],
            "X-Store-Code": store_a["store_code"],
        }

        # 4. Manager A lists bins in own zone -> 200 OK
        list_own = await client.get(f"/api/v1/zones/{zone_a['id']}/bins", headers=mgr_a_headers)
        assert list_own.status_code == 200
        assert any(b["id"] == bin_a["id"] for b in list_own.json())

        # 5. Manager A creates bin in own zone -> 201 Created
        create_own = await client.post(
            f"/api/v1/zones/{zone_a['id']}/bins",
            json={"bin_name": "Test Alpha Bin 2"},
            headers=mgr_a_headers,
        )
        assert create_own.status_code == 201

        # 6. IDOR ATTACK: Manager A attempts to list bins in Zone B -> 403 Forbidden
        list_idor = await client.get(f"/api/v1/zones/{zone_b['id']}/bins", headers=mgr_a_headers)
        assert list_idor.status_code == 403
        assert "Access denied" in list_idor.json()["detail"]

        # 7. IDOR ATTACK: Manager A attempts to create bin in Zone B -> 403 Forbidden
        create_idor = await client.post(
            f"/api/v1/zones/{zone_b['id']}/bins",
            json={"bin_name": "Unauthorized Injected Bin"},
            headers=mgr_a_headers,
        )
        assert create_idor.status_code == 403

        # 8. IDOR ATTACK: Manager A attempts to get Bin B details -> 403 Forbidden
        get_idor = await client.get(f"/api/v1/bins/{bin_b['id']}", headers=mgr_a_headers)
        assert get_idor.status_code == 403

        # 9. IDOR ATTACK: Manager A attempts to modify Bin B -> 403 Forbidden
        put_idor = await client.put(
            f"/api/v1/bins/{bin_b['id']}",
            json={"bin_name": "Hacked Bin Name"},
            headers=mgr_a_headers,
        )
        assert put_idor.status_code == 403

        # 10. IDOR ATTACK: Manager A attempts to toggle status of Bin B -> 403 Forbidden
        patch_idor = await client.patch(
            f"/api/v1/bins/{bin_b['id']}/status",
            json={"status": "INACTIVE"},
            headers=mgr_a_headers,
        )
        assert patch_idor.status_code == 403


@pytest.mark.asyncio
async def test_global_3_level_hierarchy_view():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {
            "X-User-Roles": "WAREHOUSE,ADMIN",
            "X-User-Name": "warehouse_user",
        }

        # Setup 3 levels
        store_res = await client.post("/api/v1/stores", json={"store_name": "Test Bin Store Hier Test"}, headers=warehouse_headers)
        store = store_res.json()
        z_res = await client.post(f"/api/v1/stores/{store['id']}/zones", json={"zone_name": "Test Hier Zone"}, headers=warehouse_headers)
        zone = z_res.json()
        b_res = await client.post(f"/api/v1/zones/{zone['id']}/bins", json={"bin_name": "Test Hier Bin"}, headers=warehouse_headers)
        bin_data = b_res.json()

        # Fetch hierarchy
        res = await client.get("/api/v1/stores/hierarchy/all", headers=warehouse_headers)
        assert res.status_code == 200
        hierarchy = res.json()

        found_store = next((s for s in hierarchy if s["id"] == store["id"]), None)
        assert found_store is not None
        assert "zones" in found_store
        found_zone = next((z for z in found_store["zones"] if z["id"] == zone["id"]), None)
        assert found_zone is not None
        assert "bins" in found_zone
        found_bin = next((b for b in found_zone["bins"] if b["id"] == bin_data["id"]), None)
        assert found_bin is not None
        assert found_bin["bin_code"] == bin_data["bin_code"]


@pytest.mark.asyncio
async def test_putaway_completion_with_exact_bin_qr_and_validations():
    from decimal import Decimal
    from app.database.session import session_scope
    from app.modules.procurement.infrastructure.persistence.models import MaterialModel, MaterialStockModel
    from app.modules.receiving.infrastructure.persistence.models import GrnModel
    from app.modules.storage.infrastructure.persistence.models import PutawayTaskModel

    test_uid = uuid.uuid4().hex[:6].upper()
    store_id = uuid.uuid4()
    other_store_id = uuid.uuid4()
    zone_id = uuid.uuid4()
    bin_id = uuid.uuid4()
    inactive_bin_id = uuid.uuid4()
    grn_id = uuid.uuid4()
    task_id = uuid.uuid4()
    mat_code = f"MAT-BIN-{test_uid}"

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

        # 2. Zone
        zone = StoreZoneModel(
            id=zone_id,
            store_id=store.id,
            zone_code=f"ZON-{test_uid}",
            zone_name=f"Zone {test_uid}",
            status="ACTIVE",
        )
        session.add(zone)
        await session.flush()

        # 3. Active Bin & Inactive Bin
        active_bin = StoreBinModel(
            id=bin_id,
            store_id=store.id,
            zone_id=zone.id,
            bin_code=f"BIN-{zone.zone_code}-001",
            bin_name=f"Primary Bin {test_uid}",
            rack="R01",
            shelf="S01",
            capacity=Decimal("500.0"),
            occupied_quantity=Decimal("0.0"),
            status="ACTIVE",
        )
        session.add(active_bin)

        inactive_bin = StoreBinModel(
            id=inactive_bin_id,
            store_id=store.id,
            zone_id=zone.id,
            bin_code=f"BIN-{zone.zone_code}-002",
            bin_name=f"Inactive Bin {test_uid}",
            rack="R01",
            shelf="S02",
            capacity=Decimal("500.0"),
            occupied_quantity=Decimal("0.0"),
            status="INACTIVE",
        )
        session.add(inactive_bin)

        # 4. Material & MaterialStock
        mat = MaterialModel(
            id=uuid.uuid4(),
            material_code=mat_code,
            material_name=f"Material {test_uid}",
            category="RAW_MATERIALS",
            base_uom="PCS",
            status="ACTIVE",
        )
        session.add(mat)
        await session.flush()

        stock = MaterialStockModel(
            id=uuid.uuid4(),
            material_id=mat.id,
            material_code=mat_code,
            material_name=mat.material_name,
            category="RAW_MATERIALS",
            warehouse_id="WH-001",
            on_hand=Decimal("100.0"),
            available=Decimal("0.0"),
            allocated=Decimal("0.0"),
            uom="PCS",
            reorder_point=Decimal("10.0"),
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

        # 6. Putaway Task
        task = PutawayTaskModel(
            id=task_id,
            task_number=f"PT-{test_uid}",
            grn_id=grn_id,
            grn_number=f"GRN-{test_uid}",
            item_code=mat_code,
            material_name=f"Material {test_uid}",
            quantity=Decimal("10.0"),
            uom="PCS",
            warehouse_id="WH-001",
            source_location="DOCK-01",
            destination_store_id=store_id,
            status="ASSIGNED_TO_STORE",
            created_by="tester",
            created_at=datetime.datetime.now(datetime.timezone.utc),
        )
        session.add(task)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        wh_headers = {
            "X-User-Roles": "WAREHOUSE,ADMIN",
            "X-User-Name": "warehouse_user",
        }

        # 1. Try completing putaway with INACTIVE bin -> must return 409 Conflict
        res_inactive = await client.post(
            f"/api/storage/putaway-tasks/{task_id}/complete",
            json={
                "material_scan": mat_code,
                "location_scan": f"BIN-{zone.zone_code}-002",
                "quantity": 10.0,
            },
            headers=wh_headers,
        )
        assert res_inactive.status_code == 409
        assert "inactive" in res_inactive.json()["detail"].lower()

        # 2. Complete putaway with exact ACTIVE Bin QR payload -> must return 200 OK
        bin_qr_payload = json.dumps({
            "type": "BIN_QR",
            "bin_id": str(bin_id),
            "bin_code": f"BIN-{zone.zone_code}-001",
            "zone_id": str(zone_id),
            "store_id": str(store_id),
        })

        res_complete = await client.post(
            f"/api/storage/putaway-tasks/{task_id}/complete",
            json={
                "material_scan": mat_code,
                "location_scan": bin_qr_payload,
                "quantity": 10.0,
            },
            headers=wh_headers,
        )
        assert res_complete.status_code == 200
        comp_data = res_complete.json()
        assert comp_data["status"] == "PUTAWAY_COMPLETED"
        assert comp_data["destination_bin_code"] == f"BIN-{zone.zone_code}-001"
        assert comp_data["inventory_available_after"] == 10.0

        # 3. Verify target bin occupied_quantity is updated
        async with session_scope() as session:
            b_obj = await session.get(StoreBinModel, bin_id)
            assert b_obj.occupied_quantity == Decimal("10.0")

