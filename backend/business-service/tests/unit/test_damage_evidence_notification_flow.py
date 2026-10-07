import os
import uuid
import pytest
from decimal import Decimal
from pathlib import Path
from dataclasses import dataclass, field
from app.common.damage_email_attachments import collect_damage_attachments


@dataclass
class MockEvidence:
    id: uuid.UUID
    file_name: str
    file_path: str
    damaged_quantity: Decimal = Decimal("10.0")
    reason: str = "Damaged during receiving inspection"
    remarks: str | None = None
    uploaded_by: str = "Inspector"


@dataclass
class MockLine:
    id: uuid.UUID
    item_code: str
    material_name: str
    damaged_quantity: Decimal = Decimal("10.0")
    rejected_quantity: Decimal = Decimal("0.0")
    quality_result: str = "REJECTED"
    uom: str = "PCS"
    damage_lots: list = field(default_factory=list)
    damage_evidence: list[MockEvidence] = field(default_factory=list)


@dataclass
class MockGrn:
    id: uuid.UUID
    grn_number: str
    po_number: str = "PO-2026-0004"
    supplier_name: str = "spoorti"
    supplier_company_name: str = "abc"
    warehouse_name: str = "Main Warehouse"
    lines: list[MockLine] = field(default_factory=list)


def _create_jpeg_bytes() -> bytes:
    # Valid minimal JPEG magic bytes
    return b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xff\xdb\x00C\x00" + b"\x00" * 100


def test_case_1_no_photos(tmp_path):
    """TEST 1 — NO PHOTOS: GRN with damage but 0 uploaded photos."""
    grn_id = uuid.uuid4()
    line_id = uuid.uuid4()
    line = MockLine(id=line_id, item_code="MAT-1001", material_name="PVC Pipes", damage_evidence=[])
    grn = MockGrn(id=grn_id, grn_number="GRN-20260901-0028", lines=[line])

    attachments = collect_damage_attachments(grn, upload_dir=str(tmp_path))
    assert len(attachments) == 0


def test_case_2_one_current_photo(tmp_path):
    """TEST 2 — ONE CURRENT PHOTO: GRN with 1 damage photo uploaded."""
    grn_id = uuid.uuid4()
    line_id = uuid.uuid4()
    photo_id = uuid.uuid4()

    ev_dir = tmp_path / "damage_evidence" / str(grn_id) / str(line_id)
    ev_dir.mkdir(parents=True, exist_ok=True)
    photo_file = ev_dir / "MAT_1001_photo1.jpg"
    photo_file.write_bytes(_create_jpeg_bytes())

    ev = MockEvidence(
        id=photo_id,
        file_name="MAT_1001_photo1.jpg",
        file_path=f"/media/damage_evidence/{grn_id}/{line_id}/MAT_1001_photo1.jpg",
    )
    line = MockLine(id=line_id, item_code="MAT-1001", material_name="PVC Pipes", damage_evidence=[ev])
    grn = MockGrn(id=grn_id, grn_number="GRN-20260901-0028", lines=[line])

    # With photo_ids filter
    attachments = collect_damage_attachments(grn, upload_dir=str(tmp_path), photo_ids=[str(photo_id)])
    assert len(attachments) == 1
    assert attachments[0][0].startswith("MAT-1001_damage_1")
    assert attachments[0][2] == "image/jpeg"

    # Without photo_ids filter (auto-collects all belonging to current GRN)
    attachments_all = collect_damage_attachments(grn, upload_dir=str(tmp_path))
    assert len(attachments_all) == 1


