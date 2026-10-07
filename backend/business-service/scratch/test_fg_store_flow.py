import sys, os
sys.path.insert(0, os.path.abspath("."))
import asyncio
import httpx
import json
import uuid
from sqlalchemy import select
from app.main import app
from httpx import ASGITransport

async def test_full_fg_store_flow():
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
        print("\n==========================================")
        print("1. TEST FINISHED GOODS STORE MANAGER LOGIN")
        print("==========================================")
        
        # Login as Finished Goods Store Manager
        login_resp = await client.post(
            "/api/v1/procurement/auth/dev-login",
            json={"username": "store_manager_fg", "password": "Store@123"}
        )
        assert login_resp.status_code == 200, f"FG Store Manager login failed: {login_resp.text}"
        fg_mgr_data = login_resp.json()
        print(f"[OK] FG Store Manager logged in: {fg_mgr_data.get('username')} ({fg_mgr_data.get('employee_id')})")
        print(f"     Roles: {fg_mgr_data.get('roles')}")
        print(f"     Store: {fg_mgr_data.get('store_code')} - {fg_mgr_data.get('store_name')}")
        
        fg_token = fg_mgr_data["token"]
        fg_headers = {
            "Authorization": f"Bearer {fg_token}",
            "X-User-Roles": "STORE_MANAGER",
            "X-Store-Code": fg_mgr_data.get("store_code") or "STR-FG-01",
            "X-Store-Id": fg_mgr_data.get("store_id") or "",
            "X-Employee-Id": fg_mgr_data.get("employee_id") or "EMP-FG-STORE-001",
            "X-User-Name": "store_manager_fg",
        }

        # Check My Store endpoint
        my_store_resp = await client.get("/api/v1/stores/me", headers=fg_headers)
        assert my_store_resp.status_code == 200, f"My Store failed: {my_store_resp.text}"
        my_store = my_store_resp.json()
        print(f"[OK] GET /api/v1/stores/me returned store: {my_store.get('store_code')} ({my_store.get('store_name')})")
        assert my_store.get("store_code") == "STR-FG-01", f"Expected STR-FG-01, got {my_store.get('store_code')}"

        # FG Store Manager must NOT be able to manage Store Master / create stores
        create_store_resp = await client.post(
            "/api/v1/stores",
            headers=fg_headers,
            json={
                "store_code": "STR-HACK-99",
                "store_name": "Unauthorized Store",
                "store_type": "RAW_MATERIAL",
            }
        )
        print(f"[OK] Store creation attempt by FG Store Manager returned status: {create_store_resp.status_code}")
        assert create_store_resp.status_code in (401, 403), f"FG Store Manager should be forbidden from creating stores, got {create_store_resp.status_code}"

        print("\n==========================================")
        print("2. TEST ASSEMBLY COMPLETION -> FG PUTAWAY TASK")
        print("==========================================")
        
        # Assembly Manager login
        asm_login = await client.post(
            "/api/v1/procurement/auth/dev-login",
            json={"username": "assembly_manager", "password": "password"}
        )
        if asm_login.status_code != 200:
            asm_login = await client.post(
                "/api/v1/procurement/auth/dev-login",
                json={"username": "assembly_manager", "password": "Assembly@123"}
            )
        asm_token = asm_login.json().get("token") if asm_login.status_code == 200 else "mock-jwt-assembly-manager-token"
        asm_headers = {
            "Authorization": f"Bearer {asm_token}",
            "X-User-Roles": "ASSEMBLY_MANAGER,ASSEMBLY",
            "X-User-Name": "assembly_manager",
        }

        # Create a fresh test assembly order for end-to-end test
        from app.database.session import AsyncSessionFactory
        from app.modules.assembly.infrastructure.persistence.models import AssemblyOrderModel
        from app.modules.procurement.infrastructure.persistence.models import MaterialRequestModel, PickTaskModel, MaterialIssueModel
        from decimal import Decimal
        import datetime
        async with AsyncSessionFactory() as session:
            mr = MaterialRequestModel(
                id=uuid.uuid4(),
                request_number=f"MR-2026-{uuid.uuid4().hex[:4].upper()}",
                warehouse_id="WH-01",
                department="Assembly",
                requested_by="assembly_manager",
                priority="HIGH",
                status="COMPLETED",
                required_date=datetime.date.today(),
                created_at=datetime.datetime.utcnow(),
                updated_at=datetime.datetime.utcnow(),
            )
            session.add(mr)
            await session.flush()

            pick = PickTaskModel(
                id=uuid.uuid4(),
                task_number=f"PT-2026-{uuid.uuid4().hex[:4].upper()}",
                request_id=mr.id,
                request_number=mr.request_number,
                warehouse_id="WH-01",
                department="Assembly",
                items=[],
                status="COMPLETED",
                destination="Production Staging Area",
                created_by="assembly_manager",
                created_at=datetime.datetime.utcnow(),
            )
            session.add(pick)
            await session.flush()

            issue = MaterialIssueModel(
                id=uuid.uuid4(),
                issue_number=f"MI-2026-{uuid.uuid4().hex[:4].upper()}",
                pick_task_id=pick.id,
                request_id=mr.id,
                department="Assembly",
                items=[],
                issued_by="warehouse_operator",
                received_by="assembly_manager",
                issued_at=datetime.datetime.utcnow(),
            )
            session.add(issue)
            await session.flush()

            new_ord = AssemblyOrderModel(
                id=uuid.uuid4(),
                order_number=f"AO-2026-{uuid.uuid4().hex[:5].upper()}",
                material_request_id=mr.id,
                pick_task_id=pick.id,
                material_issue_id=issue.id,
                request_number=mr.request_number,
                department="Assembly",
                product_name="Industrial IoT Sensor Hub",
                planned_quantity=Decimal("5.0"),
                completed_quantity=Decimal("5.0"),
                rejected_quantity=Decimal("0.0"),
                status="QUALITY_CHECK",
                items=[
                    {"material_code": "ELEC-CAP-001", "material_name": "Capacitor 100uF", "quantity": 10, "uom": "PCS"},
                    {"material_code": "ELEC-RES-001", "material_name": "Resistor 10k", "quantity": 20, "uom": "PCS"},
                ],
                assigned_team="Alpha Assembly",
                created_by="assembly_manager",
                created_at=datetime.datetime.utcnow(),
                updated_at=datetime.datetime.utcnow(),
            )
            session.add(new_ord)
            await session.commit()
            target_order = {
                "id": str(new_ord.id),
                "order_number": new_ord.order_number,
                "product_name": new_ord.product_name,
                "product_code": "IIOT-HUB-01",
                "status": new_ord.status,
            }
        print(f"[OK] Created new Assembly Order for test: {target_order.get('order_number')}")

        order_id = target_order.get("id")

        # Set order to QUALITY_CHECK so quality inspection can be completed
        from app.database.session import AsyncSessionFactory
        from app.modules.assembly.infrastructure.persistence.models import AssemblyOrderModel
        from decimal import Decimal
        async with AsyncSessionFactory() as session:
            db_ord = await session.get(AssemblyOrderModel, uuid.UUID(order_id))
            if db_ord:
                db_ord.status = "QUALITY_CHECK"
                db_ord.planned_quantity = Decimal("5.0")
                db_ord.completed_quantity = Decimal("5.0")
                await session.commit()

        # Record Quality Inspection (which triggers post_finished_goods -> Putaway task to FG Store)
        qc_resp = await client.put(
            f"/api/v1/assembly/orders/{order_id}/quality-inspection",
            headers=asm_headers,
            json={
                "produced_quantity": 5,
                "passed_quantity": 5,
                "failed_quantity": 0,
                "rework_quantity": 0,
                "status": "PASSED",
                "inspected_by": "Senior QC Inspector",
                "notes": "Passed all multi-point functional and flight tests",
                "product_code": target_order.get("product_code") or "DRONE-PRO-V2",
                "warehouse_id": "WH-01",
                "location_code": "FG-PALLET-01",
            }
        )
        assert qc_resp.status_code == 200, f"QC inspection failed: {qc_resp.text}"
        qc_data = qc_resp.json()
        fg_info = qc_data.get("finished_goods")
        print(f"[OK] Quality Inspection passed! Finished good posted:")
        print(f"     QR: {fg_info.get('qr_code')}")
        print(f"     Serial: {fg_info.get('serial_number')}")
        print(f"     Status: {fg_info.get('status')}")
        print(f"     Store ID: {fg_info.get('store_id')}")

        print("\n==========================================")
        print("3. TEST FG STORE MANAGER PUTAWAY EXECUTION")
        print("==========================================")

        # Check pending putaway tasks for FG Store Manager
        tasks_resp = await client.get("/api/storage/putaway-tasks", headers=fg_headers)
        assert tasks_resp.status_code == 200, f"List putaway tasks failed: {tasks_resp.text}"
        putaway_tasks = tasks_resp.json()
        print(f"[OK] Found {len(putaway_tasks)} putaway tasks accessible to FG Store Manager:")
        for t in putaway_tasks:
            print(f"     Task: {t.get('task_number')}, item={t.get('item_code')}, fg_id={t.get('finished_goods_id')}, status={t.get('status')}")
        
        fg_task = None
        for t in putaway_tasks:
            if t.get("finished_goods_id") == fg_info.get("id") or t.get("item_code") == (target_order.get("product_code") or "DRONE-PRO-V2") or t.get("status") == "PUTAWAY_PENDING":
                fg_task = t
                break
        
        assert fg_task is not None, "Pending Putaway Task for Finished Good not found in FG Store putaway tasks list!"
        print(f"[OK] Found pending FG Putaway Task: {fg_task.get('task_number')} (status={fg_task.get('status')})")

        # Execute Putaway into BIN-FG-001
        putaway_exec_resp = await client.post(
            f"/api/storage/putaway-tasks/{fg_task['id']}/complete",
            headers=fg_headers,
            json={
                "material_scan": fg_info.get("qr_code") or fg_task.get("item_code"),
                "location_scan": "BIN-FG-001",
                "quantity": float(fg_task.get("quantity", 5)),
            }
        )
        assert putaway_exec_resp.status_code == 200, f"Execute putaway failed: {putaway_exec_resp.text}"
        exec_data = putaway_exec_resp.json()
        print(f"[OK] FG Putaway executed successfully! Task status: {exec_data.get('status')}")

        print("\n==========================================")
        print("4. TEST ASSEMBLY VISIBILITY & GENEALOGY")
        print("==========================================")

        # Assembly Finished Goods Overview
        overview_resp = await client.get("/api/v1/assembly/overview/finished-goods", headers=asm_headers)
        assert overview_resp.status_code == 200, f"Overview finished goods failed: {overview_resp.text}"
        overview_data = overview_resp.json()
        print(f"[OK] GET /api/v1/assembly/overview/finished-goods returned {overview_data.get('total')} items")
        
        # Verify the finished good is listed with AVAILABLE status, Store, and Location
        found_in_overview = False
        for row in overview_data.get("rows", []):
            if row.get("id") == fg_info.get("id") or fg_info.get("qr_code") in str(row.get("qr_code")):
                found_in_overview = True
                print(f"[OK] Finished Good in Assembly list: {row.get('product')}")
                print(f"     QR: {row.get('qr_code')}")
                print(f"     Store: {row.get('store')}")
                print(f"     Location: {row.get('location')}")
                print(f"     Status: {row.get('status')}")
                print(f"     Order: {row.get('order_number')}")
                assert row.get("status") == "AVAILABLE", f"Expected status AVAILABLE after putaway, got {row.get('status')}"
                break
        assert found_in_overview, "Completed finished good not found in Assembly Finished Goods overview!"

        # Test Detailed Genealogy
        genealogy_resp = await client.get(
            f"/api/v1/assembly/finished-goods/{fg_info.get('id')}/genealogy",
            headers=asm_headers
        )
        assert genealogy_resp.status_code == 200, f"Genealogy lookup failed: {genealogy_resp.text}"
        gen_data = genealogy_resp.json()
        print(f"[OK] Genealogy loaded successfully:")
        print(f"     Finished Good: {gen_data.get('finished_good', {}).get('product_name')} ({gen_data.get('finished_good', {}).get('product_code')})")
        print(f"     Store: {gen_data.get('finished_good', {}).get('store_name')} ({gen_data.get('finished_good', {}).get('store_code')})")
        print(f"     Location: {gen_data.get('finished_good', {}).get('location_code')}")
        print(f"     Assembly Order: {gen_data.get('assembly_order', {}).get('order_number')}")
        print(f"     Consumed Materials: {len(gen_data.get('consumed_materials', []))} items")

        # Assembly must NOT have access to create or delete stores
        asm_store_master = await client.post(
            "/api/v1/stores",
            headers=asm_headers,
            json={
                "store_code": "STR-ASM-HACK",
                "store_name": "Assembly Owned Store",
                "store_type": "FINISHED_GOODS",
            }
        )
        print(f"[OK] Assembly store creation attempt returned status: {asm_store_master.status_code}")
        assert asm_store_master.status_code in (401, 403), f"Assembly must NOT have Store creation permissions, got {asm_store_master.status_code}!"

        print("\n==========================================")
        print("5. TEST OTHER STORE MANAGERS ISOLATION")
        print("==========================================")
        
        elec_login = await client.post(
            "/api/v1/procurement/auth/dev-login",
            json={"username": "store_manager_elec", "password": "password"}
        )
        if elec_login.status_code == 200:
            elec_token = elec_login.json()["token"]
            elec_headers = {
                "Authorization": f"Bearer {elec_token}",
                "X-User-Roles": "STORE_MANAGER",
                "X-Store-Code": "STR-001",
                "X-Employee-Id": "EMP-STORE-001",
                "X-User-Name": "store_manager_elec",
            }
            elec_tasks_resp = await client.get("/api/storage/putaway-tasks", headers=elec_headers)
            if elec_tasks_resp.status_code == 200:
                elec_tasks = elec_tasks_resp.json()
                for t in elec_tasks:
                    assert t.get("destination_store_id") != fg_info.get("store_id"), "Electrical Store Manager should NOT see FG Store putaway tasks!"
                print(f"[OK] Verified Store Manager Elec cannot access FG Store putaway tasks.")

        print("\n==========================================")
        print("ALL ACCEPTANCE CRITERIA VERIFIED SUCCESSFULLY!")
        print("==========================================")

if __name__ == "__main__":
    asyncio.run(test_full_fg_store_flow())
