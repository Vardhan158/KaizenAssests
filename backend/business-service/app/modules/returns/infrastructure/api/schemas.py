from __future__ import annotations
from decimal import Decimal
from app.common.api_model import ApiModel
from pydantic import Field


class CreateReturnLineRequest(ApiModel):
    item_code: str = Field(min_length=1)
    quantity: Decimal
    reason: str = Field(min_length=1)


class CreateReturnRequest(ApiModel):
    lines: list[CreateReturnLineRequest] = Field(min_length=1)


class ReturnResponse(ApiModel):
    return_id: str
    status: str


class ReturnLineResponse(ApiModel):
    item_code: str
    quantity: Decimal
    reason: str


class ReturnDetailResponse(ApiModel):
    return_id: str
    status: str
    lines: list[ReturnLineResponse]
