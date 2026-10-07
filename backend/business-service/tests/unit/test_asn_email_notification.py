"""Unit tests for Advance Shipment Notice (ASN) email generation and dispatch logic."""

import uuid
from datetime import datetime, date
from decimal import Decimal
from unittest.mock import MagicMock, patch
import pytest

from app.modules.procurement.infrastructure.persistence.models import (
    AsnModel,
    AsnLineModel,
    PurchaseOrderModel,
)
from app.modules.procurement.infrastructure.api.router import (
    _dispatch_asn_email,
)
from app.config.settings import Settings


def create_fake_asn():
    asn_id = uuid.uuid4()
    line1 = AsnLineModel(
        id=uuid.uuid4(),
        asn_id=asn_id,
        item_code="MAT-0019",
        material_name="Steel Rod 10mm",
        shipped_quantity=Decimal("150.0000"),
        uom="PCS",
    )
    line2 = AsnLineModel(
        id=uuid.uuid4(),
        asn_id=asn_id,
        item_code="MAT-0020",
        material_name="Aluminium Sheet",
        shipped_quantity=Decimal("50.0000"),
        uom="MTR",
    )
    asn = AsnModel(
        id=asn_id,
        asn_number="ASN-2026-0008",
        po_id=str(uuid.uuid4()),
        po_number="PO-2026-0009",
        vehicle_number="AP-13-N-0001",
        expected_arrival_at=datetime(2026, 9, 5, 14, 30),
        shipment_date=date(2026, 9, 3),
        driver_name="Rajesh Kumar",
        driver_contact="+91 9876543210",
        transporter="FastLogistics Ltd",
        number_of_packages=10,
        package_type="Wooden Crates",
        status="SUBMITTED",
    )
    asn.lines = [line1, line2]
    asn.documents = []
    return asn


@pytest.mark.asyncio
async def test_dispatch_asn_email_content_and_recipient():
    asn = create_fake_asn()
    po = PurchaseOrderModel(
        id=uuid.UUID(asn.po_id),
        po_number="PO-2026-0009",
        supplier_name="obys",
        delivery_warehouse_name="Main Warehouse",
        supplier_email="supplier@example.com",
    )

    bg_tasks = MagicMock()

    custom_settings = Settings(
        procurement_email="procurement-team@nexuswms.com",
        warehouse_email="warehouse-ops@nexuswms.com",
        email_host_user="test_host_user@example.com",
        email_host_password="test_password",
    )

    with patch("app.modules.procurement.infrastructure.api.router.get_settings", return_value=custom_settings), \
         patch("app.modules.procurement.infrastructure.api.router.send_email", return_value=True) as mock_send:
        await _dispatch_asn_email(
            asn=asn,
            po_obj=po,
            supplier_name="obys",
            warehouse_name="Main Warehouse",
            background_tasks=bg_tasks,
            is_resubmit=False,
        )

        # Verify direct email dispatch to Supplier
        assert mock_send.called
        call_kwargs = mock_send.call_args[1] if mock_send.call_args[1] else {}
        call_args = mock_send.call_args[0]
        to_email = call_kwargs.get("to_email") or call_args[0]
        subject = call_kwargs.get("subject") or call_args[1]
        body = call_kwargs.get("body") or call_args[2]
        html_body = call_kwargs.get("html_body") or call_args[3]

        assert to_email == "supplier@example.com"
        assert subject == "Advance Shipment Notice - ASN ASN-2026-0008 - PO PO-2026-0009"
        assert "Dear obys," in body
        assert "ASN Number:\nASN-2026-0008" in body
        assert "PO Number:\nPO-2026-0009" in body
        assert "Supplier:\nobys" in body
        assert "MAT-0019" in body
        assert "Steel Rod 10mm" in body
        assert "MAT-0020" in body
        assert "Aluminium Sheet" in body
        assert "Regards,\nNexusWMS Procurement" in body

        # Verify internal copy queued for warehouse
        assert bg_tasks.add_task.called
        internal_recipient = bg_tasks.add_task.call_args[0][1]
        assert internal_recipient == "warehouse-ops@nexuswms.com"


@pytest.mark.asyncio
async def test_dispatch_asn_email_with_explicit_supplier_email():
    asn = create_fake_asn()
    bg_tasks = MagicMock()

    custom_settings = Settings(
        procurement_email="procurement@nexuswms.com",
        warehouse_email="",
        email_host_user="",
    )

    with patch("app.modules.procurement.infrastructure.api.router.get_settings", return_value=custom_settings), \
         patch("app.modules.procurement.infrastructure.api.router.send_email", return_value=True) as mock_send:
        await _dispatch_asn_email(
            asn=asn,
            po_obj=None,
            supplier_name="Acme Corp",
            warehouse_name="North Hub",
            background_tasks=bg_tasks,
            is_resubmit=False,
            supplier_email="acme-dispatch@example.com",
        )

        assert mock_send.called
        to_email = mock_send.call_args[1].get("to_email") or mock_send.call_args[0][0]
        assert to_email == "acme-dispatch@example.com"


@pytest.mark.asyncio
async def test_dispatch_asn_email_missing_supplier_email_raises_error():
    from fastapi import HTTPException
    asn = create_fake_asn()
    asn.po_number = "PO-2026-0099"

    with pytest.raises(HTTPException) as exc_info:
        await _dispatch_asn_email(
            asn=asn,
            po_obj=None,
            supplier_name="NoEmail Supplier",
            warehouse_name="Main Warehouse",
            supplier_email=None,
        )
    assert exc_info.value.status_code == 400
    assert "Supplier email not found" in exc_info.value.detail


