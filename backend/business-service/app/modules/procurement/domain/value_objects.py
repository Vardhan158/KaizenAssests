"""
Value objects for procurement module.
UUID-backed, immutable, value-based equality.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class RfqId:
    value: uuid.UUID

    @staticmethod
    def new_id() -> RfqId:
        return RfqId(uuid.uuid4())

    @staticmethod
    def of(value: str | uuid.UUID) -> RfqId:
        return RfqId(value if isinstance(value, uuid.UUID) else uuid.UUID(value))

    def __str__(self) -> str:
        return str(self.value)


@dataclass(frozen=True)
class QuotationId:
    value: uuid.UUID

    @staticmethod
    def new_id() -> QuotationId:
        return QuotationId(uuid.uuid4())

    @staticmethod
    def of(value: str | uuid.UUID) -> QuotationId:
        return QuotationId(value if isinstance(value, uuid.UUID) else uuid.UUID(value))

    def __str__(self) -> str:
        return str(self.value)


@dataclass(frozen=True)
class PurchaseOrderId:
    value: uuid.UUID

    @staticmethod
    def new_id() -> PurchaseOrderId:
        return PurchaseOrderId(uuid.uuid4())

    @staticmethod
    def of(value: str | uuid.UUID) -> PurchaseOrderId:
        return PurchaseOrderId(value if isinstance(value, uuid.UUID) else uuid.UUID(value))

    def __str__(self) -> str:
        return str(self.value)


@dataclass(frozen=True)
class AsnId:
    value: uuid.UUID

    @staticmethod
    def new_id() -> AsnId:
        return AsnId(uuid.uuid4())

    @staticmethod
    def of(value: str | uuid.UUID) -> AsnId:
        return AsnId(value if isinstance(value, uuid.UUID) else uuid.UUID(value))

    def __str__(self) -> str:
        return str(self.value)


@dataclass(frozen=True)
class SupplierId:
    value: uuid.UUID

    @staticmethod
    def new_id(sequence: int) -> SupplierId:
        # The sequence belongs in Supplier.supplier_code; persistence uses a
        # UUID primary key like the other procurement aggregates.
        return SupplierId(uuid.uuid4())

    @staticmethod
    def of(value: str | uuid.UUID) -> SupplierId:
        return SupplierId(value if isinstance(value, uuid.UUID) else uuid.UUID(str(value)))

    def __str__(self) -> str:
        return str(self.value)
