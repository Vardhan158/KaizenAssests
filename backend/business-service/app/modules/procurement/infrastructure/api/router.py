"""
Procurement router compatibility module.
Provides auth routes under /api/v1/procurement/auth and shared helpers.
"""
from __future__ import annotations

from typing import Any, List
from fastapi import APIRouter

from app.common.email_utils import send_email
from app.config.settings import get_settings
from app.logging.logger import get_logger
from app.security.router import (
    router as auth_router,
    dev_login,
    supplier_login,
    change_password,
    magic_login,
    verify_magic_token_endpoint,
)
from app.modules.procurement.infrastructure.api.schemas import (
    RfqResponse,
    RfqItemSchema,
    SupplierResponse,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1/procurement", tags=["procurement"])
router.include_router(auth_router, prefix="/auth")


def _to_rfq_response(rfq) -> RfqResponse:
    items = []
    for item in (getattr(rfq, "items", []) or []):
        items.append(
            RfqItemSchema(
                material_id=str(getattr(item, "material_id", None)) if getattr(item, "material_id", None) else None,
                material_variant_id=str(getattr(item, "material_variant_id", None)) if getattr(item, "material_variant_id", None) else None,
                material_code=item.material_code,
                variant_code=getattr(item, "variant_code", None),
                material_name=item.material_name,
                category=getattr(item, "category", None),
                quantity=item.quantity,
                uom=item.uom,
                required_delivery_date=getattr(item, "required_delivery_date", None),
                warehouse=getattr(item, "warehouse", None),
                special_requirements=getattr(item, "special_requirements", None),
            )
        )

    suppliers_list = []
    supplier_emails = []
    for sup in (getattr(rfq, "suppliers", []) or []):
        suppliers_list.append(
            SupplierResponse(
                id=str(sup.id),
                supplier_name=sup.supplier_name,
                supplier_code=getattr(sup, "supplier_code", None),
                registered_company_name=getattr(sup, "registered_company_name", None),
                vendor_type=getattr(sup, "vendor_type", None),
                status=getattr(sup, "status", None),
            )
        )
        if hasattr(sup, "contact") and sup.contact and getattr(sup.contact, "primary_email", None):
            supplier_emails.append(sup.contact.primary_email)

    return RfqResponse(
        id=str(rfq.id),
        rfq_number=rfq.rfq_number,
        rfq_date=rfq.rfq_date,
        material_request_number=getattr(rfq, "material_request_number", None),
        required_delivery_date=getattr(rfq, "required_delivery_date", None),
        warehouse=getattr(rfq, "warehouse", None),
        procurement_officer=getattr(rfq, "procurement_officer", None),
        remarks=getattr(rfq, "remarks", None),
        status=rfq.status,
        items=items,
        suppliers=suppliers_list,
        supplier_emails=supplier_emails,
        created_at=getattr(rfq, "created_at", None),
    )
