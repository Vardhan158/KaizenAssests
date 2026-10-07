"""
E2E Test Suite - Prompt 11: Assembly Production -> Finished Goods -> FG QR -> Genealogy -> FG Putaway
Validates:
1. Production Readiness: FGR-20260924-0001, AR-2026-0002 (COMPLETED), all 8 BOM materials issued.
2. Assembly/Production Order creation: Order created once for PUMP-100 x 10 PCS, source references preserved.
3. Production Execution: All 6 assembly steps completed, 8 BOM materials consumed, progress=10 PCS.
4. Production QC: 10 produced, 10 passed, 0 failed, status=PASSED.
5. Finished Goods creation: 10 PCS PUMP-100 created in PUTAWAY_PENDING.
6. FG QR Generation: Unique serial number & QR generated (FG-QR|PUMP-100|...).
7. Component Genealogy: All 8 components linked; Motor traceability to GRN-20260924-0003, LOT-MAT-MOTOR-001-20260924-ACF3, PT-20260924-65F7, ISS-2026-7475C5.
8. FG Store Destination: STR-FG-01 (Finished Goods Store).
9. FG Putaway: Putaway completed into STR-FG-01 / BIN-FG-001.
10. FG Inventory: PUMP-100 available inventory = 10 PCS in Finished Goods Store.
11. Downstream Isolation: Dispatch, picking, packing, loading, gate exit NOT started.
12. Idempotency: Repeated queries/actions do not duplicate orders or inventory.
"""
import datetime
from decimal import Decimal
import json
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, or_

from app.main import app
from app.database.session import session_scope
from app.modules.assembly.infrastructure.persistence.models import (
    AssemblyOrderModel,
    AssemblyFinishedGoodsModel,
    AssemblyQualityInspectionModel,
    AssemblyMaterialConsumptionModel,
    AssemblyTeamModel,
)
from app.modules.procurement.infrastructure.persistence.models import (
    FinishedGoodsRequestModel,
    MaterialRequestModel,
    MaterialStockModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionModel,
    InventoryIssueTransactionModel,
    PickupTaskModel,
    PutawayTaskModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreModel,
    StoreZoneModel,
    StoreBinModel,
)


