"""
Inbound API adapter for procurement module.
Purchase Order module has been removed.
"""
from __future__ import annotations

import os
import asyncio
import uuid
import hashlib
import secrets
import html
import time
from io import BytesIO
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import inspect, or_, select, cast, String, update, func, Date
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased, selectinload, joinedload
from app.modules.gate.infrastructure.persistence.models import GateEntryModel

from app.common.domain.exceptions import DomainRuleViolationException, NotFoundException
from app.logging.logger import get_logger

from app.database.session import UnitOfWork, get_uow
from app.modules.procurement.application.commands import (
    AddressCommand,
    BankInfoCommand,
    ContactCommand,
    CreateSupplierCommand,
    DocumentCommand,
    CreateRfqCommand,
    RfqItemCommand,
    SubmitQuotationCommand,
    QuotationLineCommand,
    QuotationDocumentCommand,
    UpdateSupplierCommand,
    CreateAsnCommand,
    AsnLineCommand,
    AsnDocumentCommand,
)
from app.modules.procurement.application.use_cases import (
    CreateSupplierUseCase,
    GetSupplierUseCase,
    ListSuppliersUseCase,
    UpdateSupplierUseCase,
    BlockSupplierUseCase,
    UnblockSupplierUseCase,
    CreateRfqUseCase,
    SendRfqUseCase,
    SubmitQuotationUseCase,
    CreateAsnUseCase,
    GetNextAsnNumberUseCase,
    GetNextMaterialRequestNumberUseCase,
)
from app.modules.procurement.domain.value_objects import (
    SupplierId,
    RfqId,
    QuotationId,
    AsnId,
)
from app.modules.procurement.infrastructure.api.schemas import (
    AddressRequest,
    BankInfoRequest,
    ContactRequest,
    CreateSupplierRequest,
    UpdateSupplierRequest,
    SupplierStatusRequest,
    DocumentRequest,
    MasterDataCreate,
    MasterDataResponse,
    NotificationResponse,
    SupplierResponse,
    SupplierAddressResponse,
    SupplierContactResponse,
    SupplierBankInfoResponse,
    SupplierDocumentResponse,
    CreateRfqRequest,
    RfqResponse,
    RfqItemSchema,
    SubmitQuotationRequest,
    QuotationResponse,
    QuotationLineSchema,
    QuotationDocumentSchema,
    CreateAsnRequest,
    AsnResponse,
    ReplacementRequestResponse,
    AsnLineSchema,
    AsnDocumentSchema,
    ArrivalNotificationResponse,
    PurchaseOrderResponse,
    PurchaseOrderItemSchema,
    PurchaseOrderAmendmentRequest,
    MaterialRequestResponse,
    MaterialRequestItemSchema,
    CreateMaterialRequest,
    MaterialRequestStatusRequest,
    SupplierSelectionRequest,
    MaterialStockResponse,
    FinanceApprovalResponse,
    POApprovalHistorySchema,
    PORevisionSchema,
    ProcurementStatsResponse,
    ProcurementTrendItem,
    SupplierLoginRequest,
    SupplierLoginResponse,
    MagicLoginRequest,
    MagicLoginResponse,
    ChangePasswordRequest,
    DevLoginRequest,
    GlobalSearchResponse,
    CreateFinishedGoodsRequestSchema,
    FinishedGoodsRequestResponse,
)
from app.modules.procurement.infrastructure.api.magic_link import (
    generate_quotation_magic_token,
    verify_quotation_magic_token,
    create_quotation_short_link,
    create_po_short_link,
    resolve_magic_token_or_code,
)
from app.modules.procurement.infrastructure.persistence.models import (
    SupplierModel,
    SupplierAddressModel,
    VendorTypeModel,
    SupplierCategoryModel,
    SupplierUserModel,
    AsnModel,
    AsnLineModel,
    AsnDocumentModel,
    ArrivalNotificationModel,
    RfqModel,
    RfqItemModel,
    QuotationModel,
    QuotationLineModel,
    QuotationDocumentModel,
    PurchaseOrderModel,
    PurchaseOrderItemModel,
    PORevisionModel,
    MaterialModel,
    MaterialVariantModel,
    MaterialRequestModel,
    MaterialRequestItemModel,
    FinishedGoodsRequestModel,
    MaterialStockModel,
    POApprovalHistoryModel,
    NotificationModel,
    ReplacementRequestModel,
    rfq_supplier_link,
)
from app.modules.procurement.infrastructure.persistence.repository_impl import (
    SqlAlchemySupplierRepository,
    SqlAlchemyRfqRepository,
    SqlAlchemyQuotationRepository,
    SqlAlchemyAsnRepository,
    SqlAlchemyArrivalNotificationRepository,
    SqlAlchemyPurchaseOrderRepository,
)
from app.common.email_utils import render_premium_email, send_email
from app.security.dependencies import CurrentUser, get_current_user
from app.modules.store.infrastructure.persistence.models import StoreManagerUserModel

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1/procurement", tags=["procurement"])


def verify_procurement_role(_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    roles_upper = {r.upper() for r in (_user.roles or [])}
    allowed_exact = {
        "PROCUREMENT",
        "PROCUREMENT_MANAGER",
        "PROCUREMENT_OFFICER",
        "MANAGER",
        "OPERATIONS_MANAGER",
        "WAREHOUSE_MANAGER",
        "WAREHOUSE",
        "STORE_MANAGER",
        "STORE_KEEPER",
        "STORE_OPERATOR",
        "ASSEMBLY",
        "ASSEMBLY_MANAGER",
        "GATE_SECURITY",
        "FINANCE",
        "ADMIN",
        "SUPERUSER",
        "SUPER_ADMIN",
    }
    is_allowed = bool(
        (roles_upper & allowed_exact)
        or any(
            any(k in r for k in ("PROCUREMENT", "MANAGER", "ADMIN", "SUPER", "STORE", "WAREHOUSE", "ASSEMBLY", "FINANCE"))
            for r in roles_upper
        )
    )
    from app.config.settings import get_settings
    settings = get_settings()
    if not is_allowed and settings.environment.lower() in ("local", "test", "development", "dev"):
        is_allowed = True

    if not is_allowed:
        logger.warning(f"verify_procurement_role 403 Forbidden: user={_user.username}, roles={_user.roles}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied. Procurement role required (current roles: {list(_user.roles or [])})."
        )
    return _user


@router.get("/health", tags=["ops"])
async def procurement_health() -> dict:
    return {"status": "UP", "module": "procurement", "version": "v13:master-data-post-added"}


@router.get("/stats", response_model=ProcurementStatsResponse)
async def get_procurement_stats(uow: UnitOfWork = Depends(get_uow)):
    try:

        suppliers_count_stmt = select(func.count(SupplierModel.id)).where(SupplierModel.status == "Active")
        suppliers_res = await uow.session.execute(suppliers_count_stmt)
        active_suppliers = suppliers_res.scalar() or 0

        total_suppliers_stmt = select(func.count(SupplierModel.id))
        total_suppliers_res = await uow.session.execute(total_suppliers_stmt)
        total_suppliers = total_suppliers_res.scalar() or 0

        pending_supplier_registrations_stmt = select(func.count(SupplierModel.id)).where(
            func.lower(SupplierModel.status).like("%pending%")
        )
        pending_supplier_registrations_res = await uow.session.execute(pending_supplier_registrations_stmt)
        pending_supplier_registrations = pending_supplier_registrations_res.scalar() or 0

        pending_material_requests_stmt = select(func.count(MaterialRequestModel.id)).where(
            MaterialRequestModel.status == "Submitted"
        )
        pending_material_requests_res = await uow.session.execute(pending_material_requests_stmt)
        pending_material_requests = pending_material_requests_res.scalar() or 0

        pending_request_sources_stmt = (
            select(MaterialRequestModel.warehouse_id, MaterialRequestModel.department)
            .where(MaterialRequestModel.status == "Submitted")
            .order_by(MaterialRequestModel.created_at.desc())
            .limit(3)
        )
        pending_request_sources_res = await uow.session.execute(pending_request_sources_stmt)
        pending_material_request_sources = []
        for warehouse_id, department in pending_request_sources_res.all():
            source_parts = [part for part in (warehouse_id, department) if part]
            if source_parts:
                pending_material_request_sources.append(" / ".join(source_parts))

        expiring_supplier_documents = 0


        open_pos_stmt = select(func.count(PurchaseOrderModel.id)).where(
            PurchaseOrderModel.status.in_(["APPROVED", "SENT", "DISPATCHED", "SHIPPED"])
        )
        open_pos_res = await uow.session.execute(open_pos_stmt)
        open_pos = open_pos_res.scalar() or 0


        total_value_stmt = select(func.sum(PurchaseOrderModel.total_amount))
        total_value_res = await uow.session.execute(total_value_stmt)
        total_po_value = total_value_res.scalar() or Decimal("0.0")

        pending_approvals_stmt = select(func.count(PurchaseOrderModel.id)).where(
            PurchaseOrderModel.status.in_([
                "DRAFT",
                "PENDING_APPROVAL",
                "PENDING_FINANCE",
                "SUBMITTED",
                "RESUBMITTED",
            ])
        )
        pending_approvals_res = await uow.session.execute(pending_approvals_stmt)
        pending_approvals = pending_approvals_res.scalar() or 0

        pending_quotations_stmt = select(func.count(RfqModel.id)).where(
            RfqModel.status.in_(["PUBLISHED", "SENT", "OPEN", "INVITED", "PENDING_QUOTATION"])
        )
        pending_quotations_res = await uow.session.execute(pending_quotations_stmt)
        pending_quotations = pending_quotations_res.scalar() or 0

        awaiting_confirmation_stmt = select(func.count(PurchaseOrderModel.id)).where(
            PurchaseOrderModel.status == "SENT"
        )
        awaiting_confirmation_res = await uow.session.execute(awaiting_confirmation_stmt)
        awaiting_supplier_confirmation = awaiting_confirmation_res.scalar() or 0

        overdue_pos_stmt = select(func.count(PurchaseOrderModel.id)).where(
            PurchaseOrderModel.expected_delivery_date < date.today(),
            PurchaseOrderModel.status.notin_(["FULLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]),
        )
        overdue_pos_res = await uow.session.execute(overdue_pos_stmt)
        overdue_pos = overdue_pos_res.scalar() or 0

        partially_received_stmt = select(func.count(PurchaseOrderModel.id)).where(
            PurchaseOrderModel.status.in_(["PARTIALLY_RECEIVED", "PARTIAL_RECEIVED", "PARTIAL"])
        )
        partially_received_res = await uow.session.execute(partially_received_stmt)
        partially_received_pos = partially_received_res.scalar() or 0

        rfqs_closing_today_stmt = select(func.count(RfqModel.id)).where(
            cast(RfqModel.closing_date, Date) == date.today(),
            RfqModel.status.notin_(["CLOSED", "CANCELLED", "SELECTED"]),
        )
        rfqs_closing_today_res = await uow.session.execute(rfqs_closing_today_stmt)
        rfqs_closing_today = rfqs_closing_today_res.scalar() or 0

        asns_expected_today_stmt = select(func.count(AsnModel.id)).where(
            cast(AsnModel.expected_arrival_at, Date) == date.today(),
            AsnModel.status.notin_(["RECEIVED", "COMPLETED", "CANCELLED", "GRN_POSTED"]),
        )
        asns_expected_today_res = await uow.session.execute(asns_expected_today_stmt)
        asns_expected_today = asns_expected_today_res.scalar() or 0



        total_approved_stmt = select(func.count(PurchaseOrderModel.id)).where(
            PurchaseOrderModel.status.in_(["APPROVED", "SENT", "DISPATCHED", "SHIPPED", "RECEIVED"])
        )
        total_approved_res = await uow.session.execute(total_approved_stmt)
        total_approved = total_approved_res.scalar() or 0

        if total_approved > 0:
            asns_with_po_stmt = select(func.count(func.distinct(AsnModel.po_id))).where(AsnModel.po_id.isnot(None))
            asns_with_po_res = await uow.session.execute(asns_with_po_stmt)
            compliant_pos = asns_with_po_res.scalar() or 0

            compliance_rate = (compliant_pos / total_approved) * 100
        else:
            compliance_rate = None


        from datetime import timedelta
        trend = []


        current_date = datetime.now()
        for i in range(5, -1, -1):

            year = current_date.year
            month = current_date.month - i
            while month <= 0:
                month += 12
                year -= 1

            month_name = date(year, month, 1).strftime("%b")


            start_of_month = date(year, month, 1)
            if month == 12:
                end_of_month = date(year + 1, 1, 1)
            else:
                end_of_month = date(year, month + 1, 1)

            stmt = select(func.count(PurchaseOrderModel.id)).where(
                PurchaseOrderModel.po_date >= start_of_month,
                PurchaseOrderModel.po_date < end_of_month
            )
            res = await uow.session.execute(stmt)
            count = res.scalar() or 0
            trend.append(ProcurementTrendItem(month=month_name, pos=count))

        return ProcurementStatsResponse(
            active_suppliers=active_suppliers,
            total_suppliers=total_suppliers,
            open_pos=open_pos,
            pending_material_requests=pending_material_requests,
            pending_material_request_sources=pending_material_request_sources,
            pending_supplier_registrations=pending_supplier_registrations,
            expiring_supplier_documents=expiring_supplier_documents,
            pending_approvals=pending_approvals,
            pending_quotations=pending_quotations,
            awaiting_supplier_confirmation=awaiting_supplier_confirmation,
            overdue_pos=overdue_pos,
            partially_received_pos=partially_received_pos,
            rfqs_closing_today=rfqs_closing_today,
            asns_expected_today=asns_expected_today,
            compliance_rate=round(compliance_rate, 1) if compliance_rate is not None else None,
            compliance_target=99.0,
            total_po_value=total_po_value,
            trend=trend
        )
    except Exception as e:
        logger.error(f"Failed to fetch stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Unable to load procurement statistics") from e


@router.get("/vendor-types", response_model=List[MasterDataResponse])
async def list_vendor_types(uow: UnitOfWork = Depends(get_uow)):
    result = await uow.session.execute(select(VendorTypeModel).order_by(VendorTypeModel.name))
    return [MasterDataResponse(id=v.id, name=v.name) for v in result.scalars().all()]


@router.post("/vendor-types", response_model=MasterDataResponse, status_code=status.HTTP_201_CREATED)
async def create_vendor_type(request: MasterDataCreate, uow: UnitOfWork = Depends(get_uow)):
    clean_name = request.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    stmt = select(VendorTypeModel).where(func.lower(VendorTypeModel.name) == clean_name.lower())
    res = await uow.session.execute(stmt)
    existing = res.scalar_one_or_none()
    if existing:
        return MasterDataResponse(id=existing.id, name=existing.name)

    new_type = VendorTypeModel(name=clean_name)
    uow.session.add(new_type)
    await uow.commit()
    await uow.session.refresh(new_type)
    return MasterDataResponse(id=new_type.id, name=new_type.name)


@router.get("/supplier-categories", response_model=List[MasterDataResponse])
async def list_supplier_categories(uow: UnitOfWork = Depends(get_uow)):
    result = await uow.session.execute(select(SupplierCategoryModel).order_by(SupplierCategoryModel.name))
    return [MasterDataResponse(id=c.id, name=c.name) for c in result.scalars().all()]


@router.post("/supplier-categories", response_model=MasterDataResponse, status_code=status.HTTP_201_CREATED)
async def create_supplier_category(request: MasterDataCreate, uow: UnitOfWork = Depends(get_uow)):
    clean_name = request.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    stmt = select(SupplierCategoryModel).where(func.lower(SupplierCategoryModel.name) == clean_name.lower())
    res = await uow.session.execute(stmt)
    existing = res.scalar_one_or_none()
    if existing:
        return MasterDataResponse(id=existing.id, name=existing.name)

    new_cat = SupplierCategoryModel(name=clean_name)
    uow.session.add(new_cat)
    await uow.commit()
    await uow.session.refresh(new_cat)
    return MasterDataResponse(id=new_cat.id, name=new_cat.name)


@router.get("/raw-materials", response_model=List[MasterDataResponse])
async def list_raw_materials(uow: UnitOfWork = Depends(get_uow)):
    result = await uow.session.execute(select(MaterialModel.category).distinct().order_by(MaterialModel.category))
    categories = [r[0] for r in result.fetchall() if r[0]]
    if not categories:
        categories = ["Steel & Metals", "Electrical", "Raw Materials", "Packaging", "Fasteners & Hardware"]
    return [MasterDataResponse(id=idx + 1, name=cat) for idx, cat in enumerate(categories)]


@router.post("/raw-materials", response_model=MasterDataResponse, status_code=status.HTTP_201_CREATED)
async def create_raw_material(request: MasterDataCreate, uow: UnitOfWork = Depends(get_uow)):
    clean_name = request.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    return MasterDataResponse(id=1, name=clean_name)





@router.get("/material-requests/next-number")
async def get_next_mr_number(uow: UnitOfWork = Depends(get_uow)):
    """Return the next persisted material-request number and next material sequence."""
    from app.modules.procurement.infrastructure.persistence.repository_impl import SqlAlchemyMaterialRequestRepository

    repo = SqlAlchemyMaterialRequestRepository(uow.session)
    use_case = GetNextMaterialRequestNumberUseCase(repo)
    num = await use_case.handle()


    existing_codes_result = await uow.session.execute(
        select(MaterialRequestItemModel.material_code).where(
            MaterialRequestItemModel.material_code.like("MAT-%")
        )
    )
    stock_codes_result = await uow.session.execute(
        select(MaterialStockModel.material_code).where(
            MaterialStockModel.material_code.like("MAT-%")
        )
    )
    existing_codes = list(existing_codes_result.scalars().all()) + list(stock_codes_result.scalars().all())

    def material_sequence(code: str) -> int:
        try:
            return int(code.rsplit("-", 1)[-1])
        except (TypeError, ValueError):
            return 0

    next_seq = max((material_sequence(code) for code in existing_codes), default=0) + 1

    return {
        "requestNumber": num,
        "nextMaterialSequence": next_seq
    }


MR_STATUS_ALIASES = {
    "PENDING": "Submitted",
    "PROCESSED": "Approved",
    "COMPLETED": "Closed",
    "CANCELLED": "Closed",
}
MR_ALLOWED_STATUSES = {
    "Draft",
    "Submitted",
    "Pending Approval",
    "Approved",
    "Rejected",
    "Converted to RFQ",
    "Closed",
}
MR_STATUS_TRANSITIONS = {
    "Draft": {"Submitted", "Closed"},
    "Submitted": {"Approved", "Rejected", "Closed"},
    "Pending Approval": {"Approved", "Rejected", "Closed"},
    "Approved": {"Converted to RFQ", "Closed"},
    "Rejected": {"Draft", "Closed"},
    "Converted to RFQ": {"Closed"},
    "Closed": set(),
}


def _normalize_mr_status(value: str | None) -> str:
    raw = (value or "Submitted").strip()
    return MR_STATUS_ALIASES.get(raw.upper(), raw)


def _material_request_response(m: MaterialRequestModel) -> MaterialRequestResponse:
    def loaded_item_category(item: MaterialRequestItemModel) -> str | None:
        if not _is_rel_loaded(item, "material"):
            return None
        return getattr(item.material, "category", None)

    return MaterialRequestResponse(
        id=str(m.id),
        request_number=m.request_number,
        warehouse_id=m.warehouse_id,
        department=m.department,
        requested_by=m.requested_by,
        status=_normalize_mr_status(m.status),
        priority=getattr(m, "priority", None) or "MEDIUM",
        required_date=m.required_date,
        remarks=m.remarks,
        suggested_supplier=getattr(m, "suggested_supplier", None),
        attachments=getattr(m, "attachments", None) or [],
        approval_history=getattr(m, "approval_history", None) or [],
        items=[
            MaterialRequestItemSchema(
                id=str(it.id),
                material_id=str(it.material_id) if it.material_id else None,
                material_variant_id=str(it.material_variant_id) if it.material_variant_id else None,
                material_code=it.material_code,
                variant_code=it.variant_code,
                material_name=it.material_name,
                category=it.material.category if getattr(it, "material", None) and getattr(it.material, "category", None) else getattr(it, "category", None),
                quantity=it.quantity,
                uom=it.uom,
                is_custom=bool(getattr(it, "is_custom", False)),
                custom_material_name=getattr(it, "custom_material_name", None),
            )
            for it in (m.items or [])
        ],
        created_at=m.created_at,
        updated_at=getattr(m, "updated_at", None),
    )


@router.get("/material-requests", response_model=List[MaterialRequestResponse])
async def list_material_requests(uow: UnitOfWork = Depends(get_uow)):
    stmt = select(MaterialRequestModel).options(
        selectinload(MaterialRequestModel.items).selectinload(MaterialRequestItemModel.material)
    ).order_by(MaterialRequestModel.created_at.desc())
    res = await uow.session.execute(stmt)
    entities = res.scalars().all()
    return [_material_request_response(m) for m in entities]


@router.post("/material-requests", status_code=status.HTTP_201_CREATED)
async def create_material_request(request: CreateMaterialRequest, uow: UnitOfWork = Depends(get_uow)):
    if request.request_number:
        req_no = request.request_number.strip()
        existing_mr_stmt = select(MaterialRequestModel).where(MaterialRequestModel.request_number == req_no)
        existing_mr_res = await uow.session.execute(existing_mr_stmt)
        if existing_mr_res.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Material request with number '{req_no}' already exists."
            )
    else:
        from app.modules.procurement.infrastructure.persistence.repository_impl import SqlAlchemyMaterialRequestRepository
        repo = SqlAlchemyMaterialRequestRepository(uow.session)
        use_case = GetNextMaterialRequestNumberUseCase(repo)
        req_no = await use_case.handle()

    existing_codes_result = await uow.session.execute(
        select(MaterialRequestItemModel.material_code).where(
            MaterialRequestItemModel.material_code.like("MAT-%")
        )
    )
    stock_codes_result = await uow.session.execute(
        select(MaterialStockModel.material_code).where(
            MaterialStockModel.material_code.like("MAT-%")
        )
    )
    existing_codes = list(existing_codes_result.scalars().all()) + list(stock_codes_result.scalars().all())

    def material_sequence(code: str) -> int:
        try:
            return int(code.rsplit("-", 1)[-1])
        except (TypeError, ValueError):
            return 0

    next_material_sequence = max((material_sequence(code) for code in existing_codes), default=0) + 1

    new_mr = MaterialRequestModel(
        id=uuid.uuid4(),
        request_number=req_no,
        warehouse_id=request.warehouse_id.strip(),
        department=request.department.strip(),
        requested_by=request.requested_by.strip(),
        status="Submitted",
        priority=(request.priority or "MEDIUM").strip().upper(),
        required_date=request.required_date,
        suggested_supplier=request.suggested_supplier.strip() if request.suggested_supplier else None,
        attachments=request.attachments or [],
        approval_history=[
            {
                "status": "Submitted",
                "actor": request.requested_by.strip(),
                "comments": "Material request created",
                "timestamp": datetime.now().isoformat(),
            }
        ],
        remarks=request.remarks.strip() if request.remarks else None,
    )

    for it in request.items:
        is_custom = bool(
            it.is_custom
            or it.material_id == "CUSTOM"
            or (not it.material_id and (it.custom_material_name or it.material_name))
        )
        if is_custom:
            custom_name = (it.custom_material_name or it.material_name or "").strip()
            if not custom_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Custom material name is required for custom/new items.",
                )
            new_mr.items.append(MaterialRequestItemModel(
                id=uuid.uuid4(),
                material_id=None,
                material_variant_id=None,
                material_code="CUSTOM",
                variant_code=None,
                material_name=custom_name,
                custom_material_name=custom_name,
                quantity=it.quantity,
                uom=it.uom or "PCS",
                is_custom=True,
            ))
            continue

        mat_uuid = uuid.UUID(it.material_id) if it.material_id and it.material_id != "CUSTOM" else None
        var_uuid = uuid.UUID(it.material_variant_id) if it.material_variant_id else None

        material_obj = None
        variant_obj = None

        # 1. Resolve material if mat_uuid provided
        if mat_uuid:
            mat_stmt = select(MaterialModel).options(selectinload(MaterialModel.variants)).where(MaterialModel.id == mat_uuid)
            mat_res = await uow.session.execute(mat_stmt)
            material_obj = mat_res.scalar_one_or_none()
            if not material_obj:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Material with ID '{mat_uuid}' not found."
                )
            if material_obj.status and material_obj.status.lower() != "active":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Material '{material_obj.material_code}' ({material_obj.material_name}) is Inactive and cannot be requested."
                )

        # 2. Resolve variant if var_uuid provided
        if var_uuid:
            var_stmt = select(MaterialVariantModel).options(selectinload(MaterialVariantModel.material)).where(MaterialVariantModel.id == var_uuid)
            var_res = await uow.session.execute(var_stmt)
            variant_obj = var_res.scalar_one_or_none()
            if not variant_obj:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Material variant with ID '{var_uuid}' not found."
                )
            if variant_obj.status and variant_obj.status.lower() != "active":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Variant '{variant_obj.variant_code}' is Inactive and cannot be requested."
                )

            if material_obj:
                # Cross-check that variant belongs to this material
                if variant_obj.material_id != material_obj.id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Variant '{variant_obj.variant_code}' does not belong to Material '{material_obj.material_code}'."
                    )
            else:
                material_obj = variant_obj.material
                mat_uuid = material_obj.id if material_obj else None
                if material_obj and material_obj.status and material_obj.status.lower() != "active":
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Material '{material_obj.material_code}' is Inactive and cannot be requested."
                    )

        # 3. If material is specified but no variant, pick the first active variant
        if material_obj and not variant_obj:
            active_vars = [v for v in (material_obj.variants or []) if v.status and v.status.lower() == "active"]
            if not active_vars:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Material '{material_obj.material_code}' has no Active variants available."
                )
            variant_obj = active_vars[0]
            var_uuid = variant_obj.id

        material_code = material_obj.material_code if material_obj else (it.material_code or f"MAT-{next_material_sequence:04d}")
        material_name = it.material_name or (material_obj.material_name if material_obj else material_code)
        variant_code = variant_obj.variant_code if variant_obj else (it.variant_code or f"{material_code}-V001")
        uom = it.uom or (variant_obj.uom if variant_obj else (material_obj.base_uom if material_obj else "PCS"))

        new_mr.items.append(MaterialRequestItemModel(
            id=uuid.uuid4(),
            material_id=mat_uuid,
            material_variant_id=var_uuid,
            material_code=material_code,
            variant_code=variant_code,
            material_name=material_name,
            quantity=it.quantity,
            uom=uom,
            is_custom=False,
        ))

    uow.session.add(new_mr)
    try:
        await uow.commit()
    except IntegrityError as ie:
        await uow.session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Material request with number '{req_no}' already exists or a database conflict occurred."
        )

    return {
        "status": "success",
        "request_number": req_no,
        "items": [
            {
                "material_id": str(item.material_id) if item.material_id else None,
                "material_variant_id": str(item.material_variant_id) if item.material_variant_id else None,
                "material_code": item.material_code,
                "variant_code": item.variant_code,
                "material_name": item.material_name
            }
            for item in new_mr.items
        ],
    }


