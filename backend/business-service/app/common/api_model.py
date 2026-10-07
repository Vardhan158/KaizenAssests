"""
Base Pydantic model that serializes/deserializes camelCase on the wire
while keeping snake_case attribute names in Python. This preserves the
original API contract: the Java DTOs (ConfirmGrnRequest, GrnResponse, ...)
were Jackson-serialized records, which use camelCase by default
(e.g. "poId", "itemCode", "grnId") - the frontend was written against
that shape and is otherwise unchanged by this migration.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
