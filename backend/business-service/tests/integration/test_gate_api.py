"""
Integration tests for FastAPI REST APIs:
- Gate Entry ANPR & OCR Preview (/api/gate/anpr-ocr-preview)
- Gate Entry Creation & Duplicate Prevention (/api/gate-entries)
- Gate Entry Verification/Approval (/api/gate-entries/{id}/verify)
- Gate Entry Retrieval (/api/gate-entries/{id})
- Reset Dev Entries (/api/gate-entries/reset-dev-entries)
- Receiving GRN Confirmation & Lookup (/api/receiving/grn)
- Health and Ops Endpoints (/health, /health/ready)
"""
import base64
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as ac:
        yield ac


import io
from PIL import Image

def make_dummy_image_base64() -> str:
    img = Image.new("RGB", (100, 100), color="white")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")



@pytest.mark.anyio
async def test_health_endpoints(client: AsyncClient):
    """Verify system health and readiness endpoints."""
    res_health = await client.get("/health")
    assert res_health.status_code == 200
    data = res_health.json()
    assert data["status"] == "UP"
    assert "service" in data

    res_ready = await client.get("/health/ready")
    assert res_ready.status_code == 200
    assert res_ready.json() == {"status": "READY"}


@pytest.mark.anyio
async def test_anpr_ocr_preview_full_match(client: AsyncClient):
    """Test /api/gate/po-ocr-preview with matched PO returning PO_VERIFIED status."""
    img_b64 = make_dummy_image_base64()
    payload = {
        "poNumberOverride": "PO-1001",
        "documentImageBase64": img_b64,
    }

    response = await client.post("/api/gate/po-ocr-preview", json=payload)
    assert response.status_code == 200, f"Preview failed: {response.text}"
    data = response.json()

    assert data["computedStatus"] == "PO_VERIFIED"
    assert len(data["mismatchedFields"]) == 0
    assert data["ocrResult"]["poNumber"] == "PO-1001"
    assert data["poRecord"]["poNumber"] == "PO-1001"


@pytest.mark.anyio
async def test_purchase_order_lookup_endpoint(client: AsyncClient):
    """Verify /api/gate/test/purchase-orders returns stored PO records."""
    response = await client.get("/api/gate/test/purchase-orders")
    assert response.status_code == 200, f"PO List failed: {response.text}"
    records = response.json()
    assert isinstance(records, list)
    po_numbers = [r["poNumber"] for r in records]
    assert "PO-1001" in po_numbers



