"""
Domain events for procurement module.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

from app.common.domain.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class SupplierCreatedEvent(DomainEvent):
    supplier_id: str
    supplier_name: str
    registered_company_name: str
    vendor_type: str
    category: List[str]
    industry: str
    gstin: str




@dataclass(frozen=True, kw_only=True)
class RfqCreatedEvent(DomainEvent):
    rfq_id: str
    rfq_number: str
    supplier_ids: List[str]


@dataclass(frozen=True, kw_only=True)
class QuotationSubmittedEvent(DomainEvent):
    quotation_id: str
    rfq_id: str
    supplier_id: str


@dataclass(frozen=True, kw_only=True)
class PurchaseOrderPlacedEvent(DomainEvent):
    po_id: str
    po_number: str
    supplier_id: str


@dataclass(frozen=True, kw_only=True)
class AsnCreatedEvent(DomainEvent):
    asn_id: str
    asn_number: str
    po_id: str | None = None
    warehouse_id: str | None = None
    vehicle_number: str | None = None
    expected_arrival_at: str | None = None
