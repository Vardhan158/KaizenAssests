"""
Unit tests for Phase 4: Zone QR generation, Zone Scan Lookup, Physical Storage Location Foundation,
Store Manager Zone Isolation, and Warehouse Global Access.
"""
import json
import uuid
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.database.session import AsyncSessionFactory
from app.main import create_app
from app.modules.store.infrastructure.persistence.models import (
    StoreManagerUserModel,
    StoreModel,
    StoreZoneModel,
)


@pytest_asyncio.fixture
async def app():
    return create_app()


@pytest_asyncio.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def phase4_seeded_data():
    """Seed test Stores, Zones, and Store Managers for Phase 4 testing."""
    async with AsyncSessionFactory() as session:
        # 1. Electrical Store (STR-001)
        s1_res = await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-001"))
        s1 = s1_res.scalar_one_or_none()
        if not s1:
            s1 = StoreModel(
                id=uuid.uuid4(),
                store_code="STR-001",
                store_name="Electrical Store",
                warehouse_id="Main Warehouse",
                store_manager_id="EMP-STORE-001",
                store_manager_name="John Doe (Electrical)",
                status="ACTIVE",
            )
            session.add(s1)
            await session.flush()

        # Electrical Zone
        z1_res = await session.execute(
            select(StoreZoneModel).where(StoreZoneModel.store_id == s1.id, StoreZoneModel.zone_code == "ELEC-Z01")
        )
        z1 = z1_res.scalar_one_or_none()
        if not z1:
            z1 = StoreZoneModel(
                id=uuid.uuid4(),
                store_id=s1.id,
                zone_code="ELEC-Z01",
                zone_name="Cable & Switchgear Zone",
                description="High voltage cable storage",
                status="ACTIVE",
            )
            session.add(z1)
            await session.flush()

        # Electrical Manager
        m1_res = await session.execute(
            select(StoreManagerUserModel).where(StoreManagerUserModel.employee_id == "EMP-STORE-001")
        )
        m1 = m1_res.scalar_one_or_none()
        if not m1:
            import hashlib
            m1 = StoreManagerUserModel(
                id=uuid.uuid4(),
                store_id=s1.id,
                employee_id="EMP-STORE-001",
                username="store_manager_elec",
                full_name="John Doe (Electrical)",
                email="john.electrical@wms.local",
                password_hash=hashlib.sha256("password".encode()).hexdigest(),
                status="ACTIVE",
            )
            session.add(m1)
            await session.flush()

        # 2. Chemical Store (STR-003)
        s3_res = await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-003"))
        s3 = s3_res.scalar_one_or_none()
        if not s3:
            s3 = StoreModel(
                id=uuid.uuid4(),
                store_code="STR-003",
                store_name="Chemical Store",
                warehouse_id="Main Warehouse",
                store_manager_id="EMP-STORE-003",
                store_manager_name="Chemical_manager",
                status="ACTIVE",
            )
            session.add(s3)
            await session.flush()

        # Chemical Manager
        m3_res = await session.execute(
            select(StoreManagerUserModel).where(StoreManagerUserModel.employee_id == "EMP-STORE-003")
        )
        m3 = m3_res.scalar_one_or_none()
        if not m3:
            import hashlib
            m3 = StoreManagerUserModel(
                id=uuid.uuid4(),
                store_id=s3.id,
                employee_id="EMP-STORE-003",
                username="store_mgr_chem",
                full_name="Chemical_manager",
                email="chem.manager@wms.local",
                password_hash=hashlib.sha256("password".encode()).hexdigest(),
                status="ACTIVE",
            )
            session.add(m3)
            await session.flush()

        await session.commit()
        return {"elec_store": s1, "elec_zone": z1, "elec_mgr": m1, "chem_store": s3, "chem_mgr": m3}


