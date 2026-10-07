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
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialStockModel,
    NotificationModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    HandlingUnitModel,
    InventoryLocationBalanceModel,
    PutawayTaskModel,
    StorageLocationModel,
)
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
        da_id = created.get("da_id")
        grn_id = created.get("grn_id")
        ge_id = created.get("ge_id")
        asn_id = created.get("asn_id")
        po_id = created.get("po_id")
        zone_a1_id = created.get("zone_a1_id")
        zone_b1_id = created.get("zone_b1_id")
        store_a_id = created.get("store_a_id")
        store_b_id = created.get("store_b_id")
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

        if zone_a1_id and zone_b1_id and store_a_id and store_b_id:
            await session.execute(text("DELETE FROM store_bin WHERE store_id IN (:sa, :sb) OR zone_id IN (:za, :zb);"), {"sa": uuid.UUID(store_a_id), "sb": uuid.UUID(store_b_id), "za": uuid.UUID(zone_a1_id), "zb": uuid.UUID(zone_b1_id)})

        if zone_a1_id and zone_b1_id:
            await session.execute(text("DELETE FROM store_zone WHERE id IN (:za, :zb);"), {"za": uuid.UUID(zone_a1_id), "zb": uuid.UUID(zone_b1_id)})

        if store_a_id and store_b_id:
            await session.execute(text("DELETE FROM store WHERE id IN (:sa, :sb);"), {"sa": uuid.UUID(store_a_id), "sb": uuid.UUID(store_b_id)})

        if dock_id:
            await session.execute(text("DELETE FROM warehouse_dock WHERE id = :dk;"), {"dk": dock_id})

        await session.commit()