def test_case_3_multiple_current_photos(tmp_path):
    """TEST 3 — MULTIPLE CURRENT PHOTOS: GRN with 3 damage photos for MAT-1001."""
    grn_id = uuid.uuid4()
    line_id = uuid.uuid4()

    ev_dir = tmp_path / "damage_evidence" / str(grn_id) / str(line_id)
    ev_dir.mkdir(parents=True, exist_ok=True)

    ev_list = []
    photo_ids = []
    for i in range(1, 4):
        p_id = uuid.uuid4()
        photo_ids.append(str(p_id))
        p_file = ev_dir / f"MAT_1001_photo_{i}.jpg"
        p_file.write_bytes(_create_jpeg_bytes())
        ev_list.append(
            MockEvidence(
                id=p_id,
                file_name=f"MAT_1001_photo_{i}.jpg",
                file_path=f"/media/damage_evidence/{grn_id}/{line_id}/MAT_1001_photo_{i}.jpg",
            )
        )

    line = MockLine(id=line_id, item_code="MAT-1001", material_name="PVC Pipes", damage_evidence=ev_list)
    grn = MockGrn(id=grn_id, grn_number="GRN-20260901-0028", lines=[line])

    attachments = collect_damage_attachments(grn, upload_dir=str(tmp_path), photo_ids=photo_ids)
    assert len(attachments) == 3


def test_case_4_same_material_different_grn_isolation(tmp_path):
    """TEST 4 — SAME MATERIAL, DIFFERENT GRN: GRN A has 3 photos, GRN B has 2 photos."""
    grn_a_id = uuid.uuid4()
    line_a_id = uuid.uuid4()
    grn_b_id = uuid.uuid4()
    line_b_id = uuid.uuid4()

    # Create GRN A photos on disk
    dir_a = tmp_path / "damage_evidence" / str(grn_a_id) / str(line_a_id)
    dir_a.mkdir(parents=True, exist_ok=True)
    ev_a = []
    for i in range(3):
        p_id = uuid.uuid4()
        (dir_a / f"photo_a_{i}.jpg").write_bytes(_create_jpeg_bytes())
        ev_a.append(MockEvidence(id=p_id, file_name=f"photo_a_{i}.jpg", file_path=f"/media/damage_evidence/{grn_a_id}/{line_a_id}/photo_a_{i}.jpg"))

    # Create GRN B photos on disk
    dir_b = tmp_path / "damage_evidence" / str(grn_b_id) / str(line_b_id)
    dir_b.mkdir(parents=True, exist_ok=True)
    ev_b = []
    for i in range(2):
        p_id = uuid.uuid4()
        (dir_b / f"photo_b_{i}.jpg").write_bytes(_create_jpeg_bytes())
        ev_b.append(MockEvidence(id=p_id, file_name=f"photo_b_{i}.jpg", file_path=f"/media/damage_evidence/{grn_b_id}/{line_b_id}/photo_b_{i}.jpg"))

    grn_a = MockGrn(id=grn_a_id, grn_number="GRN-20260901-0028", lines=[MockLine(id=line_a_id, item_code="MAT-1001", material_name="PVC Pipes", damage_evidence=ev_a)])
    grn_b = MockGrn(id=grn_b_id, grn_number="GRN-20260901-0029", lines=[MockLine(id=line_b_id, item_code="MAT-1001", material_name="PVC Pipes", damage_evidence=ev_b)])

    # Querying GRN B must return exactly 2 photos, 0 from GRN A
    attachments_b = collect_damage_attachments(grn_b, upload_dir=str(tmp_path))
    assert len(attachments_b) == 2

    # Querying GRN A must return exactly 3 photos
    attachments_a = collect_damage_attachments(grn_a, upload_dir=str(tmp_path))
    assert len(attachments_a) == 3


