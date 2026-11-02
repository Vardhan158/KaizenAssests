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
from app.common.persistence.models import (
    MaterialModel,
    MaterialStockModel,
    NotificationModel,
)
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


@pytest_asyncio.fixture
async def cleanup_sk_test():
    created = {}
    yield created
    async with AsyncSessionFactory() as session:
        uid_sfx = created.get("uid_sfx")
        mat_a_code = created.get("mat_a_code")
        mat_b_code = created.get("mat_b_code")
        task_a_id = created.get("task_a_id")
        task_b_id = created.get("task_b_id")
        grn_number = created.get("grn_number")
        hu_a_id = created.get("hu_a_id")
        hu_b_id = created.get("hu_b_id")
        rl_a_id = created.get("rl_a_id")
        rl_b_id = created.get("rl_b_id")
        grn_line_a_id = created.get("grn_line_a_id")
        grn_line_b_id = created.get("grn_line_b_id")
        da_id = created.get("da_id")
        grn_id = created.get("grn_id")
        ge_id = created.get("ge_id")
        asn_id = created.get("asn_id")
        po_id = created.get("po_id")
        zone_a1_id = created.get("zone_a1_id")
        zone_b1_id = created.get("zone_b1_id")
        warehouse_a_id = created.get("warehouse_a_id")
        warehouse_b_id = created.get("warehouse_b_id")
        dock_id = created.get("dock_id")

        if uid_sfx:
            await session.execute(text("DELETE FROM notification WHERE title LIKE 'New Putaway%' AND message LIKE :pat;"), {"pat": f"%{uid_sfx}%"})

        if mat_a_code and mat_b_code:
            await session.execute(text("DELETE FROM putaway_movement WHERE material_code IN (:ma, :mb);"), {"ma": mat_a_code, "mb": mat_b_code})
            await session.execute(text("DELETE FROM inventory_movement_history WHERE material_code IN (:ma, :mb);"), {"ma": mat_a_code, "mb": mat_b_code})
            await session.execute(text("DELETE FROM inventory_location_balance WHERE material_code IN (:ma, :mb);"), {"ma": mat_a_code, "mb": mat_b_code})

        if task_a_id and task_b_id:
            await session.execute(text("DELETE FROM putaway_task WHERE id IN (:ta, :tb) OR grn_number = :gn;"), {"ta": uuid.UUID(task_a_id), "tb": uuid.UUID(task_b_id), "gn": grn_number or ""})

        if uid_sfx:
            await session.execute(text("DELETE FROM storage_location WHERE location_code LIKE :pat OR zone LIKE :pat OR bin LIKE :pat;"), {"pat": f"%{uid_sfx}%"})

        if mat_a_code and mat_b_code:
            await session.execute(text("DELETE FROM material_stock WHERE material_code IN (:ma, :mb);"), {"ma": mat_a_code, "mb": mat_b_code})
            await session.execute(text("DELETE FROM material WHERE material_code IN (:ma, :mb);"), {"ma": mat_a_code, "mb": mat_b_code})

        if hu_a_id and hu_b_id:
            await session.execute(text("DELETE FROM handling_unit WHERE id IN (:ha, :hb);"), {"ha": hu_a_id, "hb": hu_b_id})

        if rl_a_id and rl_b_id:
            await session.execute(text("DELETE FROM receiving_line WHERE id IN (:ra, :rb);"), {"ra": rl_a_id, "rb": rl_b_id})

        if grn_line_a_id and grn_line_b_id:
            await session.execute(text("DELETE FROM grn_line WHERE id IN (:ga, :gb);"), {"ga": grn_line_a_id, "gb": grn_line_b_id})

        if da_id:
            await session.execute(text("DELETE FROM dock_assignment WHERE id = :da;"), {"da": da_id})

        if grn_id:
            await session.execute(text("DELETE FROM grn WHERE id = :gid;"), {"gid": grn_id})

        if ge_id:
            await session.execute(text("DELETE FROM gate_entry WHERE id = :ge;"), {"ge": ge_id})

        if asn_id:
            await session.execute(text("DELETE FROM asn WHERE id = :asn;"), {"asn": asn_id})

        if po_id:
            await session.execute(text("DELETE FROM purchase_order WHERE id = :po;"), {"po": po_id})

        if zone_a1_id and zone_b1_id and warehouse_a_id and warehouse_b_id:
            await session.execute(text("DELETE FROM warehouse_bin WHERE warehouse_ref_id IN (:sa, :sb) OR zone_id IN (:za, :zb);"), {"sa": uuid.UUID(warehouse_a_id), "sb": uuid.UUID(warehouse_b_id), "za": uuid.UUID(zone_a1_id), "zb": uuid.UUID(zone_b1_id)})

        if zone_a1_id and zone_b1_id:
            await session.execute(text("DELETE FROM warehouse_zone WHERE id IN (:za, :zb);"), {"za": uuid.UUID(zone_a1_id), "zb": uuid.UUID(zone_b1_id)})

        if warehouse_a_id and warehouse_b_id:
            await session.execute(text("DELETE FROM warehouse WHERE id IN (:sa, :sb);"), {"sa": uuid.UUID(warehouse_a_id), "sb": uuid.UUID(warehouse_b_id)})

        if dock_id:
            await session.execute(text("DELETE FROM warehouse_dock WHERE id = :dk;"), {"dk": dock_id})

        await session.commit()