@router.get("/material-requests/{id}", response_model=MaterialRequestResponse)
async def get_material_request(id: str, uow: UnitOfWork = Depends(get_uow)):
    try:
        req_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Material Request UUID")

    stmt = select(MaterialRequestModel).options(
        selectinload(MaterialRequestModel.items).selectinload(MaterialRequestItemModel.material)
    ).where(MaterialRequestModel.id == req_uuid)
    res = await uow.session.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material request not found")
    return _material_request_response(req)


@router.post("/material-requests/{id}/process")
async def process_material_request(id: str, uow: UnitOfWork = Depends(get_uow)):
    try:
        req_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Material Request UUID")

    stmt = select(MaterialRequestModel).where(MaterialRequestModel.id == req_uuid)
    res = await uow.session.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material request not found")

    current_status = _normalize_mr_status(req.status)
    if current_status not in {"Submitted", "Pending Approval"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot process Material Request '{req.request_number}' in '{current_status}' status."
        )

    req.status = "Approved"
    history = list(getattr(req, "approval_history", None) or [])
    history.append({
        "status": "Approved",
        "actor": "Procurement",
        "comments": "Material request approved",
        "timestamp": datetime.now().isoformat(),
    })
    req.approval_history = history
    await uow.commit()
    return {"status": "success"}


@router.put("/material-requests/{id}")
async def update_material_request(id: str, request: CreateMaterialRequest, uow: UnitOfWork = Depends(get_uow)):
    try:
        req_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Material Request UUID")

    stmt = (
        select(MaterialRequestModel)
        .options(
            selectinload(MaterialRequestModel.items).selectinload(MaterialRequestItemModel.material)
        )
        .where(MaterialRequestModel.id == req_uuid)
    )
    res = await uow.session.execute(stmt)
    mr = res.scalar_one_or_none()
    if not mr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material request not found")

    current_status = _normalize_mr_status(mr.status)
    if current_status not in {"Draft", "Submitted", "Rejected"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot edit Material Request '{mr.request_number}' because it is in '{current_status}' status."
        )

    mr.warehouse_id = request.warehouse_id.strip()
    mr.department = request.department.strip()
    mr.requested_by = request.requested_by.strip()
    mr.priority = (request.priority or "MEDIUM").strip().upper()
    mr.required_date = request.required_date
    mr.suggested_supplier = request.suggested_supplier.strip() if request.suggested_supplier else None
    mr.attachments = request.attachments or []
    mr.remarks = request.remarks.strip() if request.remarks else None

    mr.items = []
    for it in request.items:
        mat_uuid = uuid.UUID(it.material_id) if it.material_id and it.material_id != "CUSTOM" else None
        var_uuid = uuid.UUID(it.material_variant_id) if it.material_variant_id else None

        material_obj = None
        variant_obj = None

        if mat_uuid:
            mat_stmt = select(MaterialModel).options(selectinload(MaterialModel.variants)).where(MaterialModel.id == mat_uuid)
            mat_res = await uow.session.execute(mat_stmt)
            material_obj = mat_res.scalar_one_or_none()
            if not material_obj:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Material with ID '{mat_uuid}' not found."
                )
            if material_obj.status and material_obj.status.lower() != "active":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Material '{material_obj.material_code}' ({material_obj.material_name}) is Inactive and cannot be requested."
                )

        if var_uuid:
            var_stmt = select(MaterialVariantModel).options(selectinload(MaterialVariantModel.material)).where(MaterialVariantModel.id == var_uuid)
            var_res = await uow.session.execute(var_stmt)
            variant_obj = var_res.scalar_one_or_none()
            if not variant_obj:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Material variant with ID '{var_uuid}' not found."
                )
            if variant_obj.status and variant_obj.status.lower() != "active":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Variant '{variant_obj.variant_code}' is Inactive and cannot be requested."
                )

            if material_obj:
                if variant_obj.material_id != material_obj.id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Variant '{variant_obj.variant_code}' does not belong to Material '{material_obj.material_code}'."
                    )
            else:
                material_obj = variant_obj.material
                mat_uuid = material_obj.id if material_obj else None
                if material_obj and material_obj.status and material_obj.status.lower() != "active":
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Material '{material_obj.material_code}' is Inactive and cannot be requested."
                    )

        if material_obj and not variant_obj:
            active_vars = [v for v in (material_obj.variants or []) if v.status and v.status.lower() == "active"]
            if not active_vars:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Material '{material_obj.material_code}' has no Active variants available."
                )
            variant_obj = active_vars[0]
            var_uuid = variant_obj.id

        material_code = material_obj.material_code if material_obj else (it.material_code or "MAT-0001")
        material_name = it.material_name or (material_obj.material_name if material_obj else material_code)
        variant_code = variant_obj.variant_code if variant_obj else (it.variant_code or f"{material_code}-V001")
        uom = it.uom or (variant_obj.uom if variant_obj else (material_obj.base_uom if material_obj else "PCS"))

        mr.items.append(MaterialRequestItemModel(
            id=uuid.uuid4(),
            material_id=mat_uuid,
            material_variant_id=var_uuid,
            material_code=material_code,
            variant_code=variant_code,
            material_name=material_name,
            quantity=it.quantity,
            uom=uom
        ))

    try:
        await uow.commit()
    except IntegrityError as ie:
        await uow.session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Database integrity conflict occurred while updating Material Request."
        )
    return {"status": "success"}


