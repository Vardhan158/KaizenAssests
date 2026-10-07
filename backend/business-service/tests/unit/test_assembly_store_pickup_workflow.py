import datetime
from decimal import Decimal
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, text

from app.main import app
from app.database.session import session_scope
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialModel,
    MaterialStockModel,
    NotificationModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionModel,
    AssemblyRequisitionItemModel,
    InventoryIssueTransactionModel,
    InventoryLocationBalanceModel,
    PickupTaskModel,
    PutawayTaskModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreManagerUserModel,
    StoreModel,
    StoreZoneModel,
)


@pytest.mark.asyncio
async def test_assembly_store_pickup_full_lifecycle_and_security():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Seed test stores, zones, materials, and stock
        async with session_scope() as session:
            now_utc = datetime.datetime.now(datetime.timezone.utc)
            
            # 1. Stores: Mechanical Store (STR-002) and Electrical Store (STR-001)
            store_mech = await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-002"))
            s_mech = store_mech.scalar_one_or_none()
            if not s_mech:
                s_mech = StoreModel(
                    id=uuid.uuid4(),
                    store_code="STR-002",
                    store_name="Mechanical Store",
                    warehouse_id="WH-001",
                    status="ACTIVE",
                )
                session.add(s_mech)
                await session.flush()

            store_elec = await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-001"))
            s_elec = store_elec.scalar_one_or_none()
            if not s_elec:
                s_elec = StoreModel(
                    id=uuid.uuid4(),
                    store_code="STR-001",
                    store_name="Electrical Store",
                    warehouse_id="WH-001",
                    status="ACTIVE",
                )
                session.add(s_elec)
                await session.flush()

            # 2. Zones for each store
            zone_mech = await session.execute(select(StoreZoneModel).where(StoreZoneModel.zone_code == "Z-MECH-01"))
            z_mech = zone_mech.scalar_one_or_none()
            if not z_mech:
                z_mech = StoreZoneModel(
                    id=uuid.uuid4(),
                    store_id=s_mech.id,
                    zone_code="Z-MECH-01",
                    zone_name="Mechanical Zone 1",
                    status="ACTIVE",
                )
                session.add(z_mech)
                await session.flush()

            zone_elec = await session.execute(select(StoreZoneModel).where(StoreZoneModel.zone_code == "Z-ELEC-01"))
            z_elec = zone_elec.scalar_one_or_none()
            if not z_elec:
                z_elec = StoreZoneModel(
                    id=uuid.uuid4(),
                    store_id=s_elec.id,
                    zone_code="Z-ELEC-01",
                    zone_name="Electrical Zone 1",
                    status="ACTIVE",
                )
                session.add(z_elec)
                await session.flush()

            # 3. Storage Locations
            loc_mech_res = await session.execute(select(StorageLocationModel).where(StorageLocationModel.location_code == "LOC-MECH-01"))
            loc_mech = loc_mech_res.scalar_one_or_none()
            if not loc_mech:
                loc_mech = StorageLocationModel(
                    id=uuid.uuid4(),
                    location_code="LOC-MECH-01",
                    warehouse_id="WH-001",
                    store_id=s_mech.id,
                    zone_id=z_mech.id,
                    zone="Z-MECH-01",
                    rack="R1",
                    bin="B1",
                    capacity=Decimal("1000.0"),
                    occupied_quantity=Decimal("0.0"),
                    active=True,
                )
                session.add(loc_mech)
                await session.flush()

            # 4. Material and Stock
            mat_res = await session.execute(select(MaterialModel).where(MaterialModel.material_code == "MAT-MOTOR-001"))
            mat = mat_res.scalar_one_or_none()
            if not mat:
                mat = MaterialModel(
                    id=uuid.uuid4(),
                    material_code="MAT-MOTOR-001",
                    material_name="Servo Motor 500W",
                    category="MOTORS",
                    base_uom="PCS",
                    status="Active",
                )
                session.add(mat)
                await session.flush()

            stock_res = await session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code == "MAT-MOTOR-001"))
            stock = stock_res.scalar_one_or_none()
            if not stock:
                stock = MaterialStockModel(
                    id=uuid.uuid4(),
                    material_id=mat.id,
                    material_code="MAT-MOTOR-001",
                    material_name="Servo Motor 500W",
                    category="MOTORS",
                    on_hand=Decimal("100.0"),
                    allocated=Decimal("0.0"),
                    available=Decimal("100.0"),
                    uom="PCS",
                    warehouse_id="WH-001",
                )
                session.add(stock)
            else:
                stock.on_hand = Decimal("100.0")
                stock.available = Decimal("100.0")

            # 4b. Seed GRN and Putaway Task for Foreign Key
            grn_id = uuid.uuid4()
            await session.execute(
                text("INSERT INTO grn (id, grn_number, warehouse_id, status) VALUES (:id, :grn_num, 'WH-001', 'GRN_POSTED') ON CONFLICT DO NOTHING"),
                {"id": grn_id, "grn_num": "GRN-INIT-001"}
            )
            await session.flush()

            pt_res = await session.execute(select(PutawayTaskModel).where(PutawayTaskModel.task_number == "PT-INIT-001"))
            pt = pt_res.scalar_one_or_none()
            if not pt:
                pt = PutawayTaskModel(
                    id=uuid.uuid4(),
                    task_number="PT-INIT-001",
                    grn_id=grn_id,
                    grn_number="GRN-INIT-001",
                    item_code="MAT-MOTOR-001",
                    material_name="Servo Motor 500W",
                    quantity=Decimal("100.0"),
                    uom="PCS",
                    warehouse_id="WH-001",
                    source_location="Dock 1",
                    status="COMPLETED",
                    created_by="system",
                    created_at=now_utc,
                )
                session.add(pt)
                await session.flush()

            # 5. Inventory Location Balance
            bal_res = await session.execute(
                select(InventoryLocationBalanceModel).where(
                    InventoryLocationBalanceModel.material_code == "MAT-MOTOR-001",
                    InventoryLocationBalanceModel.storage_location_id == loc_mech.id,
                )
            )
            bal = bal_res.scalar_one_or_none()
            if not bal:
                bal = InventoryLocationBalanceModel(
                    id=uuid.uuid4(),
                    material_code="MAT-MOTOR-001",
                    material_name="Servo Motor 500W",
                    warehouse_id="WH-001",
                    storage_location_id=loc_mech.id,
                    quantity=Decimal("100.0"),
                    available_quantity=Decimal("100.0"),
                    uom="PCS",
                    last_putaway_task_id=pt.id,
                    last_grn_number="GRN-INIT-001",
                    updated_at=now_utc,
                )
                session.add(bal)
            else:
                bal.quantity = Decimal("100.0")
                bal.available_quantity = Decimal("100.0")

            store_mech_id = s_mech.id
            store_elec_id = s_elec.id
            zone_mech_id = z_mech.id
            zone_elec_id = z_elec.id

        # Authentication headers
        assembly_headers = {"Authorization": "Bearer mock-jwt-assembly-token"}
        warehouse_headers = {"Authorization": "Bearer mock-jwt-warehouse-token"}
        store_keeper_mech_headers = {"Authorization": "Bearer mock-jwt-store-keeper-token"} # STR-002
        store_manager_elec_headers = {"Authorization": "Bearer mock-jwt-store-manager-token"} # STR-001

        # -------------------------------------------------------------
        # 1. Assembly Creates Assembly Material Requisition
        # -------------------------------------------------------------
        req_payload = {
            "warehouse_id": "WH-001",
            "department": "Assembly",
            "requested_by": "Assembly Operator 1",
            "priority": "HIGH",
            "required_date": (datetime.date.today() + datetime.timedelta(days=2)).isoformat(),
            "remarks": "Urgent motors required for Line 3 assembly",
            "items": [
                {
                    "material_code": "MAT-MOTOR-001",
                    "material_name": "Servo Motor 500W",
                    "quantity": 10.0,
                    "uom": "PCS",
                }
            ],
        }
        res_create = await client.post("/api/v1/assembly-requisitions", json=req_payload, headers=assembly_headers)
        assert res_create.status_code == 201, res_create.text
        created_data = res_create.json()
        req_number = created_data.get("requisition_number") or created_data.get("requisitionNumber")
        assert req_number.startswith("AR-")

        # -------------------------------------------------------------
        # 2. Assembly Views Own Requests
        # -------------------------------------------------------------
        res_list = await client.get("/api/v1/assembly-requisitions", headers=assembly_headers)
        assert res_list.status_code == 200
        ar_list = res_list.json()
        matching_ar = next((m for m in ar_list if (m.get("requisition_number") or m.get("requisitionNumber")) == req_number), None)
        assert matching_ar is not None
        ar_id = matching_ar["id"]
        assert matching_ar["status"] == "PENDING"
        assert (matching_ar.get("priority") or "MEDIUM") == "HIGH"
        assert matching_ar["department"] == "Assembly"

        # -------------------------------------------------------------
        # 3. Warehouse Views and Assigns Mechanical Store
        # -------------------------------------------------------------
        # Non-warehouse user cannot assign store
        res_fail_assign = await client.post(
            f"/api/v1/assembly-requisitions/{ar_id}/assign-store",
            json={"store_id": str(store_mech_id)},
            headers=assembly_headers,
        )
        assert res_fail_assign.status_code == 403

        # Warehouse assigns Mechanical Store
        res_assign = await client.post(
            f"/api/v1/assembly-requisitions/{ar_id}/assign-store",
            json={"store_id": str(store_mech_id)},
            headers=warehouse_headers,
        )
        assert res_assign.status_code == 200, res_assign.text
        assign_data = res_assign.json()
        assert assign_data["status"] == "success"
        assert assign_data["assigned_store"]["store_code"] == "STR-002"
        assert len(assign_data["tasks"]) == 1
        task_id = assign_data["tasks"][0]["id"]
        task_number = assign_data["tasks"][0]["task_number"]
        assert task_number.startswith("PCK-")

        # -------------------------------------------------------------
        # 4. Notifications Verification (Mechanical Store targeted)
        # -------------------------------------------------------------
        async with session_scope() as session:
            notif_res = await session.execute(
                select(NotificationModel).where(
                    NotificationModel.user_role == "STR:STR-002"
                )
            )
            notifs = notif_res.scalars().all()
            assert len(notifs) >= 1
            assert any(req_number in n.message for n in notifs)

            # Ensure Electrical Store STR:STR-001 did NOT get assigned notification
            elec_notif_res = await session.execute(
                select(NotificationModel).where(
                    NotificationModel.user_role == "STR:STR-001"
                )
            )
            elec_notifs = elec_notif_res.scalars().all()
            assert not any(req_number in n.message for n in elec_notifs)

        # -------------------------------------------------------------
        # 5. Store Keeper Scoped Task Listing
        # -------------------------------------------------------------
        # Mechanical Store Keeper sees the task
        res_sk_tasks = await client.get("/api/storage/pickup-tasks", headers=store_keeper_mech_headers)
        assert res_sk_tasks.status_code == 200
        mech_tasks = res_sk_tasks.json()
        assert any(t["id"] == task_id for t in mech_tasks)

        # Electrical Store Manager does NOT see Mechanical store task
        res_elec_tasks = await client.get("/api/storage/pickup-tasks", headers=store_manager_elec_headers)
        assert res_elec_tasks.status_code == 200
        elec_tasks = res_elec_tasks.json()
        assert not any(t["id"] == task_id for t in elec_tasks)

        # -------------------------------------------------------------
        # 6. IDOR Protection (Cross-Store Access Blocked)
        # -------------------------------------------------------------
        res_idor_get = await client.get(f"/api/storage/pickup-tasks/{task_id}", headers=store_manager_elec_headers)
        assert res_idor_get.status_code == 403

        res_idor_start = await client.post(f"/api/storage/pickup-tasks/{task_id}/start", headers=store_manager_elec_headers)
        assert res_idor_start.status_code == 403

        # -------------------------------------------------------------
        # 7. Start Pickup Task by Mechanical Store Keeper
        # -------------------------------------------------------------
        res_start = await client.post(f"/api/storage/pickup-tasks/{task_id}/start", headers=store_keeper_mech_headers)
        assert res_start.status_code == 200
        started_task = res_start.json()
        assert started_task["status"] == "PICKING"

        # -------------------------------------------------------------
        # 8. Physical Pick Validations (QR, Zone, Stock)
        # -------------------------------------------------------------
        # 8a. Wrong Material QR scan rejection
        res_wrong_mat = await client.post(
            f"/api/storage/pickup-tasks/{task_id}/complete",
            json={
                "material_scan": "MAT-WRONG-999",
                "zone_scan": "Z-MECH-01",
                "quantity": 10.0,
            },
            headers=store_keeper_mech_headers,
        )
        assert res_wrong_mat.status_code == 422
        assert "material" in res_wrong_mat.json()["detail"].lower()

        # 8b. Cross-Store Zone QR scan rejection
        res_wrong_zone = await client.post(
            f"/api/storage/pickup-tasks/{task_id}/complete",
            json={
                "material_scan": "MAT-MOTOR-001",
                "zone_scan": "Z-ELEC-01", # Belongs to STR-001, not STR-002
                "quantity": 10.0,
            },
            headers=store_keeper_mech_headers,
        )
        assert res_wrong_zone.status_code == 422
        assert "zone" in res_wrong_zone.json()["detail"].lower()

        # 8c. Excessive quantity rejection
        res_over_qty = await client.post(
            f"/api/storage/pickup-tasks/{task_id}/complete",
            json={
                "material_scan": "MAT-MOTOR-001",
                "zone_scan": "Z-MECH-01",
                "quantity": 9999.0,
            },
            headers=store_keeper_mech_headers,
        )
        assert res_over_qty.status_code == 422

        # -------------------------------------------------------------
        # 9. Successful Pick & Handover Confirmation
        # -------------------------------------------------------------
        res_complete = await client.post(
            f"/api/storage/pickup-tasks/{task_id}/complete",
            json={
                "material_scan": '{"material_code": "MAT-MOTOR-001", "batch": "B1"}',
                "zone_scan": "Z-MECH-01",
                "quantity": 10.0,
            },
            headers=store_keeper_mech_headers,
        )
        assert res_complete.status_code == 200, res_complete.text
        complete_data = res_complete.json()
        assert complete_data["status"] == "COMPLETED"
        assert complete_data["picked_quantity"] == 10.0
        assert complete_data["issue_number"].startswith("ISS-")
        assert complete_data["inventory_available_before"] == 100.0
        assert complete_data["inventory_available_after"] == 90.0

        # -------------------------------------------------------------
        # 10. Idempotency / Double Pick Prevention
        # -------------------------------------------------------------
        res_double_pick = await client.post(
            f"/api/storage/pickup-tasks/{task_id}/complete",
            json={
                "material_scan": "MAT-MOTOR-001",
                "zone_scan": "Z-MECH-01",
                "quantity": 10.0,
            },
            headers=store_keeper_mech_headers,
        )
        assert res_double_pick.status_code == 409

        # -------------------------------------------------------------
        # 11. Database Audit and Stock Verification
        # -------------------------------------------------------------
        async with session_scope() as session:
            # MaterialStock verification
            stock_check = await session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == "MAT-MOTOR-001")
            )
            s = stock_check.scalar_one()
            assert s.on_hand == Decimal("90.0")
            assert s.available == Decimal("90.0")

            # Outbound Issue Transaction Audit
            tx_check = await session.execute(
                select(InventoryIssueTransactionModel).where(
                    InventoryIssueTransactionModel.pickup_task_id == uuid.UUID(task_id)
                )
            )
            tx = tx_check.scalar_one_or_none()
            assert tx is not None
            assert tx.quantity == Decimal("10.0")
            assert tx.stock_before == Decimal("100.0")
            assert tx.stock_after == Decimal("90.0")
            assert tx.store_code == "STR-002"
            assert tx.zone_code == "Z-MECH-01"
            assert tx.recipient_department == "Assembly"

            # Assembly Requisition lifecycle
            ar_check = await session.execute(
                select(AssemblyRequisitionModel).where(AssemblyRequisitionModel.id == uuid.UUID(ar_id))
            )
            ar_final = ar_check.scalar_one()
            assert ar_final.status == "COMPLETED"


