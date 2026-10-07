import datetime
from decimal import Decimal
import uuid
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.database.session import AsyncSessionFactory
from app.main import app
from app.modules.dock.infrastructure.persistence.models import (
    DockAllocationRequestModel,
    DockMasterModel,
)
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialModel,
    MaterialStockModel,
)
from app.modules.receiving.infrastructure.persistence.models import GrnModel
from app.modules.storage.infrastructure.persistence.models import (
    InventoryLocationBalanceModel,
    InventoryMovementHistoryModel,
    PutawayMovementModel,
    PutawayTaskModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreBinModel,
    StoreManagerUserModel,
    StoreModel,
    StoreZoneModel,
)


@pytest_asyncio.fixture
async def cleanup_movement_flow():
    created = {}
    yield created
    async with AsyncSessionFactory() as session:
        item_code = created.get("item_code")
        unique_suffix = created.get("unique_suffix")
        alloc_req_id = created.get("alloc_req_id")
        dock_id = created.get("dock_id")
        sm_user_id = created.get("sm_user_id")
        bin_id = created.get("bin_id")
        zone_id = created.get("zone_id")
        store_id = created.get("store_id")
        grn_id = created.get("grn_id")
        putaway_id = created.get("putaway_id")

        if item_code:
            await session.execute(text("DELETE FROM inventory_movement_history WHERE material_code = :mc;"), {"mc": item_code})
            await session.execute(text("DELETE FROM inventory_location_balance WHERE material_code = :mc;"), {"mc": item_code})
            await session.execute(text("DELETE FROM putaway_movement WHERE material_code = :mc;"), {"mc": item_code})
            await session.execute(text("DELETE FROM putaway_task WHERE item_code = :mc;"), {"mc": item_code})
            await session.execute(text("DELETE FROM material_stock WHERE material_code = :mc;"), {"mc": item_code})
            await session.execute(text("DELETE FROM material WHERE material_code = :mc;"), {"mc": item_code})

        if unique_suffix:
            await session.execute(text("DELETE FROM storage_location WHERE location_code LIKE :pat;"), {"pat": f"%{unique_suffix}%"})

        if alloc_req_id:
            await session.execute(text("DELETE FROM dock_allocation_requests WHERE id = :dar;"), {"dar": alloc_req_id})

        if dock_id:
            await session.execute(text("DELETE FROM dock_masters WHERE id = :did;"), {"did": dock_id})

        if grn_id:
            await session.execute(text("DELETE FROM grn WHERE id = :gid;"), {"gid": grn_id})

        if sm_user_id:
            await session.execute(text("DELETE FROM store_manager_user WHERE id = :smu;"), {"smu": sm_user_id})

        if bin_id:
            await session.execute(text("DELETE FROM store_bin WHERE id = :bid;"), {"bid": bin_id})

        if zone_id:
            await session.execute(text("DELETE FROM store_zone WHERE id = :zid;"), {"zid": zone_id})

        if store_id:
            await session.execute(text("DELETE FROM store WHERE id = :sid;"), {"sid": store_id})

        await session.commit()