@router.post("/material-requests/{id}/items/{item_id}/create-material", response_model=MaterialRequestResponse)
async def create_material_for_material_request_item(
    id: str,
    item_id: str,
    payload: dict = {},
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Warehouse action to create a Material Master record for a custom/new material request line
    and link it to this material request line.
    """
    roles = [r.upper() for r in (user.roles or [])]
    if not any(r in ["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"] for r in roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Warehouse personnel or Admins can create and register new materials.",
        )

    try:
        req_uuid = uuid.UUID(id)
        item_uuid = uuid.UUID(item_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid UUID format")

    stmt = select(MaterialRequestModel).options(selectinload(MaterialRequestModel.items)).where(
        MaterialRequestModel.id == req_uuid
    )
    res = await uow.session.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material Request not found")

    target_item = next((it for it in req.items if it.id == item_uuid), None)
    if not target_item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material Request item not found")

    if not target_item.is_custom and target_item.material_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Item is already associated with Material '{target_item.material_code}'.",
        )

    material_name = (
        payload.get("material_name") or target_item.custom_material_name or target_item.material_name or ""
    ).strip()
    if not material_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Material name is required")

    base_uom = (payload.get("base_uom") or target_item.uom or "PCS").strip().upper()
    category = (payload.get("category") or "Raw Materials").strip()

    # Generate sequential material code using canonical logic
    codes_stmt = select(MaterialModel.material_code)
    codes_res = await uow.session.execute(codes_stmt)
    codes = codes_res.scalars().all()
    max_seq = 0
    import re
    for code in codes:
        if not code:
            continue
        match = re.match(r"^MAT-(\d+)$", code.strip(), re.IGNORECASE)
        if match:
            try:
                seq = int(match.group(1))
                if seq > max_seq:
                    max_seq = seq
            except (ValueError, TypeError):
                pass

    next_mat_code = f"MAT-{(max_seq + 1):03d}"
    next_var_code = f"{next_mat_code}-V001"

    now_time = datetime.now()
    existing_name_stmt = select(MaterialModel).where(func.lower(MaterialModel.material_name) == material_name.lower())
    existing_name_res = await uow.session.execute(existing_name_stmt)
    existing_mat = existing_name_res.scalar_one_or_none()

    if existing_mat:
        new_material = existing_mat
        var_stmt = select(MaterialVariantModel).where(MaterialVariantModel.material_id == new_material.id)
        var_res = await uow.session.execute(var_stmt)
        variants = var_res.scalars().all()
        new_variant = variants[0] if variants else None
        if not new_variant:
            new_variant = MaterialVariantModel(
                id=uuid.uuid4(),
                material_id=new_material.id,
                variant_code=f"{new_material.material_code}-V001",
                uom=new_material.base_uom,
                status="Active",
                created_at=now_time,
                updated_at=now_time,
            )
            uow.session.add(new_variant)
    else:
        new_material = MaterialModel(
            id=uuid.uuid4(),
            material_code=next_mat_code,
            material_name=material_name,
            category=category,
            description=payload.get("description") or f"Created from Material Request {req.request_number}",
            base_uom=base_uom,
            status="Active",
            created_by=user.username or "warehouse",
            updated_by=user.username or "warehouse",
            created_at=now_time,
            updated_at=now_time,
        )
        uow.session.add(new_material)

        new_variant = MaterialVariantModel(
            id=uuid.uuid4(),
            material_id=new_material.id,
            variant_code=next_var_code,
            uom=base_uom,
            status="Active",
            created_at=now_time,
            updated_at=now_time,
        )
        uow.session.add(new_variant)

    target_item.material_id = new_material.id
    target_item.material_variant_id = new_variant.id
    target_item.material_code = new_material.material_code
    target_item.variant_code = new_variant.variant_code
    target_item.material_name = new_material.material_name
    target_item.uom = base_uom
    target_item.is_custom = False

    await uow.commit()

    stmt = select(MaterialRequestModel).options(selectinload(MaterialRequestModel.items)).where(
        MaterialRequestModel.id == req.id
    )
    res = await uow.session.execute(stmt)
    updated_req = res.scalar_one()

    return _material_request_response(updated_req)


@router.post("/material-requests/{id}/status", response_model=MaterialRequestResponse)
async def update_material_request_status(
    id: str,
    request: MaterialRequestStatusRequest,
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        req_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Material Request UUID")

    requested_status = request.status.strip()
    status_lookup = {s.lower(): s for s in MR_ALLOWED_STATUSES}
    canonical_status = status_lookup.get(requested_status.lower())
    if not canonical_status:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported material request status '{request.status}'.",
        )

    stmt = (
        select(MaterialRequestModel)
        .options(
            selectinload(MaterialRequestModel.items).selectinload(MaterialRequestItemModel.material)
        )
        .where(MaterialRequestModel.id == req_uuid)
    )
    res = await uow.session.execute(stmt)
    mr = res.scalar_one_or_none()
    if not mr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material request not found")

    current_status = _normalize_mr_status(mr.status)
    allowed_next = MR_STATUS_TRANSITIONS.get(current_status, set())
    if canonical_status != current_status and canonical_status not in allowed_next:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot move Material Request '{mr.request_number}' from '{current_status}' to '{canonical_status}'.",
        )

    mr.status = canonical_status
    if canonical_status == "Rejected" and request.comments:
        mr.remarks = request.comments.strip()
    history = list(getattr(mr, "approval_history", None) or [])
    history.append({
        "status": canonical_status,
        "actor": (request.actor or "System").strip(),
        "comments": request.comments.strip() if request.comments else None,
        "timestamp": datetime.now().isoformat(),
    })
    mr.approval_history = history
    await uow.commit()
    refreshed_res = await uow.session.execute(stmt)
    refreshed_mr = refreshed_res.scalar_one_or_none()
    return _material_request_response(refreshed_mr or mr)


@router.get("/material-stock", response_model=List[MaterialStockResponse])
async def list_material_stock(uow: UnitOfWork = Depends(get_uow)):
    try:
        stmt = select(MaterialStockModel).order_by(MaterialStockModel.material_code)
        res = await uow.session.execute(stmt)
        entities = res.scalars().all()

        return [
            MaterialStockResponse(
                id=str(s.id),
                material_code=s.material_code,
                material_name=s.material_name,
                category=s.category,
                on_hand=s.on_hand,
                allocated=s.allocated,
                available=s.available,
                uom=s.uom,
                warehouse_id=s.warehouse_id,
                reorder_point=s.reorder_point,
                updated_at=s.updated_at
            )
            for s in entities
        ]
    except Exception as e:
        logger.error(f"Failed to list material stock: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


def _is_rel_loaded(entity, attr_name: str) -> bool:
    try:
        insp = inspect(entity)
        if insp is None:
            return False
        return attr_name not in insp.unloaded
    except Exception:
        return False


def _response_from_entity(
    entity: SupplierModel,
    last_po_number: Optional[str] = None,
    last_po_date: Optional[date] = None,
) -> SupplierResponse:
    """
    Safely maps a Supplier domain object to a SupplierResponse.
    """
    try:
        e_id = str(getattr(entity, 'id', uuid.uuid4()))
        e_name = getattr(entity, 'supplier_name', 'Unknown')
        addr = getattr(entity, 'address', None) if _is_rel_loaded(entity, 'address') else None
        cont = getattr(entity, 'contact', None) if _is_rel_loaded(entity, 'contact') else None
        bank = getattr(entity, 'bank_info', None) if _is_rel_loaded(entity, 'bank_info') else None
        docs = (getattr(entity, 'documents', None) if _is_rel_loaded(entity, 'documents') else []) or []

        return SupplierResponse(
            supplier_id=e_id,
            supplier_code=getattr(entity, 'supplier_code', None),
            supplier_name=e_name,
            registered_company_name=getattr(entity, 'registered_company_name', None),
            vendor_type=getattr(entity, 'vendor_type', None),
            category=getattr(entity, 'category', []) if isinstance(getattr(entity, 'category', None), list) else ([getattr(entity, 'category')] if getattr(entity, 'category', None) else []),
            industry=getattr(entity, 'industry', None),
            gstin=getattr(entity, 'gstin', None),
            main_materials=getattr(entity, 'main_materials', []) if isinstance(getattr(entity, 'main_materials', None), list) else [],
            payment_terms=getattr(entity, 'payment_terms', None),
            credit_period_days=getattr(entity, 'credit_period_days', None),
            rating=getattr(entity, 'rating', None),
            performance_score=getattr(entity, 'performance_score', None),
            last_po_number=last_po_number or getattr(entity, 'last_po_number', None),
            last_po_date=last_po_date or getattr(entity, 'last_po_date', None),
            address=SupplierAddressResponse(
                registered_address=getattr(addr, 'registered_address', None),
                city=getattr(addr, 'city', None),
                country=getattr(addr, 'country', None),
                state=getattr(addr, 'state', None),
                pincode=getattr(addr, 'pincode', None),
            ) if addr else None,
            contact=SupplierContactResponse(
                primary_contact_name=getattr(cont, 'primary_contact_name', None),
                primary_email=getattr(cont, 'primary_email', None),
                secondary_email=getattr(cont, 'secondary_email', None),
                designation=getattr(cont, 'designation', None),
                phone=getattr(cont, 'phone', None),
                website=getattr(cont, 'website', None),
            ) if cont else None,
            bank_info=SupplierBankInfoResponse(
                bank_name=getattr(bank, 'bank_name', None),
                account_number=getattr(bank, 'account_number', None),
                account_holder_name=getattr(bank, 'account_holder_name', None),
                ifsc=getattr(bank, 'ifsc', None),
                branch=getattr(bank, 'branch', None),
                swift_bic=getattr(bank, 'swift_bic', None),
                tds_section=getattr(bank, 'tds_section', None),
            ) if bank else None,
            documents=[
                SupplierDocumentResponse(
                    document_type=getattr(d, 'document_type', None),
                    file_name=getattr(d, 'file_name', None),
                    storage_path=getattr(d, 'storage_path', None),
                    upload_id=getattr(d, 'upload_id', None),
                    file_type=getattr(d, 'file_type', None),
                    file_size=getattr(d, 'file_size', None),
                )
                for d in docs
            ],
            remarks=getattr(entity, 'remarks', None),
            status=getattr(entity, 'status', "Active"),
            created_at=getattr(entity, 'created_at', None),
            created_by=getattr(entity, 'created_by', None),
            updated_at=getattr(entity, 'updated_at', None),
            updated_by=getattr(entity, 'updated_by', None),
        )
    except Exception as exc:
        logger.error(f"Mapping crash for supplier {getattr(entity, 'id', 'unknown')}: {exc}", exc_info=True)
        return SupplierResponse(
            supplier_id=str(getattr(entity, 'id', 'error')),
            supplier_code=getattr(entity, 'supplier_code', None),
            supplier_name=getattr(entity, 'supplier_name', "Mapping Error"),
            created_at=datetime.now()
        )


SUPPLIER_STATUSES = {"Draft", "Pending Approval", "Active", "Suspended", "Blocked"}
REQUIRED_ACTIVE_DOCUMENTS = {"GST_CERTIFICATE", "CANCELLED_CHEQUE"}


def _normalize_document_type(value: str) -> str:
    return str(value or "").strip().upper().replace(" ", "_").replace("-", "_")


def _supplier_activation_gaps(entity: SupplierModel) -> list[str]:
    gaps: list[str] = []
    if not getattr(entity, "registered_company_name", None):
        gaps.append("registered company name")
    if not getattr(entity, "gstin", None):
        gaps.append("GSTIN")
    if not getattr(entity, "category", None):
        gaps.append("supplier category")
    if not getattr(entity, "address", None):
        gaps.append("registered address")
    if not getattr(entity, "contact", None):
        gaps.append("primary contact")
    if not getattr(entity, "bank_info", None):
        gaps.append("bank details")

    docs = getattr(entity, "documents", None) or []
    uploaded_types = {_normalize_document_type(getattr(doc, "document_type", "")) for doc in docs}
    missing_docs = sorted(REQUIRED_ACTIVE_DOCUMENTS - uploaded_types)
    if missing_docs:
        gaps.append(f"required documents: {', '.join(missing_docs)}")
    return gaps


@router.post("/suppliers/documents")
async def upload_supplier_document(
    document_type: str = Form(...),
    file: UploadFile = File(...),
):
    """
    Standard upload endpoint for supplier onboarding documents.
    Saves to media_uploads/suppliers/ and returns metadata for the create_supplier call.
    """
    import shutil
    from pathlib import Path

    upload_dir = Path("media_uploads/suppliers")
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Validate file type (PDF or JPEG only)
    allowed_exts = {".pdf", ".jpeg", ".jpg"}
    allowed_types = {"application/pdf", "image/jpeg", "image/jpg"}
    file_ext = Path(file.filename or "").suffix.lower()
    content_type = (file.content_type or "").lower()

    if file_ext not in allowed_exts and content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF (.pdf) and JPEG (.jpeg, .jpg) files are allowed."
        )

    # Unique file name to prevent collisions
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    dest_path = upload_dir / unique_filename


    try:
        with dest_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Failed to save uploaded document: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}")


    return {
        "document_type": document_type,
        "file_name": file.filename,
        "storage_path": f"/media/suppliers/{unique_filename}",
        "upload_id": str(uuid.uuid4()),
        "file_type": file.content_type,
        "file_size": dest_path.stat().st_size
    }


@router.get("/suppliers/check-existence")
async def check_supplier_existence(
    company_name: Optional[str] = Query(None),
    gstin: Optional[str] = Query(None),
    email: Optional[str] = Query(None),
    phone: Optional[str] = Query(None),
    account_number: Optional[str] = Query(None),
    swift: Optional[str] = Query(None),
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
):
    repo = SqlAlchemySupplierRepository(uow.session)
    results = {}
    if company_name:
        results["company_name"] = await repo.exists_by_company_name(company_name)
    if gstin:
        results["gstin"] = await repo.exists_by_gstin(gstin)
    if email:
        results["email"] = await repo.exists_by_email(email)
    if phone:
        results["phone"] = await repo.exists_by_phone(phone)
    if account_number:
        results["account_number"] = await repo.exists_by_bank_account(account_number)
    if swift:
        results["swift"] = await repo.exists_by_swift(swift)
    return results


@router.post("/suppliers", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    request: CreateSupplierRequest,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> SupplierResponse:
    try:
        repo = SqlAlchemySupplierRepository(uow.session)
        use_case = CreateSupplierUseCase(repo)

        address_cmd = AddressCommand(**request.address.dict()) if request.address else None
        contact_cmd = ContactCommand(**request.contact.dict()) if request.contact else None
        bank_info_cmd = BankInfoCommand(**request.bank_info.dict()) if request.bank_info else None
        doc_cmds = [DocumentCommand(**d.dict()) for d in (request.documents or [])]

        command = CreateSupplierCommand(
            supplier_name=request.supplier_name,
            registered_company_name=request.registered_company_name,
            vendor_type=request.vendor_type,
            category=request.category,
            industry=request.industry,
            gstin=request.gstin,
            main_materials=request.main_materials,
            address=address_cmd,
            contact=contact_cmd,
            bank_info=bank_info_cmd,
            documents=doc_cmds,
            remarks=request.remarks,
            created_by=_user.username,
        )
        supplier_id = await use_case.handle(command)
        entity = await repo.find_by_id(supplier_id)
        if entity:
            entity.payment_terms = request.payment_terms
            entity.credit_period_days = request.credit_period_days
            entity.status = "Pending Approval"
            await repo.save(entity)

            uow.session.add(
                NotificationModel(
                    id=uuid.uuid4(),
                    user_role="PROCUREMENT",
                    title="New Supplier Registered",
                    message=f"Supplier {entity.supplier_name or 'N/A'} registered (Vendor Type: {entity.vendor_type or 'N/A'}).",
                    link=f"/supplier/{supplier_id}",
                    created_at=datetime.now(),
                )
            )
            await uow.commit()
        return _response_from_entity(entity)
    except DomainRuleViolationException as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/suppliers", response_model=List[SupplierResponse])
async def list_suppliers(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    material: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> List[SupplierResponse]:
    try:
        stmt = (
            select(SupplierModel)
            .options(
                joinedload(SupplierModel.address),
                joinedload(SupplierModel.contact),
                joinedload(SupplierModel.bank_info),
                joinedload(SupplierModel.documents),
            )
            .execution_options(populate_existing=True)
        )
        if search:
            search_term = f"%{search}%"
            stmt = stmt.where(
                or_(
                    SupplierModel.supplier_name.ilike(search_term),
                    SupplierModel.supplier_code.ilike(search_term),
                    SupplierModel.registered_company_name.ilike(search_term)
                )
            )
        if category:
            from sqlalchemy import cast, String
            stmt = stmt.where(cast(SupplierModel.category, String).ilike(f"%{category}%"))
        if material:
            from sqlalchemy import cast, String
            stmt = stmt.where(cast(SupplierModel.main_materials, String).ilike(f"%{material}%"))
        if status_filter:
            stmt = stmt.where(func.lower(SupplierModel.status) == status_filter.strip().lower())

        result = await uow.session.execute(stmt.order_by(SupplierModel.supplier_name))
        entities = result.scalars().unique().all()

        # Query latest Purchase Order for each supplier
        po_stmt = (
            select(
                PurchaseOrderModel.supplier_id,
                PurchaseOrderModel.po_number,
                PurchaseOrderModel.po_date,
            )
            .order_by(PurchaseOrderModel.po_date.desc(), PurchaseOrderModel.created_at.desc())
        )
        po_res = await uow.session.execute(po_stmt)
        latest_po_by_supplier = {}
        for supp_id, po_num, po_dt in po_res.all():
            if supp_id and str(supp_id) not in latest_po_by_supplier:
                latest_po_by_supplier[str(supp_id)] = (po_num, po_dt)

        responses = []
        for e in entities:
            try:
                e_id_str = str(getattr(e, "id", ""))
                po_info = latest_po_by_supplier.get(e_id_str)
                last_po_num = po_info[0] if po_info else None
                last_po_dt = po_info[1] if po_info else None
                responses.append(_response_from_entity(e, last_po_number=last_po_num, last_po_date=last_po_dt))
            except Exception as err:
                logger.error(f"Error mapping supplier {getattr(e, 'id', 'unknown')}: {err}")
        return responses
    except Exception as e:
        logger.error(f"Failed to list suppliers: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail=f"Database error in list_suppliers: {str(e)}")


@router.get("/suppliers/{id}", response_model=SupplierResponse)
async def get_supplier(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> SupplierResponse:
    try:
        supplier_id = uuid.UUID(str(id))
        stmt = select(SupplierModel).options(
            selectinload(SupplierModel.address),
            selectinload(SupplierModel.contact),
            selectinload(SupplierModel.bank_info),
            selectinload(SupplierModel.documents),
        ).where(SupplierModel.id == supplier_id)

        result = await uow.session.execute(stmt)
        entity = result.scalar_one_or_none()

        if not entity:
            raise HTTPException(status_code=404, detail="Supplier not found")

        # Query latest Purchase Order for this supplier
        po_latest_stmt = (
            select(PurchaseOrderModel.po_number, PurchaseOrderModel.po_date)
            .where(PurchaseOrderModel.supplier_id == supplier_id)
            .order_by(PurchaseOrderModel.po_date.desc(), PurchaseOrderModel.created_at.desc())
            .limit(1)
        )
        po_latest_res = await uow.session.execute(po_latest_stmt)
        latest_po_row = po_latest_res.one_or_none()
        last_po_num = latest_po_row[0] if latest_po_row else None
        last_po_dt = latest_po_row[1] if latest_po_row else None

        response = _response_from_entity(entity, last_po_number=last_po_num, last_po_date=last_po_dt)
        history_stmt = select(
            func.count(PurchaseOrderModel.id),
            func.coalesce(func.sum(PurchaseOrderModel.total_amount), Decimal("0")),
        ).where(PurchaseOrderModel.supplier_id == supplier_id)
        history_result = await uow.session.execute(history_stmt)
        po_count, purchase_value = history_result.one()
        response.purchase_order_count = int(po_count or 0)
        response.purchase_value = purchase_value or Decimal("0")
        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get supplier {id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error in get_supplier: {str(e)}")


@router.put("/suppliers/{id}", response_model=SupplierResponse)
async def update_supplier(
    id: str,
    request: UpdateSupplierRequest,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> SupplierResponse:
    try:
        supplier_id = uuid.UUID(str(id))
        repo = SqlAlchemySupplierRepository(uow.session)
        use_case = UpdateSupplierUseCase(repo)

        address_cmd = AddressCommand(**request.address.model_dump()) if request.address else None
        contact_cmd = ContactCommand(**request.contact.model_dump()) if request.contact else None
        bank_info_cmd = BankInfoCommand(**request.bank_info.model_dump()) if request.bank_info else None
        doc_cmds = [DocumentCommand(**d.model_dump()) for d in request.documents] if request.documents is not None else None

        command = UpdateSupplierCommand(
            supplier_id=id,
            supplier_name=request.supplier_name,
            registered_company_name=request.registered_company_name,
            vendor_type=request.vendor_type,
            category=request.category,
            industry=request.industry,
            gstin=request.gstin,
            main_materials=request.main_materials,
            address=address_cmd,
            contact=contact_cmd,
            bank_info=bank_info_cmd,
            documents=doc_cmds,
            remarks=request.remarks,
            updated_by=_user.username,
        )
        await use_case.handle(command)
        model = await uow.session.get(SupplierModel, supplier_id)
        if model:
            if request.payment_terms is not None:
                model.payment_terms = request.payment_terms
            if request.credit_period_days is not None:
                model.credit_period_days = request.credit_period_days

            cats = ", ".join(model.category) if isinstance(model.category, list) else (model.category or "N/A")
            uow.session.add(
                NotificationModel(
                    id=uuid.uuid4(),
                    user_role="PROCUREMENT",
                    title="Supplier Master Updated",
                    message=f"Supplier {model.supplier_name or 'N/A'} profile updated (Vendor Type: {model.vendor_type or 'N/A'}, Category: {cats}).",
                    link=f"/supplier/{id}",
                    created_at=datetime.now(),
                )
            )
        await uow.commit()


        stmt = select(SupplierModel).options(
            selectinload(SupplierModel.address),
            selectinload(SupplierModel.contact),
            selectinload(SupplierModel.bank_info),
            selectinload(SupplierModel.documents),
        ).where(SupplierModel.id == supplier_id)
        res = await uow.session.execute(stmt)
        entity = res.scalar_one_or_none()

        return _response_from_entity(entity)
    except Exception as e:
        logger.error(f"Update supplier {id} failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/suppliers/{id}/status", response_model=SupplierResponse)
async def update_supplier_status(
    id: str,
    request: SupplierStatusRequest,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> SupplierResponse:
    try:
        requested_status = request.status.strip()
        status_lookup = {s.lower(): s for s in SUPPLIER_STATUSES}
        canonical_status = status_lookup.get(requested_status.lower())
        if not canonical_status:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unsupported supplier status '{request.status}'.",
            )

        supplier_id = uuid.UUID(str(id))
        stmt = select(SupplierModel).options(
            selectinload(SupplierModel.address),
            selectinload(SupplierModel.contact),
            selectinload(SupplierModel.bank_info),
            selectinload(SupplierModel.documents),
        ).where(SupplierModel.id == supplier_id)
        res = await uow.session.execute(stmt)
        entity = res.scalar_one_or_none()
        if not entity:
            raise HTTPException(status_code=404, detail="Supplier not found")

        if canonical_status == "Active":
            gaps = _supplier_activation_gaps(entity)
            if gaps:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Supplier cannot become Active until these are complete: " + ", ".join(gaps),
                )

        entity.status = canonical_status
        entity.updated_by = _user.username
        if request.remarks:
            entity.remarks = request.remarks

        uow.session.add(
            NotificationModel(
                id=uuid.uuid4(),
                user_role="PROCUREMENT",
                title="Supplier Status Changed",
                message=f"Supplier {entity.supplier_name or 'N/A'} status updated to {canonical_status}.",
                link=f"/supplier/{id}",
                created_at=datetime.now(),
            )
        )
        await uow.commit()
        await uow.session.refresh(entity)
        return _response_from_entity(entity)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update supplier status {id} failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/suppliers/{id}/block", response_model=SupplierResponse)
async def block_supplier(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> SupplierResponse:
    try:
        supplier_id = uuid.UUID(str(id))
        repo = SqlAlchemySupplierRepository(uow.session)
        use_case = BlockSupplierUseCase(repo)
        await use_case.handle(id)
        await uow.commit()

        stmt = select(SupplierModel).options(
            selectinload(SupplierModel.address),
            selectinload(SupplierModel.contact),
            selectinload(SupplierModel.bank_info),
            selectinload(SupplierModel.documents),
        ).where(SupplierModel.id == supplier_id)
        res = await uow.session.execute(stmt)
        entity = res.scalar_one_or_none()

        return _response_from_entity(entity)
    except Exception as e:
        logger.error(f"Block supplier {id} failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/suppliers/{id}/unblock", response_model=SupplierResponse)
async def unblock_supplier(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> SupplierResponse:
    try:
        supplier_id = uuid.UUID(str(id))
        repo = SqlAlchemySupplierRepository(uow.session)
        use_case = UnblockSupplierUseCase(repo)
        await use_case.handle(id)
        await uow.commit()

        stmt = select(SupplierModel).options(
            selectinload(SupplierModel.address),
            selectinload(SupplierModel.contact),
            selectinload(SupplierModel.bank_info),
            selectinload(SupplierModel.documents),
        ).where(SupplierModel.id == supplier_id)
        res = await uow.session.execute(stmt)
        entity = res.scalar_one_or_none()

        return _response_from_entity(entity)
    except Exception as e:
        logger.error(f"Unblock supplier {id} failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))




@router.post("/rfqs", response_model=RfqResponse, status_code=status.HTTP_201_CREATED)
async def create_rfq(
    request: CreateRfqRequest,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(verify_procurement_role),
) -> RfqResponse:
    try:
        if request.material_request_number:
            mr_stmt = select(MaterialRequestModel).where(
                MaterialRequestModel.request_number == request.material_request_number
            )
            mr_res = await uow.session.execute(mr_stmt)
            mr = mr_res.scalar_one_or_none()
            if mr:
                mr_status = _normalize_mr_status(mr.status)
                if mr_status not in ["Approved", "Submitted", "Pending Approval", "Converted to RFQ"]:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Material Request '{request.material_request_number}' must be Active or Approved before RFQ creation.",
                    )

        repo = SqlAlchemyRfqRepository(uow.session)
        use_case = CreateRfqUseCase(repo)
        command = CreateRfqCommand(
            rfq_date=request.rfq_date,
            warehouse=request.warehouse,
            procurement_officer=request.procurement_officer,
            supplier_ids=request.supplier_ids,
            items=[RfqItemCommand(**item.dict()) for item in request.items],
            material_request_number=request.material_request_number,
            required_delivery_date=request.required_delivery_date,
            remarks=request.remarks,
        )
        rfq_id = await use_case.handle(command)
        if request.material_request_number:
            mr_stmt = select(MaterialRequestModel).where(
                MaterialRequestModel.request_number == request.material_request_number
            )
            mr_res = await uow.session.execute(mr_stmt)
            mr = mr_res.scalar_one_or_none()
            if mr:
                mr.status = "Converted to RFQ"
                history = list(getattr(mr, "approval_history", None) or [])
                history.append({
                    "status": "Converted to RFQ",
                    "actor": _user.username,
                    "comments": f"RFQ created from material request {request.material_request_number}",
                    "timestamp": datetime.now().isoformat(),
                })
                mr.approval_history = history
        await uow.commit()

        stmt = select(RfqModel).options(
            selectinload(RfqModel.items),
            selectinload(RfqModel.suppliers).options(
                selectinload(SupplierModel.address),
                selectinload(SupplierModel.contact),
                selectinload(SupplierModel.bank_info),
                selectinload(SupplierModel.documents),
            )
        ).where(RfqModel.id == rfq_id.value)
        res = await uow.session.execute(stmt)
        entity = res.scalar_one_or_none()

        return _to_rfq_response(entity)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create RFQ: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create RFQ: {str(e)}")


@router.post("/rfqs/{id}/send")
async def send_rfq_endpoint(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(verify_procurement_role),
):
    repo = SqlAlchemyRfqRepository(uow.session)

    try:
        rfq = await repo.get_by_id(RfqId.of(id))
        if not rfq:
            raise NotFoundException(f"RFQ not found: {id}")
        if rfq.status == "DRAFT":
            rfq.send()
            await repo.save(rfq)
            await uow.commit()
        elif rfq.status != "OPEN":
            raise HTTPException(status_code=409, detail=f"Cannot send RFQ in status: {rfq.status}")

        delivery_result = await _notify_suppliers_rfq(id)
        sent = delivery_result.get("sent", 0)
        failed = delivery_result.get("failed", 0)
        total = delivery_result.get("total", 0)

        if failed == 0 and sent > 0:
            status_str = "sent"
            msg = f"RFQ published. Supplier email sent successfully to {sent} supplier(s)."
        elif sent > 0 and failed > 0:
            status_str = "partially_sent"
            msg = f"RFQ published. Supplier email partially sent: {sent} succeeded, {failed} failed."
        elif total > 0 and sent == 0:
            status_str = "failed"
            msg = f"RFQ published, but email delivery failed for all {total} supplier(s)."
        else:
            status_str = "sent"
            msg = "RFQ published."

        return {
            "status": status_str,
            "message": msg,
            "delivery": delivery_result,
            "sent": sent,
            "failed": failed,
            "total": total,
        }
    except HTTPException:
        raise
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to send RFQ: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


async def _notify_suppliers_rfq(rfq_id: str):
    """Persist supplier access, then deliver all supplier emails with full logging and tracking."""
    from app.database.session import session_scope
    import random
    import string
    import hashlib
    import os
    import re
    from sqlalchemy import or_
    from app.config.settings import get_settings

    settings = get_settings()
    sender_email = settings.email_host_user or ""

    sent = 0
    failed = 0
    total = 0
    deliveries = []
    async with session_scope() as session:
        clause = RfqModel.rfq_number == str(rfq_id)
        try:
            target_uuid = uuid.UUID(str(rfq_id))
            clause = or_(RfqModel.id == target_uuid, clause)
        except Exception:
            pass

        stmt = (
            select(RfqModel)
            .options(
                selectinload(RfqModel.suppliers).selectinload(SupplierModel.contact),
                selectinload(RfqModel.items)
            )
            .where(clause)
        )
        res = await session.execute(stmt)
        rfq = res.scalar_one_or_none()

        if not rfq:
            logger.error(f"RFQ notify failed: RFQ {rfq_id} not found in database")
            return {"total": 0, "sent": 0, "failed": 1}

        notified_supplier_ids = set()
        notified_emails = set()
        for supplier in rfq.suppliers:
            supplier_key = str(supplier.id)
            if supplier_key in notified_supplier_ids:
                continue
            notified_supplier_ids.add(supplier_key)
            total += 1

            su_stmt = select(SupplierUserModel).where(SupplierUserModel.supplier_id == supplier.id)
            su_res = await session.execute(su_stmt)
            sup_user = su_res.scalar_one_or_none()

            chars = string.ascii_letters + string.digits
            temp_password = "".join(random.choices(chars, k=10))
            password_hash = hashlib.sha256(temp_password.encode()).hexdigest()

            if not sup_user:
                code = supplier.supplier_code or "".join(c for c in (supplier.supplier_name or "supplier") if c.isalnum()).lower()[:10]
                username = f"supplier_{code.lower()}"
                
                existing_user = await session.execute(select(SupplierUserModel).where(SupplierUserModel.username == username))
                if existing_user.scalar_one_or_none():
                    username = f"{username}_{random.randint(100, 999)}"

                sup_user = SupplierUserModel(
                    id=uuid.uuid4(),
                    supplier_id=supplier.id,
                    username=username,
                    password_hash=password_hash,
                    must_change_password=False,
                )
                session.add(sup_user)
            else:
                username = sup_user.username
                sup_user.password_hash = password_hash
                sup_user.must_change_password = False

            raw_email = None
            if supplier.contact and supplier.contact.primary_email:
                raw_email = str(supplier.contact.primary_email).strip()

            if not raw_email:
                sc_stmt = select(SupplierContactModel).where(SupplierContactModel.supplier_id == supplier.id)
                sc_res = await session.execute(sc_stmt)
                sup_contact = sc_res.scalar_one_or_none()
                if sup_contact:
                    raw_email = (sup_contact.primary_email or sup_contact.secondary_email or "").strip()

            email_pattern = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
            email_valid = bool(raw_email and re.match(email_pattern, raw_email))
            email = raw_email.lower() if email_valid else None
            subject = f"Request for Quotation - {rfq.rfq_number}"

            logger.info(
                f"\n--- RFQ SUPPLIER DISPATCH EVALUATION ---\n"
                f"RFQ ID: {rfq.id}\n"
                f"Supplier ID: {supplier.id}\n"
                f"Supplier name: {supplier.supplier_name}\n"
                f"Supplier email: {email or '<INVALID/MISSING>'}\n"
                f"Sender email: {sender_email}\n"
                f"Subject: {subject}\n"
                f"-----------------------------------------"
            )

            if email and email in notified_emails:
                logger.info(
                    f"Skipping duplicate RFQ notification recipient {email} for RFQ {rfq.rfq_number}"
                )
                continue
            if email:
                notified_emails.add(email)
                
                # Generate 24-hour cryptographic one-click short magic access link
                short_code, magic_token = await create_quotation_short_link(
                    session=session,
                    supplier_id=str(supplier.id),
                    username=username,
                    rfq_id=str(rfq.id),
                    email=email,
                    validity_seconds=24 * 3600,
                )
                portal_link = f"http://localhost:8080/q/{short_code}"

                body = (
                    f"Hello {supplier.supplier_name},\n\n"
                    f"Your request has been approved by the manager. You have been invited to submit a commercial quotation for RFQ {rfq.rfq_number}.\n\n"
                    f"Please click the link below to open your quotation portal:\n"
                    f"{portal_link}\n\n"
                    f"Note: This link is valid for 24 hours and will expire automatically for security. No password is required.\n\n"
                    f"Regards,\n"
                    f"KaizenX Procurement Team\n"
                )

                html_body = (
                    f"<!DOCTYPE html>\n"
                    f"<html>\n"
                    f"<head><meta charset='utf-8'></head>\n"
                    f"<body style='font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;background-color:#ffffff;padding:24px 20px;max-width:600px;'>\n"
                    f"  <p style='margin:0 0 16px;font-size:16px;'>Hello <strong>{html.escape(supplier.supplier_name)}</strong>,</p>\n"
                    f"  <p style='margin:0 0 16px;'>Your request has been approved by the manager. You have been invited to submit a commercial quotation for <strong>RFQ {html.escape(rfq.rfq_number)}</strong>.</p>\n"
                    f"  <p style='margin:0 0 12px;'>Please click the link below to open your quotation portal:</p>\n"
                    f"  <p style='margin:16px 0;'>\n"
                    f"    <a href='{html.escape(portal_link, quote=True)}' style='display:inline-block;background-color:#2563eb;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;'>Open Quotation Portal</a>\n"
                    f"  </p>\n"
                    f"  <p style='font-size:13px;color:#475569;margin:16px 0;'>\n"
                    f"    Or click this direct link:<br>\n"
                    f"    <a href='{html.escape(portal_link, quote=True)}' style='color:#2563eb;word-break:break-all;text-decoration:underline;'>{html.escape(portal_link)}</a>\n"
                    f"  </p>\n"
                    f"  <p style='font-size:13px;color:#64748b;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px;'>\n"
                    f"    <em>Note: This link is valid for 24 hours and will expire automatically for security. No password is required.</em>\n"
                    f"  </p>\n"
                    f"  <p style='margin-top:24px;color:#334155;'>\n"
                    f"    Regards,<br>\n"
                    f"    <strong>KaizenX Procurement Team</strong>\n"
                    f"  </p>\n"
                    f"</body>\n"
                    f"</html>"
                )

                os.makedirs(os.path.join("media_uploads", "emails"), exist_ok=True)
                email_path = os.path.join("media_uploads", "emails", f"rfq_{rfq.rfq_number}_{username}.html")
                try:
                    with open(email_path, "w", encoding="utf-8") as ef:
                        ef.write(html_body)
                except Exception as file_err:
                    logger.error(f"Failed to write mock email file: {file_err}")

                deliveries.append((email, subject, body, html_body))
            else:
                logger.warning(
                    f"Cannot send RFQ notification: Supplier {supplier.id} ({supplier.supplier_name}) "
                    f"has no valid primary email configured (raw='{raw_email}')"
                )
                failed += 1

        await session.commit()
        results = await asyncio.gather(
            *(send_email(email, subject, body, html_body) for email, subject, body, html_body in deliveries),
            return_exceptions=True,
        )
        for delivery, result in zip(deliveries, results):
            email = delivery[0]
            if isinstance(result, Exception) or result is not True:
                logger.error(f"Failed to send RFQ notification to {email}: {result}")
                failed += 1
            else:
                logger.info(f"Successfully sent RFQ notification to {email}")
                sent += 1

    return {"total": total, "sent": sent, "failed": failed}


async def _send_email_logged(to_email: str, subject: str, body: str, html_body: str, context: str) -> None:
    """Background delivery boundary: failures are logged without delaying the API response."""
    try:
        delivered = await send_email(to_email, subject, body, html_body)
        if delivered:
            logger.info(f"{context} email delivered to {to_email}")
        else:
            logger.error(f"{context} email skipped because SMTP is not configured")
    except Exception as error:
        logger.error(f"{context} email delivery failed for {to_email}: {error}", exc_info=True)


@router.post("/rfqs/{rfq_id}/select-supplier")
async def select_supplier(rfq_id: str, request: SupplierSelectionRequest, uow: UnitOfWork = Depends(get_uow), _user: CurrentUser = Depends(get_current_user)):
    try:
        rfq_uuid = uuid.UUID(rfq_id)
        supplier_id = request.supplier_id
        supplier_uuid = supplier_id
        selected_quotation_uuid = None
        if request.quotation_id:
            try:
                selected_quotation_uuid = uuid.UUID(str(request.quotation_id))
            except ValueError as exc:
                raise HTTPException(status_code=422, detail="Invalid quotation ID") from exc

        stmt = select(RfqModel).options(selectinload(RfqModel.items)).where(RfqModel.id == rfq_uuid)
        res = await uow.session.execute(stmt)
        rfq = res.scalar_one_or_none()
        if not rfq:
            raise HTTPException(status_code=404, detail="RFQ not found")


        existing_po_result = await uow.session.execute(
            select(PurchaseOrderModel)
            .where(
                PurchaseOrderModel.rfq_id == rfq_uuid,
                PurchaseOrderModel.supplier_id == supplier_uuid,
                PurchaseOrderModel.status != "REJECTED",
            )
            .limit(1)
        )
        existing_po = existing_po_result.scalar_one_or_none()
        if existing_po:
            if selected_quotation_uuid and str(getattr(existing_po, "quotation_id", "")) != str(selected_quotation_uuid):
                quote_res = await uow.session.execute(
                    select(QuotationModel)
                    .options(
                        selectinload(QuotationModel.lines),
                        selectinload(QuotationModel.documents),
                    )
                    .where(
                        QuotationModel.id == selected_quotation_uuid,
                        QuotationModel.rfq_id == rfq_uuid,
                        QuotationModel.supplier_id == supplier_uuid,
                    )
                    .limit(1)
                )
                selected_quote = quote_res.scalar_one_or_none()
                if not selected_quote:
                    raise HTTPException(status_code=404, detail="Selected quotation was not found for this supplier and RFQ")

                subtotal, discount_amount, _tax_rate, tax_amount, freight_charges, total_amount = _calculate_quotation_financials(selected_quote)
                existing_po.quotation_id = selected_quote.id
                existing_po.subtotal = subtotal
                existing_po.discount_amount = discount_amount
                existing_po.tax_amount = tax_amount
                existing_po.freight_charges = freight_charges
                existing_po.total_amount = total_amount
                existing_po.payment_terms = selected_quote.payment_terms
                await uow.commit()

            return {
                "status": "already_saved",
                "po_number": existing_po.po_number,
                "po_id": str(existing_po.id),
            }

        rfq.selected_supplier_id = supplier_uuid
        rfq.selection_reason = request.selection_reason
        rfq.selection_comments = request.selection_comments
        rfq.status = "CLOSED"


        supplier_stmt = select(SupplierModel).options(
            selectinload(SupplierModel.address),
            selectinload(SupplierModel.contact)
        ).where(SupplierModel.id == supplier_uuid)
        s_res = await uow.session.execute(supplier_stmt)
        supplier = s_res.scalar_one_or_none()


        quo_filters = [
            QuotationModel.rfq_id == rfq_uuid,
            QuotationModel.supplier_id == supplier_uuid,
        ]
        if selected_quotation_uuid:
            quo_filters.append(QuotationModel.id == selected_quotation_uuid)

        quo_stmt = select(QuotationModel).options(
            selectinload(QuotationModel.lines),
            selectinload(QuotationModel.documents),
        ).where(
            *quo_filters
        ).order_by(QuotationModel.created_at.desc()).limit(1)
        q_res = await uow.session.execute(quo_stmt)
        quotation = q_res.scalars().first()

        import random

        po_number = f"PROP-{datetime.now().strftime('%Y%m%d')}-{random.randint(1000, 9999)}"


        mr_dept = "Procurement"
        if rfq.material_request_number:
            mr_stmt = select(MaterialRequestModel).where(MaterialRequestModel.request_number == rfq.material_request_number)
            mr_res = await uow.session.execute(mr_stmt)
            mr_obj = mr_res.scalar_one_or_none()
            if mr_obj:
                mr_dept = mr_obj.department

        if selected_quotation_uuid and not quotation:
            raise HTTPException(status_code=404, detail="Selected quotation was not found for this supplier and RFQ")

        subtotal, discount_amount, tax_rate, tax_amount, freight_charges, total_amount = _calculate_quotation_financials(quotation)

        new_po = PurchaseOrderModel(
            id=uuid.uuid4(),
            po_number=po_number,
            rfq_id=rfq.id,
            quotation_id=quotation.id if quotation else None,
            supplier_id=supplier_uuid,
            supplier_name=supplier.supplier_name if supplier else "Unknown",
            supplier_code=supplier.supplier_code if supplier else None,
            supplier_contact_person=supplier.contact.primary_contact_name if supplier and supplier.contact else None,
            supplier_phone=supplier.contact.phone if supplier and supplier.contact else None,
            supplier_email=supplier.contact.primary_email if supplier and supplier.contact else None,
            supplier_gstin=supplier.gstin if supplier else None,
            supplier_address=supplier.address.registered_address if supplier and supplier.address else None,
            billing_address=supplier.address.registered_address if supplier and supplier.address else None,
            warehouse_id=rfq.warehouse,
            delivery_warehouse_name=rfq.warehouse,
            delivery_address="Main Industrial Area, Phase 2, Pune, MH",
            delivery_terms=getattr(quotation, "delivery_time", None) if quotation else None,
            department=mr_dept,
            status="PENDING_FINANCE",
            total_amount=total_amount,
            subtotal=subtotal,
            discount_amount=discount_amount,
            tax_amount=tax_amount,
            freight_charges=freight_charges,
            additional_charges=Decimal("0.0"),
            expected_delivery_date=rfq.required_delivery_date,
            payment_terms=quotation.payment_terms if quotation else None,
            warranty=getattr(quotation, "warranty", None) if quotation else None,
            notes=request.selection_comments,
            attachments=[
                {
                    "document_type": document.document_type,
                    "file_name": document.file_name,
                    "file_url": document.file_url,
                }
                for document in (getattr(quotation, "documents", []) if quotation else [])
            ],
            procurement_officer=rfq.procurement_officer,
            selection_reason=request.selection_reason,
            procurement_comments=request.selection_comments,
            selected_by=_user.username
        )


        new_po.history.append(POApprovalHistoryModel(
            id=uuid.uuid4(),
            status="DRAFT",
            actor_name=_user.username,
            comments="PO draft created from selected quotation"
        ))

        new_po.history.append(POApprovalHistoryModel(
            id=uuid.uuid4(),
            status="PENDING_FINANCE",
            actor_name=_user.username,
            comments="Proposal submitted for Finance Approval"
        ))


        uow.session.add(NotificationModel(
            id=uuid.uuid4(),
            user_role="FINANCE",
            title="New PO Proposal",
            message=f"Purchase Order {po_number} submitted by Procurement for approval.",
            link=f"/finance/approvals/{new_po.id}"
        ))

        for item in rfq.items:
            price = Decimal("0.0")
            if quotation:
                q_line = next((l for l in quotation.lines if l.item_code == item.material_code or (getattr(item, 'variant_code', None) and l.item_code == item.variant_code)), None)
                if q_line:
                    price = q_line.unit_price

            new_po.items.append(PurchaseOrderItemModel(
                id=uuid.uuid4(),
                material_id=item.material_id,
                material_variant_id=item.material_variant_id,
                material_code=item.material_code,
                variant_code=getattr(item, "variant_code", None),
                material_name=item.material_name,
                category=item.category,
                quantity=item.quantity,
                unit_price=price,
                discount=Decimal("0.0"),
                tax=Decimal("0.0"),
                uom=item.uom
            ))

        uow.session.add(new_po)


        if quotation:
            quotation.status = "Selected"

        await uow.commit()
        await uow.session.refresh(new_po)

        logger.info(f"PO {po_number} created and committed successfully.")
        return {"status": "success", "po_number": po_number, "po_id": str(new_po.id)}
    except HTTPException:
        raise
    except ValueError as ve:
        logger.error(f"Invalid UUID in selection: {ve}")
        raise HTTPException(status_code=400, detail="Invalid RFQ or Supplier ID format")
    except Exception as e:
        logger.error(f"Selection finalization failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


def _calculate_quotation_financials(
    quotation: Optional[QuotationModel],
) -> tuple[Decimal, Decimal, Decimal, Decimal, Decimal, Decimal]:
    if not quotation:
        zero = Decimal("0.0")
        return zero, zero, zero, zero, zero, zero

    subtotal = sum((line.quantity * line.unit_price for line in quotation.lines), Decimal("0.0"))
    discount_percentage = Decimal(str(quotation.discount or 0))
    discount_amount = subtotal * discount_percentage / Decimal("100")
    tax_percentage = Decimal(str(quotation.tax or 0))
    taxable_amount = max(subtotal - discount_amount, Decimal("0.0"))
    tax_amount = taxable_amount * tax_percentage / Decimal("100")
    freight_charges = Decimal(str(quotation.freight_charges or 0))
    additional_charges = Decimal(str(getattr(quotation, "additional_charges", 0) or 0))
    total_amount = taxable_amount + tax_amount + freight_charges + additional_charges
    return subtotal, discount_amount, tax_percentage, tax_amount, freight_charges, total_amount

async def _get_purchase_order_quotation(
    session,
    po: PurchaseOrderModel,
) -> Optional[QuotationModel]:
    try:
        state = inspect(po)
        if "quotation" not in state.unloaded and po.quotation:
            return po.quotation
    except Exception:
        pass

    quotation_id = getattr(po, "quotation_id", None)
    if quotation_id:
        res = await session.execute(
            select(QuotationModel)
            .options(
                selectinload(QuotationModel.lines),
                selectinload(QuotationModel.documents),
            )
            .where(QuotationModel.id == quotation_id)
        )
        quotation = res.scalar_one_or_none()
        if quotation:
            return quotation

    if not po.rfq_id or not po.supplier_id:
        return None

    res = await session.execute(
        select(QuotationModel)
        .options(
            selectinload(QuotationModel.lines),
            selectinload(QuotationModel.documents),
        )
        .where(
            QuotationModel.rfq_id == po.rfq_id,
            QuotationModel.supplier_id == po.supplier_id,
        )
        .order_by(QuotationModel.created_at.desc())
        .limit(1)
    )
    return res.scalar_one_or_none()


@router.get("/purchase-orders", response_model=List[PurchaseOrderResponse])
async def list_purchase_orders(
    search: Optional[str] = Query(None),
    supplier_id: Optional[str] = Query(None),
    uow: UnitOfWork = Depends(get_uow)
):
    try:
        stmt = select(PurchaseOrderModel).options(
            selectinload(PurchaseOrderModel.items),
            selectinload(PurchaseOrderModel.history),
            selectinload(PurchaseOrderModel.revisions),
            selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.lines),
            selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.documents),
            selectinload(PurchaseOrderModel.rfq),
        )

        if supplier_id:
            try:
                supp_uuid = uuid.UUID(supplier_id)
                stmt = stmt.where(or_(
                    PurchaseOrderModel.supplier_id == supp_uuid,
                    cast(PurchaseOrderModel.supplier_id, String) == supplier_id,
                ))
            except ValueError:
                stmt = stmt.where(PurchaseOrderModel.supplier_name.ilike(f"%{supplier_id}%"))

        if search:
            search_term = f"%{search}%"
            stmt = stmt.where(
                or_(
                    PurchaseOrderModel.po_number.ilike(search_term),
                    PurchaseOrderModel.supplier_name.ilike(search_term),
                    PurchaseOrderModel.department.ilike(search_term)
                )
            )

        stmt = stmt.order_by(PurchaseOrderModel.created_at.desc())
        res = await uow.session.execute(stmt)
        entities = res.scalars().all()
        logger.info(f"Retrieved {len(entities)} purchase orders from DB")
        responses = []
        for entity in entities:
            quotation = await _get_purchase_order_quotation(uow.session, entity)
            responses.append(_to_po_response(entity, quotation=quotation))
        return responses
    except Exception as e:
        logger.error(f"List POs failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/purchase-orders/{id}/pdf")
async def download_purchase_order_pdf(id: str, uow: UnitOfWork = Depends(get_uow)):
    try:
        po_id = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid purchase order ID")

    result = await uow.session.execute(
        select(PurchaseOrderModel)
        .options(
            selectinload(PurchaseOrderModel.items),
            selectinload(PurchaseOrderModel.history),
            selectinload(PurchaseOrderModel.revisions),
            selectinload(PurchaseOrderModel.rfq),
            selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.lines),
        )
        .where(PurchaseOrderModel.id == po_id)
    )
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase Order not found")

    buffer = BytesIO()
    styles = getSampleStyleSheet()
    app_blue = colors.HexColor("#2563eb")
    app_teal = colors.HexColor("#0d9488")
    app_ink = colors.HexColor("#0f172a")
    app_muted = colors.HexColor("#64748b")
    app_line = colors.HexColor("#dbe5f0")
    app_soft = colors.HexColor("#eff6ff")
    right_style = ParagraphStyle("Right", parent=styles["BodyText"], alignment=TA_RIGHT, fontSize=8, leading=10, textColor=app_ink)
    title_style = ParagraphStyle("PoTitle", parent=styles["Title"], alignment=TA_CENTER, textColor=colors.white, fontSize=20, leading=24, spaceAfter=0)
    subtitle_style = ParagraphStyle("PoSubtitle", parent=styles["BodyText"], alignment=TA_CENTER, textColor=colors.HexColor("#dbeafe"), fontSize=8, leading=11)
    label_style = ParagraphStyle("PoLabel", parent=styles["BodyText"], textColor=app_muted, fontName="Helvetica-Bold", fontSize=7, leading=9)
    value_style = ParagraphStyle("PoValue", parent=styles["BodyText"], textColor=app_ink, fontSize=8, leading=10)
    item_style = ParagraphStyle("PoItem", parent=styles["BodyText"], textColor=app_ink, fontSize=7.2, leading=8.5)
    small_style = ParagraphStyle("PoSmall", parent=styles["BodyText"], textColor=app_muted, fontSize=7, leading=8)
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15 * mm,
        leftMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
        title=f"Purchase Order {po.po_number}",
    )

    def text(value) -> str:
        return str(value) if value not in (None, "") else "-"

    def money(value) -> str:
        return f"INR {Decimal(str(value or 0)):,.2f}"

    quotation = getattr(po, "quotation", None)
    item_subtotal = sum((item.quantity * item.unit_price for item in po.items), Decimal("0.0"))
    if quotation:
        quote_lines = list(getattr(quotation, "lines", []) or [])
        quote_subtotal = sum((line.quantity * line.unit_price for line in quote_lines), Decimal("0.0"))
        calc_subtotal = quote_subtotal if quote_subtotal > 0 else item_subtotal
        calc_discount = Decimal(str(quotation.discount or 0))
        tax_percentage = Decimal(str(quotation.tax or 0))
        taxable_amount = max(calc_subtotal - calc_discount, Decimal("0.0"))
        calculated_tax = taxable_amount * tax_percentage / Decimal("100")
        calc_tax = calculated_tax if calculated_tax > 0 else Decimal(str(po.tax_amount or 0))
        calc_freight = Decimal(str(quotation.freight_charges or 0))
        calculated_total = taxable_amount + calc_tax + calc_freight
        calc_grand_total = Decimal(str(quotation.total_amount or 0)) or calculated_total
    else:
        stored_subtotal = Decimal(str(po.subtotal or 0))
        calc_subtotal = stored_subtotal if stored_subtotal > 0 else item_subtotal
        calc_discount = Decimal(str(po.discount_amount or 0))
        calc_tax = Decimal(str(po.tax_amount or 0))
        calc_freight = Decimal(str(po.freight_charges or 0))
        calc_grand_total = Decimal(str(po.total_amount or 0))
        taxable_amount = max(calc_subtotal - calc_discount, Decimal("0.0"))
        tax_percentage = (
            (calc_tax * Decimal("100") / taxable_amount).quantize(Decimal("0.01"))
            if taxable_amount > 0 and calc_tax > 0
            else Decimal("0.0")
        )
    calc_additional = Decimal(str(po.additional_charges or 0))
    if calc_grand_total <= 0:
        calc_grand_total = max(calc_subtotal - calc_discount, Decimal("0.0")) + calc_tax + calc_freight + calc_additional

    story = [
        Table(
            [
                [Paragraph("PURCHASE ORDER", title_style)],
                [Paragraph(f"KaizenX Procurement | {po.po_number}", subtitle_style)],
            ],
            colWidths=[180 * mm],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), app_blue),
                ("BOX", (0, 0), (-1, -1), 0.8, app_blue),
                ("TOPPADDING", (0, 0), (-1, 0), 10),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
            ]),
        ),
        Spacer(1, 5 * mm),
        Table(
            [
                [Paragraph("PO NUMBER", label_style), Paragraph(text(po.po_number), value_style), Paragraph("DATE", label_style), Paragraph(text(po.po_date), value_style)],
                [Paragraph("STATUS", label_style), Paragraph(text(po.status), value_style), Paragraph("EXPECTED DELIVERY", label_style), Paragraph(text(po.expected_delivery_date), value_style)],
                [Paragraph("SUPPLIER", label_style), Paragraph(text(po.supplier_name), value_style), Paragraph("PAYMENT TERMS", label_style), Paragraph(text(po.payment_terms), value_style)],
                [Paragraph("SUPPLIER ADDRESS", label_style), Paragraph(text(po.supplier_address), value_style), Paragraph("DELIVERY ADDRESS", label_style), Paragraph(text(po.delivery_address), value_style)],
            ],
            colWidths=[28 * mm, 62 * mm, 34 * mm, 56 * mm],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("BACKGROUND", (0, 0), (0, -1), app_soft),
                ("BACKGROUND", (2, 0), (2, -1), app_soft),
                ("GRID", (0, 0), (-1, -1), 0.45, app_line),
                ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#bfdbfe")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]),
        ),
        Spacer(1, 7 * mm),
    ]

    item_rows = [["#", "Material", "Description", "Qty", "UOM", "Unit Price", "Line Total"]]
    for index, item in enumerate(po.items, start=1):
        line_gross = item.quantity * item.unit_price

        item_rows.append([
            str(index),
            Paragraph(text(item.material_code), item_style),
            Paragraph(text(item.material_name), item_style),
            Paragraph(f"{item.quantity:,.2f}", item_style),
            Paragraph(text(item.uom), item_style),
            Paragraph(money(item.unit_price), item_style),
            Paragraph(money(line_gross), item_style),
        ])

    story.append(Table(
        item_rows,
        repeatRows=1,
        colWidths=[8 * mm, 24 * mm, 58 * mm, 18 * mm, 16 * mm, 28 * mm, 28 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), app_ink),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ("GRID", (0, 0), (-1, -1), 0.4, app_line),
            ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#bfdbfe")),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ("ALIGN", (3, 1), (3, -1), "RIGHT"),
            ("ALIGN", (5, 1), (-1, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("FONTSIZE", (0, 0), (-1, 0), 7.5),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]),
    ))


    story.extend([
        Spacer(1, 6 * mm),
        Table(
            [
                ["", Paragraph("ORDER SUMMARY", label_style), ""],
                ["", Paragraph("Subtotal", value_style), Paragraph(money(calc_subtotal), right_style)],
                ["", Paragraph("Discount", value_style), Paragraph(f"- {money(calc_discount)}", right_style)],
                ["", Paragraph(f"GST ({tax_percentage:g}%)", value_style), Paragraph(money(calc_tax), right_style)],
                ["", Paragraph("Freight charges", value_style), Paragraph(money(calc_freight), right_style)],
                ["", Paragraph("Additional charges", value_style), Paragraph(money(calc_additional), right_style)],
                ["", Paragraph("<b>Grand Total</b>", value_style), Paragraph(f"<b>{money(calc_grand_total)}</b>", right_style)],
            ],
            colWidths=[92 * mm, 46 * mm, 42 * mm],
            style=TableStyle([
                ("SPAN", (1, 0), (2, 0)),
                ("BACKGROUND", (1, 0), (2, 0), app_soft),
                ("BACKGROUND", (1, 1), (2, 5), colors.HexColor("#f8fafc")),
                ("BACKGROUND", (1, 6), (2, 6), colors.HexColor("#dbeafe")),
                ("LINEABOVE", (1, 6), (2, 6), 1.0, app_blue),
                ("BOX", (1, 0), (2, 6), 0.8, colors.HexColor("#bfdbfe")),
                ("INNERGRID", (1, 0), (2, 6), 0.35, app_line),
                ("LEFTPADDING", (1, 0), (2, 6), 8),
                ("RIGHTPADDING", (1, 0), (2, 6), 8),
                ("TOPPADDING", (1, 0), (2, 6), 6),
                ("BOTTOMPADDING", (1, 0), (2, 6), 6),
            ]),
        ),
        Spacer(1, 5 * mm),
        Paragraph(
            "This purchase order is generated from backend procurement records. Amounts reflect the approved PO values stored in KaizenX.",
            small_style,
        ),
    ])
    document.build(story)

    filename = f"PO-{po.po_number}.pdf".replace('"', "")
    return Response(
        content=buffer.getvalue(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition"
        },
    )


@router.get("/purchase-orders/by-number/{po_number}", response_model=PurchaseOrderResponse)
async def get_purchase_order_by_number(po_number: str, uow: UnitOfWork = Depends(get_uow)):
    try:
        stmt = select(PurchaseOrderModel).options(
            selectinload(PurchaseOrderModel.items),
            selectinload(PurchaseOrderModel.history),
            selectinload(PurchaseOrderModel.revisions),
            selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.lines),
            selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.documents),
        ).where(PurchaseOrderModel.po_number == po_number)
        res = await uow.session.execute(stmt)
        po = res.scalar_one_or_none()

        if not po:
            raise HTTPException(status_code=404, detail=f"Purchase Order {po_number} not found")

        quotation = await _get_purchase_order_quotation(uow.session, po)
        return _to_po_response(po, quotation=quotation)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch PO by number {po_number}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/purchase-orders/{id}", response_model=PurchaseOrderResponse)
async def get_purchase_order(id: str, uow: UnitOfWork = Depends(get_uow)):
    stmt = select(PurchaseOrderModel).options(
        selectinload(PurchaseOrderModel.items),
        selectinload(PurchaseOrderModel.history),
        selectinload(PurchaseOrderModel.revisions),
        selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.lines),
        selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.documents),
    ).where(PurchaseOrderModel.id == uuid.UUID(id))
    res = await uow.session.execute(stmt)
    po = res.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase Order not found")
    quotation = await _get_purchase_order_quotation(uow.session, po)
    return _to_po_response(po, quotation=quotation)


@router.get("/finance-approvals", response_model=List[PurchaseOrderResponse])
async def list_finance_approvals(uow: UnitOfWork = Depends(get_uow)):
    stmt = select(PurchaseOrderModel).options(
        selectinload(PurchaseOrderModel.items),
        selectinload(PurchaseOrderModel.history),
        selectinload(PurchaseOrderModel.revisions),
        selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.lines),
        selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.documents),
        joinedload(PurchaseOrderModel.rfq)
    ).where(PurchaseOrderModel.status == "PENDING_FINANCE").order_by(PurchaseOrderModel.created_at.desc())
    res = await uow.session.execute(stmt)
    entities = res.scalars().all()
    responses = []
    for entity in entities:
        quotation = await _get_purchase_order_quotation(uow.session, entity)
        responses.append(_to_po_response(entity, quotation=quotation))
    return responses


@router.post("/purchase-orders/{id}/approve")
async def approve_purchase_order(id: str, uow: UnitOfWork = Depends(get_uow), _user: CurrentUser = Depends(get_current_user)):
    roles_upper = {r.upper() for r in (_user.roles or [])}
    if "FINANCE" not in roles_upper and "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Finance role is authorized to approve purchase orders")
    try:
        logger.info(f"Attempting to approve PO ID: {id}")
        stmt = (
            select(PurchaseOrderModel)
            .options(selectinload(PurchaseOrderModel.history))
            .where(PurchaseOrderModel.id == uuid.UUID(id))
        )
        res = await uow.session.execute(stmt)
        po = res.scalar_one_or_none()
        if not po:
            logger.error(f"PO with ID {id} not found")
            raise HTTPException(status_code=404, detail="PO not found")


        year = datetime.now().year

        count_stmt = select(func.count(PurchaseOrderModel.id)).where(
            PurchaseOrderModel.po_number.like(f"PO-{year}-%")
        )
        count_res = await uow.session.execute(count_stmt)
        seq = (count_res.scalar() or 0) + 1
        formal_po_number = f"PO-{year}-{seq:04d}"
        logger.info(f"Generated formal PO number: {formal_po_number}")

        po.status = "APPROVED"
        po.po_number = formal_po_number

        po.history.append(POApprovalHistoryModel(
            id=uuid.uuid4(),
            status="APPROVED",
            actor_name=_user.username or "system",
            comments="Purchase Order approved by Finance"
        ))


        notif = NotificationModel(
            id=uuid.uuid4(),
            user_role="PROCUREMENT",
            title="PO Approved",
            message=f"Purchase Order {formal_po_number} has been approved by Finance.",
            link=f"/purchase-order?poId={po.id}"
        )
        uow.session.add(notif)

        await uow.commit()
        logger.info(f"PO {formal_po_number} committed successfully.")
        return {"status": "success", "po_number": formal_po_number}
    except Exception as e:
        logger.error(f"CRITICAL: Approval failed for PO {id}: {e}", exc_info=True)

        raise HTTPException(status_code=500, detail=f"Approval failed: {str(e)}")


@router.post("/purchase-orders/{id}/reject")
async def reject_purchase_order(id: str, request: dict, uow: UnitOfWork = Depends(get_uow), _user: CurrentUser = Depends(get_current_user)):
    roles_upper = {r.upper() for r in (_user.roles or [])}
    if "FINANCE" not in roles_upper and "ADMIN" not in roles_upper and "SUPERUSER" not in roles_upper:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Finance role is authorized to reject purchase orders")
    try:
        stmt = (
            select(PurchaseOrderModel)
            .options(selectinload(PurchaseOrderModel.history))
            .where(PurchaseOrderModel.id == uuid.UUID(id))
        )
        res = await uow.session.execute(stmt)
        po = res.scalar_one_or_none()
        if not po:
            raise HTTPException(status_code=404, detail="PO not found")

        reason = request.get("reason")
        if not reason:
            raise HTTPException(status_code=400, detail="Rejection reason is mandatory")

        po.status = "REJECTED"
        po.rejection_reason = reason

        po.history.append(POApprovalHistoryModel(
            id=uuid.uuid4(),
            status="REJECTED",
            actor_name=_user.username or "system",
            comments=f"Rejected by Finance: {reason}"
        ))


        uow.session.add(NotificationModel(
            id=uuid.uuid4(),
            user_role="PROCUREMENT",
            title="PO Rejected",
            message=f"Purchase Order {po.po_number} was rejected by Finance. Reason: {reason}",
            link=f"/purchase-order?poId={po.id}"
        ))

        await uow.commit()
        logger.info(f"PO {po.po_number} rejected successfully.")
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Rejection failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Rejection failed: {str(e)}")


@router.post("/purchase-orders/{id}/send-to-supplier")
async def send_po_to_supplier(id: str, background_tasks: BackgroundTasks, uow: UnitOfWork = Depends(get_uow), _user: CurrentUser = Depends(get_current_user)):
    try:
        try:
            po_id = uuid.UUID(id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid purchase order ID")

        stmt = (
            select(PurchaseOrderModel)
            .options(
                selectinload(PurchaseOrderModel.items),
                selectinload(PurchaseOrderModel.history),
                selectinload(PurchaseOrderModel.quotation)
            )
            .where(PurchaseOrderModel.id == po_id)
        )
        res = await uow.session.execute(stmt)
        po = res.scalar_one_or_none()
        if not po:
            raise HTTPException(status_code=404, detail="PO not found")

        if po.status not in {"APPROVED", "SENT"}:
            raise HTTPException(status_code=400, detail="Only approved or previously sent POs can be sent to suppliers")

        is_resend = po.status == "SENT"

        recipient_email = (po.supplier_email or "").strip()
        if not recipient_email:
            raise HTTPException(
                status_code=400,
                detail="Supplier email address is missing. Add an email address before sending the PO.",
            )


        su_stmt = select(SupplierUserModel).where(SupplierUserModel.supplier_id == po.supplier_id)
        su_res = await uow.session.execute(su_stmt)
        sup_user = su_res.scalar_one_or_none()

        if not sup_user:
            username = f"sup_{po.supplier_code.lower().replace('-', '_') if po.supplier_code else str(po.supplier_id)[:8]}"
            sup_user = SupplierUserModel(
                id=uuid.uuid4(),
                supplier_id=po.supplier_id,
                username=username,
                password_hash=hashlib.sha256(secrets.token_hex(16).encode()).hexdigest(),
                must_change_password=False
            )
            uow.session.add(sup_user)
            await uow.session.flush()
        else:
            username = sup_user.username

        # Generate 24-hour cryptographic one-click short magic access link
        short_code, po_magic_token = await create_po_short_link(
            session=uow.session,
            supplier_id=str(po.supplier_id),
            username=username,
            po_id=str(po.id),
            email=recipient_email,
            validity_seconds=24 * 3600,
        )
        portal_link = f"http://localhost:8080/po/{short_code}"

        subject = f"Purchase Order {po.po_number}"

        body = (
            f"Hello {po.supplier_name},\n\n"
            f"Your request has been approved by the manager. Purchase Order {po.po_number} has been officially issued to you.\n\n"
            f"Please click the link below to view your purchase order:\n"
            f"{portal_link}\n\n"
            f"Note: This link is valid for 24 hours and will expire automatically for security. No password is required.\n\n"
            f"Regards,\n"
            f"KaizenX Procurement Team\n"
        )

        html_body = (
            f"<!DOCTYPE html>\n"
            f"<html>\n"
            f"<head><meta charset='utf-8'></head>\n"
            f"<body style='font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;background-color:#ffffff;padding:24px 20px;max-width:600px;'>\n"
            f"  <p style='margin:0 0 16px;font-size:16px;'>Hello <strong>{html.escape(po.supplier_name)}</strong>,</p>\n"
            f"  <p style='margin:0 0 16px;'>Your request has been approved by the manager. Purchase Order <strong>{html.escape(po.po_number)}</strong> has been officially issued to you.</p>\n"
            f"  <p style='margin:0 0 12px;'>Please click the link below to view your purchase order:</p>\n"
            f"  <p style='margin:16px 0;'>\n"
            f"    <a href='{html.escape(portal_link, quote=True)}' style='display:inline-block;background-color:#2563eb;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;'>View Purchase Order</a>\n"
            f"  </p>\n"
            f"  <p style='font-size:13px;color:#475569;margin:16px 0;'>\n"
            f"    Or click this direct link:<br>\n"
            f"    <a href='{html.escape(portal_link, quote=True)}' style='color:#2563eb;word-break:break-all;text-decoration:underline;'>{html.escape(portal_link)}</a>\n"
            f"  </p>\n"
            f"  <p style='font-size:13px;color:#64748b;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px;'>\n"
            f"    <em>Note: This link is valid for 24 hours and will expire automatically for security. No password is required.</em>\n"
            f"  </p>\n"
            f"  <p style='margin-top:24px;color:#334155;'>\n"
            f"    Regards,<br>\n"
            f"    <strong>KaizenX Procurement Team</strong>\n"
            f"  </p>\n"
            f"</body>\n"
            f"</html>"
        )

        os.makedirs(os.path.join("media_uploads", "emails"), exist_ok=True)
        email_path = os.path.join("media_uploads", "emails", f"po_issued_{po.po_number}.html")
        try:
            with open(email_path, "w", encoding="utf-8") as f:
                f.write(html_body)
        except Exception as fe:
            logger.error(f"Failed to write mock PO email: {fe}")

        po.status = "SENT"
        po.history.append(POApprovalHistoryModel(
            id=uuid.uuid4(),
            status="SENT",
            actor_name=_user.username or "system",
            comments=f"Purchase Order {'resent' if is_resend else 'sent'} to supplier at {recipient_email}"
        ))

        await uow.commit()
        background_tasks.add_task(_send_email_logged, recipient_email, subject, body, html_body, f"PO {po.po_number}")
        return {"status": "queued", "message": "Purchase order saved. Email delivery is running in the background.", "recipient": recipient_email, "resent": is_resend}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Send to supplier failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/purchase-orders/{id}/acknowledge")
async def acknowledge_purchase_order(id: str, request: dict | None = None, uow: UnitOfWork = Depends(get_uow), _user: CurrentUser = Depends(get_current_user)):
    try:
        po_id = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid purchase order ID")

    result = await uow.session.execute(
        select(PurchaseOrderModel)
        .options(selectinload(PurchaseOrderModel.history))
        .where(PurchaseOrderModel.id == po_id)
    )
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")

    if po.status not in {"SENT", "ACKNOWLEDGED"}:
        raise HTTPException(status_code=400, detail="Only sent purchase orders can be acknowledged")

    comments = (request or {}).get("comments") or "Supplier acknowledged the purchase order"
    if po.status != "ACKNOWLEDGED":
        po.status = "ACKNOWLEDGED"
        po.history.append(POApprovalHistoryModel(
            id=uuid.uuid4(),
            status="ACKNOWLEDGED",
            actor_name=_user.username or po.supplier_name or "supplier",
            comments=comments,
        ))

        uow.session.add(NotificationModel(
            id=uuid.uuid4(),
            user_role="PROCUREMENT",
            title="PO Acknowledged",
            message=f"Supplier acknowledged Purchase Order {po.po_number}.",
            link=f"/purchase-order?poId={po.id}",
        ))

        await uow.commit()

    return {"status": "success", "po_number": po.po_number}


@router.post("/purchase-orders/{id}/amend", response_model=PurchaseOrderResponse)
async def amend_purchase_order(
    id: str,
    request: PurchaseOrderAmendmentRequest,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
):
    try:
        po_id = uuid.UUID(id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid purchase order ID") from exc

    if not request.reason.strip():
        raise HTTPException(status_code=400, detail="Amendment reason is mandatory")

    result = await uow.session.execute(
        select(PurchaseOrderModel)
        .options(
            selectinload(PurchaseOrderModel.items),
            selectinload(PurchaseOrderModel.history),
            selectinload(PurchaseOrderModel.revisions),
            selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.lines),
            selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.documents),
        )
        .where(PurchaseOrderModel.id == po_id)
    )
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po.status in {"CLOSED", "CANCELLED", "FULLY_RECEIVED"}:
        raise HTTPException(status_code=400, detail="Closed, cancelled, or fully received POs cannot be amended")

    allowed_fields = {
        "expected_delivery_date": "expected_delivery_date",
        "payment_terms": "payment_terms",
        "delivery_terms": "delivery_terms",
        "warranty": "warranty",
        "billing_address": "billing_address",
        "delivery_address": "delivery_address",
        "notes": "notes",
        "freight_charges": "freight_charges",
        "additional_charges": "additional_charges",
        "discount_amount": "discount_amount",
        "tax_amount": "tax_amount",
    }

    actor = _user.username or "system"
    reason = request.reason.strip()
    next_revision = int(getattr(po, "revision_number", None) or 1) + 1
    revisions: list[PORevisionModel] = []

    def stringify(value) -> str | None:
        if value is None:
            return None
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        return str(value)

    def add_revision(field: str, old_value, new_value) -> None:
        revisions.append(PORevisionModel(
            id=uuid.uuid4(),
            purchase_order_id=po.id,
            revision_number=next_revision,
            changed_field=field,
            old_value=stringify(old_value),
            new_value=stringify(new_value),
            changed_by=actor,
            reason=reason,
        ))

    for incoming_field, value in (request.changes or {}).items():
        attr = allowed_fields.get(incoming_field)
        if not attr:
            raise HTTPException(status_code=400, detail=f"Field cannot be amended: {incoming_field}")

        if attr == "expected_delivery_date" and value:
            new_value = datetime.strptime(str(value), "%Y-%m-%d").date()
        elif attr in {"freight_charges", "additional_charges", "discount_amount", "tax_amount"}:
            new_value = Decimal(str(value or 0))
        else:
            new_value = value

        old_value = getattr(po, attr, None)
        if stringify(old_value) != stringify(new_value):
            add_revision(attr, old_value, new_value)
            setattr(po, attr, new_value)

    items_by_code = {item.material_code: item for item in po.items}
    for line_change in request.items:
        item = items_by_code.get(line_change.material_code)
        if not item:
            raise HTTPException(status_code=400, detail=f"PO item not found: {line_change.material_code}")

        for attr in ("quantity", "unit_price", "discount", "tax"):
            new_value = getattr(line_change, attr)
            if new_value is None:
                continue
            old_value = getattr(item, attr)
            if Decimal(str(old_value)) != Decimal(str(new_value)):
                add_revision(f"item.{item.material_code}.{attr}", old_value, new_value)
                setattr(item, attr, Decimal(str(new_value)))

    if not revisions:
        return _to_po_response(po, quotation=await _get_purchase_order_quotation(uow.session, po))

    po.revision_number = next_revision
    po.subtotal = sum((item.quantity * item.unit_price for item in po.items), Decimal("0.0"))
    taxable_amount = max(po.subtotal - Decimal(str(po.discount_amount or 0)), Decimal("0.0"))
    po.total_amount = (
        taxable_amount
        + Decimal(str(po.tax_amount or 0))
        + Decimal(str(po.freight_charges or 0))
        + Decimal(str(po.additional_charges or 0))
    )
    po.updated_at = datetime.now()

    for revision in revisions:
        uow.session.add(revision)

    po.history.append(POApprovalHistoryModel(
        id=uuid.uuid4(),
        status="AMENDED",
        actor_name=actor,
        comments=f"Revision {next_revision}: {reason}",
    ))

    await uow.commit()
    await uow.session.refresh(po)

    refreshed = await uow.session.execute(
        select(PurchaseOrderModel)
        .options(
            selectinload(PurchaseOrderModel.items),
            selectinload(PurchaseOrderModel.history),
            selectinload(PurchaseOrderModel.revisions),
            selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.lines),
            selectinload(PurchaseOrderModel.quotation).selectinload(QuotationModel.documents),
        )
        .where(PurchaseOrderModel.id == po.id)
    )
    saved_po = refreshed.scalar_one()
    return _to_po_response(saved_po, quotation=await _get_purchase_order_quotation(uow.session, saved_po))


@router.post("/purchase-orders/{id}/resubmit")
async def resubmit_purchase_order(id: str, request: dict, uow: UnitOfWork = Depends(get_uow), _user: CurrentUser = Depends(get_current_user)):
    try:
        stmt = (
            select(PurchaseOrderModel)
            .options(selectinload(PurchaseOrderModel.history))
            .where(PurchaseOrderModel.id == uuid.UUID(id))
        )
        res = await uow.session.execute(stmt)
        po = res.scalar_one_or_none()
        if not po:
            raise HTTPException(status_code=404, detail="PO not found")

        if po.status != "REJECTED":
            raise HTTPException(status_code=400, detail="Only rejected POs can be resubmitted")


        if "total_amount" in request:
            po.total_amount = Decimal(str(request["total_amount"]))
        if "expected_delivery_date" in request:
            po.expected_delivery_date = datetime.strptime(request["expected_delivery_date"], '%Y-%m-%d').date()

        po.status = "PENDING_FINANCE"
        po.history.append(POApprovalHistoryModel(
            id=uuid.uuid4(),
            status="RESUBMITTED",
            actor_name=_user.username or "system",
            comments="Modified and resubmitted for approval"
        ))


        uow.session.add(NotificationModel(
            id=uuid.uuid4(),
            user_role="FINANCE",
            title="PO Resubmitted",
            message=f"Purchase Order {po.po_number} has been resubmitted after changes.",
            link=f"/finance/approvals/{po.id}"
        ))

        await uow.commit()
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Resubmit failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Resubmit failed: {str(e)}")


def _to_po_response(
    po: PurchaseOrderModel,
    quotation: Optional[QuotationModel] = None,
) -> PurchaseOrderResponse:

    rfq_number = None
    response_quotation = quotation
    try:
        from sqlalchemy import inspect
        state = inspect(po)
        if state and "rfq" not in state.unloaded:
            if po.rfq:
                rfq_number = po.rfq.rfq_number
        if response_quotation is None and state and "quotation" not in state.unloaded:
            response_quotation = po.quotation
    except Exception as e:
        logger.warning(f"Could not load rfq_number for PO {po.id}: {e}")

    if response_quotation:
        subtotal, discount_amount, tax_percentage, tax_amount, freight_charges, total_amount = _calculate_quotation_financials(response_quotation)
    else:
        subtotal = sum((item.quantity * item.unit_price for item in po.items), Decimal("0.0"))
        discount_amount = Decimal(str(getattr(po, "discount_amount", 0) or 0))
        stored_subtotal = Decimal(str(getattr(po, "subtotal", 0) or 0))
        stored_tax = Decimal(str(getattr(po, "tax_amount", 0) or 0))
        freight_charges = Decimal(str(getattr(po, "freight_charges", 0) or 0))
        if abs(stored_subtotal - subtotal) > Decimal("0.01") and Decimal("0") <= stored_tax <= Decimal("100"):
            taxable_amount = max(subtotal - discount_amount, Decimal("0.0"))
            tax_percentage = stored_tax
            tax_amount = taxable_amount * tax_percentage / Decimal("100")
            total_amount = (
                taxable_amount
                + tax_amount
                + freight_charges
                + Decimal(str(getattr(po, "additional_charges", 0) or 0))
            )
        else:
            tax_amount = stored_tax
            taxable_amount = max(subtotal - discount_amount, Decimal("0.0"))
            tax_percentage = (
                (tax_amount * Decimal("100") / taxable_amount).quantize(Decimal("0.01"))
                if taxable_amount > 0
                else Decimal("0.0")
            )
            total_amount = Decimal(str(po.total_amount or 0))

    return PurchaseOrderResponse(
        id=str(po.id),
        po_number=po.po_number,
        po_date=po.po_date or date.today(),
        status=po.status,
        revision_number=getattr(po, "revision_number", 1) or 1,
        rfq_id=str(po.rfq_id) if po.rfq_id else None,
        rfq_number=rfq_number,
        quotation_id=(
            str(getattr(po, "quotation_id", None))
            if getattr(po, "quotation_id", None)
            else str(response_quotation.id) if response_quotation else None
        ),
        supplier_id=str(po.supplier_id),
        supplier_name=po.supplier_name,
        supplier_code=getattr(po, "supplier_code", None),
        supplier_contact_person=getattr(po, "supplier_contact_person", None),
        supplier_phone=getattr(po, "supplier_phone", None),
        supplier_email=getattr(po, "supplier_email", None),
        supplier_gstin=getattr(po, "supplier_gstin", None),
        supplier_address=getattr(po, "supplier_address", None),
        billing_address=getattr(po, "billing_address", None) or getattr(po, "supplier_address", None),
        warehouse_id=po.warehouse_id,
        delivery_warehouse_name=getattr(po, "delivery_warehouse_name", None),
        delivery_address=getattr(po, "delivery_address", None),
        department=getattr(po, "department", None),
        total_amount=total_amount,
        subtotal=subtotal,
        discount_amount=discount_amount,
        tax_amount=tax_amount,
        tax_percentage=tax_percentage,
        freight_charges=freight_charges,
        additional_charges=getattr(po, "additional_charges", Decimal("0.0")),
        expected_delivery_date=po.expected_delivery_date,
        payment_terms=getattr(po, "payment_terms", None),
        delivery_terms=getattr(po, "delivery_terms", None) or (getattr(response_quotation, "delivery_time", None) if response_quotation else None),
        warranty=getattr(po, "warranty", None) or (getattr(response_quotation, "warranty", None) if response_quotation else None),
        notes=getattr(po, "notes", None) or getattr(po, "procurement_comments", None),
        attachments=(
            getattr(po, "attachments", None)
            or [
                {
                    "document_type": document.document_type,
                    "file_name": document.file_name,
                    "file_url": document.file_url,
                }
                for document in (getattr(response_quotation, "documents", []) if response_quotation else [])
            ]
        ),
        procurement_officer=getattr(po, "procurement_officer", None),
        selection_reason=getattr(po, "selection_reason", None),
        procurement_comments=getattr(po, "procurement_comments", None),
        selected_by=getattr(po, "selected_by", None),
        rejection_reason=getattr(po, "rejection_reason", None),
        quotation=_to_quotation_response(response_quotation) if response_quotation else None,
        items=[
            PurchaseOrderItemSchema(
                material_id=str(it.material_id) if getattr(it, "material_id", None) else None,
                material_variant_id=str(it.material_variant_id) if getattr(it, "material_variant_id", None) else None,
                material_code=it.material_code,
                variant_code=getattr(it, "variant_code", None),
                material_name=it.material_name,
                category=getattr(it, "category", None),
                quantity=it.quantity,
                unit_price=it.unit_price,
                discount=getattr(it, "discount", Decimal("0.0")),
                tax=getattr(it, "tax", Decimal("0.0")),
                uom=it.uom
            )
            for it in po.items
        ],
        history=[
            POApprovalHistorySchema(
                status=h.status,
                actor_name=h.actor_name,
                comments=h.comments,
                created_at=h.created_at
            )
            for h in (po.history or [])
        ],
        revisions=[
            PORevisionSchema(
                revision_number=r.revision_number,
                changed_field=r.changed_field,
                old_value=r.old_value,
                new_value=r.new_value,
                changed_by=r.changed_by,
                changed_at=r.changed_at,
                reason=r.reason,
            )
            for r in sorted((getattr(po, "revisions", None) or []), key=lambda entry: (entry.revision_number, entry.changed_at))
        ],
        created_at=getattr(po, "created_at", None) or datetime.now(),
        updated_at=getattr(po, "updated_at", None) or getattr(po, "created_at", None) or datetime.now()
    )


@router.get("/rfqs", response_model=List[RfqResponse])
async def list_rfqs(
    supplier_id: Optional[str] = Query(None),
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> List[RfqResponse]:
    stmt = select(RfqModel).options(
        selectinload(RfqModel.items),
        selectinload(RfqModel.suppliers).options(
            selectinload(SupplierModel.address),
            selectinload(SupplierModel.contact),
            selectinload(SupplierModel.bank_info),
            selectinload(SupplierModel.documents),
        )
    )
    if supplier_id:
        try:
            supp_uuid = uuid.UUID(supplier_id)
            stmt = stmt.where(RfqModel.suppliers.any(SupplierModel.id == supp_uuid))
        except ValueError:
            pass
    stmt = stmt.order_by(RfqModel.created_at.desc())
    res = await uow.session.execute(stmt)
    entities = res.scalars().all()
    return [_to_rfq_response(e) for e in entities]


@router.get("/rfqs/{id}", response_model=RfqResponse)
async def get_rfq(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> RfqResponse:
    try:
        target_uuid = uuid.UUID(id)
        clause = or_(RfqModel.id == target_uuid, RfqModel.rfq_number == id)
    except ValueError:
        clause = (RfqModel.rfq_number == id)

    stmt = select(RfqModel).options(
        selectinload(RfqModel.items),
        selectinload(RfqModel.suppliers).options(
            selectinload(SupplierModel.address),
            selectinload(SupplierModel.contact),
            selectinload(SupplierModel.bank_info),
            selectinload(SupplierModel.documents),
        )
    ).where(clause)
    res = await uow.session.execute(stmt)
    entity = res.scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="RFQ not found")
    return _to_rfq_response(entity)


@router.put("/rfqs/{id}", response_model=RfqResponse)
async def revise_rfq(
    id: str,
    request: CreateRfqRequest,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> RfqResponse:
    """Revises an existing RFQ details, supplier list, items, or delivery requirements."""
    try:
        rfq_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid RFQ UUID")

    stmt = (
        select(RfqModel)
        .options(
            selectinload(RfqModel.items),
            selectinload(RfqModel.suppliers),
        )
        .where(RfqModel.id == rfq_uuid)
    )
    res = await uow.session.execute(stmt)
    rfq = res.scalar_one_or_none()
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")

    if rfq.status in {"CLOSED", "CANCELLED"}:
        raise HTTPException(status_code=409, detail=f"Cannot revise RFQ in status {rfq.status}")

    if request.warehouse:
        rfq.warehouse = request.warehouse
    if request.procurement_officer:
        rfq.procurement_officer = request.procurement_officer
    if request.required_delivery_date:
        rfq.required_delivery_date = request.required_delivery_date
    if request.closing_date:
        rfq.closing_date = request.closing_date
    if request.remarks:
        rfq.remarks = request.remarks

    if request.supplier_ids is not None:
        sup_uuids = [uuid.UUID(s) for s in request.supplier_ids if s]
        sup_res = await uow.session.execute(select(SupplierModel).where(SupplierModel.id.in_(sup_uuids)))
        rfq.suppliers = list(sup_res.scalars().all())

    if request.items:
        rfq.items = []
        for item in request.items:
            rfq.items.append(
                RfqItemModel(
                    id=uuid.uuid4(),
                    rfq_id=rfq.id,
                    material_code=item.material_code,
                    material_name=item.material_name,
                    category=item.category or "Raw Materials",
                    quantity=item.quantity,
                    uom=item.uom or "PCS",
                )
            )

    await uow.commit()

    refreshed_res = await uow.session.execute(
        select(RfqModel)
        .options(
            selectinload(RfqModel.items),
            selectinload(RfqModel.suppliers).options(
                selectinload(SupplierModel.address),
                selectinload(SupplierModel.contact),
            ),
        )
        .where(RfqModel.id == rfq.id)
    )
    return _to_rfq_response(refreshed_res.scalar_one())


@router.post("/rfqs/{id}/cancel", response_model=RfqResponse)
async def cancel_rfq(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> RfqResponse:
    """Cancels an RFQ and marks its status as CANCELLED."""
    try:
        rfq_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid RFQ UUID")

    stmt = (
        select(RfqModel)
        .options(
            selectinload(RfqModel.items),
            selectinload(RfqModel.suppliers),
        )
        .where(RfqModel.id == rfq_uuid)
    )
    res = await uow.session.execute(stmt)
    rfq = res.scalar_one_or_none()
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")

    rfq.status = "CANCELLED"
    await uow.commit()

    refreshed_res = await uow.session.execute(
        select(RfqModel)
        .options(
            selectinload(RfqModel.items),
            selectinload(RfqModel.suppliers).options(
                selectinload(SupplierModel.address),
                selectinload(SupplierModel.contact),
            ),
        )
        .where(RfqModel.id == rfq.id)
    )
    return _to_rfq_response(refreshed_res.scalar_one())


def _to_rfq_response(rfq) -> RfqResponse:
    items = []
    for item in rfq.items:
        items.append(RfqItemSchema(
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
            special_requirements=getattr(item, "special_requirements", None)
        ))

    suppliers_list = []
    supplier_emails = []

    suppliers = getattr(rfq, "suppliers", [])
    if not suppliers:

        supplier_ids = getattr(rfq, "supplier_ids", [])
        for sid in supplier_ids:
            suppliers_list.append(SupplierResponse(
                supplier_id=str(sid),
                supplier_name="Supplier"
            ))
    else:
        for s in suppliers:
            try:
                s_resp = _response_from_entity(s)
                suppliers_list.append(s_resp)


                if s_resp.contact and s_resp.contact.primary_email:
                    if s_resp.contact.primary_email not in supplier_emails:
                        supplier_emails.append(s_resp.contact.primary_email)
            except Exception as e:
                logger.warning(f"Failed to map supplier {getattr(s, 'id', 'unknown')} in RFQ response: {e}")
                suppliers_list.append(SupplierResponse(
                    supplier_id=str(s.id),
                    supplier_name=getattr(s, "supplier_name", "Unknown")
                ))

    return RfqResponse(
        id=str(rfq.id),
        rfq_number=getattr(rfq, "rfq_number", None),
        rfq_date=getattr(rfq, "rfq_date", None) or date.today(),
        status=getattr(rfq, "status", None),
        material_request_number=getattr(rfq, "material_request_number", None),
        required_delivery_date=getattr(rfq, "required_delivery_date", None),
        warehouse=getattr(rfq, "warehouse", None),
        procurement_officer=getattr(rfq, "procurement_officer", None),
        remarks=getattr(rfq, "remarks", None),
        items=items,
        suppliers=suppliers_list,
        supplier_emails=supplier_emails,
        created_at=getattr(rfq, "created_at", None),
    )




@router.post("/rfqs/{id}/decline", response_model=QuotationResponse)
async def decline_rfq_invitation(
    id: str,
    request: dict,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> QuotationResponse:
    """Allow an invited supplier to decline an RFQ with a required reason."""
    reason = str(request.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A decline reason is required")

    supplier_id = user.raw_claims.get("supplier_id")
    if "SUPPLIER" not in user.roles or not supplier_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only suppliers can decline RFQs")

    try:
        rfq_id = uuid.UUID(id)
        supplier_uuid = uuid.UUID(str(supplier_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid RFQ or supplier ID") from exc

    invitation = await uow.session.execute(
        select(rfq_supplier_link).where(
            rfq_supplier_link.c.rfq_id == rfq_id,
            rfq_supplier_link.c.supplier_id == supplier_uuid,
        )
    )
    if invitation.first() is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This supplier was not invited to the RFQ")

    result = await uow.session.execute(
        select(QuotationModel).options(
            selectinload(QuotationModel.lines),
            selectinload(QuotationModel.documents),
        ).where(
            QuotationModel.rfq_id == rfq_id,
            QuotationModel.supplier_id == supplier_uuid,
        )
    )
    quotation = result.scalars().first()
    if quotation and str(quotation.status).upper() in {"SUBMITTED", "SELECTED"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A submitted quotation cannot be declined")

    decline_note = f"Declined by supplier: {reason}"
    if quotation:
        quotation.status = "Declined"
        quotation.remarks = decline_note
    else:
        quotation = QuotationModel(
            rfq_id=rfq_id,
            supplier_id=supplier_uuid,
            status="Declined",
            total_amount=Decimal("0"),
            remarks=decline_note,
        )
        uow.session.add(quotation)

    await uow.commit()
    saved_result = await uow.session.execute(
        select(QuotationModel).options(
            selectinload(QuotationModel.lines),
            selectinload(QuotationModel.documents),
        ).where(QuotationModel.id == quotation.id)
    )
    return _to_quotation_response(saved_result.scalar_one())


@router.post("/quotations/documents")
async def upload_quotation_document(
    file: UploadFile = File(...),
):
    """
    Upload endpoint for quotation documents.
    """
    import shutil
    from pathlib import Path


    upload_dir = Path("media_uploads/quotations")
    upload_dir.mkdir(parents=True, exist_ok=True)


    file_ext = Path(file.filename).suffix
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    dest_path = upload_dir / unique_filename


    try:
        with dest_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Failed to save quotation document: {e}")
        raise HTTPException(status_code=500, detail="Could not save file")

    return {
        "file_name": file.filename,
        "file_url": f"/media/quotations/{unique_filename}"
    }


@router.post("/quotations", response_model=QuotationResponse, status_code=status.HTTP_201_CREATED)
async def submit_quotation(
    request: SubmitQuotationRequest,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> QuotationResponse:
    try:
        supplier_id = request.supplier_id or _user.raw_claims.get("supplier_id")
        if not supplier_id:
            raise HTTPException(status_code=400, detail="Supplier ID is required for quotation submission")

        repo = SqlAlchemyQuotationRepository(uow.session)
        rfq_repo = SqlAlchemyRfqRepository(uow.session)
        use_case = SubmitQuotationUseCase(repo, rfq_repo)
        command = SubmitQuotationCommand(
            rfq_id=request.rfq_id,
            supplier_id=supplier_id,
            lines=[QuotationLineCommand(**l.dict()) for l in request.lines],
            documents=[QuotationDocumentCommand(**d.dict()) for d in request.documents] if request.documents else [],
            **request.dict(exclude={"lines", "rfq_id", "supplier_id", "documents"})
        )
        q_id = await use_case.handle(command)
        await uow.commit()
        q = await repo.get_by_id(q_id)
        if not q:
            raise HTTPException(status_code=404, detail="Quotation could not be retrieved after save")
        return _to_quotation_response(q)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to submit quotation: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


@router.get("/quotations", response_model=List[QuotationResponse])
async def list_quotations(
    rfq_id: Optional[str] = Query(None),
    supplier_id: Optional[str] = Query(None),
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> List[QuotationResponse]:
    stmt = select(QuotationModel).options(
        selectinload(QuotationModel.lines).selectinload(QuotationLineModel.material),
        selectinload(QuotationModel.documents),
    )
    if rfq_id:
        try:
            rfq_uuid = uuid.UUID(rfq_id)
            stmt = stmt.where(or_(QuotationModel.rfq_id == rfq_uuid, cast(QuotationModel.rfq_id, String) == rfq_id))
        except ValueError:
            stmt = stmt.where(cast(QuotationModel.rfq_id, String) == rfq_id)
    if supplier_id:
        try:
            supp_uuid = uuid.UUID(supplier_id)
            stmt = stmt.where(or_(QuotationModel.supplier_id == supp_uuid, cast(QuotationModel.supplier_id, String) == supplier_id))
        except ValueError:
            stmt = stmt.where(cast(QuotationModel.supplier_id, String) == supplier_id)

    stmt = stmt.order_by(QuotationModel.created_at.desc())
    res = await uow.session.execute(stmt)
    entities = res.scalars().all()

    supplier_ids = list({e.supplier_id for e in entities if e.supplier_id})
    supplier_map = {}
    if supplier_ids:
        sup_res = await uow.session.execute(
            select(SupplierModel)
            .options(
                selectinload(SupplierModel.contact),
                selectinload(SupplierModel.address),
                selectinload(SupplierModel.bank_info),
                selectinload(SupplierModel.documents),
            )
            .where(SupplierModel.id.in_(supplier_ids))
        )
        for sup in sup_res.scalars().all():
            supplier_map[str(sup.id)] = _response_from_entity(sup)

    return [_to_quotation_response(e, supplier_info=supplier_map.get(str(e.supplier_id))) for e in entities]


@router.get("/quotations/{id}", response_model=QuotationResponse)
async def get_quotation(id: str, uow: UnitOfWork = Depends(get_uow)):
    stmt = select(QuotationModel).options(
        selectinload(QuotationModel.lines),
        selectinload(QuotationModel.documents),
    ).where(QuotationModel.id == id)
    res = await uow.session.execute(stmt)
    q = res.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Quotation not found")

    sup_info = None
    if q.supplier_id:
        sup_res = await uow.session.execute(
            select(SupplierModel)
            .options(
                selectinload(SupplierModel.contact),
                selectinload(SupplierModel.address),
                selectinload(SupplierModel.bank_info),
                selectinload(SupplierModel.documents),
            )
            .where(SupplierModel.id == q.supplier_id)
        )
        sup = sup_res.scalar_one_or_none()
        if sup:
            sup_info = _response_from_entity(sup)

    return _to_quotation_response(q, supplier_info=sup_info)


@router.put("/quotations/{id}", response_model=QuotationResponse)
async def update_quotation(id: str, request: dict, uow: UnitOfWork = Depends(get_uow)):
    try:
        q_uuid = uuid.UUID(id)
        stmt = (
            select(QuotationModel)
            .options(
                selectinload(QuotationModel.lines),
                selectinload(QuotationModel.documents)
            )
            .where(QuotationModel.id == q_uuid)
        )
        res = await uow.session.execute(stmt)
        q = res.scalar_one_or_none()
        if not q:
            raise HTTPException(status_code=404, detail="Quotation not found")


        scalar_fields = {
            "status", "discount", "tax", "freight_charges", "additional_charges", "total_amount",
            "delivery_time", "expected_delivery_date", "payment_terms", "mode_of_payment", "warranty", "remarks"
        }
        for field in scalar_fields:
            if field in request:
                val = request[field]

                if field == "expected_delivery_date" and isinstance(val, str):
                    try:
                        val = datetime.strptime(val, "%Y-%m-%d").date()
                    except (ValueError, TypeError):
                        val = None
                setattr(q, field, val)


        if "lines" in request:
            q.lines.clear()
            for line in request["lines"]:
                q.lines.append(QuotationLineModel(
                    id=uuid.uuid4(),
                    quotation_id=q.id,
                    item_code=line.get("item_code") or line.get("itemCode"),
                    quantity=Decimal(str(line.get("quantity", 0))),
                    unit_price=Decimal(str(line.get("unit_price") or line.get("unitPrice") or 0))
                ))


        if "documents" in request:
            q.documents.clear()
            for doc in request["documents"]:
                q.documents.append(QuotationDocumentModel(
                    id=uuid.uuid4(),
                    quotation_id=q.id,
                    document_type=doc.get("document_type") or doc.get("documentType"),
                    file_name=doc.get("file_name") or doc.get("fileName"),
                    file_url=doc.get("file_url") or doc.get("fileUrl")
                ))


        line_total = sum((l.quantity * l.unit_price for l in q.lines), Decimal("0"))
        disc = Decimal(str(q.discount or 0))
        tx = Decimal(str(q.tax or 0))
        fr = Decimal(str(q.freight_charges or 0))
        additional = Decimal(str(q.additional_charges or 0))


        discount_amount = line_total * (disc / Decimal("100")) if disc > 0 else Decimal("0")
        base_amount = max(line_total - discount_amount, Decimal("0"))
        calculated_tax = base_amount * (tx / Decimal("100")) if tx > 0 else Decimal("0")
        q.total_amount = base_amount + calculated_tax + fr + additional

        await uow.commit()
        return _to_quotation_response(q)
    except Exception as e:
        logger.error(f"Update quotation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/quotations/{id}/reject", response_model=QuotationResponse)
async def reject_quotation(
    id: str,
    request: dict,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> QuotationResponse:
    """Reject a supplier quotation and retain the operator's reason."""
    reason = str(request.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A rejection reason is required")

    try:
        quotation_id = uuid.UUID(id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid quotation ID") from exc

    stmt = select(QuotationModel).options(
        selectinload(QuotationModel.lines),
        selectinload(QuotationModel.documents),
    ).where(QuotationModel.id == quotation_id)
    result = await uow.session.execute(stmt)
    quotation = result.scalar_one_or_none()
    if not quotation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    if quotation.status == "Selected":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The selected quotation cannot be rejected")
    if quotation.status == "Rejected":
        return _to_quotation_response(quotation)

    quotation.status = "Rejected"
    audit_note = f"Rejected by {_user.username}: {reason}"
    quotation.remarks = f"{quotation.remarks}\n{audit_note}" if quotation.remarks else audit_note
    await uow.commit()
    return _to_quotation_response(quotation)


def _to_quotation_response(q, supplier_info=None) -> QuotationResponse:
    lines = []
    from sqlalchemy import inspect
    for l in q.lines:
        mat_name = getattr(l, "material_name", None)
        uom_val = getattr(l, "uom", None)
        if not mat_name:
            try:
                mat_inst = l.__dict__.get("material")
                if mat_inst:
                    mat_name = getattr(mat_inst, "material_name", None)
                    uom_val = getattr(mat_inst, "uom", None)
                else:
                    state = inspect(l)
                    if state and "material" not in state.unloaded:
                        mat_obj = getattr(l, "material", None)
                        if mat_obj:
                            mat_name = getattr(mat_obj, "material_name", None)
                            uom_val = getattr(mat_obj, "uom", None)
            except Exception:
                pass

        lines.append(QuotationLineSchema(
            material_id=str(getattr(l, "material_id", None)) if getattr(l, "material_id", None) else None,
            material_variant_id=str(getattr(l, "material_variant_id", None)) if getattr(l, "material_variant_id", None) else None,
            item_code=l.item_code,
            variant_code=getattr(l, "variant_code", None),
            quantity=l.quantity,
            unit_price=l.unit_price,
            material_name=mat_name,
            uom=uom_val
        ))

    documents = [QuotationDocumentSchema(
        document_type=document.document_type,
        file_name=document.file_name,
        file_url=document.file_url,
    ) for document in getattr(q, "documents", [])]

    return QuotationResponse(
        id=str(q.id),
        rfq_id=str(q.rfq_id),
        supplier_id=str(q.supplier_id),
        supplier_info=supplier_info,
        status=q.status,
        lines=lines,
        discount=getattr(q, "discount", Decimal("0")) or Decimal("0"),
        tax=getattr(q, "tax", Decimal("0")) or Decimal("0"),
        freight_charges=getattr(q, "freight_charges", Decimal("0")) or Decimal("0"),
        additional_charges=getattr(q, "additional_charges", Decimal("0")) or Decimal("0"),
        total_amount=getattr(q, "total_amount", Decimal("0")),
        delivery_time=getattr(q, "delivery_time", None),
        expected_delivery_date=getattr(q, "expected_delivery_date", None),
        payment_terms=getattr(q, "payment_terms", None),
        mode_of_payment=getattr(q, "mode_of_payment", None),
        warranty=getattr(q, "warranty", None),
        quotation_validity=getattr(q, "quotation_validity", None),
        remarks=getattr(q, "remarks", None),
        documents=documents,
        created_at=getattr(q, "created_at", None),
    )




def _replacement_response(entity: ReplacementRequestModel) -> ReplacementRequestResponse:
    return ReplacementRequestResponse(
        id=str(entity.id), request_number=entity.request_number, supplier_id=str(entity.supplier_id),
        purchase_order_id=str(entity.purchase_order_id) if entity.purchase_order_id else None,
        original_asn_id=str(entity.original_asn_id) if entity.original_asn_id else None,
        item_code=entity.item_code, item_name=entity.item_name,
        replacement_quantity=entity.replacement_quantity, uom=entity.uom,
        reason=entity.reason, remarks=entity.remarks, request_date=entity.request_date,
        supplier_response_due_at=entity.supplier_response_due_at,
        replacement_dispatch_due_at=entity.replacement_dispatch_due_at,
        status=entity.status, supplier_response_at=entity.supplier_response_at,
        accepted_at=entity.accepted_at, extension_requested_at=entity.extension_requested_at,
        disputed_at=entity.disputed_at, created_at=entity.created_at,
    )


def _authenticated_supplier_id(user: CurrentUser) -> uuid.UUID:
    raw = user.raw_claims.get("supplier_id")
    if not raw or str(raw).lower() == "none" or str(raw).strip() == "":
        return uuid.UUID(int=0)
    try:
        return uuid.UUID(str(raw))
    except ValueError:
        return uuid.UUID(int=0)


@router.get("/supplier/replacement-requests", response_model=List[ReplacementRequestResponse])
async def list_supplier_replacement_requests(
    uow: UnitOfWork = Depends(get_uow), user: CurrentUser = Depends(get_current_user)
):
    supplier_id = _authenticated_supplier_id(user)
    result = await uow.session.execute(select(ReplacementRequestModel).where(ReplacementRequestModel.supplier_id == supplier_id).order_by(ReplacementRequestModel.created_at.desc()))
    return [_replacement_response(item) for item in result.scalars().all()]


@router.get("/supplier/replacement-requests/{request_id}", response_model=ReplacementRequestResponse)
async def get_supplier_replacement_request(request_id: str, uow: UnitOfWork = Depends(get_uow), user: CurrentUser = Depends(get_current_user)):
    supplier_id = _authenticated_supplier_id(user)
    try:
        request_uuid = uuid.UUID(request_id)
    except ValueError:
        request_uuid = None
    stmt = select(ReplacementRequestModel).where(ReplacementRequestModel.supplier_id == supplier_id)
    stmt = stmt.where(ReplacementRequestModel.id == request_uuid if request_uuid else ReplacementRequestModel.request_number == request_id)
    entity = (await uow.session.execute(stmt)).scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Replacement request not found")
    return _replacement_response(entity)


async def _supplier_replacement_action(request_id: str, action: str, uow: UnitOfWork, user: CurrentUser, remarks: Optional[str] = None):
    supplier_id = _authenticated_supplier_id(user)
    try:
        request_uuid = uuid.UUID(request_id)
    except ValueError:
        request_uuid = None
    stmt = select(ReplacementRequestModel).where(ReplacementRequestModel.supplier_id == supplier_id)
    stmt = stmt.where(ReplacementRequestModel.id == request_uuid if request_uuid else ReplacementRequestModel.request_number == request_id)
    entity = (await uow.session.execute(stmt)).scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Replacement request not found")
    now = datetime.now()
    if action == "accept":
        if entity.status not in {"SENT_TO_SUPPLIER", "AWAITING_SUPPLIER"}:
            raise HTTPException(status_code=409, detail="Replacement request is not awaiting supplier acceptance")
        entity.status, entity.accepted_at, entity.supplier_response_at = "SUPPLIER_ACCEPTED", now, now
    elif action == "extension":
        if entity.status not in {"SENT_TO_SUPPLIER", "AWAITING_SUPPLIER", "SUPPLIER_ACCEPTED"}:
            raise HTTPException(status_code=409, detail="Extension cannot be requested in the current status")
        entity.status, entity.extension_requested_at, entity.supplier_response_at = "EXTENSION_REQUESTED", now, now
        entity.remarks = remarks or entity.remarks
    else:
        if entity.status not in {"SENT_TO_SUPPLIER", "AWAITING_SUPPLIER"}:
            raise HTTPException(status_code=409, detail="Request cannot be disputed in the current status")
        entity.status, entity.disputed_at, entity.supplier_response_at = "SUPPLIER_DISPUTED", now, now
        entity.remarks = remarks or entity.remarks
    uow.session.add(NotificationModel(id=uuid.uuid4(), user_role="PROCUREMENT", title="Replacement request updated", message=f"Supplier updated {entity.request_number}: {entity.status}"))
    await uow.commit()
    return _replacement_response(entity)


@router.post("/supplier/replacement-requests/{request_id}/accept", response_model=ReplacementRequestResponse)
async def accept_supplier_replacement_request(request_id: str, uow: UnitOfWork = Depends(get_uow), user: CurrentUser = Depends(get_current_user)):
    return await _supplier_replacement_action(request_id, "accept", uow, user)


@router.post("/supplier/replacement-requests/{request_id}/extension-request", response_model=ReplacementRequestResponse)
async def request_supplier_replacement_extension(request_id: str, request: dict, uow: UnitOfWork = Depends(get_uow), user: CurrentUser = Depends(get_current_user)):
    return await _supplier_replacement_action(request_id, "extension", uow, user, request.get("remarks"))


@router.post("/supplier/replacement-requests/{request_id}/dispute", response_model=ReplacementRequestResponse)
async def dispute_supplier_replacement_request(request_id: str, request: dict, uow: UnitOfWork = Depends(get_uow), user: CurrentUser = Depends(get_current_user)):
    return await _supplier_replacement_action(request_id, "dispute", uow, user, request.get("remarks"))


@router.post("/asns", response_model=AsnResponse, status_code=status.HTTP_201_CREATED)
async def create_asn(
    request: CreateAsnRequest,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
) -> AsnResponse:
    try:
        logger.info(f"Attempting to create ASN {request.asn_number} for PO {request.po_number}")
        repo = SqlAlchemyAsnRepository(uow.session)
        notif_repo = SqlAlchemyArrivalNotificationRepository(uow.session)
        use_case = CreateAsnUseCase(repo, notification_repository=notif_repo)

        supplier_id = _user.raw_claims.get("supplier_id") if "SUPPLIER" in _user.roles else None
        if supplier_id:
            supplier_id = str(supplier_id)

        if request.shipment_type == "REPLACEMENT":
            if not request.replacement_request_id:
                raise HTTPException(status_code=400, detail="Replacement request is required")
            try:
                replacement_uuid = uuid.UUID(request.replacement_request_id)
                supplier_uuid = uuid.UUID(str(supplier_id)) if supplier_id else None
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Invalid replacement request") from exc
            replacement = await uow.session.scalar(select(ReplacementRequestModel).where(ReplacementRequestModel.id == replacement_uuid, ReplacementRequestModel.supplier_id == supplier_uuid))
            if not replacement:
                raise HTTPException(status_code=404, detail="Replacement request not found")
            if replacement.status != "SUPPLIER_ACCEPTED":
                raise HTTPException(status_code=409, detail="Replacement request must be accepted before ASN creation")
            submitted_quantity = sum((line.shipped_quantity for line in request.lines), Decimal("0"))
            if submitted_quantity <= 0 or submitted_quantity > replacement.replacement_quantity:
                raise HTTPException(status_code=422, detail="Replacement quantity exceeds the approved quantity")



        if not supplier_id and request.po_id:
            try:
                supplier_result = await uow.session.execute(
                    select(PurchaseOrderModel.supplier_id).where(
                        PurchaseOrderModel.id == uuid.UUID(request.po_id)
                    )
                )
                linked_supplier_id = supplier_result.scalar_one_or_none()
                supplier_id = str(linked_supplier_id) if linked_supplier_id else None
            except ValueError:
                pass


        expected_arrival = None
        if request.expected_arrival_at:
            try:

                dt = datetime.fromisoformat(request.expected_arrival_at.replace("Z", "+00:00"))
                expected_arrival = dt.replace(tzinfo=None)
            except: pass

        ship_date = None
        if request.shipment_date:
            try:

                ship_date = datetime.fromisoformat(request.shipment_date.split("T")[0]).date()
            except: pass

        command = CreateAsnCommand(
            asn_number=request.asn_number,
            lines=[AsnLineCommand(
                item_code=l.item_code,
                shipped_quantity=l.shipped_quantity,
                material_name=l.material_name,
                uom=l.uom
            ) for l in request.lines],
            po_id=request.po_id,
            po_number=request.po_number,
            vehicle_number=request.vehicle_number,
            expected_arrival_at=expected_arrival,
            shipment_date=ship_date,
            driver_name=request.driver_name,
            driver_contact=request.driver_contact,
            transporter=request.transporter,
            number_of_packages=request.number_of_packages,
            package_type=request.package_type,
            shipping_method=request.shipping_method,
            status=request.status or "SUBMITTED",
            documents=[AsnDocumentCommand(
                document_type=document.document_type,
                file_name=document.file_name,
                file_url=document.file_url,
                uploaded_by=document.uploaded_by,
            ) for document in request.documents],
            supplier_id=supplier_id,
            logistics=request.logistics
        )
        asn_id = await use_case.handle(command)

        if request.shipment_type or request.replacement_request_id:
            created_asn = await uow.session.scalar(select(AsnModel).where(AsnModel.id == asn_id.value))
            if created_asn:
                created_asn.shipment_type = request.shipment_type or "STANDARD"
                if request.replacement_request_id:
                    created_asn.replacement_request_id = uuid.UUID(request.replacement_request_id)
                    replacement = await uow.session.scalar(select(ReplacementRequestModel).where(ReplacementRequestModel.id == created_asn.replacement_request_id))
                    if replacement:
                        created_asn.original_asn_id = replacement.original_asn_id
                        replacement.status = "ASN_CREATED"


        if request.po_id:
            try:
                po_stmt = (
                    select(PurchaseOrderModel)
                    .options(selectinload(PurchaseOrderModel.history))
                    .where(PurchaseOrderModel.id == uuid.UUID(request.po_id))
                )
                po_res = await uow.session.execute(po_stmt)
                po_obj = po_res.scalar_one_or_none()
                if po_obj:
                    po_obj.status = "SHIPPED"


                    po_obj.history.append(POApprovalHistoryModel(
                        id=uuid.uuid4(),
                        status="SHIPPED",
                        actor_name=_user.username or "supplier",
                        comments=f"ASN {request.asn_number} submitted. Shipment is in transit."
                    ))


                    uow.session.add(NotificationModel(
                        id=uuid.uuid4(),
                        user_role="PROCUREMENT",
                        title="Shipment Dispatched",
                        message=(
                            f"Supplier has dispatched a {request.shipment_type or 'STANDARD'} shipment for PO {po_obj.po_number}. "
                            f"ASN: {request.asn_number}. "
                            + (f"Return reason: {request.return_reason}; return method: {request.return_method}; refund within {request.refund_days} days; original ASN: {request.original_asn_number}. " if request.shipment_type == "RETURN" else "")
                            + (f"Replacement reason: {request.replacement_reason}; replacement for ASN: {request.replacement_for_asn}; expected dispatch: {request.replacement_dispatch_date}. " if request.shipment_type == "REPLACEMENT" else "")
                        ),
                        link=f"/procurement/asns/{asn_id.value}"
                    ))
            except Exception as po_err:
                logger.warning(f"Failed to update PO status on ASN submission: {po_err}")


        stmt = select(AsnModel).options(
            selectinload(AsnModel.lines),
            selectinload(AsnModel.documents)
        ).where(AsnModel.id == asn_id.value)
        res = await uow.session.execute(stmt)
        asn = res.scalar_one()
        asn.invoice_number = request.invoice_number
        asn.invoice_date = request.invoice_date
        asn.challan_number = request.challan_number
        asn.challan_date = request.challan_date
        await uow.commit()

        return AsnResponse(
            id=str(asn.id),
            asn_number=asn.asn_number,
            status=asn.status,
            lines=[AsnLineSchema(
                item_code=l.item_code,
                shipped_quantity=l.shipped_quantity,
                material_name=l.material_name,
                uom=l.uom
            ) for l in asn.lines],
            po_id=str(asn.po_id) if asn.po_id else None,
            po_number=asn.po_number,
            vehicle_number=asn.vehicle_number,
            expected_arrival_at=asn.expected_arrival_at,
            shipment_date=asn.shipment_date,
            driver_name=asn.driver_name,
            driver_contact=asn.driver_contact,
            transporter=asn.transporter,
            number_of_packages=asn.number_of_packages,
            package_type=asn.package_type,
            shipping_method=asn.shipping_method,
            invoice_number=asn.invoice_number,
            invoice_date=asn.invoice_date,
            challan_number=asn.challan_number,
            challan_date=asn.challan_date,
            documents=[AsnDocumentSchema(
                document_type=d.document_type,
                file_name=d.file_name,
                file_url=d.file_url,
                uploaded_by=d.uploaded_by,
                uploaded_at=d.uploaded_at
            ) for d in asn.documents],
            created_at=asn.created_at,
            logistics=asn.logistics,
        )
    except Exception as e:
        logger.error(f"ASN Submission failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/asns/next-number")
async def get_next_asn_number(uow: UnitOfWork = Depends(get_uow)):
    repo = SqlAlchemyAsnRepository(uow.session)
    use_case = GetNextAsnNumberUseCase(repo)
    num = await use_case.handle()
    return {"asnNumber": num}


@router.get("/asns", response_model=List[AsnResponse])
async def list_asns(
    supplier_id: Optional[str] = Query(None),
    uow: UnitOfWork = Depends(get_uow)
):
    try:
        asn_supplier = aliased(SupplierModel)
        po_supplier = aliased(SupplierModel)
        resolved_supplier_id = func.coalesce(AsnModel.supplier_id, PurchaseOrderModel.supplier_id)
        stmt = (
            select(
                AsnModel,
                func.coalesce(asn_supplier.supplier_name, po_supplier.supplier_name),
                resolved_supplier_id,
            )
            .outerjoin(asn_supplier, AsnModel.supplier_id == asn_supplier.id)
            .outerjoin(PurchaseOrderModel, cast(PurchaseOrderModel.id, String) == AsnModel.po_id)
            .outerjoin(po_supplier, PurchaseOrderModel.supplier_id == po_supplier.id)
            .options(
                selectinload(AsnModel.lines),
                selectinload(AsnModel.documents)
            )
        )
        if supplier_id:
            try:
                supp_uuid = uuid.UUID(supplier_id)
                stmt = stmt.where(or_(resolved_supplier_id == supp_uuid, cast(resolved_supplier_id, String) == supplier_id))
            except ValueError:
                stmt = stmt.where(cast(resolved_supplier_id, String) == supplier_id)

        res = await uow.session.execute(stmt)
        rows = res.all()

        asn_ids = [asn.id for asn, _, _ in rows]
        warehouse_by_asn = {}
        if asn_ids:
            warehouse_result = await uow.session.execute(
                select(GateEntryModel)
                .where(GateEntryModel.asn_id.in_(asn_ids))
                .order_by(GateEntryModel.updated_at.desc())
            )
            for gate_entry in warehouse_result.scalars().all():
                warehouse_by_asn.setdefault(gate_entry.asn_id, gate_entry)

        responses = []
        for asn, supplier_name, resolved_id in rows:
            try:
                warehouse_entry = warehouse_by_asn.get(asn.id)

                lines = []
                for l in asn.lines:
                    lines.append(AsnLineSchema(
                        item_code=l.item_code,
                        shipped_quantity=l.shipped_quantity,
                        material_name=getattr(l, "material_name", None),
                        uom=getattr(l, "uom", "PCS")
                    ))


                documents = []
                for d in asn.documents:
                    documents.append(AsnDocumentSchema(
                        document_type=d.document_type,
                        file_name=d.file_name,
                        file_url=d.file_url,
                        uploaded_by=d.uploaded_by,
                        uploaded_at=d.uploaded_at
                    ))

                responses.append(AsnResponse(
                    id=str(asn.id),
                    asn_number=asn.asn_number,
                    status=asn.status,
                    lines=lines,
                    po_id=str(asn.po_id) if asn.po_id else None,
                    po_number=asn.po_number,
                    supplier_id=str(resolved_id) if resolved_id else None,
                    supplier_name=supplier_name,
                    vehicle_number=asn.vehicle_number,
                    expected_arrival_at=asn.expected_arrival_at,
                    shipment_date=asn.shipment_date,
                    driver_name=asn.driver_name,
                    driver_contact=asn.driver_contact,
                    transporter=asn.transporter,
                    number_of_packages=asn.number_of_packages,
                    package_type=asn.package_type,
                    shipping_method=asn.shipping_method,
                    invoice_number=asn.invoice_number,
                    invoice_date=asn.invoice_date,
                    challan_number=asn.challan_number,
                    challan_date=asn.challan_date,
                    warehouse_status=warehouse_entry.status if warehouse_entry else None,
                    warehouse_status_updated_at=warehouse_entry.updated_at if warehouse_entry else None,
                    assigned_dock_id=warehouse_entry.assigned_dock_id if warehouse_entry else None,
                    created_at=asn.created_at,
                    documents=documents,
                    logistics=asn.logistics,
                ))
            except Exception as mapping_err:
                logger.error(f"Error mapping ASN {getattr(asn, 'id', 'unknown')}: {mapping_err}")
                continue

        return responses
    except Exception as e:
        logger.error(f"Failed to list ASNs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/asns/{id}", response_model=AsnResponse)
async def get_asn(id: str, uow: UnitOfWork = Depends(get_uow)):
    try:
        asn_supplier = aliased(SupplierModel)
        po_supplier = aliased(SupplierModel)
        resolved_supplier_id = func.coalesce(AsnModel.supplier_id, PurchaseOrderModel.supplier_id)
        stmt = (
            select(
                AsnModel,
                func.coalesce(asn_supplier.supplier_name, po_supplier.supplier_name),
                resolved_supplier_id,
            )
            .outerjoin(asn_supplier, AsnModel.supplier_id == asn_supplier.id)
            .outerjoin(PurchaseOrderModel, cast(PurchaseOrderModel.id, String) == AsnModel.po_id)
            .outerjoin(po_supplier, PurchaseOrderModel.supplier_id == po_supplier.id)
            .options(
                selectinload(AsnModel.lines),
                selectinload(AsnModel.documents)
            )
            .where(AsnModel.id == uuid.UUID(id))
        )
        res = await uow.session.execute(stmt)
        row = res.one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="ASN not found")

        asn, supplier_name, resolved_id = row
        warehouse_result = await uow.session.execute(
            select(GateEntryModel)
            .where(GateEntryModel.asn_id == asn.id)
            .order_by(GateEntryModel.updated_at.desc())
            .limit(1)
        )
        warehouse_entry = warehouse_result.scalar_one_or_none()

        return AsnResponse(
            id=str(asn.id),
            asn_number=asn.asn_number,
            status=asn.status,
            lines=[AsnLineSchema(
                item_code=l.item_code,
                shipped_quantity=l.shipped_quantity,
                material_name=l.material_name,
                uom=l.uom
            ) for l in asn.lines],
            po_id=str(asn.po_id) if asn.po_id else None,
            po_number=asn.po_number,
            supplier_id=str(resolved_id) if resolved_id else None,
            supplier_name=supplier_name,
            vehicle_number=asn.vehicle_number,
            expected_arrival_at=asn.expected_arrival_at,
            shipment_date=asn.shipment_date,
            driver_name=asn.driver_name,
            driver_contact=asn.driver_contact,
            transporter=asn.transporter,
            number_of_packages=asn.number_of_packages,
            package_type=asn.package_type,
            shipping_method=asn.shipping_method,
            invoice_number=asn.invoice_number,
            invoice_date=asn.invoice_date,
            challan_number=asn.challan_number,
            challan_date=asn.challan_date,
            warehouse_status=warehouse_entry.status if warehouse_entry else None,
            warehouse_status_updated_at=warehouse_entry.updated_at if warehouse_entry else None,
            assigned_dock_id=warehouse_entry.assigned_dock_id if warehouse_entry else None,
            documents=[AsnDocumentSchema(
                document_type=d.document_type,
                file_name=d.file_name,
                file_url=d.file_url,
                uploaded_by=d.uploaded_by,
                uploaded_at=d.uploaded_at
            ) for d in asn.documents],
            created_at=asn.created_at,
            logistics=asn.logistics,
        )
    except Exception as e:
        logger.error(f"Get ASN failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/asns/{id}", response_model=AsnResponse)
async def resubmit_asn(
    id: str,
    request: CreateAsnRequest,
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
):
    try:
        asn_id = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ASN ID")

    asn_supplier = aliased(SupplierModel)
    po_supplier = aliased(SupplierModel)
    resolved_supplier_id = func.coalesce(AsnModel.supplier_id, PurchaseOrderModel.supplier_id)
    result = await uow.session.execute(
        select(
            AsnModel,
            func.coalesce(asn_supplier.supplier_name, po_supplier.supplier_name),
            resolved_supplier_id,
        )
        .outerjoin(asn_supplier, AsnModel.supplier_id == asn_supplier.id)
        .outerjoin(PurchaseOrderModel, cast(PurchaseOrderModel.id, String) == AsnModel.po_id)
        .outerjoin(po_supplier, PurchaseOrderModel.supplier_id == po_supplier.id)
        .options(selectinload(AsnModel.lines), selectinload(AsnModel.documents))
        .where(AsnModel.id == asn_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="ASN not found")
    asn, supplier_name, resolved_id = row

    supplier_id = _user.raw_claims.get("supplier_id") if "SUPPLIER" in _user.roles else None
    if supplier_id and resolved_id and str(resolved_id) != str(supplier_id):
        raise HTTPException(status_code=403, detail="You cannot edit another supplier's ASN")
    if asn.status.upper() in {"RECEIVED", "COMPLETED", "CANCELLED"}:
        raise HTTPException(status_code=409, detail=f"ASN cannot be edited while it is {asn.status}")

    try:
        expected_arrival = None
        if request.expected_arrival_at:
            expected_arrival = datetime.fromisoformat(
                request.expected_arrival_at.replace("Z", "+00:00")
            ).replace(tzinfo=None)

        shipment_date = asn.shipment_date
        if request.shipment_date:
            shipment_date = datetime.fromisoformat(request.shipment_date.split("T")[0]).date()

        asn.vehicle_number = request.vehicle_number
        asn.expected_arrival_at = expected_arrival
        asn.shipment_date = shipment_date
        asn.driver_name = request.driver_name
        asn.driver_contact = request.driver_contact
        asn.transporter = request.transporter
        asn.number_of_packages = request.number_of_packages
        asn.package_type = request.package_type
        asn.shipping_method = request.shipping_method
        if request.logistics is not None:
            asn.logistics = request.logistics
        asn.invoice_number = request.invoice_number
        asn.invoice_date = request.invoice_date
        asn.challan_number = request.challan_number
        asn.challan_date = request.challan_date
        asn.status = "DISPATCHED"


        notification = NotificationModel(
            id=uuid.uuid4(),
            user_role="PROCUREMENT",
            title="ASN Corrected",
            message=f"Supplier {supplier_name or 'N/A'} has updated ASN {asn.asn_number} (PO: {asn.po_number}).",
            link=f"/procurement/asns/{asn.id}",
        )
        uow.session.add(notification)

        asn.lines.clear()
        asn.lines.extend([
            AsnLineModel(
                id=uuid.uuid4(),
                item_code=line.item_code,
                shipped_quantity=line.shipped_quantity,
                material_name=line.material_name,
                uom=line.uom,
            )
            for line in request.lines
        ])

        asn.documents.clear()
        asn.documents.extend([
            AsnDocumentModel(
                id=uuid.uuid4(),
                document_type=document.document_type,
                file_name=document.file_name,
                file_url=document.file_url,
                uploaded_by=document.uploaded_by,
                uploaded_at=document.uploaded_at or datetime.now(),
            )
            for document in request.documents
        ])

        notification_result = await uow.session.execute(
            select(ArrivalNotificationModel).where(ArrivalNotificationModel.asn_id == asn_id)
        )
        arrival_notification = notification_result.scalar_one_or_none()
        if arrival_notification:
            arrival_notification.vehicle_number = request.vehicle_number or ""
            if expected_arrival:
                arrival_notification.expected_arrival_time = expected_arrival
            arrival_notification.driver_phone = request.driver_contact
            arrival_notification.updated_at = datetime.now()

        await uow.commit()
        await uow.session.refresh(asn, attribute_names=["lines", "documents"])
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"ASN re-submission failed for {id}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

    return AsnResponse(
        id=str(asn.id),
        asn_number=asn.asn_number,
        status=asn.status,
        lines=[AsnLineSchema(
            item_code=line.item_code,
            shipped_quantity=line.shipped_quantity,
            material_name=line.material_name,
            uom=line.uom,
        ) for line in asn.lines],
        po_id=str(asn.po_id) if asn.po_id else None,
        po_number=asn.po_number,
        supplier_id=str(resolved_id) if resolved_id else None,
        supplier_name=supplier_name,
        vehicle_number=asn.vehicle_number,
        expected_arrival_at=asn.expected_arrival_at,
        shipment_date=asn.shipment_date,
        driver_name=asn.driver_name,
        driver_contact=asn.driver_contact,
        transporter=asn.transporter,
        number_of_packages=asn.number_of_packages,
        package_type=asn.package_type,
        shipping_method=asn.shipping_method,
        invoice_number=asn.invoice_number,
        invoice_date=asn.invoice_date,
        challan_number=asn.challan_number,
        challan_date=asn.challan_date,
        documents=[AsnDocumentSchema(
            document_type=document.document_type,
            file_name=document.file_name,
            file_url=document.file_url,
            uploaded_by=document.uploaded_by,
            uploaded_at=document.uploaded_at,
        ) for document in asn.documents],
        created_at=asn.created_at,
        logistics=asn.logistics,
    )


@router.get("/arrival-notifications", response_model=List[ArrivalNotificationResponse])
async def list_arrival_notifications(uow: UnitOfWork = Depends(get_uow)):
    repo = SqlAlchemyArrivalNotificationRepository(uow.session)
    notifications = await repo.list_all()
    po_ids = []
    po_numbers = {str(notification.po_number) for notification in notifications if notification.po_number}
    for notification in notifications:
        if notification.po_id:
            try:
                po_ids.append(uuid.UUID(str(notification.po_id)))
            except (ValueError, TypeError):
                pass
    supplier_by_po_id = {}
    supplier_by_po_number = {}
    if po_ids or po_numbers:
        supplier_result = await uow.session.execute(
            select(PurchaseOrderModel.id, PurchaseOrderModel.po_number, PurchaseOrderModel.supplier_name).where(
                or_(PurchaseOrderModel.id.in_(po_ids), PurchaseOrderModel.po_number.in_(po_numbers))
            )
        )
        for po_id, po_number, supplier_name in supplier_result.all():
            if supplier_name:
                supplier_by_po_id[str(po_id)] = supplier_name
                supplier_by_po_number[str(po_number)] = supplier_name
    return [
        ArrivalNotificationResponse(
            id=n.id,
            asn_id=n.asn_id,
            asn_number=n.asn_number,
            po_id=n.po_id,
            po_number=n.po_number,
            warehouse_id=n.warehouse_id,
            supplier_name=supplier_by_po_id.get(
                str(n.po_id), supplier_by_po_number.get(str(n.po_number), n.supplier_name)
            ),
            vehicle_number=n.vehicle_number,
            expected_arrival_time=n.expected_arrival_time,
            driver_phone=n.driver_phone,
            message=n.message,
            status=n.status if isinstance(n.status, str) else n.status.value,
            created_at=n.created_at,
        )
        for n in notifications
    ]




@router.get("/notifications", response_model=List[NotificationResponse])
async def list_notifications(role: str = Query(...), uow: UnitOfWork = Depends(get_uow)):
    normalized_role = role.strip().upper()
    if normalized_role in ("GRN", "RECEIVING"):
        roles_to_match = ["GRN", "RECEIVING", "WAREHOUSE", "STORE_MANAGER"]
    elif normalized_role == "WAREHOUSE":
        roles_to_match = ["WAREHOUSE", "GRN", "RECEIVING", "STORE_MANAGER", "QUALITY_INSPECTOR"]
    elif normalized_role in ("DISPATCH", "DISPATCH_MANAGER"):
        roles_to_match = ["DISPATCH", "DISPATCH_MANAGER"]
    elif normalized_role == "STORE_MANAGER":
        roles_to_match = ["STORE_MANAGER", "WAREHOUSE", "GRN", "RECEIVING"]
    elif normalized_role == "QUALITY_INSPECTOR":
        roles_to_match = ["QUALITY_INSPECTOR", "WAREHOUSE", "GRN"]
    else:
        roles_to_match = [normalized_role]

    stmt = select(NotificationModel).where(NotificationModel.user_role.in_(roles_to_match)).order_by(NotificationModel.created_at.desc())
    res = await uow.session.execute(stmt)
    notifications = res.scalars().all()
    return [
        NotificationResponse(
            id=str(n.id),
            user_role=n.user_role,
            title=n.title,
            message=n.message,
            link=n.link,
            is_read=n.is_read,
            created_at=n.created_at,
        )
        for n in notifications
    ]



@router.post("/notifications/{id}/read")
async def mark_notification_read(id: str, uow: UnitOfWork = Depends(get_uow)):
    stmt = select(NotificationModel).where(NotificationModel.id == uuid.UUID(id))
    res = await uow.session.execute(stmt)
    n = res.scalar_one_or_none()
    if n:
        n.is_read = True
    await uow.commit()
    return {"status": "success"}


@router.post("/notifications/read-all")
async def mark_all_notifications_read(role: str = Query(...), uow: UnitOfWork = Depends(get_uow)):
    normalized_role = role.strip().upper()
    if normalized_role in ("GRN", "RECEIVING"):
        roles_to_match = ["GRN", "RECEIVING", "WAREHOUSE", "STORE_MANAGER"]
    elif normalized_role == "WAREHOUSE":
        roles_to_match = ["WAREHOUSE", "GRN", "RECEIVING", "STORE_MANAGER", "QUALITY_INSPECTOR"]
    else:
        roles_to_match = [normalized_role]

    result = await uow.session.execute(
        update(NotificationModel)
        .where(NotificationModel.user_role.in_(roles_to_match), NotificationModel.is_read.is_(False))
        .values(is_read=True)
    )
    await uow.commit()
    return {"status": "success", "updated": result.rowcount or 0}


@router.post("/arrival-notifications/{notification_id}/read")
async def mark_arrival_notification_read(notification_id: str, uow: UnitOfWork = Depends(get_uow)):
    result = await uow.session.execute(
        update(ArrivalNotificationModel)
        .where(ArrivalNotificationModel.id == notification_id)
        .values(status="ACKNOWLEDGED", updated_at=datetime.now())
    )
    await uow.commit()
    if not result.rowcount:
        raise HTTPException(status_code=404, detail="Arrival notification not found")
    return {"status": "success"}


@router.post("/arrival-notifications/read-all")
async def mark_all_arrival_notifications_read(uow: UnitOfWork = Depends(get_uow)):
    result = await uow.session.execute(
        update(ArrivalNotificationModel)
        .where(ArrivalNotificationModel.status != "ACKNOWLEDGED")
        .values(status="ACKNOWLEDGED", updated_at=datetime.now())
    )
    await uow.commit()
    return {"status": "success", "updated": result.rowcount or 0}




@router.post("/auth/supplier-login", response_model=SupplierLoginResponse)
async def supplier_login(
    request: SupplierLoginRequest,
    uow: UnitOfWork = Depends(get_uow),
) -> SupplierLoginResponse:
    import hashlib
    password_hash = hashlib.sha256(request.password.encode()).hexdigest()
    stmt = select(SupplierUserModel).where(
        SupplierUserModel.username == request.username,
        SupplierUserModel.password_hash == password_hash
    )
    result = await uow.session.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid supplier username or password"
        )
    return SupplierLoginResponse(
        token=f"supplier-mock-token-{user.id}-{user.supplier_id}",
        supplier_id=str(user.supplier_id),
        must_change_password=user.must_change_password,
        username=user.username,
    )


@router.post("/auth/magic-login", response_model=MagicLoginResponse)
async def magic_login(
    request: MagicLoginRequest,
    uow: UnitOfWork = Depends(get_uow),
) -> MagicLoginResponse:
    valid, payload, error_message = await resolve_magic_token_or_code(uow.session, request.token)
    if not valid or not payload:
        is_expired = "expired" in (error_message or "").lower()
        raise HTTPException(
            status_code=status.HTTP_410_GONE if is_expired else status.HTTP_400_BAD_REQUEST,
            detail=error_message or "Invalid or expired quotation access link.",
        )

    username = payload.get("sub")
    supplier_id_str = payload.get("supplier_id")
    rfq_id_str = payload.get("rfq_id")
    po_id_str = payload.get("po_id")
    link_type_str = payload.get("link_type") or ("PO" if po_id_str else "RFQ")
    email = payload.get("email")
    exp = payload.get("exp", 0)

    stmt = select(SupplierUserModel).where(SupplierUserModel.username == username)
    result = await uow.session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user and supplier_id_str:
        try:
            sup_uuid = uuid.UUID(supplier_id_str)
            user_stmt = select(SupplierUserModel).where(SupplierUserModel.supplier_id == sup_uuid)
            res2 = await uow.session.execute(user_stmt)
            user = res2.scalar_one_or_none()
        except Exception:
            pass

    if not user and supplier_id_str:
        try:
            sup_uuid = uuid.UUID(supplier_id_str)
            user = SupplierUserModel(
                id=uuid.uuid4(),
                supplier_id=sup_uuid,
                username=username or f"sup_{supplier_id_str[:8]}",
                password_hash=hashlib.sha256(secrets.token_hex(16).encode()).hexdigest(),
                must_change_password=False,
            )
            uow.session.add(user)
            await uow.session.flush()
            await uow.commit()
        except Exception as prov_err:
            logger.warning(f"Could not persist supplier user in session: {prov_err}")
            try:
                await uow.session.rollback()
            except Exception:
                pass

    user_id_str = str(user.id) if user else str(uuid.uuid4())
    effective_supplier_id = str(user.supplier_id) if user else str(supplier_id_str or "")
    effective_username = user.username if user else (username or "supplier")
    now = int(time.time())
    expires_in_hours = max(round((exp - now) / 3600, 1), 0.0)

    return MagicLoginResponse(
        token=f"supplier-mock-token-{user_id_str}-{effective_supplier_id}",
        supplier_id=effective_supplier_id,
        supplierId=effective_supplier_id,
        username=effective_username,
        must_change_password=False,
        roles=["SUPPLIER"],
        rfq_id=rfq_id_str,
        po_id=po_id_str,
        link_type=link_type_str,
        email=email,
        expires_in_hours=expires_in_hours,
    )


@router.get("/auth/verify-magic-token")
async def verify_magic_token_endpoint(
    token: str = Query(...),
    uow: UnitOfWork = Depends(get_uow),
):
    valid, payload, error_message = await resolve_magic_token_or_code(uow.session, token)
    if not valid or not payload:
        is_expired = "expired" in (error_message or "").lower()
        return {
            "valid": False,
            "expired": is_expired,
            "error": error_message,
        }

    now = int(time.time())
    exp = payload.get("exp", 0)
    return {
        "valid": True,
        "expired": False,
        "rfq_id": payload.get("rfq_id"),
        "po_id": payload.get("po_id"),
        "link_type": payload.get("link_type") or ("PO" if payload.get("po_id") else "RFQ"),
        "supplier_id": payload.get("supplier_id"),
        "username": payload.get("sub"),
        "email": payload.get("email"),
        "expires_at": exp,
        "expires_in_hours": max(round((exp - now) / 3600, 1), 0.0),
    }


@router.get("/q/{code}")
async def redirect_short_link(code: str):
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=f"http://localhost:8080/q/{code}", status_code=307)


@router.get("/po/{code}")
async def redirect_po_short_link(code: str):
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=f"http://localhost:8080/po/{code}", status_code=307)


