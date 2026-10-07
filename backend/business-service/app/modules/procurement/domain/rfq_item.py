import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional


@dataclass
class RFQItem:
    material_code: str
    material_name: str
    category: str
    quantity: Decimal
    uom: str
    material_id: Optional[uuid.UUID | str] = None
    material_variant_id: Optional[uuid.UUID | str] = None
    variant_code: Optional[str] = None
    required_delivery_date: date | None = None
    warehouse: str | None = None
    special_requirements: str | None = None