def test_case_5_same_supplier_different_grn_isolation(tmp_path):
    """TEST 5 — SAME SUPPLIER, DIFFERENT GRN: Supplier spoorti has GRN A (2 photos), GRN B (1 photo)."""
    grn_a_id = uuid.uuid4()
    line_a_id = uuid.uuid4()
    grn_b_id = uuid.uuid4()
    line_b_id = uuid.uuid4()

    dir_a = tmp_path / "damage_evidence" / str(grn_a_id) / str(line_a_id)
    dir_a.mkdir(parents=True, exist_ok=True)
    (dir_a / "p1.jpg").write_bytes(_create_jpeg_bytes())
    (dir_a / "p2.jpg").write_bytes(_create_jpeg_bytes())
    ev_a = [
        MockEvidence(id=uuid.uuid4(), file_name="p1.jpg", file_path=f"/media/damage_evidence/{grn_a_id}/{line_a_id}/p1.jpg"),
        MockEvidence(id=uuid.uuid4(), file_name="p2.jpg", file_path=f"/media/damage_evidence/{grn_a_id}/{line_a_id}/p2.jpg"),
    ]

    dir_b = tmp_path / "damage_evidence" / str(grn_b_id) / str(line_b_id)
    dir_b.mkdir(parents=True, exist_ok=True)
    (dir_b / "pb1.jpg").write_bytes(_create_jpeg_bytes())
    ev_b = [
        MockEvidence(id=uuid.uuid4(), file_name="pb1.jpg", file_path=f"/media/damage_evidence/{grn_b_id}/{line_b_id}/pb1.jpg"),
    ]

    grn_a = MockGrn(id=grn_a_id, grn_number="GRN-A", supplier_name="spoorti", lines=[MockLine(id=line_a_id, item_code="MAT-1001", material_name="PVC", damage_evidence=ev_a)])
    grn_b = MockGrn(id=grn_b_id, grn_number="GRN-B", supplier_name="spoorti", lines=[MockLine(id=line_b_id, item_code="MAT-1001", material_name="PVC", damage_evidence=ev_b)])

    # GRN B dispatch must strictly have 1 attachment
    attachments_b = collect_damage_attachments(grn_b, upload_dir=str(tmp_path))
    assert len(attachments_b) == 1


def test_case_6_multiple_material_lines_isolation(tmp_path):
    """TEST 6 — MULTIPLE MATERIAL LINES: GRN with MAT-1001 (2 photos), MAT-1002 (1 photo)."""
    grn_id = uuid.uuid4()
    line1_id = uuid.uuid4()
    line2_id = uuid.uuid4()

    dir1 = tmp_path / "damage_evidence" / str(grn_id) / str(line1_id)
    dir1.mkdir(parents=True, exist_ok=True)
    (dir1 / "mat1_p1.jpg").write_bytes(_create_jpeg_bytes())
    (dir1 / "mat1_p2.jpg").write_bytes(_create_jpeg_bytes())
    ev1 = [
        MockEvidence(id=uuid.uuid4(), file_name="mat1_p1.jpg", file_path=f"/media/damage_evidence/{grn_id}/{line1_id}/mat1_p1.jpg"),
        MockEvidence(id=uuid.uuid4(), file_name="mat1_p2.jpg", file_path=f"/media/damage_evidence/{grn_id}/{line1_id}/mat1_p2.jpg"),
    ]

    dir2 = tmp_path / "damage_evidence" / str(grn_id) / str(line2_id)
    dir2.mkdir(parents=True, exist_ok=True)
    (dir2 / "mat2_p1.jpg").write_bytes(_create_jpeg_bytes())
    ev2 = [
        MockEvidence(id=uuid.uuid4(), file_name="mat2_p1.jpg", file_path=f"/media/damage_evidence/{grn_id}/{line2_id}/mat2_p1.jpg"),
    ]

    line1 = MockLine(id=line1_id, item_code="MAT-1001", material_name="PVC Pipes", damage_evidence=ev1)
    line2 = MockLine(id=line2_id, item_code="MAT-1002", material_name="PVC Fittings", damage_evidence=ev2)
    grn = MockGrn(id=grn_id, grn_number="GRN-20260901-0028", lines=[line1, line2])

    # All attachments for GRN
    all_attachments = collect_damage_attachments(grn, upload_dir=str(tmp_path))
    assert len(all_attachments) == 3

    # Filtered by MAT-1001
    mat1_attachments = collect_damage_attachments(grn, upload_dir=str(tmp_path), item_codes=["MAT-1001"])
    assert len(mat1_attachments) == 2
    assert all("MAT-1001" in a[0] for a in mat1_attachments)

    # Filtered by MAT-1002
    mat2_attachments = collect_damage_attachments(grn, upload_dir=str(tmp_path), item_codes=["MAT-1002"])
    assert len(mat2_attachments) == 1
    assert "MAT-1002" in mat2_attachments[0][0]
