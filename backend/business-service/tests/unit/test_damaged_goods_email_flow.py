"""
Unit tests for the damaged/rejected goods auto-fetch and dual-recipient email delivery flow.
"""
from decimal import Decimal
import os
import tempfile
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.common.damage_email_attachments import collect_damage_attachments
from app.modules.receiving.infrastructure.api.router import notify_vendor_damage, get_grn_context, get_grn_detail
from app.modules.receiving.infrastructure.api.schemas import (
    GrnDamageVendorNotifyRequest,
    DamageItemPayload,
)


@pytest.fixture
def mock_uow():
    uow = MagicMock()
    session = AsyncMock()
    uow.session = session
    uow.commit = AsyncMock()
    uow.rollback = AsyncMock()
    session.commit = AsyncMock()
    session.add = MagicMock()
    
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_result.scalars.return_value.first.return_value = None
    mock_result.scalars.return_value.all.return_value = []
    session.execute = AsyncMock(return_value=mock_result)
    return uow


@pytest.fixture
def mock_current_user():
    return SimpleNamespace(username="inspector_1", roles=["RECEIVING", "ADMIN"])


# 1. Damaged item + valid supplier email + valid Procurement email -> BOTH receive emails
@pytest.mark.asyncio
async def test_damaged_item_valid_supplier_and_procurement_email(mock_uow, mock_current_user):
    grn_id = uuid.uuid4()
    mock_line = SimpleNamespace(
        id=uuid.uuid4(),
        item_code="MAT-001",
        material_name="Steel Rod",
        damaged_quantity=Decimal("5"),
        rejected_quantity=Decimal("0"),
        quality_result="REJECTED",
        uom="PCS",
        damage_lots=[],
        damage_evidence=[],
    )
    mock_grn = SimpleNamespace(
        id=grn_id,
        grn_number="GRN-2026-0001",
        po_number="PO-2026-0001",
        supplier_name="Acme Corp",
        supplier_company_name="Acme Industrial Ltd",
        supplier_email="vendor@acme.com",
        warehouse_name="Main Warehouse",
        lines=[mock_line],
    )

    with patch(
        "app.modules.receiving.infrastructure.api.router.SqlAlchemyGrnRepository.get_grn_detail_by_id",
        new=AsyncMock(return_value=mock_grn),
    ), patch(
        "app.modules.receiving.infrastructure.api.router.send_email",
        new=AsyncMock(return_value=True),
    ) as mock_send_email, patch(
        "app.modules.receiving.infrastructure.api.router.get_settings"
    ) as mock_settings:
        settings_obj = MagicMock()
        settings_obj.procurement_email = "spoorthiharakuni55@gmail.com"
        settings_obj.email_host_user = "spoorthiharakuni@gmail.com"
        mock_settings.return_value = settings_obj

        # Request payload without manual supplier email (should auto-fetch from GRN/PO)
        request_body = GrnDamageVendorNotifyRequest(
            supplier_email="",
            damage_items=[
                DamageItemPayload(
                    item_code="MAT-001",
                    material_name="Steel Rod",
                    damaged_quantity=Decimal("5"),
                    reason="Crushed package",
                )
            ],
        )

        response = await notify_vendor_damage(
            grn_id=str(grn_id),
            body=request_body,
            uow=mock_uow,
            user=mock_current_user,
            _perm=None,
        )

        assert response.status == "SUCCESS"
        assert response.vendor_email == "vendor@acme.com"
        assert response.supplier_email == "vendor@acme.com"
        assert response.procurement_email == "spoorthiharakuni55@gmail.com"
        assert response.email_delivered is True
        assert response.supplier_status == "SENT"
        assert response.procurement_status == "SENT"
        assert response.procurement_notified is True
        assert mock_send_email.call_count == 2

        # Check call recipients
        call_recipients = [call.kwargs["to_email"] for call in mock_send_email.call_args_list]
        assert "vendor@acme.com" in call_recipients
        assert "spoorthiharakuni55@gmail.com" in call_recipients


