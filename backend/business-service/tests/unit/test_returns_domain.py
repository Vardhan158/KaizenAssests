from decimal import Decimal

import pytest

from app.common.domain.exceptions import DomainRuleViolationException
from app.modules.returns.domain.return_line import ReturnLine
from app.modules.returns.domain.return_reason import ReturnReason
from app.modules.returns.domain.return_request import ReturnRequest
from app.modules.returns.domain.return_status import ReturnStatus


def test_request_succeeds_with_valid_lines():
    lines = [ReturnLine(item_code="ITEM-A", quantity=Decimal("2"), reason=ReturnReason.DAMAGED)]
    return_request = ReturnRequest.request(lines)

    assert return_request.status == ReturnStatus.REQUESTED
    assert len(return_request.domain_events) == 1


def test_request_rejects_missing_reason():
    lines = [ReturnLine(item_code="ITEM-A", quantity=Decimal("2"), reason=None)]
    with pytest.raises(DomainRuleViolationException):
        ReturnRequest.request(lines)
