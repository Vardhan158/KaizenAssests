"""
ReturnRequest - the aggregate root, counterpart of ReturnRequest.java.
"""
from __future__ import annotations

from app.common.domain.aggregate_root import AggregateRoot
from app.common.domain.events import DomainEvent
from app.common.domain.exceptions import DomainRuleViolationException
from app.modules.returns.domain.events import RequestedLine, ReturnRequestedEvent
from app.modules.returns.domain.return_line import ReturnLine
from app.modules.returns.domain.return_status import ReturnStatus
from app.modules.returns.domain.value_objects import ReturnId


class ReturnRequest(AggregateRoot):
    def __init__(self, id: ReturnId, status: ReturnStatus, lines: list[ReturnLine]) -> None:
        super().__init__()
        self.id = id
        self.status = status
        self.lines = lines

    @staticmethod
    def request(lines: list[ReturnLine]) -> "ReturnRequest":
        if not lines:
            raise DomainRuleViolationException("A return request must have at least one line")
        for line in lines:
            line.validate()

        return_request = ReturnRequest(ReturnId.new_id(), ReturnStatus.REQUESTED, lines)

        event = ReturnRequestedEvent(
            return_id=str(return_request.id),
            lines=[RequestedLine(l.item_code, l.quantity, l.reason.value) for l in lines],
            occurred_at=DomainEvent.now(),
        )
        return_request._register_event(event)
        return return_request

    @staticmethod
    def rehydrate(id: ReturnId, status: ReturnStatus, lines: list[ReturnLine]) -> "ReturnRequest":
        return ReturnRequest(id, status, lines)
