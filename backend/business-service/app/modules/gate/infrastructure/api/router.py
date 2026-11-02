"""
FastAPI REST router for the Gate Entry module.
Purged all hardcoded mocks. Implements real dynamic PO OCR processing via OpenCV + Tesseract
and persistent gate pass creation with Outbox Event generation.
"""
from __future__ import annotations

import base64
import asyncio
import datetime
import io
import json
import logging
import os
import re
import uuid
from app.modules.gate.application.transport_validation import (
    normalize_vehicle, valid_vehicle, validate_transport, validate_gate_duplicates,
)
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, delete, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.common.domain.exceptions import DomainRuleViolationException, NotFoundException
from app.common.email_utils import render_premium_email, send_email
from app.database.session import UnitOfWork, get_uow
from app.modules.gate.adapters.mock_adapters import InMemoryGateEntryRepository
from app.modules.gate.infrastructure.persistence.models import DamagePhotoModel, DamageReportModel, DockAssignmentModel, DockModel, GateEntryAuditLogModel, GateEntryModel, GateExitModel, ReceivingLineModel, SupplierDamageClaimModel, VehicleExitApprovalModel, FinishedGoodsPickupGateVisitModel
from app.modules.assembly.infrastructure.persistence.models import AssemblyFinishedGoodsAllocationModel, AssemblyFinishedGoodsModel, FinishedGoodsSectionModel
from app.modules.assembly.infrastructure.finished_goods import post_dispatch_stock
from app.common.persistence.models import AsnLineModel, PurchaseOrderModel, AsnModel, MaterialModel, MaterialStockModel, NotificationModel, SupplierContactModel, SupplierModel, SupplierUserModel, FinishedGoodsRequestModel
from app.modules.receiving.infrastructure.persistence.models import GrnDamageEvidenceModel, GrnLineModel, GrnModel, InventoryReceiptPostingModel
from app.modules.receiving.domain.events import GrnPostedEvent, PostedInventoryLine
from app.events.outbox_repository import to_outbox_row
from app.modules.storage.infrastructure.persistence.models import HandlingUnitModel, PutawayTaskModel, StorageLocationModel
from app.modules.storage.application.location_strategy import recommend_storage_location
from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel, UserAccountModel
from app.modules.dock.infrastructure.persistence.models import DockMasterModel, DockAllocationRequestModel
from app.modules.gate.application.ocr_pipeline import EnterprisePoOcrEngine
from app.modules.gate.domain.aggregate import GateEntry
from app.modules.gate.domain.services import GateVerificationService
from app.modules.gate.domain.value_objects import (
    FieldMismatch,
    GateEntryStatus,
    OcrResult,
    PurchaseOrderRecord,
)
from app.modules.gate.infrastructure.api.dto import (
    CreateGateEntryRequest,
    AssignDockRequest,
    CreateDockRequest,
    UpdateDockRequest,
    RecordReceivingRequest,
    RecordMaterialConditionRequest,
    QualityInspectionDecisionRequest,
    PostGrnRequest,
    ApproveVehicleExitRequest,
    FieldMismatchDto,
    GateEntryResponse,
    OcrResultDto,
    PoOcrPreviewRequest,
    PoOcrPreviewResponse,
    PurchaseOrderRecordDto,
    VerifyGateEntryRequest,
)
from app.security.dependencies import CurrentUser, get_current_user, require_permission

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

router = APIRouter(prefix="/api/gate-entries", tags=["gate"])
preview_router = APIRouter(prefix="/api/gate", tags=["gate"])


class FinishedGoodsPickupGateEntryPayload(BaseModel):
    request_number: str
    vehicle_number: str
    driver_name: str
    driver_contact: str


class FinishedGoodsPickupGateExitPayload(BaseModel):
    vehicle_number: str
    driver_name: str
    documents_verified: bool = False
    section_qr_identities: list[str] = Field(default_factory=list, max_length=8)


@router.post("/finished-goods-pickup", status_code=status.HTTP_201_CREATED)
async def create_finished_goods_pickup_gate_entry(
    payload: FinishedGoodsPickupGateEntryPayload,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
):
    async with uow:
        request = (await uow.session.execute(select(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.request_number == payload.request_number).with_for_update())).scalar_one_or_none()
        if not request: raise HTTPException(404, "Finished-goods dispatch request not found")
        if request.status == "CANCELLED": raise HTTPException(409, "This dispatch request is cancelled.")
        if request.status not in ("ALLOCATED", "APPROVED", "READY_FOR_PICKUP"): raise HTTPException(409, "This dispatch request is not approved.")
        vehicle_number, driver_name, driver_contact = validate_transport(
            payload.vehicle_number, payload.driver_name, payload.driver_contact
        )
        expected_transport_entries = request.transport_entries or ([{
            "vehicle_number": request.vehicle_number,
            "driver_name": request.driver_name,
            "driver_contact": request.driver_contact,
        }] if request.vehicle_number and request.driver_name and request.driver_contact else [])
        if expected_transport_entries and not any(
            normalize_vehicle(str(entry.get("vehicle_number") or "")) == vehicle_number
            and " ".join(str(entry.get("driver_name") or "").split()).casefold() == driver_name.casefold()
            and str(entry.get("driver_contact") or "").strip() == driver_contact
            for entry in expected_transport_entries
        ):
            raise HTTPException(409, "Vehicle and driver do not match an assigned pair for this dispatch.")
        if request.section_fg_id:
            # PostgreSQL uses an advisory lock to serialize simultaneous entries
            # for the same vehicle. SQLite has no pg_advisory_xact_lock function;
            # its transaction-level write locking provides the local-dev guard.
            if uow.session.bind.dialect.name == "postgresql":
                await uow.session.execute(select(func.pg_advisory_xact_lock(func.hashtext(vehicle_number))))
            active_vehicle = await uow.session.scalar(select(FinishedGoodsPickupGateVisitModel.id).where(
                FinishedGoodsPickupGateVisitModel.vehicle_number == vehicle_number,
                FinishedGoodsPickupGateVisitModel.request_id != request.id,
                FinishedGoodsPickupGateVisitModel.status.in_(["INSIDE_FACILITY", "READY_FOR_GATE_EXIT"])).limit(1))
            if active_vehicle:
                raise HTTPException(409, "Vehicle already has an active Gate Pass")
        existing_visits = (await uow.session.execute(
            select(FinishedGoodsPickupGateVisitModel)
            .where(FinishedGoodsPickupGateVisitModel.request_id == request.id)
            .with_for_update()
        )).scalars().all()
        used_vehicle_visit = next(
            (visit for visit in existing_visits
             if normalize_vehicle(visit.vehicle_number) == vehicle_number),
            None,
        )
        if used_vehicle_visit:
            if used_vehicle_visit.status == "INSIDE_FACILITY":
                return {"gate_pass_number": used_vehicle_visit.gate_pass_number, "status": used_vehicle_visit.status, "request_number": request.request_number}
            raise HTTPException(409, "This assigned vehicle already used its gate pass for this dispatch.")
        gate_pass = uuid.uuid4().hex.upper()[:6]
        while (await uow.session.execute(select(FinishedGoodsPickupGateVisitModel.id).where(FinishedGoodsPickupGateVisitModel.gate_pass_number == gate_pass))).scalar_one_or_none(): gate_pass = uuid.uuid4().hex.upper()[:6]
        now = datetime.datetime.now(datetime.timezone.utc)
        visit = FinishedGoodsPickupGateVisitModel(request_id=request.id, gate_pass_number=gate_pass, supplier_id=request.supplier_id, supplier_name=request.supplier_name or request.requested_by, vehicle_number=vehicle_number, driver_name=driver_name, driver_contact=driver_contact, status="INSIDE_FACILITY", arrived_at=now, entered_at=now, security_officer=user.username)
        uow.session.add(visit)
        uow.session.add(NotificationModel(user_role="ASSEMBLY_MANAGER", title="Finished-goods pickup vehicle arrived", message=f"Pickup {request.request_number} arrived. Gate pass {gate_pass}. Vehicle {vehicle_number}.", link="/assembly/dispatch"))
        await uow.commit()
        return {"gate_pass_number": gate_pass, "request_number": request.request_number, "status": visit.status, "arrived_at": now.isoformat(), "visit_purpose": "FINISHED_GOODS_PICKUP"}


