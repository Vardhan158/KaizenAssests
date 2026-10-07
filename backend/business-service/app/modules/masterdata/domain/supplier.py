"""
Supplier Aggregate Root and domain logic.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import uuid


class SupplierStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    BLACKLISTED = "BLACKLISTED"


@dataclass
class SupplierRating:
    on_time_delivery_rate: float = 100.0  # percentage
    quality_score: float = 5.0  # 1.0 - 5.0
    total_orders_fulfilled: int = 0

    @property
    def overall_rating(self) -> float:
        if self.total_orders_fulfilled == 0:
            return 5.0
        delivery_weight = (self.on_time_delivery_rate / 100.0) * 2.5
        quality_weight = (self.quality_score / 5.0) * 2.5
        return round(delivery_weight + quality_weight, 2)


@dataclass
class Supplier:
    id: str
    supplier_code: str
    supplier_name: str
    category: str
    contact_person: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    gst_number: str | None = None
    payment_terms: str | None = "NET30"
    bank_details: str | None = None
    status: SupplierStatus = SupplierStatus.ACTIVE
    rating: SupplierRating = field(default_factory=SupplierRating)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    recorded_events: list[object] = field(default_factory=list, repr=False)

    @classmethod
    def create(
        cls,
        supplier_code: str,
        supplier_name: str,
        category: str = "General",
        contact_person: str | None = None,
        email: str | None = None,
        phone: str | None = None,
        address: str | None = None,
        gst_number: str | None = None,
        payment_terms: str | None = "NET30",
        bank_details: str | None = None,
        supplier_id: str | None = None,
    ) -> "Supplier":
        if not supplier_code or not supplier_code.strip():
            raise ValueError("Supplier code is required")
        if not supplier_name or not supplier_name.strip():
            raise ValueError("Supplier name is required")

        sid = supplier_id or f"SUPP-{uuid.uuid4().hex[:8].upper()}"
        supp = cls(
            id=sid,
            supplier_code=supplier_code.strip(),
            supplier_name=supplier_name.strip(),
            category=category,
            contact_person=contact_person,
            email=email,
            phone=phone,
            address=address,
            gst_number=gst_number,
            payment_terms=payment_terms,
            bank_details=bank_details,
            status=SupplierStatus.ACTIVE,
        )
        return supp

    def update_info(
        self,
        supplier_name: str | None = None,
        category: str | None = None,
        contact_person: str | None = None,
        email: str | None = None,
        phone: str | None = None,
        address: str | None = None,
        gst_number: str | None = None,
        payment_terms: str | None = None,
        bank_details: str | None = None,
        status: SupplierStatus | None = None,
    ) -> None:
        if supplier_name is not None:
            self.supplier_name = supplier_name.strip()
        if category is not None:
            self.category = category
        if contact_person is not None:
            self.contact_person = contact_person
        if email is not None:
            self.email = email
        if phone is not None:
            self.phone = phone
        if address is not None:
            self.address = address
        if gst_number is not None:
            self.gst_number = gst_number
        if payment_terms is not None:
            self.payment_terms = payment_terms
        if bank_details is not None:
            self.bank_details = bank_details
        if status is not None:
            self.status = status
        self.updated_at = datetime.now(timezone.utc)

    def update_rating(self, on_time_delivery_rate: float, quality_score: float) -> None:
        self.rating.on_time_delivery_rate = max(0.0, min(100.0, on_time_delivery_rate))
        self.rating.quality_score = max(1.0, min(5.0, quality_score))
        self.rating.total_orders_fulfilled += 1
        self.updated_at = datetime.now(timezone.utc)