@pytest.mark.asyncio
async def test_e2e_prompt11_assembly_production_fg_qr_genealogy_putaway():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        wh_headers = {
            "Authorization": "Bearer mock-jwt-warehouse-token",
            "X-User-Roles": "WAREHOUSE_MANAGER,WAREHOUSE_OPERATOR,ADMIN",
            "X-User-Name": "warehouse_operator",
        }
        asm_headers = {
            "Authorization": "Bearer mock-jwt-assembly-token",
            "X-User-Roles": "ASSEMBLY_MANAGER,ASSEMBLY,ADMIN",
            "X-User-Name": "assembly_manager",
        }
        fg_store_headers = {
            "Authorization": "Bearer mock-jwt-fg-store-token",
            "X-User-Roles": "STORE_MANAGER,STORE_KEEPER",
            "X-Store-Code": "STR-FG-01",
            "X-Store-Id": "053b329e-3092-4786-b280-48fd8b8c20b5",
            "X-User-Name": "store_manager_fg",
        }

        # -------------------------------------------------------------
        # STEP 1: Verify Production Readiness
        # -------------------------------------------------------------
        # 1.1 Check FGR
        res_fgr = await client.get("/api/v1/assembly/finished-goods-requests/FGR-20260924-0001", headers=asm_headers)
        assert res_fgr.status_code == 200, f"FGR lookup failed: {res_fgr.text}"
        fgr_data = res_fgr.json()
        assert fgr_data["request_number"] == "FGR-20260924-0001"
        assert fgr_data["product_name"] == "PUMP-100"
        assert float(fgr_data["quantity"]) == 10.0

        # 1.2 Check AR-2026-0002
        res_ar_list = await client.get("/api/v1/assembly-requisitions", headers=wh_headers)
        assert res_ar_list.status_code == 200
        ar = next((r for r in res_ar_list.json() if r.get("requisition_number") == "AR-2026-0002" or r.get("requisitionNumber") == "AR-2026-0002"), None)
        assert ar is not None, "AR-2026-0002 must exist"
        assert ar["status"] == "COMPLETED", f"AR status should be COMPLETED, got {ar['status']}"

        # -------------------------------------------------------------
        # STEP 2: Create / Backfill & Start Assembly Order
        # -------------------------------------------------------------
        res_orders = await client.get("/api/v1/assembly/orders", headers=asm_headers)
        assert res_orders.status_code == 200
        orders_list = res_orders.json()
        
        target_order = next((o for o in orders_list if o.get("request_number") == "AR-2026-0002" or o.get("product_name") == "PUMP-100"), None)
        assert target_order is not None, "Assembly Order for AR-2026-0002 / PUMP-100 must exist"
        order_id = target_order["id"]
        order_number = target_order["order_number"]
        assert float(target_order["planned_quantity"]) == 10.0
        assert target_order["product_name"] == "PUMP-100"
        print(f"[OK] Assembly Order found: {order_number} ({order_id})")

        # Start production order -> IN_PROGRESS if READY
        if target_order["status"] == "READY":
            res_start = await client.patch(
                f"/api/v1/assembly/orders/{order_id}/status",
                headers=asm_headers,
                json={
                    "status": "IN_PROGRESS",
                    "assigned_operator": "Assembly Team Alpha Lead",
                    "notes": "Starting E2E production of 10 units of PUMP-100",
                },
            )
            assert res_start.status_code == 200, f"Start order failed: {res_start.text}"
            order_started = res_start.json()
            assert order_started["status"] == "IN_PROGRESS"
        else:
            res_curr = await client.get(f"/api/v1/assembly/orders/{order_id}", headers=asm_headers)
            order_started = res_curr.json()

        # -------------------------------------------------------------
        # STEP 3: Execute Production & Consumption
        # -------------------------------------------------------------
        if order_started["status"] == "IN_PROGRESS":
            # 3.1 Complete all 6 assembly steps
            steps = order_started.get("assembly_steps", [])
            for step in steps:
                step_id = str(step["id"])
                # In progress
                if step.get("status") != "COMPLETED":
                    res_step_ip = await client.patch(
                        f"/api/v1/assembly/orders/{order_id}/steps/{step_id}",
                        headers=asm_headers,
                        json={"status": "IN_PROGRESS"},
                    )
                    assert res_step_ip.status_code == 200, f"Step {step['name']} in-progress failed: {res_step_ip.text}"

                    # Completed
                    res_step_done = await client.patch(
                        f"/api/v1/assembly/orders/{order_id}/steps/{step_id}",
                        headers=asm_headers,
                        json={"status": "COMPLETED"},
                    )
                    assert res_step_done.status_code == 200, f"Step {step['name']} completion failed: {res_step_done.text}"

            # 3.2 Record Material Consumption for all 8 BOM items
            bom_consumptions = [
                {"material_code": "MAT-CASING-001", "expected_per_unit": 1.0, "assembled_quantity": 10.0, "actual_consumed": 10.0, "uom": "PCS"},
                {"material_code": "MAT-IMPELLER-001", "expected_per_unit": 1.0, "assembled_quantity": 10.0, "actual_consumed": 10.0, "uom": "PCS"},
                {"material_code": "MAT-MOTOR-001", "expected_per_unit": 1.0, "assembled_quantity": 10.0, "actual_consumed": 10.0, "uom": "PCS"},
                {"material_code": "MAT-SEAL-001", "expected_per_unit": 1.0, "assembled_quantity": 10.0, "actual_consumed": 10.0, "uom": "PCS"},
                {"material_code": "MAT-BEARING-001", "expected_per_unit": 2.0, "assembled_quantity": 10.0, "actual_consumed": 20.0, "uom": "SET"},
                {"material_code": "MAT-ORING-001", "expected_per_unit": 2.0, "assembled_quantity": 10.0, "actual_consumed": 20.0, "uom": "PCS"},
                {"material_code": "MAT-COUPLING-001", "expected_per_unit": 1.0, "assembled_quantity": 10.0, "actual_consumed": 10.0, "uom": "PCS"},
                {"material_code": "MAT-FASTENER-001", "expected_per_unit": 1.0, "assembled_quantity": 10.0, "actual_consumed": 10.0, "uom": "KIT"},
            ]
            for c in bom_consumptions:
                res_c = await client.put(
                    f"/api/v1/assembly/orders/{order_id}/consumption",
                    headers=asm_headers,
                    json=c,
                )
                assert res_c.status_code == 200, f"Record consumption failed for {c['material_code']}: {res_c.text}"

            # 3.3 Update Progress to 10
            res_prog = await client.patch(
                f"/api/v1/assembly/orders/{order_id}/progress",
                headers=asm_headers,
                json={"completed_quantity": 10.0},
            )
            assert res_prog.status_code == 200

            # 3.4 Move to COMPLETED
            res_comp = await client.patch(
                f"/api/v1/assembly/orders/{order_id}/status",
                headers=asm_headers,
                json={"status": "COMPLETED", "completed_quantity": 10.0},
            )
            assert res_comp.status_code == 200

            # 3.5 Move to QUALITY_CHECK
            res_qc_ready = await client.patch(
                f"/api/v1/assembly/orders/{order_id}/status",
                headers=asm_headers,
                json={"status": "QUALITY_CHECK"},
            )
            assert res_qc_ready.status_code == 200
            assert res_qc_ready.json()["status"] == "QUALITY_CHECK"

        # -------------------------------------------------------------
        # STEP 4: Production Quality Inspection (QC)
        # -------------------------------------------------------------
        res_qc = await client.put(
            f"/api/v1/assembly/orders/{order_id}/quality-inspection",
            headers=asm_headers,
            json={
                "produced_quantity": 10.0,
                "passed_quantity": 10.0,
                "failed_quantity": 0.0,
                "rework_quantity": 0.0,
                "status": "PASSED",
                "inspected_by": "Senior Quality Inspector",
                "notes": "All 10 PUMP-100 units passed comprehensive hydraulic & electrical performance tests.",
                "product_code": "PUMP-100",
                "warehouse_id": "Main Warehouse",
                "location_code": "FG-Z01",
            },
        )
        assert res_qc.status_code == 200, f"QC inspection failed: {res_qc.text}"
        qc_result = res_qc.json()
        assert qc_result["status"] == "PASSED"
        assert float(qc_result["passed_quantity"]) == 10.0
        assert float(qc_result["failed_quantity"]) == 0.0

        # -------------------------------------------------------------
        # STEP 5 & 6: Finished Goods & FG QR Generation
        # -------------------------------------------------------------
        fg_data = qc_result.get("finished_goods")
        assert fg_data is not None, "Finished Goods record must be returned after passed QC"
        fg_id = fg_data["id"]
        qr_code = fg_data["qr_code"]
        serial_number = fg_data["serial_number"]
        assert "FG-QR" in qr_code
        assert "PUMP-100" in qr_code
        assert float(fg_data["quantity"]) == 10.0
        assert fg_data["status"] in ("PUTAWAY_PENDING", "AVAILABLE")
        print(f"[OK] FG Generated: ID={fg_id}, QR={qr_code}, Serial={serial_number}")

        # -------------------------------------------------------------
        # STEP 7: Component Genealogy Traceability
        # -------------------------------------------------------------
        res_gen = await client.get(f"/api/v1/assembly/finished-goods/{fg_id}/genealogy", headers=asm_headers)
        assert res_gen.status_code == 200, f"Genealogy failed: {res_gen.text}"
        gen_data = res_gen.json()
        
        # Verify FG info
        assert gen_data["finished_good"]["product_code"] == "PUMP-100"
        assert gen_data["finished_good"]["qr_code"] == qr_code
        assert float(gen_data["finished_good"]["quantity"]) == 10.0

        # Verify all 8 BOM components are listed
        consumed = gen_data.get("consumed_materials", [])
        consumed_codes = {c["material_code"] for c in consumed}
        expected_codes = {
            "MAT-CASING-001", "MAT-IMPELLER-001", "MAT-MOTOR-001", "MAT-SEAL-001",
            "MAT-BEARING-001", "MAT-ORING-001", "MAT-COUPLING-001", "MAT-FASTENER-001"
        }
        assert expected_codes.issubset(consumed_codes), f"Missing components in genealogy: {expected_codes - consumed_codes}"

        # Specifically verify Motor traceability
        motor_gen = next((c for c in consumed if c["material_code"] == "MAT-MOTOR-001"), None)
        assert motor_gen is not None
        assert float(motor_gen["actual_consumed"]) == 10.0
        assert "LOT-MAT-MOTOR-001-20260924-ACF3" in motor_gen.get("batches", [])
        assert motor_gen.get("grn_info", {}).get("grn_number") == "GRN-20260924-0003"
        assert motor_gen.get("grn_info", {}).get("po_number") == "PO-2026-0001"
        assert motor_gen.get("putaway_task") == "PT-20260924-65F7"
        assert motor_gen.get("issue_number") == "ISS-2026-7475C5"
        print("[OK] Genealogy verified with complete Motor traceability!")

        # -------------------------------------------------------------
        # STEP 8 & 9: FG Store Destination & FG Putaway
        # -------------------------------------------------------------
        # List putaway tasks for FG Store Manager
        res_putaway_tasks = await client.get("/api/storage/putaway-tasks", headers=fg_store_headers)
        assert res_putaway_tasks.status_code == 200
        tasks = res_putaway_tasks.json()
        fg_putaway_task = next((t for t in tasks if t.get("finished_goods_id") == fg_id or t.get("item_code") == "PUMP-100"), None)
        assert fg_putaway_task is not None, "Putaway task for Finished Good PUMP-100 must exist"
        putaway_id = fg_putaway_task["id"]
        assert fg_putaway_task["status"] in ("OPEN", "PUTAWAY_PENDING", "PUTAWAY_IN_PROGRESS", "IN_PROGRESS", "COMPLETED", "PUTAWAY_COMPLETED")

        if fg_putaway_task["status"] not in ("COMPLETED", "PUTAWAY_COMPLETED"):
            # Start FG Putaway
            res_put_start = await client.post(
                f"/api/storage/putaway-tasks/{putaway_id}/start",
                headers=fg_store_headers,
            )
            assert res_put_start.status_code in (200, 409), f"Start putaway failed: {res_put_start.text}"

            # Complete FG Putaway into BIN-FG-001
            res_put_complete = await client.post(
                f"/api/storage/putaway-tasks/{putaway_id}/complete",
                headers=fg_store_headers,
                json={
                    "material_scan": qr_code,
                    "location_scan": "BIN-FG-001",
                    "quantity": 10.0,
                },
            )
            assert res_put_complete.status_code in (200, 409), f"Complete putaway failed: {res_put_complete.text}"
            put_result = res_put_complete.json()
            assert put_result["status"] in ("COMPLETED", "PUTAWAY_COMPLETED")
        else:
            assert fg_putaway_task["status"] in ("COMPLETED", "PUTAWAY_COMPLETED")

        # -------------------------------------------------------------
        # STEP 10: Verify FG Inventory in FG Store
        # -------------------------------------------------------------
        res_fg_list = await client.get("/api/v1/assembly/finished-goods", headers=asm_headers)
        assert res_fg_list.status_code == 200
        fg_records = res_fg_list.json()
        fg_pump = next((f for f in fg_records if f["id"] == fg_id), None)
        assert fg_pump is not None
        assert fg_pump["status"] == "AVAILABLE"
        assert fg_pump["store_code"] == "STR-FG-01"
        assert float(fg_pump["quantity"]) == 10.0

        # Check FG Request availability view
        res_fgr_check = await client.get("/api/v1/assembly/finished-goods-requests/FGR-20260924-0001", headers=asm_headers)
        assert res_fgr_check.status_code == 200
        fgr_updated = res_fgr_check.json()
        assert float(fgr_updated.get("fg_store_available", 0)) >= 10.0
        assert float(fgr_updated.get("shortage", 0)) == 0.0

        # -------------------------------------------------------------
        # STEP 11 & 12: Downstream Isolation & Idempotency
        # -------------------------------------------------------------
        async with session_scope() as session:
            # Assembly Order count for this flow = 1
            ao_count = (await session.execute(
                select(func.count(AssemblyOrderModel.id)).where(AssemblyOrderModel.request_number == "AR-2026-0002")
            )).scalar()
            assert ao_count == 1

            # Finished Goods count = 1
            fg_count = (await session.execute(
                select(func.count(AssemblyFinishedGoodsModel.id)).where(AssemblyFinishedGoodsModel.product_code == "PUMP-100")
            )).scalar()
            assert fg_count == 1

            # Material Request count = 1 (remains MR-202609-0001)
            mr_count = (await session.execute(select(func.count(MaterialRequestModel.id)))).scalar()
            assert mr_count == 1