@pytest.mark.asyncio
async def test_assembly_requisition_material_availability_and_store_assignment_gating():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {"Authorization": "Bearer local_dev_mock_token"}

        # 1. Setup Material Master with limited stock (available = 15.0)
        async with session_scope() as session:
            mat_res = await session.execute(
                select(MaterialModel).where(MaterialModel.material_code == "MAT-AVAIL-TEST-01")
            )
            mat = mat_res.scalar_one_or_none()
            if not mat:
                mat = MaterialModel(
                    id=uuid.uuid4(),
                    material_code="MAT-AVAIL-TEST-01",
                    material_name="Availability Test Component",
                    category="Raw Materials",
                    base_uom="PCS",
                    status="ACTIVE",
                )
                session.add(mat)
                await session.flush()

            stk_res = await session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == "MAT-AVAIL-TEST-01")
            )
            stk = stk_res.scalar_one_or_none()
            if not stk:
                stk = MaterialStockModel(
                    id=uuid.uuid4(),
                    material_id=mat.id,
                    material_code="MAT-AVAIL-TEST-01",
                    material_name="Availability Test Component",
                    category="Raw Materials",
                    uom="PCS",
                    warehouse_id="WH-001",
                    on_hand=Decimal("15.0"),
                    available=Decimal("15.0"),
                    allocated=Decimal("0.0"),
                )
                session.add(stk)
            else:
                stk.available = Decimal("15.0")
                stk.on_hand = Decimal("15.0")
            await session.commit()

        # 2. Create Requisition with quantity = 50.0 (Shortage scenario: required 50 > available 15)
        res_create = await client.post(
            "/api/v1/assembly-requisitions",
            json={
                "warehouse_id": "WH-001",
                "department": "Assembly Line B",
                "requested_by": "Test Shortage Operator",
                "priority": "HIGH",
                "required_date": "2026-10-01",
                "remarks": "Testing shortage availability gating",
                "items": [
                    {
                        "material_id": str(mat.id),
                        "material_code": "MAT-AVAIL-TEST-01",
                        "material_name": "Availability Test Component",
                        "quantity": 50.0,
                        "uom": "PCS",
                    }
                ],
            },
            headers=headers,
        )
        assert res_create.status_code == 201, res_create.text
        req_data = res_create.json()
        req_id = req_data["id"]

        # Verify availability response payload indicates shortage and can_assign_store = False
        assert req_data["allItemsAvailable"] is False or req_data.get("all_items_available") is False
        assert req_data["canAssignStore"] is False or req_data.get("can_assign_store") is False
        assert req_data["availabilityStatus"] == "SHORTAGE" or req_data.get("availability_status") == "SHORTAGE"
        avail_msg = req_data.get("availabilityMessage") or req_data.get("availability_message") or ""
        assert "Material shortage" in avail_msg and "Store assignment unavailable" in avail_msg
        assert req_data["items"][0]["hasSufficientStock"] is False
        assert float(req_data["items"][0]["availableQuantity"]) == 15.0
        assert float(req_data["items"][0]["shortageQuantity"]) == 35.0

        # 3. Attempt to Assign Store during shortage -> Must be rejected with HTTP 400
        # Get a valid store id
        stores_res = await client.get("/api/v1/stores", headers=headers)
        store_id = stores_res.json()[0]["id"]

        res_assign_shortage = await client.post(
            f"/api/v1/assembly-requisitions/{req_id}/assign-store",
            json={"store_id": store_id},
            headers=headers,
        )
        assert res_assign_shortage.status_code == 400
        assert "Material shortage" in res_assign_shortage.text and "Store assignment unavailable" in res_assign_shortage.text

        # 4. Replenish inventory (available = 100.0)
        async with session_scope() as session:
            stk_res = await session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == "MAT-AVAIL-TEST-01")
            )
            stk = stk_res.scalar_one()
            stk.available = Decimal("100.0")
            stk.on_hand = Decimal("100.0")
            await session.commit()

        # 5. Fetch Requisition details -> Now allItemsAvailable = True & canAssignStore = True
        res_get = await client.get(
            f"/api/v1/assembly-requisitions/{req_id}",
            headers=headers,
        )
        assert res_get.status_code == 200
        get_data = res_get.json()
        assert get_data["allItemsAvailable"] is True or get_data.get("all_items_available") is True
        assert get_data["canAssignStore"] is True or get_data.get("can_assign_store") is True
        assert get_data["availabilityStatus"] == "AVAILABLE" or get_data.get("availability_status") == "AVAILABLE"
        assert get_data["items"][0]["hasSufficientStock"] is True
        assert float(get_data["items"][0]["availableQuantity"]) == 100.0
        assert float(get_data["items"][0]["shortageQuantity"]) == 0.0

        # 6. Assign Store now succeeds and transitions to ASSIGNED_TO_STORE
        res_assign_ok = await client.post(
            f"/api/v1/assembly-requisitions/{req_id}/assign-store",
            json={"store_id": store_id},
            headers=headers,
        )
        assert res_assign_ok.status_code == 200, res_assign_ok.text
        assign_data = res_assign_ok.json()
        assert assign_data["status"] == "success"
        assert assign_data["assigned_store"]["id"] == store_id

        # Verify Requisition status updated to ASSIGNED_TO_STORE
        res_get_assigned = await client.get(
            f"/api/v1/assembly-requisitions/{req_id}",
            headers=headers,
        )
        assert res_get_assigned.status_code == 200
        assert res_get_assigned.json()["status"] == "ASSIGNED_TO_STORE"