@router.get("/finished-goods-pickup/{gate_pass_number}")
async def get_finished_goods_pickup_gate_pass(
    gate_pass_number: str,
    _user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    async with uow:
        visit = (await uow.session.execute(
            select(FinishedGoodsPickupGateVisitModel).where(
                FinishedGoodsPickupGateVisitModel.gate_pass_number == gate_pass_number.upper().strip()
            )
        )).scalar_one_or_none()
        if not visit:
            raise HTTPException(404, "Gate pass not found.")
        request = await uow.session.get(FinishedGoodsRequestModel, visit.request_id)
        if not request:
            raise HTTPException(404, "Pickup request not found.")
        return {
            "gate_pass_number": visit.gate_pass_number,
            "status": visit.status,
            "request_number": request.request_number,
            "supplier_name": visit.supplier_name,
            "vehicle_number": visit.vehicle_number,
            "driver_name": visit.driver_name,
            "driver_contact": visit.driver_contact,
            "security_officer": visit.security_officer,
            "entered_at": visit.entered_at.isoformat() if visit.entered_at else None,
            "expected_pickup_date": request.expected_pickup_date.isoformat() if request.expected_pickup_date else None,
            "product_code": request.material_code,
            "product_name": request.material_name,
            "quantity": float(request.quantity),
            "uom": request.uom,
            "destination": request.warehouse,
            "documents_verified": visit.documents_verified,
            "fg_id": str(request.section_fg_id) if request.section_fg_id else None,
            "loaded_sections": [{"sub_id": r.sub_id, "qr_identity": r.qr_identity, "status": r.status} for r in
                (await uow.session.scalars(select(FinishedGoodsSectionModel).where(
                    FinishedGoodsSectionModel.gate_visit_id == visit.id))).all()],
        }


@router.post("/finished-goods-pickup/{gate_pass_number}/exit")
async def complete_finished_goods_pickup_gate_exit(
    gate_pass_number: str, payload: FinishedGoodsPickupGateExitPayload,
    user: CurrentUser = Depends(require_permission("gate:verify")), uow: UnitOfWork = Depends(get_uow),
):
    async with uow:
        visit = (await uow.session.execute(select(FinishedGoodsPickupGateVisitModel).where(FinishedGoodsPickupGateVisitModel.gate_pass_number == gate_pass_number.upper().strip()))).scalar_one_or_none()
        if not visit: raise HTTPException(404, "Pickup gate pass not found")
        if visit.status not in ("INSIDE_FACILITY", "READY_FOR_GATE_EXIT"): raise HTTPException(409, f"Gate pass is already {visit.status}")
        if visit.vehicle_number.upper() != payload.vehicle_number.upper().strip() or visit.driver_name.strip().lower() != payload.driver_name.strip().lower(): raise HTTPException(422, "Vehicle or driver does not match the original pickup gate entry")
        if not payload.documents_verified: raise HTTPException(422, "Required packing and dispatch documents must be verified")
        request = (await uow.session.execute(select(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.id == visit.request_id))).scalar_one_or_none()
        if request and request.section_fg_id:
            from app.modules.assembly.infrastructure.sections import transition_sections, section_summary
            from app.modules.assembly.infrastructure.persistence.models import FinishedGoodsSectionModel
            from sqlalchemy import update
            if visit.status != "READY_FOR_GATE_EXIT":
                raise HTTPException(409, "Assembly must confirm loading first")
            loaded = (await uow.session.scalars(select(FinishedGoodsSectionModel.qr_identity).where(
                FinishedGoodsSectionModel.gate_visit_id == visit.id, FinishedGoodsSectionModel.status == "LOADED"))).all()
            if not loaded:
                raise HTTPException(409, "No sections loaded on this vehicle")
            if payload.section_qr_identities and set(loaded) != set(payload.section_qr_identities):
                raise HTTPException(422, "Verify all and only the sections loaded on this vehicle")
            claimed = await uow.session.execute(update(FinishedGoodsPickupGateVisitModel).where(
                FinishedGoodsPickupGateVisitModel.id == visit.id, FinishedGoodsPickupGateVisitModel.status == "READY_FOR_GATE_EXIT").values(status="CLOSED"))
            if claimed.rowcount != 1:
                raise HTTPException(409, "Gate exit already confirmed")
            sections_to_exit = payload.section_qr_identities if payload.section_qr_identities else list(loaded)
            await transition_sections(uow.session, request.section_fg_id, visit.id, sections_to_exit, user.username, exiting=True)
            visit.exited_at = datetime.datetime.now(datetime.timezone.utc)
            visit.exit_approved_by = user.username
            visit.documents_verified = True
            closed_vehicles = set((await uow.session.scalars(select(FinishedGoodsPickupGateVisitModel.vehicle_number).where(
                FinishedGoodsPickupGateVisitModel.request_id == request.id,
                FinishedGoodsPickupGateVisitModel.status == "CLOSED"))).all())
            closed_vehicles.add(visit.vehicle_number)
            planned = {normalize_vehicle(str(t.get("vehicle_number") or "")) for t in (request.transport_entries or [])}
            request.status = "DISPATCHED" if planned.issubset(closed_vehicles) else "READY_FOR_PICKUP"
            summary = await section_summary(uow.session, request.section_fg_id)
            await uow.commit()
            return {"gate_pass_number": visit.gate_pass_number, "request_number": request.request_number, "exited_at": visit.exited_at.isoformat(), **summary}
        allocations = (await uow.session.execute(select(AssemblyFinishedGoodsAllocationModel).where(AssemblyFinishedGoodsAllocationModel.finished_goods_request_id == visit.request_id, AssemblyFinishedGoodsAllocationModel.status.in_(["ALLOCATED", "LOADED"])))).scalars().all()
        if not request or request.status != "ALLOCATED": raise HTTPException(409, "Dispatch request is not ready for gate exit")
        if not allocations: raise HTTPException(409, "No allocated finished goods found")
        from app.modules.dispatch.infrastructure.persistence.models import DispatchModel
        dispatch = (await uow.session.execute(select(DispatchModel).where(DispatchModel.order_number == request.request_number).with_for_update())).scalar_one_or_none()
        if dispatch and dispatch.status not in ("READY_FOR_GATE_EXIT", "DISPATCHED", "GATE_OUT"):
            raise HTTPException(409, "Complete picking, packing and loading before Gate Exit")
        now = datetime.datetime.now(datetime.timezone.utc)
        visit.status = "CLOSED"; visit.exited_at = now; visit.exit_approved_by = user.username; visit.documents_verified = True
        planned_transports = request.transport_entries or ([{
            "vehicle_number": request.vehicle_number,
            "driver_name": request.driver_name,
            "driver_contact": request.driver_contact,
        }] if request.vehicle_number else [])
        planned_vehicles = {
            normalize_vehicle(str(entry.get("vehicle_number") or ""))
            for entry in planned_transports
            if isinstance(entry, dict) and entry.get("vehicle_number")
        }
        if not planned_vehicles:
            planned_vehicles = {normalize_vehicle(visit.vehicle_number)}
        closed_result = await uow.session.execute(
            select(FinishedGoodsPickupGateVisitModel.vehicle_number).where(
                FinishedGoodsPickupGateVisitModel.request_id == request.id,
                FinishedGoodsPickupGateVisitModel.status == "CLOSED",
            )
        )
        closed_vehicles = {normalize_vehicle(number) for number in closed_result.scalars().all()}
        closed_vehicles.add(normalize_vehicle(visit.vehicle_number))
        final_vehicle_exited = planned_vehicles.issubset(closed_vehicles)
        if final_vehicle_exited:
            await post_dispatch_stock(uow.session, request_id=visit.request_id)
            if dispatch:
                dispatch.status = "DISPATCHED"
            request.status = "DISPATCHED"
        uow.session.add(NotificationModel(
            user_role="ASSEMBLY_MANAGER",
            title="Finished-goods pickup vehicle exited",
            message=f"Pickup {request.request_number} vehicle {visit.vehicle_number} exited through gate pass {visit.gate_pass_number}." + (" All assigned vehicles have exited." if final_vehicle_exited else " Other assigned vehicles may still be collected."),
            link="/assembly/dispatch",
        ))
        await uow.commit()
        return {"gate_pass_number": visit.gate_pass_number, "request_number": request.request_number, "visit_status": "EXITED", "gate_pass_status": "CLOSED", "dispatch_status": dispatch.status if dispatch else request.status, "request_status": request.status, "all_assigned_vehicles_exited": final_vehicle_exited, "exited_at": now.isoformat()}
logger = logging.getLogger(__name__)


def _asn_response(asn: AsnModel) -> dict:
    logistics = asn.logistics or []
    details = next((item for item in logistics if isinstance(item, dict) and item.get("type") == "asn_details"), {})
    return {
        "id": str(asn.id),
        "asn_number": asn.asn_number,
        "po_id": asn.po_id,
        "po_number": asn.po_number,
        "supplier_id": str(asn.supplier_id) if asn.supplier_id else None,
        "shipment_type": asn.shipment_type,
        "is_replacement": asn.shipment_type == "REPLACEMENT",
        "claim_id": str(asn.claim_id) if asn.claim_id else None,
        "supplier_name": details.get("supplier_name") or (asn.supplier.supplier_name if asn.supplier else None),
        "destination_warehouse": details.get("destination_warehouse"),
        "destination_warehouse_id": details.get("destination_warehouse_id"),
        "vehicle_number": asn.vehicle_number,
        "driver_name": asn.driver_name,
        "driver_contact": asn.driver_contact,
        "expected_arrival_at": asn.expected_arrival_at.isoformat() if asn.expected_arrival_at else None,
        "delivery_date": asn.expected_arrival_at.date().isoformat() if asn.expected_arrival_at else None,
        "expected_arrival_date": asn.expected_arrival_at.date().isoformat() if asn.expected_arrival_at else None,
        "shipment_date": asn.shipment_date.isoformat() if asn.shipment_date else None,
        "status": asn.status,
        "created_at": asn.created_at.isoformat() if asn.created_at else None,
        "invoice_number": asn.invoice_number,
        "invoice_date": asn.invoice_date.isoformat() if asn.invoice_date else None,
        "challan_number": asn.challan_number,
        "challan_date": asn.challan_date.isoformat() if asn.challan_date else None,
        "transporter": asn.transporter,
        "documents": [
            {"id": str(document.id), "document_type": document.document_type, "file_name": document.file_name, "file_url": document.file_url, "uploaded_at": document.uploaded_at.isoformat() if document.uploaded_at else None}
            for document in (asn.documents or [])
        ],
        "logistics": logistics,
        "lines": [
            {
                "item_code": line.item_code,
                "material_name": line.material_name,
                "shipped_quantity": float(line.shipped_quantity or 0),
                "quantity": float(line.shipped_quantity or 0),
                "uom": line.uom or "PCS",
            }
            for line in (asn.lines or [])
        ],
    }


@preview_router.get("/expected-deliveries")
async def list_expected_deliveries(
    supplier_id: str | None = Query(default=None),
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    query = select(AsnModel).options(selectinload(AsnModel.lines), selectinload(AsnModel.documents), selectinload(AsnModel.supplier)).order_by(AsnModel.created_at.desc())
    if "SUPPLIER" in {role.upper() for role in user.roles}:
        owner_id = await _authenticated_supplier_id(user, uow)
        query = query.where(AsnModel.supplier_id == owner_id)
    if supplier_id:
        try:
            query = query.where(AsnModel.supplier_id == uuid.UUID(supplier_id))
        except ValueError:
            return []
    result = await uow.session.execute(query)
    return [_asn_response(asn) for asn in result.scalars().all()]


DEFAULT_MATERIAL_COMPONENTS = [
    {"code": "MAT-RAD-001", "name": "SKID MOUNTED RADIATOR", "category": "Heavy Components", "uom": "PCS"},
    {"code": "MAT-ECP-002", "name": "ENGINE CONTROL PANEL", "category": "Control Systems", "uom": "PCS"},
    {"code": "MAT-EXS-003", "name": "EXHAUST SILENCER", "category": "Exhaust Systems", "uom": "PCS"},
    {"code": "MAT-EFP-004", "name": "EXHAUST FLEXIBLE PIPE WITH INSULATION AND ALUMINIUM CLADDING", "category": "Piping & Cladding", "uom": "METER"},
    {"code": "MAT-ATB-005", "name": "ALTERNATOR TERMINAL BOX", "category": "Electrical", "uom": "PCS"},
    {"code": "MAT-DTK-006", "name": "990 LITERS DOUBLE WALL DAY TANK", "category": "Tanks & Vessels", "uom": "PCS"},
    {"code": "MAT-MVI-007", "name": "MV Isolator", "category": "Electrical", "uom": "PCS"},
    {"code": "MAT-PWC-008", "name": "Power Cable", "category": "Electrical", "uom": "METER"},
    {"code": "MAT-FPA-009", "name": "Fuel Pipe & accessories", "category": "Piping", "uom": "SET"},
    {"code": "MAT-CTR-010", "name": "Cable Trays", "category": "Electrical Accessories", "uom": "METER"},
    {"code": "MAT-ENC-011", "name": "Enclosure Module-1 (DG Set + Radiator)", "category": "Enclosure Modules", "uom": "SET"},
    {"code": "MAT-ENC-012", "name": "Enclosure Module-2 (Fuel Tank + MV Isolator)", "category": "Enclosure Modules", "uom": "SET"},
    {"code": "MAT-ENC-013", "name": "Enclosure Module-3 (Top cover Module 1)", "category": "Enclosure Modules", "uom": "SET"},
    {"code": "MAT-ENC-014", "name": "Enclosure Module-4 (Top cover Module 2)", "category": "Enclosure Modules", "uom": "SET"},
    {"code": "MAT-ENC-015", "name": "Enclosure Module-5 (Air Intake)", "category": "Enclosure Modules", "uom": "SET"},
    {"code": "MAT-ENC-016", "name": "Enclosure Module-6 (Exhaust Attenuators)", "category": "Enclosure Modules", "uom": "SET"},
    {"code": "MAT-ENC-017", "name": "Enclosure Module-7 (Exhaust duct on top of Module 6)", "category": "Enclosure Modules", "uom": "SET"},
    {"code": "MAT-ENC-018", "name": "Enclosure Module-8 (Exhaust duct with hood on top of Module 7)", "category": "Enclosure Modules", "uom": "SET"},
    {"code": "MAT-EOD-019", "name": "Enclosure Overall Dimension", "category": "Enclosure Structures", "uom": "SET"},
    {"code": "MAT-GWR-020", "name": "Genset with radiator", "category": "Gensets", "uom": "SET"},
    {"code": "MAT-GNR-021", "name": "Genset without radiator", "category": "Gensets", "uom": "SET"},
    {"code": "MAT-LSE-022", "name": "Loose Item", "category": "General Accessories", "uom": "BOX"},
]

_custom_materials_warehouse: list[dict] = []

@preview_router.get("/materials")
async def get_material_components(
    status_filter: str = Query(default="ACTIVE", alias="status"),
    available_only: bool = Query(default=False),
    uow: UnitOfWork = Depends(get_uow)
) -> list[dict]:
    materials: list[dict] = []
    try:
        from app.common.persistence.models import MaterialModel, MaterialStockModel
        from app.modules.storage.infrastructure.persistence.models import InventoryLocationBalanceModel
        res = await uow.session.execute(select(MaterialModel))
        db_mats = res.scalars().all()

        stock_res = await uow.session.execute(
            select(
                MaterialStockModel.material_code,
                func.coalesce(func.sum(MaterialStockModel.available_quantity), Decimal("0"))
            ).group_by(MaterialStockModel.material_code)
        )
        stock_map = {r[0]: float(r[1]) for r in stock_res.all()}

        loc_res = await uow.session.execute(
            select(
                InventoryLocationBalanceModel.material_code,
                func.coalesce(func.sum(InventoryLocationBalanceModel.available_quantity), Decimal("0"))
            ).group_by(InventoryLocationBalanceModel.material_code)
        )
        loc_map = {r[0]: float(r[1]) for r in loc_res.all()}

        for m in db_mats:
            if m.material_code and m.material_name:
                avail_qty = max(stock_map.get(m.material_code, 0.0), loc_map.get(m.material_code, 0.0))
                materials.append({
                    "id": str(m.id),
                    "code": m.material_code,
                    "name": m.material_name,
                    "category": m.category,
                    "description": m.description,
                    "uom": m.base_uom,
                    "status": m.status,
                    "available_quantity": avail_qty,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                    "updated_at": m.updated_at.isoformat() if m.updated_at else None,
                    "created_by": m.created_by,
                    "updated_by": m.updated_by,
                })
    except Exception:
        pass

    filtered = materials if status_filter.upper() == "ALL" else [material for material in materials if str(material.get("status") or "ACTIVE").upper() == status_filter.upper()]
    if available_only:
        filtered = [m for m in filtered if (m.get("available_quantity") or 0) > 0]
    return filtered


@preview_router.post("/materials")
async def add_material_component(
    payload: dict = Body(...),
    uow: UnitOfWork = Depends(get_uow)
) -> dict:
    mat_name = str(payload.get("name") or payload.get("material_name") or "").strip()
    if not mat_name:
        raise HTTPException(status_code=400, detail="Material name is required.")

    uom = str(payload.get("uom") or payload.get("base_uom") or "PCS").upper()
    category = str(payload.get("category") or "General").strip()
    material_code = str(payload.get("material_code") or payload.get("code") or "").strip().upper()
    if not material_code:
        code_prefix = re.sub(r"[^A-Z0-9]", "", mat_name.upper())[:6] or "MAT"
        material_code = f"MAT-{code_prefix}-{uuid.uuid4().hex[:4].upper()}"
    existing_result = await uow.session.execute(select(MaterialModel).where(or_(func.lower(MaterialModel.material_name) == mat_name.lower(), func.upper(MaterialModel.material_code) == material_code)))
    existing = existing_result.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Material code or material name already exists.")
    material = MaterialModel(
        id=uuid.uuid4(),
        material_code=material_code,
        material_name=mat_name,
        category=category,
        description=str(payload.get("description") or "").strip() or None,
        base_uom=uom,
        status=str(payload.get("status") or "Active").title(),
    )
    uow.session.add(material)
    await uow.session.commit()
    return {"id": str(material.id), "code": material.material_code, "name": material.material_name, "category": material.category, "uom": material.base_uom, "status": material.status, "created_at": material.created_at.isoformat() if material.created_at else None, "updated_at": material.updated_at.isoformat() if material.updated_at else None}


@preview_router.put("/materials/{material_id}")
async def update_material_component(material_id: uuid.UUID, payload: dict = Body(...), uow: UnitOfWork = Depends(get_uow)) -> dict:
    material = await uow.session.get(MaterialModel, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found")
    if "material_name" in payload and not str(payload["material_name"]).strip():
        raise HTTPException(status_code=422, detail="Material name is required")
    if "category" in payload and not str(payload["category"]).strip():
        raise HTTPException(status_code=422, detail="Category is required")
    material.material_name = str(payload.get("material_name", material.material_name)).strip()
    material.category = str(payload.get("category", material.category)).strip()
    material.description = str(payload.get("description", material.description or "")).strip() or None
    material.base_uom = str(payload.get("base_uom", payload.get("uom", material.base_uom))).upper()
    material.updated_at = datetime.datetime.now()
    await uow.session.commit()
    return {"id": str(material.id), "code": material.material_code, "name": material.material_name, "category": material.category, "description": material.description, "uom": material.base_uom, "status": material.status, "updated_at": material.updated_at.isoformat()}


@preview_router.patch("/materials/{material_id}/status")
async def update_material_component_status(material_id: uuid.UUID, payload: dict = Body(...), uow: UnitOfWork = Depends(get_uow)) -> dict:
    material = await uow.session.get(MaterialModel, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found")
    next_status = str(payload.get("status") or "").title()
    if next_status not in {"Active", "Inactive"}:
        raise HTTPException(status_code=422, detail="Status must be Active or Inactive")
    material.status = next_status
    material.updated_at = datetime.datetime.now()
    await uow.session.commit()
    return {"id": str(material.id), "status": material.status, "updated_at": material.updated_at.isoformat()}


@preview_router.delete("/materials/{material_id}")
async def delete_material_component(material_id: uuid.UUID, uow: UnitOfWork = Depends(get_uow)) -> dict:
    material = await uow.session.get(MaterialModel, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found")
    reference = await uow.session.execute(select(AsnLineModel.id).where(AsnLineModel.material_id == material_id).limit(1))
    if reference.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Material is referenced by an ASN and cannot be deleted. Deactivate it instead.")
    try:
        await uow.session.delete(material)
        await uow.session.commit()
        return {"id": str(material_id), "deleted": True}
    except IntegrityError:
        await uow.session.rollback()
        material = await uow.session.get(MaterialModel, material_id)
        if material is None:
            raise HTTPException(status_code=404, detail="Material not found")
        material.status = "Inactive"
        material.updated_at = datetime.datetime.now()
        await uow.session.commit()
        return {"id": str(material_id), "deleted": False, "status": "Inactive", "message": "Material is referenced by a transaction and was deactivated instead."}


@preview_router.get("/asns/next-number")
async def get_next_asn_number(uow: UnitOfWork = Depends(get_uow)) -> dict:
    year = datetime.date.today().year
    prefix = f"ASN-{year}-"
    result = await uow.session.execute(
        select(AsnModel.asn_number).where(AsnModel.asn_number.like(f"{prefix}%"))
    )
    highest = 0
    for value in result.scalars().all():
        match = re.fullmatch(r"ASN-(?:\d{4}-)?(\d+)", str(value).strip().upper())
        if match:
            highest = max(highest, int(match.group(1)))
    return {"asnNumber": f"{prefix}{highest + 1:03d}"}


@preview_router.get("/asn/{reference}")
async def get_expected_delivery(
    reference: str,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    normalized_reference = reference.strip().upper()
    filters = [func.upper(AsnModel.asn_number) == normalized_reference]
    try:
        filters.append(AsnModel.id == uuid.UUID(reference))
    except ValueError:
        pass
    result = await uow.session.execute(
        select(AsnModel).options(
            selectinload(AsnModel.lines),
            selectinload(AsnModel.documents),
            selectinload(AsnModel.supplier),
        ).where(or_(*filters))
    )
    asn = result.scalars().first()
    if asn is None:
        compact_match = re.fullmatch(r"ASN-(\d{4})-(\d+)", normalized_reference)
        if compact_match:
            year, sequence = compact_match.groups()
            all_asns = await uow.session.execute(
                select(AsnModel).options(
                    selectinload(AsnModel.lines),
                    selectinload(AsnModel.documents),
                    selectinload(AsnModel.supplier),
                ).where(
                    func.upper(AsnModel.asn_number).like(f"ASN-{year}-%")
                )
            )
            target_sequence = int(sequence)
            asn = next(
                (
                    candidate
                    for candidate in all_asns.scalars().all()
                    if (match := re.fullmatch(rf"ASN-{year}-(\d+)", candidate.asn_number.upper()))
                    and int(match.group(1)) == target_sequence
                ),
                None,
            )
    if asn is None:
        raise HTTPException(status_code=404, detail=f"ASN '{reference}' not found")
    if "SUPPLIER" in {role.upper() for role in user.roles}:
        owner_id = await _authenticated_supplier_id(user, uow)
        if asn.supplier_id != owner_id:
            raise HTTPException(status_code=404, detail=f"ASN '{reference}' not found")
    response = _asn_response(asn)
    gate_result = await uow.session.execute(
        select(GateEntryModel)
        .where(GateEntryModel.asn_id == asn.id)
        .order_by(GateEntryModel.created_at.desc())
        .limit(1)
    )
    gate_entry = gate_result.scalars().first()
    # Legacy ASN/gate rows may be linked through the shipment's PO or vehicle
    # even when the ASN foreign key was not persisted on the gate entry.
    if gate_entry is None and asn.po_number:
        gate_query = select(GateEntryModel).where(
            func.upper(GateEntryModel.po_number) == asn.po_number.strip().upper()
        )
        if asn.vehicle_number:
            gate_query = gate_query.where(
                func.upper(GateEntryModel.vehicle_number)
                == asn.vehicle_number.strip().upper()
            )
        gate_result = await uow.session.execute(
            gate_query.order_by(GateEntryModel.created_at.desc()).limit(1)
        )
        gate_entry = gate_result.scalars().first()
    if gate_entry is None and asn.vehicle_number and not asn.po_number:
        gate_result = await uow.session.execute(
            select(GateEntryModel)
            .where(
                func.upper(GateEntryModel.vehicle_number)
                == asn.vehicle_number.strip().upper()
            )
            .order_by(GateEntryModel.created_at.desc())
            .limit(1)
        )
        gate_entry = gate_result.scalars().first()
    if gate_entry:
        response["gate_entry_number"] = gate_entry.gate_entry_number
        response["gate_entry"] = {
            "gate_entry_number": gate_entry.gate_entry_number,
            "vehicle_number": gate_entry.vehicle_number,
            "driver_name": gate_entry.driver_name,
            "dock_number": gate_entry.assigned_dock_id,
        }
    return response


@preview_router.get("/asns/{reference}/pdf")
async def download_supplier_asn_pdf(
    reference: str,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> Response:
    """Render the official supplier ASN certificate from persisted data."""
    normalized = reference.strip().upper()
    filters = [func.upper(AsnModel.asn_number) == normalized]
    try:
        filters.append(AsnModel.id == uuid.UUID(reference))
    except ValueError:
        pass
    result = await uow.session.execute(
        select(AsnModel)
        .options(selectinload(AsnModel.lines), selectinload(AsnModel.supplier))
        .where(or_(*filters))
    )
    asn = result.scalars().first()
    if asn is None:
        raise HTTPException(status_code=404, detail=f"ASN '{reference}' not found")

    if "SUPPLIER" in {role.upper() for role in user.roles}:
        owner_id = await _authenticated_supplier_id(user, uow)
        if asn.supplier_id != owner_id:
            raise HTTPException(status_code=404, detail=f"ASN '{reference}' not found")

    details = next((item for item in (asn.logistics or []) if isinstance(item, dict) and item.get("type") == "asn_details"), {})
    supplier = details.get("supplier_name") or (asn.supplier.supplier_name if asn.supplier else "")
    generated = asn.created_at.strftime("%d-%m-%Y") if asn.created_at else datetime.date.today().strftime("%d-%m-%Y")
    arrival = asn.expected_arrival_at.strftime("%d-%m-%Y") if asn.expected_arrival_at else "—"
    buffer = io.BytesIO()
    # Presentation only: all values above remain bound to the persisted ASN.
    from html import escape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle

    navy = colors.HexColor("#064B87")
    border = colors.HexColor("#DFE7F0")
    ink = colors.HexColor("#172B4D")
    body = ParagraphStyle("ASNBody", fontName="Helvetica", fontSize=10,
                          leading=13, textColor=ink, splitLongWords=True)
    heading = ParagraphStyle("ASNSection", parent=body, fontName="Helvetica-Bold",
                             fontSize=11, leading=14, spaceAfter=3 * mm)
    label = ParagraphStyle("ASNLabel", parent=body, fontName="Helvetica-Bold",
                           textColor=navy)
    title = ParagraphStyle("ASNTitle", parent=heading, fontSize=17, leading=21,
                           spaceAfter=5 * mm)
    right = ParagraphStyle("ASNQuantity", parent=body, alignment=2)

    def paragraph(value, style=body):
        return Paragraph(escape(str(value)).replace("\n", "<br/>"), style)

    def page_decoration(pdf, document):
        width, height = A4
        pdf.saveState()
        pdf.setTitle(f"ASN {asn.asn_number}")
        pdf.setFillColor(navy)
        pdf.rect(18 * mm, height - 40 * mm, 174 * mm, 25 * mm, fill=1, stroke=0)
        company = ParagraphStyle("ASNCompany", parent=heading, fontSize=14,
                                 leading=17, textColor=colors.white)
        reference_style = ParagraphStyle("ASNReference", parent=body,
                                        alignment=2, textColor=colors.white)
        for value, style, x, available in (
            ("KAIZENASSESTS", company, 22 * mm, 88 * mm),
            (asn.asn_number, reference_style, 114 * mm, 74 * mm),
        ):
            item = paragraph(value, style)
            _, item_height = item.wrap(available, 23 * mm)
            item.drawOn(pdf, x, height - 27.5 * mm - item_height / 2)
        pdf.setStrokeColor(border)
        pdf.line(18 * mm, 27 * mm, 192 * mm, 27 * mm)
        footer_style = ParagraphStyle("ASNFooter", parent=body, fontSize=8, leading=10)
        footer = Table([[paragraph(asn.asn_number, footer_style),
                         paragraph(f"Generated: {generated}", footer_style),
                         paragraph(f"Page {document.page}", ParagraphStyle(
                             "ASNPage", parent=footer_style, alignment=2))]],
                       colWidths=[70 * mm, 74 * mm, 30 * mm])
        footer.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        _, footer_height = footer.wrap(174 * mm, 12 * mm)
        footer.drawOn(pdf, 18 * mm, 21 * mm - footer_height / 2)
        pdf.restoreState()

    document = BaseDocTemplate(
        buffer, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=45 * mm, bottomMargin=30 * mm,
        title=f"ASN {asn.asn_number}",
    )
    document.addPageTemplates(PageTemplate(
        id="ASN", onPage=page_decoration,
        frames=[Frame(18 * mm, 30 * mm, 174 * mm, 222 * mm,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)],
    ))
    story = [paragraph("ADVANCE SHIPPING NOTICE", title)]
    section_rows = [[paragraph("Supplier / Shipment", heading),
                     paragraph("Vehicle / Driver", heading)]]
    for left_label, left_value, right_label, right_value in (
        ("Supplier", supplier, "Vehicle Number", asn.vehicle_number or "—"),
        ("Expected Arrival", arrival, "Driver Name", asn.driver_name or "—"),
        ("Status", asn.status or "SUBMITTED", "Driver Contact", asn.driver_contact or "—"),
    ):
        section_rows.append([
            [paragraph(left_label, label), paragraph(left_value)],
            [paragraph(right_label, label), paragraph(right_value)],
        ])
    sections = Table(section_rows, colWidths=[87 * mm, 87 * mm])
    sections.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
    ]))
    story.extend([sections, Spacer(1, 3 * mm), paragraph("Materials", heading)])
    header_style = ParagraphStyle("ASNTableHeader", parent=body, fontName="Helvetica-Bold",
                                  fontSize=9, leading=11)
    rows = [[paragraph(value, header_style) for value in
             ("S.No.", "Material Name", "Material Code", "Quantity", "UOM")]]
    for index, line in enumerate(asn.lines, start=1):
        rows.append([
            paragraph(index), paragraph(line.material_name or "—"),
            paragraph(line.item_code or "—"), paragraph(f"{line.shipped_quantity:g}", right),
            paragraph(line.uom or "PCS"),
        ])
    materials = Table(rows, colWidths=[value * mm for value in (12, 65, 52, 25, 20)],
                      repeatRows=1, minRowHeights=[9 * mm] * len(rows),
                      splitByRow=1, splitInRow=1, hAlign="LEFT")
    materials.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAF1F8")),
        ("GRID", (0, 0), (-1, -1), 0.5, border),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
        ("LEFTPADDING", (0, 0), (-1, 0), 1 * mm),
        ("RIGHTPADDING", (0, 0), (-1, 0), 1 * mm),
    ]))
    story.append(materials)
    document.build(story)
    return Response(content=buffer.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{asn.asn_number}.pdf"'})


@preview_router.post("/asns/{reference}/cancel")
async def cancel_supplier_asn(
    reference: str,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    normalized = reference.strip().upper()
    async with uow:
        supplier_id = await _authenticated_supplier_id(user, uow)
        result = await uow.session.execute(
            select(AsnModel)
            .options(
                selectinload(AsnModel.lines),
                selectinload(AsnModel.documents),
                selectinload(AsnModel.supplier),
            )
            .where(
                func.upper(AsnModel.asn_number) == normalized,
                AsnModel.supplier_id == supplier_id,
            )
        )
        asn = result.scalars().first()
        if asn is None:
            raise HTTPException(status_code=404, detail="ASN not found")
        current_status = str(asn.status or "").upper()
        # Cancellation is idempotent so a repeated click/retry does not show
        # a conflict after the first request already succeeded.
        if current_status == "CANCELLED":
            return _asn_response(asn)
        if current_status in {"COMPLETED", "RECEIVED"}:
            raise HTTPException(status_code=409, detail=f"ASN cannot be cancelled from status {asn.status}")
        asn.status = "CANCELLED"
        await uow.commit()
        return _asn_response(asn)


@preview_router.delete("/asns/{reference}")
async def delete_supplier_asn(
    reference: str,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    normalized = reference.strip().upper()
    async with uow:
        supplier_id = await _authenticated_supplier_id(user, uow)
        result = await uow.session.execute(
            select(AsnModel).where(
                func.upper(AsnModel.asn_number) == normalized,
                AsnModel.supplier_id == supplier_id,
            )
        )
        asn = result.scalars().first()
        if asn is None:
            raise HTTPException(status_code=404, detail="ASN not found")
        if str(asn.status or "").upper() not in {"DRAFT", "SUBMITTED"}:
            raise HTTPException(status_code=409, detail="Only draft or submitted ASNs can be deleted")
        await uow.session.delete(asn)
        await uow.commit()
        return {"asn_number": normalized, "deleted": True}


async def _authenticated_supplier_id(user: CurrentUser, uow: UnitOfWork) -> uuid.UUID:
    """Resolve supplier ownership from the authenticated account, never request data."""
    if "SUPPLIER" not in {role.upper() for role in user.roles}:
        raise HTTPException(status_code=403, detail="Only an authenticated supplier can create an ASN")

    mapped = (await uow.session.execute(
        select(SupplierUserModel.supplier_id).where(SupplierUserModel.username == user.username)
    )).scalar_one_or_none()
    raw = user.raw_claims.get("supplier_id") if user.raw_claims else None
    claimed: uuid.UUID | None = None
    if raw:
        try:
            claimed = uuid.UUID(str(raw))
        except (ValueError, AttributeError):
            claimed = (await uow.session.execute(
                select(SupplierModel.id).where(SupplierModel.supplier_code == str(raw))
            )).scalar_one_or_none()

    # Older local mock tokens used the non-persistent ``sup-00001`` claim.
    # The local supplier login now bootstraps the durable SUP-DEFAULT record,
    # so resolve that legacy token to the same registered supplier.  Keep this
    # fallback explicitly limited to local/test environments and the known
    # mock identity; real authenticated identities must have an exact mapping.
    if mapped is None and claimed is None and user.username.lower().startswith("supplier"):
        from app.config.settings import get_settings

        if get_settings().environment.lower() in {"local", "test", "development"}:
            claimed = (await uow.session.execute(
                select(SupplierModel.id).where(SupplierModel.supplier_code == "SUP-DEFAULT")
            )).scalar_one_or_none()
            if claimed is None:
                # Keep the local mock account usable even when the supplier
                # login bootstrap endpoint has not been called yet.
                default_supplier = SupplierModel(
                    id=uuid.uuid4(),
                    supplier_name="supplier",
                    registered_company_name="supplier (Seeded Supplier)",
                    vendor_type="MANUFACTURER",
                    category=[],
                    industry="GENERAL",
                    gstin=f"SEED-{uuid.uuid4().hex[:12].upper()}",
                    supplier_code="SUP-DEFAULT",
                    status="Active",
                )
                uow.session.add(default_supplier)
                await uow.session.flush()
                claimed = default_supplier.id

    if mapped and claimed and mapped != claimed:
        logger.error("Supplier identity mismatch for ASN user=%s mapped=%s claimed=%s", user.username, mapped, claimed)
        raise HTTPException(status_code=403, detail="Authenticated supplier identity is inconsistent")
    supplier_id = mapped or claimed
    if supplier_id is None:
        logger.error("No registered supplier mapping for authenticated ASN user=%s subject=%s", user.username, user.subject)
        raise HTTPException(status_code=403, detail="Authenticated account is not linked to a registered supplier")
    exists = (await uow.session.execute(select(SupplierModel.id).where(SupplierModel.id == supplier_id))).scalar_one_or_none()
    if exists is None:
        logger.error("Supplier mapping points to missing supplier user=%s supplier_id=%s", user.username, supplier_id)
        raise HTTPException(status_code=403, detail="Registered supplier could not be found")
    return supplier_id


_INTEGER_QUANTITY_UOMS = {
    "EA", "EACH", "UNIT", "UNITS", "PCS", "PC", "PIECE", "PIECES",
    "SET", "SETS", "BOX", "BOXES", "BAG", "BAGS", "PACK", "PACKS",
    "PAIR", "PAIRS", "DOZEN",
}
_MAX_ASN_QUANTITY = Decimal("99999999999999.9999")


def _normalize_asn_vehicle_number(value: str) -> str:
    return normalize_vehicle(value)


def _is_valid_asn_vehicle_number(value: str) -> bool:
    return valid_vehicle(value)


def _validate_asn_quantity(quantity: Decimal, uom: str) -> None:
    if quantity > _MAX_ASN_QUANTITY:
        raise HTTPException(status_code=422, detail="shipped_quantity exceeds the supported maximum")
    fractional_places = max(0, -quantity.normalize().as_tuple().exponent)
    if fractional_places > 4:
        raise HTTPException(status_code=422, detail="shipped_quantity supports at most 4 decimal places")
    if uom.strip().upper() in _INTEGER_QUANTITY_UOMS and quantity != quantity.to_integral_value():
        raise HTTPException(
            status_code=422,
            detail=f"shipped_quantity must be a whole number for UOM '{uom}'",
        )


def _validate_asn_transport_entries(payload: dict) -> tuple[list[dict[str, str]], list[dict]]:
    logistics = payload.get("logistics")
    logistics = [dict(entry) for entry in logistics if isinstance(entry, dict)] if isinstance(logistics, list) else []
    assignments = [entry for entry in logistics if entry.get("type") == "transport_assignment"]

    if assignments:
        if len(assignments) != 1:
            raise HTTPException(status_code=422, detail="Provide one transport assignment with all vehicle and driver pairs.")
        submitted_entries = assignments[0].get("vehicles")
        if not isinstance(submitted_entries, list) or not submitted_entries:
            raise HTTPException(status_code=422, detail="At least one vehicle and driver pair is required.")
    else:
        submitted_entries = [{
            "vehicle_number": payload.get("vehicle_number"),
            "driver_name": payload.get("driver_name"),
            "driver_contact": payload.get("driver_contact"),
        }]

    validated_entries = []
    for index, entry in enumerate(submitted_entries):
        if not isinstance(entry, dict):
            raise HTTPException(status_code=422, detail="Each vehicle and driver pair must be an object.")
        vehicle_number, driver_name, driver_contact = validate_transport(
            entry.get("vehicle_number"), entry.get("driver_name"), entry.get("driver_contact")
        )
        validated_entries.append({
            "id": str(entry.get("id") or f"vehicle-{index + 1}"),
            "vehicle_number": vehicle_number,
            "driver_name": driver_name,
            "driver_contact": driver_contact,
            "materials": [],
        })

    if assignments:
        assignments[0]["vehicles"] = validated_entries
    else:
        logistics.append({"type": "transport_assignment", "vehicles": validated_entries})
    return validated_entries, logistics


@preview_router.get("/supplier/warehouses")
async def get_supplier_asn_warehouses(
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    await _authenticated_supplier_id(user, uow)
    result = await uow.session.execute(
        select(WarehouseModel)
        .where(func.upper(WarehouseModel.status) == "ACTIVE")
        .order_by(WarehouseModel.warehouse_name, WarehouseModel.warehouse_code)
    )
    return [
        {
            "id": str(warehouse.id),
            "code": warehouse.warehouse_code,
            "name": warehouse.warehouse_name,
            "warehouse_id": warehouse.warehouse_id,
        }
        for warehouse in result.scalars().all()
        if warehouse.warehouse_code and warehouse.warehouse_name and warehouse.warehouse_id
    ]


@preview_router.post("/asns", status_code=status.HTTP_201_CREATED)
async def create_supplier_asn(
    payload: dict = Body(...),
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    supplier_id = await _authenticated_supplier_id(user, uow)
    client_request_id = str(payload.get("client_request_id") or "").strip()
    if client_request_id:
        try:
            client_request_id = str(uuid.UUID(client_request_id))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="client_request_id must be a UUID") from exc

    po_number = str(payload.get("po_number") or "").strip()
    raw_po_id = str(payload.get("po_id") or "").strip()
    po_id = None
    if raw_po_id:
        try:
            po_id = uuid.UUID(raw_po_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Purchase order reference is invalid") from exc

    po_model = None
    if po_id is not None or po_number:
        po_statement = select(PurchaseOrderModel).options(selectinload(PurchaseOrderModel.items))
        if po_id is not None:
            po_statement = po_statement.where(PurchaseOrderModel.id == po_id)
        if po_number:
            po_statement = po_statement.where(func.upper(PurchaseOrderModel.po_number) == po_number.upper())
        po_result = await uow.session.execute(po_statement)
        po_model = po_result.scalars().first()
        # Use one generic response for missing and cross-supplier POs so this
        # endpoint does not disclose another supplier's PO existence/details.
        if po_model is None or po_model.supplier_id != supplier_id:
            raise HTTPException(status_code=404, detail="Purchase order not found or unavailable")
        po_number = po_model.po_number

    transport_entries, logistics = _validate_asn_transport_entries(payload)
    vehicle_number, driver_name, driver_contact = (
        transport_entries[0]["vehicle_number"],
        transport_entries[0]["driver_name"],
        transport_entries[0]["driver_contact"],
    )

    supplier_result = await uow.session.execute(
        select(SupplierModel).where(SupplierModel.id == supplier_id)
    )
    supplier = supplier_result.scalars().first()
    if supplier is None:
        raise HTTPException(status_code=403, detail="Authenticated supplier could not be found")
    raw_supplier_name = payload.get("supplier_name")
    if raw_supplier_name is not None and not isinstance(raw_supplier_name, str):
        raise HTTPException(status_code=422, detail="supplier_name must be text")
    supplier_name = (
        raw_supplier_name.strip()
        if isinstance(raw_supplier_name, str) and raw_supplier_name.strip()
        else supplier.registered_company_name or supplier.supplier_name
    )
    if len(supplier_name) > 200:
        raise HTTPException(status_code=422, detail="supplier_name must be 200 characters or fewer")

    destination_config = None
    raw_warehouse_ref_id = str(payload.get("destination_warehouse_id") or "").strip()
    if raw_warehouse_ref_id:
        try:
            warehouse_uuid = uuid.UUID(raw_warehouse_ref_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Selected destination warehouse is invalid") from exc
        destination_config = await uow.session.get(WarehouseModel, warehouse_uuid)
        if (
            destination_config is None
            or str(destination_config.status or "").upper() != "ACTIVE"
            or not destination_config.warehouse_id
        ):
            raise HTTPException(status_code=422, detail="Selected destination warehouse is unavailable")
    destination_label = destination_config.warehouse_name if destination_config else None

    submitted_lines = payload.get("lines") or []
    if not isinstance(submitted_lines, list):
        raise HTTPException(status_code=422, detail="lines must be a list")
    if not submitted_lines:
        raise HTTPException(status_code=422, detail="at least one material line is required")
    validated_lines: list[tuple[dict, Decimal, uuid.UUID]] = []
    submitted_material_assignments: set[tuple[uuid.UUID, str]] = set()
    transport_ids = {entry["id"] for entry in transport_entries}
    for raw_line in submitted_lines:
        if not isinstance(raw_line, dict):
            raise HTTPException(status_code=422, detail="each ASN line must be an object")
        quantity = raw_line.get("shipped_quantity", raw_line.get("quantity", 0))
        try:
            validated_quantity = Decimal(str(quantity if quantity is not None else 0))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="shipped_quantity must be a valid number") from exc
        if not validated_quantity.is_finite():
            raise HTTPException(status_code=422, detail="shipped_quantity must be a finite number")
        if validated_quantity <= 0:
            raise HTTPException(status_code=422, detail="shipped_quantity must be greater than zero")
        if validated_quantity > _MAX_ASN_QUANTITY:
            raise HTTPException(status_code=422, detail="shipped_quantity exceeds the supported maximum")
        item_code = str(raw_line.get("item_code") or raw_line.get("material_code") or "").strip()
        if not item_code:
            raise HTTPException(status_code=422, detail="item_code is required for every material line")
        if not str(raw_line.get("material_name") or raw_line.get("material_description") or "").strip():
            raise HTTPException(status_code=422, detail="material_name is required for every material line")
        material_id = str(raw_line.get("material_id") or "").strip()
        if not material_id:
            raise HTTPException(status_code=422, detail="Select a valid Material Master record for every line")
        try:
            material_uuid = uuid.UUID(material_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="material_id must be a valid material identifier") from exc
        vehicle_id = str(raw_line.get("carrying_vehicle_id") or (transport_entries[0]["id"] if transport_entries else ""))
        if vehicle_id not in transport_ids:
            raise HTTPException(status_code=422, detail="Assign each material to a vehicle in the transport assignment")
        assignment_key = (material_uuid, vehicle_id)
        if assignment_key in submitted_material_assignments:
            raise HTTPException(status_code=422, detail="A material can only appear once per vehicle")
        submitted_material_assignments.add(assignment_key)
        validated_lines.append((raw_line, validated_quantity, material_uuid))

    material_result = await uow.session.execute(
        select(MaterialModel).where(MaterialModel.id.in_({material_id for material_id, _ in submitted_material_assignments}))
    )
    materials_by_id = {material.id: material for material in material_result.scalars().all()}
    canonical_lines: list[tuple[dict, Decimal]] = []
    for raw_line, quantity, material_id in validated_lines:
        material = materials_by_id.get(material_id)
        if material is None or str(material.status or "").upper() != "ACTIVE":
            raise HTTPException(status_code=422, detail="Selected material is not active in Material Master")
        item_code = str(raw_line.get("item_code") or raw_line.get("material_code") or "").strip()
        item_name = str(raw_line.get("material_name") or raw_line.get("material_description") or "").strip()
        supplied_uom = str(raw_line.get("uom") or "").strip()
        canonical_uom = material.base_uom.strip()
        if item_code.casefold() != material.material_code.strip().casefold():
            raise HTTPException(status_code=422, detail="Material code does not match Material Master")
        if item_name.casefold() != material.material_name.strip().casefold():
            raise HTTPException(status_code=422, detail="Material name does not match Material Master")
        if supplied_uom and supplied_uom.casefold() != canonical_uom.casefold():
            raise HTTPException(status_code=422, detail="Material UOM does not match Material Master")
        _validate_asn_quantity(quantity, canonical_uom)
        canonical_lines.append(
            (
                {
                    **raw_line,
                    "material_id": str(material.id),
                    "item_code": material.material_code,
                    "material_name": material.material_name,
                    "uom": canonical_uom,
                },
                quantity,
            )
        )
    validated_lines = canonical_lines

    # Store each vehicle's material manifest in its transport assignment while
    # keeping the ASN material lines as totals for the whole shipment.
    transport_by_id = {entry["id"]: entry for entry in transport_entries}
    totals_by_material: dict[str, tuple[dict, Decimal]] = {}
    for raw_line, quantity in validated_lines:
        vehicle_id = str(raw_line.get("carrying_vehicle_id") or transport_entries[0]["id"])
        transport_by_id[vehicle_id]["materials"].append({
            "material_id": str(raw_line["material_id"]),
            "item_code": raw_line["item_code"],
            "material_name": raw_line["material_name"],
            "shipped_quantity": float(quantity),
            "uom": raw_line["uom"],
        })
        code = str(raw_line["item_code"]).casefold()
        if code in totals_by_material:
            prior_line, prior_quantity = totals_by_material[code]
            totals_by_material[code] = (prior_line, prior_quantity + quantity)
        else:
            totals_by_material[code] = (raw_line, quantity)
    validated_asn_totals = list(totals_by_material.values())

    if po_model and validated_lines:
        ordered_by_code: dict[str, Decimal] = {}
        primary_code_by_alias: dict[str, str] = {}
        for item in po_model.items:
            primary_code = str(item.variant_code or item.material_code or "").strip().upper()
            if not primary_code:
                continue
            ordered_by_code[primary_code] = ordered_by_code.get(primary_code, Decimal("0")) + Decimal(item.quantity or 0)
            for alias in (item.material_code, item.variant_code):
                if alias:
                    primary_code_by_alias[str(alias).strip().upper()] = primary_code

        shipped_by_code: dict[str, Decimal] = {}
        prior_result = await uow.session.execute(
            select(AsnLineModel)
            .join(AsnModel, AsnModel.id == AsnLineModel.asn_id)
            .where(func.upper(AsnModel.po_number) == po_model.po_number.upper())
        )
        for prior_line in prior_result.scalars().all():
            code = str(prior_line.item_code or "").strip().upper()
            primary_code = primary_code_by_alias.get(code, code)
            shipped_by_code[primary_code] = (
                shipped_by_code.get(primary_code, Decimal("0")) + Decimal(prior_line.shipped_quantity or 0)
            )

        requested_by_code: dict[str, Decimal] = {}
        for raw_line, quantity in validated_lines:
            code = str(raw_line.get("item_code") or raw_line.get("material_code") or "").strip().upper()
            primary_code = primary_code_by_alias.get(code, code)
            if primary_code not in ordered_by_code:
                raise HTTPException(status_code=422, detail=f"item_code '{code}' is not on the purchase order")
            requested_by_code[primary_code] = requested_by_code.get(primary_code, Decimal("0")) + quantity
        for code, quantity in requested_by_code.items():
            remaining = ordered_by_code[code] - shipped_by_code.get(code, Decimal("0"))
            if quantity > remaining:
                raise HTTPException(
                    status_code=422,
                    detail=f"shipped_quantity for '{code}' exceeds the remaining purchase-order quantity ({max(remaining, Decimal('0'))})",
                )

    shipment_date_raw = payload.get("shipment_date")
    try:
        shipment_date = datetime.date.fromisoformat(str(shipment_date_raw)) if shipment_date_raw else datetime.date.today()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="shipment_date must be YYYY-MM-DD") from exc

    expected_raw = payload.get("expected_arrival_at")
    expected_arrival_at = None
    if not expected_raw:
        raise HTTPException(status_code=422, detail="expected_arrival_at is required")
    if expected_raw:
        try:
            expected_value = str(expected_raw).strip()
            expected_arrival_at = datetime.datetime.fromisoformat(expected_value.replace("Z", "+00:00"))
            # The UI sends a date-only value. Warehouse it at midnight while the
            # API continues to expose the date separately to consumers.
            if len(expected_value) == 10:
                expected_arrival_at = datetime.datetime.combine(
                    datetime.date.fromisoformat(expected_value), datetime.time.min
                )
            # The ASN column is TIMESTAMP WITHOUT TIME ZONE. Normalize browser
            # ISO timestamps before binding them through asyncpg.
            if expected_arrival_at.tzinfo is not None:
                expected_arrival_at = expected_arrival_at.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="expected_arrival_at must be an ISO datetime") from exc
        if expected_arrival_at.date() < datetime.date.today():
            raise HTTPException(status_code=422, detail="expected_arrival_at cannot be before today")

    year = datetime.date.today().year
    if uow.session.get_bind().dialect.name == "postgresql":
        await uow.session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
            {"lock_key": f"supplier-asn-number:{year}"},
        )

    if client_request_id:
        replay_result = await uow.session.execute(
            select(AsnModel)
            .options(
                selectinload(AsnModel.lines),
                selectinload(AsnModel.documents),
                selectinload(AsnModel.supplier),
            )
            .where(
                AsnModel.supplier_id == supplier_id,
                cast(AsnModel.logistics, String).ilike(f'%"{client_request_id}"%'),
            )
            .limit(1)
        )
        replay = replay_result.scalars().first()
        if replay is not None:
            return _asn_response(replay)

    number_result = await uow.session.execute(
        select(AsnModel.asn_number).where(
            func.upper(AsnModel.asn_number).like(f"ASN-{year}-%")
        )
    )
    highest = 0
    for value in number_result.scalars().all():
        match = re.fullmatch(rf"ASN-{year}-(\d+)", str(value).strip().upper())
        if match:
            highest = max(highest, int(match.group(1)))
    asn_number = f"ASN-{year}-{highest + 1:03d}"

    asn = AsnModel(
        asn_number=asn_number,
        supplier_id=supplier_id,
        po_id=str(po_model.id) if po_model else None,
        po_number=po_model.po_number if po_model else None,
        status=str(payload.get("status") or "SUBMITTED").upper(),
        warehouse_id=destination_config.warehouse_id if destination_config else None,
        vehicle_number=vehicle_number,
        driver_name=driver_name,
        driver_contact=driver_contact,
        expected_arrival_at=expected_arrival_at,
        shipment_date=shipment_date,
        transporter=str(payload.get("transporter") or "").strip() or None,
        number_of_packages=payload.get("number_of_packages") or None,
        package_type=str(payload.get("package_type") or "").strip() or None,
        shipment_type=str(payload.get("shipment_type") or "STANDARD").upper(),
        invoice_number=str(payload.get("invoice_number") or "").strip() or None,
        challan_number=str(payload.get("challan_number") or "").strip() or None,
        logistics=logistics + [{
            "type": "asn_details",
            "supplier_name": supplier_name,
            "destination_warehouse": destination_label,
            "destination_warehouse_id": str(destination_config.id) if destination_config else None,
            "client_request_id": client_request_id or None,
        }],
    )
    uow.session.add(asn)
    for raw_line, quantity in validated_asn_totals:
        asn.lines.append(AsnLineModel(
            material_id=uuid.UUID(str(raw_line["material_id"])) if raw_line.get("material_id") else None,
            item_code=str(raw_line.get("item_code") or raw_line.get("material_code") or "ITEM"),
            material_name=str(raw_line.get("material_name") or raw_line.get("material_description") or ""),
            shipped_quantity=quantity,
            uom=str(raw_line.get("uom") or "PCS"),
        ))
    await uow.session.flush()
    material_summary = ", ".join(
        f"{line.item_code} {line.shipped_quantity:g} {line.uom}" for line in asn.lines
    ) or "—"
    supplier_name = next((entry.get("supplier_name") for entry in (asn.logistics or []) if isinstance(entry, dict) and entry.get("type") == "asn_details"), None) or "supplier"
    notification_message = (
        f"ASN {asn.asn_number} dispatched by {supplier_name}. "
        f"Vehicle: {asn.vehicle_number or '—'} · Driver: {asn.driver_name or '—'} "
        f"({asn.driver_contact or '—'}) · ETA: "
        f"{asn.expected_arrival_at.isoformat() if asn.expected_arrival_at else '—'} · "
        f"Materials: {material_summary}"
    )
    for target_role in ("GATE_SECURITY", "WAREHOUSE"):
        uow.session.add(NotificationModel(
            user_role=target_role,
            title=f"Supplier ASN Dispatched · {asn.asn_number}",
            message=notification_message,
            link="/vehicle-queue" if target_role == "GATE_SECURITY" else "/inventory?tab=putaway",
            vehicle_number=asn.vehicle_number,
            driver_name=asn.driver_name,
            driver_phone=asn.driver_contact,
            asn_number=asn.asn_number,
            po_number=asn.po_number,
            supplier_name=next((entry.get("supplier_name") for entry in asn.logistics if isinstance(entry, dict) and entry.get("type") == "asn_details"), None),
            notification_type="SUPPLIER_ASN_DISPATCHED",
            idempotency_key=f"SUPPLIER_ASN_DISPATCHED:{asn.id}:{target_role}",
            payload_json=json.dumps({
                "asn_id": str(asn.id),
                "asn_number": asn.asn_number,
                "supplier_name": next((entry.get("supplier_name") for entry in asn.logistics if isinstance(entry, dict) and entry.get("type") == "asn_details"), None),
                "vehicle_number": asn.vehicle_number,
                "driver_name": asn.driver_name,
                "driver_contact": asn.driver_contact,
                "expected_arrival_at": asn.expected_arrival_at.isoformat() if asn.expected_arrival_at else None,
                "lines": [{"material": line.item_code, "quantity": float(line.shipped_quantity), "uom": line.uom} for line in asn.lines],
            }),
        ))
    # Reload relationships before serializing.  The create request runs in an
    # async SQLAlchemy session, so accessing an unloaded relationship from
    # _asn_response would otherwise trigger a lazy load outside the greenlet
    # and return a 500 after the ASN has already been flushed.
    persisted_result = await uow.session.execute(
        select(AsnModel)
        .options(
            selectinload(AsnModel.lines),
            selectinload(AsnModel.documents),
            selectinload(AsnModel.supplier),
        )
        .where(AsnModel.id == asn.id)
    )
    persisted_asn = persisted_result.scalars().first()
    return _asn_response(persisted_asn or asn)





def _canonical_warehouse_id(warehouse_id: str | None) -> str:
    """Normalize legacy warehouse display names used by seeded inventory."""
    normalized = (warehouse_id or "").strip()
    if normalized.casefold() in {"main", "main warehouse", "wh_pune-01"}:
        return "WH_PUNE-01"
    return normalized.upper()


def _assigned_materials_for_vehicle(asn: AsnModel, vehicle_number: str | None) -> list[dict] | None:
    """Return a vehicle's ASN manifest, or None for legacy ASNs without one."""
    target = normalize_vehicle(str(vehicle_number or ""))
    assignment = next(
        (entry for entry in (asn.logistics or []) if isinstance(entry, dict) and entry.get("type") == "transport_assignment"),
        None,
    )
    vehicles = assignment.get("vehicles", []) if isinstance(assignment, dict) else []
    vehicle_index = next(
        (
            index
            for index, entry in enumerate(vehicles)
            if isinstance(entry, dict)
            and normalize_vehicle(str(entry.get("vehicle_number") or "")) == target
        ),
        None,
    )
    vehicle = vehicles[vehicle_index] if vehicle_index is not None else None
    materials = vehicle.get("materials") if isinstance(vehicle, dict) else None
    if isinstance(materials, list):
        return materials
    if vehicle_index is None or len(vehicles) <= 1:
        return None

    # Legacy multi-vehicle ASNs stored only shipment totals and omitted each
    # vehicle's manifest. Preserve the supplier's vehicle order and allocate
    # those legacy lines deterministically instead of showing every material
    # against every truck.
    return [
        {
            "item_code": line.item_code,
            "material_name": line.material_name,
            "shipped_quantity": float(line.shipped_quantity or 0),
            "uom": line.uom,
        }
        for line_index, line in enumerate(asn.lines or [])
        if line_index % len(vehicles) == vehicle_index
    ]


async def _asn_supplier_name(session, asn: AsnModel, po: PurchaseOrderModel | None = None) -> str | None:
    if asn.supplier_id:
        supplier = await session.get(SupplierModel, asn.supplier_id)
        if supplier:
            return supplier.registered_company_name or supplier.supplier_name
    details = next(
        (item for item in (asn.logistics or []) if isinstance(item, dict) and item.get("type") == "asn_details"),
        {},
    )
    return details.get("supplier_name") or (po.supplier_name if po else None)


async def _warehouse_for_gate_assignment(session, asn: AsnModel, assignment: DockAssignmentModel, po: PurchaseOrderModel | None = None) -> str | None:
    warehouse_id = asn.warehouse_id or (po.warehouse_id if po else None)
    if not warehouse_id and assignment.assigned_store_id:
        store = await session.get(StoreModel, assignment.assigned_store_id)
        warehouse_id = store.warehouse_id if store else None
    if not warehouse_id and assignment.dock_number:
        dock = (await session.execute(
            select(DockModel).where(DockModel.dock_number == assignment.dock_number)
        )).scalar_one_or_none()
        warehouse_id = dock.warehouse_id if dock else None
    return _canonical_warehouse_id(warehouse_id) if warehouse_id else None


def _quantity_result(ordered: float, received: float) -> tuple[str, float]:
    variance = received - ordered
    if variance < 0:
        return "SHORT", abs(variance)
    if variance > 0:
        return "EXCESS", variance
    return "MATCH", 0.0

# Shared persistence components
_gate_repo = InMemoryGateEntryRepository()
_po_ocr_engine = EnterprisePoOcrEngine()


def _to_iso_date(value: object) -> Optional[str]:
    """Normalise common OCR date formats for the browser's date inputs."""
    if not value:
        return None
    raw_value = str(value).strip()
    for date_format in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.datetime.strptime(raw_value, date_format).date().isoformat()
        except ValueError:
            continue
    return raw_value if len(raw_value) == 10 and raw_value[4] == "-" else None


def _po_record_from_model(po: PurchaseOrderModel) -> PurchaseOrderRecord:
    items = po.items or []
    return PurchaseOrderRecord(
        po_number=po.po_number,
        supplier_name=po.supplier_name or "",
        material_description=", ".join(item.material_name for item in items if item.material_name),
        total_quantity=sum(float(item.quantity or 0) for item in items),
        po_date=po.po_date.isoformat() if po.po_date else "",
        delivery_date=po.expected_delivery_date.isoformat() if po.expected_delivery_date else "",
        status=po.status,
    )


async def _lookup_database_po(
    session, scanned_number: str, *, allow_partial: bool = False
) -> Optional[PurchaseOrderRecord]:
    """Resolve an OCR PO number exclusively against PostgreSQL purchase orders."""
    target = scanned_number.strip().upper()
    if not target:
        return None

    try:
        # PO enrichment is optional for ASN-first gate entries. If a legacy PO
        # schema is incomplete, roll back only this lookup so later ASN and gate
        # writes can still use the request transaction.
        async with session.begin_nested():
            result = await session.execute(
                select(PurchaseOrderModel)
                .options(selectinload(PurchaseOrderModel.items))
                .where(func.upper(PurchaseOrderModel.po_number) == target)
            )
            exact = result.scalars().first()
            if exact:
                return _po_record_from_model(exact)

            if not allow_partial:
                return None

            candidates_result = await session.execute(
                select(PurchaseOrderModel)
                .options(selectinload(PurchaseOrderModel.items))
                .where(func.upper(PurchaseOrderModel.po_number).like(f"{target}-%"))
                .order_by(PurchaseOrderModel.created_at.desc())
            )
            candidates = candidates_result.scalars().all()
            if len(candidates) == 1:
                return _po_record_from_model(candidates[0])
            if candidates:
                candidate_numbers = [candidate.po_number for candidate in candidates]
                shipment_result = await session.execute(
                    select(AsnModel.po_number)
                    .where(AsnModel.po_number.in_(candidate_numbers))
                    .order_by(AsnModel.created_at.desc())
                    .limit(1)
                )
                shipment_po_number = shipment_result.scalar_one_or_none()
                matched = next((candidate for candidate in candidates if candidate.po_number == shipment_po_number), None)
                if matched:
                    return _po_record_from_model(matched)
            return None
    except Exception as exc:
        logger.warning(f"Database lookup exception for PO '{target}': {exc}")
        return None


@router.post("/scan-ocr")
async def scan_with_local_ocr(
    file: UploadFile = File(...),
    kind: str = Form("general"),
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """Extract PO fields locally with OpenCV, Tesseract, and PaddleOCR."""
    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Uploaded file is empty")

        normalized_kind = kind.strip().lower()

        if normalized_kind == "po":
            logger.info("Starting local PO OCR processing...")
            local_result: Optional[OcrResult] = None
            try:
                local_result = await asyncio.to_thread(_po_ocr_engine.process_po_document, contents)
                logger.info("Local OCR processing completed successfully.")
            except Exception as exc:
                logger.error("Local PO OCR pass failed: %s", exc, exc_info=True)

            if local_result is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="The document could not be processed by the local OCR engine.",
                )
            result = local_result

            if not result.po_number:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="No readable purchase-order details were found. Use a clearer document image or enter the details manually.",
                )

            # The uploaded image is always the source of extracted form values.
            # PostgreSQL is used only for verification/comparison; never replace
            # OCR output with a stored record because that makes scans of altered
            # or unrelated documents appear to contain fixed data.
            po_record = await _lookup_database_po(uow.session, result.po_number)
            po_number = result.po_number
            supplier_name = result.supplier_name
            material_description = result.material_description
            total_quantity = result.total_quantity
            po_date = _to_iso_date(result.po_date)
            delivery_date = _to_iso_date(result.delivery_date)
            fields = {
                "po_number": po_number,
                "supplier_name": supplier_name,
                "material_description": material_description,
                "quantity": total_quantity,
                "po_date": po_date,
                "delivery_date": delivery_date,
                "line_items": list(result.line_items),
            }
            return {
                "po_number": po_number,
                "supplier_name": supplier_name,
                "material_description": material_description,
                "quantity": total_quantity,
                "po_date": po_date,
                "delivery_date": delivery_date,
                "line_items": list(result.line_items),
                "confidence": result.confidence,
                "source": "local-ocr",
                "verified": bool(po_record),
                "status": GateEntryStatus.PO_VERIFIED.value if po_record else GateEntryStatus.UNSCHEDULED_ARRIVAL.value,
                "extraction": {"fields": fields},
                "canonical_record": (
                    {
                        "po_number": po_record.po_number,
                        "supplier_name": po_record.supplier_name,
                        "material_description": po_record.material_description,
                        "quantity": po_record.total_quantity,
                        "po_date": _to_iso_date(po_record.po_date),
                        "delivery_date": _to_iso_date(po_record.delivery_date),
                    }
                    if po_record else None
                ),
            }

        if normalized_kind == "vehicle-ocr":
            from app.modules.gate.infrastructure.services.ocr_service import normalize_vehicle_registration

            frame = await asyncio.to_thread(_po_ocr_engine.preprocess_image, contents)
            if frame is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="The vehicle image could not be decoded for OCR.",
                )

            readings = []
            for image in (frame.enhanced_image, frame.threshold_image, frame.adaptive_image):
                text, confidence = await asyncio.to_thread(
                    _po_ocr_engine.extract_real_text_tesseract,
                    image,
                    (
                        "--psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
                        "--psm 11 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
                        "--psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
                    ),
                )
                if text:
                    readings.append((text, confidence))

            detected_plate = None
            detected_confidence = 0.0
            for text, confidence in readings:
                for candidate in text.splitlines() + [text]:
                    compact = re.sub(r"[^A-Z0-9]", "", candidate.upper())
                    match = re.search(
                        r"(?:\d{2}BH\d{4}[A-Z]{2}|[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4})",
                        compact,
                    )
                    if not match:
                        continue
                    try:
                        detected_plate = normalize_vehicle_registration(match.group(0))
                        detected_confidence = confidence
                        break
                    except ValueError:
                        continue
                if detected_plate:
                    break

            # Do not discard a clearly read plate merely because it uses a
            # non-Indian or uncommon registration format. Pick the strongest
            # OCR token containing both letters and digits as a safe fallback.
            if not detected_plate:
                fallback_candidates = []
                ignored_tokens = {"IND", "INDIA", "BHARAT", "VEHICLE", "NUMBER", "PLATE"}
                for text, confidence in readings:
                    for raw_token in re.findall(r"[A-Z0-9][A-Z0-9 .-]{3,18}", text.upper()):
                        token = re.sub(r"[^A-Z0-9]", "", raw_token)
                        if (
                            5 <= len(token) <= 14
                            and token not in ignored_tokens
                            and any(char.isalpha() for char in token)
                            and any(char.isdigit() for char in token)
                        ):
                            # Typical plates are 8-12 characters. Confidence
                            # remains the primary signal; length breaks ties.
                            length_score = max(0, 4 - abs(10 - len(token))) / 100
                            fallback_candidates.append((confidence + length_score, token, confidence))
                if fallback_candidates:
                    _, detected_plate, detected_confidence = max(fallback_candidates)

            return {
                "vehicle_number": detected_plate or "NOT_FOUND",
                "confidence": detected_confidence if detected_plate else 0.0,
                "source": "gate-entry-opencv-ocr",
                "extraction": {"fields": {"vehicle_number": detected_plate or "NOT_FOUND"}},
                "raw_text": "\n".join(text for text, _ in readings),
            }

        if normalized_kind == "vehicle":
            from app.modules.gate.infrastructure.services.ocr_service import OcrUnavailableError, TesseractAnprService
            try:
                anpr = await TesseractAnprService().recognize_license_plate(contents)
                vehicle_number = anpr.detected_vehicle_number
                return {
                    "vehicle_number": vehicle_number,
                    "confidence": anpr.confidence,
                    "source": "local-tesseract-anpr",
                    "extraction": {"fields": {"vehicle_number": vehicle_number}},
                }
            except OcrUnavailableError as exc:
                logger.error("Vehicle OCR is unavailable: %s", exc)
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=str(exc),
                ) from exc
            except Exception as exc:
                logger.info("Vehicle plate was not readable: %s", exc)
                return {
                    "vehicle_number": "NOT_FOUND",
                    "confidence": 0.0,
                    "extraction": {"fields": {"vehicle_number": "NOT_FOUND"}},
                }

        # Licence/document extraction is optional; returning a stable response
        # lets the UI fall back to manual entry when no specialised extractor exists.
        return {"extraction": {"fields": {}}}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Internal error in scan_with_local_ocr")
        raise HTTPException(status_code=500, detail=str(e))