# 2. Damaged item + auto-fetch from PO -> SupplierContactModel
@pytest.mark.asyncio
async def test_damaged_item_auto_fetch_from_po_contact(mock_uow, mock_current_user):
    grn_id = uuid.uuid4()
    mock_line = SimpleNamespace(
        id=uuid.uuid4(),
        item_code="MAT-002",
        material_name="Aluminum Sheet",
        damaged_quantity=Decimal("2"),
        rejected_quantity=Decimal("0"),
        quality_result="REJECTED",
        uom="PCS",
        damage_lots=[],
        damage_evidence=[],
    )
    mock_grn = SimpleNamespace(
        id=grn_id,
        grn_number="GRN-2026-0002",
        po_number="PO-2026-0002",
        supplier_name="Global Aluminum",
        supplier_company_name="Global Aluminum Ltd",
        supplier_email="",
        warehouse_name="Main Warehouse",
        lines=[mock_line],
    )

    # Database returns PO and associated Supplier Contact
    mock_po = SimpleNamespace(
        supplier_id=uuid.uuid4(),
        supplier_email=None,
    )
    mock_contact = SimpleNamespace(
        primary_contact_name="Spoorti",
        primary_email="spoorti@globalaluminum.com",
        secondary_email=None,
    )
    mock_exec_res = MagicMock()
    mock_exec_res.scalar_one_or_none.side_effect = [mock_po, mock_contact]
    mock_uow.session.execute.return_value = mock_exec_res

    with patch(
        "app.modules.receiving.infrastructure.api.router.SqlAlchemyGrnRepository.get_grn_detail_by_id",
        new=AsyncMock(return_value=mock_grn),
    ), patch(
        "app.modules.receiving.infrastructure.api.router.send_email",
        new=AsyncMock(return_value=True),
    ) as mock_send_email, patch(
        "app.modules.receiving.infrastructure.api.router.get_settings"
    ) as mock_settings:
        settings_obj = MagicMock()
        settings_obj.procurement_email = "spoorthiharakuni55@gmail.com"
        mock_settings.return_value = settings_obj

        request_body = GrnDamageVendorNotifyRequest(
            supplier_email="",
            damage_items=[
                DamageItemPayload(
                    item_code="MAT-002",
                    material_name="Aluminum Sheet",
                    damaged_quantity=Decimal("2"),
                    reason="Dented",
                )
            ],
        )

        response = await notify_vendor_damage(
            grn_id=str(grn_id),
            body=request_body,
            uow=mock_uow,
            user=mock_current_user,
            _perm=None,
        )

        assert response.status == "SUCCESS"
        assert response.vendor_email == "spoorti@globalaluminum.com"
        assert response.procurement_status == "SENT"
        assert response.supplier_status == "SENT"
        assert mock_send_email.call_count == 2
        call_recipients = [call.kwargs["to_email"] for call in mock_send_email.call_args_list]
        assert "spoorti@globalaluminum.com" in call_recipients
        assert "spoorthiharakuni55@gmail.com" in call_recipients


# 3. Damaged item + missing supplier email (logs warning, still delivers to Procurement)
@pytest.mark.asyncio
async def test_damaged_item_missing_supplier_email(mock_uow, mock_current_user):
    grn_id = uuid.uuid4()
    mock_line = SimpleNamespace(
        id=uuid.uuid4(),
        item_code="MAT-003",
        material_name="Copper Wire",
        damaged_quantity=Decimal("10"),
        rejected_quantity=Decimal("0"),
        quality_result="REJECTED",
        uom="MTR",
        damage_lots=[],
        damage_evidence=[],
    )
    mock_grn = SimpleNamespace(
        id=grn_id,
        grn_number="GRN-2026-0003",
        po_number="PO-2026-0003",
        supplier_name="Unknown Supplier",
        supplier_company_name="Unknown Corp",
        supplier_email="",
        warehouse_name="Main Warehouse",
        lines=[mock_line],
    )

    mock_exec_res = MagicMock()
    mock_exec_res.scalar_one_or_none.return_value = None
    mock_exec_res.scalars.return_value.first.return_value = None
    mock_uow.session.execute.return_value = mock_exec_res

    with patch(
        "app.modules.receiving.infrastructure.api.router.SqlAlchemyGrnRepository.get_grn_detail_by_id",
        new=AsyncMock(return_value=mock_grn),
    ), patch(
        "app.modules.receiving.infrastructure.api.router.send_email",
        new=AsyncMock(return_value=True),
    ) as mock_send_email, patch(
        "app.modules.receiving.infrastructure.api.router.get_settings"
    ) as mock_settings:
        settings_obj = MagicMock()
        settings_obj.procurement_email = "spoorthiharakuni55@gmail.com"
        mock_settings.return_value = settings_obj

        request_body = GrnDamageVendorNotifyRequest(
            supplier_email="",
            damage_items=[
                DamageItemPayload(
                    item_code="MAT-003",
                    material_name="Copper Wire",
                    damaged_quantity=Decimal("10"),
                    reason="Insulation cut",
                )
            ],
        )

        response = await notify_vendor_damage(
            grn_id=str(grn_id),
            body=request_body,
            uow=mock_uow,
            user=mock_current_user,
            _perm=None,
        )

        assert response.status == "SUCCESS"
        assert response.vendor_email == ""
        assert response.supplier_status == "NOT_CONFIGURED"
        assert response.procurement_status == "SENT"
        assert response.procurement_notified is True
        # Only procurement email was dispatched
        assert mock_send_email.call_count == 1
        assert mock_send_email.call_args_list[0].kwargs["to_email"] == "spoorthiharakuni55@gmail.com"


