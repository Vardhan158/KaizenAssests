"""
Application Interfaces & Ports for Gate Entry module.
Defines Python Protocols for ANPR, OCR, and Notification ports.
"""
from __future__ import annotations

from typing import Protocol

from app.modules.gate.domain.value_objects import AnprResult, OcrResult


class AnprService(Protocol):
    """
    Interface for ANPR (Automatic Number Plate Recognition).
    Abstracts vehicle license plate recognition technology.
    """

    async def recognize_license_plate(self, image_data: bytes | str) -> AnprResult: ...


class OcrService(Protocol):
    """
    Interface for OCR / Document Processing.
    Abstracts PO document extraction logic.
    """

    async def process_po_document(self, document_data: bytes | str) -> OcrResult: ...


class NotificationGateway(Protocol):
    """
    Interface for notifying Warehouse Manager and Goods Receiving Department.
    """

    async def notify_ready_for_receiving(
        self, gate_entry_id: str, po_number: str, vehicle_number: str, details: dict
    ) -> None: ...
