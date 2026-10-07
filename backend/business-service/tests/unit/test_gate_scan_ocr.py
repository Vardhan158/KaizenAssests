import io
import pytest
from fastapi import UploadFile
from PIL import Image, ImageDraw
from app.database.session import UnitOfWork
from app.modules.gate.infrastructure.api.router import scan_with_local_ocr
from app.security.dependencies import CurrentUser

@pytest.mark.asyncio
async def test_scan_ocr_empty_file_returns_422():
    dummy_user = CurrentUser(subject='test-user-id', username='testuser', roles=['GATE_SECURITY'], permissions=['gate:entry:read'], raw_claims={})
    async with UnitOfWork() as uow:
        upload_file = UploadFile(file=io.BytesIO(b""), filename="empty.jpg")
        with pytest.raises(Exception) as exc_info:
            await scan_with_local_ocr(file=upload_file, kind="po", _user=dummy_user, uow=uow)
        assert "422" in str(exc_info.value) or "empty" in str(exc_info.value).lower()

@pytest.mark.asyncio
async def test_scan_ocr_valid_image_returns_200_payload():
    dummy_user = CurrentUser(subject='test-user-id', username='testuser', roles=['GATE_SECURITY'], permissions=['gate:entry:read'], raw_claims={})
    img = Image.new("RGB", (400, 200), color="white")
    d = ImageDraw.Draw(img)
    d.text((10, 10), "PURCHASE ORDER PO-2026-0001", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)
    
    upload_file = UploadFile(file=buf, filename="po.jpg")
    async with UnitOfWork() as uow:
        res = await scan_with_local_ocr(file=upload_file, kind="po", _user=dummy_user, uow=uow)
        assert isinstance(res, dict)
        assert "extraction" in res
        assert "confidence" in res
        assert "verified" in res
        assert res["source"] == "local-ocr"

@pytest.mark.asyncio
async def test_scan_ocr_vehicle_returns_200_payload():
    dummy_user = CurrentUser(subject='test-user-id', username='testuser', roles=['GATE_SECURITY'], permissions=['gate:entry:read'], raw_claims={})
    img = Image.new("RGB", (200, 100), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    
    upload_file = UploadFile(file=buf, filename="vehicle.png")
    async with UnitOfWork() as uow:
        res = await scan_with_local_ocr(file=upload_file, kind="vehicle", _user=dummy_user, uow=uow)
        assert isinstance(res, dict)
        assert "vehicle_number" in res
        assert "confidence" in res