# 4. Zero damaged quantity should NOT send any emails (HTTP 400)
@pytest.mark.asyncio
async def test_zero_damaged_quantity_rejects_email(mock_uow, mock_current_user):
    grn_id = uuid.uuid4()
    mock_line = SimpleNamespace(
        id=uuid.uuid4(),
        item_code="MAT-004",
        material_name="Perfect Goods",
        damaged_quantity=Decimal("0"),
        rejected_quantity=Decimal("0"),
        quality_result="APPROVED",
        uom="PCS",
        damage_lots=[],
        damage_evidence=[],
    )
    mock_grn = SimpleNamespace(
        id=grn_id,
        grn_number="GRN-2026-0004",
        po_number="PO-2026-0004",
        supplier_name="Perfect Co",
        supplier_company_name="Perfect Ltd",
        supplier_email="sales@perfectco.com",
        warehouse_name="Main Warehouse",
        lines=[mock_line],
    )

    with patch(
        "app.modules.receiving.infrastructure.api.router.SqlAlchemyGrnRepository.get_grn_detail_by_id",
        new=AsyncMock(return_value=mock_grn),
    ), patch(
        "app.modules.receiving.infrastructure.api.router.send_email",
        new=AsyncMock(return_value=True),
    ) as mock_send_email:
        request_body = GrnDamageVendorNotifyRequest(
            supplier_email="sales@perfectco.com",
            damage_items=[
                DamageItemPayload(
                    item_code="MAT-004",
                    material_name="Perfect Goods",
                    damaged_quantity=Decimal("0"),
                    reason="",
                )
            ],
        )

        with pytest.raises(HTTPException) as exc_info:
            await notify_vendor_damage(
                grn_id=str(grn_id),
                body=request_body,
                uow=mock_uow,
                user=mock_current_user,
                _perm=None,
            )

        assert exc_info.value.status_code == 400
        assert "No damaged or rejected items found" in exc_info.value.detail
        assert mock_send_email.call_count == 0


# 5. Current GRN with 1 damage photo
def test_collect_damage_attachments_single_photo():
    with tempfile.TemporaryDirectory() as tmpdir:
        grn_id = uuid.uuid4()
        grn_subfolder = os.path.join(tmpdir, f"damage_evidence_{grn_id.hex}")
        os.makedirs(grn_subfolder, exist_ok=True)

        photo_file = os.path.join(grn_subfolder, "damage_1.jpg")
        # Valid JPEG magic bytes + dummy payload
        with open(photo_file, "wb") as f:
            f.write(b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"A" * 100)

        ev_id = uuid.uuid4()
        mock_evidence = SimpleNamespace(
            id=ev_id,
            file_path=photo_file,
            reason="Cracked body",
            uploaded_at=None,
        )
        mock_line = SimpleNamespace(
            item_code="MAT-101",
            damaged_quantity=Decimal("3"),
            rejected_quantity=Decimal("0"),
            quality_result="REJECTED",
            damage_lots=[],
            damage_evidence=[mock_evidence],
        )
        mock_grn = SimpleNamespace(
            id=grn_id,
            lines=[mock_line],
        )

        attachments = collect_damage_attachments(mock_grn, upload_dir=tmpdir)
        assert len(attachments) == 1
        assert attachments[0][0].startswith("MAT-101_damage_1")
        assert attachments[0][2] == "image/jpeg"


