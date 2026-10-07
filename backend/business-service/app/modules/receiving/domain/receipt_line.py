"""
One line of a goods receipt - counterpart of ReceiptLine.java.
validate_against_purchase_order() carries the actual business rule from the
BRD (a receipt line can never exceed what was ordered): it lives here, not
in the router and not in the repository, exactly as in the original.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from app.common.domain.exceptions import DomainRuleViolationException


@dataclass(frozen=True)
class ReceiptLine:
    item_code: str
    received_quantity: Decimal
    ordered_quantity: Decimal | None

    def validate_against_purchase_order(self) -> None:
        if self.received_quantity is None or self.received_quantity <= 0:
            raise DomainRuleViolationException(
                f"Received quantity for {self.item_code} must be greater than zero"
            )
        if self.ordered_quantity is not None and self.received_quantity > self.ordered_quantity:
            raise DomainRuleViolationException(
                f"Received quantity for {self.item_code} ({self.received_quantity}) "
                f"exceeds ordered quantity ({self.ordered_quantity})"
            )
