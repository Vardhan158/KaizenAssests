"""
SupplierInfo value object representing Section 2: SUPPLIER INFORMATION.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SupplierInfo:
    supplier_code: str | None = None
    supplier_name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    gst_number: str | None = None
    supplier_address: str | None = None
