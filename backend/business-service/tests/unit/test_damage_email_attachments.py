"""Unit tests for GRN damaged goods email attachment isolation and collection logic."""

import os
from pathlib import Path
import tempfile
import uuid
from decimal import Decimal
import pytest

from app.common.damage_email_attachments import collect_damage_attachments


class FakeEvidence:
    def __init__(self, id, file_name, file_path, damaged_quantity=Decimal("5")):
        self.id = id
        self.file_name = file_name
        self.file_path = file_path
        self.damaged_quantity = damaged_quantity
        self.reason = "Dented container"


class FakeLine:
    def __init__(self, id, item_code, damaged_quantity, damage_evidence=None):
        self.id = id
        self.item_code = item_code
        self.damaged_quantity = Decimal(str(damaged_quantity))
        self.rejected_quantity = Decimal("0")
        self.quality_result = "REJECTED" if damaged_quantity > 0 else "ACCEPTED"
        self.damage_lots = []
        self.damage_evidence = damage_evidence or []


class FakeGrn:
    def __init__(self, id, grn_number, lines):
        self.id = id
        self.grn_number = grn_number
        self.lines = lines


def test_collect_damage_attachments_isolation():
    # Setup test media folder
    media_root = Path(os.getcwd(), "media_uploads")
    media_root.mkdir(parents=True, exist_ok=True)

    grn1_id = uuid.uuid4()
    grn2_id = uuid.uuid4()

    line1_id = uuid.uuid4()
    line2_id = uuid.uuid4()
    old_line_id = uuid.uuid4()

    # Create dummy JPEG files
    jpeg_header = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00" + b"\x00" * 100

    # GRN1 Line1 photos (2 photos)
    dir_line1 = media_root / "damage_evidence" / str(grn1_id) / str(line1_id)
    dir_line1.mkdir(parents=True, exist_ok=True)
    p1 = dir_line1 / "MAT_003_photo1.jpg"
    p2 = dir_line1 / "MAT_003_photo2.jpg"
    p1.write_bytes(jpeg_header)
    p2.write_bytes(jpeg_header)

    # GRN2 (Old GRN) photos (should NEVER be attached to GRN1)
    dir_old = media_root / "damage_evidence" / str(grn2_id) / str(old_line_id)
    dir_old.mkdir(parents=True, exist_ok=True)
    p_old = dir_old / "MAT_003_old_photo.jpg"
    p_old.write_bytes(jpeg_header)

    # GRN1 Line2 (another undamaged material)
    ev1 = FakeEvidence(uuid.uuid4(), "MAT_003_photo1.jpg", f"/media/damage_evidence/{grn1_id}/{line1_id}/MAT_003_photo1.jpg")
    ev2 = FakeEvidence(uuid.uuid4(), "MAT_003_photo2.jpg", f"/media/damage_evidence/{grn1_id}/{line1_id}/MAT_003_photo2.jpg")

    line1 = FakeLine(line1_id, "MAT-003", 5, [ev1, ev2])
    line2 = FakeLine(line2_id, "MAT-004", 0, [])

    grn1 = FakeGrn(grn1_id, "GRN-20260901-0012", [line1, line2])

    # 1. Collect attachments for GRN1
    attachments = collect_damage_attachments(grn1, str(media_root))

    assert len(attachments) == 2
    assert attachments[0][0].startswith("MAT-003_damage_1")
    assert attachments[1][0].startswith("MAT-003_damage_2")
    assert attachments[0][2] == "image/jpeg"
    assert attachments[1][2] == "image/jpeg"

    # Verify old photo from GRN2 is NOT attached
    assert not any("old_photo" in a[0] for a in attachments)

    # 2. Test filtering by item_codes
    attachments_filtered = collect_damage_attachments(grn1, str(media_root), item_codes={"MAT-004"})
    assert len(attachments_filtered) == 0

    attachments_mat3 = collect_damage_attachments(grn1, str(media_root), item_codes={"MAT-003"})
    assert len(attachments_mat3) == 2

    # Clean up test files
    try:
        p1.unlink(missing_ok=True)
        p2.unlink(missing_ok=True)
        p_old.unlink(missing_ok=True)
    except Exception:
        pass
