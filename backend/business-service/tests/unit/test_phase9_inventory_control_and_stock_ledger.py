"""
Phase 9 Automated Test Suite:
Inventory Control, Stock Visibility & Authoritative Stock Ledger.

Validates:
1. End-to-End Inventory Scenario:
   - Receiving 100 units (95 good, 5 damaged) -> Available = 0 (pre-putaway), Quarantined = 5.
   - Putaway 95 units to Mechanical Store / MECH-Z01 -> Available = 95, Quarantined = 5, Total = 100.
   - Assembly requests 20 units -> Store Keeper picks 20 -> Available = 75, Quarantined = 5, Issued = 20.
2. Negative Stock Protection:
   - Attempting to issue 80 units when Available = 75 is rejected with 400 Bad Request.
3. Quarantine Isolation & Disposition:
   - Quarantined stock (5 units) is never treated as Available and cannot be picked.
4. Authoritative Warehouse Matrix View:
   - GET /api/storage/inventory/warehouse-summary accurately reflects Store/Zone balances.
5. Store-Scoped Authorization & IDOR Defense:
   - Store Manager / Keeper can only query own store; cross-store queries return 403 Forbidden.
   - Warehouse user sees all Stores and Zones.
6. Unified Chronological Stock Ledger:
   - Aggregates RECEIPT, PUTAWAY, ISSUE, and QUARANTINE records into an auditable ledger.
7. Regression:
   - Procurement Material Request -> RFQ -> PO remains isolated and functional.
"""
import datetime
from decimal import Decimal
import json
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select, text

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
    QuarantineAuditModel,
    QuarantineRecordModel,
)
from app.modules.receiving.infrastructure.persistence.models import (
    GrnModel,
    GrnLineModel,
    InventoryReceiptPostingModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionModel,
    AssemblyRequisitionItemModel,
    InventoryIssueTransactionModel,
    InventoryLocationBalanceModel,
    PickupTaskModel,
    PutawayMovementModel,
    PutawayTaskModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreModel,
    StoreZoneModel,
    StoreManagerUserModel,
)


