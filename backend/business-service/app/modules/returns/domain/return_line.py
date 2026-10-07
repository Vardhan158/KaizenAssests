"""
One line of a return request - counterpart of ReturnLine.java. Mirrors the
pattern in receiving's ReceiptLine: same shape, different module.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from app.common.domain.exceptions import DomainRuleViolationException
from app.modules.returns.domain.return_reason import ReturnReason


@dataclass(frozen=True)
class ReturnLine:
    item_code: str
    quantity: Decimal
    reason: ReturnReason | None

    def validate(self) -> None:
        if self.quantity is None or self.quantity <= 0:
            raise DomainRuleViolationException(f"Return quantity for {self.item_code} must be greater than zero")
        if self.reason is None:
            raise DomainRuleViolationException(f"A return reason is required for {self.item_code}")
