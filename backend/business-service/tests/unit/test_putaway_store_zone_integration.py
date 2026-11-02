import datetime
import json
import uuid
from decimal import Decimal
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.database.session import AsyncSessionFactory, engine
from app.main import create_app
from app.common.persistence.models import MaterialModel, MaterialStockModel
from app.modules.storage.infrastructure.persistence.models import (
    HandlingUnitModel,
    InventoryLocationBalanceModel,
    PutawayTaskModel,
    StorageLocationModel,
)
from app.modules.warehouse.infrastructure.persistence.models import (
    UserAccountModel,
    WarehouseModel,
    WarehouseZoneModel,
)


@pytest_asyncio.fixture
async def app():
    return create_app()


@pytest_asyncio.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_putaway_destination_assignment_and_validation(client: AsyncClient):
    """Warehouse user assigns destination Warehouse and Zone to a Putaway Task with strict backend validation."""
    grn_id = uuid.uuid4()
    grn_number = f"GRN-{uuid.uuid4().hex[:6].upper()}"
    async with engine.begin() as conn:
        await conn.execute(
            text("INSERT INTO grn (id, grn_number, warehouse_id, status) VALUES (:id, :grn_num, 'Main Warehouse', 'GRN_POSTED')"),
            {"id": grn_id, "grn_num": grn_number},
        )

    async with AsyncSessionFactory() as session:
        # 1. Seed Warehouse A and Warehouse B
        warehouse_a = WarehouseModel(
            warehouse_code=f"STR-{uuid.uuid4().hex[:6].upper()}",
            warehouse_name="Mechanical Warehouse",
            warehouse_id="Main Warehouse",
            status="ACTIVE",
        )
        warehouse_b = WarehouseModel(
            warehouse_code=f"STR-{uuid.uuid4().hex[:6].upper()}",
            warehouse_name="Electrical Warehouse",
            warehouse_id="Main Warehouse",
            status="ACTIVE",
        )
        session.add_all([warehouse_a, warehouse_b])
        await session.flush()

        # 2. Seed Zones for Warehouse A and Warehouse B
        zone_a1 = WarehouseZoneModel(
            warehouse_ref_id=warehouse_a.id,
            zone_code=f"MEC-Z01-{uuid.uuid4().hex[:4].upper()}",
            zone_name="Heavy Motors Bay",
            status="ACTIVE",
        )
        zone_a_inactive = WarehouseZoneModel(
            warehouse_ref_id=warehouse_a.id,
            zone_code=f"MEC-Z02-{uuid.uuid4().hex[:4].upper()}",
            zone_name="Decommissioned Bay",
            status="INACTIVE",
        )
        zone_b1 = WarehouseZoneModel(
            warehouse_ref_id=warehouse_b.id,
            zone_code=f"ELE-Z01-{uuid.uuid4().hex[:4].upper()}",
            zone_name="Transformer Rack",
            status="ACTIVE",
        )
        session.add_all([zone_a1, zone_a_inactive, zone_b1])
        await session.flush()

        # 3. Seed Putaway Task
        task = PutawayTaskModel(
            task_number=f"PUT-{uuid.uuid4().hex[:8].upper()}",
            grn_id=grn_id,
            grn_number=grn_number,
            item_code="MOTOR-001",
            material_name="Industrial 3-Phase Motor",
            quantity=Decimal("10.0"),
            uom="PCS",
            warehouse_id="Main Warehouse",
            source_location="RECEIVING_AREA",
            status="PUTAWAY_PENDING",
            created_by="system",
            created_at=datetime.datetime.now(datetime.timezone.utc),
        )
        session.add(task)
        await session.commit()

        warehouse_a_id = str(warehouse_a.id)
        warehouse_b_id = str(warehouse_b.id)
        zone_a1_id = str(zone_a1.id)
        zone_a_inact_id = str(zone_a_inactive.id)
        zone_b1_id = str(zone_b1.id)
        task_id = str(task.id)

    headers_wh = {
        "Authorization": "Bearer mock-jwt-warehouse-token",
        "X-User-Roles": "WAREHOUSE_MANAGER,ADMIN",
        "X-User-Permissions": "gate:read,gate:verify,gate:approve",
    }

    # Test 1: Cross-warehouse mismatch (Warehouse A + Zone B1) -> Rejected 422
    resp_mismatch = await client.put(
        f"/api/storage/putaway-tasks/{task_id}/location",
        json={"warehouse_ref_id": warehouse_a_id, "zone_id": zone_b1_id},
        headers=headers_wh,
    )
    assert resp_mismatch.status_code == 422
    assert "does not belong to Warehouse" in resp_mismatch.json()["detail"]

    # Test 2: Inactive Zone (Warehouse A + Inactive Zone) -> Rejected 422
    resp_inactive = await client.put(
        f"/api/storage/putaway-tasks/{task_id}/location",
        json={"warehouse_ref_id": warehouse_a_id, "zone_id": zone_a_inact_id},
        headers=headers_wh,
    )
    assert resp_inactive.status_code == 422
    assert "inactive" in resp_inactive.json()["detail"].lower()

    # Test 3: Valid Assignment (Warehouse A + Zone A1) -> Success 200
    resp_valid = await client.put(
        f"/api/storage/putaway-tasks/{task_id}/location",
        json={"warehouse_ref_id": warehouse_a_id, "zone_id": zone_a1_id},
        headers=headers_wh,
    )
    assert resp_valid.status_code == 200
    data = resp_valid.json()
    assert data["destination_warehouse_ref_id"] == warehouse_a_id
    assert data["destination_zone_id"] == zone_a1_id
    assert data["destination_location_id"] is not None


