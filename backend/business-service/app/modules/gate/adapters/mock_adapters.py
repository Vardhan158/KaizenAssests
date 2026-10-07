"""
Mock adapters for OCR engine, PO repository, and In-Memory Gate Entry persistence.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from app.modules.gate.adapters.mock_po_repository import MOCK_PO_DATABASE, MockPoRepository
from app.modules.gate.domain.aggregate import GateEntry
from app.modules.gate.domain.value_objects import (
    OcrResult,
    PurchaseOrderRecord,
)
from app.modules.gate.ports import (
    GateEntryRepositoryPort,
    OcrEnginePort,
    PoRepositoryPort,
)


class MockOcrEngine(OcrEnginePort):
    def __init__(
        self,
        po_number: Optional[str] = "PO-1001",
        supplier_name: Optional[str] = "Rolls-Royce Power Systems",
        material_description: Optional[str] = "Transformer Cores",
        total_quantity: Optional[float] = 12.0,
        po_date: Optional[str] = "2026-08-01",
        delivery_date: Optional[str] = "2026-08-15",
        confidence: float = 1.0,
    ) -> None:
        self.po_number = po_number
        self.supplier_name = supplier_name
        self.material_description = material_description
        self.total_quantity = total_quantity
        self.po_date = po_date
        self.delivery_date = delivery_date
        self.confidence = confidence

    def process_po_document(self, image_bytes: bytes) -> OcrResult:
        return OcrResult(
            po_number=self.po_number,
            supplier_name=self.supplier_name,
            material_description=self.material_description,
            total_quantity=self.total_quantity,
            po_date=self.po_date,
            delivery_date=self.delivery_date,
            confidence=self.confidence,
        )


class InMemoryGateEntryRepository(GateEntryRepositoryPort):
    def __init__(self) -> None:
        self._entries: Dict[str, GateEntry] = {}

    def save(self, gate_entry: GateEntry) -> GateEntry:
        self._entries[gate_entry.id] = gate_entry
        return gate_entry

    def find_by_id(self, entry_id: str) -> Optional[GateEntry]:
        return self._entries.get(entry_id)

    def find_active_by_po_or_plate(
        self, po_number: Optional[str], vehicle_plate: Optional[str]
    ) -> List[GateEntry]:
        results: List[GateEntry] = []
        for entry in self._entries.values():
            match_plate = (
                vehicle_plate
                and entry.vehicle_plate
                and entry.vehicle_plate.upper() == vehicle_plate.upper()
            )
            match_po = (
                po_number
                and entry.po_number
                and entry.po_number.upper() == po_number.upper()
            )
            if match_plate or match_po:
                results.append(entry)
        return results

    def list_all(self) -> List[GateEntry]:
        return list(self._entries.values())

    def clear(self) -> None:
        self._entries.clear()