# 6. Current GRN with multiple damage photos
def test_collect_damage_attachments_multiple_photos():
    with tempfile.TemporaryDirectory() as tmpdir:
        grn_id = uuid.uuid4()
        grn_subfolder = os.path.join(tmpdir, f"damage_evidence_{grn_id.hex}")
        os.makedirs(grn_subfolder, exist_ok=True)

        ev_ids = []
        evidence_list = []
        for i in range(3):
            photo_file = os.path.join(grn_subfolder, f"damage_{i}.png")
            # Valid PNG magic bytes + dummy payload
            with open(photo_file, "wb") as f:
                f.write(b"\x89PNG\r\n\x1a\n" + b"B" * 100)

            ev_id = uuid.uuid4()
            ev_ids.append(str(ev_id))
            evidence_list.append(
                SimpleNamespace(
                    id=ev_id,
                    file_path=photo_file,
                    reason=f"Breakage #{i}",
                    uploaded_at=None,
                )
            )

        mock_line = SimpleNamespace(
            item_code="MAT-202",
            damaged_quantity=Decimal("5"),
            rejected_quantity=Decimal("0"),
            quality_result="REJECTED",
            damage_lots=[],
            damage_evidence=evidence_list,
        )
        mock_grn = SimpleNamespace(
            id=grn_id,
            lines=[mock_line],
        )

        attachments = collect_damage_attachments(mock_grn, upload_dir=tmpdir, photo_ids=ev_ids)
        assert len(attachments) == 3
        for fn, content, mime in attachments:
            assert fn.startswith("MAT-202_damage_")
            assert mime == "image/png"


# 7. Photo isolation: reject photos from previous GRNs
def test_photo_isolation_rejects_previous_grn_photos():
    with tempfile.TemporaryDirectory() as tmpdir:
        current_grn_id = uuid.uuid4()
        previous_grn_id = uuid.uuid4()

        prev_subfolder = os.path.join(tmpdir, f"damage_evidence_{previous_grn_id.hex}")
        os.makedirs(prev_subfolder, exist_ok=True)
        prev_photo_file = os.path.join(prev_subfolder, "old_damage.jpg")
        with open(prev_photo_file, "wb") as f:
            f.write(b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"OLD" * 100)

        mock_evidence = SimpleNamespace(
            id=uuid.uuid4(),
            file_path=prev_photo_file,
            reason="Old damage",
            uploaded_at=None,
        )
        mock_line = SimpleNamespace(
            item_code="MAT-SAME",
            damaged_quantity=Decimal("1"),
            rejected_quantity=Decimal("0"),
            quality_result="REJECTED",
            damage_lots=[],
            damage_evidence=[mock_evidence],
        )
        mock_grn = SimpleNamespace(
            id=current_grn_id,
            lines=[mock_line],
        )

        attachments = collect_damage_attachments(mock_grn, upload_dir=tmpdir)
        assert len(attachments) == 0


# 8. Password normalization removes all spaces, tabs, newlines safely
def test_normalize_smtp_password():
    from app.common.email_utils import normalize_smtp_password
    assert normalize_smtp_password("abcd efgh ijkl mnop") == "abcdefghijklmnop"
    assert normalize_smtp_password(' "abcd efgh ijkl mnop" ') == "abcdefghijklmnop"
    assert normalize_smtp_password(" abcd\tefgh\nijkl\r\nmnop ") == "abcdefghijklmnop"
    assert normalize_smtp_password("") == ""
    assert normalize_smtp_password(None) == ""