@pytest.mark.asyncio
async def test_end_to_end_dock_store_manager_takeaway_history_flow(cleanup_movement_flow):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Setup Store, Zones, Bins, Store Manager, and Dock
        store_id = uuid.uuid4()
        zone_id = uuid.uuid4()
        bin_id = uuid.uuid4()
        dock_id = uuid.uuid4()
        sm_user_id = uuid.uuid4()
        alloc_req_id = uuid.uuid4()
        putaway_id = uuid.uuid4()
        grn_id = uuid.uuid4()

        unique_suffix = uuid.uuid4().hex[:6].upper()
        store_code = f"TEST_FLOW_STR_{unique_suffix}"
        zone_code = f"TEST_FLOW_ZON_{unique_suffix}"
        bin_code = f"BIN-FLW-{unique_suffix}"
        dock_code = f"TEST_FLOW_DK_{unique_suffix}"
        item_code = f"TEST_FLOW_MAT_{unique_suffix}"
        sm_username = f"test_flow_sm_{unique_suffix.lower()}"
        sm_empid = f"TEST_EMP_{unique_suffix}"
        grn_no = f"GRN-{unique_suffix}"
        material_qr_code = f"QR-MAT-{item_code}"

        cleanup_movement_flow.update({
            "item_code": item_code,
            "unique_suffix": unique_suffix,
            "alloc_req_id": alloc_req_id,
            "dock_id": dock_id,
            "sm_user_id": sm_user_id,
            "bin_id": bin_id,
            "zone_id": zone_id,
            "store_id": store_id,
            "grn_id": grn_id,
            "putaway_id": putaway_id,
        })

        async with AsyncSessionFactory() as session:
            # Create Store
            store = StoreModel(
                id=store_id,
                store_code=store_code,
                store_name=f"Main Store {unique_suffix}",
                warehouse_id="MAIN",
                store_manager_id=sm_empid,
                store_manager_name="Alice Store Manager",
                status="ACTIVE",
            )
            session.add(store)
            await session.flush()

            # Create Zone
            zone = StoreZoneModel(
                id=zone_id,
                store_id=store_id,
                zone_code=zone_code,
                zone_name=f"Zone {zone_code}",
                status="ACTIVE",
            )
            session.add(zone)
            await session.flush()

            # Create Bin
            bin_obj = StoreBinModel(
                id=bin_id,
                store_id=store_id,
                zone_id=zone_id,
                bin_code=bin_code,
                bin_name=f"Bin {bin_code}",
                rack="R01",
                shelf="S01",
                capacity=Decimal("5000.0"),
                occupied_quantity=Decimal("0.0"),
                status="ACTIVE",
            )
            session.add(bin_obj)
            await session.flush()

            # Create Storage Location
            loc_code = f"LOC-FLW-{unique_suffix}"
            storage_loc = StorageLocationModel(
                id=uuid.uuid4(),
                location_code=loc_code,
                warehouse_id="MAIN",
                store_id=store_id,
                zone_id=zone_id,
                bin_id=bin_id,
                zone=zone_code,
                rack="R01",
                bin=bin_code,
                capacity=Decimal("5000.0"),
                occupied_quantity=Decimal("0.0"),
                active=True,
            )
            session.add(storage_loc)

            # Create Store Manager User
            sm_user = StoreManagerUserModel(
                id=sm_user_id,
                store_id=store_id,
                employee_id=sm_empid,
                username=sm_username,
                full_name="Alice Store Manager",
                email=f"{sm_username}@warehouse.local",
                password_hash="hashed_pw",
                status="ACTIVE",
            )
            session.add(sm_user)

            # Create Dock
            dock = DockMasterModel(
                id=dock_id,
                dock_code=dock_code,
                dock_name=f"Inbound Dock {dock_code}",
                dock_type="RAW_MATERIAL",
                store_id=store_id,
                status="AVAILABLE",
                is_active=True,
            )
            session.add(dock)

            # Create Material Master & Stock
            mat = MaterialModel(
                id=uuid.uuid4(),
                material_code=item_code,
                material_name=f"Heavy Industrial Steel Rod {unique_suffix}",
                category="METALS",
            )
            session.add(mat)

            stock = MaterialStockModel(
                id=uuid.uuid4(),
                material_code=item_code,
                material_name=f"Heavy Industrial Steel Rod {unique_suffix}",
                category="METALS",
                on_hand=Decimal("100.0"),
                allocated=Decimal("0.0"),
                available=Decimal("0.0"),
                uom="PCS",
                warehouse_id="MAIN",
                reorder_point=Decimal("10.0"),
            )
            session.add(stock)

            # Create Dock Allocation Request
            gate_pass = f"GP-{unique_suffix}"
            alloc_req = DockAllocationRequestModel(
                id=alloc_req_id,
                existing_gate_pass_id=gate_pass,
                vendor_reference="Apex Steel Supplier",
                vehicle_number=f"KA-01-EQ-{unique_suffix}",
                material_reference=item_code,
                material_description="High Grade Steel Bars",
                quantity=Decimal("100.0"),
                security_approved_at=datetime.datetime.now(datetime.timezone.utc),
                priority="HIGH",
                status="PENDING",
            )
            session.add(alloc_req)
            await session.commit()

        # Auth Headers
        wm_headers = {
            "Authorization": "Bearer mock-jwt-token",
            "X-User-Roles": "WAREHOUSE_MANAGER,WAREHOUSE",
            "X-User-Subject": "wm_john",
        }
        sm_headers = {
            "Authorization": "Bearer mock-jwt-token",
            "X-User-Roles": "STORE_MANAGER",
            "X-User-Subject": sm_empid,
            "X-User-Username": sm_username,
            "X-User-Store-Id": str(store_id),
            "X-User-Store-Code": store_code,
        }
        other_sm_headers = {
            "Authorization": "Bearer mock-jwt-token",
            "X-User-Roles": "STORE_MANAGER",
            "X-User-Subject": "OTHER_EMP_999",
            "X-User-Username": "other_sm",
            "X-User-Store-Id": str(uuid.uuid4()),
            "X-User-Store-Code": "STR-999",
        }

        # -------------------------------------------------------------
        # STEP 1: Warehouse Manager allocates dock and assigns Store Manager
        # -------------------------------------------------------------
        alloc_payload = {
            "allocation_request_id": str(alloc_req_id),
            "dock_id": str(dock_id),
            "store_manager_id": sm_empid,
            "store_manager_username": sm_username,
            "store_manager_name": "Alice Store Manager",
        }
        res_alloc = await client.post(
            "/api/v1/warehouse/dock-allocations",
            json=alloc_payload,
            headers=wm_headers,
        )
        assert res_alloc.status_code == 200, res_alloc.text
        alloc_data = res_alloc.json()
        assert alloc_data["assigned_dock_id"] == str(dock_id)
        assert alloc_data["assigned_store_manager_id"] == sm_empid
        assert alloc_data["assigned_store_manager_username"] == sm_username
        assert alloc_data["status"] in ["DOCK_ASSIGNED", "OCCUPIED"]

        # -------------------------------------------------------------
        # STEP 2: RBAC Validation on Dock Release
        # -------------------------------------------------------------
        # 2a. Warehouse Manager attempt to release -> MUST BE 403 FORBIDDEN
        res_wm_release = await client.post(
            f"/api/v1/warehouse/dock-allocations/{alloc_req_id}/release",
            headers=wm_headers,
        )
        assert res_wm_release.status_code == 403, "Warehouse Manager should be forbidden from releasing dock"

        # 2b. Unassigned Store Manager from different store attempt -> MUST BE 403 FORBIDDEN
        res_other_sm_release = await client.post(
            f"/api/v1/warehouse/dock-allocations/{alloc_req_id}/release",
            headers=other_sm_headers,
        )
        assert res_other_sm_release.status_code == 403, "Unassigned Store Manager should be forbidden"

        # 2c. Assigned Store Manager attempt to release -> MUST SUCCEED 200
        res_sm_release = await client.post(
            f"/api/v1/warehouse/dock-allocations/{alloc_req_id}/release",
            headers=sm_headers,
        )
        assert res_sm_release.status_code == 200, res_sm_release.text
        assert res_sm_release.json()["status"] == "RELEASED"

        # -------------------------------------------------------------
        # STEP 3: Putaway Execution & Material QR Validation
        # -------------------------------------------------------------
        async with AsyncSessionFactory() as session:
            grn = GrnModel(
                id=grn_id,
                grn_number=grn_no,
                warehouse_id="MAIN",
                status="COMPLETED",
                received_by="wm_john",
                receipt_date=datetime.datetime.now(datetime.timezone.utc),
            )
            session.add(grn)
            await session.flush()

            putaway = PutawayTaskModel(
                id=putaway_id,
                task_number=f"PUT-{unique_suffix}",
                grn_id=grn_id,
                grn_number=grn_no,
                item_code=item_code,
                material_name=f"Heavy Industrial Steel Rod {unique_suffix}",
                quantity=Decimal("100.0"),
                uom="PCS",
                warehouse_id="MAIN",
                source_location="RECEIVING_DOCK",
                destination_store_id=store_id,
                destination_zone_id=zone_id,
                destination_bin_id=bin_id,
                destination_bin_code=bin_code,
                destination_zone=zone_code,
                status="PUTAWAY_IN_PROGRESS",
                created_by="wm_john",
                created_at=datetime.datetime.now(datetime.timezone.utc),
            )
            session.add(putaway)
            await session.commit()

        # Store Manager completes putaway scanning Material QR & Bin QR
        putaway_complete_payload = {
            "material_scan": material_qr_code,
            "location_scan": bin_code,
            "quantity": 100.0,
        }
        res_putaway = await client.post(
            f"/api/storage/putaway-tasks/{putaway_id}/complete",
            json=putaway_complete_payload,
            headers=sm_headers,
        )
        assert res_putaway.status_code == 200, res_putaway.text
        put_resp = res_putaway.json()
        assert put_resp["status"] == "PUTAWAY_COMPLETED"
        assert put_resp["inventory_available_after"] == 100.0

        # Verify Movement History record for PUTAWAY
        res_move_hist = await client.get(
            "/api/storage/inventory/movement-history?movement_type=PUTAWAY",
            headers=sm_headers,
        )
        assert res_move_hist.status_code == 200, res_move_hist.text
        hist_list = res_move_hist.json()
        putaway_hist = next((h for h in hist_list if h["material_code"] == item_code), None)
        assert putaway_hist is not None
        assert putaway_hist["movement_type"] == "PUTAWAY"
        assert putaway_hist["quantity"] == 100.0
        assert putaway_hist["material_qr"] == material_qr_code

        # -------------------------------------------------------------
        # STEP 4: Query Materials inside Bin
        # -------------------------------------------------------------
        res_bin_mats = await client.get(
            f"/api/v1/bins/{bin_code}/materials",
            headers=sm_headers,
        )
        assert res_bin_mats.status_code == 200, res_bin_mats.text
        bin_mat_data = res_bin_mats.json()
        assert bin_mat_data["bin_code"] == bin_code
        assert len(bin_mat_data["materials"]) >= 1
        mat_in_bin = next(m for m in bin_mat_data["materials"] if m["material_code"] == item_code)
        assert mat_in_bin["available_quantity"] == 100.0
        assert mat_in_bin["material_qr"] == material_qr_code

        # -------------------------------------------------------------
        # STEP 5: Store Manager Takeaway Execution
        # -------------------------------------------------------------
        takeaway_payload = {
            "bin_scan": bin_code,
            "material_scan": material_qr_code,
            "quantity": 35.0,
            "remarks": "Dispatching 35 units to Production Line A",
            "reference_document": f"REQ-PROD-{unique_suffix}",
        }
        res_takeaway = await client.post(
            "/api/storage/inventory/takeaway",
            json=takeaway_payload,
            headers=sm_headers,
        )
        assert res_takeaway.status_code == 200, res_takeaway.text
        takeaway_resp = res_takeaway.json()
        assert takeaway_resp["success"] is True
        assert takeaway_resp["takeaway_quantity"] == 35.0
        assert takeaway_resp["remaining_bin_quantity"] == 65.0
        assert takeaway_resp["total_stock_available"] == 65.0

        # Check that unauthorized role cannot takeaway
        res_unauth_takeaway = await client.post(
            "/api/storage/inventory/takeaway",
            json=takeaway_payload,
            headers={"Authorization": "Bearer token", "X-User-Roles": "VISITOR"},
        )
        assert res_unauth_takeaway.status_code == 403

        # -------------------------------------------------------------
        # STEP 6: Query Movement History Audit Trail
        # -------------------------------------------------------------
        res_all_hist = await client.get(
            f"/api/storage/inventory/movement-history?material_code={item_code}",
            headers=sm_headers,
        )
        assert res_all_hist.status_code == 200, res_all_hist.text
        all_hist = res_all_hist.json()
        assert len(all_hist) >= 2  # 1 PUTAWAY + 1 TAKEAWAY

        types = [h["movement_type"] for h in all_hist]
        assert "PUTAWAY" in types
        assert "TAKEAWAY" in types

        takeaway_record = next(h for h in all_hist if h["movement_type"] == "TAKEAWAY")
        assert takeaway_record["quantity"] == 35.0
        assert takeaway_record["stock_before"] == 100.0
        assert takeaway_record["stock_after"] == 65.0
        assert takeaway_record["store_code"] == store_code
