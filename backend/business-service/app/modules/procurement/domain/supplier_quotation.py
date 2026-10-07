"""
Supplier Quotation Aggregate.
"""
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
import random
import string
import uuid


class QuotationStatus(str, Enum):
    SUBMITTED = "SUBMITTED"
    UNDER_REVIEW = "UNDER_REVIEW"
    SELECTED = "SELECTED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


def generate_quotation_number() -> str:
    today_str = date.today().strftime("%Y%m%d")
    suffix = "".join(random.choices(string.digits, k=4))
    return f"QUO-{today_str}-{suffix}"


@dataclass
class QuotationItem:
    id: str
    material_code: str
    material_name: str
    offered_qty: Decimal
    unit_price: Decimal
    tax_rate: Decimal = Decimal("0.18")
    discount_percent: Decimal = Decimal("0.00")

    @classmethod
    def create(
        cls,
        material_code: str,
        material_name: str,
        offered_qty: Decimal | float | int,
        unit_price: Decimal | float | int,
        tax_rate: Decimal | float | int = 0.18,
        discount_percent: Decimal | float | int = 0.0,
        item_id: str | None = None,
    ) -> "QuotationItem":
        qty = Decimal(str(offered_qty))
        price = Decimal(str(unit_price))
        tax = Decimal(str(tax_rate))
        disc = Decimal(str(discount_percent))
        if qty <= Decimal("0") or price < Decimal("0"):
            raise ValueError("Invalid quotation item values")
        return cls(
            id=item_id or str(uuid.uuid4()),
            material_code=material_code,
            material_name=material_name,
            offered_qty=qty,
            unit_price=price,
            tax_rate=tax,
            discount_percent=disc,
        )

    @property
    def line_subtotal(self) -> Decimal:
        base = self.offered_qty * self.unit_price
        discount = base * (self.discount_percent / Decimal("100"))
        return base - discount

    @property
    def line_tax(self) -> Decimal:
        return (self.line_subtotal * self.tax_rate).quantize(Decimal("0.01"))

    @property
    def line_total(self) -> Decimal:
        return self.line_subtotal + self.line_tax


@dataclass
class SupplierQuotation:
    id: str
    quotation_number: str
    rfq_id: str
    supplier_id: str
    supplier_code: str
    supplier_name: str
    valid_until: date
    submission_date: date = field(default_factory=date.today)
    payment_terms: str = "NET30"
    delivery_lead_time_days: int = 7
    status: QuotationStatus = QuotationStatus.SUBMITTED
    rejection_reason: str | None = None
    items: list[QuotationItem] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    recorded_events: list[object] = field(default_factory=list, repr=False)

    @classmethod
    def create(
        cls,
        rfq_id: str,
        supplier_id: str,
        supplier_code: str,
        supplier_name: str,
        valid_until: date,
        items: list[QuotationItem],
        payment_terms: str = "NET30",
        delivery_lead_time_days: int = 7,
        quotation_number: str | None = None,
        quotation_id: str | None = None,
    ) -> "SupplierQuotation":
        if not rfq_id or not supplier_id:
            raise ValueError("RFQ ID and Supplier ID are required")
        if not items:
            raise ValueError("Quotation must contain at least one line item")

        return cls(
            id=quotation_id or f"QUO-{uuid.uuid4().hex[:8].upper()}",
            quotation_number=quotation_number or generate_quotation_number(),
            rfq_id=rfq_id,
            supplier_id=supplier_id,
            supplier_code=supplier_code,
            supplier_name=supplier_name,
            valid_until=valid_until,
            payment_terms=payment_terms,
            delivery_lead_time_days=delivery_lead_time_days,
            status=QuotationStatus.SUBMITTED,
            items=items,
        )

    def mark_selected(self) -> None:
        self.status = QuotationStatus.SELECTED
        self.updated_at = datetime.now(timezone.utc)

    def mark_rejected(self, reason: str | None = None) -> None:
        self.status = QuotationStatus.REJECTED
        self.rejection_reason = reason
        self.updated_at = datetime.now(timezone.utc)

    @property
    def subtotal(self) -> Decimal:
        return sum((item.line_subtotal for item in self.items), Decimal("0.00"))

    @property
    def tax_amount(self) -> Decimal:
        return sum((item.line_tax for item in self.items), Decimal("0.00"))

    @property
    def grand_total(self) -> Decimal:
        return sum((item.line_total for item in self.items), Decimal("0.00"))