@pytest.mark.anyio
async def test_anpr_ocr_preview_unscheduled_arrival(client: AsyncClient):
    """Test preview with unknown PO triggering UNSCHEDULED_ARRIVAL."""
    img_b64 = make_dummy_image_base64()
    payload = {
        "poNumberOverride": "PO-UNKNOWN-9999",
        "documentImageBase64": img_b64,
    }

    response = await client.post("/api/gate/po-ocr-preview", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["computedStatus"] == "UNSCHEDULED_ARRIVAL"
    assert data["poRecord"] is None


@pytest.mark.anyio
async def test_gate_entry_lifecycle_create_verify_lookup(client: AsyncClient):
    """Test full Gate Entry lifecycle: Reset -> Create -> Lookup -> Supervisor Approval."""
    # 1. Reset dev entries
    reset_res = await client.post("/api/gate-entries/reset-dev-entries")
    assert reset_res.status_code == 200

    # 2. Create Gate Entry
    img_b64 = make_dummy_image_base64()
    create_payload = {
        "vehiclePlate": "KA-05-MN-5678",
        "poNumber": "PO-1001",
        "documentImageBase64": img_b64,
    }

    create_res = await client.post("/api/gate-entries", json=create_payload)
    assert create_res.status_code == 201, f"Create failed: {create_res.text}"
    created_data = create_res.json()

    entry_id = created_data["id"]
    gate_entry_number = created_data["gateEntryNumber"]
    assert entry_id is not None
    assert gate_entry_number.startswith("GE-")
    assert created_data["vehiclePlate"] == "KA-05-MN-5678"
    assert created_data["poNumber"] == "PO-1001"
    assert created_data["status"] == "PO_VERIFIED"
    assert created_data["ocrResult"] is not None


    # 3. Lookup Gate Entry by ID
    get_res = await client.get(f"/api/gate-entries/{entry_id}")
    assert get_res.status_code == 200
    fetched_data = get_res.json()
    assert fetched_data["id"] == entry_id
    assert fetched_data["gateEntryNumber"] == gate_entry_number

    # 4. Supervisor Verification (APPROVE)
    verify_payload = {
        "action": "APPROVE",
        "remarks": "Driver credentials and physical seal intact",
        "reason": "Security protocol checklist complete",
    }
    verify_res = await client.post(f"/api/gate-entries/{entry_id}/verify", json=verify_payload)
    assert verify_res.status_code == 200
    verified_data = verify_res.json()
    assert verified_data["status"] == "APPROVED"
    assert verified_data["verifiedBy"] is not None


@pytest.mark.anyio
async def test_duplicate_active_gate_entry_rejection(client: AsyncClient):
    """Test that creating a second active Gate Entry for the same PO is rejected with HTTP 400, while same vehicle with different PO succeeds."""
    # 1. Reset state
    await client.post("/api/gate-entries/reset-dev-entries")

    img_b64 = make_dummy_image_base64()
    payload = {
        "vehiclePlate": "TS-09-EA-1122",
        "poNumber": "PO-1003",
        "anprImageBase64": img_b64,
        "documentImageBase64": img_b64,
    }

    # 2. First creation succeeds
    res1 = await client.post("/api/gate-entries", json=payload)
    assert res1.status_code == 201

    # 3. Duplicate PO creation attempt fails with 400 Bad Request
    res2 = await client.post("/api/gate-entries", json=payload)
    assert res2.status_code == 400
    err_data = res2.json()
    assert "Active gate entry attempt" in err_data["message"]

    # 4. Same vehicle with different PO succeeds with 201 Created
    payload_diff_po = {
        "vehiclePlate": "TS-09-EA-1122",
        "poNumber": "PO-1003-DIFF",
        "anprImageBase64": img_b64,
        "documentImageBase64": img_b64,
    }
    res3 = await client.post("/api/gate-entries", json=payload_diff_po)
    assert res3.status_code == 201


@pytest.mark.anyio
async def test_supervisor_rejection_flow(client: AsyncClient):
    """Test supervisor rejection workflow."""
    await client.post("/api/gate-entries/reset-dev-entries")

    img_b64 = make_dummy_image_base64()
    create_payload = {
        "vehiclePlate": "TN-01-ZZ-9988",
        "poNumber": "PO-1004",
        "anprImageBase64": img_b64,
        "documentImageBase64": img_b64,
    }

    create_res = await client.post("/api/gate-entries", json=create_payload)
    assert create_res.status_code == 201
    entry_id = create_res.json()["id"]

    reject_payload = {
        "action": "REJECT",
        "remarks": "Tampered seal detected on cargo container",
        "reason": "Security protocol violation",
    }
    reject_res = await client.post(f"/api/gate-entries/{entry_id}/verify", json=reject_payload)
    assert reject_res.status_code == 200
    data = reject_res.json()
    assert data["status"] == "REJECTED"


@pytest.mark.anyio
async def test_verify_gate_entry_move_to_unscheduled(client: AsyncClient):
    """Test /api/gate-entries/{entry_id}/verify with UNSCHEDULED_ARRIVAL action."""
    await client.post("/api/gate-entries/reset-dev-entries")

    img_b64 = make_dummy_image_base64()
    create_payload = {
        "vehiclePlate": "MH-04-XX-1122",
        "poNumber": "PO-1005",
        "documentImageBase64": img_b64,
    }

    create_res = await client.post("/api/gate-entries", json=create_payload)
    assert create_res.status_code == 201
    entry_id = create_res.json()["id"]

    verify_payload = {
        "action": "UNSCHEDULED_ARRIVAL",
        "remarks": "Reclassified as unscheduled arrival after pending review",
        "reason": "Supervisor override",
    }
    verify_res = await client.post(f"/api/gate-entries/{entry_id}/verify", json=verify_payload)
    assert verify_res.status_code == 200
    data = verify_res.json()
    assert data["status"] == "UNSCHEDULED_ARRIVAL"



@pytest.mark.anyio
async def test_ocr_scan_endpoint(client: AsyncClient):
    """Test /api/gate/ocr/scan endpoint returns structured preview JSON."""
    img_b64 = make_dummy_image_base64()
    res = await client.post("/api/gate/ocr/scan", json={"documentImageBase64": img_b64})
    assert res.status_code == 200
    data = res.json()
    assert "ocrResult" in data
    assert "computedStatus" in data