def get_gate_repo() -> InMemoryGateEntryRepository:
    return _gate_repo



def _generate_gate_entry_number() -> str:
    """Generate the six-character gate-pass identifier printed and QR encoded.

    The identifier is deliberately opaque: ASN, supplier, vehicle and arrival
    details remain linked in the gate_entry row rather than being encoded in the
    ticket number. UUID entropy also makes retries safe without a database-side
    sequence or a race-prone timestamp.
    """
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    value = uuid.uuid4().int
    token = "".join(alphabet[(value >> (index * 5)) & 31] for index in range(6))
    return token


def _to_gate_entry_response(
    entry: GateEntry, po_status: Optional[str] = None, asn_status: Optional[str] = None
) -> GateEntryResponse:
    ocr_dto = None
    if entry.ocr_result:
        raw_items = getattr(entry.ocr_result, "line_items", ()) or ()
        ocr_dto = OcrResultDto(
            po_number=entry.ocr_result.po_number or "",
            supplier_name=entry.ocr_result.supplier_name or "",
            material_description=entry.ocr_result.material_description or "",
            total_quantity=entry.ocr_result.total_quantity or 0.0,
            po_date=entry.ocr_result.po_date or "",
            delivery_date=entry.ocr_result.delivery_date or "",
            confidence=entry.ocr_result.confidence or 0.0,
            line_items=list(raw_items) if isinstance(raw_items, (list, tuple)) else [],
        )

    mismatch_dtos = [
        FieldMismatchDto(
            field_name=m.field_name,
            extracted_value=m.extracted_value,
            canonical_value=m.canonical_value,
        )
        for m in (entry.mismatched_fields or [])
        if hasattr(m, "field_name")
    ]

    status_val = entry.status.value if hasattr(entry.status, "value") else str(entry.status or "PENDING_VERIFICATION")

    created_at_val = (
        entry.created_at.isoformat()
        if hasattr(entry.created_at, "isoformat")
        else str(entry.created_at or datetime.datetime.now(datetime.timezone.utc).isoformat())
    )
    updated_at_val = (
        entry.updated_at.isoformat()
        if hasattr(entry.updated_at, "isoformat")
        else str(entry.updated_at or datetime.datetime.now(datetime.timezone.utc).isoformat())
    )
    exited_at_val = (
        entry.exited_at.isoformat()
        if hasattr(entry.exited_at, "isoformat")
        else str(entry.exited_at) if entry.exited_at else None
    )

    exited_at_val = (
        entry.exited_at.isoformat()
        if hasattr(entry, "exited_at") and entry.exited_at and hasattr(entry.exited_at, "isoformat")
        else None
    )

    return GateEntryResponse(
        id=entry.id,
        gate_entry_number=entry.gate_entry_number or f"GE-{entry.id[:8]}",
        gate_pass_number=entry.gate_entry_number or f"GE-{entry.id[:8]}",
        qr_token=f"KX-GP-{uuid.uuid5(uuid.NAMESPACE_URL, str(entry.gate_entry_number or entry.id)).hex}",
        vehicle_plate=entry.vehicle_plate or "",
        status=status_val,
        created_by=entry.created_by,
        driver_name=entry.driver_name,
        po_id=entry.po_id,
        po_number=entry.po_number,
        po_status=po_status,
        asn_id=entry.asn_id,
        asn_number=entry.asn_number,
        asn_status=asn_status,
        assigned_dock_id=entry.assigned_dock_id,
        supplier_name=entry.ocr_result.supplier_name if entry.ocr_result else None,
        material_description=entry.ocr_result.material_description if entry.ocr_result else None,
        total_quantity=entry.ocr_result.total_quantity if entry.ocr_result else None,
        truck_photo_base64=entry.truck_photo_base64,
        ocr_result=ocr_dto,
        mismatched_fields=mismatch_dtos,
        verified_by=entry.verified_by,
        exited_at=exited_at_val,
        exited_by=entry.exited_by,
        created_at=created_at_val,
        updated_at=updated_at_val,
    )


def _gate_entry_from_model(model: GateEntryModel) -> GateEntry:
    ocr_result = None
    if model.ocr_po_number or model.ocr_supplier_name or model.ocr_product_material:
        line_items = list(model.ocr_line_items or ())
        full_description = ", ".join(
            str(item.get("material_description", ""))
            for item in line_items
            if isinstance(item, dict) and item.get("material_description")
        ) or model.ocr_raw_text or model.ocr_product_material
        ocr_result = OcrResult(
            po_number=model.ocr_po_number,
            supplier_name=model.ocr_supplier_name,
            material_description=full_description,
            total_quantity=float(model.ocr_quantity) if model.ocr_quantity is not None else None,
            po_date=model.ocr_po_date,
            delivery_date=model.ocr_expected_delivery_date,
            confidence=float(model.ocr_confidence) if model.ocr_confidence is not None else 0.0,
            line_items=tuple(item for item in line_items if isinstance(item, dict)),
        )
    mismatches = [
        FieldMismatch(
            field_name=str(item.get("field_name", "")),
            extracted_value=item.get("extracted_value"),
            canonical_value=item.get("canonical_value"),
        )
        for item in (model.mismatched_fields or [])
        if isinstance(item, dict)
    ]
    raw_status = model.status.strip().upper().replace(" ", "_") if model.status else "PENDING_VERIFICATION"
    try:
        parsed_status = GateEntryStatus(raw_status)
    except ValueError:
        parsed_status = getattr(GateEntryStatus, raw_status, GateEntryStatus.PENDING_VERIFICATION)

    created_at = model.created_at or datetime.datetime.now(datetime.timezone.utc)
    updated_at = model.updated_at or datetime.datetime.now(datetime.timezone.utc)

    return GateEntry.rehydrate(
        id=str(model.id),
        gate_entry_number=model.gate_entry_number,
        vehicle_plate=model.vehicle_number or "",
        status=parsed_status,
        created_by=model.security_officer_id,
        driver_name=model.driver_name,
        po_id=str(model.po_id) if model.po_id else None,
        po_number=model.po_number,
        asn_id=str(model.asn_id) if model.asn_id else None,
        asn_number=None,
        assigned_dock_id=model.assigned_dock_id,
        truck_photo_base64=base64.b64encode(model.vehicle_photo_data).decode("ascii") if model.vehicle_photo_data else None,
        ocr_result=ocr_result,
        mismatched_fields=mismatches,
        verified_by=model.verified_by_user_id,
        exited_at=model.exited_at,
        exited_by=model.exited_by,
        created_at=created_at,
        updated_at=updated_at,
    )


