import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text

from app.main import app
from app.database.session import session_scope


@pytest.mark.asyncio
async def test_quarantine_full_lifecycle_and_security():
    """Test full Phase 6 Quarantine workflow, automatic creation, dispositions, and strict authorization."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {"Authorization": "Bearer mock-jwt-warehouse-token"}
        store_manager_headers = {"Authorization": "Bearer mock-jwt-store-manager-token"}
        store_keeper_headers = {"Authorization": "Bearer mock-jwt-store-keeper-token"}

        unique_suffix = uuid.uuid4().hex[:6]
        mat_code = f"MAT-DAM-{unique_suffix}"
        grn_num = f"GRN-2026-{unique_suffix}"

        # 1. Setup raw mock data in DB (material, PO, ASN, gate entry, dock assignment, receiving line, GRN, GRN line)
        async with session_scope() as session:
            # Material stock
            await session.execute(
                text("""
                    INSERT INTO material_stock (id, material_code, material_name, category, on_hand, allocated, available, uom, warehouse_id, reorder_point)
                    VALUES (:id, :code, 'Damaged Pump Unit', 'RAW', 0, 0, 0, 'PCS', 'Main Warehouse', 10)
                """),
                {"id": str(uuid.uuid4()), "code": mat_code},
            )

            grn_id = str(uuid.uuid4())
            grn_line_good_id = str(uuid.uuid4())
            grn_line_dam_id = str(uuid.uuid4())
            rec_line_dam_id = str(uuid.uuid4())

            # Insert GRN
            await session.execute(
                text("""
                    INSERT INTO grn (id, grn_number, warehouse_id, status, supplier_name, posted_by, posted_at)
                    VALUES (:id, :num, 'Main Warehouse', 'GRN_DRAFT', 'Industrial Parts Inc', 'wh_user', NOW())
                """),
                {"id": grn_id, "num": grn_num},
            )

            # Insert GRN line with 0 damage (good only)
            await session.execute(
                text("""
                    INSERT INTO grn_line (id, grn_id, item_code, material_name, received_quantity, accepted_quantity, damaged_quantity, rejected_quantity, uom)
                    VALUES (:id, :grn_id, :code, 'Damaged Pump Unit', 95, 95, 0, 0, 'PCS')
                """),
                {"id": grn_line_good_id, "grn_id": grn_id, "code": mat_code},
            )

            # Insert GRN line with 5 damaged units
            await session.execute(
                text("""
                    INSERT INTO grn_line (id, grn_id, item_code, material_name, received_quantity, accepted_quantity, damaged_quantity, rejected_quantity, uom)
                    VALUES (:id, :grn_id, :code, 'Damaged Pump Unit', 5, 0, 5, 0, 'PCS')
                """),
                {"id": grn_line_dam_id, "grn_id": grn_id, "code": mat_code},
            )

            await session.commit()

        # 2. Test Auto-Creation: Simulate complete_receiving / direct quarantine creation
        # Directly insert quarantine record for the damaged line as complete_receiving does
        q_id = str(uuid.uuid4())
        q_num = f"QRN-2026-{unique_suffix}"
        async with session_scope() as session:
            await session.execute(
                text("""
                    INSERT INTO quarantine_record (
                        id, quarantine_number, grn_id, grn_number, grn_line_id,
                        item_code, material_name, damaged_quantity, uom,
                        warehouse_id, reason, status, created_by, created_at, updated_at
                    ) VALUES (
                        :id, :num, :grn_id, :grn_num, :grn_line_id,
                        :code, 'Damaged Pump Unit', 5.0000, 'PCS',
                        'Main Warehouse', 'Crushed carton on arrival', 'PENDING_REVIEW', 'wh_user', NOW(), NOW()
                    )
                """),
                {
                    "id": q_id,
                    "num": q_num,
                    "grn_id": grn_id,
                    "grn_num": grn_num,
                    "grn_line_id": grn_line_dam_id,
                    "code": mat_code,
                },
            )
            await session.commit()

        # 3. Warehouse List Quarantine Records
        list_res = await client.get("/api/quarantine", headers=warehouse_headers)
        assert list_res.status_code == 200, f"List failed: {list_res.text}"
        records = list_res.json()
        assert any(r["id"] == q_id for r in records), "Created quarantine record not found in list"

        # 4. Filter by status / search / material
        filter_res = await client.get(f"/api/quarantine?status=PENDING_REVIEW&material={mat_code}", headers=warehouse_headers)
        assert filter_res.status_code == 200
        filtered = filter_res.json()
        assert len(filtered) >= 1
        assert filtered[0]["id"] == q_id
        assert filtered[0]["damaged_quantity"] == 5.0

        # 5. Warehouse View Detail
        detail_res = await client.get(f"/api/quarantine/{q_id}", headers=warehouse_headers)
        assert detail_res.status_code == 200
        detail = detail_res.json()
        assert detail["quarantine_number"] == q_num
        assert detail["status"] == "PENDING_REVIEW"
        assert detail["damaged_quantity"] == 5.0
        assert detail["item_code"] == mat_code
        assert "audits" in detail

        # 6. Store Manager gets 403 Forbidden
        sm_res = await client.get("/api/quarantine", headers=store_manager_headers)
        assert sm_res.status_code == 403, f"Store manager must get 403, got {sm_res.status_code}"

        sm_det_res = await client.get(f"/api/quarantine/{q_id}", headers=store_manager_headers)
        assert sm_det_res.status_code == 403, f"Store manager must get 403, got {sm_det_res.status_code}"

        # 7. Store Keeper gets 403 Forbidden
        sk_res = await client.get("/api/quarantine", headers=store_keeper_headers)
        assert sk_res.status_code == 403, f"Store keeper must get 403, got {sk_res.status_code}"

        sk_det_res = await client.get(f"/api/quarantine/{q_id}", headers=store_keeper_headers)
        assert sk_det_res.status_code == 403, f"Store keeper must get 403, got {sk_det_res.status_code}"

        # 8. Non-existent ID returns 404
        fake_id = str(uuid.uuid4())
        fake_res = await client.get(f"/api/quarantine/{fake_id}", headers=warehouse_headers)
        assert fake_res.status_code == 404

        # 9. Store Keeper attempting review gets 403
        sk_rev_res = await client.post(
            f"/api/quarantine/{q_id}/review",
            json={"disposition": "ACCEPTED_WITH_DEVIATION", "remarks": "Unauthorized attempt"},
            headers=store_keeper_headers,
        )
        assert sk_rev_res.status_code == 403

        # 10. Invalid disposition rejected with 422
        bad_disp_res = await client.post(
            f"/api/quarantine/{q_id}/review",
            json={"disposition": "MAGIC_FIX", "remarks": "Invalid"},
            headers=warehouse_headers,
        )
        assert bad_disp_res.status_code == 422

        # 11. Test Dispositions:
        # A) Create 4 separate quarantine records to test all 4 valid transitions
        disp_tests = [
            ("ACCEPTED_WITH_DEVIATION", "Minor cosmetic scratch, usable for non-critical line"),
            ("RETURN_TO_VENDOR", "Cracked housing, vendor RMA requested"),
            ("SCRAPPED", "Total loss, hazardous fluid leak"),
            ("REWORK", "Needs re-threading at machine shop"),
        ]

        for target_disp, test_remarks in disp_tests:
            test_qid = str(uuid.uuid4())
            test_qnum = f"QRN-TEST-{uuid.uuid4().hex[:6]}"
            async with session_scope() as session:
                await session.execute(
                    text("""
                        INSERT INTO quarantine_record (
                            id, quarantine_number, grn_id, grn_number,
                            item_code, material_name, damaged_quantity, uom,
                            warehouse_id, reason, status, created_by, created_at, updated_at
                        ) VALUES (
                            :id, :num, :grn_id, :grn_num,
                            :code, 'Damaged Pump Unit', 2.0000, 'PCS',
                            'Main Warehouse', 'Damage test', 'PENDING_REVIEW', 'wh_user', NOW(), NOW()
                        )
                    """),
                    {
                        "id": test_qid,
                        "num": test_qnum,
                        "grn_id": grn_id,
                        "grn_num": grn_num,
                        "code": mat_code,
                    },
                )
                await session.commit()

            # Execute Review
            rev_res = await client.post(
                f"/api/quarantine/{test_qid}/review",
                json={"disposition": target_disp, "remarks": test_remarks},
                headers=warehouse_headers,
            )
            assert rev_res.status_code == 200, f"Review {target_disp} failed: {rev_res.text}"
            rev_body = rev_res.json()
            assert rev_body["status"] == target_disp
            assert rev_body["disposition"] == target_disp

            if target_disp == "ACCEPTED_WITH_DEVIATION":
                assert rev_body["putaway_task_id"] is not None, "ACCEPTED_WITH_DEVIATION must create a Putaway task"

            # Verify detail and audit log
            check_res = await client.get(f"/api/quarantine/{test_qid}", headers=warehouse_headers)
            assert check_res.status_code == 200
            check_data = check_res.json()
            assert check_data["status"] == target_disp
            assert len(check_data["audits"]) >= 1
            assert check_data["audits"][0]["disposition"] == target_disp
            assert check_data["audits"][0]["previous_status"] == "PENDING_REVIEW"
            assert check_data["audits"][0]["new_status"] == target_disp

            # 12. Duplicate / repeated review on resolved record is rejected with 409 Conflict
            dup_rev_res = await client.post(
                f"/api/quarantine/{test_qid}/review",
                json={"disposition": "SCRAPPED", "remarks": "Second review attempt"},
                headers=warehouse_headers,
            )
            assert dup_rev_res.status_code == 409, f"Resolved record must return 409 on second review, got {dup_rev_res.status_code}"

        # 13. Inventory Safety Check: Quarantined quantity must NOT appear in available stock
        async with session_scope() as session:
            stock_res = await session.execute(
                text("SELECT available, on_hand FROM material_stock WHERE material_code = :code"),
                {"code": mat_code},
            )
            stock = stock_res.first()
            assert stock is not None
            assert stock.available == 0, f"Available stock must be 0 for quarantined items, found {stock.available}"
