"""
Gemini Vision Service for Real ANPR (Number Plate) and PO Document OCR Extraction.
Securely processes camera frame / document base64 payloads on the backend using Gemini 1.5/2.5 Flash Vision.
API Key is strictly read from backend Settings / environment variables (GEMINI_API_KEY).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
from typing import Any, Dict, Optional

import httpx

from app.config.settings import get_settings

logger = logging.getLogger("ams.gate.gemini_vision")

# Fallback model endpoints.  The configured model is always attempted first.
GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-1.5-flash",
]

ANPR_PROMPT = """
You are an expert ANPR (Automatic Number Plate Recognition) system for warehouse logistics.
Carefully examine this camera image to identify and extract any visible vehicle registration/license plate number.

Instructions:
1. Locate the vehicle registration plate (number plate).
2. Extract all alphanumeric characters accurately (e.g. MH04AB1234, DL01A1234, KA05MN5678, HR26DQ5551, 22BH1234AA, etc.).
3. Standardize by removing spaces, dots, hyphens and keeping clean uppercase text.
4. Provide a confidence score between 0.0 and 1.0 based on clarity and readability.
5. If NO valid vehicle license plate is clearly visible or readable in the image, set detected=false and vehicleNumber=null. Do not guess or hallucinate.

Respond ONLY with valid JSON matching this schema:
{
  "vehicleNumber": "string or null",
  "confidence": 0.98,
  "detected": true
}
"""

PO_OCR_PROMPT = """
You are an expert Document OCR system for warehouse inbound freight, invoices, and purchase orders.
Carefully read the text and tabular data in this PO/Invoice/Delivery document image.

Instructions:
1. Extract the Purchase Order / Invoice / Order reference number (e.g. PO-2026-00128, PO-1001, INV-8921).
2. Extract the Vendor/Supplier/Shipper company name (e.g. ABC Logistics, Acme Industrial Supplies).
3. Extract the Order/Invoice Date as poDate in YYYY-MM-DD format; use null if the date is unclear.
4. Extract the Expected Delivery/Shipping Date as deliveryDate in YYYY-MM-DD format; use null if unclear.
5. Extract the Primary Material / Item Description (e.g. Electronics & Components, Steel Bearings 50mm).
6. Extract the Total Quantity / Ordered units as a number (e.g. 500, 1200).
7. Provide a confidence score between 0.0 and 1.0.
8. If the image is not a readable PO/invoice document or no PO details can be found, set detected=false and poNumber=null.