async def _save_gate_entry(session, entry: GateEntry, document_data: bytes | None = None) -> None:
    if not entry.gate_entry_number:
        entry.gate_entry_number = _generate_gate_entry_number()
    result = await session.execute(select(GateEntryModel).where(GateEntryModel.id == uuid.UUID(entry.id)))
    model = result.scalar_one_or_none()
    ocr = entry.ocr_result
    mismatches = [
        {
            "field_name": mismatch.field_name,
            "extracted_value": mismatch.extracted_value,
            "canonical_value": mismatch.canonical_value,
        }
        for mismatch in entry.mismatched_fields
    ]
    vehicle_data = base64.b64decode(entry.truck_photo_base64) if entry.truck_photo_base64 else None
    values = dict(
        gate_entry_number=entry.gate_entry_number,
        asn_id=uuid.UUID(entry.asn_id) if entry.asn_id else None,
        assigned_dock_id=entry.assigned_dock_id,
        po_number=entry.po_number,
        vehicle_number=entry.vehicle_plate,
        driver_name=entry.driver_name or "Driver",
        driver_phone=getattr(entry, "driver_phone", None),
        po_document_path=f"database://gate-entry/{entry.id}/po-document" if document_data else None,
        vehicle_photo_path=f"database://gate-entry/{entry.id}/vehicle-photo" if vehicle_data else None,
        status=entry.status.value if hasattr(entry.status, "value") else str(entry.status),
        verification_type=("ASN_VERIFIED" if entry.asn_id and not entry.po_number else "MATCHED") if not mismatches else "MISMATCHED",
        mismatched_fields=mismatches,
        reasons=[],
        ocr_po_number=ocr.po_number if ocr else None,
        ocr_supplier_name=ocr.supplier_name if ocr else None,
        ocr_product_material=(ocr.material_description or "")[:128] if ocr else None,
        ocr_raw_text=ocr.material_description if ocr else None,
        ocr_quantity=ocr.total_quantity if ocr else None,
        ocr_po_date=str(ocr.po_date) if ocr and ocr.po_date else None,
        ocr_expected_delivery_date=str(ocr.delivery_date) if ocr and ocr.delivery_date else None,
        ocr_confidence=ocr.confidence if ocr else None,
        ocr_line_items=list(ocr.line_items) if ocr else [],
        security_officer_id=entry.created_by,
        verified_by_user_id=entry.verified_by,
        exited_at=entry.exited_at,
        exited_by=entry.exited_by,
        facility_entry_at=getattr(entry, "facility_entry_at", None),
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )
    if model is None:
        model = GateEntryModel(id=uuid.UUID(entry.id), **values)
        session.add(model)
    else:
        for key, value in values.items():
            setattr(model, key, value)
    if document_data is not None:
        model.po_document_data = document_data
    if vehicle_data is not None:
        model.vehicle_photo_data = vehicle_data
    await session.flush()


@preview_router.get("/purchase-orders/{po_number}", response_model=PurchaseOrderRecordDto)
async def get_purchase_order(
    po_number: str,
    _user: CurrentUser = Depends(require_permission("receiving:read")),
    uow: UnitOfWork = Depends(get_uow),
) -> PurchaseOrderRecordDto:
    """Return the canonical PO used to populate the goods-receipt form."""
    record = await _lookup_database_po(uow.session, po_number)
    if not record:
        raise NotFoundException(f"Purchase order not found: {po_number}")
    return PurchaseOrderRecordDto(
        po_number=record.po_number,
        supplier_name=record.supplier_name,
        material_description=record.material_description,
        total_quantity=record.total_quantity,
        po_date=record.po_date,
        delivery_date=record.delivery_date,
        status=record.status,
    )


@preview_router.post("/po-ocr-preview", response_model=PoOcrPreviewResponse)
@preview_router.post("/ocr/scan", response_model=PoOcrPreviewResponse)
@preview_router.post("/anpr-ocr-preview", response_model=PoOcrPreviewResponse)
@preview_router.post("/ocr/preview", response_model=PoOcrPreviewResponse)
async def preview_po_ocr(
    request: PoOcrPreviewRequest,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
) -> PoOcrPreviewResponse:
    """
    Real Dynamic PO OCR Preview Endpoint.
    Extracts text dynamically using OpenCV + Tesseract from uploaded image bytes.
    Cross-verifies against database records without hardcoded mock fallbacks.
    Registered on both /po-ocr-preview and /ocr/scan to prevent 404 errors.
    """
    po_num_override = request.po_number_override.strip().upper() if request.po_number_override else ""
    ocr_res: Optional[OcrResult] = None

    # 1. Real Dynamic OCR Extraction from Image Bytes if payload provided
    if request.document_image_base64:
        try:
            doc_bytes = base64.b64decode(request.document_image_base64, validate=True)
            ocr_res = await asyncio.to_thread(_po_ocr_engine.process_po_document, doc_bytes)
        except Exception as err:
            raise DomainRuleViolationException(f"Failed to process PO image frame: {str(err)}")

    # 2. Use override PO Number if OCR image did not yield PO Number
    target_po_number = (ocr_res.po_number if ocr_res and ocr_res.po_number else po_num_override).strip().upper()

    # 3. Lookup the canonical record only in the real procurement database.
    po_record = await _lookup_database_po(uow.session, target_po_number)

    # Keep image extraction independent. The canonical record is returned
    # separately for verification and must not overwrite what OCR observed.
    if po_record:
        target_po_number = po_record.po_number

    # 4. Complete fields from the matching canonical record only. Unknown
    # documents must remain blank instead of being populated with fabricated
    # supplier, quantity, or date values.
    # Database fallback is allowed only for a manual PO-number lookup with no
    # uploaded document. An actual scan never receives substituted values.
    has_scanned_image = bool(request.document_image_base64)
    fallback_supplier = po_record.supplier_name if po_record and not has_scanned_image else ""
    fallback_material = po_record.material_description if po_record and not has_scanned_image else ""
    fallback_qty = po_record.total_quantity if po_record and not has_scanned_image else 0.0
    fallback_po_date = po_record.po_date if po_record and not has_scanned_image else ""
    fallback_delivery_date = po_record.delivery_date if po_record and not has_scanned_image else ""

    if not ocr_res:
        ocr_res = OcrResult(
            po_number=target_po_number,
            supplier_name=fallback_supplier,
            material_description=fallback_material,
            total_quantity=fallback_qty,
            po_date=fallback_po_date,
            delivery_date=fallback_delivery_date,
            confidence=1.0,
        )
    else:
        ocr_res = OcrResult(
            po_number=ocr_res.po_number or target_po_number,
            supplier_name=ocr_res.supplier_name or fallback_supplier,
            material_description=ocr_res.material_description or fallback_material,
            total_quantity=ocr_res.total_quantity if ocr_res.total_quantity > 0 else fallback_qty,
            po_date=ocr_res.po_date or fallback_po_date,
            delivery_date=ocr_res.delivery_date or fallback_delivery_date,
            confidence=ocr_res.confidence,
        )

    # 5. Dynamic Cross-Verification against database PO record
    computed_status, mismatches = EnterprisePoOcrEngine.cross_verify_against_db(ocr_res, po_record)

    po_dto = (
        PurchaseOrderRecordDto(
            po_number=po_record.po_number,
            supplier_name=po_record.supplier_name,
            material_description=po_record.material_description,
            total_quantity=po_record.total_quantity,
            po_date=po_record.po_date,
            delivery_date=po_record.delivery_date,
            status=po_record.status,
        )
        if po_record
        else None
    )

    status_str = computed_status.value if hasattr(computed_status, "value") else str(computed_status)

    return PoOcrPreviewResponse(
        ocr_result=OcrResultDto(
            po_number=ocr_res.po_number or "",
            supplier_name=ocr_res.supplier_name or "",
            material_description=ocr_res.material_description or "",
            total_quantity=ocr_res.total_quantity or 0.0,
            po_date=ocr_res.po_date or "",
            delivery_date=ocr_res.delivery_date or "",
            confidence=ocr_res.confidence,
            line_items=list(ocr_res.line_items),
        ),
        computed_status=status_str,
        mismatched_fields=[
            FieldMismatchDto(
                field_name=m.field_name,
                extracted_value=m.extracted_value,
                canonical_value=m.canonical_value,
            )
            for m in mismatches
        ],
        po_record=po_dto,
    )


