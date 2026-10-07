"""
Pure domain-layer tests for GoodsReceiptNote - no database, no FastAPI,
mirroring the "zero framework imports" guarantee the domain layer makes.
"""
from decimal import Decimal

import pytest

from app.common.domain.exceptions import DomainRuleViolationException
from app.modules.receiving.domain.grn import GoodsReceiptNote
from app.modules.receiving.domain.grn_status import GrnStatus
from app.modules.receiving.domain.receipt_line import ReceiptLine
from app.modules.receiving.domain.value_objects import PurchaseOrderId


def test_confirm_succeeds_within_ordered_quantity():
    po_id = PurchaseOrderId.of("11111111-1111-1111-1111-111111111111")
    lines = [ReceiptLine(item_code="ITEM-A", received_quantity=Decimal("10"), ordered_quantity=Decimal("100"))]

    grn = GoodsReceiptNote.confirm(po_id, lines)

    assert grn.status == GrnStatus.CONFIRMED
    assert len(grn.domain_events) == 1
    assert grn.domain_events[0].lines[0].item_code == "ITEM-A"


def test_confirm_rejects_quantity_exceeding_ordered():
    po_id = PurchaseOrderId.of("11111111-1111-1111-1111-111111111111")
    lines = [ReceiptLine(item_code="ITEM-A", received_quantity=Decimal("200"), ordered_quantity=Decimal("100"))]

    with pytest.raises(DomainRuleViolationException):
        GoodsReceiptNote.confirm(po_id, lines)


def test_confirm_rejects_empty_lines():
    po_id = PurchaseOrderId.of("11111111-1111-1111-1111-111111111111")
    with pytest.raises(DomainRuleViolationException):
        GoodsReceiptNote.confirm(po_id, [])


def test_confirm_rejects_non_positive_quantity():
    po_id = PurchaseOrderId.of("11111111-1111-1111-1111-111111111111")
    lines = [ReceiptLine(item_code="ITEM-A", received_quantity=Decimal("0"), ordered_quantity=Decimal("100"))]
    with pytest.raises(DomainRuleViolationException):
        GoodsReceiptNote.confirm(po_id, lines)
