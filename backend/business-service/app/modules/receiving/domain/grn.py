"""
GoodsReceiptNote - the aggregate root for this module, counterpart of
GoodsReceiptNote.java. This class - not the router, not the repository -
decides what counts as a valid goods receipt. It has zero framework
imports so it can be unit-tested with no database or web server running.
"""
from __future__ import annotations

from app.common.domain.aggregate_root import AggregateRoot
from app.common.domain.events import DomainEvent
from app.common.domain.exceptions import DomainRuleViolationException
from app.modules.receiving.domain.events import GoodsReceivedEvent, ReceivedLine
from app.modules.receiving.domain.grn_status import GrnStatus
from app.modules.receiving.domain.receipt_line import ReceiptLine
from app.modules.receiving.domain.value_objects import GrnId, PurchaseOrderId


class GoodsReceiptNote(AggregateRoot):
    def __init__(self, id: GrnId, po_id: PurchaseOrderId, status: GrnStatus, lines: list[ReceiptLine]) -> None:
        super().__init__()
        self.id = id
        self.po_id = po_id
        self.status = status
        self.lines = lines

    @staticmethod
    def confirm(po_id: PurchaseOrderId, lines: list[ReceiptLine]) -> "GoodsReceiptNote":
        """The only way a GoodsReceiptNote comes into existence."""
        if not lines:
            raise DomainRuleViolationException("A goods receipt note must have at least one line")
        for line in lines:
            line.validate_against_purchase_order()

        grn = GoodsReceiptNote(GrnId.new_id(), po_id, GrnStatus.CONFIRMED, lines)

        event = GoodsReceivedEvent(
            grn_id=str(grn.id),
            po_id=str(grn.po_id),
            lines=[ReceivedLine(l.item_code, l.received_quantity) for l in lines],
            occurred_at=DomainEvent.now(),
        )
        grn._register_event(event)
        return grn

    @staticmethod
    def rehydrate(id: GrnId, po_id: PurchaseOrderId, status: GrnStatus, lines: list[ReceiptLine]) -> "GoodsReceiptNote":
        """Rebuild from a stored row. No events raised - this is reconstructing
        known-valid past state, not making a new decision."""
        return GoodsReceiptNote(id, po_id, status, lines)