@pytest.mark.asyncio
async def test_store_manager_zone_creation_with_custom_and_auto_code(client: AsyncClient, phase4_seeded_data):
    """Store Manager can create a Zone with custom code or auto-code in their own store, but is blocked from other stores."""
    chem_store = phase4_seeded_data["chem_store"]
    elec_store = phase4_seeded_data["elec_store"]
    chem_mgr = phase4_seeded_data["chem_mgr"]

    headers_chem = {"Authorization": f"Bearer mock-jwt-store-manager-{chem_mgr.employee_id}"}

    # 1. Chemical Manager creates Zone with custom code CHEM-Z01 in Chemical Store -> 201 Created
    custom_code = f"CHEM-Z01-{uuid.uuid4().hex[:4].upper()}"
    resp_create_custom = await client.post(
        f"/api/v1/stores/{chem_store.id}/zones",
        json={"zone_name": "Chemical Storage Bay", "zone_code": custom_code, "description": "Hazmat storage"},
        headers=headers_chem,
    )
    assert resp_create_custom.status_code == 201
    zone_custom = resp_create_custom.json()
    assert zone_custom["zone_code"] == custom_code
    assert zone_custom["store_id"] == str(chem_store.id)

    # 2. Chemical Manager creates Zone without custom code (auto-generated) -> 201 Created
    resp_create_auto = await client.post(
        f"/api/v1/stores/{chem_store.id}/zones",
        json={"zone_name": "Solvent Storage Area"},
        headers=headers_chem,
    )
    assert resp_create_auto.status_code == 201
    zone_auto = resp_create_auto.json()
    assert zone_auto["zone_code"].startswith(chem_store.store_code)
    assert zone_auto["store_id"] == str(chem_store.id)

    # 3. Chemical Manager attempts to create Zone in Electrical Store -> 403 Forbidden
    resp_cross_create = await client.post(
        f"/api/v1/stores/{elec_store.id}/zones",
        json={"zone_name": "Unauthorized Electrical Zone"},
        headers=headers_chem,
    )
    assert resp_cross_create.status_code == 403


@pytest.mark.asyncio
async def test_zone_qr_generation_and_idor_protection(client: AsyncClient, phase4_seeded_data):
    """Store Manager can generate QR for own Zone, but receives 403 for another Store's Zone."""
    chem_store = phase4_seeded_data["chem_store"]
    elec_store = phase4_seeded_data["elec_store"]
    elec_zone = phase4_seeded_data["elec_zone"]
    chem_mgr = phase4_seeded_data["chem_mgr"]

    headers_chem = {"Authorization": f"Bearer mock-jwt-store-manager-{chem_mgr.employee_id}"}

    # 1. Create a zone in Chemical store
    resp_create = await client.post(
        f"/api/v1/stores/{chem_store.id}/zones",
        json={"zone_name": "Acids and Bases Area", "zone_code": f"ACID-{uuid.uuid4().hex[:4].upper()}"},
        headers=headers_chem,
    )
    assert resp_create.status_code == 201
    chem_zone = resp_create.json()

    # 2. Chemical Manager generates QR for own zone via /api/v1/zones/{id}/qr -> 200 OK
    resp_qr = await client.get(f"/api/v1/zones/{chem_zone['id']}/qr", headers=headers_chem)
    assert resp_qr.status_code == 200
    qr_data = resp_qr.json()
    assert qr_data["zone_id"] == chem_zone["id"]
    assert qr_data["zone_code"] == chem_zone["zone_code"]
    assert qr_data["store_id"] == str(chem_store.id)
    assert qr_data["store_code"] == chem_store.store_code
    assert "qr_payload" in qr_data

    # Parse payload JSON to verify valid structure
    parsed_payload = json.loads(qr_data["qr_payload"])
    assert parsed_payload["type"] == "ZONE_QR"
    assert parsed_payload["zone_id"] == chem_zone["id"]
    assert parsed_payload["store_code"] == chem_store.store_code

    # 3. Chemical Manager generates QR via store subresource endpoint -> 200 OK
    resp_store_qr = await client.get(
        f"/api/v1/stores/{chem_store.id}/zones/{chem_zone['id']}/qr", headers=headers_chem
    )
    assert resp_store_qr.status_code == 200

    # 4. Chemical Manager attempts to generate QR for Electrical Zone -> 403 Forbidden
    resp_cross_qr = await client.get(f"/api/v1/zones/{elec_zone.id}/qr", headers=headers_chem)
    assert resp_cross_qr.status_code == 403

    # 5. Chemical Manager attempts to access store subresource for Electrical Store -> 403 Forbidden
    resp_cross_store_qr = await client.get(
        f"/api/v1/stores/{elec_store.id}/zones/{elec_zone.id}/qr", headers=headers_chem
    )
    assert resp_cross_store_qr.status_code == 403