@router.post("/auth/change-password")
async def change_password(
    request: ChangePasswordRequest,
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    import hashlib
    old_hash = hashlib.sha256(request.old_password.encode()).hexdigest()
    stmt = select(SupplierUserModel).where(
        SupplierUserModel.username == request.username,
        SupplierUserModel.password_hash == old_hash
    )
    result = await uow.session.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid old password"
        )
    new_hash = hashlib.sha256(request.new_password.encode()).hexdigest()
    user.password_hash = new_hash
    user.must_change_password = False
    await uow.session.flush()
    await uow.commit()
    return {"success": True}


@router.post("/auth/dev-login")
async def dev_login(
    request: DevLoginRequest,
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    from app.config.settings import get_settings
    settings = get_settings()
    if settings.environment.lower() not in {"local", "test", "development"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Development login is disabled outside local/test/development environments.",
        )

    account_result = await uow.session.execute(
        select(StoreManagerUserModel)
        .options(selectinload(StoreManagerUserModel.store))
        .where(
            or_(
                func.lower(StoreManagerUserModel.username) == request.username.strip().lower(),
                func.upper(StoreManagerUserModel.employee_id) == request.username.strip().upper(),
            ),
            StoreManagerUserModel.status == "ACTIVE",
        )
    )
    account = account_result.scalar_one_or_none()
    if account and (
        account.password_hash == hashlib.sha256(request.password.encode()).hexdigest()
        or request.password in ("Store@123", "password", "Admin@123")
    ):
        session_token = secrets.token_urlsafe(48)
        account.auth_token_hash = hashlib.sha256(session_token.encode()).hexdigest()
        account.last_login = datetime.utcnow()
        await uow.commit()
        role_key = account.role.strip().upper().replace(" ", "_")
        role = {
            "SUPER_ADMIN": "ADMIN",
            "ADMIN_OFFICER": "ADMIN",
            "PROCUREMENT_MANAGER": "MANAGER",
            "PROCUREMENT_OFFICER": "PROCUREMENT",
            "WAREHOUSE_MANAGER": "WAREHOUSE_MANAGER",
            "STORE_OPERATOR": "STORE_KEEPER",
            "STORE_MANAGER": "STORE_MANAGER",
        }.get(role_key, role_key)

        token = f"mock-jwt-store-manager-{account.employee_id}" if role == "STORE_MANAGER" else (
            f"mock-jwt-store-keeper-{account.employee_id}" if role == "STORE_KEEPER" else f"mock-jwt-db-user-{session_token}"
        )

        return {
            "token": token,
            "username": account.username,
            "full_name": account.full_name,
            "employee_id": account.employee_id,
            "roles": [role],
            "store_id": str(account.store_id) if account.store_id else None,
            "store_code": account.store.store_code if account.store else None,
            "store_name": account.store.store_name if account.store else None,
            "applications": account.applications or [],
        }

    normalized_username = request.username.strip().lower()
    if normalized_username == settings.admin_username.lower() and request.password == settings.admin_password:
        return {
            "token": "mock-jwt-admin-token",
            "username": settings.admin_username,
            "roles": ["ADMIN"]
        }
    elif normalized_username == settings.procurement_username.lower() and request.password == settings.procurement_password:
        return {
            "token": "mock-jwt-procurement-token",
            "username": settings.procurement_username,
            "roles": ["PROCUREMENT"]
        }
    elif normalized_username == settings.finance_username.lower() and request.password == settings.finance_password:
        return {
            "token": "mock-jwt-finance-token",
            "username": settings.finance_username,
            "roles": ["FINANCE"]
        }
    elif normalized_username == settings.warehouse_username.lower() and request.password == settings.warehouse_password:
        return {
            "token": "mock-jwt-warehouse-token",
            "username": settings.warehouse_username,
            "roles": ["WAREHOUSE"]
        }
    elif (
        (hasattr(settings, "gate_security_username") and request.username == settings.gate_security_username and request.password == settings.gate_security_password)
        or (hasattr(settings, "gate_entry_username") and request.username == settings.gate_entry_username and request.password == settings.gate_entry_password)
    ):
        return {
            "token": "mock-jwt-gate-entry-token",
            "username": request.username,
            "roles": ["GATE_SECURITY"]
        }
    elif hasattr(settings, "assembly_manager_username") and request.username == settings.assembly_manager_username and request.password == settings.assembly_manager_password:
        return {
            "token": "mock-jwt-assembly-manager-token",
            "username": settings.assembly_manager_username,
            "roles": ["ASSEMBLY_MANAGER"]
        }
    elif request.username == settings.supplier_username and request.password == settings.supplier_password:
        return {
            "token": "mock-jwt-supplier-token",
            "username": settings.supplier_username,
            "roles": ["SUPPLIER"]
        }
    elif (hasattr(settings, "grn_username") and normalized_username == settings.grn_username.lower() and request.password == settings.grn_password) or normalized_username in {"grn", "grn_manager", "operations_manager"}:
        return {
            "token": "mock-jwt-grn-token",
            "username": request.username,
            "roles": ["GRN"]
        }
    elif (hasattr(settings, "manager_username") and normalized_username == settings.manager_username.lower() and request.password == settings.manager_password) or (normalized_username in {"manager", "mgr", "procurement_manager"} and request.password in {getattr(settings, "manager_password", "Manager@123"), "Manager@123", "password", "manager123", "Admin@123"}):
        return {
            "token": "mock-jwt-manager-token",
            "username": request.username,
            "roles": ["MANAGER"]
        }
    elif (hasattr(settings, "dispatch_username") and normalized_username == settings.dispatch_username.lower() and request.password == settings.dispatch_password) or normalized_username in {"dispatch", "dispatch_manager"}:
        return {
            "token": "mock-jwt-dispatch-token",
            "username": request.username,
            "roles": ["DISPATCH"]
        }
    elif (hasattr(settings, "assembly_manager_username") and normalized_username == settings.assembly_manager_username.lower() and request.password == settings.assembly_manager_password) or (normalized_username in {"assembly", "assembly_manager"} and request.password in {getattr(settings, "assembly_manager_password", "assembly123"), "assembly123"}):
        return {
            "token": "mock-jwt-assembly-token",
            "username": request.username,
            "roles": ["ASSEMBLY_MANAGER"]
        }
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )


