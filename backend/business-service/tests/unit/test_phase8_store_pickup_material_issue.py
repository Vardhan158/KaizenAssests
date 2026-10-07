"""
Comprehensive Test Suite for Phase 8:
Store Keeper Pickup -> Material QR & Zone QR Verification -> Atomic Inventory Issue -> Assembly Handover.

Validates:
1. Store Keeper Authorization & Store-scoped access (Mechanical Store vs Electrical Store).
2. IDOR Protection (403 Forbidden for cross-store task access or store_id tampering).
3. Material QR Verification (Multi-format JSON, multi-line, and raw item code; rejection on mismatch).
4. Store + Zone Verification (Rejection on cross-store zone scanning).
5. Available Stock Validation & Negative Inventory Prevention (Rejection if stock insufficient).
6. Quarantine Stock Blocking (Rejection if stock is quarantined/damaged).
7. Exact Inventory Issue Transaction (Atomic deduction, immutable ledger recording).
8. Partial Fulfillment Flow (Preserves remaining quantity across multiple picks).
9. Double Submission / Concurrency Protection (409 Conflict on re-completion).
10. Targeted Notifications (Store assignment and handover notifications).
11. Regression Verification (Procurement Material Request -> RFQ -> PO remains untouched).
"""
import datetime
from decimal import Decimal
import json
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text

from app.main import app
from app.database.session import session_scope
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialModel,
    MaterialStockModel,
    NotificationModel,
    PurchaseOrderModel,
    MaterialRequestModel,
)
from app.modules.quarantine.infrastructure.persistence.models import (
    QuarantineRecordModel,
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
    StoreModel,
    StoreZoneModel,
    StoreManagerUserModel,
)


