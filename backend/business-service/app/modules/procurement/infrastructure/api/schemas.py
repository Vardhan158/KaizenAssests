"""
Procurement API schemas compatibility module.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class DevLoginRequest(ApiModel):
    username: str
    password: str


class SupplierLoginRequest(ApiModel):
    username: str
    password: str


class SupplierLoginResponse(ApiModel):
    token: str
    supplier_id: str
    must_change_password: bool
    username: str


class ChangePasswordRequest(ApiModel):
    username: str
    old_password: str
    new_password: str


class MagicLoginRequest(ApiModel):
    token: str


class MagicLoginResponse(ApiModel):
    token: str
    supplier_id: str
    supplierId: str
    username: str
    must_change_password: bool = False
    roles: List[str] = ["SUPPLIER"]
    rfq_id: Optional[str] = None
    po_id: Optional[str] = None
    link_type: Optional[str] = "RFQ"
    email: Optional[str] = None
    expires_in_hours: Optional[float] = None


class RfqItemSchema(ApiModel):
    material_id: Optional[str] = None
    material_variant_id: Optional[str] = None
    material_code: str
    variant_code: Optional[str] = None
    material_name: str
    category: Optional[str] = None
    quantity: Decimal
    uom: str
    required_delivery_date: Optional[date] = None
    warehouse: Optional[str] = None
    special_requirements: Optional[str] = None


class SupplierResponse(ApiModel):
    id: str
    supplier_name: str
    supplier_code: Optional[str] = None
    registered_company_name: Optional[str] = None
    vendor_type: Optional[str] = None
    status: Optional[str] = None


class RfqResponse(ApiModel):
    id: str
    rfq_number: str
    rfq_date: date
    material_request_number: Optional[str] = None
    required_delivery_date: Optional[date] = None
    warehouse: Optional[str] = None
    procurement_officer: Optional[str] = None
    remarks: Optional[str] = None
    status: str
    items: List[RfqItemSchema] = []
    suppliers: List[SupplierResponse] = []
    supplier_emails: List[str] = []
    created_at: Optional[datetime] = None
