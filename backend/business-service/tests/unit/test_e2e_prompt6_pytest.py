import pytest
import uuid
from httpx import ASGITransport, AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_e2e_prompt6_supplier_creation_and_admin_approval():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Step 1: Open and verify MR-202609-0001
        mr_res = await client.get("/api/v1/procurement/material-requests")
        assert mr_res.status_code == 200, mr_res.text
        mrs = mr_res.json()
        mr = next((m for m in mrs if m.get("requestNumber") == "MR-202609-0001" or m.get("request_number") == "MR-202609-0001"), None)
        assert mr is not None, "MR-202609-0001 not found"
        
        print("\n=== 1. VERIFY MATERIAL REQUEST MR-202609-0001 ===")
        print(f"Request Number: {mr.get('requestNumber') or mr.get('request_number')}")
        print(f"Status: {mr.get('status')}")
        print(f"Department: {mr.get('department')}")
        print(f"Remarks: {mr.get('remarks')}")
        
        items = mr.get("items", [])
        assert len(items) == 1
        it = items[0]
        mat_code = it.get("materialCode") or it.get("material_code")
        mat_name = it.get("materialName") or it.get("material_name")
        qty = float(it.get("quantity") or 0)
        uom_val = it.get("uom")
        cat_val = it.get("category")
        
        print(f"Item: {mat_code} - {mat_name}, Qty: {qty} {uom_val}, Category: {cat_val}")
        assert mat_code == "MAT-MOTOR-001"
        assert qty == 4.0
        assert uom_val == "PCS"
        assert cat_val == "Electrical"
        assert "AR-2026-0002" in str(mr.get("remarks"))
        assert mr.get("status") in ["Submitted", "Pending Approval", "PENDING_PROCUREMENT", "Pending Procurement"]

        # Step 2: Supplier availability scenario check
        print("\n=== 2. SUPPLIER AVAILABILITY SCENARIO ===")
        sup_res = await client.get("/api/v1/procurement/suppliers")
        assert sup_res.status_code == 200
        initial_suppliers = sup_res.json()
        initial_active_electrical = [
            s for s in initial_suppliers
            if s.get("status") == "Active" and (
                "Electrical" in (s.get("category") or []) if isinstance(s.get("category"), list) else (s.get("category") or "") == "Electrical"
            )
        ]
        print(f"Current active suppliers for 'Electrical': {len(initial_active_electrical)}")

        # Step 3: Create controlled test supplier
        print("\n=== 3. CREATE CONTROLLED TEST SUPPLIER ===")
        unique_suffix = uuid.uuid4().hex[:6]
        supplier_payload = {
            "supplier_name": "E2E Motor Supplier",
            "registered_company_name": "E2E Motor Supplier Private Limited",
            "vendor_type": "Manufacturer",
            "category": ["Electrical"],
            "industry": "Power",
            "gstin": f"29E2EMOT{unique_suffix.upper()}1Z5",
            "main_materials": ["MAT-MOTOR-001"],
            "address": {
                "registered_address": "Plot 42, Phase 2 Industrial Area",
                "city": "Bangalore",
                "state": "Karnataka",
                "country": "India",
                "pincode": "560058"
            },
            "contact": {
                "primary_contact_name": "E2E Vendor Manager",
                "primary_email": f"vendor_{unique_suffix}@e2emotor.test",
                "phone": "9876543210"
            },
            "bank_info": {
                "bank_name": "State Bank of India",
                "account_number": f"9876{unique_suffix}123",
                "account_holder_name": "E2E Motor Supplier Private Limited",
                "ifsc": "SBIN0001234",
                "branch": "Peenya Industrial Area"
            },
            "documents": [
                {
                    "document_type": "GST Certificate",
                    "file_name": "gst_certificate.pdf",
                    "file_type": "application/pdf",
                    "file_size": 2048,
                    "storage_path": f"/media/suppliers/gst_{unique_suffix}.pdf",
                    "upload_id": str(uuid.uuid4())
                },
                {
                    "document_type": "Cancelled Cheque",
                    "file_name": "cancelled_cheque.pdf",
                    "file_type": "application/pdf",
                    "file_size": 1024,
                    "storage_path": f"/media/suppliers/cheque_{unique_suffix}.pdf",
                    "upload_id": str(uuid.uuid4())
                }
            ],
            "remarks": "Created for E2E Motor procurement testing"
        }

        create_res = await client.post(
            "/api/v1/procurement/suppliers",
            json=supplier_payload,
            headers={"X-User-Role": "PROCUREMENT", "X-Username": "procurement_specialist"}
        )
        assert create_res.status_code == 201, create_res.text
        created_sup = create_res.json()
        sup_id = created_sup.get("supplierId") or created_sup.get("id")
        sup_code = created_sup.get("supplierCode") or created_sup.get("code")
        sup_name = created_sup.get("supplierName") or created_sup.get("name")
        initial_status = created_sup.get("status")
        
        print(f"Created Supplier ID: {sup_id}")
        print(f"Supplier Code: {sup_code}")
        print(f"Supplier Name: {sup_name}")
        print(f"Initial Status: {initial_status}")
        assert initial_status == "Pending Approval", f"Expected initial status Pending Approval, got {initial_status}"

        # Step 4: Verify supplier in master data list (as pending)
        sup_list_res = await client.get("/api/v1/procurement/suppliers")
        assert sup_list_res.status_code == 200
        all_sups = sup_list_res.json()
        found_in_master = next((s for s in all_sups if (s.get("supplierId") == sup_id or s.get("id") == sup_id)), None)
        assert found_in_master is not None, "Newly created supplier not found in master data list"
        assert found_in_master.get("status") == "Pending Approval"

        # Step 5: Admin Approval
        print("\n=== 4. ADMIN APPROVAL ===")
        approve_res = await client.post(
            f"/api/v1/procurement/suppliers/{sup_id}/status",
            json={"status": "Active", "remarks": "Approved by Admin for E2E Motor procurement"},
            headers={"X-User-Role": "ADMIN", "X-Username": "admin_user"}
        )
        assert approve_res.status_code == 200, approve_res.text
        approved_sup = approve_res.json()
        approved_status = approved_sup.get("status")
        print(f"Supplier status after Admin approval: {approved_status}")
        assert approved_status == "Active", f"Expected status Active, got {approved_status}"

        # Step 6: Verify Supplier is visible as an Active supplier for Electrical category
        print("\n=== 5. VERIFY ACTIVE CATEGORY SUPPLIERS ===")
        after_sup_res = await client.get("/api/v1/procurement/suppliers")
        assert after_sup_res.status_code == 200
        after_suppliers = after_sup_res.json()
        active_electrical = [
            s for s in after_suppliers
            if s.get("status") == "Active" and (
                "Electrical" in (s.get("category") or []) if isinstance(s.get("category"), list) else (s.get("category") or "") == "Electrical"
            )
        ]
        print(f"Updated active suppliers for 'Electrical': {len(active_electrical)} (was {len(initial_active_electrical)})")
        assert len(active_electrical) == len(initial_active_electrical) + 1, "Supplier count should increase by 1"
        assert any((s.get("supplierId") == sup_id or s.get("id") == sup_id) for s in active_electrical), "E2E Motor Supplier not in active Electrical suppliers list"

        # Step 7: Verify MR-202609-0001 and downstream isolation
        print("\n=== 6. VERIFY MR & DOWNSTREAM ISOLATION ===")
        mr_check_res = await client.get("/api/v1/procurement/material-requests")
        assert mr_check_res.status_code == 200
        mr_check_list = mr_check_res.json()
        assert len(mr_check_list) == 1, "Material request count must remain 1"
        mr_intact = mr_check_list[0]
        assert float(mr_intact["items"][0]["quantity"]) == 4.0
        assert mr_intact["items"][0]["materialCode"] == "MAT-MOTOR-001"

        rfq_res = await client.get("/api/v1/procurement/rfqs")
        assert rfq_res.status_code == 200
        assert len(rfq_res.json()) == 0, "No RFQ should exist in Prompt 6"

        po_res = await client.get("/api/v1/procurement/purchase-orders")
        assert po_res.status_code == 200
        assert len(po_res.json()) == 0, "No PO should exist in Prompt 6"
        
        print("\n>>> ALL PROMPT 6 STEPS AND ASSERTIONS PASSED SUCCESSFULLY! <<<")