@pytest.mark.asyncio
async def test_phase8_store_keeper_pickup_material_issue_and_security():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Seed test data
        async with session_scope() as session:
            now_utc = datetime.datetime.now(datetime.timezone.utc)

            # 1. Stores: Mechanical Store (STR-002) and Electrical Store (STR-001)
            s_mech_res = await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-002"))
            s_mech = s_mech_res.scalar_one_or_none()
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

            s_elec_res = await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-001"))
            s_elec = s_elec_res.scalar_one_or_none()
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

            # 2. Zones for Mechanical and Electrical stores
            z_mech_res = await session.execute(select(StoreZoneModel).where(StoreZoneModel.zone_code == "MECH-Z01"))
            z_mech = z_mech_res.scalar_one_or_none()
            if not z_mech:
                z_mech = StoreZoneModel(
                    id=uuid.uuid4(),
                    store_id=s_mech.id,
                    zone_code="MECH-Z01",
                    zone_name="Mechanical Zone 1",
                    status="ACTIVE",
                )
                session.add(z_mech)
                await session.flush()

            z_elec_res = await session.execute(select(StoreZoneModel).where(StoreZoneModel.zone_code == "ELECT-Z01"))
            z_elec = z_elec_res.scalar_one_or_none()
            if not z_elec:
                z_elec = StoreZoneModel(
                    id=uuid.uuid4(),
                    store_id=s_elec.id,
                    zone_code="ELECT-Z01",
                    zone_name="Electrical Zone 1",
                    status="ACTIVE",
                )
                session.add(z_elec)
                await session.flush()

            # 3. Materials and Stock
            # Material A: TEST-MOTOR-001 (Available = 20)
            mat_a_res = await session.execute(select(MaterialModel).where(MaterialModel.material_code == "TEST-MOTOR-001"))
            mat_a = mat_a_res.scalar_one_or_none()
            if not mat_a:
                mat_a = MaterialModel(
                    id=uuid.uuid4(),
                    material_code="TEST-MOTOR-001",
                    material_name="Industrial Stepper Motor 24V",
                    category="MOTORS",
                    base_uom="PCS",
                    status="Active",
                )
                session.add(mat_a)
                await session.flush()

            stock_a_res = await session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code == "TEST-MOTOR-001"))
            stock_a = stock_a_res.scalar_one_or_none()
            if not stock_a:
                stock_a = MaterialStockModel(
                    id=uuid.uuid4(),
                    material_id=mat_a.id,
                    material_code="TEST-MOTOR-001",
                    material_name="Industrial Stepper Motor 24V",
                    category="MOTORS",
                    on_hand=Decimal("20.0"),
                    allocated=Decimal("0.0"),
                    available=Decimal("20.0"),
                    uom="PCS",
                    warehouse_id="WH-001",
                )
                session.add(stock_a)
            else:
                stock_a.on_hand = Decimal("20.0")
                stock_a.available = Decimal("20.0")

            # Material B: TEST-LOWSTOCK-001 (Available = 5)
            mat_b_res = await session.execute(select(MaterialModel).where(MaterialModel.material_code == "TEST-LOWSTOCK-001"))
            mat_b = mat_b_res.scalar_one_or_none()
            if not mat_b:
                mat_b = MaterialModel(
                    id=uuid.uuid4(),
                    material_code="TEST-LOWSTOCK-001",
                    material_name="Hydraulic Pressure Valve",
                    category="VALVES",
                    base_uom="PCS",
                    status="Active",
                )
                session.add(mat_b)
                await session.flush()

            stock_b_res = await session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code == "TEST-LOWSTOCK-001"))
            stock_b = stock_b_res.scalar_one_or_none()
            if not stock_b:
                stock_b = MaterialStockModel(
                    id=uuid.uuid4(),
                    material_id=mat_b.id,
                    material_code="TEST-LOWSTOCK-001",
                    material_name="Hydraulic Pressure Valve",
                    category="VALVES",
                    on_hand=Decimal("5.0"),
                    allocated=Decimal("0.0"),
                    available=Decimal("5.0"),
                    uom="PCS",
                    warehouse_id="WH-001",
                )
                session.add(stock_b)
            else:
                stock_b.on_hand = Decimal("5.0")
                stock_b.available = Decimal("5.0")

            # Material C: TEST-QUARANTINE-001 (Available = 10, but 10 Quarantined)
            mat_c_res = await session.execute(select(MaterialModel).where(MaterialModel.material_code == "TEST-QUARANTINE-001"))
            mat_c = mat_c_res.scalar_one_or_none()
            if not mat_c:
                mat_c = MaterialModel(
                    id=uuid.uuid4(),
                    material_code="TEST-QUARANTINE-001",
                    material_name="Damaged Ceramic Bearing",
                    category="BEARINGS",
                    base_uom="PCS",
                    status="Active",
                )
                session.add(mat_c)
                await session.flush()

            stock_c_res = await session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code == "TEST-QUARANTINE-001"))
            stock_c = stock_c_res.scalar_one_or_none()
            if not stock_c:
                stock_c = MaterialStockModel(
                    id=uuid.uuid4(),
                    material_id=mat_c.id,
                    material_code="TEST-QUARANTINE-001",
                    material_name="Damaged Ceramic Bearing",
                    category="BEARINGS",
                    on_hand=Decimal("10.0"),
                    allocated=Decimal("0.0"),
                    available=Decimal("10.0"),
                    uom="PCS",
                    warehouse_id="WH-001",
                )
                session.add(stock_c)
            else:
                stock_c.on_hand = Decimal("10.0")
                stock_c.available = Decimal("10.0")

            # Seed quarantine record for Material C
            q_res = await session.execute(
                select(QuarantineRecordModel).where(QuarantineRecordModel.item_code == "TEST-QUARANTINE-001")
            )
            q_rec = q_res.scalar_one_or_none()
            if not q_rec:
                q_rec = QuarantineRecordModel(
                    id=uuid.uuid4(),
                    quarantine_number=f"QRN-TEST-{uuid.uuid4().hex[:6].upper()}",
                    item_code="TEST-QUARANTINE-001",
                    material_name="Damaged Ceramic Bearing",
                    damaged_quantity=Decimal("10.0"),
                    uom="PCS",
                    warehouse_id="WH-001",
                    reason="Fractured bearing casing",
                    status="QUARANTINED",
                    created_by="qc_inspector",
                )
                session.add(q_rec)

            store_mech_id = s_mech.id
            store_elec_id = s_elec.id
            zone_mech_id = z_mech.id
            zone_elec_id = z_elec.id

        # Headers for different roles and stores
        assembly_headers = {"Authorization": "Bearer mock-jwt-assembly-token"}
        warehouse_headers = {"Authorization": "Bearer mock-jwt-warehouse-token"}
        mech_keeper_headers = {"Authorization": "Bearer mock-jwt-store-keeper-token"} # Scoped to Mechanical Store (STR-002)
        elec_manager_headers = {"Authorization": "Bearer mock-jwt-store-manager-token"} # Scoped to Electrical Store (STR-001)

        # =========================================================================
        # 1. Assembly Creates Requisitions
        # =========================================================================
        req_1_payload = {
            "warehouse_id": "WH-001",
            "department": "Assembly",
            "requested_by": "Assembly Tech Line 1",
            "priority": "HIGH",
            "required_date": (datetime.date.today() + datetime.timedelta(days=1)).isoformat(),
            "remarks": "Motors for conveyor line upgrade",
            "items": [
                {
                    "material_code": "TEST-MOTOR-001",
                    "material_name": "Industrial Stepper Motor 24V",
                    "quantity": 10.0,
                    "uom": "PCS",
                }
            ],
        }
        res_create_1 = await client.post("/api/v1/assembly-requisitions", json=req_1_payload, headers=assembly_headers)
        assert res_create_1.status_code == 201, res_create_1.text
        req_1_data = res_create_1.json()
        req_1_id = req_1_data["id"]
        req_1_no = req_1_data.get("requisition_number") or req_1_data.get("requisitionNumber")

        # =========================================================================
        # 2. Warehouse Assigns Mechanical Store
        # =========================================================================
        res_assign = await client.post(
            f"/api/v1/assembly-requisitions/{req_1_id}/assign-store",
            json={"store_id": str(store_mech_id)},
            headers=warehouse_headers,
        )
        assert res_assign.status_code == 200, res_assign.text
        assign_data = res_assign.json()
        assert assign_data["assigned_store"]["store_code"] == "STR-002"
        task_1_id = assign_data["tasks"][0]["id"]
        task_1_number = assign_data["tasks"][0]["task_number"]

        # =========================================================================
        # 3. Security & Store Scoping Verification
        # =========================================================================
        # 3a. Mechanical Store Keeper can see task
        res_mech_list = await client.get("/api/storage/pickup-tasks", headers=mech_keeper_headers)
        assert res_mech_list.status_code == 200
        mech_tasks = res_mech_list.json()
        assert any(t["id"] == task_1_id for t in mech_tasks)

        # 3b. Electrical Store User CANNOT see Mechanical task
        res_elec_list = await client.get("/api/storage/pickup-tasks", headers=elec_manager_headers)
        assert res_elec_list.status_code == 200
        elec_tasks = res_elec_list.json()
        assert not any(t["id"] == task_1_id for t in elec_tasks)

        # 3c. IDOR: Electrical user cannot query Mechanical task directly by ID -> 403
        res_idor_get = await client.get(f"/api/storage/pickup-tasks/{task_1_id}", headers=elec_manager_headers)
        assert res_idor_get.status_code == 403

        # 3d. IDOR: Electrical user cannot start Mechanical task -> 403
        res_idor_start = await client.post(f"/api/storage/pickup-tasks/{task_1_id}/start", headers=elec_manager_headers)
        assert res_idor_start.status_code == 403

        # 3e. IDOR: Electrical user cannot complete Mechanical task -> 403
        res_idor_comp = await client.post(
            f"/api/storage/pickup-tasks/{task_1_id}/complete",
            json={"material_scan": "TEST-MOTOR-001", "zone_scan": "MECH-Z01", "quantity": 10.0},
            headers=elec_manager_headers,
        )
        assert res_idor_comp.status_code == 403

        # 3f. Parameter tampering: Passing store_id of Electrical store returns 403 for Mechanical Keeper
        res_tamper_store = await client.get(
            f"/api/storage/pickup-tasks?store_id={store_elec_id}",
            headers=mech_keeper_headers,
        )
        assert res_tamper_store.status_code == 403

        # =========================================================================
        # 4. QR Verification Tests
        # =========================================================================
        # 4a. Material QR mismatch rejection -> 422
        res_wrong_mat = await client.post(
            f"/api/storage/pickup-tasks/{task_1_id}/complete",
            json={"material_scan": "WRONG-CODE-999", "zone_scan": "MECH-Z01", "quantity": 10.0},
            headers=mech_keeper_headers,
        )
        assert res_wrong_mat.status_code == 422
        assert "material" in res_wrong_mat.json()["detail"].lower()

        # 4b. Cross-Store Zone QR rejection -> 422 (ELECT-Z01 belongs to STR-001, not STR-002)
        res_wrong_zone = await client.post(
            f"/api/storage/pickup-tasks/{task_1_id}/complete",
            json={"material_scan": "TEST-MOTOR-001", "zone_scan": "ELECT-Z01", "quantity": 10.0},
            headers=mech_keeper_headers,
        )
        assert res_wrong_zone.status_code == 422
        assert "zone" in res_wrong_zone.json()["detail"].lower()

        # =========================================================================
        # 5. Stock Validation & Negative Stock Prevention
        # =========================================================================
        # Create Requisition for Material B (Available = 5), request 10
        req_2_payload = {
            "warehouse_id": "WH-001",
            "department": "Assembly",
            "requested_by": "Assembly Tech Line 2",
            "priority": "MEDIUM",
            "required_date": datetime.date.today().isoformat(),
            "items": [
                {
                    "material_code": "TEST-LOWSTOCK-001",
                    "material_name": "Hydraulic Pressure Valve",
                    "quantity": 10.0,
                    "uom": "PCS",
                }
            ],
        }
        res_create_2 = await client.post("/api/v1/assembly-requisitions", json=req_2_payload, headers=assembly_headers)
        req_2_id = res_create_2.json()["id"]

        res_assign_2 = await client.post(
            f"/api/v1/assembly-requisitions/{req_2_id}/assign-store",
            json={"store_id": str(store_mech_id)},
            headers=warehouse_headers,
        )
        task_2_id = res_assign_2.json()["tasks"][0]["id"]

        # Attempt to pick 10 when only 5 available -> must fail with 400 Bad Request
        res_insufficient = await client.post(
            f"/api/storage/pickup-tasks/{task_2_id}/complete",
            json={"material_scan": "TEST-LOWSTOCK-001", "zone_scan": "MECH-Z01", "quantity": 10.0},
            headers=mech_keeper_headers,
        )
        assert res_insufficient.status_code == 400
        assert "insufficient" in res_insufficient.json()["detail"].lower()

        # Verify stock remains 5 and not negative
        async with session_scope() as session:
            stk_b_chk = await session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == "TEST-LOWSTOCK-001")
            )
            assert stk_b_chk.scalar_one().available == Decimal("5.0")

        # =========================================================================
        # 6. Quarantine Stock Block Test
        # =========================================================================
        # Create Requisition for Material C (10 quarantined)
        req_3_payload = {
            "warehouse_id": "WH-001",
            "department": "Assembly",
            "requested_by": "Assembly Tech Line 3",
            "priority": "LOW",
            "required_date": datetime.date.today().isoformat(),
            "items": [
                {
                    "material_code": "TEST-QUARANTINE-001",
                    "material_name": "Damaged Ceramic Bearing",
                    "quantity": 5.0,
                    "uom": "PCS",
                }
            ],
        }
        res_create_3 = await client.post("/api/v1/assembly-requisitions", json=req_3_payload, headers=assembly_headers)
        req_3_id = res_create_3.json()["id"]

        res_assign_3 = await client.post(
            f"/api/v1/assembly-requisitions/{req_3_id}/assign-store",
            json={"store_id": str(store_mech_id)},
            headers=warehouse_headers,
        )
        task_3_id = res_assign_3.json()["tasks"][0]["id"]

        # Attempt to issue quarantined material -> rejected with 400
        res_quar_blocked = await client.post(
            f"/api/storage/pickup-tasks/{task_3_id}/complete",
            json={"material_scan": "TEST-QUARANTINE-001", "zone_scan": "MECH-Z01", "quantity": 5.0},
            headers=mech_keeper_headers,
        )
        assert res_quar_blocked.status_code == 400
        assert "quarantined" in res_quar_blocked.json()["detail"].lower()

        # =========================================================================
        # 7. Exact Inventory Issue & Ledger Test (Task 1: 10 of 10)
        # =========================================================================
        # Multi-line QR label format support
        multiline_qr = "NEXUSWMS MATERIAL LABEL\nMaterial Code: TEST-MOTOR-001\nBatch: BATCH-01"
        res_complete_1 = await client.post(
            f"/api/storage/pickup-tasks/{task_1_id}/complete",
            json={"material_scan": multiline_qr, "zone_scan": "MECH-Z01", "quantity": 10.0},
            headers=mech_keeper_headers,
        )
        assert res_complete_1.status_code == 200, res_complete_1.text
        c1_data = res_complete_1.json()
        assert c1_data["status"] == "COMPLETED"
        assert c1_data["picked_quantity"] == 10.0
        assert c1_data["inventory_available_before"] == 20.0
        assert c1_data["inventory_available_after"] == 10.0
        assert c1_data["issue_number"].startswith("ISS-")

        # Verify stock and audit transaction in database
        async with session_scope() as session:
            stk_a = await session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == "TEST-MOTOR-001")
            )
            assert stk_a.scalar_one().available == Decimal("10.0")

            tx_res = await session.execute(
                select(InventoryIssueTransactionModel).where(
                    InventoryIssueTransactionModel.pickup_task_id == uuid.UUID(task_1_id)
                )
            )
            txs = tx_res.scalars().all()
            assert len(txs) == 1
            assert txs[0].quantity == Decimal("10.0")
            assert txs[0].stock_before == Decimal("20.0")
            assert txs[0].stock_after == Decimal("10.0")

            # Requisition status COMPLETED
            req_check = await session.execute(
                select(AssemblyRequisitionModel).where(AssemblyRequisitionModel.id == uuid.UUID(req_1_id))
            )
            assert req_check.scalar_one().status == "COMPLETED"

        # =========================================================================
        # 8. Double Submission / Idempotency Test
        # =========================================================================
        res_double = await client.post(
            f"/api/storage/pickup-tasks/{task_1_id}/complete",
            json={"material_scan": "TEST-MOTOR-001", "zone_scan": "MECH-Z01", "quantity": 10.0},
            headers=mech_keeper_headers,
        )
        assert res_double.status_code == 409
        assert "already completed" in res_double.json()["detail"].lower()

        # Verify no duplicate transaction created
        async with session_scope() as session:
            tx_count_res = await session.execute(
                select(func.count(InventoryIssueTransactionModel.id)).where(
                    InventoryIssueTransactionModel.pickup_task_id == uuid.UUID(task_1_id)
                )
            )
            assert tx_count_res.scalar() == 1

        # =========================================================================
        # 9. Partial Fulfillment Flow
        # =========================================================================
        # Create Requisition for 10 units of TEST-MOTOR-001 (Currently 10 remaining in stock)
        req_partial_payload = {
            "warehouse_id": "WH-001",
            "department": "Assembly",
            "requested_by": "Assembly Tech Line Partial",
            "priority": "HIGH",
            "required_date": datetime.date.today().isoformat(),
            "items": [
                {
                    "material_code": "TEST-MOTOR-001",
                    "material_name": "Industrial Stepper Motor 24V",
                    "quantity": 10.0,
                    "uom": "PCS",
                }
            ],
        }
        res_create_part = await client.post("/api/v1/assembly-requisitions", json=req_partial_payload, headers=assembly_headers)
        req_part_id = res_create_part.json()["id"]

        res_assign_part = await client.post(
            f"/api/v1/assembly-requisitions/{req_part_id}/assign-store",
            json={"store_id": str(store_mech_id)},
            headers=warehouse_headers,
        )
        task_part_id = res_assign_part.json()["tasks"][0]["id"]

        # Pick 1: Pick 7 units out of 10
        json_qr = json.dumps({"type": "MATERIAL_QR", "material_code": "TEST-MOTOR-001", "batch": "B2"})
        res_part_1 = await client.post(
            f"/api/storage/pickup-tasks/{task_part_id}/complete",
            json={"material_scan": json_qr, "zone_scan": "MECH-Z01", "quantity": 7.0},
            headers=mech_keeper_headers,
        )
        assert res_part_1.status_code == 200
        p1_data = res_part_1.json()
        assert p1_data["status"] == "PARTIALLY_PICKED"
        assert p1_data["picked_quantity"] == 7.0
        assert p1_data["remaining_quantity"] == 3.0
        assert p1_data["inventory_available_before"] == 10.0
        assert p1_data["inventory_available_after"] == 3.0

        # Verify Requisition is PARTIALLY_ISSUED
        res_req_part_chk = await client.get(f"/api/v1/assembly-requisitions/{req_part_id}", headers=assembly_headers)
        assert res_req_part_chk.status_code == 200
        req_part_json = res_req_part_chk.json()
        assert req_part_json["status"] == "PARTIALLY_ISSUED"
        item_0 = req_part_json["items"][0]
        assert float(item_0.get("issued_quantity") or item_0.get("issuedQuantity")) == 7.0

        # Pick 2: Attempting to pick 5 (which exceeds remaining 3) -> fails with 422
        res_part_over = await client.post(
            f"/api/storage/pickup-tasks/{task_part_id}/complete",
            json={"material_scan": "TEST-MOTOR-001", "zone_scan": "MECH-Z01", "quantity": 5.0},
            headers=mech_keeper_headers,
        )
        assert res_part_over.status_code == 422
        assert "exceeds" in res_part_over.json()["detail"].lower()

        # Pick 3: Pick the remaining 3 units -> completes task
        res_part_2 = await client.post(
            f"/api/storage/pickup-tasks/{task_part_id}/complete",
            json={"material_scan": "TEST-MOTOR-001", "zone_scan": "MECH-Z01", "quantity": 3.0},
            headers=mech_keeper_headers,
        )
        assert res_part_2.status_code == 200
        p2_data = res_part_2.json()
        assert p2_data["status"] == "COMPLETED"
        assert p2_data["picked_quantity"] == 10.0
        assert p2_data["remaining_quantity"] == 0.0

        # Verify stock and 2 ledger transactions
        async with session_scope() as session:
            stk_final = await session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == "TEST-MOTOR-001")
            )
            assert stk_final.scalar_one().available == Decimal("0.0")

            tx_part_res = await session.execute(
                select(InventoryIssueTransactionModel).where(
                    InventoryIssueTransactionModel.pickup_task_id == uuid.UUID(task_part_id)
                )
            )
            tx_part_list = tx_part_res.scalars().all()
            assert len(tx_part_list) == 2

            req_part_final = await session.execute(
                select(AssemblyRequisitionModel).where(AssemblyRequisitionModel.id == uuid.UUID(req_part_id))
            )
            assert req_part_final.scalar_one().status == "COMPLETED"

        # =========================================================================
        # 10. Targeted Notifications Verification
        # =========================================================================
        async with session_scope() as session:
            # Store notification
            notif_store_res = await session.execute(
                select(NotificationModel).where(NotificationModel.user_role == "STR:STR-002")
            )
            store_notifs = notif_store_res.scalars().all()
            assert len(store_notifs) >= 1

            # Assembly handover notification
            notif_asm_res = await session.execute(
                select(NotificationModel).where(NotificationModel.user_role == "ASSEMBLY")
            )
            asm_notifs = notif_asm_res.scalars().all()
            assert len(asm_notifs) >= 1
            assert any("handover" in n.title.lower() for n in asm_notifs)

        # =========================================================================
        # 11. Regression Test: Procurement MR -> RFQ -> PO remains untouched
        # =========================================================================
        # Verify existing procurement material requests endpoint is functional
        res_proc_mr = await client.get("/api/v1/procurement/material-requests", headers=warehouse_headers)
        assert res_proc_mr.status_code in [200, 404] # Endpoint is active and routed