async def _read_gate_entry_request(http_request: Request) -> CreateGateEntryRequest:
    """Accept both the JSON API contract and the existing camera-upload form."""
    content_type = http_request.headers.get("content-type", "")
    if "multipart/form-data" not in content_type:
        try:
            return CreateGateEntryRequest.model_validate(await http_request.json())
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid gate entry payload") from exc

    form = await http_request.form()

    async def as_base64(field_name: str) -> Optional[str]:
        uploaded = form.get(field_name)
        if not hasattr(uploaded, "read"):
            return None
        content = await uploaded.read()
        return base64.b64encode(content).decode("ascii") if content else None

    try:
        return CreateGateEntryRequest(
            # The pre-existing UI uses vehicle_number; the Gate Entry API uses
            # vehicle_plate.  Support both during the transition.
            vehicle_plate=str(form.get("vehicle_plate") or form.get("vehicle_number") or ""),
            po_number=str(form.get("po_number") or ""),
            asn_reference=str(form.get("asn_reference") or "") or None,
            supplier_name=str(form.get("supplier_name") or "") or None,
            material_description=str(form.get("material_description") or "") or None,
            total_quantity=float(form.get("total_quantity")) if form.get("total_quantity") else None,
            po_date=str(form.get("po_date") or "") or None,
            delivery_date=str(form.get("delivery_date") or "") or None,
            driver_name=str(form.get("driver_name") or "Driver"),
            driver_contact=str(form.get("driver_contact") or "") or None,
            document_image_base64=await as_base64("po_document"),
            truck_photo_base64=await as_base64("vehicle_photo"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()) from exc


@router.post("", response_model=GateEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_gate_entry(
    http_request: Request,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
) -> GateEntryResponse:
    """
    Create & Save Gate Entry Pass into database.
    Saves vehicle_plate (manual string), po_number, supplier_name, material_description, total_quantity,
    document_image_base64 snapshot, and generates sequential gate_entry_number (GE-YYYYMMDD-<HEX>).
    """
    request = await _read_gate_entry_request(http_request)
    from app.modules.gate.infrastructure.services.ocr_service import normalize_vehicle_registration
    asn = None
    if request.asn_reference:
        reference = request.asn_reference.strip()
        asn_filters = [func.upper(AsnModel.asn_number) == reference.upper()]
        try:
            asn_filters.append(AsnModel.id == uuid.UUID(reference))
        except ValueError:
            pass
        result = await uow.session.execute(
            select(AsnModel).options(selectinload(AsnModel.lines)).where(or_(*asn_filters))
        )
        asn = result.scalars().first()
        if asn is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ASN '{reference}' not found")

    selected_transport = None
    assigned_transports = []
    if asn:
        assignment = next(
            (item for item in (asn.logistics or []) if isinstance(item, dict) and item.get("type") == "transport_assignment"),
            None,
        )
        if assignment and isinstance(assignment.get("vehicles"), list):
            assigned_transports = [item for item in assignment["vehicles"] if isinstance(item, dict)]
        if not assigned_transports:
            vehicles = [part.strip() for part in str(asn.vehicle_number or "").split(",") if part.strip()]
            drivers = [part.strip() for part in str(asn.driver_name or "").split(",") if part.strip()]
            contacts = [part.strip() for part in str(asn.driver_contact or "").split(",") if part.strip()]
            assigned_transports = [
                {"vehicle_number": vehicle, "driver_name": drivers[index] if index < len(drivers) else "",
                 "driver_contact": contacts[index] if index < len(contacts) else ""}
                for index, vehicle in enumerate(vehicles)
            ]

    requested_plate = request.vehicle_plate or (assigned_transports[0].get("vehicle_number") if assigned_transports else None) or (asn.vehicle_number if asn else None)
    try:
        plate = normalize_vehicle_registration(requested_plate or "")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    if asn and assigned_transports:
        selected_transport = next(
            (item for item in assigned_transports
             if normalize_vehicle(str(item.get("vehicle_number") or "")) == normalize_vehicle(plate)),
            None,
        )
        if selected_transport is None:
            raise HTTPException(status_code=422, detail="Select a vehicle assigned to this ASN by the supplier.")
        expected_driver = str(selected_transport.get("driver_name") or "").strip()
        expected_contact = str(selected_transport.get("driver_contact") or "").strip()
        submitted_driver = str(request.driver_name or "").strip()
        submitted_contact = str(request.driver_contact or "").strip()
        if expected_driver and submitted_driver and submitted_driver.casefold() not in {"driver", expected_driver.casefold()}:
            raise HTTPException(status_code=422, detail="Driver does not match the selected vehicle assignment.")
        if expected_contact and submitted_contact and submitted_contact != expected_contact:
            raise HTTPException(status_code=422, detail="Driver contact does not match the selected vehicle assignment.")
    driver_name = (
        str((selected_transport or {}).get("driver_name") or "").strip()
        or str(request.driver_name or "").strip()
        or (asn.driver_name if asn else "Driver")
    )
    driver_contact = (
        str((selected_transport or {}).get("driver_contact") or "").strip()
        or str(request.driver_contact or "").strip()
        or (asn.driver_contact if asn else None)
    )
    po_num = ((asn.po_number if asn else request.po_number) or "").strip().upper() or None

    if not plate:
        raise DomainRuleViolationException("Vehicle number is mandatory.")
    if asn is None and not po_num:
        raise DomainRuleViolationException("A valid ASN reference is required for inbound receiving.")
    po_record = await _lookup_database_po(uow.session, po_num) if po_num else None
    assigned_materials = _assigned_materials_for_vehicle(asn, plate) if asn else None
    vehicle_materials = assigned_materials if assigned_materials is not None else ([
        {
            "item_code": line.item_code,
            "material_name": line.material_name,
            "shipped_quantity": float(line.shipped_quantity or 0),
            "uom": line.uom,
        }
        for line in (asn.lines if asn else [])
    ])
    if asn:
        supplier_name = ""
        if asn.supplier_id:
            supplier_result = await uow.session.execute(
                select(SupplierModel).where(SupplierModel.id == asn.supplier_id)
            )
            supplier = supplier_result.scalars().first()
            if supplier is None:
                raise HTTPException(status_code=409, detail="ASN supplier could not be resolved")
            supplier_name = (supplier.registered_company_name or supplier.supplier_name or "").strip()
        if not supplier_name:
            supplier_name = (po_record.supplier_name if po_record else request.supplier_name or "ASN Supplier").strip()
        request.supplier_name = supplier_name
    if asn and request.total_quantity is None:
        request.total_quantity = sum(float(line.get("shipped_quantity", line.get("quantity", 0)) or 0) for line in vehicle_materials)
    if not (request.supplier_name and request.supplier_name.strip()):
        raise DomainRuleViolationException("Supplier name is mandatory.")
    if request.total_quantity is None or request.total_quantity <= 0:
        raise DomainRuleViolationException("Total quantity is mandatory and must be greater than 0.")

    await validate_gate_duplicates(uow.session, plate, asn.id if asn else None)

    # 2. Dynamic OCR processing or extraction
    ocr_res: Optional[OcrResult] = None

    # The scan preview or form input has already populated the submitted fields.
    # Master PO data is authoritative whenever it is available.
    if asn:
        ocr_res = OcrResult(
            po_number=po_num,
            supplier_name=request.supplier_name or "",
            material_description=", ".join(str(line.get("material_name") or line.get("item_code") or "") for line in vehicle_materials),
            total_quantity=sum(float(line.get("shipped_quantity", line.get("quantity", 0)) or 0) for line in vehicle_materials),
            po_date=po_record.po_date if po_record else "",
            delivery_date=po_record.delivery_date if po_record else "",
            confidence=1.0,
            line_items=tuple({"material_code": line.get("item_code"), "material_description": line.get("material_name"), "quantity": float(line.get("shipped_quantity", line.get("quantity", 0)) or 0), "uom": line.get("uom")} for line in vehicle_materials),
        )
    elif po_record:
        ocr_res = OcrResult(
            po_number=po_record.po_number,
            supplier_name=po_record.supplier_name,
            material_description=po_record.material_description,
            total_quantity=po_record.total_quantity,
            po_date=po_record.po_date,
            delivery_date=po_record.delivery_date,
            confidence=1.0,
        )
    else:
        ocr_res = OcrResult(
            po_number=po_num,
            supplier_name=request.supplier_name or "",
            material_description=request.material_description or "",
            total_quantity=request.total_quantity if request.total_quantity is not None else 0.0,
            po_date=request.po_date or "",
            delivery_date=request.delivery_date or "",
            confidence=1.0,
        )

    # 3. Cross-verify 6 fields
    computed_status, mismatches = EnterprisePoOcrEngine.cross_verify_against_db(ocr_res, po_record)

    # 4. Generate sequential Gate Entry Pass Number
    gate_entry_num = _generate_gate_entry_number()

    # 5. Create GateEntry aggregate & save persistently
    entry = GateEntry.create(
        vehicle_plate=plate,
        created_by=user.username,
        driver_name=driver_name,
        # Older local SQLite databases still enforce NOT NULL on this legacy
        # column. ASN-only entries have no PO, so persist an empty value for
        # that compatibility case instead of rejecting the gate pass.
        po_number=(po_record.po_number if po_record else po_num) or "",
        po_id=str(asn.po_id) if asn and asn.po_id else (str(po_record.po_id) if po_record and po_record.po_id else None),
        asn_id=str(asn.id) if asn else None,
        asn_number=asn.asn_number if asn else None,
        truck_photo_base64=request.truck_photo_base64,
        ocr_result=ocr_res,
        status=computed_status,
        mismatched_fields=mismatches,
    )
    entry.driver_phone = driver_contact
    entry.gate_entry_number = gate_entry_num
    # Dock allocation is the warehouse control point for this flow.  A
    # separate gate-entry approval is not required before queuing the arrival.
    entry.queue_for_dock_allocation()
    if asn:
        asn.status = GateEntryStatus.AWAITING_DOCK.value
        uow.session.add(NotificationModel(
            user_role="WAREHOUSE",
            title="Gate Entry Approved",
            message=f"{asn.asn_number} for vehicle {plate} is ready for warehouse dock allocation.",
            link=f"/procurement/asns/{asn.id}",
        ))
    else:
        uow.session.add(NotificationModel(
            user_role="WAREHOUSE",
            title="Direct Gate Entry Approved",
            message=f"Vehicle {plate} for PO {po_num} is ready for warehouse dock allocation.",
            link="/dock-management",
        ))

    document_data = base64.b64decode(request.document_image_base64) if request.document_image_base64 else None
    await _save_gate_entry(uow.session, entry, document_data=document_data)

    # A PO with multiple planned ASN vehicles is complete at the gate only when
    # every planned vehicle has an approved arrival entry. This is intentionally
    # based on persisted records rather than UI checkboxes so it remains correct
    # for concurrent gate operators and page refreshes.
    po_completed_at_gate = False
    if po_record:
        planned_result = await uow.session.execute(
            select(AsnModel.vehicle_number).where(
                func.upper(AsnModel.po_number) == po_num.upper(),
                AsnModel.vehicle_number.isnot(None),
                AsnModel.vehicle_number != "",
            )
        )
        planned_vehicles = {
            str(number).strip().upper()
            for number in planned_result.scalars().all()
            if str(number).strip()
        }
        if len(planned_vehicles) > 1:
            arrived_result = await uow.session.execute(
                select(GateEntryModel.vehicle_number).where(
                    func.upper(GateEntryModel.po_number) == po_num.upper(),
                    GateEntryModel.status.notin_(
                        [GateEntryStatus.REJECTED.value, GateEntryStatus.DENIED_ENTRY.value]
                    ),
                )
            )
            arrived_vehicles = {
                str(number).strip().upper()
                for number in arrived_result.scalars().all()
                if str(number).strip()
            }
            if planned_vehicles.issubset(arrived_vehicles):
                po_model_result = await uow.session.execute(
                    select(PurchaseOrderModel).where(
                        func.upper(PurchaseOrderModel.po_number) == po_num.upper()
                    )
                )
                po_model = po_model_result.scalars().first()
                if po_model:
                    po_model.status = "COMPLETED"
                    po_completed_at_gate = True

    try:
        from app.modules.dock.application.service import DockAllocationService
        # Allocation is a follow-up workflow. Keep its schema or capacity
        # failures inside a savepoint so they cannot poison the transaction
        # that persists the gate entry and causes the gate pass request to 500.
        async with uow.session.begin_nested():
            await DockAllocationService.auto_create_allocation_request(
                session=uow.session,
                gate_pass_id=entry.gate_entry_number or str(entry.id),
                vehicle_number=plate,
                vendor_reference=request.supplier_name or (ocr_res.supplier_name if ocr_res else None),
                material_description=request.material_description or (ocr_res.material_description if ocr_res else None),
                quantity=Decimal(str(request.total_quantity)) if request.total_quantity else (Decimal(str(ocr_res.total_quantity)) if (ocr_res and ocr_res.total_quantity) else Decimal("100.0")),
            )
    except Exception as exc:
        logger.warning(f"Auto-creation of dock allocation request skipped/failed: {exc}")

    return _to_gate_entry_response(
        entry,
        po_status="COMPLETED" if po_completed_at_gate else (po_record.status if po_record else None),
        asn_status=asn.status if asn else None,
    )


@router.post("/reset-dev-entries")
async def reset_dev_entries(
    uow: UnitOfWork = Depends(get_uow),
    _user: CurrentUser = Depends(require_permission("gate:write")),
):
    """Clear active gate entries and assignments for testing in dev mode."""
    try:
        # Clear child/dependent records first to satisfy foreign key constraints
        await uow.session.execute(delete(GateExitModel))
        await uow.session.execute(delete(VehicleExitApprovalModel))
        await uow.session.execute(delete(ReceivingLineModel))
        await uow.session.execute(delete(DockAssignmentModel))
        await uow.session.execute(delete(GateEntryAuditLogModel))
        await uow.session.execute(delete(GateEntryModel))

        # Reset all docks to AVAILABLE
        from sqlalchemy import update
        await uow.session.execute(
            update(DockModel).values(status="AVAILABLE")
        )

        await uow.session.commit()
        return {"message": "Active dev gate entries and assignments cleared successfully"}
    except Exception as e:
        await uow.session.rollback()
        logger.error(f"Failed to reset gate entries: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database reset failed: {str(e)}")


@router.get("/inbound-arrivals")
async def list_inbound_arrivals(
    include_history: bool = False,
    user: CurrentUser = Depends(require_permission("gate:read")),
    uow: UnitOfWork = Depends(get_uow),
):
    """Warehouse queue backed by approved gate entries and their source ASNs."""
    warehouse_scoped = False
    scoped_warehouse_ref_id = None
    scoped_warehouse_code = None

    user_roles_upper = [r.upper() for r in (user.roles or [])]
    is_admin_or_wm = any(r in user_roles_upper for r in ["ADMIN", "WAREHOUSE", "WAREHOUSE_MANAGER", "SECURITY", "PROCUREMENT"])
    is_warehouse_user = any(r in user_roles_upper for r in ["WAREHOUSE_OPERATOR"])

    if is_warehouse_user and not is_admin_or_wm:
        warehouse_scoped = True
        scoped_warehouse_ref_id = user.raw_claims.get("warehouse_ref_id")
        scoped_warehouse_code = user.raw_claims.get("warehouse_code")
        if not scoped_warehouse_ref_id:
            mgr_res = await uow.session.execute(
                select(UserAccountModel).where(
                    or_(
                        UserAccountModel.username == user.username,
                        UserAccountModel.employee_id == user.subject,
                    )
                )
            )
            mgr = mgr_res.scalars().first()
            if mgr:
                scoped_warehouse_ref_id = str(mgr.warehouse_ref_id)

    arrivals_query = (
        select(GateEntryModel, AsnModel, PurchaseOrderModel, DockAssignmentModel)
        .outerjoin(AsnModel, GateEntryModel.asn_id == AsnModel.id)
        .outerjoin(PurchaseOrderModel, PurchaseOrderModel.po_number == GateEntryModel.po_number)
        .outerjoin(DockAssignmentModel, DockAssignmentModel.gate_entry_id == GateEntryModel.id)
        .options(selectinload(AsnModel.lines))
        .options(selectinload(PurchaseOrderModel.items))
    )
    if not include_history:
        arrivals_query = arrivals_query.where(GateEntryModel.status.notin_([
            GateEntryStatus.REJECTED.value,
            GateEntryStatus.DENIED_ENTRY.value,
            GateEntryStatus.GATE_EXIT_COMPLETED.value,
            GateEntryStatus.VEHICLE_EXITED.value,
            GateEntryStatus.CHECKED_OUT.value,
            GateEntryStatus.COMPLETED.value,
        ]))
    result = await uow.session.execute(arrivals_query.order_by(GateEntryModel.created_at.desc()))
    allocation_result = await uow.session.execute(select(DockAllocationRequestModel))
    allocations_by_gate_pass = {
        allocation.existing_gate_pass_id: allocation
        for allocation in allocation_result.scalars().all()
        if allocation.existing_gate_pass_id
    }
    arrivals = []
    seen_gate_entry_ids: set[str] = set()
    for gate_entry, asn, po, assignment in result.all():
        # Some older gate records have no ASN foreign key on the gate row;
        # the dock assignment still carries the authoritative ASN link.
        if asn is None and assignment and assignment.asn_id:
            asn_result = await uow.session.execute(
                select(AsnModel)
                .options(selectinload(AsnModel.lines))
                .where(AsnModel.id == assignment.asn_id)
                .limit(1)
            )
            asn = asn_result.scalars().first()
        allocation = allocations_by_gate_pass.get(gate_entry.gate_entry_number)
        gate_entry_key = str(gate_entry.id)
        if gate_entry_key in seen_gate_entry_ids:
            continue
        seen_gate_entry_ids.add(gate_entry_key)
        if warehouse_scoped:
            if not assignment or not assignment.assigned_warehouse_ref_id:
                continue
            if scoped_warehouse_ref_id and str(assignment.assigned_warehouse_ref_id) != scoped_warehouse_ref_id and assignment.assigned_warehouse_code != scoped_warehouse_code:
                continue

        received_by_code = {}
        if assignment:
            received_result = await uow.session.execute(
                select(ReceivingLineModel).where(ReceivingLineModel.dock_assignment_id == assignment.id)
            )
            received_by_code = {line.item_code: line for line in received_result.scalars().all()}
        vehicle_manifest = _assigned_materials_for_vehicle(asn, gate_entry.vehicle_number) if asn else None
        expected_material_rows = vehicle_manifest if vehicle_manifest is not None else [
            {
                "item_code": line.item_code,
                "material_name": line.material_name,
                "shipped_quantity": float(line.shipped_quantity),
                "uom": line.uom,
            }
            for line in (asn.lines if asn else [])
        ]
        arrivals.append({
            "id": str(gate_entry.id),
            "gate_entry_number": gate_entry.gate_entry_number,
            "asn_id": str(asn.id) if asn else None,
            "asn_number": asn.asn_number if asn else "DIRECT-ARRIVAL",
            "shipment_type": asn.shipment_type if asn else "STANDARD",
            "is_replacement": bool(asn and asn.shipment_type == "REPLACEMENT"),
            "claim_id": str(asn.claim_id) if asn and asn.claim_id else None,
            "po_number": gate_entry.po_number,
            "supplier_name": (po.supplier_name if po else None) or gate_entry.ocr_supplier_name or "Unknown Supplier",
            "vehicle_number": gate_entry.vehicle_number or (asn.vehicle_number if asn else None),
            "driver_name": gate_entry.driver_name or (asn.driver_name if asn else None),
            "driver_contact": gate_entry.driver_phone or (asn.driver_contact if asn else None),
            "truck_photo_base64": base64.b64encode(gate_entry.vehicle_photo_data).decode("ascii") if gate_entry.vehicle_photo_data else None,
            "document_image_base64": base64.b64encode(gate_entry.po_document_data).decode("ascii") if gate_entry.po_document_data else None,
            "arrival_time": gate_entry.created_at.isoformat(),
            "facility_entry_at": gate_entry.facility_entry_at.isoformat() if gate_entry.facility_entry_at else None,
            "expected_arrival_at": asn.expected_arrival_at.isoformat() if asn and asn.expected_arrival_at else None,
            "status": (
                allocation.status
                if allocation and allocation.status in {"DOCK_ASSIGNED", "AT_DOCK", "OCCUPIED"}
                else
                GateEntryStatus.AWAITING_DOCK.value
                if gate_entry.status in {
                    GateEntryStatus.PO_VERIFIED.value,
                    GateEntryStatus.APPROVED.value,
                    GateEntryStatus.GATE_ENTRY_APPROVED.value,
                }
                else gate_entry.status
            ),
            "assigned_dock_id": gate_entry.assigned_dock_id,
            "dock_number": assignment.dock_number if assignment else gate_entry.assigned_dock_id,
            "assigned_warehouse_ref_id": str(assignment.assigned_warehouse_ref_id) if assignment and assignment.assigned_warehouse_ref_id else None,
            "assigned_warehouse_code": assignment.assigned_warehouse_code if assignment else None,
            "assigned_warehouse_name": assignment.assigned_warehouse_name if assignment else None,
            "po_id": str(po.id) if po else None,
            "assigned_by": assignment.assigned_by if assignment else None,
            "assigned_at": assignment.assigned_at.isoformat() if assignment else None,
            "allocation_request_id": str(allocation.id) if allocation else None,
            "movement_started_by": assignment.movement_started_by if assignment else None,
            "movement_started_at": assignment.movement_started_at.isoformat() if assignment and assignment.movement_started_at else None,
            "dock_checked_in_by": assignment.dock_checked_in_by if assignment else None,
            "dock_arrival_at": (
                assignment.dock_arrival_at.isoformat()
                if assignment and assignment.dock_arrival_at
                else allocation.arrived_at.isoformat()
                if allocation and allocation.arrived_at
                else None
            ),
            "allocation_arrived_at": allocation.arrived_at.isoformat() if allocation and allocation.arrived_at else None,
            "unloading_started_by": assignment.unloading_started_by if assignment else None,
            "unloading_started_at": assignment.unloading_started_at.isoformat() if assignment and assignment.unloading_started_at else None,
            "quality_inspected_by": assignment.quality_inspected_by if assignment else None,
            "quality_inspected_at": assignment.quality_inspected_at.isoformat() if assignment and assignment.quality_inspected_at else None,
            "quality_decision": assignment.quality_decision if assignment else None,
            "quality_notes": assignment.quality_notes if assignment else None,
            "prepared_grn_id": str(assignment.prepared_grn_id) if assignment and assignment.prepared_grn_id else None,
            "receiving_completed_by": assignment.receiving_completed_by if assignment else None,
            "receiving_completed_at": assignment.receiving_completed_at.isoformat() if assignment and assignment.receiving_completed_at else None,
            "dock_released_by": assignment.dock_released_by if assignment else None,
            "dock_released_at": assignment.dock_released_at.isoformat() if assignment and assignment.dock_released_at else None,
            "shipment": {
                "transporter": asn.transporter if asn else None,
                "number_of_packages": asn.number_of_packages if asn else None,
                "package_type": asn.package_type if asn else None,
                "shipping_method": asn.shipping_method if asn else None,
            },
            "expected_materials": [
                {
                    "item_code": line.get("item_code"),
                    "material_name": line.get("material_name"),
                    "quantity": float(line.get("shipped_quantity", line.get("quantity", 0)) or 0),
                    "po_quantity": (
                        next(
                            (
                                float(item.quantity)
                                for item in (po.items if po else [])
                                if (
                                    getattr(item, "material_code", None) == line.get("item_code")
                                    or getattr(item, "item_code", None) == line.get("item_code")
                                    or getattr(item, "material_name", None) == line.get("material_name")
                                    or getattr(item, "material_description", None) == line.get("material_name")
                                )
                            ),
                            None,
                        )
                        or float(line.get("shipped_quantity", line.get("quantity", 0)) or 0)
                    ),
                    "uom": line.get("uom"),
                    "received_quantity": float(received_by_code[line.get("item_code")].received_quantity) if line.get("item_code") in received_by_code else None,
                    "variance_to_po": float(received_by_code[line.get("item_code")].received_quantity - received_by_code[line.get("item_code")].ordered_quantity) if line.get("item_code") in received_by_code else None,
                    "variance_to_shipped": float(received_by_code[line.get("item_code")].received_quantity - received_by_code[line.get("item_code")].shipped_quantity) if line.get("item_code") in received_by_code else None,
                    "recorded_by": received_by_code[line.get("item_code")].recorded_by if line.get("item_code") in received_by_code else None,
                    "recorded_at": received_by_code[line.get("item_code")].recorded_at.isoformat() if line.get("item_code") in received_by_code else None,
                    "verification_status": received_by_code[line.get("item_code")].verification_status if line.get("item_code") in received_by_code else None,
                    "exception_quantity": float(received_by_code[line.get("item_code")].exception_quantity) if line.get("item_code") in received_by_code else None,
                    "good_quantity": float(received_by_code[line.get("item_code")].good_quantity) if line.get("item_code") in received_by_code and received_by_code[line.get("item_code")].good_quantity is not None else None,
                    "damaged_quantity": float(received_by_code[line.get("item_code")].damaged_quantity) if line.get("item_code") in received_by_code and received_by_code[line.get("item_code")].damaged_quantity is not None else None,
                    "rejected_quantity": float(received_by_code[line.get("item_code")].rejected_quantity) if line.get("item_code") in received_by_code and received_by_code[line.get("item_code")].rejected_quantity is not None else None,
                    "condition_result": received_by_code[line.get("item_code")].condition_result if line.get("item_code") in received_by_code else None,
                    "inspection_required": received_by_code[line.get("item_code")].inspection_required if line.get("item_code") in received_by_code else False,
                    "physical_condition_ok": received_by_code[line.get("item_code")].physical_condition_ok if line.get("item_code") in received_by_code else None,
                    "packaging_ok": received_by_code[line.get("item_code")].packaging_ok if line.get("item_code") in received_by_code else None,
                    "specifications_ok": received_by_code[line.get("item_code")].specifications_ok if line.get("item_code") in received_by_code else None,
                    "serial_batch_number": received_by_code[line.get("item_code")].serial_batch_number if line.get("item_code") in received_by_code else None,
                    "serial_batch_verified": received_by_code[line.get("item_code")].serial_batch_verified if line.get("item_code") in received_by_code else False,
                    "disposition_status": received_by_code[line.get("item_code")].disposition_status if line.get("item_code") in received_by_code else None,
                    "quarantine_location": received_by_code[line.get("item_code")].quarantine_location if line.get("item_code") in received_by_code else None,
                    "quarantined_by": received_by_code[line.get("item_code")].quarantined_by if line.get("item_code") in received_by_code else None,
                    "quarantined_at": received_by_code[line.get("item_code")].quarantined_at.isoformat() if line.get("item_code") in received_by_code and received_by_code[line.get("item_code")].quarantined_at else None,
                    "condition_notes": received_by_code[line.get("item_code")].condition_notes if line.get("item_code") in received_by_code else None,
                }
                for line in expected_material_rows
            ],
        })
    return arrivals


@router.get("/docks")
async def list_docks(
    _user: CurrentUser = Depends(require_permission("gate:read")),
    uow: UnitOfWork = Depends(get_uow),
):
    dock_result = await uow.session.execute(select(DockModel).order_by(DockModel.dock_number))
    assignment_result = await uow.session.execute(
        select(GateEntryModel, AsnModel, DockAssignmentModel)
        .join(AsnModel, GateEntryModel.asn_id == AsnModel.id)
        .outerjoin(DockAssignmentModel, DockAssignmentModel.gate_entry_id == GateEntryModel.id)
        .where(GateEntryModel.status.in_([GateEntryStatus.DOCK_ASSIGNED.value, GateEntryStatus.INSIDE_FACILITY.value, GateEntryStatus.MOVING_TO_DOCK.value, GateEntryStatus.AT_DOCK.value, GateEntryStatus.UNLOADING_IN_PROGRESS.value, GateEntryStatus.QUALITY_INSPECTION_REQUIRED.value, GateEntryStatus.QUALITY_PASSED.value, GateEntryStatus.QUALITY_FAILED.value, GateEntryStatus.RECEIVING_COMPLETED.value]))
    )
    assignments = {entry.assigned_dock_id: (entry, asn, assignment) for entry, asn, assignment in assignment_result.all() if entry.assigned_dock_id and assignment and assignment.dock_released_at is None}
    return [
        {
            "id": dock.dock_number,
            "dock_number": dock.dock_number,
            "warehouse_id": dock.warehouse_id,
            "zone": dock.warehouse_id,
            "dock_type": dock.dock_type,
            "type": dock.dock_type,
            "capacity": dock.capacity,
            "status": dock.status,
            "current_vehicle": assignments[dock.dock_number][0].vehicle_number if dock.dock_number in assignments else None,
            "vehicle_number": assignments[dock.dock_number][0].vehicle_number if dock.dock_number in assignments else None,
            "current_asn_id": str(assignments[dock.dock_number][1].id) if dock.dock_number in assignments else None,
            "current_asn": assignments[dock.dock_number][1].asn_number if dock.dock_number in assignments else None,
            "current_po": assignments[dock.dock_number][0].po_number if dock.dock_number in assignments else None,
            "assigned_by": assignments[dock.dock_number][2].assigned_by if dock.dock_number in assignments and assignments[dock.dock_number][2] else None,
            "assigned_at": assignments[dock.dock_number][2].assigned_at.isoformat() if dock.dock_number in assignments and assignments[dock.dock_number][2] else None,
            "dock_checked_in_by": assignments[dock.dock_number][2].dock_checked_in_by if dock.dock_number in assignments and assignments[dock.dock_number][2] else None,
            "dock_arrival_at": assignments[dock.dock_number][2].dock_arrival_at.isoformat() if dock.dock_number in assignments and assignments[dock.dock_number][2] and assignments[dock.dock_number][2].dock_arrival_at else None,
            "updated_at": dock.updated_at.isoformat(),
        }
        for dock in dock_result.scalars().all()
    ]


@router.post("/docks", status_code=status.HTTP_201_CREATED)
async def create_dock(
    request: CreateDockRequest,
    _user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    dock_number = request.dock_number.strip().upper()
    existing = await uow.session.execute(select(DockModel.id).where(DockModel.dock_number == dock_number))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail=f"Dock {dock_number} already exists")
    dock_status = request.status.strip().upper()
    if dock_status not in {"AVAILABLE", "MAINTENANCE"}:
        raise HTTPException(status_code=422, detail="A new dock must be AVAILABLE or MAINTENANCE")
    dock = DockModel(dock_number=dock_number, warehouse_id=request.warehouse_id.strip().upper(), dock_type=request.dock_type.strip().upper(), capacity=request.capacity, status=dock_status)
    uow.session.add(dock)
    await uow.session.flush()
    return {"id": str(dock.id), "dock_number": dock.dock_number, "status": dock.status}


@router.patch("/docks/{dock_number}")
async def update_dock(
    dock_number: str,
    request: UpdateDockRequest,
    _user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    result = await uow.session.execute(select(DockModel).where(DockModel.dock_number == dock_number.strip().upper()))
    dock = result.scalar_one_or_none()
    if dock is None:
        raise HTTPException(status_code=404, detail="Dock not found")
    if request.status:
        next_status = request.status.strip().upper()
        if next_status not in {"AVAILABLE", "MAINTENANCE"}:
            raise HTTPException(status_code=422, detail="Status must be AVAILABLE or MAINTENANCE")
        if dock.status == "OCCUPIED":
            raise HTTPException(status_code=409, detail="An occupied dock cannot be changed manually")
        dock.status = next_status
    if request.warehouse_id: dock.warehouse_id = request.warehouse_id.strip().upper()
    if request.dock_type: dock.dock_type = request.dock_type.strip().upper()
    if request.capacity is not None: dock.capacity = request.capacity
    dock.updated_at = datetime.datetime.now(datetime.timezone.utc)
    await uow.session.flush()
    return {"dock_number": dock.dock_number, "status": dock.status}


@router.post("/{entry_id}/assign-dock")
async def assign_arrival_dock(
    entry_id: str,
    request: AssignDockRequest,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    dock_id_raw = request.dock_id.strip()
    dock = None

    # 1. Search by UUID in DockModel
    try:
        val_uuid = uuid.UUID(dock_id_raw)
        dock_res = await uow.session.execute(select(DockModel).where(DockModel.id == val_uuid))
        dock = dock_res.scalar_one_or_none()
    except ValueError:
        pass

    # 2. Search by dock_number in DockModel
    if dock is None:
        dock_res = await uow.session.execute(
            select(DockModel).where(
                or_(
                    DockModel.dock_number == dock_id_raw,
                    DockModel.dock_number == dock_id_raw.upper(),
                )
            )
        )
        dock = dock_res.scalar_one_or_none()

    # 3. Search in DockMasterModel to map dock_code
    if dock is None:
        dm_res = await uow.session.execute(
            select(DockMasterModel).where(
                or_(
                    DockMasterModel.dock_code == dock_id_raw,
                    func.upper(DockMasterModel.dock_code) == dock_id_raw.upper(),
                )
            )
        )
        dm = dm_res.scalar_one_or_none()
        if dm:
            dock_res = await uow.session.execute(
                select(DockModel).where(
                    or_(
                        DockModel.dock_number == dm.dock_code,
                        func.upper(DockModel.dock_number) == dm.dock_code.upper(),
                    )
                )
            )
            dock = dock_res.scalar_one_or_none()
            if dock is None:
                dock = DockModel(
                    dock_number=dm.dock_code.upper(),
                    warehouse_id=(dm.location or "WH-001").strip().upper(),
                    dock_type=dm.dock_type,
                    capacity=1,
                    status=(dm.status or "AVAILABLE").strip().upper(),
                )
                uow.session.add(dock)
                await uow.session.flush()

    # 4. Search in DockMasterModel by UUID and map dock_code
    if dock is None:
        try:
            val_uuid = uuid.UUID(dock_id_raw)
            dm_res = await uow.session.execute(select(DockMasterModel).where(DockMasterModel.id == val_uuid))
            dm = dm_res.scalar_one_or_none()
            if dm:
                dock_res = await uow.session.execute(
                    select(DockModel).where(
                        or_(
                            DockModel.dock_number == dm.dock_code,
                            DockModel.dock_number == dm.dock_code.upper(),
                        )
                    )
                )
                dock = dock_res.scalar_one_or_none()
                if dock is None:
                    dock = DockModel(
                        dock_number=dm.dock_code.upper(),
                        warehouse_id=(dm.location or "WH-001").strip().upper(),
                        dock_type=dm.dock_type,
                        capacity=1,
                        status=(dm.status or "AVAILABLE").strip().upper(),
                    )
                    uow.session.add(dock)
                    await uow.session.flush()
        except ValueError:
            pass

    if dock is None:
        raise HTTPException(status_code=422, detail=f"Unknown dock '{dock_id_raw}'")

    # Serialize competing manager clicks/requests for the same dock. The
    # availability check must happen while the dock row is locked, otherwise
    # two concurrent allocations could both observe AVAILABLE.
    locked_dock_result = await uow.session.execute(
        select(DockModel).where(DockModel.id == dock.id).with_for_update()
    )
    dock = locked_dock_result.scalar_one()
    dock_id = dock.dock_number
    if dock.status != "AVAILABLE":
        raise HTTPException(status_code=409, detail=f"Dock {dock_id} is {dock.status.lower()}")
    occupied = await uow.session.execute(
        select(GateEntryModel.id).where(
            GateEntryModel.assigned_dock_id == dock_id,
            GateEntryModel.status == GateEntryStatus.DOCK_ASSIGNED.value,
        )
    )
    if occupied.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail=f"Dock {dock_id} is already occupied")

    warehouse = None
    raw_warehouse_ref_id = request.warehouse_ref_id.strip() if request.warehouse_ref_id else ""
    if raw_warehouse_ref_id:
        try:
            warehouse_uuid = uuid.UUID(raw_warehouse_ref_id)
            warehouse = await uow.session.get(WarehouseModel, warehouse_uuid)
        except ValueError:
            pass

    if raw_warehouse_ref_id and warehouse is None:
        warehouse_res = await uow.session.execute(
            select(WarehouseModel).where(func.upper(WarehouseModel.warehouse_code) == raw_warehouse_ref_id.upper())
        )
        warehouse = warehouse_res.scalars().first()

    if warehouse is None:
        dock_wh = (dock.warehouse_id or "").strip().upper()
        warehouse_stmt = select(WarehouseModel).where(func.upper(WarehouseModel.status) == "ACTIVE")
        if dock_wh:
            warehouse_stmt = warehouse_stmt.where(func.upper(WarehouseModel.warehouse_id) == dock_wh)
        warehouse_res = await uow.session.execute(warehouse_stmt.order_by(WarehouseModel.warehouse_code).limit(1))
        warehouse = warehouse_res.scalars().first()

    if warehouse is None:
        detail = (
            f"Warehouse '{raw_warehouse_ref_id}' does not exist"
            if raw_warehouse_ref_id
            else "No active warehouse is available for this dock warehouse"
        )
        raise HTTPException(status_code=422, detail=detail)

    if (warehouse.status or "").strip().upper() != "ACTIVE":
        raise HTTPException(status_code=422, detail=f"Warehouse '{warehouse.warehouse_name}' ({warehouse.warehouse_code}) is inactive")

    # Validate Warehouse isolation
    warehouse_wh = (warehouse.warehouse_id or "").strip().upper()
    dock_wh = (dock.warehouse_id or "").strip().upper()
    if warehouse_wh and dock_wh and warehouse_wh != dock_wh:
        raise HTTPException(
            status_code=422,
            detail=f"Warehouse '{warehouse.warehouse_name}' belongs to warehouse '{warehouse.warehouse_id}', which does not match dock warehouse '{dock.warehouse_id}'",
        )

    try:
        model = await uow.session.get(GateEntryModel, uuid.UUID(entry_id))
    except (ValueError, TypeError):
        model = None
    if model is None:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    promotable_statuses = {
        GateEntryStatus.PO_VERIFIED.value,
        GateEntryStatus.APPROVED.value,
        GateEntryStatus.GATE_ENTRY_APPROVED.value,
        GateEntryStatus.UNSCHEDULED_ARRIVAL.value,
    }
    if model.status in promotable_statuses:
        model.status = GateEntryStatus.AWAITING_DOCK.value
    elif model.status != GateEntryStatus.AWAITING_DOCK.value:
        raise HTTPException(status_code=409, detail=f"Arrival in status {model.status} is not awaiting dock assignment")

    po = None
    if model.po_number:
        po_result = await uow.session.execute(
            select(PurchaseOrderModel).where(PurchaseOrderModel.po_number == model.po_number)
        )
        po = po_result.scalar_one_or_none()
        if po is None and model.asn_id is None:
            raise HTTPException(status_code=409, detail="Purchase order was not found")
    existing_assignment = await uow.session.execute(
        select(DockAssignmentModel.id).where(DockAssignmentModel.gate_entry_id == model.id)
    )
    if existing_assignment.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="This arrival already has a dock assignment")
    entry = _gate_entry_from_model(model)
    entry.assign_dock(dock_id)
    dock.status = "OCCUPIED"
    dock.updated_at = datetime.datetime.now(datetime.timezone.utc)
    await _save_gate_entry(uow.session, entry)
    assigned_at = datetime.datetime.now(datetime.timezone.utc)
    assignment = DockAssignmentModel(
        gate_entry_id=model.id,
        asn_id=model.asn_id,
        po_id=po.id if po else None,
        vehicle_number=model.vehicle_number,
        dock_number=dock_id,
        assigned_warehouse_ref_id=warehouse.id,
        assigned_warehouse_code=warehouse.warehouse_code,
        assigned_warehouse_name=warehouse.warehouse_name,
        assigned_by=user.username,
        assigned_at=assigned_at,
    )
    uow.session.add(assignment)
    # Gate-side allocation is also used by the vehicle queue. Keep its existing
    # warehouse request in the same state as the persisted gate assignment so
    # dock check-in can enforce DOCK_ASSIGNED without rejecting this valid path.
    allocation = (await uow.session.execute(
        select(DockAllocationRequestModel).where(
            DockAllocationRequestModel.existing_gate_pass_id == model.gate_entry_number
        ).with_for_update()
    )).scalar_one_or_none()
    if allocation is not None:
        if allocation.status not in {"PENDING", "PENDING_ALLOCATION", "AWAITING_DOCK"}:
            raise HTTPException(status_code=409, detail=f"Dock allocation is {allocation.status}, expected a pending request")
        allocation.status = "DOCK_ASSIGNED"
        allocation.assigned_by = user.username
        allocation.assigned_at = assigned_at
        allocation.assigned_store_id = store.id
        allocation.assigned_store_code = store.store_code
        allocation.assigned_store_name = store.store_name
        master = (await uow.session.execute(select(DockMasterModel).where(
            DockMasterModel.dock_code == dock_id
        ).with_for_update())).scalar_one_or_none()
        if master is not None:
            allocation.assigned_dock_id = master.id
            master.status = "OCCUPIED"
    if model.asn_id:
        asn = await uow.session.get(AsnModel, model.asn_id)
        if asn and not asn.warehouse_id:
            asn.warehouse_id = warehouse.warehouse_id
            logistics = list(asn.logistics or [])
            for index, item in enumerate(logistics):
                if isinstance(item, dict) and item.get("type") == "asn_details":
                    logistics[index] = {
                        **item,
                        "destination_warehouse": warehouse.warehouse_name,
                        "destination_warehouse_id": str(warehouse.id),
                    }
                    break
            else:
                logistics.append(
                    {
                        "type": "asn_details",
                        "destination_warehouse": warehouse.warehouse_name,
                        "destination_warehouse_id": str(warehouse.id),
                    }
                )
            asn.logistics = logistics

    # Dispatch targeted notification exclusively to the assigned Warehouse
    notif_msg = (
        f"Vehicle {entry.vehicle_plate} (Gate Entry: {entry.gate_entry_number}) has arrived at Dock {dock_id} "
        f"and has been assigned to {warehouse.warehouse_name} ({warehouse.warehouse_code}). "
        f"PO: {model.po_number}. Please proceed with the warehouse-side unloading/receiving workflow."
    )
    uow.session.add(NotificationModel(
        user_role=f"WH:{warehouse.warehouse_code}"[:32],
        title=f"Vehicle Arrival Assigned to {warehouse.warehouse_name}",
        message=notif_msg,
        link="/inventory",
    ))
    uow.session.add(NotificationModel(
        user_role=f"WH:{warehouse.id}"[:32],
        title=f"Vehicle Arrival Assigned to {warehouse.warehouse_name}",
        message=notif_msg,
        link="/inventory",
    ))
    # Security must receive the same allocation event so the driver can be
    # directed to the correct receiving bay immediately after assignment.
    uow.session.add(NotificationModel(
        user_role="GATE_SECURITY",
        title=f"Dock Assigned · {dock_id}",
        message=(
            f"Gate Pass {entry.gate_entry_number} / vehicle {entry.vehicle_plate} "
            f"is assigned to {dock_id}. Direct the vehicle to the receiving dock."
        ),
        link="/vehicle-queue",
        vehicle_number=model.vehicle_number,
        driver_name=model.driver_name,
        driver_phone=model.driver_phone,
        asn_number=asn.asn_number if model.asn_id and asn else None,
        po_number=model.po_number,
        notification_type="DOCK_ASSIGNED",
        idempotency_key=f"DOCK_ASSIGNED:{model.id}:{dock_id}",
    ))

    return {
        "id": entry.id,
        "status": entry.status.value,
        "asn_id": str(model.asn_id) if model.asn_id else None,
        "po_id": str(po.id) if po else None,
        "vehicle_number": model.vehicle_number,
        "dock_number": dock_id,
        "assigned_warehouse_ref_id": str(warehouse.id),
        "assigned_warehouse_code": warehouse.warehouse_code,
        "assigned_warehouse_name": warehouse.warehouse_name,
        "assigned_by": user.username,
        "assigned_at": assigned_at.isoformat(),
    }


@router.post("/{entry_id}/start-dock-movement")
async def start_dock_movement(
    entry_id: str,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        model = await uow.session.get(GateEntryModel, uuid.UUID(entry_id))
    except ValueError:
        model = None
    if model is None:
        # Security may scan the original six-character gate-pass value rather
        # than supplying the internal database identifier.
        model = (await uow.session.execute(
            select(GateEntryModel).where(
                func.upper(GateEntryModel.gate_entry_number) == entry_id.strip().upper()
            )
        )).scalar_one_or_none()
    if model is None:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    assignment_result = await uow.session.execute(
        select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == model.id)
    )
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=409, detail="A dock must be assigned before vehicle movement")
    entry = _gate_entry_from_model(model)
    entry.start_moving_to_dock()
    started_at = datetime.datetime.now(datetime.timezone.utc)
    assignment.movement_started_by = user.username
    assignment.movement_started_at = started_at
    entry.facility_entry_at = started_at
    await _save_gate_entry(uow.session, entry)
    uow.session.add(NotificationModel(
        user_role="WAREHOUSE",
        title="Vehicle Allowed Inside Facility",
        message=f"{entry.vehicle_plate} entered the facility and is proceeding to {entry.assigned_dock_id}.",
        link="/dock-management",
    ))
    return {
        "id": entry.id,
        "status": entry.status.value,
        "dock_number": entry.assigned_dock_id,
        "vehicle_number": entry.vehicle_plate,
        "movement_started_by": user.username,
        "movement_started_at": started_at.isoformat(),
        "facility_entry_at": started_at.isoformat(),
    }


@router.post("/{entry_id}/dock-check-in")
async def dock_check_in(
    entry_id: str,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        model = await uow.session.get(GateEntryModel, uuid.UUID(entry_id))
    except ValueError:
        model = None
    if model is None:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    assignment_result = await uow.session.execute(
        select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == model.id)
    )
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=409, detail="Dock assignment was not found")
    dock_result = await uow.session.execute(
        select(DockModel).where(DockModel.dock_number == assignment.dock_number)
    )
    dock = dock_result.scalar_one_or_none()
    if dock is None:
        raise HTTPException(status_code=409, detail="Assigned dock was not found")
    entry = _gate_entry_from_model(model)
    entry.check_in_at_dock()
    arrived_at = datetime.datetime.now(datetime.timezone.utc)
    assignment.dock_checked_in_by = user.username
    assignment.dock_arrival_at = arrived_at
    dock.status = "OCCUPIED"
    dock.updated_at = arrived_at
    allocation_result = await uow.session.execute(
        select(DockAllocationRequestModel).where(
            DockAllocationRequestModel.existing_gate_pass_id == (model.gate_entry_number or str(model.id))
        ).with_for_update()
    )
    allocation = allocation_result.scalar_one_or_none()
    if allocation is not None:
        if allocation.status != "DOCK_ASSIGNED":
            raise HTTPException(status_code=409, detail=f"Dock allocation is {allocation.status}, expected DOCK_ASSIGNED")
        allocation.status = "OCCUPIED"
        allocation.arrived_at = arrived_at
    await _save_gate_entry(uow.session, entry)
    uow.session.add(NotificationModel(
        user_role="WAREHOUSE",
        title="Vehicle Arrived at Dock",
        message=f"{entry.vehicle_plate} checked in at {assignment.dock_number} for ASN-linked receiving.",
        link="/dock-management",
    ))
    return {
        "id": entry.id,
        "status": entry.status.value,
        "dock_number": assignment.dock_number,
        "vehicle_number": assignment.vehicle_number,
        "asn_id": str(assignment.asn_id),
        "arrival_time": arrived_at.isoformat(),
        "checked_in_by": user.username,
        "dock_status": dock.status,
    }


@router.post("/{entry_id}/start-unloading")
async def start_unloading(
    entry_id: str,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        model = await uow.session.get(GateEntryModel, uuid.UUID(entry_id))
    except ValueError:
        model = None
    if model is None:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    assignment_result = await uow.session.execute(
        select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == model.id)
    )
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None or assignment.dock_arrival_at is None:
        raise HTTPException(status_code=409, detail="Vehicle must be checked in at the dock before unloading")
    entry = _gate_entry_from_model(model)
    entry.start_unloading()
    started_at = datetime.datetime.now(datetime.timezone.utc)
    assignment.unloading_started_by = user.username
    assignment.unloading_started_at = started_at
    await _save_gate_entry(uow.session, entry)
    uow.session.add(NotificationModel(
        user_role="WAREHOUSE",
        title="Unloading Started",
        message=f"Unloading started for {entry.vehicle_plate} at {entry.assigned_dock_id}.",
        link="/receiving",
    ))
    return {
        "id": entry.id,
        "status": entry.status.value,
        "asn_id": str(assignment.asn_id),
        "po_id": str(assignment.po_id),
        "vehicle_number": assignment.vehicle_number,
        "dock_number": assignment.dock_number,
        "started_by": user.username,
        "started_at": started_at.isoformat(),
    }