# 9. Greeting uses supplier contact name when available
@pytest.mark.asyncio
async def test_supplier_greeting_uses_contact_name(mock_uow, mock_current_user):
    grn_id = uuid.uuid4()
    mock_line = SimpleNamespace(
        id=uuid.uuid4(),
        item_code="MAT-GREET",
        material_name="Gear Box",
        damaged_quantity=Decimal("1"),
        rejected_quantity=Decimal("0"),
        quality_result="REJECTED",
        uom="PCS",
        damage_lots=[],
        damage_evidence=[],
    )
    mock_grn = SimpleNamespace(
        id=grn_id,
        grn_number="GRN-2026-GREET",
        po_number="PO-2026-GREET",
        supplier_name="Global Metals Ltd Corp LLC",
        supplier_company_name="Global Metals Ltd Corp LLC",
        supplier_email="",
        warehouse_name="Main Warehouse",
        lines=[mock_line],
    )

    mock_contact = SimpleNamespace(
        primary_contact_name="Spoorti",
        primary_email="spoorti@globalmetals.com",
        secondary_email=None,
    )
    mock_po = SimpleNamespace(
        supplier_id=uuid.uuid4(),
        supplier_email="sales@globalmetals.com",
    )

    mock_exec_res = MagicMock()
    mock_exec_res.scalar_one_or_none.side_effect = [mock_po, mock_contact]
    mock_uow.session.execute.return_value = mock_exec_res

    with patch(
        "app.modules.receiving.infrastructure.api.router.SqlAlchemyGrnRepository.get_grn_detail_by_id",
        new=AsyncMock(return_value=mock_grn),
    ), patch(
        "app.modules.receiving.infrastructure.api.router.send_email",
        new=AsyncMock(return_value=True),
    ) as mock_send_email, patch(
        "app.modules.receiving.infrastructure.api.router.render_premium_email"
    ) as mock_render_email, patch(
        "app.modules.receiving.infrastructure.api.router.get_settings"
    ) as mock_settings:
        settings_obj = MagicMock()
        settings_obj.procurement_email = "spoorthiharakuni55@gmail.com"
        mock_settings.return_value = settings_obj
        mock_render_email.return_value = "<html>mock</html>"

        request_body = GrnDamageVendorNotifyRequest(
            supplier_email="",
            damage_items=[
                DamageItemPayload(
                    item_code="MAT-GREET",
                    material_name="Gear Box",
                    damaged_quantity=Decimal("1"),
                    reason="Crack",
                )
            ],
        )

        response = await notify_vendor_damage(
            grn_id=str(grn_id),
            body=request_body,
            uow=mock_uow,
            user=mock_current_user,
            _perm=None,
        )

        assert response.email_delivered is True
        supplier_email_call = mock_render_email.call_args_list[0]
        assert supplier_email_call.kwargs["greeting"] == "Dear Spoorti Team,"


# 10. Scenario B: Procurement fails + Supplier succeeds (independent send)
@pytest.mark.asyncio
async def test_scenario_b_procurement_fails_supplier_succeeds(mock_uow, mock_current_user):
    grn_id = uuid.uuid4()
    mock_line = SimpleNamespace(
        id=uuid.uuid4(),
        item_code="MAT-SCEN-B",
        material_name="Item B",
        damaged_quantity=Decimal("2"),
        rejected_quantity=Decimal("0"),
        quality_result="REJECTED",
        uom="PCS",
        damage_lots=[],
        damage_evidence=[],
    )
    mock_grn = SimpleNamespace(
        id=grn_id,
        grn_number="GRN-SCEN-B",
        po_number="PO-SCEN-B",
        supplier_name="Supplier B",
        supplier_company_name="Supplier B Corp",
        supplier_email="supplier_b@example.com",
        warehouse_name="Main Warehouse",
        lines=[mock_line],
    )

    async def _send_mock(to_email, **kwargs):
        if to_email == "supplier_b@example.com":
            return True
        raise RuntimeError("Procurement SMTP Timeout")

    with patch(
        "app.modules.receiving.infrastructure.api.router.SqlAlchemyGrnRepository.get_grn_detail_by_id",
        new=AsyncMock(return_value=mock_grn),
    ), patch(
        "app.modules.receiving.infrastructure.api.router.send_email",
        side_effect=_send_mock,
    ) as mock_send_email, patch(
        "app.modules.receiving.infrastructure.api.router.get_settings"
    ) as mock_settings:
        settings_obj = MagicMock()
        settings_obj.procurement_email = "spoorthiharakuni55@gmail.com"
        mock_settings.return_value = settings_obj

        request_body = GrnDamageVendorNotifyRequest(
            supplier_email="supplier_b@example.com",
            damage_items=[
                DamageItemPayload(
                    item_code="MAT-SCEN-B",
                    material_name="Item B",
                    damaged_quantity=Decimal("2"),
                    reason="Broken seal",
                )
            ],
        )

        response = await notify_vendor_damage(
            grn_id=str(grn_id),
            body=request_body,
            uow=mock_uow,
            user=mock_current_user,
            _perm=None,
        )

        assert mock_send_email.call_count == 2
        assert response.supplier_status == "SENT"
        assert response.procurement_status == "FAILED"
        assert "Procurement SMTP Timeout" in response.procurement_error
        assert response.email_delivered is True


