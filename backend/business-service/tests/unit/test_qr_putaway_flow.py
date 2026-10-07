import datetime
import json
import uuid
from decimal import Decimal
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.database.session import AsyncSessionFactory
from app.main import create_app
from app.modules.procurement.infrastructure.persistence.models import MaterialStockModel
from app.modules.receiving.infrastructure.persistence.models import (
    GrnBatchModel,
    GrnBatchQrModel,
    GrnLineModel,
    GrnModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    InventoryLocationBalanceModel,
    InventoryMovementHistoryModel,
    PutawayMovementModel,
    PutawayTaskModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreBinModel,
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
async def cleanup_qr_test():
    created = {}
    yield created
    async with AsyncSessionFactory() as session:
        mat_code = created.get("mat_code")
        grn_id = created.get("grn_id")
        grn_num = created.get("grn_num")
        batch_num = created.get("batch_num")
        uid_sfx = created.get("uid_sfx")
        bin_code_val = created.get("bin_code_val")
        zone_code_val = created.get("zone_code_val")
        store_code_val = created.get("store_code_val")

        if mat_code:
            await session.execute(text("DELETE FROM inventory_movement_history WHERE material_code = :mc;"), {"mc": mat_code})
            await session.execute(text("DELETE FROM inventory_location_balance WHERE material_code = :mc;"), {"mc": mat_code})
            await session.execute(text("DELETE FROM putaway_movement WHERE material_code = :mc;"), {"mc": mat_code})
            await session.execute(text("DELETE FROM putaway_task WHERE item_code = :mc OR grn_number = :gn;"), {"mc": mat_code, "gn": grn_num or ""})
            await session.execute(text("DELETE FROM grn_batch_qr WHERE item_code = :mc;"), {"mc": mat_code})
            await session.execute(text("DELETE FROM grn_line WHERE item_code = :mc;"), {"mc": mat_code})
            await session.execute(text("DELETE FROM material_stock WHERE material_code = :mc;"), {"mc": mat_code})
            await session.execute(text("DELETE FROM material WHERE material_code = :mc;"), {"mc": mat_code})

        if batch_num:
            await session.execute(text("DELETE FROM grn_batch WHERE batch_number = :bn;"), {"bn": batch_num})

        if grn_id:
            await session.execute(text("DELETE FROM grn WHERE id = :gid;"), {"gid": grn_id})

        if uid_sfx:
            await session.execute(text("DELETE FROM storage_location WHERE location_code LIKE :pat;"), {"pat": f"%{uid_sfx}%"})

        if bin_code_val:
            await session.execute(text("DELETE FROM store_bin WHERE bin_code = :bc;"), {"bc": bin_code_val})

        if zone_code_val:
            await session.execute(text("DELETE FROM store_zone WHERE zone_code = :zc;"), {"zc": zone_code_val})

        if store_code_val:
            await session.execute(text("DELETE FROM store WHERE store_code = :sc;"), {"sc": store_code_val})

        await session.commit()


@pytest.mark.asyncio
async def test_qr_driven_putaway_flow_complete_and_partial(client: AsyncClient, cleanup_qr_test):
    """
    Test End-to-End QR-Driven Putaway:
    1. GRN Created & Completed with Material QR
    2. Resolve GRN QR endpoint returns full autofilled metadata & available quantity
    3. Resolve Bin QR returns destination bin layout & occupancy
    4. Execute Partial Putaway (e.g. 40 out of 100) -> updates stock, remaining is 60, status PARTIALLY_COMPLETED
    5. Execute Final Putaway (remaining 60) -> status COMPLETED, available is 0
    6. Attempting further Putaway on fully put away QR -> returns 422
    """
    uid_sfx = uuid.uuid4().hex[:6].upper()
    grn_id = uuid.uuid4()
    grn_num = f"TEST_QR_GRN_{uid_sfx}"
    mat_code = f"TEST_QR_MAT_{uid_sfx}"
    batch_num = f"TEST_QR_BAT_{uid_sfx}"
    store_code_val = f"TEST_QR_STR_{uid_sfx}"
    zone_code_val = f"TEST_QR_ZON_{uid_sfx}"
    bin_code_val = f"TEST_QR_BIN_{uid_sfx}"
    qr_code_str = f"QR-MAT-{mat_code}"

    cleanup_qr_test.update({
        "uid_sfx": uid_sfx,
        "grn_id": grn_id,
        "grn_num": grn_num,
        "mat_code": mat_code,
        "batch_num": batch_num,
        "store_code_val": store_code_val,
        "zone_code_val": zone_code_val,
        "bin_code_val": bin_code_val,
    })

    async with AsyncSessionFactory() as session:
        # 1. Create Store, Zone, and Bins
        store = StoreModel(
            store_code=store_code_val,
            store_name="Raw Material Store",
            warehouse_id="Main Warehouse",
            store_manager_name="store_mgr_alex",
            status="ACTIVE",
        )
        session.add(store)
        await session.flush()

        zone = StoreZoneModel(
            store_id=store.id,
            zone_code=zone_code_val,
            zone_name="Raw Material Zone",
            status="ACTIVE",
        )
        session.add(zone)
        await session.flush()

        bin_a = StoreBinModel(
            store_id=store.id,
            zone_id=zone.id,
            bin_code=bin_code_val,
            bin_name="Primary Rack Bin",
            rack="R01",
            shelf="S01",
            capacity=Decimal("500.0"),
            occupied_quantity=Decimal("0.0"),
            status="ACTIVE",
        )
        session.add(bin_a)
        await session.flush()

        # 2. Create GRN Header, Line, Batch, Batch QR
        grn = GrnModel(
            id=grn_id,
            grn_number=grn_num,
            po_number="PO-2026-999",
            asn_number="ASN-2026-999",
            gate_entry_number="GE-2026-888",
            vehicle_number="KA-04-QR-1234",
            supplier_name="Apex Global Materials",
            warehouse_id="Main Warehouse",
            dock_number="DOCK-01",
            status="COMPLETED",
        )
        session.add(grn)
        await session.flush()

        line = GrnLineModel(
            grn_id=grn.id,
            item_code=mat_code,
            material_name="High-Grade Structural Steel",
            material_category="Raw Materials",
            variant_code="Grade-A",
            uom="KG",
            ordered_quantity=Decimal("100.0"),
            received_quantity=Decimal("100.0"),
            good_quantity=Decimal("100.0"),
            damaged_quantity=Decimal("0.0"),
        )
        session.add(line)
        await session.flush()

        batch = GrnBatchModel(
            grn_line_id=line.id,
            batch_number=batch_num,
            batch_quantity=Decimal("100.0"),
            created_by="grn_operator",
        )
        session.add(batch)
        await session.flush()

        batch_qr = GrnBatchQrModel(
            batch_id=batch.id,
            item_code=mat_code,
            qr_code=qr_code_str,
            qr_payload=json.dumps({
                "type": "GRN_BATCH_QR",
                "item_code": mat_code,
                "material_name": "High-Grade Structural Steel",
                "grn_number": grn_num,
                "batch_number": batch_num,
                "quantity": 100.0,
                "uom": "KG",
            }),
            generated_by="grn_operator",
        )
        session.add(batch_qr)

        # 3. Create Putaway Task
        pt = PutawayTaskModel(
            task_number=f"PUT-{uuid.uuid4().hex[:8].upper()}",
            grn_id=grn.id,
            grn_number=grn_num,
            item_code=mat_code,
            material_name="High-Grade Structural Steel",
            quantity=Decimal("100.0"),
            uom="KG",
            warehouse_id="Main Warehouse",
            source_location="DOCK-01",
            destination_store_id=store.id,
            status="READY_FOR_PUTAWAY",
            created_by="system",
            created_at=datetime.datetime.now(datetime.timezone.utc),
        )
        session.add(pt)
        await session.commit()

    store_id_val = str(store.id)

    headers = {
        "Authorization": "Bearer mock-jwt-token",
        "X-User-Roles": "STORE_MANAGER,WAREHOUSE_MANAGER",
        "X-User-Permissions": "storage:read,storage:write,putaway:execute",
    }

    # Step 1: Resolve GRN QR
    resp_resolve_grn = await client.post(
        "/api/storage/putaway-tasks/resolve-grn-qr",
        json={"qr_code": qr_code_str},
        headers=headers,
    )
    assert resp_resolve_grn.status_code == 200, resp_resolve_grn.text
    grn_res = resp_resolve_grn.json()
    assert grn_res["material_code"] == mat_code
    assert grn_res["grn_number"] == grn_num
    assert grn_res["received_quantity"] == 100.0
    assert grn_res["already_put_away_quantity"] == 0.0
    assert grn_res["available_quantity"] == 100.0
    assert grn_res["uom"] == "KG"
    assert grn_res["supplier_name"] == "Apex Global Materials"
    assert grn_res["gate_entry_number"] == "GE-2026-888"
    assert grn_res["truck_number"] == "KA-04-QR-1234"

    # Step 2: Resolve Bin QR
    resp_resolve_bin = await client.post(
        "/api/storage/putaway-tasks/resolve-bin-qr",
        json={"bin_scan": bin_code_val, "store_id": store_id_val},
        headers=headers,
    )
    assert resp_resolve_bin.status_code == 200, resp_resolve_bin.text
    bin_res = resp_resolve_bin.json()
    assert bin_res["bin_code"] == bin_code_val
    assert bin_res["capacity"] == 500.0
    assert bin_res["available_capacity"] == 500.0
    assert bin_res["status"] == "ACTIVE"

    # Step 3: Execute Partial Putaway (40 out of 100)
    resp_partial = await client.post(
        "/api/storage/putaway-tasks/execute-putaway",
        json={
            "grn_qr_code": qr_code_str,
            "bin_qr_code": bin_code_val,
            "quantity": 40.0,
        },
        headers=headers,
    )
    assert resp_partial.status_code == 200, resp_partial.text
    partial_res = resp_partial.json()
    assert partial_res["status"] == "SUCCESS"
    assert partial_res["putaway_status"] == "PARTIALLY_COMPLETED"
    assert partial_res["putaway_quantity"] == 40.0
    assert partial_res["remaining_available_quantity"] == 60.0

    # Step 4: Verify intermediate resolve returns updated quantities
    resp_resolve_grn2 = await client.post(
        "/api/storage/putaway-tasks/resolve-grn-qr",
        json={"qr_code": qr_code_str},
        headers=headers,
    )
    assert resp_resolve_grn2.status_code == 200, resp_resolve_grn2.text
    grn_res2 = resp_resolve_grn2.json()
    assert grn_res2["already_put_away_quantity"] == 40.0
    assert grn_res2["available_quantity"] == 60.0

    # Step 5: Execute Remaining Putaway (60 out of 60)
    resp_final = await client.post(
        "/api/storage/putaway-tasks/execute-putaway",
        json={
            "grn_qr_code": qr_code_str,
            "bin_qr_code": bin_code_val,
            "quantity": 60.0,
        },
        headers=headers,
    )
    assert resp_final.status_code == 200, resp_final.text
    final_res = resp_final.json()
    assert final_res["status"] == "SUCCESS"
    assert final_res["putaway_status"] == "COMPLETED"
    assert final_res["remaining_available_quantity"] == 0.0

    # Step 6: Verify Stock & Movements in database
    async with AsyncSessionFactory() as session:
        st = (await session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code == mat_code))).scalar_one()
        assert st.available == Decimal("100.0")

        bin_db = (await session.execute(select(StoreBinModel).where(StoreBinModel.bin_code == bin_code_val))).scalar_one()
        assert bin_db.occupied_quantity == Decimal("100.0")

        pt_db = (await session.execute(select(PutawayTaskModel).where(PutawayTaskModel.item_code == mat_code))).scalar_one()
        assert pt_db.status == "PUTAWAY_COMPLETED"
        assert pt_db.quantity == Decimal("0.0")

        movs = (await session.execute(select(PutawayMovementModel).where(PutawayMovementModel.material_code == mat_code))).scalars().all()
        assert len(movs) == 2  # 1 for partial 40, 1 for remaining 60