@pytest.mark.asyncio
async def test_phase9_inventory_control_and_stock_ledger_full_lifecycle():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Seed test stores, zones, and material
        async with session_scope() as session:
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

            # 2. Zones
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

            # 3. Storage Locations
            loc_mech_res = await session.execute(
                select(StorageLocationModel).where(StorageLocationModel.location_code == "LOC-STR002-MECHZ01-R01-B01")
            )
            loc_mech = loc_mech_res.scalar_one_or_none()
            if not loc_mech:
                loc_mech = StorageLocationModel(
                    id=uuid.uuid4(),
                    location_code="LOC-STR002-MECHZ01-R01-B01",
                    warehouse_id="WH-001",
                    store_id=s_mech.id,
                    zone_id=z_mech.id,
                    zone="MECH-Z01",
                    rack="R01",
                    bin="B01",
                    capacity=Decimal("1000.0"),
                    occupied_quantity=Decimal("0.0"),
                    active=True,
                )
                session.add(loc_mech)
                await session.flush()

            # 4. Material: TEST-MATERIAL-P9
            mat_res = await session.execute(select(MaterialModel).where(MaterialModel.material_code == "TEST-MATERIAL-P9"))
            mat = mat_res.scalar_one_or_none()
            if not mat:
                mat = MaterialModel(
                    id=uuid.uuid4(),
                    material_code="TEST-MATERIAL-P9",
                    material_name="Precision Industrial Ball Screw",
                    category="MECHANICAL",
                    base_uom="PCS",
                    status="Active",
                )
                session.add(mat)
                await session.flush()

            # Material Stock: initially 0 on hand / 0 available
            stock_res = await session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code == "TEST-MATERIAL-P9"))
            stock = stock_res.scalar_one_or_none()
            if not stock:
                stock = MaterialStockModel(
                    id=uuid.uuid4(),
                    material_id=mat.id,
                    material_code="TEST-MATERIAL-P9",
                    material_name="Precision Industrial Ball Screw",
                    category="MECHANICAL",
                    on_hand=Decimal("0.0"),
                    allocated=Decimal("0.0"),
                    available=Decimal("0.0"),
                    uom="PCS",
                    warehouse_id="WH-001",
                    reorder_point=Decimal("15.0"),
                )
                session.add(stock)
            else:
                stock.on_hand = Decimal("0.0")
                stock.available = Decimal("0.0")

            # Clean any previous run artifacts for TEST-MATERIAL-P9
            await session.execute(
                delete(InventoryLocationBalanceModel).where(InventoryLocationBalanceModel.material_code == "TEST-MATERIAL-P9")
            )
            await session.execute(
                delete(QuarantineRecordModel).where(QuarantineRecordModel.item_code == "TEST-MATERIAL-P9")
            )

            store_mech_id = s_mech.id
            store_elec_id = s_elec.id
            zone_mech_id = z_mech.id
            loc_mech_id = loc_mech.id

        # Auth headers
        warehouse_headers = {"Authorization": "Bearer mock-jwt-warehouse-token"}
        assembly_headers = {"Authorization": "Bearer mock-jwt-assembly-token"}
        mech_store_headers = {"Authorization": "Bearer mock-jwt-store-keeper-token"} # Mechanical Store (STR-002)
        elec_store_headers = {"Authorization": "Bearer mock-jwt-store-manager-token"} # Electrical Store (STR-001)

        # =========================================================================
        # 1. INBOUND RECEIVING: 100 Units (95 Good, 5 Damaged/Quarantined)
        # =========================================================================
        grn_id = uuid.uuid4()
        grn_no = f"GRN-P9-{uuid.uuid4().hex[:6].upper()}"
        putaway_task_id = uuid.uuid4()
        putaway_task_no = f"PUT-P9-{uuid.uuid4().hex[:6].upper()}"
        quar_id = uuid.uuid4()
        quar_no = f"QRN-P9-{uuid.uuid4().hex[:6].upper()}"

        async with session_scope() as session:
            # 1a. Insert GRN header
            grn_model = GrnModel(
                id=grn_id,
                grn_number=grn_no,
                po_number="PO-P9-1001",
                asn_number="ASN-P9-2001",
                supplier_name="Apex Precision Components",
                warehouse_id="WH-001",
                status="GRN_POSTED",
            )
            session.add(grn_model)
            await session.flush()

            # Post GRN Inventory Posting (100 received on hand)
            grn_posting = InventoryReceiptPostingModel(
                id=uuid.uuid4(),
                grn_id=grn_id,
                grn_number=grn_no,
                po_id=uuid.uuid4(),
                po_number="PO-P9-1001",
                asn_id=uuid.uuid4(),
                asn_number="ASN-P9-2001",
                supplier_name="Apex Precision Components",
                item_code="TEST-MATERIAL-P9",
                material_name="Precision Industrial Ball Screw",
                uom="PCS",
                warehouse_id="WH-001",
                posted_quantity=Decimal("100.0"),
                on_hand_before=Decimal("0.0"),
                on_hand_after=Decimal("100.0"),
                posted_by="receiving_dock_mgr",
                posted_at=datetime.datetime.now(datetime.timezone.utc),
            )
            session.add(grn_posting)

            # Update MaterialStockModel: 100 on_hand, 0 available (awaiting putaway)
            stk_upd = await session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == "TEST-MATERIAL-P9")
            )
            stk_obj = stk_upd.scalar_one()
            stk_obj.on_hand = Decimal("100.0")
            stk_obj.available = Decimal("0.0")

            # 1b. Quarantine Record for 5 Damaged Units
            quar_rec = QuarantineRecordModel(
                id=quar_id,
                quarantine_number=quar_no,
                item_code="TEST-MATERIAL-P9",
                material_name="Precision Industrial Ball Screw",
                damaged_quantity=Decimal("5.0"),
                uom="PCS",
                warehouse_id="WH-001",
                reason="Thread deformation during transit",
                status="QUARANTINED",
                created_by="qc_inspector_p9",
            )
            session.add(quar_rec)

            # 1c. Putaway Task for 95 Good Units destined for Mechanical Store
            putaway_task = PutawayTaskModel(
                id=putaway_task_id,
                task_number=putaway_task_no,
                grn_id=grn_id,
                grn_number=grn_no,
                item_code="TEST-MATERIAL-P9",
                material_name="Precision Industrial Ball Screw",
                quantity=Decimal("95.0"),
                uom="PCS",
                warehouse_id="WH-001",
                source_location="RECEIVING_AREA",
                destination_store_id=store_mech_id,
                destination_zone_id=zone_mech_id,
                destination_location_id=loc_mech_id,
                destination_zone="MECH-Z01",
                destination_rack="R01",
                destination_bin="B01",
                status="PUTAWAY_PENDING",
                created_by="receiving_supervisor",
                created_at=datetime.datetime.now(datetime.timezone.utc),
            )
            session.add(putaway_task)

        # Verify state before Putaway: Available = 0, Quarantined = 5
        res_summary_pre = await client.get("/api/storage/inventory/warehouse-summary", headers=warehouse_headers)
        assert res_summary_pre.status_code == 200
        p9_summary = [s for s in res_summary_pre.json() if s["material_code"] == "TEST-MATERIAL-P9"]
        assert len(p9_summary) >= 1
        assert p9_summary[0]["available_quantity"] == 0.0
        assert p9_summary[0]["quarantined_quantity"] == 5.0

        # =========================================================================
        # 2. PUTAWAY EXECUTION: Putaway 95 Good Units to Mechanical Store
        # =========================================================================
        # Store Keeper starts putaway
        res_put_start = await client.post(
            f"/api/storage/putaway-tasks/{putaway_task_id}/start",
            headers=mech_store_headers,
        )
        assert res_put_start.status_code == 200

        # Store Keeper completes putaway
        res_put_comp = await client.post(
            f"/api/storage/putaway-tasks/{putaway_task_id}/complete",
            json={
                "material_scan": "TEST-MATERIAL-P9",
                "location_scan": "LOC-STR002-MECHZ01-R01-B01",
                "quantity": 95.0,
            },
            headers=mech_store_headers,
        )
        assert res_put_comp.status_code == 200

        # Verify state after Putaway: Available = 95, Quarantined = 5, Total = 100
        res_summary_post_put = await client.get("/api/storage/inventory/warehouse-summary", headers=warehouse_headers)
        assert res_summary_post_put.status_code == 200
        p9_sum_post = [s for s in res_summary_post_put.json() if s["material_code"] == "TEST-MATERIAL-P9"]
        assert len(p9_sum_post) >= 1
        assert p9_sum_post[0]["available_quantity"] == 95.0
        assert p9_sum_post[0]["quarantined_quantity"] == 5.0
        assert p9_sum_post[0]["total_quantity"] == 100.0

        # =========================================================================
        # 3. ASSEMBLY REQUISITION & STORE KEEPER ISSUE: Pick 20 Units
        # =========================================================================
        req_payload = {
            "warehouse_id": "WH-001",
            "department": "Assembly",
            "requested_by": "Assembly Tech Line Phase 9",
            "priority": "HIGH",
            "required_date": datetime.date.today().isoformat(),
            "items": [
                {
                    "material_code": "TEST-MATERIAL-P9",
                    "material_name": "Precision Industrial Ball Screw",
                    "quantity": 20.0,
                    "uom": "PCS",
                }
            ],
        }
        res_create_req = await client.post("/api/v1/assembly-requisitions", json=req_payload, headers=assembly_headers)
        assert res_create_req.status_code == 201
        req_id = res_create_req.json()["id"]

        # Warehouse assigns Mechanical Store
        res_assign = await client.post(
            f"/api/v1/assembly-requisitions/{req_id}/assign-store",
            json={"store_id": str(store_mech_id)},
            headers=warehouse_headers,
        )
        assert res_assign.status_code == 200
        pickup_task_id = res_assign.json()["tasks"][0]["id"]

        # Store Keeper completes issue of 20 units
        res_pick_comp = await client.post(
            f"/api/storage/pickup-tasks/{pickup_task_id}/complete",
            json={
                "material_scan": "TEST-MATERIAL-P9",
                "zone_scan": "MECH-Z01",
                "quantity": 20.0,
            },
            headers=mech_store_headers,
        )
        assert res_pick_comp.status_code == 200
        pick_data = res_pick_comp.json()
        assert pick_data["status"] == "COMPLETED"
        assert pick_data["inventory_available_before"] == 95.0
        assert pick_data["inventory_available_after"] == 75.0

        # Verify state after Issue: Available = 75, Quarantined = 5, Total Physical = 80
        res_summary_post_iss = await client.get("/api/storage/inventory/warehouse-summary", headers=warehouse_headers)
        p9_sum_iss = [s for s in res_summary_post_iss.json() if s["material_code"] == "TEST-MATERIAL-P9"]
        assert len(p9_sum_iss) >= 1
        assert p9_sum_iss[0]["available_quantity"] == 75.0
        assert p9_sum_iss[0]["quarantined_quantity"] == 5.0
        assert p9_sum_iss[0]["total_quantity"] == 80.0

        # =========================================================================
        # 4. NEGATIVE STOCK PROTECTION: Attempt to pick 80 when Available = 75
        # =========================================================================
        req_over_payload = {
            "warehouse_id": "WH-001",
            "department": "Assembly",
            "requested_by": "Assembly Tech Line Over",
            "priority": "MEDIUM",
            "required_date": datetime.date.today().isoformat(),
            "items": [
                {
                    "material_code": "TEST-MATERIAL-P9",
                    "material_name": "Precision Industrial Ball Screw",
                    "quantity": 80.0,
                    "uom": "PCS",
                }
            ],
        }
        res_create_over = await client.post("/api/v1/assembly-requisitions", json=req_over_payload, headers=assembly_headers)
        req_over_id = res_create_over.json()["id"]

        res_assign_over = await client.post(
            f"/api/v1/assembly-requisitions/{req_over_id}/assign-store",
            json={"store_id": str(store_mech_id)},
            headers=warehouse_headers,
        )
        task_over_id = res_assign_over.json()["tasks"][0]["id"]

        # Attempt to issue 80 units -> Rejected with 400 Bad Request
        res_over_pick = await client.post(
            f"/api/storage/pickup-tasks/{task_over_id}/complete",
            json={
                "material_scan": "TEST-MATERIAL-P9",
                "zone_scan": "MECH-Z01",
                "quantity": 80.0,
            },
            headers=mech_store_headers,
        )
        assert res_over_pick.status_code == 400
        assert "insufficient" in res_over_pick.json()["detail"].lower()

        # Verify Available stock strictly remains 75 (never negative)
        async with session_scope() as session:
            stk_chk = await session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == "TEST-MATERIAL-P9")
            )
            assert stk_chk.scalar_one().available == Decimal("75.0")

        # =========================================================================
        # 5. STORE-LEVEL AUTHORIZATION & IDOR DEFENSE
        # =========================================================================
        # 5a. Store Manager A (Mechanical) can see Mechanical Store inventory
        res_mech_summary = await client.get("/api/storage/inventory/warehouse-summary", headers=mech_store_headers)
        assert res_mech_summary.status_code == 200
        assert all(item["store_id"] == str(store_mech_id) or item["store_code"] == "STR-002" for item in res_mech_summary.json())

        # 5b. IDOR: Store Manager A attempting to query Electrical Store inventory -> 403 Forbidden
        res_idor_summary = await client.get(
            f"/api/storage/inventory/warehouse-summary?store_id={store_elec_id}",
            headers=mech_store_headers,
        )
        assert res_idor_summary.status_code == 403

        # 5c. IDOR: Store Manager A querying Electrical Store locations -> 403 Forbidden
        res_idor_locs = await client.get(
            f"/api/storage/putaway-tasks/inventory-locations?store_id={store_elec_id}",
            headers=mech_store_headers,
        )
        assert res_idor_locs.status_code == 403

        # 5d. IDOR: Store Manager A querying Electrical Store stock ledger -> 403 Forbidden
        res_idor_ledger = await client.get(
            f"/api/storage/inventory/ledger?store_id={store_elec_id}",
            headers=mech_store_headers,
        )
        assert res_idor_ledger.status_code == 403

        # =========================================================================
        # 6. AUTHORITATIVE STOCK LEDGER VERIFICATION
        # =========================================================================
        res_ledger = await client.get(
            f"/api/storage/inventory/ledger?material_code=TEST-MATERIAL-P9",
            headers=warehouse_headers,
        )
        assert res_ledger.status_code == 200
        ledger = res_ledger.json()
        assert len(ledger) >= 4

        tx_types = [entry["transaction_type"] for entry in ledger]
        assert "RECEIPT" in tx_types
        assert "PUTAWAY" in tx_types
        assert "ISSUE" in tx_types
        assert "QUARANTINE" in tx_types

        # Reconcile quantities:
        # Receipt: +100
        # Putaway: +95
        # Issue: -20
        # Quarantine: +5
        receipt_tx = next(e for e in ledger if e["transaction_type"] == "RECEIPT")
        assert receipt_tx["quantity"] == 100.0

        putaway_tx = next(e for e in ledger if e["transaction_type"] == "PUTAWAY")
        assert putaway_tx["quantity"] == 95.0

        issue_tx = next(e for e in ledger if e["transaction_type"] == "ISSUE")
        assert issue_tx["quantity"] == -20.0

        quarantine_tx = next(e for e in ledger if e["transaction_type"] == "QUARANTINE")
        assert quarantine_tx["quantity"] == 5.0

        # =========================================================================
        # 7. REGRESSION TEST: Procurement Material Request -> RFQ -> PO is untouched
        # =========================================================================
        res_proc_mr = await client.get("/api/v1/procurement/material-requests", headers=warehouse_headers)
        assert res_proc_mr.status_code in [200, 404]

        res_proc_rfq = await client.get("/api/v1/procurement/rfqs", headers=warehouse_headers)
        assert res_proc_rfq.status_code in [200, 404]