@router.get("/global-search", response_model=GlobalSearchResponse)
async def global_search(
    q: str = Query(..., min_length=1),
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(get_current_user),
):
    """
    Search across Suppliers, POs, ASNs, Material Requests and RFQs.
    Provides real-time results for the navbar search.
    """
    try:
        search_term = f"%{q}%"
        results = []


        supplier_stmt = select(SupplierModel).where(
            or_(
                SupplierModel.supplier_name.ilike(search_term),
                SupplierModel.supplier_code.ilike(search_term),
                SupplierModel.registered_company_name.ilike(search_term),
                SupplierModel.gstin.ilike(search_term),
                SupplierModel.vendor_type.ilike(search_term),
                SupplierModel.industry.ilike(search_term),
                SupplierModel.status.ilike(search_term)
            )
        ).limit(5)
        supplier_res = await uow.session.execute(supplier_stmt)
        for s in supplier_res.scalars().all():
            results.append({
                "id": str(s.id),
                "type": "SUPPLIER",
                "title": s.supplier_name,
                "subtitle": f"Code: {s.supplier_code or 'N/A'} · GSTIN: {s.gstin or 'N/A'} · Type: {s.vendor_type} · Status: {s.status}",
                "link": f"/master-data?search={s.supplier_name}"
            })


        po_stmt = select(PurchaseOrderModel).where(
            or_(
                PurchaseOrderModel.po_number.ilike(search_term),
                PurchaseOrderModel.supplier_name.ilike(search_term),
                PurchaseOrderModel.supplier_code.ilike(search_term),
                PurchaseOrderModel.supplier_gstin.ilike(search_term),
                PurchaseOrderModel.warehouse_id.ilike(search_term),
                PurchaseOrderModel.procurement_officer.ilike(search_term),
                PurchaseOrderModel.department.ilike(search_term),
                PurchaseOrderModel.status.ilike(search_term)
            )
        ).limit(5)
        po_res = await uow.session.execute(po_stmt)
        for po in po_res.scalars().all():
            results.append({
                "id": str(po.id),
                "type": "PO",
                "title": f"PO: {po.po_number}",
                "subtitle": f"Vendor: {po.supplier_name or 'N/A'} · Code: {po.supplier_code or 'N/A'} · Warehouse: {po.warehouse_id or 'N/A'} · Status: {po.status}",
                "link": f"/purchase-order?poId={po.id}"
            })


        asn_stmt = select(AsnModel).where(
            or_(
                AsnModel.asn_number.ilike(search_term),
                AsnModel.po_number.ilike(search_term),
                AsnModel.vehicle_number.ilike(search_term),
                AsnModel.driver_name.ilike(search_term),
                AsnModel.driver_contact.ilike(search_term),
                AsnModel.transporter.ilike(search_term),
                AsnModel.invoice_number.ilike(search_term),
                AsnModel.status.ilike(search_term),
                AsnModel.warehouse_id.ilike(search_term)
            )
        ).limit(5)
        asn_res = await uow.session.execute(asn_stmt)
        for asn in asn_res.scalars().all():
            results.append({
                "id": str(asn.id),
                "type": "ASN",
                "title": f"ASN: {asn.asn_number}",
                "subtitle": f"PO: {asn.po_number or 'N/A'} · Vehicle: {asn.vehicle_number or 'N/A'} · Driver: {asn.driver_name or 'N/A'} · Transporter: {asn.transporter or 'N/A'} · Status: {asn.status}",
                "link": f"/procurement/asns/{asn.id}"
            })


        mr_stmt = select(MaterialRequestModel).where(
            or_(
                MaterialRequestModel.request_number.ilike(search_term),
                MaterialRequestModel.requested_by.ilike(search_term),
                MaterialRequestModel.department.ilike(search_term),
                MaterialRequestModel.warehouse_id.ilike(search_term),
                MaterialRequestModel.priority.ilike(search_term),
                MaterialRequestModel.status.ilike(search_term),
                MaterialRequestModel.suggested_supplier.ilike(search_term)
            )
        ).limit(5)
        mr_res = await uow.session.execute(mr_stmt)
        for mr in mr_res.scalars().all():
            results.append({
                "id": str(mr.id),
                "type": "MATERIAL_REQUEST",
                "title": f"Req: {mr.request_number}",
                "subtitle": f"By: {mr.requested_by} · Dept: {mr.department} · Warehouse: {mr.warehouse_id} · Priority: {mr.priority} · Status: {mr.status}",
                "link": f"/procurement/material-requests"
            })


        rfq_stmt = select(RfqModel).where(
            or_(
                RfqModel.rfq_number.ilike(search_term),
                RfqModel.procurement_officer.ilike(search_term),
                RfqModel.material_request_number.ilike(search_term),
                RfqModel.warehouse.ilike(search_term),
                RfqModel.status.ilike(search_term)
            )
        ).limit(5)
        rfq_res = await uow.session.execute(rfq_stmt)
        for rfq in rfq_res.scalars().all():
            results.append({
                "id": str(rfq.id),
                "type": "RFQ",
                "title": f"RFQ: {rfq.rfq_number}",
                "subtitle": f"Warehouse: {rfq.warehouse} · MR: {rfq.material_request_number or 'N/A'} · Officer: {rfq.procurement_officer} · Status: {rfq.status}",
                "link": f"/procurement/rfqs"
            })





        return {"results": results}
    except Exception as e:
        logger.error(f"Global search failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/user/navigation")
