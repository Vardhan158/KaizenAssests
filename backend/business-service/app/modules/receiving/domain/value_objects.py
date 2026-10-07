"""
GrnId / PurchaseOrderId - counterparts of the Java GrnId / PurchaseOrderId
value objects. UUID-backed, immutable, equality by value.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class GrnId:
    value: uuid.UUID

    @staticmethod
    def new_id() -> "GrnId":
        return GrnId(uuid.uuid4())

    @staticmethod
    def of(value: str | uuid.UUID) -> "GrnId":
        if isinstance(value, uuid.UUID):
            return GrnId(value)
        try:
            return GrnId(uuid.UUID(str(value).strip()))
        except (ValueError, TypeError, AttributeError):
            import hashlib
            h = hashlib.md5(str(value).strip().encode("utf-8")).digest()
            return GrnId(uuid.UUID(bytes=h))

    def __str__(self) -> str:
        return str(self.value)


@dataclass(frozen=True)
class PurchaseOrderId:
    value: uuid.UUID

    @staticmethod
    def of(value: str | uuid.UUID) -> "PurchaseOrderId":
        if isinstance(value, uuid.UUID):
            return PurchaseOrderId(value)
        try:
            return PurchaseOrderId(uuid.UUID(str(value).strip()))
        except (ValueError, TypeError, AttributeError):
            import hashlib
            h = hashlib.md5(str(value).strip().encode("utf-8")).digest()
            return PurchaseOrderId(uuid.UUID(bytes=h))

    def __str__(self) -> str:
        return str(self.value)
