import uuid
from decimal import Decimal
from datetime import date, datetime
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database.session import UnitOfWork
from sqlalchemy import select
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialModel,
    MaterialVariantModel,
    MaterialRequestItemModel,
    PurchaseOrderItemModel,
    RfqItemModel,
    QuotationLineModel,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.asyncio
async def test_canonical_material_master_and_procurement_flow():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Headers with Procurement & Admin roles
        headers = {
            "X-User-Id": "00000000-0000-0000-0000-000000000001",
            "X-User-Name": "test_admin",
            "X-User-Roles": "ADMIN,WAREHOUSE_MANAGER,PROCUREMENT_OFFICER,FINANCE",
        }

        # -------------------------------------------------------------
        # 1. Create MAT-003 Copper Wire with 2 Variants
        # -------------------------------------------------------------
        mat_payload = {
            "material_code": "MAT-003",
            "material_name": "Copper Wire",
            "category": "Electrical",
            "description": "High conductivity industrial copper wiring",
            "base_uom": "MTR",
            "status": "Active",
            "variants": [
                {
                    "variant_code": "MAT-003-V001",
                    "size": "1.5 mm",
                    "color": "Red",
                    "grade": "A",
                    "specification": "Standard Insulated",
                    "uom": "MTR",
                    "status": "Active",
                },
                {
                    "variant_code": "MAT-003-V002",
                    "size": "2.5 mm",
                    "color": "Blue",
                    "grade": "A",
                    "specification": "Heavy Duty",
                    "uom": "MTR",
                    "status": "Active",
                },
            ],
        }

        # Clean up existing test data for MAT-003 to ensure fresh run
        from sqlalchemy import text
        from app.database.session import engine
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM purchase_order_item WHERE material_code = 'MAT-003' OR variant_code LIKE 'MAT-003%'"))
            await conn.execute(text("DELETE FROM quotation_line WHERE item_code LIKE 'MAT-003%' OR variant_code LIKE 'MAT-003%'"))
            await conn.execute(text("DELETE FROM rfq_item WHERE material_code = 'MAT-003' OR variant_code LIKE 'MAT-003%'"))
            await conn.execute(text("DELETE FROM material_request_item WHERE material_code = 'MAT-003' OR variant_code LIKE 'MAT-003%'"))
            await conn.execute(text("DELETE FROM material_variant WHERE material_id IN (SELECT id FROM material WHERE material_code = 'MAT-003')"))
            await conn.execute(text("DELETE FROM material WHERE material_code = 'MAT-003'"))

        create_res = await client.post("/api/v1/materials", json=mat_payload, headers=headers)
        assert create_res.status_code == 201, f"Failed creating MAT-003: {create_res.text}"
        mat_data = create_res.json()

        assert mat_data["material_code"] == "MAT-003"
        assert len(mat_data["variants"]) >= 2
        mat_id = mat_data["id"]
        v1 = next(v for v in mat_data["variants"] if v["variant_code"] == "MAT-003-V001")
        v2 = next(v for v in mat_data["variants"] if v["variant_code"] == "MAT-003-V002")
        v1_id = v1["id"]
        v2_id = v2["id"]

        # -------------------------------------------------------------
        # 2. Test Duplicate Variant Prevention
        # -------------------------------------------------------------
        dup_variant_payload = {
            "size": "1.5 mm",
            "color": "Red",
            "grade": "A",
            "specification": "Standard Insulated",
            "uom": "MTR",
            "status": "Active",
        }
        dup_res = await client.post(f"/api/v1/materials/{mat_id}/variants", json=dup_variant_payload, headers=headers)
        assert dup_res.status_code in [409, 422], f"Expected duplicate rejection but got {dup_res.status_code}: {dup_res.text}"

        # -------------------------------------------------------------
        # 3. Create Material Request for Variant MAT-003-V002
        # -------------------------------------------------------------
        mr_payload = {
            "warehouse_id": "WH-MAIN-01",
            "department": "Electrical Assembly",
            "requested_by": "test_admin",
            "requestedBy": "test_admin",
            "required_date": str(date.today()),
            "remarks": "Procurement for factory line B",
            "items": [
                {
                    "material_id": mat_id,
                    "material_variant_id": v2_id,
                    "material_code": "MAT-003",
                    "variant_code": "MAT-003-V002",
                    "material_name": "Copper Wire",
                    "quantity": 500,
                    "uom": "MTR",
                }
            ],
        }
        mr_res = await client.post("/api/v1/procurement/material-requests", json=mr_payload, headers=headers)
        assert mr_res.status_code in [200, 201], f"Failed creating MR: {mr_res.text}"
        mr_data = mr_res.json()
        mr_number = mr_data["request_number"]
        assert mr_data["items"][0]["material_id"] == mat_id
        assert mr_data["items"][0]["material_variant_id"] == v2_id
        assert mr_data["items"][0]["variant_code"] == "MAT-003-V002"

        async with engine.begin() as conn:
            await conn.execute(text("UPDATE material_request SET status = 'Approved' WHERE request_number = :rn"), {"rn": mr_number})

        # -------------------------------------------------------------
        # 4. Create Supplier (if needed) & RFQ for MAT-003-V002
        # -------------------------------------------------------------
        sup_res = await client.get("/api/v1/procurement/suppliers", headers=headers)
        suppliers = sup_res.json()
        if suppliers:
            supplier_id = suppliers[0].get("supplier_id") or suppliers[0].get("supplierId") or suppliers[0].get("id")
        else:
            sup_id = uuid.uuid4()
            async with engine.begin() as conn:
                await conn.execute(
                    text("INSERT INTO supplier (id, supplier_name, registered_company_name, vendor_type, category, industry, gstin, status, created_at, updated_at) VALUES (:id, 'Apex Electrical Supply Ltd', 'Apex Electrical Ltd', 'Manufacturer', '[\"Electrical\"]', 'Manufacturing', :gstin, 'Active', NOW(), NOW())"),
                    {"id": sup_id, "gstin": f"27AABCT{uuid.uuid4().hex[:4]}1Z5".upper()},
                )
            supplier_id = str(sup_id)

        rfq_payload = {
            "rfq_date": str(date.today()),
            "material_request_number": mr_number,
            "warehouse": "WH-MAIN-01",
            "procurement_officer": "test_admin",
            "supplier_ids": [supplier_id],
            "items": [
                {
                    "material_id": mat_id,
                    "material_variant_id": v2_id,
                    "material_code": "MAT-003",
                    "variant_code": "MAT-003-V002",
                    "material_name": "Copper Wire (2.5 mm Blue)",
                    "category": "Electrical",
                    "quantity": 500,
                    "uom": "MTR",
                }
            ],
        }
        rfq_res = await client.post("/api/v1/procurement/rfqs", json=rfq_payload, headers=headers)
        assert rfq_res.status_code in [200, 201], f"Failed creating RFQ: {rfq_res.text}"
        def get_f(d: dict, snake: str):
            camel = "".join(word.capitalize() if i > 0 else word for i, word in enumerate(snake.split("_")))
            return d.get(snake) if snake in d else d.get(camel)

        rfq_data = rfq_res.json()
        rfq_id = get_f(rfq_data, "id")
        rfq_item0 = rfq_data["items"][0]
        assert str(get_f(rfq_item0, "material_id")) == str(mat_id)
        assert str(get_f(rfq_item0, "material_variant_id")) == str(v2_id)
        assert get_f(rfq_item0, "variant_code") == "MAT-003-V002"

        # -------------------------------------------------------------
        # 5. Submit Quotation for the RFQ
        # -------------------------------------------------------------
        quote_payload = {
            "rfq_id": rfq_id,
            "supplier_id": supplier_id,
            "lines": [
                {
                    "material_id": mat_id,
                    "material_variant_id": v2_id,
                    "item_code": "MAT-003-V002",
                    "variant_code": "MAT-003-V002",
                    "quantity": 500,
                    "unit_price": 45.50,
                }
            ],
            "tax": 18.0,
            "discount": 0.0,
        }
        quote_res = await client.post("/api/v1/procurement/quotations", json=quote_payload, headers=headers)
        assert quote_res.status_code == 201, f"Failed submitting quote: {quote_res.text}"
        quote_data = quote_res.json()
        quote_id = get_f(quote_data, "id")
        quote_line0 = quote_data["lines"][0]
        assert str(get_f(quote_line0, "material_id")) == str(mat_id)
        assert str(get_f(quote_line0, "material_variant_id")) == str(v2_id)

        # -------------------------------------------------------------
        # 6. Select Quotation to Generate Purchase Order Proposal
        # -------------------------------------------------------------
        sel_payload = {
            "supplier_id": supplier_id,
            "selection_reason": "Lowest Price",
            "selection_comments": "Approved for best unit rate and compliance",
        }
        sel_res = await client.post(f"/api/v1/procurement/rfqs/{rfq_id}/select-supplier", json=sel_payload, headers=headers)
        assert sel_res.status_code == 200, f"Failed selecting quote: {sel_res.text}"
        po_id = get_f(sel_res.json(), "po_id")

        # Fetch PO and verify canonical references on item
        po_detail_res = await client.get(f"/api/v1/procurement/purchase-orders/{po_id}", headers=headers)
        assert po_detail_res.status_code == 200, f"Failed fetching PO: {po_detail_res.text}"
        po_detail = po_detail_res.json()
        assert len(po_detail["items"]) >= 1
        po_item = po_detail["items"][0]
        assert str(get_f(po_item, "material_id")) == str(mat_id)
        assert str(get_f(po_item, "material_variant_id")) == str(v2_id)
        assert get_f(po_item, "variant_code") == "MAT-003-V002"

        # -------------------------------------------------------------
        # 7. Test Transaction-Protected Variant Deletion (MAT-003-V002 has PO/MR)
        # -------------------------------------------------------------
        del_v2_res = await client.delete(f"/api/v1/materials/{mat_id}/variants/{v2_id}", headers=headers)
        assert del_v2_res.status_code == 400, f"Expected 400 deletion block, got {del_v2_res.status_code}: {del_v2_res.text}"
        assert "Cannot delete variant" in del_v2_res.json()["detail"]
        assert "Purchase Order" in del_v2_res.json()["detail"] or "Material Request" in del_v2_res.json()["detail"]

        # -------------------------------------------------------------
        # 8. Test Unused Variant Creation and Deletion
        # -------------------------------------------------------------
        unused_var_payload = {
            "variant_code": "MAT-003-V099",
            "size": "4.0 mm",
            "color": "Yellow",
            "grade": "B",
            "specification": "Temporary Test Variant",
            "uom": "MTR",
            "status": "Active",
        }
        unused_res = await client.post(f"/api/v1/materials/{mat_id}/variants", json=unused_var_payload, headers=headers)
        assert unused_res.status_code in [200, 201], f"Failed creating test variant: {unused_res.text}"
        unused_var_id = unused_res.json()["id"]

        del_unused_res = await client.delete(f"/api/v1/materials/{mat_id}/variants/{unused_var_id}", headers=headers)
        assert del_unused_res.status_code == 200, f"Expected 200 deletion success for unused variant, got {del_unused_res.status_code}: {del_unused_res.text}"
