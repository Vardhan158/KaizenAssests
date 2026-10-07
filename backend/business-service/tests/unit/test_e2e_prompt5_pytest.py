import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_e2e_prompt5_material_request_handoff():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Verify AR-2026-0002
        ar_res = await client.get("/api/v1/assembly-requisitions")
        assert ar_res.status_code == 200, ar_res.text
        reqs = ar_res.json()
        ar = next((r for r in reqs if (r.get("requisition_number") == "AR-2026-0002" or r.get("requisitionNumber") == "AR-2026-0002")), None)
        assert ar is not None, "AR-2026-0002 not found"
        ar_id = ar.get("id")
        ar_num = ar.get("requisitionNumber") or ar.get("requisition_number")
        
        # Verify motor shortage is exactly 4
        items_list = ar.get("items", [])
        motor_item = next((it for it in items_list if "MOTOR" in (it.get("material_code") or it.get("materialCode") or "").upper()), None)
        assert motor_item is not None
        req_qty = float(motor_item.get("required_quantity") or motor_item.get("requiredQuantity") or 0)
        res_qty = float(motor_item.get("reserved_quantity") or motor_item.get("reservedQuantity") or 0)
        shortage_qty = float(motor_item.get("shortageQuantity") or motor_item.get("shortage_quantity") or (req_qty - res_qty))
        assert req_qty == 10.0
        assert res_qty == 6.0
        assert shortage_qty == 4.0

        motor_id = motor_item.get("material_id") or motor_item.get("materialId")

        # 2. Check Supplier count for category Electrical
        sup_res = await client.get("/api/v1/procurement/suppliers")
        assert sup_res.status_code == 200
        suppliers = sup_res.json()
        active_sups_electrical = [
            s for s in suppliers 
            if s.get("status") == "Active" and (
                "Electrical" in (s.get("category") or []) if isinstance(s.get("category"), list) else (s.get("category") or "") == "Electrical"
            )
        ]
        sup_count = len(active_sups_electrical)
        print(f"\n[INFO] Active suppliers for Electrical category: {sup_count}")

        # 3. Check Material Requests list
        mr_res = await client.get("/api/v1/procurement/material-requests")
        assert mr_res.status_code == 200
        mrs = mr_res.json()
        print(f"[INFO] Material Requests count: {len(mrs)}")
        assert len(mrs) == 1, f"Expected exactly 1 Material Request, found {len(mrs)}"
        
        mr = mrs[0]
        mr_id = mr.get("id")
        mr_num = mr.get("requestNumber") or mr.get("request_number")
        status_val = mr.get("status")
        dept_val = mr.get("department")
        remarks_val = mr.get("remarks")
        
        print(f"[INFO] Material Request Number: {mr_num}")
        print(f"[INFO] Material Request ID: {mr_id}")
        print(f"[INFO] Status: {status_val}")
        print(f"[INFO] Department: {dept_val}")
        print(f"[INFO] Remarks: {remarks_val}")
        
        items = mr.get("items") or []
        assert len(items) == 1
        it = items[0]
        mat_code = it.get("material_code") or it.get("materialCode")
        mat_name = it.get("material_name") or it.get("materialName")
        quantity = float(it.get("quantity") or 0)
        uom_val = it.get("uom")
        cat_val = it.get("category")
        
        print(f"[INFO] Item Material: {mat_code} ({mat_name})")
        print(f"[INFO] Item Quantity: {quantity} {uom_val}")
        print(f"[INFO] Item Category: {cat_val}")
        
        assert mat_code == "MAT-MOTOR-001"
        assert quantity == 4.0
        assert uom_val == "PCS"
        assert cat_val == "Electrical"
        assert "AR-2026-0002" in str(remarks_val)
        
        # 4. Verify downstream isolation
        rfq_res = await client.get("/api/v1/procurement/rfqs")
        assert rfq_res.status_code == 200
        assert len(rfq_res.json()) == 0, "Downstream RFQs must be 0"

        po_res = await client.get("/api/v1/procurement/purchase-orders")
        assert po_res.status_code == 200
        assert len(po_res.json()) == 0, "Downstream POs must be 0"
