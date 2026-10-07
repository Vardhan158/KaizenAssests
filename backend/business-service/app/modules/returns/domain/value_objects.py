from __future__ import annotations
import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class ReturnId:
    value: uuid.UUID

    @staticmethod
    def new_id() -> "ReturnId":
        return ReturnId(uuid.uuid4())

    @staticmethod
    def of(value: str | uuid.UUID) -> "ReturnId":
        return ReturnId(value if isinstance(value, uuid.UUID) else uuid.UUID(value))

    def __str__(self) -> str:
        return str(self.value)