Respond ONLY with valid JSON matching this schema:
{
  "poNumber": "string or null",
  "supplier": "string or null",
  "poDate": "string or null",
  "deliveryDate": "string or null",
  "material": "string or null",
  "quantity": 500,
  "confidence": 0.96,
  "detected": true
}
"""


class GeminiVisionService:
    def __init__(self, api_key: Optional[str] = None) -> None:
        self.settings = get_settings()
        self.api_key = api_key or self.settings.gemini_api_key or os.getenv("GEMINI_API_KEY", "")

    def _get_api_key(self) -> str:
        return self.api_key or self.settings.gemini_api_key or os.getenv("GEMINI_API_KEY", "")

    def _clean_base64(self, b64_str: str) -> tuple[str, str]:
        """Strip data URI header if present and detect mime type."""
        mime_type = "image/jpeg"
        if not b64_str:
            return "", mime_type

        if "," in b64_str:
            header, b64_str = b64_str.split(",", 1)
            if "image/png" in header:
                mime_type = "image/png"
            elif "image/webp" in header:
                mime_type = "image/webp"
            elif "application/pdf" in header:
                mime_type = "application/pdf"

        # Remove any whitespace/newlines
        b64_str = re.sub(r"\s+", "", b64_str)
        return b64_str, mime_type

    async def _call_gemini(self, prompt: str, image_base64: str) -> Optional[Dict[str, Any]]:
        api_key = self._get_api_key()
        if not api_key:
            logger.warning("GEMINI_API_KEY not configured. Skipping Gemini Vision call.")
            return None

        clean_b64, mime_type = self._clean_base64(image_base64)
        if not clean_b64 or len(clean_b64) < 20:
            logger.warning("Invalid or empty image base64 provided to Gemini Vision.")
            return None

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": mime_type,
                                "data": clean_b64,
                            }
                        },
                    ]
                }
            ],
            "generationConfig": {
                "response_mime_type": "application/json",
                "temperature": 0.1,
            },
        }

        configured_model = self.settings.gemini_model.strip()
        model_candidates = list(dict.fromkeys([configured_model, *GEMINI_MODELS]))

        async with httpx.AsyncClient(timeout=25.0) as client:
            for model_name in model_candidates:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
                try:
                    response = await client.post(url, json=payload)
                    if response.status_code == 200:
                        data = response.json()
                        candidates = data.get("candidates", [])
                        if candidates:
                            content = candidates[0].get("content", {})
                            parts = content.get("parts", [])
                            if parts:
                                text_response = parts[0].get("text", "")
                                try:
                                    parsed = json.loads(text_response)
                                    if isinstance(parsed, dict):
                                        return parsed
                                except json.JSONDecodeError:
                                    # Attempt regex JSON extraction
                                    match = re.search(r"\{.*\}", text_response, re.DOTALL)
                                    if match:
                                        return json.loads(match.group(0))
                    else:
                        logger.warning(
                            f"Gemini API returned HTTP {response.status_code} on model {model_name}: {response.text[:200]}"
                        )
                except Exception as ex:
                    logger.error(f"Gemini API call failed on {model_name}: {str(ex)}")

        return None

    async def extract_anpr(self, image_base64: str) -> Dict[str, Any]:
        """
        Extract vehicle registration / license plate number from camera frame image.
        Returns:
          {
            "vehicleNumber": "MH04AB1234" | null,
            "confidence": float (0.0-1.0),
            "detected": bool
          }
        """
        result = await self._call_gemini(ANPR_PROMPT, image_base64)
        if result and isinstance(result, dict):
            veh_num = result.get("vehicleNumber")
            detected = bool(result.get("detected", False))
            conf = float(result.get("confidence", 0.0))

            if veh_num:
                # Clean vehicle number
                veh_clean = re.sub(r"[^A-Z0-9]", "", str(veh_num).upper())
                if veh_clean:
                    return {
                        "vehicleNumber": veh_clean,
                        "confidence": max(0.0, min(conf, 1.0)),
                        "detected": True,
                    }

            return {
                "vehicleNumber": None,
                "confidence": conf,
                "detected": detected and bool(veh_num),
            }

        return {
            "vehicleNumber": None,
            "confidence": 0.0,
            "detected": False,
        }

    async def extract_po_ocr(self, image_base64: str) -> Dict[str, Any]:
        """
        Extract Purchase Order & document line items from invoice / PO image.
        Returns:
          {
            "poNumber": "PO-2026-00128" | null,
            "supplier": "ABC Logistics" | null,
            "poDate": "2026-08-10" | null,
            "deliveryDate": "2026-08-12" | null,
            "material": "Electronics" | null,
            "quantity": 500 | null,
            "confidence": 1.0,
            "detected": bool
          }
        """
        result = await self._call_gemini(PO_OCR_PROMPT, image_base64)
        if result and isinstance(result, dict):
            po_num = result.get("poNumber")
            detected = bool(result.get("detected", False))
            conf = float(result.get("confidence", 0.0))

            if po_num and str(po_num).strip():
                clean_po = str(po_num).strip().upper()
                return {
                    "poNumber": clean_po,
                    # Never invent missing PO fields.  The gate operator can
                    # supply an absent value, while verification still uses
                    # the authoritative PO record.
                    "supplier": result.get("supplier"),
                    "poDate": result.get("poDate"),
                    "deliveryDate": result.get("deliveryDate"),
                    "material": result.get("material"),
                    "quantity": result.get("quantity"),
                    "confidence": max(0.0, min(conf, 1.0)),
                    "detected": True,
                }

            return {
                "poNumber": None,
                "supplier": None,
                "poDate": None,
                "deliveryDate": None,
                "material": None,
                "quantity": None,
                "confidence": conf,
                "detected": detected and bool(po_num),
            }

        return {
            "poNumber": None,
            "supplier": None,
            "poDate": None,
            "deliveryDate": None,
            "material": None,
            "quantity": None,
            "confidence": 0.0,
            "detected": False,
        }