async def get_user_navigation(
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """
    Returns complete backend-driven module navigation and user profile configuration.
    """
    roles = user.roles or []
    role_str = roles[0] if roles else "WAREHOUSE"
    if "GRN" in roles or user.username.lower() in ("grn", "grn_manager", "operations_manager", "grn_officer"):
        role_str = "GRN"

    modules = {
        "GRN": {
            "module_label": "GRN Operations",
            "items": [
                {"label": "GRN Operations Dashboard", "to": "/grn", "search": {"tab": "dashboard"}, "icon": "LayoutDashboard"},
                {"label": "GRN Records History", "to": "/grn", "search": {"tab": "records"}, "icon": "ClipboardList"},
                {"label": "Material Receiving", "to": "/grn", "search": {"tab": "wizard", "page": 2}, "icon": "PackageCheck"},
                {"label": "Quality & Photos", "to": "/grn", "search": {"tab": "wizard", "page": 3}, "icon": "AlertTriangle"},
                {"label": "Batch Allocation", "to": "/grn", "search": {"tab": "wizard", "page": 4}, "icon": "Boxes"},
                {"label": "Documents & Posting", "to": "/grn", "search": {"tab": "wizard", "page": 5}, "icon": "FileText"},
                {"label": "Batch QR Code Labels", "to": "/grn", "search": {"tab": "wizard", "page": 6}, "icon": "QrCode"},
            ]
        },
        "STORE_MANAGER": {
            "module_label": "Store Management",
            "items": [
                {"label": "My Store", "to": "/my-store", "icon": "Store"},
                {"label": "Material Master", "to": "/warehouse/materials", "icon": "Database"},
                {"label": "Inventory", "to": "/inventory", "icon": "Boxes"},
                {"label": "Putaway Tasks", "to": "/putaway-tasks", "icon": "PackageCheck"},
                {"label": "Assembly Requisitions", "to": "/warehouse/assembly-requisitions", "icon": "ClipboardList"},
                {"label": "Damage & Quarantine", "to": "/warehouse/quarantine", "icon": "ShieldAlert"},
            ]
        },
        "WAREHOUSE": {
            "module_label": "Warehouse Operations",
            "items": [
                {"label": "Dashboard", "to": "/warehouse-dashboard", "icon": "LayoutDashboard"},
                {"label": "Store Master", "to": "/warehouse/stores", "icon": "Building2"},
                {"label": "Material Master", "to": "/warehouse/materials", "icon": "Database"},
                {"label": "Inventory", "to": "/inventory", "icon": "Boxes"},
                {"label": "Putaway Tasks", "to": "/putaway-tasks", "icon": "PackageCheck"},
                {"label": "Material Requests", "to": "/warehouse/material-requests", "icon": "ClipboardList"},
                {"label": "Assembly Requisitions", "to": "/warehouse/assembly-requisitions", "icon": "ClipboardList"},
                {"label": "Finished Goods Requests", "to": "/warehouse/finished-goods-requests", "icon": "Boxes"},
                {"label": "Vehicle Exit", "to": "/vehicle-exit", "icon": "LogOut"},
                {"label": "Dock Management", "to": "/dock-management", "icon": "Warehouse"},
                {"label": "Dock / Receiving", "to": "/receiving", "icon": "PackageCheck"},
                {"label": "GRN", "to": "/grn", "icon": "FileCheck2"},
                {"label": "Damage & Quarantine", "to": "/warehouse/quarantine", "icon": "ShieldAlert"},
            ]
        },
        "PROCUREMENT": {
            "module_label": "Procurement Portal",
            "items": [
                {"label": "Dashboard", "to": "/procurement-dashboard", "icon": "LayoutDashboard"},
                {"label": "Suppliers", "to": "/master-data", "icon": "Building2"},
                {"label": "Finished Goods Requests", "to": "/procurement/finished-goods", "icon": "Boxes"},
                {"label": "Material Requests", "to": "/procurement/material-requests", "icon": "ClipboardList"},
                {"label": "RFQs", "to": "/procurement/rfqs", "icon": "FileQuestion"},
                {"label": "Quotations", "to": "/procurement/quotations", "icon": "FileBadge"},
                {"label": "Purchase Orders", "to": "/procurement/purchase-orders", "icon": "FileText"},
                {"label": "ASNs", "to": "/procurement/asns", "icon": "Truck"},
                {"label": "Reports", "to": "/reports", "icon": "BarChart3"},
            ]
        },
        "SUPPLIER": {
            "module_label": "Supplier Portal",
            "items": [
                {"label": "Dashboard", "to": "/supplier-dashboard", "icon": "LayoutDashboard"},
                {"label": "Quotation Portal", "to": "/submit-quotation", "icon": "FileBadge"},
                {"label": "ASNs", "to": "/supplier/asns/new", "icon": "Truck"},
                {"label": "Quality Issues", "to": "/supplier/quality-issues", "icon": "AlertTriangle"},
                {"label": "Damage Claims", "to": "/damage-claims", "icon": "FileCheck2"},
            ]
        },
        "FINANCE": {
            "module_label": "Finance Portal",
            "items": [
                {"label": "Dashboard", "to": "/finance-dashboard", "icon": "LayoutDashboard"},
                {"label": "Pending Approvals", "to": "/finance/approvals", "icon": "FileCheck2"},
            ]
        },
        "MANAGER": {
            "module_label": "Manager Portal",
            "items": [
                {"label": "Dashboard", "to": "/manager-dashboard", "icon": "LayoutDashboard"},
                {"label": "Suppliers", "to": "/master-data", "icon": "Building2"},
                {"label": "Material Requests", "to": "/procurement/material-requests", "icon": "ClipboardList"},
            ]
        },
        "GATE_SECURITY": {
            "module_label": "Gate Security Portal",
            "items": [
                {"label": "Dashboard", "to": "/gate-dashboard", "icon": "LayoutDashboard"},
                {"label": "Gate Entry", "to": "/gate-entry", "icon": "DoorOpen"},
                {"label": "Vehicle Exit", "to": "/vehicle-exit", "icon": "LogOut"},
                {"label": "Unscheduled Arrivals", "to": "/unscheduled-arrivals", "icon": "FileQuestion"},
                {"label": "Replacement Claims", "to": "/damage-claims", "icon": "AlertTriangle"},
            ]
        },
        "ASSEMBLY_MANAGER": {
            "module_label": "Assembly Portal",
            "items": [
                {"label": "Dashboard", "to": "/assembly-dashboard", "icon": "LayoutDashboard"},
                {"label": "Assembly Orders", "to": "/assembly-orders", "icon": "Factory"},
                {"label": "Finished Goods Requests", "to": "/assembly/finished-goods-requests", "icon": "ClipboardList"},
                {"label": "Material Requests", "to": "/assembly/requests", "icon": "ClipboardList"},
                {"label": "Material/Pickup Status", "to": "/assembly-material-issues", "icon": "PackageCheck"},
                {"label": "Production", "to": "/assembly-progress", "icon": "ListOrdered"},
                {"label": "Finished Goods", "to": "/assembly-finished-goods", "icon": "Boxes"},
                {"label": "Genealogy", "to": "/assembly-genealogy", "icon": "GitFork"},
            ]
        }
    }

    unread_count = 0
    try:
        if "WAREHOUSE" in roles:
            from app.modules.gate.infrastructure.persistence.models import GateEntryModel
            res = await uow.session.execute(
                select(func.count()).select_from(GateEntryModel).where(GateEntryModel.status == "AWAITING_DOCK")
            )
            unread_count += res.scalar() or 0
        else:
            n_res = await uow.session.execute(
                select(func.count()).select_from(NotificationModel).where(
                    NotificationModel.user_role == role_str,
                    NotificationModel.is_read == False
                )
            )
            unread_count += n_res.scalar() or 0
    except Exception:
        pass

    active_module = modules.get(role_str, modules["WAREHOUSE"])

    return {
        "username": user.username,
        "roles": roles,
        "active_role": role_str,
        "module_label": active_module["module_label"],
        "navigation": active_module["items"],
        "all_modules": modules,
        "unread_notifications": unread_count,
    }


async def _serialize_finished_goods_request(req: FinishedGoodsRequestModel, uow: UnitOfWork) -> dict:
    fg_available = Decimal("0")
    try:
        from app.modules.storage.infrastructure.persistence.models import InventoryLocationBalanceModel
        fg_conditions = []
        if req.finished_goods_code:
            fg_conditions.append(func.upper(InventoryLocationBalanceModel.material_code) == req.finished_goods_code.strip().upper())
        if req.finished_goods_name:
            fg_conditions.append(func.upper(InventoryLocationBalanceModel.material_name) == req.finished_goods_name.strip().upper())

        if fg_conditions:
            fg_query = select(func.coalesce(func.sum(InventoryLocationBalanceModel.available_quantity), Decimal("0"))).where(
                or_(*fg_conditions),
            )
            fg_res = await uow.session.execute(fg_query)
            fg_available = Decimal(str(fg_res.scalar() or 0))
    except Exception as e:
        logger.warning(f"Error calculating FG store availability: {e}")

    # Check if a BOM already exists for this finished good product
    bom_obj = None
    bom_data = None
    try:
        from app.modules.assembly.infrastructure.persistence.models import BillOfMaterialsModel
        bom_conditions = []
        if req.finished_goods_code:
            bom_conditions.append(func.upper(BillOfMaterialsModel.product_code) == req.finished_goods_code.strip().upper())
        if req.finished_goods_name:
            bom_conditions.append(func.lower(func.trim(BillOfMaterialsModel.product_name)) == func.lower(func.trim(req.finished_goods_name)))

        if bom_conditions:
            bom_res = await uow.session.execute(
                select(BillOfMaterialsModel)
                .options(selectinload(BillOfMaterialsModel.items))
                .where(BillOfMaterialsModel.status == "ACTIVE", or_(*bom_conditions))
                .order_by(BillOfMaterialsModel.created_at.desc())
            )
            bom_obj = bom_res.scalars().first()
            if bom_obj:
                bom_data = {
                    "id": str(bom_obj.id),
                    "bom_number": bom_obj.bom_number,
                    "product_code": bom_obj.product_code,
                    "product_name": bom_obj.product_name,
                    "description": bom_obj.description,
                    "status": bom_obj.status,
                    "created_by": bom_obj.created_by,
                    "created_at": bom_obj.created_at.isoformat() if bom_obj.created_at else None,
                    "updated_at": bom_obj.updated_at.isoformat() if bom_obj.updated_at else None,
                    "items": [
                        {
                            "id": str(item.id),
                            "bom_id": str(item.bom_id),
                            "material_id": str(item.material_id) if item.material_id else None,
                            "material_code": item.material_code,
                            "material_name": item.material_name,
                            "variant_code": item.variant_code,
                            "quantity_per_unit": float(item.quantity_per_unit),
                            "uom": item.uom or "PCS",
                            "notes": item.notes,
                        }
                        for item in (bom_obj.items or [])
                    ],
                }
    except Exception as e:
        logger.warning(f"Error checking BOM for FG request: {e}")

    req_qty = Decimal(str(req.quantity or 0))
    shortage = max(Decimal("0"), req_qty - fg_available)

    return {
        "id": str(req.id),
        "request_number": req.request_number,
        "warehouse_id": req.warehouse_id,
        "finished_goods_code": req.finished_goods_code,
        "product_code": req.finished_goods_code,
        "finished_goods_name": req.finished_goods_name,
        "product_name": req.finished_goods_name,
        "quantity": float(req_qty),
        "requested_quantity": float(req_qty),
        "uom": req.uom or "PCS",
        "required_date": req.required_date.isoformat() if req.required_date else None,
        "requested_by": req.requested_by,
        "requested_date": req.requested_date.isoformat() if getattr(req, "requested_date", None) else (req.created_at.date().isoformat() if req.created_at else None),
        "created_by": req.requested_by,
        "status": req.status,
        "bom_attachment_url": req.bom_attachment_url,
        "bom_attachment_name": req.bom_attachment_name,
        "remarks": req.remarks,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "updated_at": req.updated_at.isoformat() if req.updated_at else None,
        "fg_store_available": float(fg_available),
        "available_quantity": float(fg_available),
        "shortage": float(shortage),
        "shortage_quantity": float(shortage),
        "has_bom": bom_obj is not None,
        "bom": bom_data,
    }


@router.post("/finished-goods-requests/upload-bom")
async def upload_fg_bom_attachment(
    file: UploadFile = File(...),
):
    """
    Upload optional BOM document attachment for Finished Goods Request.
    """
    import shutil
    from pathlib import Path

    upload_dir = Path("media_uploads/bom_attachments")
    upload_dir.mkdir(parents=True, exist_ok=True)

    file_ext = Path(file.filename).suffix
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    dest_path = upload_dir / unique_filename

    try:
        with dest_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Failed to save BOM attachment: {e}")
        raise HTTPException(status_code=500, detail="Could not save file")

    return {
        "file_name": file.filename,
        "file_url": f"/media/bom_attachments/{unique_filename}"
    }


@router.post("/finished-goods-requests", status_code=status.HTTP_201_CREATED)
async def create_finished_goods_request(
    payload: CreateFinishedGoodsRequestSchema,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    """
    Procurement creates a Finished Goods Request and sends it to Assembly.
    Status is initialized to SENT_TO_ASSEMBLY.
    In-app notifications sent to Assembly and Warehouse.
    """
    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than 0")
    if not payload.finished_goods_name or not payload.finished_goods_name.strip():
        raise HTTPException(status_code=400, detail="Product/Finished Goods Name is required")

    date_str = datetime.now().strftime("%Y%m%d")
    prefix = f"FGR-{date_str}-"
    count_res = await uow.session.execute(
        select(func.count(FinishedGoodsRequestModel.id)).where(
            FinishedGoodsRequestModel.request_number.like(f"{prefix}%")
        )
    )
    seq = (count_res.scalar() or 0) + 1
    req_number = f"{prefix}{seq:04d}"

    req_date = payload.required_date or datetime.now().date()
    requester = payload.requested_by.strip() if payload.requested_by and payload.requested_by.strip() else (user.username or "Procurement")
    req_date_requested = payload.requested_date or datetime.now().date()

    new_request = FinishedGoodsRequestModel(
        id=uuid.uuid4(),
        request_number=req_number,
        warehouse_id=payload.warehouse_id or "MAIN",
        finished_goods_code=payload.finished_goods_code.strip() if payload.finished_goods_code else payload.finished_goods_name.strip(),
        finished_goods_name=payload.finished_goods_name.strip(),
        quantity=payload.quantity,
        uom=payload.uom or "PCS",
        required_date=req_date,
        requested_by=requester,
        requested_date=req_date_requested,
        status="SENT_TO_ASSEMBLY",
        bom_attachment_url=payload.bom_attachment_url,
        bom_attachment_name=payload.bom_attachment_name,
        remarks=payload.remarks,
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )
    uow.session.add(new_request)

    # Notifications to Assembly and Warehouse
    notif_assembly = NotificationModel(
        id=uuid.uuid4(),
        user_role="ASSEMBLY",
        title="New Finished Goods Request",
        message=f"Procurement created Finished Goods Request {req_number} for {payload.quantity} {payload.uom or 'PCS'} of {payload.finished_goods_name}.",
        link=f"/assembly/finished-goods-requests?id={new_request.id}",
        is_read=False,
        created_at=datetime.now(),
    )
    notif_warehouse = NotificationModel(
        id=uuid.uuid4(),
        user_role="WAREHOUSE",
        title="Finished Goods Request Tracking",
        message=f"Procurement sent Finished Goods Request {req_number} for {payload.quantity} {payload.uom or 'PCS'} of {payload.finished_goods_name} to Assembly.",
        link=f"/warehouse/finished-goods-requests?id={new_request.id}",
        is_read=False,
        created_at=datetime.now(),
    )
    uow.session.add(notif_assembly)
    uow.session.add(notif_warehouse)

    await uow.commit()

    return await _serialize_finished_goods_request(new_request, uow)


@router.get("/finished-goods-requests")
async def list_finished_goods_requests(
    uow: UnitOfWork = Depends(get_uow),
):
    """
    List all Finished Goods Requests with FG Store availability check data.
    """
    res = await uow.session.execute(
        select(FinishedGoodsRequestModel).order_by(FinishedGoodsRequestModel.created_at.desc())
    )
    records = res.scalars().all()
    output = []
    for r in records:
        output.append(await _serialize_finished_goods_request(r, uow))
    return output


@router.get("/finished-goods-requests/{request_id}")
async def get_finished_goods_request(
    request_id: str,
    uow: UnitOfWork = Depends(get_uow),
):
    """
    Get single Finished Goods Request with FG Store availability check data.
    """
    try:
        req_uuid = uuid.UUID(request_id)
        req = await uow.session.get(FinishedGoodsRequestModel, req_uuid)
    except ValueError:
        req = await uow.session.scalar(
            select(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.request_number == request_id)
        )

    if not req:
        raise HTTPException(status_code=404, detail="Finished Goods Request not found")

    return await _serialize_finished_goods_request(req, uow)


async def check_upcoming_arrivals():
    """Background task to notify warehouse manager of arrivals in 5 days."""
    from datetime import timedelta
    from app.database.session import session_scope

    try:
        async with session_scope() as session:

            target_date = (datetime.now() + timedelta(days=5)).date()


            stmt = select(AsnModel).where(
                cast(AsnModel.expected_arrival_at, Date) == target_date,
                AsnModel.status == "DISPATCHED"
            )
            res = await session.execute(stmt)
            asns = res.scalars().all()

            for asn in asns:


                unique_link = f"/notifications?asnId={asn.id}&alert=5day"

                check_stmt = select(NotificationModel).where(
                    NotificationModel.link == unique_link
                )
                check_res = await session.execute(check_stmt)
                if check_res.scalar_one_or_none():
                    continue

                msg = f"Shipment PO {asn.po_number} / ASN {asn.asn_number} is arriving in 5 days ({target_date}). Please prepare the warehouse for receiving."

                new_notif = NotificationModel(
                    id=uuid.uuid4(),
                    user_role="WAREHOUSE",
                    title="Upcoming Arrival (5 Days)",
                    message=msg,
                    link=unique_link,
                    is_read=False,
                    created_at=datetime.now()
                )
                session.add(new_notif)
                logger.info(f"Generated 5-day arrival reminder for ASN {asn.asn_number}")


    except Exception as e:
        logger.error(f"Background arrival check failed: {e}")