@pytest.mark.asyncio
async def test_putaway_qr_scanning_and_completion_flow(client: AsyncClient):
    """Putaway execution validates Material QR & Zone QR, updating MaterialStock and balances."""
    po_id = uuid.uuid4()
    asn_id = uuid.uuid4()
    ge_id = uuid.uuid4()
    dock_id = uuid.uuid4()
    dock_num = f"DK-{uuid.uuid4().hex[:4].upper()}"
    da_id = uuid.uuid4()
    rl_id = uuid.uuid4()
    grn_id = uuid.uuid4()
    grn_number = f"GRN-{uuid.uuid4().hex[:6].upper()}"

    async with engine.begin() as conn:
        # 1. Supplier & Dock & Inbound chain
        sup_row = (await conn.execute(text("SELECT id FROM supplier LIMIT 1"))).first()
        if sup_row:
            sup_id = sup_row[0]
        else:
            sup_id = uuid.uuid4()
            await conn.execute(
                text("INSERT INTO supplier (id, supplier_name, registered_company_name, vendor_type, category, industry, gstin, status, created_at, updated_at) VALUES (:id, 'Global Motors Ltd', :comp, 'Manufacturer', '[\"Automotive\"]', 'Automotive', :gstin, 'Active', NOW(), NOW())"),
                {"id": sup_id, "comp": f"Global Motors {uuid.uuid4().hex[:6]}", "gstin": f"29ABCDE{uuid.uuid4().hex[:4].upper()}1Z5"},
            )

        await conn.execute(
            text("INSERT INTO warehouse_dock (id, dock_number, warehouse_id, dock_type, capacity, status, created_at, updated_at) VALUES (:id, :num, 'Main Warehouse', 'INBOUND', 1, 'AVAILABLE', NOW(), NOW())"),
            {"id": dock_id, "num": dock_num},
        )
        await conn.execute(
            text("INSERT INTO purchase_order (id, po_number, supplier_id, status, po_date, created_at) VALUES (:id, :po_num, :sup_id, 'APPROVED', CURRENT_DATE, NOW())"),
            {"id": po_id, "po_num": f"PO-{uuid.uuid4().hex[:6].upper()}", "sup_id": sup_id},
        )
        await conn.execute(
            text("INSERT INTO asn (id, asn_number, po_number, status, warehouse_id, shipment_date, created_at) VALUES (:id, :asn_num, 'PO-2026-001', 'APPROVED', 'Main Warehouse', CURRENT_DATE, NOW())"),
            {"id": asn_id, "asn_num": f"ASN-{uuid.uuid4().hex[:6].upper()}"},
        )
        await conn.execute(
            text("INSERT INTO gate_entry (id, gate_entry_number, po_number, vehicle_number, driver_name, po_document_path, status, security_officer_id, created_at, updated_at) VALUES (:id, :ge_num, 'PO-2026-001', 'KA-01-AB-1234', 'Ramesh', '/tmp/po.pdf', 'COMPLETED', 'sec-01', NOW(), NOW())"),
            {"id": ge_id, "ge_num": f"GE-{uuid.uuid4().hex[:6].upper()}"},
        )
        await conn.execute(
            text("INSERT INTO dock_assignment (id, gate_entry_id, asn_id, po_id, vehicle_number, dock_number, assigned_by, assigned_at) VALUES (:id, :ge_id, :asn_id, :po_id, 'KA-01-AB-1234', :dock_num, 'system', NOW())"),
            {"id": da_id, "ge_id": ge_id, "asn_id": asn_id, "po_id": po_id, "dock_num": dock_num},
        )
        await conn.execute(
            text("INSERT INTO receiving_line (id, dock_assignment_id, item_code, material_name, ordered_quantity, shipped_quantity, received_quantity, good_quantity, exception_quantity, verification_status, recorded_by, recorded_at) VALUES (:id, :da_id, 'MOTOR-001', 'Industrial Motor', 10, 10, 10, 10, 0, 'VERIFIED', 'system', NOW())"),
            {"id": rl_id, "da_id": da_id},
        )
        await conn.execute(
            text("INSERT INTO grn (id, grn_number, warehouse_id, status) VALUES (:id, :grn_num, 'Main Warehouse', 'GRN_POSTED')"),
            {"id": grn_id, "grn_num": grn_number},
        )

    async with AsyncSessionFactory() as session:
        # 2. Seed Warehouse and Zone
        warehouse = WarehouseModel(
            warehouse_code=f"STR-{uuid.uuid4().hex[:6].upper()}",
            warehouse_name="Mechanical Warehouse",
            warehouse_id="Main Warehouse",
            status="ACTIVE",
        )
        session.add(warehouse)
        await session.flush()

        zone = WarehouseZoneModel(
            warehouse_ref_id=warehouse.id,
            zone_code=f"MEC-Z10-{uuid.uuid4().hex[:4].upper()}",
            zone_name="Heavy Machinery Section",
            status="ACTIVE",
        )
        other_warehouse = WarehouseModel(
            warehouse_code=f"STR-{uuid.uuid4().hex[:6].upper()}",
            warehouse_name="Other Warehouse",
            warehouse_id="Main Warehouse",
            status="ACTIVE",
        )
        session.add(other_warehouse)
        await session.flush()

        other_zone = WarehouseZoneModel(
            warehouse_ref_id=other_warehouse.id,
            zone_code=f"OTH-Z99-{uuid.uuid4().hex[:4].upper()}",
            zone_name="Wrong Zone",
            status="ACTIVE",
        )
        session.add_all([zone, other_zone])
        await session.flush()

        bin_obj = StoreBinModel(
            store_id=store.id,
            zone_id=zone.id,
            bin_code=f"BIN-MEC-{uuid.uuid4().hex[:5].upper()}",
            bin_name="Mechanical Putaway Bin",
            rack="R01",
            shelf="S01",
            capacity=Decimal("500.0"),
            occupied_quantity=Decimal("0.0"),
            status="ACTIVE",
        )
        session.add(bin_obj)
        await session.flush()

        mat_code = f"MOT-{uuid.uuid4().hex[:6].upper()}"

        session.add(GrnLineModel(
            grn_id=grn_id,
            item_code=mat_code,
            material_name="Industrial Motor",
            uom="PCS",
            ordered_quantity=Decimal("10.0"),
            received_quantity=Decimal("10.0"),
            accepted_quantity=Decimal("10.0"),
            good_quantity=Decimal("10.0"),
            damaged_quantity=Decimal("0.0"),
        ))

        # 3. Seed Handling Unit (Material QR payload)
        hu_number = f"HU-{uuid.uuid4().hex[:8].upper()}"
        hu = HandlingUnitModel(
            hu_number=hu_number,
            barcode_value=hu_number,
            receiving_line_id=rl_id,
            grn_line_id=None,
            item_code=mat_code,
            material_name="Industrial Motor",
            quantity=Decimal("10.0"),
            uom="PCS",
            supplier_name="Global Motors Ltd",
            po_number="PO-2026-001",
            asn_number="ASN-2026-001",
            grn_number=grn_number,
            warehouse_id="Main Warehouse",
            current_location="RECEIVING_AREA",
            status="PUTAWAY_PENDING",
            generated_by="system",
            generated_at=datetime.datetime.now(datetime.timezone.utc),
            updated_at=datetime.datetime.now(datetime.timezone.utc),
        )
        session.add(hu)
        await session.flush()

        # 4. Seed Material Stock Record
        stock = MaterialStockModel(
            material_code=mat_code,
            material_name="Industrial Motor",
            category="Mechanical",
            on_hand=Decimal("10.0"),
            allocated=Decimal("0.0"),
            available=Decimal("0.0"),
            uom="PCS",
            warehouse_id="Main Warehouse",
            reorder_point=Decimal("5.0"),
        )
        session.add(stock)
        session.add(MaterialModel(
            material_code=mat_code,
            material_name="Industrial Motor",
            category="Mechanical",
            base_uom="PCS",
            status="Active",
        ))

        # 5. Seed Putaway Task assigned to Warehouse + Zone
        task = PutawayTaskModel(
            task_number=f"PUT-{uuid.uuid4().hex[:8].upper()}",
            grn_id=grn_id,
            grn_number=grn_number,
            handling_unit_id=hu.id,
            item_code=mat_code,
            material_name="Industrial Motor",
            quantity=Decimal("10.0"),
            uom="PCS",
            warehouse_id="Main Warehouse",
            source_location="RECEIVING_AREA",
            destination_warehouse_ref_id=warehouse.id,
            destination_zone_id=zone.id,
            destination_zone=zone.zone_code,
            destination_bin_id=bin_obj.id,
            destination_bin=bin_obj.bin_code,
            destination_bin_code=bin_obj.bin_code,
            status="PUTAWAY_PENDING",
            created_by="system",
            created_at=datetime.datetime.now(datetime.timezone.utc),
        )
        session.add(task)
        await session.commit()

        task_id = str(task.id)
        hu_val = hu_number
        zone_id = str(zone.id)
        zone_code = zone.zone_code
        bin_id = str(bin_obj.id)
        bin_code = bin_obj.bin_code
        other_zone_code = other_zone.zone_code
        warehouse_ref_id = str(warehouse.id)
        warehouse_code = warehouse.warehouse_code

    headers_wh = {
        "Authorization": "Bearer mock-jwt-warehouse-token",
        "X-User-Roles": "WAREHOUSE_MANAGER,ADMIN",
        "X-User-Permissions": "gate:read,gate:verify,gate:approve,storage:write",
    }
    headers_keeper = {
        "Authorization": "Bearer mock-jwt-warehouse-operator-token",
        "X-User-Roles": "WAREHOUSE_OPERATOR",
        "X-User-Permissions": "warehouse:read,storage:read,putaway:execute",
        "X-Warehouse-Id": warehouse_ref_id,
        "X-Warehouse-Code": warehouse_code,
    }

    # Assign location to ensure storage_location exists
    assign_resp = await client.put(
        f"/api/storage/putaway-tasks/{task_id}/location",
        json={"warehouse_ref_id": warehouse_ref_id, "zone_id": zone_id},
        headers=headers_wh,
    )
    assert assign_resp.status_code == 200

    # Start Putaway as Warehouse Operator
    start_resp = await client.post(f"/api/storage/putaway-tasks/{task_id}/start", headers=headers_keeper)
    assert start_resp.status_code == 200
    assert start_resp.json()["status"] == "IN_PROGRESS"

    # Test 1: Invalid Material QR -> Rejected 422
    resp_bad_mat = await client.post(
        f"/api/storage/putaway-tasks/{task_id}/complete",
        json={
            "material_scan": "INVALID-HU-999",
            "location_scan": bin_code,
            "quantity": 10.0,
        },
        headers=headers_keeper,
    )
    assert resp_bad_mat.status_code == 422
    assert "Material QR does not match" in resp_bad_mat.json()["detail"]

    # Test 2: Mismatched Zone QR (belongs to other warehouse) -> Rejected 422
    resp_bad_zone = await client.post(
        f"/api/storage/putaway-tasks/{task_id}/complete",
        json={
            "material_scan": hu_val,
            "location_scan": other_zone_code,
            "quantity": 10.0,
        },
        headers=headers_keeper,
    )
    assert resp_bad_zone.status_code == 422
    assert "does not belong" in resp_bad_zone.json()["detail"].lower()

    # Test 3: Over-quantity rejection -> Rejected 422
    resp_over_qty = await client.post(
        f"/api/storage/putaway-tasks/{task_id}/complete",
        json={
            "material_scan": hu_val,
            "location_scan": bin_code,
            "quantity": 15.0,
        },
        headers=headers_keeper,
    )
    assert resp_over_qty.status_code == 422, resp_over_qty.text
    assert "exceeds" in resp_over_qty.json()["detail"].lower()

    # Test 4: Valid Putaway with structured Phase 4 Zone QR JSON payload
    zone_qr_payload = json.dumps({
        "type": "BIN_QR",
        "bin_code": bin_code,
        "zone_id": zone_id,
        "zone_code": zone_code,
        "warehouse_ref_id": warehouse_ref_id,
        "warehouse_code": warehouse_code,
        "warehouse_id": "Main Warehouse",
        "status": "ACTIVE",
    })
    material_qr_payload = json.dumps({
        "hu_number": hu_val,
        "barcode_value": hu_val,
        "item_code": mat_code,
    })

    resp_complete = await client.post(
        f"/api/storage/putaway-tasks/{task_id}/complete",
        json={
            "material_scan": material_qr_payload,
            "location_scan": bin_code,
            "quantity": 10.0,
        },
        headers=headers_keeper,
    )
    assert resp_complete.status_code == 200, resp_complete.text
    comp_data = resp_complete.json()
    assert comp_data["status"] == "COMPLETED"
    assert comp_data["inventory_available_after"] >= 10.0

    # Test 5: Attempting to complete an already completed task -> Rejected 409
    resp_already_done = await client.post(
        f"/api/storage/putaway-tasks/{task_id}/complete",
        json={
            "material_scan": material_qr_payload,
            "location_scan": bin_code,
            "quantity": 10.0,
        },
        headers=headers_keeper,
    )
    assert resp_already_done.status_code == 409
    assert "already completed" in resp_already_done.json()["detail"].lower()


@pytest.mark.asyncio
async def test_inventory_locations_enriched_with_warehouse_and_zone(client: AsyncClient):
    """GET /api/storage/putaway-tasks/inventory-locations returns Warehouse and Zone details."""
    headers_wh = {
        "Authorization": "Bearer mock-jwt-warehouse-token",
        "X-User-Roles": "WAREHOUSE_MANAGER",
        "X-User-Permissions": "gate:read",
    }
    resp = await client.get("/api/storage/putaway-tasks/inventory-locations", headers=headers_wh)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    if len(data) > 0:
        loc = data[0]
        assert "material_code" in loc
        assert "storage_location_id" in loc
        assert "quantity" in loc
        assert "available_quantity" in loc
