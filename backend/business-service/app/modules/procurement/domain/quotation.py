from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, date
from decimal import Decimal
from typing import List, Optional

from app.common.domain.aggregate_root import AggregateRoot
from app.common.domain.events import DomainEvent
from app.modules.procurement.domain.events import QuotationSubmittedEvent
from app.modules.procurement.domain.value_objects import QuotationId, RfqId, SupplierId


@dataclass
class QuotationLine:
    item_code: str
    quantity: Decimal
    unit_price: Decimal
    material_id: Optional[str] = None
    material_variant_id: Optional[str] = None
    variant_code: Optional[str] = None


@dataclass
class QuotationDocument:
    document_type: str
    file_name: str
    file_url: str


class Quotation(AggregateRoot):
    def __init__(
        self,
        id: QuotationId,
        rfq_id: RfqId,
        supplier_id: SupplierId,
        status: str,
        lines: List[QuotationLine],
        total_amount: Decimal,
        created_at: datetime | None = None,
        discount: Decimal | None = None,
        tax: Decimal | None = None,
        freight_charges: Decimal | None = None,
        additional_charges: Decimal | None = None,
        delivery_time: str | None = None,
        expected_delivery_date: date | None = None,
        payment_terms: str | None = None,
        mode_of_payment: str | None = None,
        warranty: str | None = None,
        quotation_validity: date | None = None,
        remarks: str | None = None,
        documents: List[QuotationDocument] | None = None,
    ) -> None:
        super().__init__()
        self.id = id
        self.rfq_id = rfq_id
        self.supplier_id = supplier_id
        self.status = status
        self.lines = lines
        self.total_amount = total_amount
        self.created_at = created_at or datetime.now()
        self.discount = discount
        self.tax = tax
        self.freight_charges = freight_charges
        self.additional_charges = additional_charges
        self.delivery_time = delivery_time
        self.expected_delivery_date = expected_delivery_date
        self.payment_terms = payment_terms
        self.mode_of_payment = mode_of_payment
        self.warranty = warranty
        self.quotation_validity = quotation_validity
        self.remarks = remarks
        self.documents = documents or []

    @staticmethod
    def create(
        rfq_id: RfqId,
        supplier_id: SupplierId,
        lines: List[QuotationLine],
        status: str = "SUBMITTED",
        discount: Decimal | None = None,
        tax: Decimal | None = None,
        freight_charges: Decimal | None = None,
        additional_charges: Decimal | None = None,
        delivery_time: str | None = None,
        expected_delivery_date: date | None = None,
        payment_terms: str | None = None,
        mode_of_payment: str | None = None,
        warranty: str | None = None,
        quotation_validity: date | None = None,
        remarks: str | None = None,
        documents: List[QuotationDocument] = None,
    ) -> Quotation:
        total_amount = sum((line.quantity * line.unit_price for line in lines), Decimal("0"))
        disc = discount or Decimal("0")
        tx = tax or Decimal("0")
        fr = freight_charges or Decimal("0")
        add = additional_charges or Decimal("0")
        base_amount = max(Decimal("0"), total_amount - disc)
        calculated_tax = base_amount * (tx / Decimal("100")) if tx > 0 else Decimal("0")
        net_amount = base_amount + calculated_tax + fr + add

        q = Quotation(
            id=QuotationId.new_id(),
            rfq_id=rfq_id,
            supplier_id=supplier_id,
            status=status,
            lines=lines,
            total_amount=net_amount,
            discount=discount,
            tax=tax,
            freight_charges=freight_charges,
            additional_charges=additional_charges,
            delivery_time=delivery_time,
            expected_delivery_date=expected_delivery_date,
            payment_terms=payment_terms,
            mode_of_payment=mode_of_payment,
            warranty=warranty,
            quotation_validity=quotation_validity,
            remarks=remarks,
            documents=documents or [],
        )

        if status == "SUBMITTED":
            q._register_event(
                QuotationSubmittedEvent(
                    quotation_id=str(q.id),
                    rfq_id=str(q.rfq_id),
                    supplier_id=str(q.supplier_id),
                    occurred_at=DomainEvent.now(),
                )
            )
        return q