@pytest.mark.asyncio
async def test_zone_qr_scan_lookup_security(client: AsyncClient, phase4_seeded_data):
    """Server-side scan lookup validates authorization against scanned zone's store."""
    chem_store = phase4_seeded_data["chem_store"]
    elec_zone = phase4_seeded_data["elec_zone"]
    chem_mgr = phase4_seeded_data["chem_mgr"]

    headers_chem = {"Authorization": f"Bearer mock-jwt-store-manager-{chem_mgr.employee_id}"}

    # 1. Create a zone in Chemical store
    resp_create = await client.post(
        f"/api/v1/stores/{chem_store.id}/zones",
        json={"zone_name": "Gas Cylinders Zone", "zone_code": f"GAS-{uuid.uuid4().hex[:4].upper()}"},
        headers=headers_chem,
    )
    chem_zone = resp_create.json()

    # 2. Get QR payload for chemical zone
    qr_resp = await client.get(f"/api/v1/zones/{chem_zone['id']}/qr", headers=headers_chem)
    qr_payload = qr_resp.json()["qr_payload"]

    # 3. Scan own QR payload -> 200 OK
    scan_own = await client.post("/api/v1/zones/scan-lookup", json={"scan_value": qr_payload}, headers=headers_chem)
    assert scan_own.status_code == 200
    assert scan_own.json()["zone_id"] == chem_zone["id"]

    # 4. Scan own Zone UUID directly -> 200 OK
    scan_uuid = await client.post("/api/v1/zones/scan-lookup", json={"scan_value": chem_zone["id"]}, headers=headers_chem)
    assert scan_uuid.status_code == 200

    # 5. Chemical Manager scans Electrical Zone UUID -> 403 Forbidden
    scan_cross = await client.post("/api/v1/zones/scan-lookup", json={"scan_value": str(elec_zone.id)}, headers=headers_chem)
    assert scan_cross.status_code == 403

    # 6. Non-existent zone scan -> 404 Not Found
    scan_invalid = await client.post(
        "/api/v1/zones/scan-lookup", json={"scan_value": str(uuid.uuid4())}, headers=headers_chem
    )
    assert scan_invalid.status_code == 404


@pytest.mark.asyncio
async def test_warehouse_global_zone_and_qr_access(client: AsyncClient, phase4_seeded_data):
    """Warehouse user has global visibility across all stores, zones, and can generate QR for any zone."""
    chem_store = phase4_seeded_data["chem_store"]
    elec_zone = phase4_seeded_data["elec_zone"]
    headers_wh = {"Authorization": "Bearer mock-jwt-warehouse-token"}

    # 1. Warehouse user views all stores
    resp_stores = await client.get("/api/v1/stores", headers=headers_wh)
    assert resp_stores.status_code == 200
    assert len(resp_stores.json()) >= 2

    # 2. Warehouse user views Electrical Zone details
    resp_zone = await client.get(f"/api/v1/zones/{elec_zone.id}", headers=headers_wh)
    assert resp_zone.status_code == 200

    # 3. Warehouse user generates QR for Electrical Zone
    resp_elec_qr = await client.get(f"/api/v1/zones/{elec_zone.id}/qr", headers=headers_wh)
    assert resp_elec_qr.status_code == 200

    # 4. Warehouse user scans lookup for any zone
    resp_scan = await client.post(
        "/api/v1/zones/scan-lookup", json={"scan_value": str(elec_zone.id)}, headers=headers_wh
    )
    assert resp_scan.status_code == 200
    assert resp_scan.json()["zone_id"] == str(elec_zone.id)


@pytest.mark.asyncio
async def test_storage_location_and_putaway_integration(client: AsyncClient):
    """Storage location and Putaway endpoints continue working seamlessly."""
    headers_wh = {"Authorization": "Bearer mock-jwt-warehouse-token"}

    # 1. Storage locations list endpoint
    resp_locs = await client.get("/api/storage/putaway-tasks/locations", headers=headers_wh)
    assert resp_locs.status_code == 200

    # 2. Inventory location balances endpoint
    resp_inv = await client.get("/api/storage/putaway-tasks/inventory-locations", headers=headers_wh)
    assert resp_inv.status_code == 200

    # 3. Gate entries inventory transactions
    resp_tx = await client.get("/api/gate-entries/inventory-transactions", headers=headers_wh)
    assert resp_tx.status_code == 200
