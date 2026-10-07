"""
Unit tests for Material-Wise QR Code generation logic.
"""
import uuid
from decimal import Decimal
import pytest
from app.modules.receiving.infrastructure.persistence.models import (
    GrnLineModel,
    GrnBatchModel,
    GrnBatchQrModel,
)


def test_material_qr_payload_contains_only_material_info():
    line = GrnLineModel(
        id=uuid.uuid4(),
        grn_id=uuid.uuid4(),
        item_code="MAT-STEEL-01",
        material_name="Steel Rod 12mm",
        material_category="Raw Materials",
        uom="KG",
    )

    qr_payload = (
        f"📦 WMS MATERIAL QR\n"
        f"----------------------------------------\n"
        f"• Material Code : {line.item_code}\n"
        f"• Material Name : {line.material_name or line.item_code}\n"
        f"• Category      : {line.material_category or 'Raw Materials'}\n"
        f"• UOM           : {line.uom or 'PCS'}\n"
        f"----------------------------------------"
    )

    assert "MAT-STEEL-01" in qr_payload
    assert "Steel Rod 12mm" in qr_payload
    assert "Raw Materials" in qr_payload
    assert "KG" in qr_payload
    # Ensure NO batch or PO or receipt info is present
    assert "BATCH" not in qr_payload
    assert "PO-" not in qr_payload
    assert "GRN-" not in qr_payload


def test_material_qr_model_initialization():
    qr = GrnBatchQrModel(
        id=uuid.uuid4(),
        item_code="MAT-ALU-02",
        qr_code="QR-MAT-MAT-ALU-02",
        qr_payload="Material info payload",
        generated_by="Tester",
    )

    assert qr.item_code == "MAT-ALU-02"
    assert qr.qr_code == "QR-MAT-MAT-ALU-02"
    assert qr.batch_id is None
