"""
Deprecated ANPR module.
Replaced with Purchase Order Document OCR Scanning and Document Upload only (ocr_pipeline.py).
"""
from __future__ import annotations

from app.modules.gate.application.ocr_pipeline import EnterprisePoOcrEngine, PreparedDocFrame

__all__ = ["EnterprisePoOcrEngine", "PreparedDocFrame"]

