"""
Supplier ASN (Advance Shipping Notice) Aggregate.
"""
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
import random
import string
import uuid


class ASNStatus(str, Enum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    IN_TRANSIT = "IN_TRANSIT"
    GATE_CHECKED_IN = "GATE_CHECKED_IN"
    RECEIVED = "RECEIVED"
    CANCELLED = "CANCELLED"


def generate_asn_number() -> str:
    today_str = date.today().strftime("%Y%m%d")
    suffix = "".join(random.choices(string.digits, k=4))
    return f"ASN-{today_str}-{suffix}"


@dataclass
class ASNItem:
    id: str
    po_item_id: str
    material_code: str
    material_name: str
    ordered_qty: Decimal
    shipped_qty: Decimal
    unit_of_measure: str = "PCS"
    batch_number: str | None = None
    expiry_date: date | None = None

    @classmethod
    def create(
        cls,
        po_item_id: str,
        material_code: str,
        material_name: str,
        ordered_qty: Decimal | float | int,
        shipped_qty: Decimal | float | int,
        unit_of_measure: str = "PCS",
        batch_number: str | None = None,
        expiry_date: date | None = None,
        item_id: str | None = None,
    ) -> "ASNItem":
        ord_q = Decimal(str(ordered_qty))
        shp_q = Decimal(str(shipped_qty))
        if shp_q <= Decimal("0"):
            raise ValueError(f"Shipped quantity for '{material_code}' must be greater than zero")
        return cls(
            id=item_id or str(uuid.uuid4()),
            po_item_id=po_item_id,
            material_code=material_code,
            material_name=material_name,
            ordered_qty=ord_q,
            shipped_qty=shp_q,
            unit_of_measure=unit_of_measure,
            batch_number=batch_number,
            expiry_date=expiry_date,
        )


@dataclass
class SupplierASN:
    id: str
    asn_number: str
    po_id: str
    po_number: str
    supplier_id: str
    supplier_name: str
    warehouse_id: str
    shipped_date: date
    expected_arrival_date: date
    transporter_name: str
    tracking_number: str
    vehicle_number: str
    driver_name: str | None = None
    driver_phone: str | None = None
    status: ASNStatus = ASNStatus.SUBMITTED
    items: list[ASNItem] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    recorded_events: list[object] = field(default_factory=list, repr=False)

    @classmethod
    def create(
        cls,
        po_id: str,
        po_number: str,
        supplier_id: str,
        supplier_name: str,
        warehouse_id: str,
        expected_arrival_date: date,
        transporter_name: str,
        tracking_number: str,
        vehicle_number: str,
        items: list[ASNItem],
        shipped_date: date | None = None,
        driver_name: str | None = None,
        driver_phone: str | None = None,
        asn_number: str | None = None,
        asn_id: str | None = None,
    ) -> "SupplierASN":
        if not po_id or not supplier_id or not vehicle_number or not vehicle_number.strip():
            raise ValueError("PO ID, Supplier ID, and Vehicle Number are required for ASN")
        if not items:
            raise ValueError("ASN must contain at least one shipped item")

        return cls(
            id=asn_id or f"ASN-{uuid.uuid4().hex[:8].upper()}",
            asn_number=asn_number or generate_asn_number(),
            po_id=po_id,
            po_number=po_number,
            supplier_id=supplier_id,
            supplier_name=supplier_name,
            warehouse_id=warehouse_id,
            shipped_date=shipped_date or date.today(),
            expected_arrival_date=expected_arrival_date,
            transporter_name=transporter_name,
            tracking_number=tracking_number,
            vehicle_number=vehicle_number.strip().upper(),
            driver_name=driver_name,
            driver_phone=driver_phone,
            status=ASNStatus.SUBMITTED,
            items=items,
        )

    def mark_in_transit(self) -> None:
        self.status = ASNStatus.IN_TRANSIT
        self.updated_at = datetime.now(timezone.utc)

    def mark_gate_checked_in(self) -> None:
        self.status = ASNStatus.GATE_CHECKED_IN
        self.updated_at = datetime.now(timezone.utc)

    def mark_received(self) -> None:
        self.status = ASNStatus.RECEIVED
        self.updated_at = datetime.now(timezone.utc)

    @property
    def total_shipped_qty(self) -> Decimal:
        return sum((item.shipped_qty for item in self.items), Decimal("0.00"))