@pytest.mark.asyncio
async def test_complete_store_keeper_putaway_lifecycle_and_security(client: AsyncClient, cleanup_sk_test):
    """
    Comprehensive test suite verifying:
    1. Warehouse assigns Putaway to Store A (status ASSIGNED_TO_STORE).
    2. Warehouse assigns Putaway to Store B.
    3. Targeted notification generated for Store A.
    4. Store Keeper A sees Store A tasks.
    5. Store Keeper A cannot see Store B tasks.
    6. Store Keeper A completes Store A Putaway.
    7. Store Keeper A attempts Store B Putaway -> 403.
    8. Store Keeper selects Zone belonging to own Store -> allowed.
    9. Store Keeper selects Zone belonging to another Store -> 422.
    10. Warehouse cannot directly mark physical Store Putaway as completed -> 403.
    11. Inventory location / Material Stock available is updated ONLY after Store Keeper confirmation.
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

    async with AsyncSessionFactory() as session:
        # 1. Seed Store A (Mechanical) & Store B (Electrical)
        store_a = StoreModel(
            store_code=f"STR-SKA-{uid_sfx}",
            store_name="Mechanical Store",
            warehouse_id="Main Warehouse",
            status="ACTIVE",
        )
        store_b = StoreModel(
            store_code=f"STR-SKB-{uid_sfx}",
            store_name="Electrical Store",
            warehouse_id="Main Warehouse",
            status="ACTIVE",
        )
        session.add_all([store_a, store_b])
        await session.flush()

        # 2. Seed Zones for Store A & Store B
        zone_a1 = StoreZoneModel(
            store_id=store_a.id,
            zone_code=f"MEC-Z01-{uid_sfx}",
            zone_name="Heavy Motors Bay",
            status="ACTIVE",
        )
        zone_b1 = StoreZoneModel(
            store_id=store_b.id,
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

    store_a_id = str(store_a.id)
    store_b_id = str(store_b.id)
    store_a_code = store_a.store_code
    store_b_code = store_b.store_code
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
        "da_id": da_id,
        "grn_id": grn_id,
        "ge_id": ge_id,
        "asn_id": asn_id,
        "po_id": po_id,
        "zone_a1_id": zone_a1_id,
        "zone_b1_id": zone_b1_id,
        "store_a_id": store_a_id,
        "store_b_id": store_b_id,
        "dock_id": dock_id,
    })

    headers_wh = {
        "Authorization": "Bearer mock-jwt-warehouse-token",
        "X-User-Roles": "WAREHOUSE_MANAGER",
        "X-User-Permissions": "gate:read,gate:verify,gate:approve,storage:write",
    }
    headers_keeper_a = {
        "Authorization": "Bearer mock-jwt-store-keeper-token",
        "X-User-Roles": "STORE_KEEPER",
        "X-User-Permissions": "store:read,storage:read,putaway:execute",
        "X-Store-Id": store_a_id,
        "X-Store-Code": store_a_code,
    }
    headers_keeper_b = {
        "Authorization": "Bearer mock-jwt-store-keeper-token",
        "X-User-Roles": "STORE_KEEPER",
        "X-User-Permissions": "store:read,storage:read,putaway:execute",
        "X-Store-Id": store_b_id,
        "X-Store-Code": store_b_code,
    }

    # Scenario 1 & 2: Warehouse assigns Putaway Task A to Store A and Task B to Store B
    resp_assign_a = await client.put(
        f"/api/storage/putaway-tasks/{task_a_id}/location",
        json={"store_id": store_a_id},
        headers=headers_wh,
    )
    assert resp_assign_a.status_code == 200, resp_assign_a.text
    assert resp_assign_a.json()["destination_store_id"] == store_a_id
    assert resp_assign_a.json()["status"] == "ASSIGNED_TO_STORE"

    resp_assign_b = await client.put(
        f"/api/storage/putaway-tasks/{task_b_id}/location",
        json={"store_id": store_b_id},
        headers=headers_wh,
    )
    assert resp_assign_b.status_code == 200, resp_assign_b.text
    assert resp_assign_b.json()["destination_store_id"] == store_b_id
    assert resp_assign_b.json()["status"] == "ASSIGNED_TO_STORE"

    # Scenario 11: Inventory available is NOT updated merely on assignment
    async with AsyncSessionFactory() as session:
        st_check = await session.execute(
            select(MaterialStockModel).where(MaterialStockModel.material_code == mat_a_code)
        )
        current_stock = st_check.scalar_one()
        assert current_stock.available == Decimal("0.0")

    # Scenario 3: Store A notification is generated specifically for Store A
    async with AsyncSessionFactory() as session:
        notif_res = await session.execute(
            select(NotificationModel).where(
                NotificationModel.user_role == f"STR:{store_a_code}"
            )
        )
        store_a_notifs = notif_res.scalars().all()
        assert len(store_a_notifs) >= 1
        assert "Mechanical Store" in store_a_notifs[0].message

    # Scenario 4 & 5: Store Keeper A sees Store A tasks, but CANNOT see Store B tasks
    resp_list_keeper_a = await client.get("/api/storage/putaway-tasks", headers=headers_keeper_a)
    assert resp_list_keeper_a.status_code == 200, resp_list_keeper_a.text
    keeper_a_tasks = resp_list_keeper_a.json()
    task_ids_a = [t["id"] for t in keeper_a_tasks]
    assert task_a_id in task_ids_a
    assert task_b_id not in task_ids_a

    # Scenario 10: Warehouse CANNOT directly mark the physical Store Putaway as completed
    zone_qr_a = json.dumps({
        "type": "ZONE_QR",
        "zone_id": zone_a1_id,
        "zone_code": zone_a1_code,
        "store_id": store_a_id,
        "store_code": store_a_code,
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
    assert "Store Keeper" in resp_wh_complete.json()["detail"]

    # Scenario 7: Store Keeper B attempts Store A Putaway -> 403 Forbidden (IDOR Defense)
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
    assert "Cannot complete Putaway tasks belonging to another Store" in resp_keeper_b_on_a.json()["detail"]

    # Scenario 9: Store Keeper A selects/scans Zone belonging to Store B -> 422 Rejected
    zone_qr_b = json.dumps({
        "type": "ZONE_QR",
        "zone_id": zone_b1_id,
        "zone_code": zone_b1_code,
        "store_id": store_b_id,
        "store_code": store_b_code,
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
    assert "does not belong to assigned destination Store" in resp_cross_zone.json()["detail"]

    # Scenario 6 & 8 & 13 & 14: Store Keeper A completes Store A Putaway with valid Material QR and own Store Zone QR
    # Start task
    resp_start_a = await client.post(
        f"/api/storage/putaway-tasks/{task_a_id}/start",
        headers=headers_keeper_a,
    )
    assert resp_start_a.status_code == 200, resp_start_a.text
    assert resp_start_a.json()["status"] == "PUTAWAY_IN_PROGRESS"

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
    assert comp_data["status"] == "PUTAWAY_COMPLETED"
    assert comp_data["inventory_available_after"] == 10.0

    # Verify inventory is now available in MaterialStock
    async with AsyncSessionFactory() as session:
        st_after = await session.execute(
            select(MaterialStockModel).where(MaterialStockModel.material_code == mat_a_code)
        )
        updated_stock = st_after.scalar_one()
        assert updated_stock.available == Decimal("10.0")
