import pytest
import datetime
from decimal import Decimal
from httpx import ASGITransport, AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_e2e_prompt7_rfq_quotation_finance_po_asn():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # =========================================================================
        # 1. VERIFY SOURCE MATERIAL REQUEST & APPROVED SUPPLIER
        # =========================================================================
        print("\n=== STEP 1: VERIFY SOURCE MR & SUPPLIER ===")
        mr_res = await client.get("/api/v1/procurement/material-requests")
        assert mr_res.status_code == 200, mr_res.text
        mrs = mr_res.json()
        mr = next((m for m in mrs if (m.get("requestNumber") == "MR-202609-0001" or m.get("request_number") == "MR-202609-0001")), None)
        assert mr is not None, "MR-202609-0001 not found"
        mr_id = mr.get("id")
        mr_no = mr.get("requestNumber") or mr.get("request_number")
        
        items = mr.get("items", [])
        assert len(items) == 1
        it = items[0]
        mat_code = it.get("materialCode") or it.get("material_code")
        mat_name = it.get("materialName") or it.get("material_name")
        qty = float(it.get("quantity") or 0)
        uom_val = it.get("uom")
        cat_val = it.get("category")
        
        print(f"MR Number: {mr_no} (ID: {mr_id})")
        print(f"Material: {mat_code} ({mat_name}) | Qty: {qty} {uom_val} | Category: {cat_val}")
        assert mat_code == "MAT-MOTOR-001"
        assert qty == 4.0
        assert uom_val == "PCS"
        assert cat_val == "Electrical"
        assert "AR-2026-0002" in str(mr.get("remarks"))

        # Process/Approve MR for RFQ creation if in Submitted status
        if mr.get("status") in ["Submitted", "Pending Approval"]:
            proc_res = await client.post(f"/api/v1/procurement/material-requests/{mr_id}/process")
            assert proc_res.status_code == 200, proc_res.text
            print("Material Request approved for RFQ creation.")

        # Get Approved E2E Motor Supplier
        sup_res = await client.get("/api/v1/procurement/suppliers")
        assert sup_res.status_code == 200
        suppliers = sup_res.json()
        e2e_sup = next((s for s in suppliers if "E2E Motor Supplier" in (s.get("supplierName") or s.get("name") or "") and s.get("status") == "Active"), None)
        assert e2e_sup is not None, "Active E2E Motor Supplier not found"
        sup_id = e2e_sup.get("supplierId") or e2e_sup.get("id")
        sup_code = e2e_sup.get("supplierCode") or e2e_sup.get("code")
        sup_name = e2e_sup.get("supplierName") or e2e_sup.get("name")
        print(f"Approved Supplier: {sup_name} ({sup_code}) | ID: {sup_id}")

        # =========================================================================
        # 2. CREATE RFQ
        # =========================================================================
        print("\n=== STEP 2: CREATE RFQ ===")
        rfq_payload = {
            "rfq_date": datetime.date.today().isoformat(),
            "warehouse": "Main Warehouse",
            "procurement_officer": "procurement_specialist",
            "supplier_ids": [sup_id],
            "material_request_number": mr_no,
            "required_delivery_date": (datetime.date.today() + datetime.timedelta(days=7)).isoformat(),
            "remarks": "RFQ for 4 PCS Motor shortage from MR-202609-0001",
            "items": [
                {
                    "material_code": "MAT-MOTOR-001",
                    "material_name": "Motor",
                    "category": "Electrical",
                    "quantity": 4.0,
                    "uom": "PCS",
                    "special_requirements": "4 Motors required for PUMP-100 assembly"
                }
            ]
        }
        
        rfq_res = await client.post(
            "/api/v1/procurement/rfqs",
            json=rfq_payload,
            headers={"X-User-Role": "PROCUREMENT", "X-Username": "procurement_specialist"}
        )
        assert rfq_res.status_code == 201, rfq_res.text
        rfq = rfq_res.json()
        rfq_id = rfq.get("id")
        rfq_no = rfq.get("rfqNumber") or rfq.get("rfq_number")
        rfq_status = rfq.get("status")
        print(f"Created RFQ Number: {rfq_no} | ID: {rfq_id} | Status: {rfq_status}")
        assert rfq_no is not None
        assert rfq.get("materialRequestNumber") == mr_no or rfq.get("material_request_number") == mr_no

        # Send RFQ to supplier
        send_res = await client.post(f"/api/v1/procurement/rfqs/{rfq_id}/send")
        assert send_res.status_code in [200, 204], send_res.text
        print("RFQ successfully sent to supplier.")

        # =========================================================================
        # 3. CREATE SUPPLIER QUOTATION
        # =========================================================================
        print("\n=== STEP 3: CREATE SUPPLIER QUOTATION ===")
        quote_payload = {
            "rfq_id": rfq_id,
            "supplier_id": sup_id,
            "status": "SUBMITTED",
            "discount": 0.0,
            "tax": 18.0,
            "freight_charges": 200.0,
            "additional_charges": 0.0,
            "delivery_time": "5 Days",
            "expected_delivery_date": (datetime.date.today() + datetime.timedelta(days=5)).isoformat(),
            "payment_terms": "Net 30",
            "warranty": "1 Year",
            "quotation_validity": (datetime.date.today() + datetime.timedelta(days=30)).isoformat(),
            "remarks": "Official quotation for 4x MAT-MOTOR-001",
            "lines": [
                {
                    "item_code": "MAT-MOTOR-001",
                    "material_name": "Motor",
                    "quantity": 4.0,
                    "unit_price": 2500.0,
                    "uom": "PCS"
                }
            ],
            "documents": []
        }
        
        quote_res = await client.post(
            "/api/v1/procurement/quotations",
            json=quote_payload,
            headers={"X-User-Role": "SUPPLIER", "X-Username": "e2e_motor_supplier"}
        )
        assert quote_res.status_code == 201, quote_res.text
        quote = quote_res.json()
        quote_id = quote.get("id")
        quote_status = quote.get("status")
        total_amt = float(quote.get("totalAmount") or quote.get("total_amount") or 0)
        print(f"Created Quotation ID: {quote_id} | Status: {quote_status} | Total: {total_amt}")
        assert quote_id is not None
        assert float(quote["lines"][0]["quantity"]) == 4.0
        assert quote["lines"][0]["itemCode"] == "MAT-MOTOR-001"

        # =========================================================================
        # 4. SELECT SUPPLIER & FINANCE APPROVAL
        # =========================================================================
        print("\n=== STEP 4: SELECT SUPPLIER & FINANCE APPROVAL ===")
        sel_payload = {
            "supplier_id": sup_id,
            "quotation_id": quote_id,
            "selection_reason": "Lowest evaluated compliant quotation with standard warranty",
            "selection_comments": "Recommended for immediate PO generation"
        }
        sel_res = await client.post(
            f"/api/v1/procurement/rfqs/{rfq_id}/select-supplier",
            json=sel_payload,
            headers={"X-User-Role": "PROCUREMENT", "X-Username": "procurement_specialist"}
        )
        assert sel_res.status_code == 200, sel_res.text
        sel_data = sel_res.json()
        po_id = sel_data.get("po_id") or sel_data.get("poId")
        prop_po_no = sel_data.get("po_number") or sel_data.get("poNumber")
        print(f"Supplier Selected. Proposed PO Number: {prop_po_no} | PO ID: {po_id}")
        assert po_id is not None

        # Verify PO is in PENDING_FINANCE
        po_get_res = await client.get(f"/api/v1/procurement/purchase-orders/{po_id}")
        assert po_get_res.status_code == 200
        po_before_appr = po_get_res.json()
        assert po_before_appr.get("status") == "PENDING_FINANCE"
        print(f"PO Initial Status: {po_before_appr.get('status')}")

        # Approve PO as Finance
        appr_res = await client.post(
            f"/api/v1/procurement/purchase-orders/{po_id}/approve",
            headers={"X-User-Role": "FINANCE", "X-Username": "finance_controller"}
        )
        assert appr_res.status_code == 200, appr_res.text
        appr_data = appr_res.json()
        final_po_no = appr_data.get("po_number") or appr_data.get("poNumber")
        assert appr_data.get("status") == "success"
        print(f"Finance Approved PO: {final_po_no} | Status: success | Approved By: finance_controller")
        assert final_po_no.startswith("PO-")

        # Verify PO status is APPROVED
        po_appr_check = await client.get(f"/api/v1/procurement/purchase-orders/{po_id}")
        assert po_appr_check.status_code == 200
        assert po_appr_check.json().get("status") == "APPROVED"

        # Send PO to Supplier
        send_po_res = await client.post(
            f"/api/v1/procurement/purchase-orders/{po_id}/send-to-supplier",
            headers={"X-User-Role": "PROCUREMENT", "X-Username": "procurement_specialist"}
        )
        assert send_po_res.status_code == 200, send_po_res.text
        print(f"Purchase Order {final_po_no} sent to supplier.")

        # Verify PO details
        po_final_res = await client.get(f"/api/v1/procurement/purchase-orders/{po_id}")
        assert po_final_res.status_code == 200
        po_final = po_final_res.json()
        po_items = po_final.get("items", [])
        assert len(po_items) >= 1
        assert po_items[0].get("materialCode") == "MAT-MOTOR-001" or po_items[0].get("itemCode") == "MAT-MOTOR-001"
        assert float(po_items[0].get("quantity") or 0) == 4.0
        print(f"Verified PO Item: {po_items[0].get('materialCode')} x {po_items[0].get('quantity')} {po_items[0].get('uom')}")

        # =========================================================================
        # 5. CREATE ASN
        # =========================================================================
        print("\n=== STEP 5: CREATE ADVANCED SHIPPING NOTICE (ASN) ===")
        asn_payload = {
            "asn_number": f"ASN-{datetime.date.today().strftime('%Y%m%d')}-0001",
            "po_id": str(po_id),
            "po_number": final_po_no,
            "vehicle_number": "KA-01-E-2026",
            "driver_name": "Ramesh Kumar",
            "driver_contact": "9876543210",
            "transporter": "FastTrack Logistics",
            "number_of_packages": 4,
            "package_type": "Box",
            "shipping_method": "Road",
            "invoice_number": "INV-2026-0042",
            "invoice_date": datetime.date.today().isoformat(),
            "challan_number": "DC-2026-0042",
            "challan_date": datetime.date.today().isoformat(),
            "shipment_date": datetime.date.today().isoformat(),
            "expected_arrival_at": (datetime.datetime.now() + datetime.timedelta(days=2)).isoformat(),
            "status": "SUBMITTED",
            "lines": [
                {
                    "item_code": "MAT-MOTOR-001",
                    "material_name": "Motor",
                    "shipped_quantity": 4.0,
                    "uom": "PCS"
                }
            ],
            "documents": []
        }

        asn_res = await client.post(
            "/api/v1/procurement/asns",
            json=asn_payload,
            headers={"X-User-Role": "SUPPLIER", "X-Username": "e2e_motor_supplier"}
        )
        assert asn_res.status_code == 201, asn_res.text
        asn = asn_res.json()
        asn_id = asn.get("id")
        asn_no = asn.get("asnNumber") or asn.get("asn_number")
        asn_status = asn.get("status")
        print(f"Created ASN Number: {asn_no} | ID: {asn_id} | Status: {asn_status}")
        assert asn_no is not None
        assert float(asn["lines"][0]["shippedQuantity"]) == 4.0

        # =========================================================================
        # 6. DOWNSTREAM ISOLATION VERIFICATION
        # =========================================================================
        print("\n=== STEP 6: DOWNSTREAM ISOLATION VERIFICATION ===")
        
        # Procurement counts
        rfqs_res = await client.get("/api/v1/procurement/rfqs")
        rfqs_count = len(rfqs_res.json())
        print(f"Total RFQs: {rfqs_count}")
        assert rfqs_count == 1

        quotes_res = await client.get("/api/v1/procurement/quotations")
        quotes_count = len(quotes_res.json())
        print(f"Total Quotations: {quotes_count}")
        assert quotes_count == 1

        pos_res = await client.get("/api/v1/procurement/purchase-orders")
        pos_count = len(pos_res.json())
        print(f"Total POs: {pos_count}")
        assert pos_count == 1

        asns_res = await client.get("/api/v1/procurement/asns")
        asns_count = len(asns_res.json())
        print(f"Total ASNs: {asns_count}")
        assert asns_count == 1

        # Downstream operations must be 0
        gate_res = await client.get("/api/v1/gate-entries")
        gate_count = len(gate_res.json()) if gate_res.status_code == 200 else 0
        print(f"Downstream Gate Entries: {gate_count}")
        assert gate_count == 0

        grn_res = await client.get("/api/v1/receiving/grns")
        grn_count = len(grn_res.json()) if grn_res.status_code == 200 else 0
        print(f"Downstream GRNs: {grn_count}")
        assert grn_count == 0

        putaway_res = await client.get("/api/v1/storage/putaway-tasks")
        putaway_count = len(putaway_res.json()) if putaway_res.status_code == 200 else 0
        print(f"Downstream Putaway Tasks: {putaway_count}")
        assert putaway_count == 0

        print("\n>>> ALL PROMPT 7 PROCUREMENT CHAIN STEPS PASSED SUCCESSFULLY! <<<")