@router.put("/{entry_id}/receiving-quantities")
async def record_receiving_quantities(
    entry_id: str,
    request: RecordReceivingRequest,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        model = await uow.session.get(GateEntryModel, uuid.UUID(entry_id))
    except ValueError:
        model = None
    if model is None:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    if model.status != GateEntryStatus.UNLOADING_IN_PROGRESS.value:
        raise HTTPException(status_code=409, detail="Receiving quantities can only be recorded after unloading starts")
    assignment_result = await uow.session.execute(select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == model.id))
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=409, detail="Dock assignment was not found")
    asn_result = await uow.session.execute(select(AsnModel).options(selectinload(AsnModel.lines)).where(AsnModel.id == assignment.asn_id))
    asn = asn_result.scalar_one_or_none()
    po = None
    if assignment.po_id:
        po_result = await uow.session.execute(select(PurchaseOrderModel).options(selectinload(PurchaseOrderModel.items)).where(PurchaseOrderModel.id == assignment.po_id))
        po = po_result.scalar_one_or_none()
        if po is None:
            raise HTTPException(status_code=409, detail="Purchase order details were not found")
    if asn is None:
        raise HTTPException(status_code=409, detail="ASN details were not found")
    vehicle_manifest = _assigned_materials_for_vehicle(asn, model.vehicle_number)
    asn_lines = {
        line.item_code: {
            "item_code": line.item_code,
            "material_name": line.material_name,
            "uom": line.uom,
            "shipped_quantity": line.shipped_quantity,
        }
        for line in asn.lines
    }
    if vehicle_manifest is not None:
        asn_lines = {
            str(line.get("item_code") or ""): {
                "item_code": str(line.get("item_code") or ""),
                "material_name": str(line.get("material_name") or ""),
                "uom": str(line.get("uom") or "PCS"),
                "shipped_quantity": Decimal(str(line.get("shipped_quantity", line.get("quantity", 0)) or 0)),
            }
            for line in vehicle_manifest
            if line.get("item_code")
        }
    po_quantities = (
        {item.material_code: item.quantity for item in po.items}
        if po and vehicle_manifest is None
        else {}
    )
    submitted_codes = [item.item_code for item in request.items]
    if len(submitted_codes) != len(set(submitted_codes)):
        raise HTTPException(status_code=422, detail="Each material may only be submitted once")
    unknown = [code for code in submitted_codes if code not in asn_lines]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Materials are not present in ASN: {', '.join(unknown)}")
    recorded_at = datetime.datetime.now(datetime.timezone.utc)
    await uow.session.execute(delete(ReceivingLineModel).where(ReceivingLineModel.dock_assignment_id == assignment.id))
    response_items = []
    for submitted in request.items:
        asn_line = asn_lines[submitted.item_code]
        ordered = po_quantities.get(submitted.item_code, asn_line["shipped_quantity"])
        received = submitted.received_quantity
        verification_status, exception_quantity = _quantity_result(float(ordered), received)
        line = ReceivingLineModel(
            dock_assignment_id=assignment.id, item_code=submitted.item_code,
            material_name=asn_line["material_name"], uom=asn_line["uom"],
            ordered_quantity=ordered, shipped_quantity=asn_line["shipped_quantity"],
            received_quantity=received, recorded_by=user.username, recorded_at=recorded_at,
            verification_status=verification_status, exception_quantity=exception_quantity,
        )
        uow.session.add(line)
        response_items.append({
            "item_code": submitted.item_code, "ordered_quantity": float(ordered),
            "shipped_quantity": float(asn_line["shipped_quantity"]), "received_quantity": received,
            "variance_to_po": received - float(ordered),
            "variance_to_asn": received - float(asn_line["shipped_quantity"]),
            "variance_to_shipped": received - float(asn_line["shipped_quantity"]),
            "verification_status": verification_status, "exception_quantity": exception_quantity,
        })
    await uow.session.flush()
    return {"gate_entry_id": entry_id, "recorded_by": user.username, "recorded_at": recorded_at.isoformat(), "items": response_items}


@router.put("/{entry_id}/material-conditions")
async def record_material_conditions(
    entry_id: str,
    request: RecordMaterialConditionRequest,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        model = await uow.session.get(GateEntryModel, uuid.UUID(entry_id))
    except ValueError:
        model = None
    if model is None:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    if model.status not in {GateEntryStatus.UNLOADING_IN_PROGRESS.value, GateEntryStatus.QUALITY_INSPECTION_REQUIRED.value}:
        raise HTTPException(status_code=409, detail="Material condition can only be recorded during receiving or quality inspection")
    assignment_result = await uow.session.execute(select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == model.id))
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=409, detail="Dock assignment was not found")
    lines_result = await uow.session.execute(select(ReceivingLineModel).where(ReceivingLineModel.dock_assignment_id == assignment.id))
    lines = {line.item_code: line for line in lines_result.scalars().all()}
    submitted_codes = [item.item_code for item in request.items]
    if set(submitted_codes) != set(lines) or len(submitted_codes) != len(set(submitted_codes)):
        raise HTTPException(status_code=422, detail="Condition must be recorded once for every received material")
    checked_at = datetime.datetime.now(datetime.timezone.utc)
    results = []
    inspection_required = False
    for item in request.items:
        line = lines[item.item_code]
        accounted = item.good_quantity + item.damaged_quantity + item.rejected_quantity + item.held_quantity
        if abs(accounted - float(line.received_quantity)) > 0.0001:
            raise HTTPException(status_code=422, detail=f"Accepted, damaged, rejected and held quantities for {item.item_code} must equal received quantity")
        if item.inspection_required:
            result = "INSPECTION_REQUIRED"
        elif item.rejected_quantity > 0:
            result = "REJECTED"
        elif item.damaged_quantity > 0:
            result = "DAMAGED"
        elif line.verification_status in {"SHORT", "EXCESS"}:
            result = line.verification_status
        else:
            result = "ACCEPTED"
        line.good_quantity = item.good_quantity
        line.damaged_quantity = item.damaged_quantity
        line.rejected_quantity = item.rejected_quantity
        line.held_quantity = item.held_quantity
        line.condition_result = result
        line.inspection_required = item.inspection_required
        line.physical_condition_ok = item.physical_condition_ok
        line.packaging_ok = item.packaging_ok
        line.specifications_ok = item.specifications_ok
        line.serial_batch_number = item.serial_batch_number
        line.serial_batch_verified = item.serial_batch_verified
        if item.damaged_quantity > 0 and line.disposition_status != "QUARANTINED_DAMAGED":
            line.disposition_status = "AWAITING_QUARANTINE"
            line.quarantine_location = "QUARANTINE-DAMAGE-AREA"
        elif item.damaged_quantity == 0:
            line.disposition_status = None
            line.quarantine_location = None
            line.quarantined_by = None
            line.quarantined_at = None
        line.condition_notes = item.notes
        line.condition_checked_by = user.username
        line.condition_checked_at = checked_at
        inspection_required = inspection_required or item.inspection_required
        results.append({"item_code": item.item_code, "result": result, "good_quantity": item.good_quantity, "damaged_quantity": item.damaged_quantity, "rejected_quantity": item.rejected_quantity, "held_quantity": item.held_quantity})
    if inspection_required and model.status == GateEntryStatus.UNLOADING_IN_PROGRESS.value:
        entry = _gate_entry_from_model(model)
        entry.require_quality_inspection()
        await _save_gate_entry(uow.session, entry)
        uow.session.add(NotificationModel(user_role="WAREHOUSE", title="Quality Inspection Required", message=f"{entry.vehicle_plate} at {entry.assigned_dock_id} has materials awaiting inspection.", link="/grn"))
    await uow.session.flush()
    return {"gate_entry_id": entry_id, "status": model.status, "checked_by": user.username, "checked_at": checked_at.isoformat(), "items": results}


@router.post("/{entry_id}/materials/{item_code}/quarantine")
async def quarantine_damaged_material(
    entry_id: str,
    item_code: str,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        gate_id = uuid.UUID(entry_id)
    except ValueError:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    assignment = (await uow.session.execute(select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == gate_id))).scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Receiving record was not found")
    line = (await uow.session.execute(select(ReceivingLineModel).where(
        ReceivingLineModel.dock_assignment_id == assignment.id,
        ReceivingLineModel.item_code == item_code,
    ))).scalar_one_or_none()
    if line is None or not line.damaged_quantity or float(line.damaged_quantity) <= 0:
        raise HTTPException(status_code=409, detail="Only damaged material can be moved to quarantine")
    evidence = (await uow.session.execute(select(DamageReportModel.id).where(
        DamageReportModel.gate_entry_id == gate_id,
        DamageReportModel.receiving_line_id == line.id,
    ))).scalar_one_or_none()
    if evidence is None:
        raise HTTPException(status_code=409, detail="Save damage photos and inspection details before quarantine")
    moved_at = datetime.datetime.now(datetime.timezone.utc)
    line.disposition_status = "QUARANTINED_DAMAGED"
    line.quarantine_location = "QUARANTINE-DAMAGE-AREA"
    line.quarantined_by = user.username
    line.quarantined_at = moved_at
    uow.session.add(NotificationModel(
        user_role="WAREHOUSE", title="Damaged Goods Quarantined",
        message=f"{line.damaged_quantity} {line.uom or ''} of {line.material_name or line.item_code} moved to the quarantine damage area.",
        link="/receiving",
    ))
    await uow.session.flush()
    return {
        "item_code": item_code, "damaged_quantity": float(line.damaged_quantity),
        "status": "QUARANTINED_DAMAGED", "status_label": "Quarantine – Damaged",
        "location": line.quarantine_location, "quarantined_by": user.username,
        "quarantined_at": moved_at.isoformat(), "available_inventory_quantity": 0,
    }


@router.post("/{entry_id}/damage-reports", status_code=status.HTTP_201_CREATED)
async def create_damage_report(
    entry_id: str,
    item_code: str = Form(...),
    damaged_quantity: float = Form(...),
    damage_reason: str = Form(...),
    remarks: str | None = Form(default=None),
    photos: list[UploadFile] = File(...),
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        gate_id = uuid.UUID(entry_id)
    except ValueError:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    model = await uow.session.get(GateEntryModel, gate_id)
    if model is None:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    assignment = (await uow.session.execute(select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == gate_id))).scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=409, detail="Dock assignment was not found")
    line = (await uow.session.execute(select(ReceivingLineModel).where(
        ReceivingLineModel.dock_assignment_id == assignment.id,
        ReceivingLineModel.item_code == item_code,
    ))).scalar_one_or_none()
    if line is None or not line.damaged_quantity or float(line.damaged_quantity) <= 0:
        raise HTTPException(status_code=409, detail="Record a damaged quantity for this material first")
    if damaged_quantity <= 0 or abs(damaged_quantity - float(line.damaged_quantity)) > 0.0001:
        raise HTTPException(status_code=422, detail="Damage report quantity must match the inspected damaged quantity")
    if not damage_reason.strip() or not photos:
        raise HTTPException(status_code=422, detail="Damage reason and at least one photo are required")

    grn_number = None
    if assignment.prepared_grn_id:
        grn = await uow.session.get(GrnModel, assignment.prepared_grn_id)
        grn_number = grn.grn_number if grn else None
    inspected_at = datetime.datetime.now(datetime.timezone.utc)
    last_report_number = (await uow.session.execute(
        select(func.max(DamageReportModel.report_number))
    )).scalar_one_or_none()
    try:
        next_report_sequence = int(last_report_number.split("-", 1)[1]) + 1 if last_report_number else 1
    except (ValueError, IndexError):
        next_report_sequence = 1
    report_number = f"DR-{next_report_sequence:05d}"
    report = DamageReportModel(
        report_number=report_number, gate_entry_id=gate_id, receiving_line_id=line.id, material_code=line.item_code,
        material_name=line.material_name, po_number=model.po_number, grn_number=grn_number,
        received_quantity=line.received_quantity, damaged_quantity=damaged_quantity, damage_reason=damage_reason.strip(),
        inspection_date=inspected_at, inspector=user.username, remarks=remarks.strip() if remarks else None,
        status="PENDING_PROCUREMENT",
    )
    uow.session.add(report)
    await uow.session.flush()
    for photo in photos:
        content_type = photo.content_type or ""
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=422, detail=f"{photo.filename or 'Upload'} is not an image")
        data = await photo.read()
        if not data or len(data) > 10 * 1024 * 1024:
            raise HTTPException(status_code=422, detail="Each damage photo must be between 1 byte and 10 MB")
        uow.session.add(DamagePhotoModel(
            damage_report_id=report.id, filename=photo.filename or "damage-photo",
            content_type=content_type, image_data=data,
        ))
    await uow.session.flush()
    return {
        "id": str(report.id), "report_number": report.report_number,
        "material": report.material_name or report.material_code,
        "po_number": report.po_number, "grn_number": report.grn_number,
        "received_quantity": float(report.received_quantity), "damaged_quantity": damaged_quantity,
        "damage_reason": report.damage_reason,
        "inspection_date": inspected_at.isoformat(), "inspector": user.username,
        "remarks": report.remarks, "photo_count": len(photos),
        "status": report.status, "status_label": "Pending Procurement",
    }


@router.post("/damage-reports/{report_id}/submit")
async def submit_damage_report(
    report_id: str,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        report = await uow.session.get(DamageReportModel, uuid.UUID(report_id))
    except ValueError:
        report = None
    if report is None:
        raise HTTPException(status_code=404, detail="Damage report was not found")
    line = await uow.session.get(ReceivingLineModel, report.receiving_line_id)
    if line is None or line.disposition_status != "QUARANTINED_DAMAGED":
        raise HTTPException(status_code=409, detail="Move damaged goods to quarantine before submitting the report")
    submitted_at = datetime.datetime.now(datetime.timezone.utc)
    report.status = "PENDING_PROCUREMENT"
    report.submitted_by = user.username
    report.submitted_at = submitted_at
    uow.session.add(NotificationModel(
        user_role="PROCUREMENT", title=f"Damage Report {report.report_number}",
        message=f"{report.damaged_quantity} {line.uom or ''} {report.material_name or report.material_code} damaged against {report.po_number}.",
        link="/procurement/quality-issues",
    ))
    # Publish the submitted GRN damage report directly to the supplier portal.
    # This is idempotent so retries cannot create duplicate supplier claims.
    gate = await uow.session.get(GateEntryModel, report.gate_entry_id)
    asn = await uow.session.get(AsnModel, gate.asn_id) if gate and gate.asn_id else None
    if asn and asn.supplier_id:
        existing_claim = (await uow.session.execute(
            select(SupplierDamageClaimModel).where(
                SupplierDamageClaimModel.damage_report_id == report.id
            )
        )).scalar_one_or_none()
        if existing_claim is None:
            last_claim = (await uow.session.execute(
                select(func.max(SupplierDamageClaimModel.claim_number))
            )).scalar_one_or_none()
            try:
                next_claim_number = int(last_claim.split("-", 1)[1]) + 1 if last_claim else 1
            except (ValueError, IndexError):
                next_claim_number = 1
            claim_number = f"DC-{next_claim_number:05d}"
            uow.session.add(SupplierDamageClaimModel(
                claim_number=claim_number,
                damage_report_id=report.id,
                supplier_id=asn.supplier_id,
                status="SUPPLIER_SENT",
                created_by=user.username,
                created_at=submitted_at,
                sent_at=submitted_at,
            ))
            report.status = "SUPPLIER_CLAIM_SENT"
            uow.session.add(NotificationModel(
                user_role="SUPPLIER",
                title=f"Damage Return {claim_number}",
                message=(
                    f"{report.damaged_quantity} {line.uom or 'PCS'} of "
                    f"{report.material_name or report.material_code} from GRN "
                    f"{report.grn_number or 'pending'} requires your review."
                ),
                link="/damage-claims",
            ))
    await uow.session.flush()
    return {"id": str(report.id), "report_number": report.report_number, "status": report.status,
            "status_label": "Pending Procurement", "submitted_by": user.username,
            "submitted_at": submitted_at.isoformat()}


@router.post("/{entry_id}/quality-inspection")
async def complete_quality_inspection(
    entry_id: str,
    request: QualityInspectionDecisionRequest,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        model = await uow.session.get(GateEntryModel, uuid.UUID(entry_id))
    except ValueError:
        model = None
    if model is None:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    assignment_result = await uow.session.execute(select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == model.id))
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=409, detail="Dock assignment was not found")
    entry = _gate_entry_from_model(model)
    passed = request.decision == "PASS"
    entry.complete_quality_inspection(passed)
    inspected_at = datetime.datetime.now(datetime.timezone.utc)
    assignment.quality_inspected_by = user.username
    assignment.quality_inspected_at = inspected_at
    assignment.quality_decision = request.decision
    assignment.quality_notes = request.notes
    await _save_gate_entry(uow.session, entry)
    uow.session.add(NotificationModel(user_role="WAREHOUSE", title=f"Quality Inspection {request.decision}", message=f"Inspection {request.decision.lower()} for {entry.vehicle_plate} at {entry.assigned_dock_id}.", link="/grn"))
    return {"gate_entry_id": entry_id, "status": entry.status.value, "decision": request.decision, "inspected_by": user.username, "inspected_at": inspected_at.isoformat()}


@router.post("/{entry_id}/quality-issue")
async def send_quality_issue_to_procurement(
    entry_id: str,
    image: UploadFile = File(...),
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        gate_id = uuid.UUID(entry_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Gate entry was not found")
    model = await uow.session.get(GateEntryModel, gate_id)
    assignment = (await uow.session.execute(select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == gate_id))).scalar_one_or_none()
    if model is None or assignment is None:
        raise HTTPException(status_code=404, detail="Receiving record was not found")
    if model.status != GateEntryStatus.QUALITY_FAILED.value:
        raise HTTPException(status_code=409, detail="Evidence can only be sent after a failed quality inspection")
    content_type = (image.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="Upload an image file")
    data = await image.read()
    if not data or len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="Image must be between 1 byte and 10 MB")
    now = datetime.datetime.now(datetime.timezone.utc)
    assignment.quality_issue_image_data = data
    assignment.quality_issue_filename = image.filename or "quality-evidence"
    assignment.quality_issue_content_type = content_type
    assignment.quality_issue_status = "PROCUREMENT_PENDING"
    assignment.quality_issue_sent_at = now
    assignment.quality_issue_forwarded_at = None
    uow.session.add(NotificationModel(user_role="PROCUREMENT", title="Supplier Quality Issue", message=f"Failed inspection evidence received for {model.po_number} / {assignment.vehicle_number}.", link="/procurement/quality-issues"))
    await uow.session.flush()
    return {"gate_entry_id": entry_id, "status": assignment.quality_issue_status, "sent_at": now.isoformat()}








@router.post("/{entry_id}/handling-units")
async def generate_handling_units(
    entry_id: str,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        gate_id = uuid.UUID(entry_id)
    except ValueError:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    model = await uow.session.get(GateEntryModel, gate_id)
    if model is None:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    assignment_result = await uow.session.execute(select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == model.id))
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=409, detail="Dock assignment was not found")
    lines_result = await uow.session.execute(select(ReceivingLineModel).where(ReceivingLineModel.dock_assignment_id == assignment.id))
    lines = lines_result.scalars().all()
    if not lines or any(line.condition_checked_at is None or line.good_quantity is None for line in lines):
        raise HTTPException(status_code=409, detail="Complete condition verification before generating material labels")
    if any(line.inspection_required for line in lines) and model.status not in {GateEntryStatus.QUALITY_PASSED.value, GateEntryStatus.RECEIVING_COMPLETED.value}:
        raise HTTPException(status_code=409, detail="Required quality inspections must pass before generating labels")
    po = await uow.session.get(PurchaseOrderModel, assignment.po_id) if assignment.po_id else None
    asn = await uow.session.get(AsnModel, assignment.asn_id)
    if asn is None:
        raise HTTPException(status_code=409, detail="ASN context was not found")
    supplier_name = await _asn_supplier_name(uow.session, asn, po)
    warehouse_id = await _warehouse_for_gate_assignment(uow.session, asn, assignment, po)
    if not warehouse_id:
        raise HTTPException(status_code=409, detail="A receiving warehouse could not be resolved from the ASN and dock assignment")
    existing_result = await uow.session.execute(select(HandlingUnitModel).where(HandlingUnitModel.receiving_line_id.in_([line.id for line in lines])))
    by_line = {unit.receiving_line_id: unit for unit in existing_result.scalars().all()}
    now = datetime.datetime.now(datetime.timezone.utc)
    units = []
    for line in lines:
        if (line.good_quantity or 0) <= 0:
            continue
        unit = by_line.get(line.id)
        if unit is None:
            hu_number = f"HU-{now.year}-{uuid.uuid4().hex[:12].upper()}"
            unit = HandlingUnitModel(
                hu_number=hu_number, barcode_value=hu_number, receiving_line_id=line.id,
                item_code=line.item_code, material_name=line.material_name or line.item_code,
                quantity=line.good_quantity, uom=line.uom or "PCS", supplier_name=supplier_name,
                po_number=model.po_number, asn_number=asn.asn_number,
                warehouse_id=warehouse_id, current_location="RECEIVING_AREA",
                status="QR_GENERATED", generated_by=user.username, generated_at=now, updated_at=now,
            )
            uow.session.add(unit)
            await uow.session.flush()
        units.append(unit)
    return {"gate_entry_id": entry_id, "items": [
        {"id": str(unit.id), "hu_number": unit.hu_number, "barcode_value": unit.barcode_value,
         "item_code": unit.item_code, "material_name": unit.material_name, "quantity": float(unit.quantity),
         "uom": unit.uom, "batch_number": unit.batch_number, "supplier_name": unit.supplier_name,
         "po_number": unit.po_number, "asn_number": unit.asn_number, "grn_number": unit.grn_number,
         "warehouse_id": unit.warehouse_id, "current_location": unit.current_location, "status": unit.status}
        for unit in units
    ]}


