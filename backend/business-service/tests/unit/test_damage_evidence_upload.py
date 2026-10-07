import uuid
from decimal import Decimal
import pytest
from app.modules.receiving.infrastructure.api.schemas import DamageEvidenceResponse
from app.modules.receiving.infrastructure.persistence.models import GrnDamageEvidenceModel
from datetime import datetime, timezone

def test_damage_evidence_regex_and_schema():
    import re
    item_code = "MAT-100/A#Test!"
    mat_code = re.sub(r"[^A-Za-z0-9_-]", "_", item_code or "material")[:50]
    assert mat_code == "MAT-100_A_Test_"

    unique_suffix = uuid.uuid4().hex[:8]
    saved_filename = f"{mat_code}_{unique_suffix}.jpg"
    assert saved_filename.startswith("MAT-100_A_Test_")
    assert saved_filename.endswith(".jpg")

def test_damage_evidence_response_serialization():
    evidence_id = uuid.uuid4()
    grn_line_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    resp = DamageEvidenceResponse(
        evidence_id=str(evidence_id),
        grn_line_id=str(grn_line_id),
        damaged_quantity=Decimal("5.5000"),
        reason="Broken package",
        remarks="Damaged during transit",
        file_name="test.jpg",
        file_path="/media/damage_evidence/grn/line/test.jpg",
        uploaded_by="test_user",
        uploaded_at=now,
    )

    dumped = resp.model_dump()
    assert dumped["evidence_id"] == str(evidence_id)
    assert dumped["grn_line_id"] == str(grn_line_id)
    assert dumped["damaged_quantity"] == Decimal("5.5000")
    assert dumped["reason"] == "Broken package"
    assert dumped["remarks"] == "Damaged during transit"
    assert dumped["file_path"] == "/media/damage_evidence/grn/line/test.jpg"
