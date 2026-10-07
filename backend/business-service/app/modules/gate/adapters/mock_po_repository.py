"""
Mock In-Memory Purchase Order Repository.
Provides sample PO database records for offline testing and 6-field automated cross-matching.
"""
from __future__ import annotations

from typing import Dict, List, Optional
from app.modules.gate.domain.value_objects import PurchaseOrderRecord
from app.modules.gate.ports import PoRepositoryPort


def _normalise_po_number(value: str) -> str:
    """Make common OCR variants (PO-1003, PO 1003, P0-1003) comparable."""
    compact = "".join(char for char in value.upper() if char.isalnum())
    return f"PO{compact[2:]}" if compact.startswith("P0") else compact

# Raw sample mock database dictionary
MOCK_PO_DATABASE: Dict[str, Dict[str, str | float]] = {
    "PO-1001": {
        "poNumber": "PO-1001",
        "supplierName": "Rolls-Royce Power Systems",
        "materialDescription": "Transformer Cores",
        "totalQuantity": 12.0,
        "poDate": "2026-08-01",
        "deliveryDate": "2026-08-15",
        "status": "OPEN",
    },
    "PO-1002": {
        "poNumber": "PO-1002",
        "supplierName": "Bosch Logistics India",
        "materialDescription": "Braking Modules",
        "totalQuantity": 50.0,
        "poDate": "2026-08-05",
        "deliveryDate": "2026-08-20",
        "status": "OPEN",
    },
    "PO-1003": {
        "poNumber": "PO-1003",
        "supplierName": "Tata Auto Components Ltd.",
        "materialDescription": "Engine Mounting Brackets",
        "totalQuantity": 250.0,
        "poDate": "2026-08-10",
        "deliveryDate": "2026-08-25",
        "status": "OPEN",
    },

}



class MockPoRepository(PoRepositoryPort):
    def __init__(self) -> None:
        self._records: Dict[str, PurchaseOrderRecord] = {}
        for key, item in MOCK_PO_DATABASE.items():
            self._records[key] = PurchaseOrderRecord(
                po_number=str(item["poNumber"]),
                supplier_name=str(item["supplierName"]),
                material_description=str(item["materialDescription"]),
                total_quantity=float(item["totalQuantity"]),
                po_date=str(item["poDate"]),
                delivery_date=str(item["deliveryDate"]),
                status=str(item["status"]),
            )

    def add_po(self, po: PurchaseOrderRecord) -> None:
        self._records[po.po_number.upper()] = po

    def find_po_by_number(self, po_number: str) -> Optional[PurchaseOrderRecord]:
        if not po_number:
            return None
        clean_po = po_number.strip().upper()
        direct_match = self._records.get(clean_po)
        if direct_match:
            return direct_match

        scanned_key = _normalise_po_number(clean_po)
        return next(
            (record for record in self._records.values() if _normalise_po_number(record.po_number) == scanned_key),
            None,
        )

    def list_all(self) -> List[PurchaseOrderRecord]:
        return list(self._records.values())