@pytest.mark.asyncio
async def test_assembly_requisition_reservation_shortage_and_store_visibility_acceptance():
    """
    Acceptance test:
    Create an Assembly Requisition for: Motor = 10
    with warehouse available stock: Motor = 6
    Expected:
    Required 10 -> Available 6 -> Reserve 6 -> Shortage 4 -> Create Material Request for 4 -> Store sees 6 reserved for Assembly
    After the remaining 4 is received and becomes available, requisition proceeds through Store assignment.
    """
    from app.modules.storage.infrastructure.persistence.models import AssemblyStockReservationModel
    from app.modules.procurement.infrastructure.persistence.models import MaterialRequestModel

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {"X-User-Roles": "WAREHOUSE,ADMIN", "X-User-Name": "warehouse_mgr"}

        async with session_scope() as session:
            now_utc = datetime.datetime.now(datetime.timezone.utc)

            # 0. Clean up any prior test reservations for MAT-MOTOR-TEST
            await session.execute(
                delete(AssemblyStockReservationModel).where(
                    AssemblyStockReservationModel.material_code == "MAT-MOTOR-TEST"
                )
            )
            await session.flush()

            # 1. Ensure Store exists
            s_res = await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-RES-01"))
            store_res = s_res.scalar_one_or_none()
            if not store_res:
                store_res = StoreModel(
                    id=uuid.uuid4(),
                    store_code="STR-RES-01",
                    store_name="Component Central Store",
                    warehouse_id="WH-001",
                    status="ACTIVE",
                )
                session.add(store_res)
                await session.flush()

            # 2. Ensure Storage Location exists
            loc_res = await session.execute(
                select(StorageLocationModel).where(StorageLocationModel.location_code == "LOC-MOTOR-01")
            )
            loc = loc_res.scalar_one_or_none()
            if not loc:
                loc = StorageLocationModel(
                    id=uuid.uuid4(),
                    location_code="LOC-MOTOR-01",
                    warehouse_id="WH-001",
                    store_id=store_res.id,
                    zone="Z-A1",
                    rack="R-01",
                    bin="B-01",
                    capacity=Decimal("1000.0"),
                    occupied_quantity=Decimal("6.0"),
                    active=True,
                )
                session.add(loc)
                await session.flush()

            # 3. Create Motor Material Master
            mat_res = await session.execute(select(MaterialModel).where(MaterialModel.material_code == "MAT-MOTOR-TEST"))
            mat = mat_res.scalar_one_or_none()
            if not mat:
                mat = MaterialModel(
                    id=uuid.uuid4(),
                    material_code="MAT-MOTOR-TEST",
                    material_name="Heavy Duty Motor",
                    category="MOTORS",
                    base_uom="PCS",
                    status="Active",
                )
                session.add(mat)
                await session.flush()

            # 4. Set Initial warehouse available stock = 6
            stock_res = await session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code == "MAT-MOTOR-TEST"))
            stock = stock_res.scalar_one_or_none()
            if not stock:
                stock = MaterialStockModel(
                    id=uuid.uuid4(),
                    material_id=mat.id,
                    material_code="MAT-MOTOR-TEST",
                    material_name="Heavy Duty Motor",
                    category="MOTORS",
                    on_hand=Decimal("6.0"),
                    allocated=Decimal("0.0"),
                    available=Decimal("6.0"),
                    uom="PCS",
                    warehouse_id="WH-001",
                )
                session.add(stock)
            else:
                stock.on_hand = Decimal("6.0")
                stock.available = Decimal("6.0")

            # 4b. Seed GRN and Putaway Task for Foreign Key
            grn_id = uuid.uuid4()
            await session.execute(
                text("INSERT INTO grn (id, grn_number, warehouse_id, status) VALUES (:id, :grn_num, 'WH-001', 'GRN_POSTED') ON CONFLICT DO NOTHING"),
                {"id": grn_id, "grn_num": "GRN-MOTOR-001"}
            )
            await session.flush()

            pt_res = await session.execute(select(PutawayTaskModel).where(PutawayTaskModel.task_number == "PT-MOTOR-001"))
            pt = pt_res.scalar_one_or_none()
            if not pt:
                pt = PutawayTaskModel(
                    id=uuid.uuid4(),
                    task_number="PT-MOTOR-001",
                    grn_id=grn_id,
                    grn_number="GRN-MOTOR-001",
                    item_code="MAT-MOTOR-TEST",
                    material_name="Heavy Duty Motor",
                    quantity=Decimal("6.0"),
                    uom="PCS",
                    warehouse_id="WH-001",
                    source_location="Dock 1",
                    status="COMPLETED",
                    created_by="system",
                    created_at=now_utc,
                )
                session.add(pt)
                await session.flush()

            # 5. Set Location Balance = 6
            bal_res = await session.execute(
                select(InventoryLocationBalanceModel).where(
                    InventoryLocationBalanceModel.material_code == "MAT-MOTOR-TEST",
                    InventoryLocationBalanceModel.storage_location_id == loc.id,
                )
            )
            bal = bal_res.scalar_one_or_none()
            if not bal:
                bal = InventoryLocationBalanceModel(
                    id=uuid.uuid4(),
                    material_code="MAT-MOTOR-TEST",
                    material_name="Heavy Duty Motor",
                    warehouse_id="WH-001",
                    storage_location_id=loc.id,
                    quantity=Decimal("6.0"),
                    available_quantity=Decimal("6.0"),
                    uom="PCS",
                    last_putaway_task_id=pt.id,
                    last_grn_number="GRN-MOTOR-001",
                    updated_at=now_utc,
                )
                session.add(bal)
            else:
                bal.quantity = Decimal("6.0")
                bal.available_quantity = Decimal("6.0")
                bal.last_putaway_task_id = pt.id

            await session.commit()

        # Step 1: Create Assembly Requisition for Motor = 10
        res_create = await client.post(
            "/api/v1/assembly-requisitions",
            json={
                "warehouse_id": "WH-001",
                "department": "Assembly",
                "requested_by": "Assembly Lead",
                "priority": "HIGH",
                "required_date": str(datetime.date.today() + datetime.timedelta(days=2)),
                "items": [
                    {
                        "material_id": str(mat.id),
                        "material_code": "MAT-MOTOR-TEST",
                        "material_name": "Heavy Duty Motor",
                        "quantity": 10.0,
                        "uom": "PCS",
                    }
                ],
            },
            headers=headers,
        )
        assert res_create.status_code == 201, res_create.text
        req_data = res_create.json()
        req_id = req_data["id"]

        # Step 2: Check Initial Stock Availability in Requisition View
        # Required: 10 | Available: 6 | Reserved: 0 | Shortage: 4
        item_data = req_data["items"][0]
        assert float(item_data["requiredQuantity"]) == 10.0
        assert float(item_data["availableQuantity"]) == 6.0
        assert float(item_data["reservedQuantity"]) == 0.0
        assert float(item_data["shortageQuantity"]) == 4.0
        assert req_data["canAssignStore"] is False

        # Step 3: Reserve Available Stock
        res_reserve = await client.post(
            f"/api/v1/assembly-requisitions/{req_id}/reserve-stock",
            headers=headers,
        )
        assert res_reserve.status_code == 200, res_reserve.text
        res_data = res_reserve.json()
        reserved_item = res_data["items"][0]

        # Verify: Required: 10 | Available: 6 | Reserved: 6 | Shortage: 4
        assert float(reserved_item["requiredQuantity"]) == 10.0
        assert float(reserved_item["reservedQuantity"]) == 6.0
        assert float(reserved_item["shortageQuantity"]) == 4.0

        # Verify duplicate reservation clicking does not duplicate / over-reserve
        res_reserve_again = await client.post(
            f"/api/v1/assembly-requisitions/{req_id}/reserve-stock",
            headers=headers,
        )
        assert res_reserve_again.status_code == 200
        assert float(res_reserve_again.json()["items"][0]["reservedQuantity"]) == 6.0

        # Verify physical stock was NOT deducted
        async with session_scope() as session:
            stk_chk = (
                await session.execute(
                    select(MaterialStockModel).where(MaterialStockModel.material_code == "MAT-MOTOR-TEST")
                )
            ).scalar_one()
            assert float(stk_chk.on_hand) == 6.0

        # Step 4: Create Material Request for remaining shortage (quantity strictly = 4)
        res_mr = await client.post(
            f"/api/v1/assembly-requisitions/{req_id}/create-material-request",
            headers=headers,
        )
        assert res_mr.status_code == 200, res_mr.text
        mr_data = res_mr.json()
        assert mr_data["status"] == "success"
        assert mr_data["items_count"] == 1
        assert float(mr_data["items"][0]["quantity"]) == 4.0
        assert mr_data["items"][0]["material_code"] == "MAT-MOTOR-TEST"

        # Step 5: Verify Store Login Visibility
        store_metrics_res = await client.get(
            f"/api/v1/stores/{store_res.id}/dashboard-metrics",
            headers=headers,
        )
        assert store_metrics_res.status_code == 200, store_metrics_res.text
        metrics_payload = store_metrics_res.json()
        reservations_list = metrics_payload.get("assembly_reservations", [])
        matching_res = next((r for r in reservations_list if r["material_code"] == "MAT-MOTOR-TEST"), None)
        assert matching_res is not None
        assert float(matching_res["required_quantity"]) == 10.0
        assert float(matching_res["reserved_quantity"]) == 6.0
        assert matching_res["status"] == "RESERVED FOR ASSEMBLY"

        # Step 6: Store assignment rejected while shortage exists
        res_assign_fail = await client.post(
            f"/api/v1/assembly-requisitions/{req_id}/assign-store",
            json={"store_id": str(store_res.id)},
            headers=headers,
        )
        assert res_assign_fail.status_code == 400
        assert "shortage" in res_assign_fail.text.lower()

        # Step 7: Replenish remaining 4 so available = 10
        async with session_scope() as session:
            stk_res = await session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == "MAT-MOTOR-TEST")
            )
            stk = stk_res.scalar_one()
            stk.available = Decimal("10.0")
            stk.on_hand = Decimal("10.0")

            bal_res = await session.execute(
                select(InventoryLocationBalanceModel).where(
                    InventoryLocationBalanceModel.material_code == "MAT-MOTOR-TEST",
                    InventoryLocationBalanceModel.storage_location_id == loc.id,
                )
            )
            bal = bal_res.scalar_one()
            bal.available_quantity = Decimal("10.0")
            bal.quantity = Decimal("10.0")
            await session.commit()

        # Check requisition: canAssignStore becomes True
        res_req_ready = await client.get(f"/api/v1/assembly-requisitions/{req_id}", headers=headers)
        assert res_req_ready.status_code == 200
        assert res_req_ready.json()["canAssignStore"] is True

        # Step 8: Assign Store proceeds successfully
        res_assign_ok = await client.post(
            f"/api/v1/assembly-requisitions/{req_id}/assign-store",
            json={"store_id": str(store_res.id)},
            headers=headers,
        )
        assert res_assign_ok.status_code == 200
        assert res_assign_ok.json()["status"] == "success"


