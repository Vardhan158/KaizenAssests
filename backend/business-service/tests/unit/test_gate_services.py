"""
Unit tests for Gate Entry application & infrastructure services.
"""
from decimal import Decimal
import os
import pytest

from app.modules.gate.application.exceptions import InvalidFileException
from app.modules.gate.application.mock_services import MockAnprService, MockOcrService
from app.modules.gate.infrastructure.services.file_storage import FileStorageService


@pytest.mark.asyncio
async def test_mock_anpr_service():
    anpr = MockAnprService(default_vehicle_number="KA-05-MH-9999", default_confidence=0.92)
    res = await anpr.recognize_license_plate(b"sample_image_bytes")

    assert res.detected_vehicle_number == "KA-05-MH-9999"
    assert res.confidence == 0.92
    assert res.is_high_confidence(0.85) is True


@pytest.mark.asyncio
async def test_mock_ocr_service():
    ocr = MockOcrService()
    res = await ocr.process_po_document("PO-1001 document content")

    assert res.po_number == "PO-1001"
    assert res.supplier_name == "Acme Corp"
    assert res.total_quantity == 100.0


def test_file_storage_validation(tmp_path):
    storage = FileStorageService(storage_dir=str(tmp_path))

    # Valid JPEG image
    storage.validate_file(b"fake_jpeg_content", "photo.jpg", "image/jpeg")

    # Empty file error
    with pytest.raises(InvalidFileException, match="empty"):
        storage.validate_file(b"", "empty.jpg", "image/jpeg")

    # Oversized file error (>10MB)
    large_bytes = b"x" * (11 * 1024 * 1024)
    with pytest.raises(InvalidFileException, match="exceeds maximum allowed size"):
        storage.validate_file(large_bytes, "huge.jpg", "image/jpeg")

    # Invalid MIME type / extension
    with pytest.raises(InvalidFileException, match="Unsupported file type"):
        storage.validate_file(b"script", "hack.exe", "application/x-msdownload")
