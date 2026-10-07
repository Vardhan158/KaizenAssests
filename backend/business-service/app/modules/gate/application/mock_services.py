"""
Mock implementations of ANPR and OCR service interfaces.
Used when external ANPR/OCR hardware or ML services are not connected.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
import re
from typing import Any

from app.modules.gate.application.interfaces import AnprService, OcrService
from app.modules.gate.domain.value_objects import AnprResult, OcrResult


class MockAnprService(AnprService):
    def __init__(
        self,
        default_vehicle_number: str = "KA-01-AB-1234",
        default_confidence: float = 0.95,
        test_mappings: dict[str, tuple[str, float]] | None = None,
    ) -> None:
        self.default_vehicle_number = default_vehicle_number
        self.default_confidence = default_confidence
        self.test_mappings = test_mappings or {}

    async def recognize_license_plate(self, image_data: bytes | str) -> AnprResult:
        # If image_data is a filename or string key present in test mappings
        if isinstance(image_data, str) and image_data in self.test_mappings:
            veh, conf = self.test_mappings[image_data]
            return AnprResult(detected_vehicle_number=veh, confidence=conf, raw_metadata={"source": "mock_mapping"})

        if isinstance(image_data, bytes):
            # Check if bytes contain ASCII test string
            try:
                decoded = image_data.decode("utf-8", errors="ignore").strip()
                if decoded in self.test_mappings:
                    veh, conf = self.test_mappings[decoded]
                    return AnprResult(detected_vehicle_number=veh, confidence=conf, raw_metadata={"source": "mock_bytes"})
            except Exception:
                pass

        return AnprResult(
            detected_vehicle_number=self.default_vehicle_number,
            confidence=self.default_confidence,
            raw_metadata={"source": "mock_default"},
        )


class MockOcrService(OcrService):
    def __init__(
        self,
        test_po_data: dict[str, OcrResult] | None = None,
    ) -> None:
        self.test_po_data = test_po_data or {}

    async def process_po_document(self, document_data: bytes | str) -> OcrResult:
        key = document_data if isinstance(document_data, str) else ""
        if isinstance(document_data, bytes):
            try:
                key = document_data.decode("utf-8", errors="ignore").strip()
            except Exception:
                pass

        if key in self.test_po_data:
            return self.test_po_data[key]

        # Attempt to parse PO text if raw text was passed
        if key:
            po_match = re.search(r"PO-\d+", key, re.IGNORECASE)
            po_num = po_match.group(0).upper() if po_match else "PO-1001"
            return OcrResult(
                po_number=po_num,
                supplier_name="Acme Corp",
                material_description="ITEM-A",
                total_quantity=100.0,
                po_date="2026-08-01",
                delivery_date="2026-08-15",
                confidence=0.98,
            )

        # Default fallback mock result
        return OcrResult(
            po_number="PO-1001",
            supplier_name="Acme Corp",
            material_description="ITEM-A",
            total_quantity=100.0,
            po_date="2026-08-01",
            delivery_date="2026-08-15",
            confidence=0.95,
        )