@pytest.mark.asyncio
async def test_assembly_requisition_automatic_store_assignment():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        async with session_scope() as session:
            # 1. Create 2 stores: Store A (Main Raw Material Store) and Store B (Electrical Store)
            store_a = StoreModel(
                id=uuid.uuid4(),
                store_code=f"STR-AUTO-A-{uuid.uuid4().hex[:4].upper()}",
                store_name="MAIN RAW MATERIAL STORE",
                warehouse_id="WH-AUTO-01",
                status="ACTIVE",
            )
            store_b = StoreModel(
                id=uuid.uuid4(),
                store_code=f"STR-AUTO-B-{uuid.uuid4().hex[:4].upper()}",
                store_name="ELECTRICAL STORE",
                warehouse_id="WH-AUTO-01",
                status="ACTIVE",
            )
            session.add_all([store_a, store_b])
            await session.flush()

            # 2. Locations
            loc_a = StorageLocationModel(
                id=uuid.uuid4(),
                location_code=f"LOC-A-{uuid.uuid4().hex[:4]}",
                warehouse_id="WH-AUTO-01",
                store_id=store_a.id,
                zone="A",
                rack="01",
                bin="01",
                capacity=Decimal("1000.0"),
                occupied_quantity=Decimal("0.0"),
                active=True,
            )
            loc_b = StorageLocationModel(
                id=uuid.uuid4(),
                location_code=f"LOC-B-{uuid.uuid4().hex[:4]}",
                warehouse_id="WH-AUTO-01",
                store_id=store_b.id,
                zone="B",
                rack="01",
                bin="01",
                capacity=Decimal("1000.0"),
                occupied_quantity=Decimal("0.0"),
                active=True,
            )
            session.add_all([loc_a, loc_b])
            await session.flush()

            # 3. Material: Motor
            mat_code = f"MAT-MOT-{uuid.uuid4().hex[:4].upper()}"
            mat = MaterialModel(
                id=uuid.uuid4(),
                material_code=mat_code,
                material_name="Auto Test Motor",
                category="Raw Materials",
                base_uom="PCS",
                status="Active",
            )
            session.add(mat)
            await session.flush()

            # Store A has 10 available, Store B has 0
            stk = MaterialStockModel(
                id=uuid.uuid4(),
                material_id=mat.id,
                material_code=mat_code,
                material_name="Auto Test Motor",
                category="Raw Materials",
                on_hand=Decimal("10.0"),
                allocated=Decimal("0.0"),
                available=Decimal("10.0"),
                uom="PCS",
                warehouse_id="WH-AUTO-01",
            )
            # GRN and Putaway task for FK
            grn_id = uuid.uuid4()
            await session.execute(
                text("INSERT INTO grn (id, grn_number, warehouse_id, status) VALUES (:id, :grn_num, 'WH-AUTO-01', 'GRN_POSTED') ON CONFLICT DO NOTHING"),
                {"id": grn_id, "grn_num": f"GRN-AUTO-{uuid.uuid4().hex[:6]}"}
            )
            await session.flush()

            pt = PutawayTaskModel(
                id=uuid.uuid4(),
                task_number=f"PT-AUTO-{uuid.uuid4().hex[:6]}",
                grn_id=grn_id,
                grn_number="GRN-AUTO",
                item_code=mat_code,
                material_name="Auto Test Motor",
                quantity=Decimal("10.0"),
                uom="PCS",
                warehouse_id="WH-AUTO-01",
                source_location="Dock 1",
                status="COMPLETED",
                created_by="system",
                created_at=now_utc,
            )
            session.add(pt)
            await session.flush()

            bal_a = InventoryLocationBalanceModel(
                id=uuid.uuid4(),
                material_code=mat_code,
                material_name="Auto Test Motor",
                warehouse_id="WH-AUTO-01",
                storage_location_id=loc_a.id,
                quantity=Decimal("10.0"),
                available_quantity=Decimal("10.0"),
                uom="PCS",
                last_putaway_task_id=pt.id,
                last_grn_number="GRN-AUTO-01",
                updated_at=now_utc,
            )
            session.add_all([stk, bal_a])
            await session.commit()

        headers = {
            "x-user-id": str(uuid.uuid4()),
            "x-user-roles": "WAREHOUSE,WAREHOUSE_MANAGER",
            "x-user-username": "warehouse_auto_test",
        }

        # 4. Create Assembly Requisition for 10 units
        create_res = await client.post(
            "/api/v1/assembly-requisitions",
            json={
                "warehouse_id": "WH-AUTO-01",
                "department": "Assembly",
                "requested_by": "Assembly Operator",
                "priority": "HIGH",
                "required_date": now_utc.date().isoformat(),
                "items": [
                    {
                        "material_id": str(mat.id),
                        "material_code": mat_code,
                        "material_name": "Auto Test Motor",
                        "quantity": 10.0,
                        "uom": "PCS",
                    }
                ],
            },
            headers=headers,
        )
        assert create_res.status_code == 201, create_res.text
        req_data = create_res.json()
        req_id = req_data["id"]

        # Verify suggested store is automatically determined as Store A
        assert req_data["suggestedStoreId"] == str(store_a.id)
        assert req_data["suggestedStoreCode"] == store_a.store_code
        assert req_data["suggestedStoreName"] == "MAIN RAW MATERIAL STORE"
        assert req_data["canAssignStore"] is True

        # 5. Automatically assign store without passing store_id
        assign_res = await client.post(
            f"/api/v1/assembly-requisitions/{req_id}/assign-store",
            json={},  # Empty payload -> system automatically determines Store
            headers=headers,
        )
        assert assign_res.status_code == 200, assign_res.text
        assign_data = assign_res.json()
        assert assign_data["status"] == "success"
        assert assign_data["assigned_store"]["id"] == str(store_a.id)
        assert assign_data["assigned_store"]["store_name"] == "MAIN RAW MATERIAL STORE"

        # Verify pickup task was created for Store A
        async with session_scope() as session:
            pck_res = await session.execute(
                select(PickupTaskModel).where(PickupTaskModel.requisition_id == uuid.UUID(req_id))
            )
            tasks = pck_res.scalars().all()
            assert len(tasks) == 1
            assert tasks[0].store_id == store_a.id
            assert tasks[0].store_name == "MAIN RAW MATERIAL STORE"



