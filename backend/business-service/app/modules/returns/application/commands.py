from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class CreateReturnLine:
    item_code: str
    quantity: Decimal
    reason: str


@dataclass(frozen=True)
class CreateReturnCommand:
    lines: list[CreateReturnLine]
