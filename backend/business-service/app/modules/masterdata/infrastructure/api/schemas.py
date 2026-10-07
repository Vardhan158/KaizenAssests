"""
Pydantic Schemas for Supplier API.
"""
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class SupplierCreateDTO(BaseModel):
    supplier_code: str = Field(..., example="SUPP-101")
    supplier_name: str = Field(..., example="Acme Industrial Corp")
    category: str = Field("General", example="Raw Materials")
    contact_person: str | None = Field(None, example="John Smith")
    email: str | None = Field(None, example="john@acme.com")
    phone: str | None = Field(None, example="+1555019283")
    address: str | None = Field(None, example="123 Industrial Way, Sector 4")
    gst_number: str | None = Field(None, example="27AAAAA0000A1Z5")
    payment_terms: str | None = Field("NET30", example="NET30")
    bank_details: str | None = Field(None, example="Bank of America AC: 987654321")


class SupplierUpdateDTO(BaseModel):
    supplier_name: str | None = None
    category: str | None = None
    contact_person: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    gst_number: str | None = None
    payment_terms: str | None = None
    bank_details: str | None = None
    status: str | None = None


class SupplierRatingDTO(BaseModel):
    on_time_delivery_rate: float
    quality_score: float
    total_orders_fulfilled: int
    overall_rating: float


class SupplierResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    supplier_code: str
    supplier_name: str
    category: str
    contact_person: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    gst_number: str | None = None
    payment_terms: str | None = None
    bank_details: str | None = None
    status: str
    rating: SupplierRatingDTO
    created_at: datetime
    updated_at: datetime


class SupplierListResponseDTO(BaseModel):
    items: list[SupplierResponseDTO]
    total: int
    skip: int
    limit: int
