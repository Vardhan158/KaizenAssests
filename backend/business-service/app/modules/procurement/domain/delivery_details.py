"""
DeliveryDetails value object representing Section 4: DELIVERY DETAILS.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class DeliveryDetails:
    delivery_warehouse: str | None = None
    delivery_address: str | None = None
    expected_delivery_date: date | None = None
    transporter: str | None = None