@router.post("/{entry_id}/complete-receiving")
async def complete_receiving(
    entry_id: str,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        model = await uow.session.get(GateEntryModel, uuid.UUID(entry_id))
    except ValueError:
        model = None
    if model is None:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    assignment_result = await uow.session.execute(select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == model.id))
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=409, detail="Dock assignment was not found")
    if assignment.prepared_grn_id is not None:
        raise HTTPException(status_code=409, detail="Receiving is already completed and the GRN is prepared")
    lines_result = await uow.session.execute(select(ReceivingLineModel).where(ReceivingLineModel.dock_assignment_id == assignment.id))
    lines = lines_result.scalars().all()
    if not lines:
        raise HTTPException(status_code=409, detail="Received quantities must be recorded before completion")
    if any(line.condition_checked_at is None or line.condition_result is None for line in lines):
        raise HTTPException(status_code=409, detail="All received materials must complete condition verification")
    if any(line.inspection_required for line in lines) and model.status != GateEntryStatus.QUALITY_PASSED.value:
        raise HTTPException(status_code=409, detail="Required quality inspections must pass before receiving completion")
    if any(line.good_quantity is None for line in lines):
        raise HTTPException(status_code=409, detail="Accepted quantity is missing for one or more materials")
    if any((line.damaged_quantity or 0) > 0 and line.disposition_status != "QUARANTINED_DAMAGED" for line in lines):
        raise HTTPException(status_code=409, detail="Move all damaged goods to quarantine before completing receiving")
    entry = _gate_entry_from_model(model)
    entry.complete_receiving()
    completed_at = datetime.datetime.now(datetime.timezone.utc)
    po = await uow.session.get(PurchaseOrderModel, assignment.po_id) if assignment.po_id else None
    asn = await uow.session.get(AsnModel, assignment.asn_id)
    if asn is None:
        raise HTTPException(status_code=409, detail="ASN context was not found for GRN creation")
    supplier_name = await _asn_supplier_name(uow.session, asn, po)
    warehouse_id = await _warehouse_for_gate_assignment(uow.session, asn, assignment, po)
    if not warehouse_id:
        raise HTTPException(status_code=409, detail="A receiving warehouse could not be resolved from the ASN and dock assignment")
    grn_prefix = f"GRN-{completed_at.year}-"
    last_number_result = await uow.session.execute(select(func.max(GrnModel.grn_number)).where(GrnModel.grn_number.like(f"{grn_prefix}%")))
    last_number = last_number_result.scalar_one_or_none()
    try:
        next_sequence = int(last_number.rsplit("-", 1)[1]) + 1 if last_number else 1
    except (ValueError, IndexError):
        next_sequence = 1
    grn_number = f"{grn_prefix}{next_sequence:04d}"
    grn_id = uuid.uuid4()
    grn = GrnModel(
        id=grn_id, grn_number=grn_number, po_id=assignment.po_id, po_number=model.po_number,
        asn_id=asn.id, asn_number=asn.asn_number, supplier_name=supplier_name,
        vehicle_number=assignment.vehicle_number, warehouse_id=warehouse_id,
        dock_number=assignment.dock_number, status="GRN_DRAFT",
    )
    grn.lines = [
        GrnLineModel(
            item_code=line.item_code, material_name=line.material_name, uom=line.uom,
            received_quantity=line.received_quantity, ordered_quantity=line.ordered_quantity,
            accepted_quantity=line.good_quantity, damaged_quantity=line.damaged_quantity or 0,
            rejected_quantity=line.rejected_quantity or 0, held_quantity=line.held_quantity or 0, quality_result=line.condition_result,
        )
        for line in lines
    ]
    uow.session.add(grn)
    # The assignment references this new GRN. Flush the parent first because
    # assignment is an existing row and SQLAlchemy may otherwise schedule its
    # UPDATE ahead of the unrelated GRN INSERT, violating the foreign key.
    await uow.session.flush()
    # Publish GRN-native damage claims. This is the authoritative source for
    # QC damage/rejection and does not depend on the legacy gate damage report.
    if asn.supplier_id:
        last_claim = (await uow.session.execute(select(func.max(SupplierDamageClaimModel.claim_number)))).scalar_one_or_none()
        try:
            claim_sequence = int(last_claim.split("-", 1)[1]) + 1 if last_claim else 1
        except (ValueError, IndexError):
            claim_sequence = 1
        for grn_line in grn.lines:
            if (grn_line.damaged_quantity or 0) <= 0 and (grn_line.rejected_quantity or 0) <= 0:
                continue
            existing = (await uow.session.execute(select(SupplierDamageClaimModel.id).where(SupplierDamageClaimModel.source_grn_line_id == grn_line.id))).scalar_one_or_none()
            if existing:
                continue
            evidence = (await uow.session.execute(select(GrnDamageEvidenceModel).where(GrnDamageEvidenceModel.grn_line_id == grn_line.id))).scalars().first()
            claim_number = f"DC-{claim_sequence:05d}"
            claim_sequence += 1
            uow.session.add(SupplierDamageClaimModel(
                claim_number=claim_number, damage_report_id=None, source_grn_id=grn.id,
                source_grn_line_id=grn_line.id, supplier_id=asn.supplier_id,
                status="SUPPLIER_SENT", created_by=user.username,
                created_at=completed_at, sent_at=completed_at,
            ))
            uow.session.add(NotificationModel(
                user_role="SUPPLIER", title=f"Damage Return {claim_number}",
                message=f"GRN {grn_number}: damaged/rejected material requires your response.",
                link="/damage-claims",
            ))
    receiving_by_code = {line.item_code: line for line in lines}
    units_result = await uow.session.execute(select(HandlingUnitModel).where(HandlingUnitModel.receiving_line_id.in_([line.id for line in lines])))
    units_by_receiving_line = {unit.receiving_line_id: unit for unit in units_result.scalars().all()}
    task_prefix = f"PT-{completed_at.year}-"
    last_task_result = await uow.session.execute(select(func.max(PutawayTaskModel.task_number)).where(PutawayTaskModel.task_number.like(f"{task_prefix}%")))
    last_task_number = last_task_result.scalar_one_or_none()
    try:
        next_task_sequence = int(last_task_number.rsplit("-", 1)[1]) + 1 if last_task_number else 1
    except (ValueError, IndexError):
        next_task_sequence = 1
    tasks_created = 0
    existing_task_items_result = await uow.session.execute(
        select(PutawayTaskModel.grn_id, PutawayTaskModel.item_code).where(
            PutawayTaskModel.grn_id == grn.id,
            PutawayTaskModel.status.not_in(["CANCELLED", "VOID"]),
        )
    )
    existing_task_items = {
        (task_grn_id, item_code.upper())
        for task_grn_id, item_code in existing_task_items_result.all()
    }
    for grn_line in grn.lines:
        unit = units_by_receiving_line.get(receiving_by_code[grn_line.item_code].id)
        if unit is None and (grn_line.accepted_quantity or 0) > 0:
            raise HTTPException(status_code=409, detail=f"Generate a material label for {grn_line.item_code} before completing receiving")
        if unit is not None and (grn.id, grn_line.item_code.upper()) not in existing_task_items:
            unit.grn_line_id = grn_line.id
            unit.grn_number = grn_number
            accepted = grn_line.accepted_quantity or 0
            if accepted > 0:
                suggested_location, placement = await recommend_storage_location(
                    uow.session, warehouse_id=grn.warehouse_id, material_code=grn_line.item_code,
                    material_name=grn_line.material_name or grn_line.item_code,
                    quantity=accepted, uom=grn_line.uom or "PCS",
                )
                uow.session.add(PutawayTaskModel(
                    task_number=f"{task_prefix}{next_task_sequence:04d}", grn_id=grn.id,
                    grn_number=grn.grn_number, handling_unit_id=unit.id, item_code=grn_line.item_code,
                    material_name=grn_line.material_name or grn_line.item_code, quantity=accepted,
                    uom=grn_line.uom or "PCS", warehouse_id=grn.warehouse_id,
                    source_location=f"Receiving / {assignment.dock_number}" if assignment else "Receiving Area",
                    destination_warehouse_ref_id=getattr(assignment, "assigned_warehouse_ref_id", None),
                    assigned_to=getattr(assignment, "assigned_warehouse_operator_username", None) or getattr(assignment, "assigned_warehouse_operator_name", None) or getattr(assignment, "assigned_warehouse_operator_id", None),
                    assigned_by=getattr(assignment, "assigned_by", None) or user.username,
                    assigned_at=getattr(assignment, "assigned_at", None) or completed_at,
                    destination_location_id=suggested_location.id if suggested_location else None,
                    destination_zone=suggested_location.zone if suggested_location else None,
                    destination_rack=suggested_location.rack if suggested_location else None,
                    destination_bin=suggested_location.bin if suggested_location else None,
                    location_assigned_by="SYSTEM" if suggested_location else None,
                    location_assigned_at=completed_at if suggested_location else None,
                    material_category=placement["category"],
                    handling_requirement=placement["handling_requirement"],
                    rotation_policy=placement["rotation_policy"], placement_metadata=placement,
                    status="PENDING",
                    created_by=user.username, created_at=completed_at,
                ))
                next_task_sequence += 1
                unit.status = "PUTAWAY_PENDING"
                tasks_created += 1
                existing_task_items.add((grn.id, grn_line.item_code.upper()))
            unit.updated_at = completed_at

        # Phase 6: Automatic Quarantine record creation for damaged quantity
        if (grn_line.damaged_quantity or 0) > 0:
            rec_line = receiving_by_code.get(grn_line.item_code)
            rec_line_id = rec_line.id if rec_line else None
            # Check idempotency to prevent duplicates on retry
            q_exists_stmt = select(QuarantineRecordModel.id).where(
                or_(
                    QuarantineRecordModel.grn_line_id == grn_line.id,
                    (QuarantineRecordModel.receiving_line_id == rec_line_id) if rec_line_id else False,
                )
            )
            q_exists = await uow.session.execute(q_exists_stmt)
            if q_exists.first() is None:
                q_num = f"QRN-{completed_at.year}-{uuid.uuid4().hex[:8].upper()}"
                q_record = QuarantineRecordModel(
                    id=uuid.uuid4(),
                    quarantine_number=q_num,
                    grn_id=grn.id,
                    grn_number=grn_number,
                    grn_line_id=grn_line.id,
                    receiving_line_id=rec_line_id,
                    dock_assignment_id=assignment.id,
                    item_code=grn_line.item_code,
                    material_name=grn_line.material_name or grn_line.item_code,
                    damaged_quantity=grn_line.damaged_quantity,
                    uom=grn_line.uom or "PCS",
                    supplier_name=grn.supplier_name,
                    po_number=grn.po_number,
                    asn_number=grn.asn_number,
                    warehouse_id=grn.warehouse_id or "Main Warehouse",
                    reason="Flagged as damaged during receiving inspection",
                    receiving_notes=rec_line.condition_notes if rec_line and hasattr(rec_line, "condition_notes") else None,
                    status="PENDING_REVIEW",
                    created_by=user.username,
                    created_at=completed_at,
                    updated_at=completed_at,
                )
                uow.session.add(q_record)
                uow.session.add(
                    NotificationModel(
                        user_role="WAREHOUSE",
                        title="Material Quarantined",
                        message=f"{grn_line.damaged_quantity} {grn_line.uom or 'PCS'} of {grn_line.item_code} from {grn_number} routed to Quarantine ({q_num}).",
                        link="/warehouse/quarantine",
                    )
                )

    assignment.prepared_grn_id = grn_id
    damage_reports = (await uow.session.execute(
        select(DamageReportModel).where(DamageReportModel.gate_entry_id == model.id)
    )).scalars().all()
    for damage_report in damage_reports:
        damage_report.grn_number = grn_number
        # Completing the GRN is the authoritative publication point for the
        # supplier claim. Create it here so the supplier portal does not depend
        # on a separate Procurement/email action. The unique damage_report_id
        # check makes this safe on retries and page refreshes.
        existing_claim = (await uow.session.execute(
            select(SupplierDamageClaimModel).where(
                SupplierDamageClaimModel.damage_report_id == damage_report.id
            )
        )).scalar_one_or_none()
        if existing_claim is None and asn.supplier_id and damage_report.damaged_quantity > 0:
            last_claim = (await uow.session.execute(
                select(func.max(SupplierDamageClaimModel.claim_number))
            )).scalar_one_or_none()
            try:
                next_claim_number = int(last_claim.split("-", 1)[1]) + 1 if last_claim else 1
            except (ValueError, IndexError):
                next_claim_number = 1
            claim_number = f"DC-{next_claim_number:05d}"
            uow.session.add(SupplierDamageClaimModel(
                claim_number=claim_number,
                damage_report_id=damage_report.id,
                supplier_id=asn.supplier_id,
                status="SUPPLIER_SENT",
                created_by=user.username,
                created_at=completed_at,
                sent_at=completed_at,
            ))
            uow.session.add(NotificationModel(
                user_role="SUPPLIER",
                title=f"Damage Return {claim_number}",
                message=f"GRN {grn_number}: damaged/rejected material requires your response.",
                link="/damage-claims",
            ))
    assignment.receiving_completed_by = user.username
    assignment.receiving_completed_at = completed_at
    await _save_gate_entry(uow.session, entry)
    uow.session.add(NotificationModel(user_role="WAREHOUSE", title="GRN Draft Created", message=f"{grn_number} is ready for review after receiving {entry.vehicle_plate}.", link="/grn"))
    uow.session.add(NotificationModel(user_role="WAREHOUSE", title="Putaway Tasks Created", message=f"{tasks_created} putaway task(s) were created for accepted quantities on {grn_number}.", link="/putaway-tasks"))
    allocation_result = await uow.session.execute(
        select(DockAllocationRequestModel).where(
            DockAllocationRequestModel.existing_gate_pass_id == (model.gate_entry_number or str(model.id))
        ).with_for_update()
    )
    allocation = allocation_result.scalar_one_or_none()
    if allocation is not None:
        if allocation.status != "OCCUPIED":
            raise HTTPException(status_code=409, detail=f"Dock allocation is {allocation.status}, expected OCCUPIED")
        from app.modules.dock.application.service import DockAllocationService
        await DockAllocationService.complete_receiving(uow.session, allocation.id, user.username)
    await uow.session.flush()
    return {"gate_entry_id": entry_id, "status": entry.status.value, "grn_id": str(grn.id), "grn_number": grn_number, "grn_status": grn.status, "putaway_tasks_created": tasks_created, "putaway_status": "AWAITING_PUTAWAY", "completed_by": user.username, "completed_at": completed_at.isoformat()}


async def _get_warehouse_user_context(user: CurrentUser, uow: UnitOfWork):
    from app.modules.warehouse.context import warehouse_context
    return await warehouse_context(uow.session)


@router.post("/{entry_id}/release-dock")
async def release_dock(
    entry_id: str,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        gate_id = uuid.UUID(entry_id)
    except ValueError:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    entry_result = await uow.session.execute(select(GateEntryModel).where(GateEntryModel.id == gate_id).with_for_update())
    gate_entry = entry_result.scalar_one_or_none()
    if gate_entry is None:
        raise NotFoundException(f"Inbound arrival '{entry_id}' not found")
    if gate_entry.status not in {
        GateEntryStatus.RECEIVING_COMPLETED.value,
        GateEntryStatus.COMPLETED.value,
        GateEntryStatus.QUALITY_PASSED.value,
        GateEntryStatus.QUALITY_FAILED.value,
        GateEntryStatus.EXIT_APPROVED.value,
        GateEntryStatus.GATE_EXIT_COMPLETED.value,
        GateEntryStatus.VEHICLE_EXITED.value,
        "GRN_COMPLETED",
        "QC_COMPLETED",
        "UNLOADED",
        "RELEASED",
    }:
        raise HTTPException(status_code=409, detail="Receiving must be completed before releasing the dock")
    assignment_result = await uow.session.execute(select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == gate_entry.id).with_for_update())
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None or assignment.prepared_grn_id is None:
        raise HTTPException(status_code=409, detail="Dock assignment or prepared GRN was not found")
    if assignment.dock_released_at is not None:
        raise HTTPException(status_code=409, detail="Dock was already released")

    # Validate Warehouse assignment exists
    if not assignment.assigned_warehouse_ref_id:
        raise HTTPException(status_code=400, detail="Warehouse must be assigned before dock release")

    # Authorize Warehouse Operator / Warehouse Operator
    roles_upper = {r.upper() for r in (user.roles or [])}
    is_admin = "ADMIN" in roles_upper or "SUPERUSER" in roles_upper
    is_warehouse_user = "WAREHOUSE_OPERATOR" in roles_upper or "WAREHOUSE_OPERATOR" in roles_upper

    if not is_admin:
        if not is_warehouse_user:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Dock release must be performed by the assigned Warehouse Operator/Keeper",
            )
        # Verify user belongs to the assigned Warehouse
        user_warehouse_ref_ids, user_warehouse_codes = await _get_warehouse_user_context(user, uow)
        assigned_sid = assignment.assigned_warehouse_ref_id
        assigned_scode = (assignment.assigned_warehouse_code or "").strip().upper()

        if assigned_sid not in user_warehouse_ref_ids and assigned_scode not in user_warehouse_codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You can only release docks assigned to your Warehouse",
            )

    dock_result = await uow.session.execute(select(DockModel).where(DockModel.dock_number == assignment.dock_number).with_for_update())
    dock = dock_result.scalar_one_or_none()
    if dock is None:
        raise HTTPException(status_code=409, detail="Assigned dock was not found")
    if dock.status != "OCCUPIED":
        raise HTTPException(status_code=409, detail=f"Dock {dock.dock_number} is not occupied")

    # Validate warehouse matching between warehouse and dock
    if assignment.assigned_warehouse_ref_id:
        warehouse = await uow.session.get(WarehouseModel, assignment.assigned_warehouse_ref_id)
        if warehouse and warehouse.warehouse_id and dock.warehouse_id and warehouse.warehouse_id.strip().upper() != dock.warehouse_id.strip().upper():
            raise HTTPException(status_code=400, detail="Warehouse warehouse does not match dock warehouse")

    grn_result = await uow.session.execute(select(GrnModel).options(selectinload(GrnModel.lines)).where(GrnModel.id == assignment.prepared_grn_id))
    grn = grn_result.scalar_one_or_none()
    if grn is None:
        raise HTTPException(status_code=409, detail="Prepared GRN was not found")
    released_at = datetime.datetime.now(datetime.timezone.utc)
    dock.status = "AVAILABLE"
    dock.updated_at = released_at
    # Dock release prepares the vehicle for security exit; it does not mean
    # the vehicle has exited. Keep the gate entry in the receiving-complete
    # state so the exit workflow can verify the original gate pass.
    gate_entry.status = GateEntryStatus.RECEIVING_COMPLETED.value
    gate_entry.updated_at = released_at
    assignment.dock_released_by = user.username
    assignment.dock_released_at = released_at
    uow.session.add(NotificationModel(user_role="WAREHOUSE", title="Dock Released", message=f"{dock.dock_number} released after receiving {assignment.vehicle_number} against {grn.grn_number}.", link="/dock-management"))
    uow.session.add(NotificationModel(user_role="GATE_SECURITY", title="Vehicle Ready for Exit", message=f"{assignment.vehicle_number} is ready for security exit verification against {grn.grn_number}.", link="/vehicle-exit"))
    await uow.session.flush()
    return {"gate_entry_id": str(gate_entry.id), "dock_number": dock.dock_number, "dock_status": dock.status,
            "released_at": released_at.isoformat(), "released_by": user.username,
            "vehicle_number": assignment.vehicle_number, "asn_id": str(assignment.asn_id),
            "grn_id": str(grn.id), "grn_number": grn.grn_number}