# 11. Scenario C: Supplier fails + Procurement succeeds (independent send)
@pytest.mark.asyncio
async def test_scenario_c_supplier_fails_procurement_succeeds(mock_uow, mock_current_user):
    grn_id = uuid.uuid4()
    mock_line = SimpleNamespace(
        id=uuid.uuid4(),
        item_code="MAT-SCEN-C",
        material_name="Item C",
        damaged_quantity=Decimal("3"),
        rejected_quantity=Decimal("0"),
        quality_result="REJECTED",
        uom="PCS",
        damage_lots=[],
        damage_evidence=[],
    )
    mock_grn = SimpleNamespace(
        id=grn_id,
        grn_number="GRN-SCEN-C",
        po_number="PO-SCEN-C",
        supplier_name="Supplier C",
        supplier_company_name="Supplier C Corp",
        supplier_email="supplier_c@example.com",
        warehouse_name="Main Warehouse",
        lines=[mock_line],
    )

    async def _send_mock(to_email, **kwargs):
        if to_email == "spoorthiharakuni55@gmail.com":
            return True
        raise RuntimeError("Supplier SMTP Host Unreachable")

    with patch(
        "app.modules.receiving.infrastructure.api.router.SqlAlchemyGrnRepository.get_grn_detail_by_id",
        new=AsyncMock(return_value=mock_grn),
    ), patch(
        "app.modules.receiving.infrastructure.api.router.send_email",
        side_effect=_send_mock,
    ) as mock_send_email, patch(
        "app.modules.receiving.infrastructure.api.router.get_settings"
    ) as mock_settings:
        settings_obj = MagicMock()
        settings_obj.procurement_email = "spoorthiharakuni55@gmail.com"
        mock_settings.return_value = settings_obj

        request_body = GrnDamageVendorNotifyRequest(
            supplier_email="supplier_c@example.com",
            damage_items=[
                DamageItemPayload(
                    item_code="MAT-SCEN-C",
                    material_name="Item C",
                    damaged_quantity=Decimal("3"),
                    reason="Leaking fluid",
                )
            ],
        )

        response = await notify_vendor_damage(
            grn_id=str(grn_id),
            body=request_body,
            uow=mock_uow,
            user=mock_current_user,
            _perm=None,
        )

        assert mock_send_email.call_count == 2
        assert response.supplier_status == "FAILED"
        assert response.procurement_status == "SENT"
        assert "Supplier SMTP Host Unreachable" in response.supplier_error
        assert response.email_delivered is True


# 12. Test upload_damage_evidence response schema and media path format
@pytest.mark.asyncio
async def test_upload_damage_evidence_response_structure(mock_uow, mock_current_user):
    from app.modules.receiving.infrastructure.api.router import upload_damage_evidence
    from starlette.datastructures import UploadFile
    import io

    line_uuid = uuid.uuid4()
    grn_uuid = uuid.uuid4()
    mock_line = SimpleNamespace(
        id=line_uuid,
        grn_id=grn_uuid,
        item_code="MAT-PHOTO-01",
        material_name="Photo Material",
        damaged_quantity=Decimal("2"),
    )

    mock_evidence = SimpleNamespace(
        id=uuid.uuid4(),
        grn_line_id=line_uuid,
        damaged_quantity=Decimal("2"),
        reason="Cracked screen",
        remarks="Test remark",
        file_name="MAT-PHOTO-01_test.jpg",
        file_path=f"/media/damage_evidence/{grn_uuid}/{line_uuid}/MAT-PHOTO-01_test.jpg",
        uploaded_by="inspector_1",
        uploaded_at="2026-09-08T12:00:00Z",
    )

    with patch(
        "app.modules.receiving.infrastructure.api.router.SqlAlchemyGrnRepository.add_damage_evidence",
        new=AsyncMock(return_value=mock_evidence),
    ):
        mock_uow.session.get = AsyncMock(return_value=mock_line)

        test_file = UploadFile(
            filename="damage.jpg",
            file=io.BytesIO(b"fake-image-bytes"),
        )

        resp = await upload_damage_evidence(
            grn_line_id=str(line_uuid),
            damaged_quantity=2.0,
            reason="Cracked screen",
            remarks="Test remark",
            file=test_file,
            uow=mock_uow,
            user=mock_current_user,
            _perm=None,
        )

        assert resp.evidence_id == str(mock_evidence.id)
        assert resp.grn_line_id == str(line_uuid)
        assert resp.file_path.startswith("/media/damage_evidence/")
        assert resp.file_name == mock_evidence.file_name

