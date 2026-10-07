"""Real-time OCR adapter for camera-captured purchase-order documents."""
from __future__ import annotations

import asyncio
import io
import re
import shutil
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from app.modules.gate.domain.value_objects import AnprResult, OcrResult


class OcrUnavailableError(RuntimeError):
    """Raised when the configured OCR engine cannot be used."""


def normalize_vehicle_registration(value: str) -> str:
    """Validate and format common Indian vehicle registration numbers."""
    compact = re.sub(r"[^A-Z0-9]", "", str(value).upper())
    bharat = re.fullmatch(r"(\d{2})BH(\d{4})([A-Z]{2})", compact)
    if bharat:
        year, number, series = bharat.groups()
        return f"{year}-BH-{number}-{series}"
    standard = re.fullmatch(r"([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{4})", compact)
    if standard:
        state, district, series, number = standard.groups()
        return f"{state}-{district.zfill(2)}-{series}-{number}"
    raise ValueError("Vehicle number must match formats such as MH-12-AB-1234 or 22-BH-1234-AA.")


class TesseractOcrService:
    """Runs the local Tesseract binary against the bytes captured by the camera."""

    def __init__(self, command: str = "tesseract") -> None:
        self.command = _resolve_tesseract_command(command)

    async def process_po_document(self, document_data: bytes | str) -> OcrResult:
        if isinstance(document_data, str):
            document_data = document_data.encode()
        if not document_data:
            raise ValueError("The captured document image is empty.")
        raw_text = await _read_image_text(self.command, document_data, page_segmentation_mode="6")
        return self._parse_purchase_order(raw_text)

    @staticmethod
    def _parse_purchase_order(raw_text: str) -> OcrResult:
        normalized = re.sub(r"[ \t]+", " ", raw_text)
        po_match = re.search(r"\b(?:P(?:URCHASE)?\s*O(?:RDER)?\s*(?:NO|NUMBER)?\s*[:#-]?\s*)?(PO[-\s/]?[A-Z0-9][A-Z0-9/-]{2,})\b", normalized, re.I)
        supplier_match = re.search(r"(?:supplier|vendor)\s*[:#-]\s*([^\n\r]{2,80})", raw_text, re.I)
        material_match = re.search(r"(?:material|item|product)\s*[:#-]\s*([^\n\r]{2,80})", raw_text, re.I)
        quantity_match = re.search(r"(?:quantity|qty)\s*[:#-]?\s*(\d+(?:\.\d+)?)", normalized, re.I)

        quantity = None
        if quantity_match:
            try:
                quantity = Decimal(quantity_match.group(1))
            except InvalidOperation:
                pass

        words = [word for word in re.findall(r"[A-Za-z0-9]+", raw_text) if len(word) > 1]
        confidence = min(0.99, 0.35 + len(words) / 120) if words else 0.0
        return OcrResult(
            po_number=po_match.group(1).upper().replace(" ", "") if po_match else None,
            supplier_name=supplier_match.group(1).strip() if supplier_match else None,
            product_material=material_match.group(1).strip() if material_match else None,
            quantity=quantity,
            confidence=round(confidence, 2),
            raw_text=raw_text,
        )


class TesseractAnprService:
    """Reads vehicle plates from a live camera image using the OCR engine."""

    def __init__(self, command: str = "tesseract") -> None:
        self.command = _resolve_tesseract_command(command)

    async def recognize_license_plate(self, image_data: bytes | str) -> AnprResult:
        if isinstance(image_data, str):
            normalized = normalize_vehicle_registration(image_data)
            return AnprResult(detected_vehicle_number=normalized, confidence=1.0, raw_metadata={"source": "manual_entry"})
        if not image_data:
            raise ValueError("The captured vehicle image is empty.")

        images = _prepare_anpr_images(image_data)
        readings = []
        for prepared, psm in ((images[0], "11"), (images[1], "7"), (images[1], "6")):
            try:
                readings.append(await _read_image_text(self.command, prepared, page_segmentation_mode=psm))
            except OcrUnavailableError:
                raise
            except Exception:
                continue

        plate = None
        for raw_text in readings:
            # Try each OCR line first so unrelated text around a plate cannot
            # destroy the token boundaries, then try the complete reading.
            candidates = raw_text.splitlines() + [raw_text]
            for candidate in candidates:
                compact = re.sub(r"[^A-Z0-9]", "", candidate.upper())
                match = re.search(r"(?:\d{2}BH\d{4}[A-Z]{2}|[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4})", compact)
                if match:
                    try:
                        plate = normalize_vehicle_registration(match.group(0))
                        break
                    except ValueError:
                        pass
            if plate:
                break

        if not plate:
            raise ValueError("No vehicle registration number could be read. Reposition the plate and scan again.")

        confidence = min(0.99, 0.65 + len(plate) / 40)
        return AnprResult(detected_vehicle_number=plate, confidence=round(confidence, 2), raw_metadata={"raw_text": "\n".join(readings)})


def _prepare_anpr_images(image_data: bytes) -> tuple[bytes, bytes]:
    """Convert browser formats such as WebP and create a plate-friendly OCR variant."""
    with Image.open(io.BytesIO(image_data)) as source:
        rgb = source.convert("RGB")
        normal_buffer = io.BytesIO()
        rgb.save(normal_buffer, format="PNG")

        grayscale = ImageOps.grayscale(rgb)
        grayscale = ImageOps.autocontrast(grayscale, cutoff=1)
        scale = max(2, min(4, 1600 // max(1, grayscale.width)))
        grayscale = grayscale.resize(
            (grayscale.width * scale, grayscale.height * scale),
            Image.Resampling.LANCZOS,
        )
        grayscale = ImageEnhance.Contrast(grayscale).enhance(1.8)
        grayscale = grayscale.filter(ImageFilter.SHARPEN)
        enhanced_buffer = io.BytesIO()
        grayscale.save(enhanced_buffer, format="PNG")
        return normal_buffer.getvalue(), enhanced_buffer.getvalue()


async def _read_image_text(command: str, image_data: bytes, page_segmentation_mode: str) -> str:
    if not shutil.which(command) and not Path(command).is_file():
        raise OcrUnavailableError(
            "Tesseract OCR is not installed. Run the Docker business-service or install Tesseract and set OCR_TESSERACT_COMMAND."
        )
    process = await asyncio.create_subprocess_exec(
        command,
        "stdin",
        "stdout",
        "--psm",
        page_segmentation_mode,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate(image_data)
    if process.returncode != 0:
        raise OcrUnavailableError(f"Tesseract could not read the image: {stderr.decode(errors='replace').strip()}")
    return stdout.decode("utf-8", errors="replace")


def _resolve_tesseract_command(command: str) -> str:
    discovered = shutil.which(command)
    if discovered:
        return discovered
    if command == "tesseract":
        for candidate in (
            Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
            Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
        ):
            if candidate.is_file():
                return str(candidate)
    return command
