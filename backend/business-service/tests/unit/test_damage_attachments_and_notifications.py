from decimal import Decimal
from pathlib import Path
import tempfile
import uuid
import pytest
from unittest.mock import MagicMock

from app.common.damage_email_attachments import collect_damage_attachments


def test_collect_damage_attachments_filters_by_current_photo_ids():
    with tempfile.TemporaryDirectory() as tmpdir:
        upload_dir = Path(tmpdir)
        
        # Create dummy image files
        img1_path = upload_dir / "evidence1.jpg"
        img2_path = upload_dir / "evidence2.jpg"
        img3_path = upload_dir / "evidence3.jpg"

        # Valid JPEG header
        jpeg_data = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"A" * 100
        img1_path.write_bytes(jpeg_data)
        img2_path.write_bytes(jpeg_data)
        img3_path.write_bytes(jpeg_data)

        id1 = uuid.uuid4()
        id2 = uuid.uuid4()
        id3 = uuid.uuid4()

        ev1 = MagicMock()
        ev1.id = id1
        ev1.file_path = "/media/grn_documents/evidence1.jpg"

        ev2 = MagicMock()
        ev2.id = id2
        ev2.file_path = "/media/grn_documents/evidence2.jpg"

        ev3 = MagicMock()
        ev3.id = id3
        ev3.file_path = "/media/grn_documents/evidence3.jpg"

        line = MagicMock()
        line.item_code = "MAT-001"
        line.damaged_quantity = Decimal("5")
        line.rejected_quantity = Decimal("0")
        line.quality_result = "REJECTED"
        line.damage_lots = []
        line.damage_evidence = [ev1, ev2, ev3]

        grn = MagicMock()
        grn.lines = [line]

        # 1. When photo_ids contains only id2 and id3 (current transaction), id1 (old transaction) is NOT attached
        current_photo_ids = [str(id2), str(id3)]
        attachments = collect_damage_attachments(grn, upload_dir, item_codes=["MAT-001"], photo_ids=current_photo_ids)

        assert len(attachments) == 2
        # Check filenames
        filenames = [att[0] for att in attachments]
        assert "MAT-001_damage_1.jpg" in filenames
        assert "MAT-001_damage_2.jpg" in filenames

        # 2. When photo_ids contains only id3
        attachments_single = collect_damage_attachments(grn, upload_dir, item_codes=["MAT-001"], photo_ids=[str(id3)])
        assert len(attachments_single) == 1
        assert attachments_single[0][0] == "MAT-001_damage_1.jpg"

        # 3. When photo_ids has an unknown/empty id
        attachments_empty = collect_damage_attachments(grn, upload_dir, item_codes=["MAT-001"], photo_ids=[str(uuid.uuid4())])
        assert len(attachments_empty) == 0


def test_procurement_notification_message_formatting():
    grn_number = "GRN-2026-0002"
    po_number = "PO-2026-0002"
    supplier_name = "spoorti"
    supplier_company = "abc"
    warehouse_name = "Main Warehouse"
    items_summary_str = "• MAT-001 (Steel Coil) | Qty: 10 PCS | Reason: Surface scratches"
    custom_remarks = "Damaged during transit, please verify."

    procurement_msg = (
        f"Damaged/rejected goods were identified for GRN {grn_number} against PO {po_number}.\n"
        f"GRN: {grn_number} | PO: {po_number}\n"
        f"Supplier: {supplier_name} ({supplier_company}) | Warehouse: {warehouse_name}\n"
        f"Damaged Items:\n{items_summary_str}"
    )
    if custom_remarks:
        procurement_msg += f"\nInspector Remarks: {custom_remarks}"

    # Verify content
    assert "GRN-2026-0002" in procurement_msg
    assert "PO-2026-0002" in procurement_msg
    assert "Supplier: spoorti (abc)" in procurement_msg
    assert "Surface scratches" in procurement_msg
    assert "Damaged during transit" in procurement_msg

