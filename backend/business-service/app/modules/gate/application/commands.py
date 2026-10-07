"""
Commands and Queries for Gate Entry application layer.
"""
from dataclasses import dataclass
from typing import Any


@dataclass
class CreateGateEntryCommand:
    po_document_bytes: bytes
    po_document_filename: str
    po_document_content_type: str
    security_officer_id: str
    driver_photo_bytes: bytes | None = None
    driver_photo_filename: str | None = None
    driver_photo_content_type: str | None = None
    po_number: str | None = None
    vehicle_number: str | None = None
    driver_name: str | None = "Driver"
    driver_license_number: str | None = None
    driver_phone: str | None = None
    vehicle_photo_bytes: bytes | None = None
    vehicle_photo_filename: str | None = None
    vehicle_photo_content_type: str | None = None


@dataclass
class ManualVerifyCommand:
    gate_entry_id: str
    approved: bool
    verified_by_user_id: str
    notes: str | None = None
