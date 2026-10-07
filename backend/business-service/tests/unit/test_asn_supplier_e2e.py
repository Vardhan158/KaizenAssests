import uuid
import pytest
from datetime import datetime, date
from decimal import Decimal
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database.session import session_scope
from app.modules.procurement.infrastructure.persistence.models import (
    PurchaseOrderModel,
    SupplierModel,
    SupplierContactModel,
    AsnModel,
)


@pytest.mark.asyncio
async def test_asn_creation_sends_email_to_correct_supplier():
    # 1. Setup real test PO in database
    po_id = uuid.uuid4()
    sup_id = uuid.uuid4()
    test_supplier_email = "verified_supplier_recipient@example.com"
    test_po_number = f"PO-TEST-{uuid.uuid4().hex[:6].upper()}"
    test_asn_number = f"ASN-TEST-{uuid.uuid4().hex[:6].upper()}"

    async with session_scope() as session:
        sup = SupplierModel(
            id=sup_id,
            supplier_name="Apex Precision Tools Ltd",
            registered_company_name=f"Apex Precision Tools Ltd {uuid.uuid4().hex[:4]}",
            vendor_type="MANUFACTURER",
            category=["Tools"],
            industry="Tools",
            gstin=f"29AAACA{uuid.uuid4().hex[:4].upper()}1Z5",
            status="Active",
        )
        sup.contact = SupplierContactModel(
            id=uuid.uuid4(),
            supplier_id=sup_id,
            primary_contact_name="Aarav Sharma",
            primary_email=test_supplier_email,
        )
        session.add(sup)
        await session.flush()

        po = PurchaseOrderModel(
            id=po_id,
            po_number=test_po_number,
            supplier_id=sup_id,
            supplier_name="Apex Precision Tools Ltd",
            supplier_email=test_supplier_email,
            delivery_warehouse_name="Central Logistics Hub",
            status="ISSUED",
        )
        session.add(po)
        await session.commit()

    # 2. Call POST /api/v1/procurement/asns
    captured_deliveries = []

    async def mock_send_email(to_email, subject, body, html_body=None, attachments=None):
        captured_deliveries.append({
            "to_email": to_email,
            "subject": subject,
            "body": body,
            "html_body": html_body,
        })
        return True

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("app.modules.procurement.infrastructure.api.router.send_email", side_effect=mock_send_email):
            payload = {
                "po_id": str(po_id),
                "po_number": test_po_number,
                "asn_number": test_asn_number,
                "shipment_date": "2026-09-05",
                "expected_arrival_at": "2026-09-08T14:30:00Z",
                "vehicle_number": "KA-01-EQ-9988",
                "driver_name": "Ramesh Patel",
                "driver_contact": "+91 9988776655",
                "transporter": "VRL Express",
                "number_of_packages": 15,
                "package_type": "Wooden Box",
                "status": "SUBMITTED",
                "lines": [
                    {
                        "item_code": "MAT-TOOL-001",
                        "material_name": "Carbide Drill Bit 8mm",
                        "shipped_quantity": 250.0,
                        "uom": "PCS",
                    }
                ],
                "documents": [],
            }
            response = await client.post(
                "/api/v1/procurement/asns",
                json=payload,
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 201, response.text
            resp_data = response.json()
            assert resp_data.get("asnNumber") == test_asn_number or resp_data.get("asn_number") == test_asn_number

    # 3. Assert email delivery to correct supplier
    assert len(captured_deliveries) >= 1
    supplier_delivery = next(
        (d for d in captured_deliveries if d["to_email"] == test_supplier_email),
        None
    )
    assert supplier_delivery is not None, f"Expected delivery to {test_supplier_email}, got {captured_deliveries}"

    assert supplier_delivery["to_email"] == test_supplier_email
    assert test_asn_number in supplier_delivery["subject"]
    assert test_po_number in supplier_delivery["subject"]
    assert f"Dear Apex Precision Tools Ltd," in supplier_delivery["body"]
    assert f"ASN Number:\n{test_asn_number}" in supplier_delivery["body"]
    assert f"PO Number:\n{test_po_number}" in supplier_delivery["body"]
    assert "MAT-TOOL-001" in supplier_delivery["body"]
    assert "250.0000" in supplier_delivery["body"]
    assert "Ramesh Patel" in supplier_delivery["body"]
    assert "KA-01-EQ-9988" in supplier_delivery["body"]
