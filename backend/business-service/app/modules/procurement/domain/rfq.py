from __future__ import annotations

from dataclasses import field
from datetime import date, datetime
from typing import List

from app.common.domain.aggregate_root import AggregateRoot
from app.common.domain.events import DomainEvent
from app.modules.procurement.domain.events import RfqCreatedEvent
from app.modules.procurement.domain.value_objects import RfqId, SupplierId
from app.modules.procurement.domain.rfq_item import RFQItem


class RFQ(AggregateRoot):
    def __init__(
        self,
        id: RfqId,
        rfq_number: str,
        rfq_date: date,
        warehouse: str,
        procurement_officer: str,
        status: str,
        supplier_ids: List[SupplierId],
        items: List[RFQItem] = None,
        material_request_number: str | None = None,
        required_delivery_date: date | None = None,
        remarks: str | None = None,
        created_at: datetime | None = None,
        closing_date: datetime | None = None,
        selected_supplier_id: SupplierId | None = None,
        selection_date: date | None = None,
        selected_by: str | None = None,
        selection_reason: str | None = None,
        selection_comments: str | None = None,
    ) -> None:
        super().__init__()
        self.id = id
        self.rfq_number = rfq_number
        self.rfq_date = rfq_date
        self.material_request_number = material_request_number
        self.required_delivery_date = required_delivery_date
        self.warehouse = warehouse
        self.procurement_officer = procurement_officer
        self.remarks = remarks
        self.status = status
        # Deduplicate supplier IDs
        self.supplier_ids = list(dict.fromkeys(supplier_ids))
        self.items = items or []
        self.created_at = created_at or datetime.now()
        self.closing_date = closing_date
        self.selected_supplier_id = selected_supplier_id
        self.selection_date = selection_date
        self.selected_by = selected_by
        self.selection_reason = selection_reason
        self.selection_comments = selection_comments

    def send(self) -> None:
        if self.status != "DRAFT":
            raise ValueError(f"Cannot send RFQ in status: {self.status}")
        self.status = "OPEN"
        self._register_event(
            RfqCreatedEvent(
                rfq_id=str(self.id),
                rfq_number=self.rfq_number,
                supplier_ids=[str(sid) for sid in self.supplier_ids],
                occurred_at=DomainEvent.now(),
            )
        )

    def select_supplier(
        self,
        supplier_id: SupplierId,
        selected_by: str,
        selection_reason: str,
        selection_comments: str | None = None,
    ) -> None:
        self.status = "Supplier Selected"
        self.selected_supplier_id = supplier_id
        self.selection_date = date.today()
        self.selected_by = selected_by
        self.selection_reason = selection_reason
        self.selection_comments = selection_comments

    @staticmethod
    def create(
        rfq_number: str,
        rfq_date: date,
        warehouse: str,
        procurement_officer: str,
        supplier_ids: List[SupplierId],
        items: List[RFQItem],
        material_request_number: str | None = None,
        required_delivery_date: date | None = None,
        remarks: str | None = None,
    ) -> RFQ:
        rfq = RFQ(
            id=RfqId.new_id(),
            rfq_number=rfq_number,
            rfq_date=rfq_date,
            material_request_number=material_request_number,
            required_delivery_date=required_delivery_date,
            warehouse=warehouse,
            procurement_officer=procurement_officer,
            remarks=remarks,
            status="DRAFT",
            supplier_ids=supplier_ids,
            items=items,
        )
        return rfq

