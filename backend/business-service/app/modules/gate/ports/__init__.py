"""
Abstract ports/interfaces for PO OCR engine, PO repository, and Gate Entry persistence.
"""
from __future__ import annotations

from typing import List, Optional, Protocol

from app.modules.gate.domain.aggregate import GateEntry
from app.modules.gate.domain.value_objects import (
    OcrResult,
    PurchaseOrderRecord,
)


class OcrEnginePort(Protocol):
    def process_po_document(self, image_bytes: bytes) -> OcrResult:
        """Process raw PO document image bytes and return OCR result."""
        ...


class PoRepositoryPort(Protocol):
    def find_po_by_number(self, po_number: str) -> Optional[PurchaseOrderRecord]:
        """Fetch canonical purchase order record by PO number."""
        ...


class GateEntryRepositoryPort(Protocol):
    def save(self, gate_entry: GateEntry) -> GateEntry:
        """Persist or update gate entry aggregate root."""
        ...

    def find_by_id(self, entry_id: str) -> Optional[GateEntry]:
        """Fetch gate entry aggregate root by ID."""
        ...

    def find_active_by_po_or_plate(
        self, po_number: Optional[str], vehicle_plate: Optional[str]
    ) -> List[GateEntry]:
        """Fetch active/open gate entry attempts matching PO number or vehicle plate."""
        ...