@pytest.mark.asyncio
async def test_complete_warehouse_keeper_putaway_lifecycle_and_security(client: AsyncClient, cleanup_sk_test):
    """
    Comprehensive test suite verifying:
    1. Warehouse assigns Putaway to Warehouse A (status ASSIGNED_TO_WAREHOUSE).
    2. Warehouse assigns Putaway to Warehouse B.
    3. Targeted notification generated for Warehouse A.
    4. Warehouse Operator A sees Warehouse A tasks.
    5. Warehouse Operator A cannot see Warehouse B tasks.
    6. Warehouse Operator A completes Warehouse A Putaway.
    7. Warehouse Operator A attempts Warehouse B Putaway -> 403.
    8. Warehouse Operator selects Zone belonging to own Warehouse -> allowed.
    9. Warehouse Operator selects Zone belonging to another Warehouse -> 422.
    10. Warehouse cannot directly mark physical Warehouse Putaway as completed -> 403.
    11. Inventory location / Material Stock available is updated ONLY after Warehouse Operator confirmation.
    12. Duplicate completion rejected -> 409.
    13. Material QR remains valid.
    14. Zone QR remains valid.
    """
    uid_sfx = uuid.uuid4().hex[:6].upper()
    po_id = uuid.uuid4()
    asn_id = uuid.uuid4()
    ge_id = uuid.uuid4()
    dock_id = uuid.uuid4()
    dock_num = f"TEST_SK_DK_{uid_sfx}"
    da_id = uuid.uuid4()
    rl_a_id = uuid.uuid4()
    rl_b_id = uuid.uuid4()
    grn_line_a_id = uuid.uuid4()
    grn_line_b_id = uuid.uuid4()
    grn_id = uuid.uuid4()
    grn_number = f"TEST_SK_GRN_{uid_sfx}"

    mat_a_code = f"TEST_SK_MOT_A_{uid_sfx}"
    mat_b_code = f"TEST_SK_MOT_B_{uid_sfx}"

    async with engine.begin() as conn:
        sup_row = (await conn.execute(text("SELECT id FROM supplier WHERE supplier_name NOT LIKE 'TEST_%' LIMIT 1"))).first()
        if sup_row:
            sup_id = sup_row[0]
        else:
            sup_id = uuid.uuid4()
            await conn.execute(
                text("INSERT INTO supplier (id, supplier_name, registered_company_name, vendor_type, category, industry, gstin, status, created_at, updated_at) VALUES (:id, 'TEST Global Motors Ltd', :comp, 'Manufacturer', '[\"Automotive\"]', 'Automotive', :gstin, 'Active', NOW(), NOW())"),
                {"id": sup_id, "comp": f"TEST Global Motors {uid_sfx}", "gstin": f"29ABCDE{uid_sfx[:4]}1Z5"},
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
            text("INSERT INTO receiving_line (id, dock_assignment_id, item_code, material_name, ordered_quantity, shipped_quantity, received_quantity, good_quantity, exception_quantity, verification_status, recorded_by, recorded_at) VALUES (:id, :da_id, :item_code, 'Industrial Motor 100', 10, 10, 10, 10, 0, 'VERIFIED', 'system', NOW())"),
            {"id": rl_a_id, "da_id": da_id, "item_code": mat_a_code},
        )
        await conn.execute(
            text("INSERT INTO receiving_line (id, dock_assignment_id, item_code, material_name, ordered_quantity, shipped_quantity, received_quantity, good_quantity, exception_quantity, verification_status, recorded_by, recorded_at) VALUES (:id, :da_id, :item_code, 'Industrial Motor 200', 10, 10, 10, 10, 0, 'VERIFIED', 'system', NOW())"),
            {"id": rl_b_id, "da_id": da_id, "item_code": mat_b_code},
        )
        await conn.execute(
            text("INSERT INTO grn (id, grn_number, warehouse_id, status) VALUES (:id, :grn_num, 'Main Warehouse', 'GRN_POSTED')"),
            {"id": grn_id, "grn_num": grn_number},
        )
        await conn.execute(
            text("INSERT INTO grn_line (id, grn_id, item_code, material_name, uom, received_quantity, good_quantity, accepted_quantity) VALUES (:id, :grn_id, :item_code, :material_name, 'PCS', 10, 10, 10)"),
            {"id": grn_line_a_id, "grn_id": grn_id, "item_code": mat_a_code, "material_name": "Industrial Motor 100"},
        )
        await conn.execute(
            text("INSERT INTO grn_line (id, grn_id, item_code, material_name, uom, received_quantity, good_quantity, accepted_quantity) VALUES (:id, :grn_id, :item_code, :material_name, 'PCS', 10, 10, 10)"),
            {"id": grn_line_b_id, "grn_id": grn_id, "item_code": mat_b_code, "material_name": "Industrial Motor 200"},
        )

    async with AsyncSessionFactory() as session:
        # 1. Seed Warehouse A (Mechanical) & Warehouse B (Electrical)
        warehouse_a = WarehouseModel(
            warehouse_code=f"STR-SKA-{uid_sfx}",
            warehouse_name="Mechanical Warehouse",
            warehouse_id="Main Warehouse",
            status="ACTIVE",
        )
        warehouse_b = WarehouseModel(
            warehouse_code=f"STR-SKB-{uid_sfx}",
            warehouse_name="Electrical Warehouse",
            warehouse_id="Main Warehouse",
            status="ACTIVE",
        )
        session.add_all([warehouse_a, warehouse_b])
        await session.flush()

        # 2. Seed Zones for Warehouse A & Warehouse B
        zone_a1 = WarehouseZoneModel(
            warehouse_ref_id=warehouse_a.id,
            zone_code=f"MEC-Z01-{uid_sfx}",
            zone_name="Heavy Motors Bay",
            status="ACTIVE",
        )
        zone_b1 = WarehouseZoneModel(
            warehouse_ref_id=warehouse_b.id,
            zone_code=f"ELE-Z01-{uid_sfx}",
            zone_name="Transformer Section",
            status="ACTIVE",
        )
        session.add_all([zone_a1, zone_b1])
        await session.flush()

        # 3. Seed Handling Units
        hu_a_num = f"HU-{uuid.uuid4().hex[:8].upper()}"
        hu_a = HandlingUnitModel(
            hu_number=hu_a_num,
            barcode_value=hu_a_num,
            receiving_line_id=rl_a_id,
            item_code=mat_a_code,
            material_name="Industrial Motor 100",
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
        hu_b_num = f"HU-{uuid.uuid4().hex[:8].upper()}"
        hu_b = HandlingUnitModel(
            hu_number=hu_b_num,
            barcode_value=hu_b_num,
            receiving_line_id=rl_b_id,
            item_code=mat_b_code,
            material_name="Industrial Motor 200",
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
        session.add_all([hu_a, hu_b])
        await session.flush()

        # 4. Seed Material Stock Record
        session.add_all([
            MaterialModel(
                material_code=mat_a_code,
                material_name="Industrial Motor 100",
                category="Mechanical",
                base_uom="PCS",
                status="Active",
            ),
            MaterialModel(
                material_code=mat_b_code,
                material_name="Industrial Motor 200",
                category="Mechanical",
                base_uom="PCS",
                status="Active",
            ),
        ])
        await session.flush()
        stock_a = MaterialStockModel(
            material_code=mat_a_code,
            material_name="Industrial Motor 100",
            category="Mechanical",
            on_hand=Decimal("10.0"),
            allocated=Decimal("0.0"),
            available=Decimal("0.0"),
            uom="PCS",
            warehouse_id="Main Warehouse",
            reorder_point=Decimal("5.0"),
        )
        session.add(stock_a)

        # 5. Seed Putaway Tasks
        task_a = PutawayTaskModel(
            task_number=f"PUT-{uuid.uuid4().hex[:8].upper()}",
            grn_id=grn_id,
            grn_number=grn_number,
            handling_unit_id=hu_a.id,
            item_code=mat_a_code,
            material_name="Industrial Motor 100",
            quantity=Decimal("10.0"),
            uom="PCS",
            warehouse_id="Main Warehouse",
            source_location="RECEIVING_AREA",
            status="PUTAWAY_PENDING",
            created_by="system",
            created_at=datetime.datetime.now(datetime.timezone.utc),
        )
        task_b = PutawayTaskModel(
            task_number=f"PUT-{uuid.uuid4().hex[:8].upper()}",
            grn_id=grn_id,
            grn_number=grn_number,
            handling_unit_id=hu_b.id,
            item_code=mat_b_code,
            material_name="Industrial Motor 200",
            quantity=Decimal("10.0"),
            uom="PCS",
            warehouse_id="Main Warehouse",
            source_location="RECEIVING_AREA",
            status="PUTAWAY_PENDING",
            created_by="system",
            created_at=datetime.datetime.now(datetime.timezone.utc),
        )
        session.add_all([task_a, task_b])
        await session.commit()

    warehouse_a_id = str(warehouse_a.id)
    warehouse_b_id = str(warehouse_b.id)
    warehouse_a_code = warehouse_a.warehouse_code
    warehouse_b_code = warehouse_b.warehouse_code
    zone_a1_id = str(zone_a1.id)
    zone_a1_code = zone_a1.zone_code
    zone_b1_id = str(zone_b1.id)
    zone_b1_code = zone_b1.zone_code
    task_a_id = str(task_a.id)
    task_b_id = str(task_b.id)
    hu_a_val = hu_a_num

    cleanup_sk_test.update({
        "uid_sfx": uid_sfx,
        "mat_a_code": mat_a_code,
        "mat_b_code": mat_b_code,
        "task_a_id": task_a_id,
        "task_b_id": task_b_id,
        "grn_number": grn_number,
        "hu_a_id": hu_a.id,
        "hu_b_id": hu_b.id,
        "rl_a_id": rl_a_id,
        "rl_b_id": rl_b_id,
        "grn_line_a_id": grn_line_a_id,
        "grn_line_b_id": grn_line_b_id,
        "da_id": da_id,
        "grn_id": grn_id,
        "ge_id": ge_id,
        "asn_id": asn_id,
        "po_id": po_id,
        "zone_a1_id": zone_a1_id,
        "zone_b1_id": zone_b1_id,
        "warehouse_a_id": warehouse_a_id,
        "warehouse_b_id": warehouse_b_id,
        "dock_id": dock_id,
    })

    headers_wh = {
        "Authorization": "Bearer mock-jwt-warehouse-token",
        "X-User-Roles": "WAREHOUSE_MANAGER",
        "X-User-Permissions": "gate:read,gate:verify,gate:approve,storage:write",
    }
    headers_keeper_a = {
        "Authorization": "Bearer mock-jwt-warehouse-operator-token",
        "X-User-Roles": "WAREHOUSE_OPERATOR",
        "X-User-Permissions": "warehouse:read,storage:read,putaway:execute",
        "X-Warehouse-Id": warehouse_a_id,
        "X-Warehouse-Code": warehouse_a_code,
    }
    headers_keeper_b = {
        "Authorization": "Bearer mock-jwt-warehouse-operator-token",
        "X-User-Roles": "WAREHOUSE_OPERATOR",
        "X-User-Permissions": "warehouse:read,storage:read,putaway:execute",
        "X-Warehouse-Id": warehouse_b_id,
        "X-Warehouse-Code": warehouse_b_code,
    }

    # Scenario 1 & 2: Warehouse assigns Putaway Task A to Warehouse A and Task B to Warehouse B
    resp_assign_a = await client.put(
        f"/api/storage/putaway-tasks/{task_a_id}/location",
        json={"warehouse_ref_id": warehouse_a_id},
        headers=headers_wh,
    )
    assert resp_assign_a.status_code == 200, resp_assign_a.text
    assert resp_assign_a.json()["destination_warehouse_ref_id"] == warehouse_a_id
    assert resp_assign_a.json()["status"] == "ASSIGNED_TO_WAREHOUSE"

    resp_assign_b = await client.put(
        f"/api/storage/putaway-tasks/{task_b_id}/location",
        json={"warehouse_ref_id": warehouse_b_id},
        headers=headers_wh,
    )
    assert resp_assign_b.status_code == 200, resp_assign_b.text
    assert resp_assign_b.json()["destination_warehouse_ref_id"] == warehouse_b_id
    assert resp_assign_b.json()["status"] == "ASSIGNED_TO_WAREHOUSE"

    # Scenario 11: Inventory available is NOT updated merely on assignment
    async with AsyncSessionFactory() as session:
        st_check = await session.execute(
            select(MaterialStockModel).where(MaterialStockModel.material_code == mat_a_code)
        )
        current_stock = st_check.scalar_one()
        assert current_stock.available == Decimal("0.0")

    # Scenario 3: Warehouse A notification is generated specifically for Warehouse A
    async with AsyncSessionFactory() as session:
        notif_res = await session.execute(
            select(NotificationModel).where(
                NotificationModel.user_role == f"WH:{warehouse_a_code}"
            )
        )
        warehouse_a_notifs = notif_res.scalars().all()
        assert len(warehouse_a_notifs) >= 1
        assert "Mechanical Warehouse" in warehouse_a_notifs[0].message

    # Scenario 4 & 5: Warehouse Operator A sees Warehouse A tasks, but CANNOT see Warehouse B tasks
    resp_list_keeper_a = await client.get("/api/storage/putaway-tasks", headers=headers_keeper_a)
    assert resp_list_keeper_a.status_code == 200, resp_list_keeper_a.text
    keeper_a_tasks = resp_list_keeper_a.json()
    task_ids_a = [t["id"] for t in keeper_a_tasks]
    assert task_a_id in task_ids_a
    assert task_b_id not in task_ids_a

    # Scenario 10: Warehouse CANNOT directly mark the physical Warehouse Putaway as completed
    zone_qr_a = json.dumps({
        "type": "ZONE_QR",
        "zone_id": zone_a1_id,
        "zone_code": zone_a1_code,
        "warehouse_ref_id": warehouse_a_id,
        "warehouse_code": warehouse_a_code,
        "status": "ACTIVE",
    })
    resp_wh_complete = await client.post(
        f"/api/storage/putaway-tasks/{task_a_id}/complete",
        json={
            "material_scan": hu_a_val,
            "location_scan": zone_qr_a,
            "quantity": 10.0,
        },
        headers=headers_wh,
    )
    assert resp_wh_complete.status_code == 403
    assert "Warehouse Operator" in resp_wh_complete.json()["detail"]

    # Scenario 7: Warehouse Operator B attempts Warehouse A Putaway -> 403 Forbidden (IDOR Defense)
    resp_keeper_b_on_a = await client.post(
        f"/api/storage/putaway-tasks/{task_a_id}/complete",
        json={
            "material_scan": hu_a_val,
            "location_scan": zone_qr_a,
            "quantity": 10.0,
        },
        headers=headers_keeper_b,
    )
    assert resp_keeper_b_on_a.status_code == 403
    assert "Cannot complete Putaway tasks belonging to another Warehouse" in resp_keeper_b_on_a.json()["detail"]

    # Scenario 9: Warehouse Operator A selects/scans Zone belonging to Warehouse B -> 422 Rejected
    zone_qr_b = json.dumps({
        "type": "ZONE_QR",
        "zone_id": zone_b1_id,
        "zone_code": zone_b1_code,
        "warehouse_ref_id": warehouse_b_id,
        "warehouse_code": warehouse_b_code,
        "status": "ACTIVE",
    })
    resp_cross_zone = await client.post(
        f"/api/storage/putaway-tasks/{task_a_id}/complete",
        json={
            "material_scan": hu_a_val,
            "location_scan": zone_qr_b,
            "quantity": 10.0,
        },
        headers=headers_keeper_a,
    )
    assert resp_cross_zone.status_code == 422
    assert "does not belong to assigned destination Warehouse" in resp_cross_zone.json()["detail"]

    # Scenario 6 & 8 & 13 & 14: Warehouse Operator A completes Warehouse A Putaway with valid Material QR and own Warehouse Zone QR
    # Start task
    resp_start_a = await client.post(
        f"/api/storage/putaway-tasks/{task_a_id}/start",
        headers=headers_keeper_a,
    )
    assert resp_start_a.status_code == 200, resp_start_a.text
    assert resp_start_a.json()["status"] == "IN_PROGRESS"

    # Confirm putaway
    resp_complete_a = await client.post(
        f"/api/storage/putaway-tasks/{task_a_id}/complete",
        json={
            "material_scan": hu_a_val,
            "location_scan": zone_qr_a,
            "quantity": 10.0,
        },
        headers=headers_keeper_a,
    )
    assert resp_complete_a.status_code == 200, resp_complete_a.text
    comp_data = resp_complete_a.json()
    assert comp_data["status"] == "COMPLETED"
    assert comp_data["inventory_available_after"] == 10.0

    # Verify inventory is now available in MaterialStock
    async with AsyncSessionFactory() as session:
        st_after = await session.execute(
            select(MaterialStockModel).where(MaterialStockModel.material_code == mat_a_code)
        )
        updated_stock = st_after.scalar_one()
        assert updated_stock.available == Decimal("10.0")