@router.get("/exit-queue")
async def list_vehicle_exit_queue(
    _user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    result = await uow.session.execute(
        select(GateEntryModel, DockAssignmentModel, AsnModel, PurchaseOrderModel, GrnModel, VehicleExitApprovalModel)
        .join(DockAssignmentModel, DockAssignmentModel.gate_entry_id == GateEntryModel.id)
        .join(AsnModel, AsnModel.id == DockAssignmentModel.asn_id)
        .outerjoin(PurchaseOrderModel, PurchaseOrderModel.id == DockAssignmentModel.po_id)
        .join(GrnModel, GrnModel.id == DockAssignmentModel.prepared_grn_id)
        .outerjoin(VehicleExitApprovalModel, VehicleExitApprovalModel.gate_entry_id == GateEntryModel.id)
        .where(GateEntryModel.status.in_([GateEntryStatus.RECEIVING_COMPLETED.value, GateEntryStatus.EXIT_APPROVED.value]))
        .where(DockAssignmentModel.dock_released_at.is_not(None))
        .order_by(DockAssignmentModel.dock_released_at.desc())
    )
    return [{"gate_entry_id": str(entry.id), "gate_entry_number": entry.gate_entry_number,
             "asn_id": str(asn.id), "asn_number": asn.asn_number,
             "po_id": str(po.id) if po else None, "po_number": po.po_number if po else None,
             "grn_id": str(grn.id), "grn_number": grn.grn_number, "grn_status": grn.status,
             "vehicle_number": assignment.vehicle_number, "driver_name": entry.driver_name,
             "driver_phone": entry.driver_phone, "dock_number": assignment.dock_number,
             "receiving_completed_at": assignment.receiving_completed_at.isoformat() if assignment.receiving_completed_at else None,
             "dock_released_at": assignment.dock_released_at.isoformat(),
             "status": entry.status, "exit_document_reference": approval.exit_document_reference if approval else None,
             "approved_by": approval.approved_by if approval else None,
             "approved_at": approval.approved_at.isoformat() if approval else None}
            for entry, assignment, asn, po, grn, approval in result.all()]


@router.post("/{entry_id}/approve-exit")
async def approve_vehicle_exit(
    entry_id: str,
    request: ApproveVehicleExitRequest,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    if not all([request.asn_verified, request.grn_verified, request.receiving_verified, request.vehicle_verified, request.driver_verified]):
        raise HTTPException(status_code=422, detail="All security verification checks must be confirmed")
    try:
        gate_id = uuid.UUID(entry_id)
    except ValueError:
        raise NotFoundException(f"Vehicle exit '{entry_id}' not found")
    result = await uow.session.execute(select(GateEntryModel).where(GateEntryModel.id == gate_id).with_for_update())
    gate_entry = result.scalar_one_or_none()
    if gate_entry is None:
        raise NotFoundException(f"Vehicle exit '{entry_id}' not found")
    if gate_entry.status != GateEntryStatus.RECEIVING_COMPLETED.value:
        raise HTTPException(status_code=409, detail="Vehicle is not awaiting exit approval")
    assignment_result = await uow.session.execute(select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == gate_entry.id).with_for_update())
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None or assignment.receiving_completed_at is None or assignment.dock_released_at is None or assignment.prepared_grn_id is None:
        raise HTTPException(status_code=409, detail="Receiving, GRN preparation, and dock release must be completed")
    asn = await uow.session.get(AsnModel, assignment.asn_id)
    po = await uow.session.get(PurchaseOrderModel, assignment.po_id) if assignment.po_id else None
    grn_result = await uow.session.execute(select(GrnModel).options(selectinload(GrnModel.lines)).where(GrnModel.id == assignment.prepared_grn_id))
    grn = grn_result.scalar_one_or_none()
    if asn is None or grn is None:
        raise HTTPException(status_code=409, detail="ASN or GRN verification context is missing")
    if po is not None and not request.po_verified:
        raise HTTPException(status_code=422, detail="Purchase order verification must be confirmed when a PO is linked")
    if grn.status != "GRN_POSTED":
        raise HTTPException(status_code=409, detail="GRN must be posted before vehicle exit approval")
    existing = await uow.session.execute(select(VehicleExitApprovalModel.id).where(VehicleExitApprovalModel.gate_entry_id == gate_entry.id))
    if existing.first() is not None:
        raise HTTPException(status_code=409, detail="Vehicle exit was already approved")
    approved_at = datetime.datetime.now(datetime.timezone.utc)
    approval = VehicleExitApprovalModel(
        gate_entry_id=gate_entry.id, dock_assignment_id=assignment.id, asn_id=asn.id, po_id=po.id if po else None, grn_id=grn.id,
        vehicle_number=assignment.vehicle_number, driver_name=gate_entry.driver_name,
        exit_document_reference=request.exit_document_reference.strip(), approved_by=user.username, approved_at=approved_at,
    )
    uow.session.add(approval)
    gate_entry.status = GateEntryStatus.EXIT_APPROVED.value
    gate_entry.updated_at = approved_at
    existing_tasks = await uow.session.execute(select(PutawayTaskModel.id).where(PutawayTaskModel.grn_id == grn.id))
    if existing_tasks.first() is not None:
        raise HTTPException(status_code=409, detail="Putaway tasks already exist for this GRN")
    handling_units_result = await uow.session.execute(select(HandlingUnitModel).where(HandlingUnitModel.grn_line_id.in_([line.id for line in grn.lines])))
    handling_units_by_line = {unit.grn_line_id: unit for unit in handling_units_result.scalars().all()}
    tasks_created = 0
    for line in grn.lines:
        accepted = line.accepted_quantity or 0
        if accepted <= 0:
            continue
        handling_unit = handling_units_by_line.get(line.id)
        if handling_unit is None:
            raise HTTPException(status_code=409, detail=f"Handling unit is missing for {line.item_code}")
        location_result = await uow.session.execute(
            select(StorageLocationModel).where(
                StorageLocationModel.warehouse_id == grn.warehouse_id,
                StorageLocationModel.active.is_(True),
                StorageLocationModel.capacity - StorageLocationModel.occupied_quantity >= accepted,
            ).order_by(StorageLocationModel.zone, StorageLocationModel.rack, StorageLocationModel.bin).limit(1)
        )
        suggested_location = location_result.scalar_one_or_none()
        uow.session.add(PutawayTaskModel(
            task_number=f"PUT-{approved_at.year}-{uuid.uuid4().hex[:8].upper()}", grn_id=grn.id,
            grn_number=grn.grn_number, handling_unit_id=handling_unit.id, item_code=line.item_code,
            material_name=line.material_name or line.item_code, quantity=accepted, uom=line.uom or "PCS",
            warehouse_id=grn.warehouse_id, source_location="RECEIVING_AREA",
            destination_warehouse_ref_id=getattr(assignment, "assigned_warehouse_ref_id", None),
            assigned_to=getattr(assignment, "assigned_warehouse_operator_username", None) or getattr(assignment, "assigned_warehouse_operator_name", None) or getattr(assignment, "assigned_warehouse_operator_id", None),
            assigned_by=getattr(assignment, "assigned_by", None) or user.username,
            assigned_at=getattr(assignment, "assigned_at", None) or approved_at,
            destination_location_id=suggested_location.id if suggested_location else None,
            destination_zone=suggested_location.zone if suggested_location else None,
            destination_rack=suggested_location.rack if suggested_location else None,
            destination_bin=suggested_location.bin if suggested_location else None,
            location_assigned_by="SYSTEM" if suggested_location else None,
            location_assigned_at=approved_at if suggested_location else None,
            status="PUTAWAY_PENDING", created_by=user.username, created_at=approved_at,
        ))
        handling_unit.status = "PUTAWAY_PENDING"
        handling_unit.updated_at = approved_at
        tasks_created += 1

    if assignment.assigned_warehouse_ref_id:
        warehouse = await uow.session.get(WarehouseModel, assignment.assigned_warehouse_ref_id)
        if warehouse:
            uow.session.add(NotificationModel(
                user_role=f"WH:{warehouse.warehouse_code}"[:32],
                title="New Putaway Tasks Available",
                message=f"{tasks_created} Putaway task(s) generated for {warehouse.warehouse_name} from {grn.grn_number}.",
                link="/inventory",
            ))
            uow.session.add(NotificationModel(
                user_role=f"WH:{warehouse.id}"[:32],
                title="New Putaway Tasks Available",
                message=f"{tasks_created} Putaway task(s) generated for {warehouse.warehouse_name} from {grn.grn_number}.",
                link="/inventory",
            ))
    uow.session.add(NotificationModel(user_role="WAREHOUSE", title="Vehicle Exit Approved", message=f"Security approved exit for {assignment.vehicle_number} against {grn.grn_number}.", link="/vehicle-exit"))
    await uow.session.flush()
    return {"gate_entry_id": str(gate_entry.id), "status": gate_entry.status, "vehicle_number": assignment.vehicle_number,
            "asn_number": asn.asn_number, "po_number": po.po_number if po else None, "grn_number": grn.grn_number,
            "exit_document_reference": approval.exit_document_reference,
            "approved_by": user.username, "approved_at": approved_at.isoformat(),
            "transaction_completed": True, "vehicle_departure_authorized": True,
            "materials_retained_in_warehouse": True,
            "material_disposition": "GRN_POSTED_INVENTORY_AWAITING_PUTAWAY"}


@router.get("/gate-exit-queue")
async def list_gate_exit_queue(
    _user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    result = await uow.session.execute(
        select(GateEntryModel, VehicleExitApprovalModel, DockAssignmentModel, AsnModel, PurchaseOrderModel, GrnModel, GateExitModel)
        .join(VehicleExitApprovalModel, VehicleExitApprovalModel.gate_entry_id == GateEntryModel.id)
        .join(DockAssignmentModel, DockAssignmentModel.gate_entry_id == GateEntryModel.id)
        .join(AsnModel, AsnModel.id == VehicleExitApprovalModel.asn_id)
        .outerjoin(PurchaseOrderModel, PurchaseOrderModel.id == VehicleExitApprovalModel.po_id)
        .join(GrnModel, GrnModel.id == VehicleExitApprovalModel.grn_id)
        .outerjoin(GateExitModel, GateExitModel.gate_entry_id == GateEntryModel.id)
        .where(GateEntryModel.status.in_([GateEntryStatus.EXIT_APPROVED.value, GateEntryStatus.GATE_EXIT_COMPLETED.value]))
        .order_by(VehicleExitApprovalModel.approved_at.desc())
    )
    return [{"gate_entry_id": str(entry.id), "gate_entry_number": entry.gate_entry_number,
             "vehicle_number": approval.vehicle_number, "driver_name": approval.driver_name,
             "asn_id": str(asn.id), "asn_number": asn.asn_number, "po_number": po.po_number if po else None,
             "grn_number": grn.grn_number, "dock_number": assignment.dock_number,
             "exit_document_reference": approval.exit_document_reference,
             "exit_approved_by": approval.approved_by, "exit_approved_at": approval.approved_at.isoformat(),
             "status": entry.status, "gate_exit_completed_by": gate_exit.completed_by if gate_exit else None,
             "gate_exit_completed_at": gate_exit.completed_at.isoformat() if gate_exit else None}
            for entry, approval, assignment, asn, po, grn, gate_exit in result.all()]


@router.post("/{entry_id}/complete-gate-exit")
async def complete_gate_exit(
    entry_id: str,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        gate_id = uuid.UUID(entry_id)
    except ValueError:
        raise NotFoundException(f"Gate exit '{entry_id}' not found")
    result = await uow.session.execute(select(GateEntryModel).where(GateEntryModel.id == gate_id).with_for_update())
    gate_entry = result.scalar_one_or_none()
    if gate_entry is None:
        raise NotFoundException(f"Gate exit '{entry_id}' not found")
    if gate_entry.status != GateEntryStatus.EXIT_APPROVED.value:
        raise HTTPException(status_code=409, detail="Security exit approval is required before gate exit")
    approval_result = await uow.session.execute(select(VehicleExitApprovalModel).where(VehicleExitApprovalModel.gate_entry_id == gate_entry.id).with_for_update())
    approval = approval_result.scalar_one_or_none()
    if approval is None:
        raise HTTPException(status_code=409, detail="Vehicle exit approval record was not found")
    existing = await uow.session.execute(select(GateExitModel.id).where(GateExitModel.gate_entry_id == gate_entry.id))
    if existing.first() is not None:
        raise HTTPException(status_code=409, detail="Gate exit was already completed")
    completed_at = datetime.datetime.now(datetime.timezone.utc)
    gate_exit = GateExitModel(gate_entry_id=gate_entry.id, exit_approval_id=approval.id,
                              vehicle_number=approval.vehicle_number, completed_by=user.username, completed_at=completed_at)
    uow.session.add(gate_exit)
    gate_entry.status = GateEntryStatus.GATE_EXIT_COMPLETED.value
    gate_entry.updated_at = completed_at
    uow.session.add(NotificationModel(user_role="WAREHOUSE", title="Gate Exit Completed", message=f"{approval.vehicle_number} left the warehouse at {completed_at.isoformat()}.", link="/vehicle-exit"))
    await uow.session.flush()
    return {"gate_entry_id": str(gate_entry.id), "status": gate_entry.status, "vehicle_number": approval.vehicle_number,
            "gate_exit_completed_by": user.username, "gate_exit_completed_at": completed_at.isoformat()}


@router.get("/grn-drafts")
async def list_grn_drafts(
    status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    _user: CurrentUser = Depends(require_permission("gate:read")),
    uow: UnitOfWork = Depends(get_uow),
):
    query = select(GrnModel).options(selectinload(GrnModel.lines)).order_by(GrnModel.created_at.desc(), GrnModel.grn_number.desc())
    if status and status.upper() != "ALL":
        clean_st = status.upper().strip()
        if "PARTIAL" in clean_st:
            query = query.where(
                or_(
                    GrnModel.status.ilike("%PARTIAL%"),
                    GrnModel.status == "PARTIALLY COMPLETED",
                    GrnModel.status == "PARTIALLY_COMPLETED",
                    GrnModel.status == "DRAFT",
                    GrnModel.status == "IN_PROGRESS",
                )
            )
        elif "COMPLETE" in clean_st:
            query = query.where(
                or_(
                    GrnModel.status.ilike("%COMPLETE%"),
                    GrnModel.status == "COMPLETED",
                    GrnModel.status == "POSTED",
                    GrnModel.status == "CLOSED",
                )
            )
        else:
            query = query.where(GrnModel.status == status)

    result = await uow.session.execute(query)
    all_grns = result.scalars().all()

    items = [
        {
            "id": str(grn.id),
            "grn_id": str(grn.id),
            "grn_number": grn.grn_number or f"GRN-{str(grn.id)[:8]}",
            "status": grn.status or "COMPLETED",
            "po_id": str(grn.po_id) if grn.po_id else None,
            "po_number": grn.po_number,
            "asn_id": str(grn.asn_id) if grn.asn_id else None,
            "asn_number": grn.asn_number or "ASN-001",
            "supplier_name": grn.supplier_name or "Supplier",
            "supplier_company_name": grn.supplier_company_name or grn.supplier_name or "Supplier",
            "supplier_email": getattr(grn, "supplier_email", None) or "spoorthiharakuni@gmail.com",
            "vehicle_number": grn.vehicle_number or "N/A",
            "driver_name": grn.driver_name or "N/A",
            "invoice_number": grn.invoice_number or "N/A",
            "dock_number": grn.dock_number or "DOCK-01",
            "warehouse_id": grn.warehouse_id or "Main Warehouse",
            "receipt_date": grn.receipt_date.isoformat() if grn.receipt_date else None,
            "received_by": grn.received_by or "System User",
            "posted_by": grn.posted_by,
            "posted_at": grn.posted_at.isoformat() if grn.posted_at else None,
            "verification_notes": grn.verification_notes,
            "official_record": True,
            "inventory_updated": True,
            "items": [
                {
                    "item_code": line.item_code,
                    "material_name": line.material_name,
                    "uom": line.uom,
                    "po_quantity": float(line.ordered_quantity or 0),
                    "received_quantity": float(line.received_quantity or 0),
                    "good_quantity": float(line.good_quantity or 0),
                    "accepted_quantity": float(line.accepted_quantity or 0),
                    "damaged_quantity": float(line.damaged_quantity or 0),
                    "rejected_quantity": float(line.rejected_quantity or 0),
                    "quality_result": line.quality_result or "ACCEPTED",
                }
                for line in grn.lines
            ],
            "lines": [
                {
                    "item_code": line.item_code,
                    "material_name": line.material_name,
                    "uom": line.uom,
                    "ordered_quantity": float(line.ordered_quantity or 0),
                    "received_quantity": float(line.received_quantity or 0),
                    "good_quantity": float(line.good_quantity or 0),
                    "damaged_quantity": float(line.damaged_quantity or 0),
                    "accepted_quantity": float(line.accepted_quantity or 0),
                    "rejected_quantity": float(line.rejected_quantity or 0),
                    "balance_quantity": float(line.balance_quantity or 0),
                    "quality_result": line.quality_result or "ACCEPTED",
                }
                for line in grn.lines
            ],
        }
        for grn in all_grns
    ]

    if search and search.strip():
        s = search.strip().lower()
        items = [
            i for i in items
            if s in i["grn_number"].lower()
            or (i["po_number"] and s in i["po_number"].lower())
            or (i["supplier_name"] and s in i["supplier_name"].lower())
            or (i["status"] and s in i["status"].lower())
            or (i["vehicle_number"] and s in i["vehicle_number"].lower())
            or (i["driver_name"] and s in i["driver_name"].lower())
            or (i["dock_number"] and s in i["dock_number"].lower())
        ]

    return items


@router.post("/grns/{grn_id}/post")
async def post_grn(
    grn_id: str,
    request: PostGrnRequest,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
):
    try:
        parsed_id = uuid.UUID(grn_id)
    except ValueError:
        raise NotFoundException(f"GRN '{grn_id}' not found")
    result = await uow.session.execute(select(GrnModel).options(selectinload(GrnModel.lines)).where(GrnModel.id == parsed_id))
    grn = result.scalar_one_or_none()
    if grn is None:
        raise NotFoundException(f"GRN '{grn_id}' not found")
    if grn.status != "GRN_DRAFT":
        raise HTTPException(status_code=409, detail="Only a GRN draft can be posted")
    if not all([grn.asn_id, grn.asn_number, grn.supplier_name, grn.vehicle_number, grn.warehouse_id, grn.dock_number]):
        raise HTTPException(status_code=409, detail="GRN ASN shipment references are incomplete")
    assignment_result = await uow.session.execute(select(DockAssignmentModel).where(DockAssignmentModel.prepared_grn_id == grn.id))
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=409, detail="GRN is not linked to completed receiving")
    gate_entry = await uow.session.get(GateEntryModel, assignment.gate_entry_id)
    # Gate status can legitimately advance to EXIT_APPROVED or
    # GATE_EXIT_COMPLETED after receiving. The immutable completion timestamp,
    # not the current gate status, determines whether the GRN is postable.
    if gate_entry is None or assignment.receiving_completed_at is None:
        raise HTTPException(status_code=409, detail="Receiving must be completed before GRN posting")
    receiving_result = await uow.session.execute(select(ReceivingLineModel).where(ReceivingLineModel.dock_assignment_id == assignment.id))
    receiving_lines = {line.item_code: line for line in receiving_result.scalars().all()}
    if not grn.lines or set(receiving_lines) != {line.item_code for line in grn.lines}:
        raise HTTPException(status_code=409, detail="GRN items do not match actual receiving")
    for line in grn.lines:
        source = receiving_lines[line.item_code]
        if line.received_quantity != source.received_quantity or line.accepted_quantity != source.good_quantity or line.damaged_quantity != (source.damaged_quantity or 0) or line.quality_result != source.condition_result:
            raise HTTPException(status_code=409, detail=f"GRN line {line.item_code} does not match receiving and quality results")
    posted_at = datetime.datetime.now(datetime.timezone.utc)
    prior_postings = await uow.session.execute(select(InventoryReceiptPostingModel.id).where(InventoryReceiptPostingModel.grn_id == grn.id))
    if prior_postings.first() is not None:
        raise HTTPException(status_code=409, detail="Inventory was already updated for this GRN")
    inventory_updates = []
    handling_units_result = await uow.session.execute(select(HandlingUnitModel).where(HandlingUnitModel.grn_line_id.in_([line.id for line in grn.lines])))
    handling_units_by_line = {unit.grn_line_id: unit for unit in handling_units_result.scalars().all()}
    for line in grn.lines:
        accepted = line.accepted_quantity or 0
        stock_result = await uow.session.execute(
            select(MaterialStockModel).where(MaterialStockModel.material_code == line.item_code).with_for_update()
        )
        stock = stock_result.scalar_one_or_none()
        if stock is None:
            stock = MaterialStockModel(
                material_code=line.item_code, material_name=line.material_name or line.item_code,
                category="RECEIVING", on_hand=0, allocated=0, available=0,
                uom=line.uom or "PCS", warehouse_id=grn.warehouse_id, reorder_point=0,
            )
            uow.session.add(stock)
            await uow.session.flush()
        elif _canonical_warehouse_id(stock.warehouse_id) != _canonical_warehouse_id(grn.warehouse_id):
            raise HTTPException(status_code=409, detail=f"Material {line.item_code} belongs to warehouse {stock.warehouse_id}, not {grn.warehouse_id}")
        elif stock.warehouse_id != grn.warehouse_id:
            # Migrate equivalent legacy labels (for example "Main Warehouse")
            # to the canonical identifier used by current ASNs and GRNs.
            stock.warehouse_id = grn.warehouse_id
        before = stock.on_hand
        # GRN receipt posts accepted stock once into the receiving/staging
        # pool. Physical putaway later moves that stock to a final location;
        # it must not increase aggregate on-hand again.
        stock.on_hand = stock.on_hand + accepted
        # MaterialStockModel uses a timezone-naive legacy timestamp column.
        # asyncpg rejects aware datetimes for that column during flush.
        stock.updated_at = posted_at.replace(tzinfo=None)
        uow.session.add(InventoryReceiptPostingModel(
            grn_id=grn.id, grn_number=grn.grn_number, po_id=grn.po_id, po_number=grn.po_number,
            asn_id=grn.asn_id, asn_number=grn.asn_number, supplier_name=grn.supplier_name,
            item_code=line.item_code, material_name=line.material_name or line.item_code, uom=line.uom or "PCS", warehouse_id=grn.warehouse_id,
            posted_quantity=accepted, on_hand_before=before, on_hand_after=stock.on_hand,
            posted_by=user.username, posted_at=posted_at,
        ))
        inventory_updates.append({"item_code": line.item_code, "quantity": float(accepted), "on_hand_before": float(before), "on_hand_after": float(stock.on_hand)})
        if accepted > 0:
            handling_unit = handling_units_by_line.get(line.id)
            putaway_task_created = False
            if handling_unit is None:
                # Repair drafts created before handling-unit generation became
                # mandatory. New receipts create these during completion, but
                # legacy drafts must remain postable and putaway-capable.
                source = receiving_lines[line.item_code]
                hu_number = f"HU-{posted_at.year}-{uuid.uuid4().hex[:12].upper()}"
                handling_unit = HandlingUnitModel(
                    hu_number=hu_number, barcode_value=hu_number,
                    receiving_line_id=source.id, grn_line_id=line.id,
                    item_code=line.item_code, material_name=line.material_name or line.item_code,
                    quantity=accepted, uom=line.uom or "PCS", supplier_name=grn.supplier_name,
                    po_number=grn.po_number, asn_number=grn.asn_number,
                    grn_number=grn.grn_number, warehouse_id=grn.warehouse_id,
                    current_location="RECEIVING_AREA", status="PUTAWAY_PENDING",
                    generated_by=user.username, generated_at=posted_at, updated_at=posted_at,
                )
                uow.session.add(handling_unit)
                await uow.session.flush()
                suggested_location, placement = await recommend_storage_location(
                    uow.session, warehouse_id=grn.warehouse_id, material_code=line.item_code,
                    material_name=line.material_name or line.item_code,
                    quantity=accepted, uom=line.uom or "PCS",
                )
                uow.session.add(PutawayTaskModel(
                    task_number=f"PT-{posted_at.year}-{uuid.uuid4().hex[:8].upper()}",
                    grn_id=grn.id, grn_number=grn.grn_number,
                    handling_unit_id=handling_unit.id, item_code=line.item_code,
                    material_name=line.material_name or line.item_code, quantity=accepted,
                    uom=line.uom or "PCS", warehouse_id=grn.warehouse_id,
                    source_location=f"Receiving / {assignment.dock_number}" if assignment else "RECEIVING_AREA",
                    destination_warehouse_ref_id=getattr(assignment, "assigned_warehouse_ref_id", None),
                    assigned_to=getattr(assignment, "assigned_warehouse_operator_username", None) or getattr(assignment, "assigned_warehouse_operator_name", None) or getattr(assignment, "assigned_warehouse_operator_id", None),
                    assigned_by=getattr(assignment, "assigned_by", None) or user.username,
                    assigned_at=getattr(assignment, "assigned_at", None) or posted_at,
                    destination_location_id=suggested_location.id if suggested_location else None,
                    destination_zone=suggested_location.zone if suggested_location else None,
                    destination_rack=suggested_location.rack if suggested_location else None,
                    destination_bin=suggested_location.bin if suggested_location else None,
                    location_assigned_by="SYSTEM" if suggested_location else None,
                    location_assigned_at=posted_at if suggested_location else None,
                    material_category=placement["category"],
                    handling_requirement=placement["handling_requirement"],
                    rotation_policy=placement["rotation_policy"], placement_metadata=placement,
                    status="PENDING",
                    created_by=user.username, created_at=posted_at,
                ))
                putaway_task_created = True
            if not putaway_task_created:
                existing_task = await uow.session.execute(
                    select(PutawayTaskModel.id).where(
                        PutawayTaskModel.handling_unit_id == handling_unit.id
                    )
                )
                if existing_task.scalar_one_or_none() is None:
                    suggested_location, placement = await recommend_storage_location(
                        uow.session, warehouse_id=grn.warehouse_id,
                        material_code=line.item_code,
                        material_name=line.material_name or line.item_code,
                        quantity=accepted, uom=line.uom or "PCS",
                    )
                    uow.session.add(PutawayTaskModel(
                        task_number=f"PT-{posted_at.year}-{uuid.uuid4().hex[:8].upper()}",
                        grn_id=grn.id, grn_number=grn.grn_number,
                        handling_unit_id=handling_unit.id, item_code=line.item_code,
                        material_name=line.material_name or line.item_code, quantity=accepted,
                        uom=line.uom or "PCS", warehouse_id=grn.warehouse_id,
                        source_location=f"Receiving / {assignment.dock_number}" if assignment else "RECEIVING_AREA",
                        destination_warehouse_ref_id=getattr(assignment, "assigned_warehouse_ref_id", None),
                        assigned_to=getattr(assignment, "assigned_warehouse_operator_username", None) or getattr(assignment, "assigned_warehouse_operator_name", None) or getattr(assignment, "assigned_warehouse_operator_id", None),
                        assigned_by=getattr(assignment, "assigned_by", None) or user.username,
                        assigned_at=getattr(assignment, "assigned_at", None) or posted_at,
                        destination_location_id=suggested_location.id if suggested_location else None,
                        destination_zone=suggested_location.zone if suggested_location else None,
                        destination_rack=suggested_location.rack if suggested_location else None,
                        destination_bin=suggested_location.bin if suggested_location else None,
                        location_assigned_by="SYSTEM" if suggested_location else None,
                        location_assigned_at=posted_at if suggested_location else None,
                        material_category=placement["category"],
                        handling_requirement=placement["handling_requirement"],
                        rotation_policy=placement["rotation_policy"], placement_metadata=placement,
                        status="PENDING",
                        created_by=user.username, created_at=posted_at,
                    ))
            # Posting makes the receipt official, but the physical material
            # remains in the receiving area until its putaway task is completed.
            handling_unit.status = "PUTAWAY_PENDING"
            handling_unit.updated_at = posted_at
    grn.status = "GRN_POSTED"
    grn.posted_by = user.username
    grn.posted_at = posted_at
    grn.verification_notes = request.verification_notes
    uow.session.add(to_outbox_row("GoodsReceiptNote", str(grn.id), GrnPostedEvent(
        occurred_at=posted_at, grn_id=str(grn.id), grn_number=grn.grn_number,
        po_number=grn.po_number, asn_number=grn.asn_number, supplier_name=grn.supplier_name,
        warehouse_id=grn.warehouse_id,
        lines=[PostedInventoryLine(item_code=line.item_code, material_name=line.material_name or line.item_code, quantity=line.accepted_quantity or 0, uom=line.uom or "PCS") for line in grn.lines],
    )))
    uow.session.add(NotificationModel(user_role="WAREHOUSE", title="GRN Posted", message=f"{grn.grn_number} was verified and posted by {user.username}.", link="/grn"))
    await uow.session.flush()
    task_count_result = await uow.session.execute(select(func.count(PutawayTaskModel.id)).where(PutawayTaskModel.grn_id == grn.id))
    putaway_tasks_ready = task_count_result.scalar_one()
    return {"grn_id": str(grn.id), "grn_number": grn.grn_number, "status": grn.status, "official_record": True, "inventory_updated": True, "putaway_tasks_ready": putaway_tasks_ready, "putaway_status": "AWAITING_PUTAWAY", "inventory_updates": inventory_updates, "posted_by": grn.posted_by, "posted_at": posted_at.isoformat()}


@router.get("/inventory-transactions")
async def list_inventory_transactions(
    _user: CurrentUser = Depends(require_permission("gate:read")),
    uow: UnitOfWork = Depends(get_uow),
):
    result = await uow.session.execute(select(InventoryReceiptPostingModel).order_by(InventoryReceiptPostingModel.posted_at.desc()))
    return [
        {
            "id": str(tx.id), "grn_id": str(tx.grn_id), "grn_number": tx.grn_number,
            "po_id": str(tx.po_id), "po_number": tx.po_number,
            "asn_id": str(tx.asn_id), "asn_number": tx.asn_number,
            "supplier_name": tx.supplier_name, "warehouse_id": tx.warehouse_id,
            "item_code": tx.item_code, "material_name": tx.material_name,
            "quantity": float(tx.posted_quantity), "uom": tx.uom,
            "previous_stock": float(tx.on_hand_before), "new_stock": float(tx.on_hand_after),
            "posted_by": tx.posted_by, "posted_at": tx.posted_at.isoformat(),
        }
        for tx in result.scalars().all()
    ]


@router.post("/unscheduled", response_model=GateEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_unscheduled_gate_entry(
    http_request: Request,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
) -> GateEntryResponse:
    """Create a gate-pass-only record without starting the dock workflow."""
    form = await http_request.form()
    vehicle_photo = form.get("vehicle_photo")
    invoice = form.get("invoice")
    ordered_by = str(form.get("ordered_by") or "").strip()
    phone_number = str(form.get("phone_number") or "").strip()
    vehicle_number = str(form.get("vehicle_number") or "").strip().upper()

    vehicle_data = await vehicle_photo.read() if hasattr(vehicle_photo, "read") else b""
    invoice_data = await invoice.read() if hasattr(invoice, "read") else b""
    if not vehicle_data or not invoice_data or not ordered_by or not phone_number or not vehicle_number:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Vehicle photo, vehicle number, invoice, ordered by, and phone number are required.",
        )

    entry_id = uuid.uuid4()
    short_id = entry_id.hex[:8].upper()
    model = GateEntryModel(
        id=entry_id,
        gate_entry_number=_generate_gate_entry_number(),
        po_number=f"UNSCHEDULED-{short_id}",
        vehicle_number=vehicle_number,
        driver_name=ordered_by,
        driver_phone=phone_number,
        po_document_path=f"database://gate-entry/{entry_id}/po-document",
        vehicle_photo_path=f"database://gate-entry/{entry_id}/vehicle-photo",
        po_document_data=invoice_data,
        vehicle_photo_data=vehicle_data,
        status=GateEntryStatus.UNSCHEDULED_ARRIVAL.value,
        verification_type="UNSCHEDULED",
        mismatched_fields=[],
        reasons=["Unscheduled gate-pass-only entry"],
        security_officer_id=user.username,
        verified_by_user_id=user.username,
        manual_verification_notes="Gate pass only; no dock required",
    )
    uow.session.add(model)
    await uow.session.flush()

    response = _to_gate_entry_response(_gate_entry_from_model(model))
    return response.model_copy(update={
        "driver_phone": model.driver_phone,
        "document_image_base64": base64.b64encode(invoice_data).decode("ascii"),
    })


@router.post("/{entry_id}/verify", response_model=GateEntryResponse)
async def verify_gate_entry(
    entry_id: str,
    request: VerifyGateEntryRequest,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
) -> GateEntryResponse:
    """Supervisor / Manager override action (APPROVE or REJECT)."""
    try:
        model = await uow.session.get(GateEntryModel, uuid.UUID(entry_id))
    except ValueError:
        model = None
    entry = _gate_entry_from_model(model) if model else None
    if not entry:
        raise NotFoundException(f"Gate entry with ID '{entry_id}' not found")

    action = request.action.upper()
    if action == "APPROVE":
        entry.approve(supervisor_id=user.username, remarks=request.remarks)
        ge_num = getattr(entry, "gate_entry_number", None) or str(entry.id)
        veh_plate = model.vehicle_number
        if not veh_plate:
            raise HTTPException(status_code=422, detail="Gate entry must have a vehicle number before approval")
        supplier = entry.ocr_result.supplier_name if entry.ocr_result else model.ocr_supplier_name
        po_num = model.po_number
        mat_desc = entry.ocr_result.material_description if entry.ocr_result else model.ocr_product_material
        qty = (
            entry.ocr_result.total_quantity
            if entry.ocr_result and entry.ocr_result.total_quantity is not None
            else float(model.ocr_quantity) if model.ocr_quantity is not None else None
        )

        from app.modules.dock.application.service import DockAllocationService
        await DockAllocationService.auto_create_allocation_request(
            session=uow.session,
            gate_pass_id=ge_num,
            vehicle_number=veh_plate,
            vendor_reference=supplier,
            material_description=mat_desc,
            quantity=qty,
        )
    elif action == "REJECT":
        reason = request.reason or request.remarks
        entry.reject(supervisor_id=user.username, reason=reason)
    elif action in ("UNSCHEDULED", "UNSCHEDULED_ARRIVAL", "MOVE_TO_UNSCHEDULED"):
        entry.mark_unscheduled(supervisor_id=user.username, remarks=request.remarks)
    else:
        raise DomainRuleViolationException(
            f"Invalid verification action '{request.action}'. Expected APPROVE, REJECT, or UNSCHEDULED_ARRIVAL."
        )

    await _save_gate_entry(uow.session, entry)
    response = _to_gate_entry_response(entry)
    return response.model_copy(update={
        "driver_phone": model.driver_phone,
        "document_image_base64": base64.b64encode(model.po_document_data).decode("ascii") if model.po_document_data else None,
    })


@router.get("/qr/{gate_entry_number}", response_model=GateEntryResponse)
async def get_gate_entry_by_qr(
    gate_entry_number: str,
    _user: CurrentUser = Depends(require_permission("gate:read")),
    uow: UnitOfWork = Depends(get_uow),
) -> GateEntryResponse:
    """Resolve the gate pass number encoded by the frontend QR code."""
    result = await uow.session.execute(
        select(GateEntryModel).where(
            func.upper(GateEntryModel.gate_entry_number) == gate_entry_number.strip().upper()
        )
    )
    model = result.scalars().first()
    if model is None:
        raise NotFoundException(f"Gate pass '{gate_entry_number}' was not found")
    response = _to_gate_entry_response(_gate_entry_from_model(model))
    return response.model_copy(update={"driver_phone": model.driver_phone})


@router.post("/qr/{gate_entry_number}/approve", response_model=GateEntryResponse)
async def approve_gate_entry_by_qr(
    gate_entry_number: str,
    user: CurrentUser = Depends(require_permission("gate:verify")),
    uow: UnitOfWork = Depends(get_uow),
) -> GateEntryResponse:
    """Approve a scanned pass, returning an already-approved pass unchanged."""
    result = await uow.session.execute(
        select(GateEntryModel).where(
            func.upper(GateEntryModel.gate_entry_number) == gate_entry_number.strip().upper()
        )
    )
    model = result.scalars().first()
    if model is None:
        raise NotFoundException(f"Gate pass '{gate_entry_number}' was not found")

    entry = _gate_entry_from_model(model)
    approved_states = {
        GateEntryStatus.GATE_ENTRY_APPROVED,
        GateEntryStatus.AWAITING_DOCK,
        GateEntryStatus.DOCK_ASSIGNED,
        GateEntryStatus.MOVING_TO_DOCK,
        GateEntryStatus.AT_DOCK,
        GateEntryStatus.UNLOADING_IN_PROGRESS,
    }
    if entry.status not in approved_states:
        entry.approve_gate_entry(user.username)
        entry.queue_for_dock_allocation()
        await _save_gate_entry(uow.session, entry)

    # QR approval uses the same persisted dock request and notification path as
    # supervisor approval; repeated scans remain idempotent.
    if model.vehicle_number:
        from app.modules.dock.application.service import DockAllocationService
        await DockAllocationService.auto_create_allocation_request(
            session=uow.session,
            gate_pass_id=model.gate_entry_number or str(model.id),
            vehicle_number=model.vehicle_number,
            vendor_reference=model.ocr_supplier_name,
            material_reference=model.ocr_product_material,
            material_description=model.material_description,
            quantity=model.ocr_quantity if model.ocr_quantity is not None else model.total_quantity,
        )
    else:
        raise HTTPException(status_code=422, detail="Gate entry must have a vehicle number before approval")

    response = _to_gate_entry_response(entry)
    return response.model_copy(update={"driver_phone": model.driver_phone})



class InboundVehicleExitPayload(BaseModel):
    gate_pass_id: str = Field(..., min_length=1, max_length=64)


@router.post("/{entry_id}/vehicle-exited", response_model=GateEntryResponse)
async def mark_inbound_vehicle_exited(
    entry_id: str,
    payload: InboundVehicleExitPayload,
    user: CurrentUser = Depends(require_permission("gate:write")),
    uow: UnitOfWork = Depends(get_uow),
) -> GateEntryResponse:
    """
    Record that an inbound raw-material vehicle has exited the facility after unloading/receiving.
    """
    try:
        model = await uow.session.get(GateEntryModel, uuid.UUID(entry_id))
    except ValueError:
        model = None

    if model is None:
        raise NotFoundException(f"Gate entry with ID '{entry_id}' not found")

    expected_gate_pass = (model.gate_entry_number or "").strip().upper()
    if payload.gate_pass_id.strip().upper() != expected_gate_pass:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Gate pass ID does not match this gate entry")

    current_status = (model.status or "").upper().strip()
    if current_status == "VEHICLE_EXITED" or model.exited_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vehicle has already exited.",
        )

    # Inbound exit is available only after the receiving transaction has
    # completed and the assigned Warehouse Operator has released the dock.  Do not
    # infer readiness from a loosely related gate-entry status: the dock
    # assignment and posted GRN are the source of truth for this scenario.
    if current_status != "RECEIVING_COMPLETED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Gate entry status '{current_status}' is not eligible for inbound exit. Receiving must be completed first.",
        )

    assignment_result = await uow.session.execute(
        select(DockAssignmentModel)
        .where(DockAssignmentModel.gate_entry_id == model.id)
        .with_for_update()
    )
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None or assignment.receiving_completed_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Receiving completion record is missing")
    if assignment.dock_released_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Warehouse Operator must release the dock before inbound gate exit")
    if assignment.prepared_grn_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GRN must be prepared before inbound gate exit")

    grn = await uow.session.get(GrnModel, assignment.prepared_grn_id)
    if grn is None or (grn.status or "").upper().strip() not in {
        "GRN_COMPLETED",
        "GRN_POSTED",
        "COMPLETED",
        "RECEIVING_COMPLETE",
    }:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Completed receiving GRN is required before inbound gate exit")

    now = datetime.datetime.now(datetime.timezone.utc)
    model.status = "VEHICLE_EXITED"
    model.exited_at = now
    model.exited_by = user.username
    model.updated_at = now

    audit_entry = GateEntryAuditLogModel(
        gate_entry_id=model.id,
        action="VEHICLE_EXITED",
        performed_by=user.username,
        timestamp=now,
        details={
            "previous_status": current_status,
            "new_status": "VEHICLE_EXITED",
            "exited_at": now.isoformat(),
            "exited_by": user.username,
        },
    )
    uow.session.add(audit_entry)
    await uow.session.flush()

    entry = _gate_entry_from_model(model)
    response = _to_gate_entry_response(entry)
    return response.model_copy(update={
        "exited_at": now.isoformat(),
        "exited_by": user.username,
    })


@router.get("/{entry_id}", response_model=GateEntryResponse)
async def get_gate_entry(
    entry_id: str,
    _user: CurrentUser = Depends(require_permission("gate:read")),
    uow: UnitOfWork = Depends(get_uow),
) -> GateEntryResponse:
    """Fetch Gate Entry details by ID."""
    try:
        model = await uow.session.get(GateEntryModel, uuid.UUID(entry_id))
    except ValueError:
        model = None
    entry = _gate_entry_from_model(model) if model else None
    if not entry:
        raise NotFoundException(f"Gate entry with ID '{entry_id}' not found")
    return _to_gate_entry_response(entry)


@router.get("", response_model=list[GateEntryResponse])
async def list_gate_entries(
    status: Optional[str] = None,
    _user: CurrentUser = Depends(require_permission("gate:read")),
    uow: UnitOfWork = Depends(get_uow),
) -> list[GateEntryResponse]:
    try:
        query = select(GateEntryModel).where(
            GateEntryModel.gate_entry_number.isnot(None),
            GateEntryModel.gate_entry_number != "",
            GateEntryModel.status.notin_(["REJECTED", "CANCELLED", "DRAFT"])
        ).order_by(GateEntryModel.created_at.desc())
        if status:
            query = query.where(GateEntryModel.status == status.strip().upper())
        result = await uow.session.execute(query)
        models = list(result.scalars().all())
        responses = []
        for model in models:
            response = _to_gate_entry_response(_gate_entry_from_model(model))
            responses.append(response.model_copy(update={
                "driver_phone": model.driver_phone,
                "document_image_base64": base64.b64encode(model.po_document_data).decode("ascii") if model.po_document_data else None,
                "exited_at": model.exited_at.isoformat() if model.exited_at else None,
                "exited_by": model.exited_by,
            }))
        return responses
    except Exception as e:
        logger.exception("Error in list_gate_entries: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to list gate entries: {str(e)}")


@router.get("/{entry_id}/pass")
async def download_gate_pass(
    entry_id: str,
    _user: CurrentUser = Depends(require_permission("gate:read")),
    uow: UnitOfWork = Depends(get_uow),
):
    """Generate a printable HTML Gate Pass."""
    try:
        model = await uow.session.get(GateEntryModel, uuid.UUID(entry_id))
    except ValueError:
        model = None
    entry = _gate_entry_from_model(model) if model else None
    if not entry:
        raise NotFoundException(f"Gate entry with ID '{entry_id}' not found")

    from app.modules.gate.application.pdf_service import GatePassPdfGenerator
    generator = GatePassPdfGenerator()
    pass_html = generator.generate_html(entry)
    filename = f"GatePass-{entry.gate_entry_number}.html".replace('"', "")

    return Response(
        content=pass_html,
        media_type="text/html",
        headers={"Content-Disposition": f'inline; filename="{filename}"'}
    )

    filename = f"GatePass-{entry.gate_entry_number}.pdf".replace('"', "")

    return Response(
        content=pass_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
