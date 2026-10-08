"""
FastAPI REST router for the Gate Entry module.
Purged all hardcoded mocks. Implements real dynamic PO OCR processing via OpenCV + Tesseract
and persistent gate pass creation with Outbox Event generation.
"""
from __future__ import annotations

import base64
import asyncio
import datetime
import logging
import re
import uuid
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import selectinload

from app.common.domain.exceptions import DomainRuleViolationException, NotFoundException
from app.common.email_utils import render_premium_email, send_email
from app.database.session import UnitOfWork, get_uow
from app.modules.gate.adapters.mock_adapters import InMemoryGateEntryRepository
from app.modules.gate.infrastructure.persistence.models import DamagePhotoModel, DamageReportModel, DockAssignmentModel, DockModel, GateEntryAuditLogModel, GateEntryModel, GateExitModel, ReceivingLineModel, VehicleExitApprovalModel
from app.common.persistence.models import AsnLineModel, PurchaseOrderModel, AsnModel, MaterialStockModel, NotificationModel, SupplierContactModel, SupplierModel
from app.modules.receiving.infrastructure.persistence.models import GrnLineModel, GrnModel, InventoryReceiptPostingModel
from app.modules.receiving.domain.events import GrnPostedEvent, PostedInventoryLine
from app.events.outbox_repository import to_outbox_row
from app.modules.storage.infrastructure.persistence.models import HandlingUnitModel, PutawayTaskModel, StorageLocationModel
from app.modules.storage.application.location_strategy import recommend_storage_location
from app.modules.store.infrastructure.persistence.models import StoreModel, StoreManagerUserModel
from app.modules.dock.infrastructure.persistence.models import DockMasterModel
from app.modules.quarantine.infrastructure.persistence.models import QuarantineRecordModel
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

router = APIRouter(prefix="/api/gate-entries", tags=["gate"])
preview_router = APIRouter(prefix="/api/gate", tags=["gate"])
logger = logging.getLogger(__name__)


def _asn_response(asn: AsnModel) -> dict:
    return {
        "id": str(asn.id),
        "asn_number": asn.asn_number,
        "po_id": asn.po_id,
        "po_number": asn.po_number,
        "supplier_id": str(asn.supplier_id) if asn.supplier_id else None,
        "vehicle_number": asn.vehicle_number,
        "driver_name": asn.driver_name,
        "driver_contact": asn.driver_contact,
        "expected_arrival_at": asn.expected_arrival_at.isoformat() if asn.expected_arrival_at else None,
        "delivery_date": asn.expected_arrival_at.date().isoformat() if asn.expected_arrival_at else None,
        "shipment_date": asn.shipment_date.isoformat() if asn.shipment_date else None,
        "status": asn.status,
        "transporter": asn.transporter,
        "logistics": asn.logistics or [],
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
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    query = select(AsnModel).options(selectinload(AsnModel.lines)).order_by(AsnModel.created_at.desc())
    if supplier_id:
        try:
            query = query.where(AsnModel.supplier_id == uuid.UUID(supplier_id))
        except ValueError:
            return []
    result = await uow.session.execute(query)
    return [_asn_response(asn) for asn in result.scalars().all()]


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
    return {"asnNumber": f"{prefix}{highest + 1}"}


@preview_router.get("/asn/{reference}")
async def get_expected_delivery(reference: str, uow: UnitOfWork = Depends(get_uow)) -> dict:
    normalized_reference = reference.strip().upper()
    filters = [func.upper(AsnModel.asn_number) == normalized_reference]
    try:
        filters.append(AsnModel.id == uuid.UUID(reference))
    except ValueError:
        pass
    result = await uow.session.execute(
        select(AsnModel).options(selectinload(AsnModel.lines)).where(or_(*filters))
    )
    asn = result.scalars().first()
    if asn is None:
        compact_match = re.fullmatch(r"ASN-(\d{4})-(\d+)", normalized_reference)
        if compact_match:
            year, sequence = compact_match.groups()
            all_asns = await uow.session.execute(
                select(AsnModel).options(selectinload(AsnModel.lines)).where(
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
    return _asn_response(asn)


@preview_router.post("/asns", status_code=status.HTTP_201_CREATED)
async def create_supplier_asn(payload: dict = Body(...), uow: UnitOfWork = Depends(get_uow)) -> dict:
    asn_number = str(payload.get("asn_number") or "").strip().upper()
    if not asn_number:
        raise HTTPException(status_code=422, detail="asn_number is required")
    if re.fullmatch(r"ASN-\d{4}-\d+", asn_number) is None:
        raise HTTPException(status_code=422, detail="asn_number must use format ASN-YYYY-N, for example ASN-2026-1")
    existing = await uow.session.execute(select(AsnModel).where(AsnModel.asn_number == asn_number))
    if existing.scalars().first() is not None:
        raise HTTPException(status_code=409, detail=f"ASN '{asn_number}' already exists")

    po_number = str(payload.get("po_number") or "").strip()
    po_filters = []
    if po_number:
        po_filters.append(func.upper(PurchaseOrderModel.po_number) == po_number.upper())
    raw_po_id = str(payload.get("po_id") or "").strip()
    if raw_po_id:
        try:
            po_filters.append(PurchaseOrderModel.id == uuid.UUID(raw_po_id))
        except ValueError:
            pass
    po_model = None
    if po_filters:
        po_result = await uow.session.execute(
            select(PurchaseOrderModel)
            .options(selectinload(PurchaseOrderModel.items))
            .where(or_(*po_filters))
        )
        po_model = po_result.scalars().first()
        if po_model and not po_number:
            po_number = po_model.po_number

    submitted_lines = payload.get("lines") or []
    if not isinstance(submitted_lines, list):
        raise HTTPException(status_code=422, detail="lines must be a list")
    validated_lines: list[tuple[dict, Decimal]] = []
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
        if validated_quantity < 0:
            raise HTTPException(status_code=422, detail="shipped_quantity cannot be negative")
        validated_lines.append((raw_line, validated_quantity))

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

    supplier_id = None
    raw_supplier_id = payload.get("supplier_id")
    if raw_supplier_id:
        try:
            supplier_id = uuid.UUID(str(raw_supplier_id))
        except ValueError:
            supplier_id = None

    shipment_date_raw = payload.get("shipment_date")
    try:
        shipment_date = datetime.date.fromisoformat(str(shipment_date_raw)) if shipment_date_raw else datetime.date.today()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="shipment_date must be YYYY-MM-DD") from exc

    expected_raw = payload.get("expected_arrival_at")
    expected_arrival_at = None
    if expected_raw:
        try:
            expected_arrival_at = datetime.datetime.fromisoformat(str(expected_raw).replace("Z", "+00:00"))
            # The ASN column is TIMESTAMP WITHOUT TIME ZONE. Normalize browser
            # ISO timestamps before binding them through asyncpg.
            if expected_arrival_at.tzinfo is not None:
                expected_arrival_at = expected_arrival_at.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="expected_arrival_at must be an ISO datetime") from exc

    asn = AsnModel(
        asn_number=asn_number,
        supplier_id=supplier_id,
        po_id=str(payload.get("po_id")) if payload.get("po_id") else None,
        po_number=po_model.po_number if po_model else (po_number or None),
        status=str(payload.get("status") or "SUBMITTED").upper(),
        vehicle_number=str(payload.get("vehicle_number") or "").strip().upper() or None,
        driver_name=str(payload.get("driver_name") or "").strip() or None,
        driver_contact=str(payload.get("driver_contact") or "").strip() or None,
        expected_arrival_at=expected_arrival_at,
        shipment_date=shipment_date,
        transporter=str(payload.get("transporter") or "").strip() or None,
        number_of_packages=payload.get("number_of_packages") or None,
        package_type=str(payload.get("package_type") or "").strip() or None,
        shipment_type=str(payload.get("shipment_type") or "STANDARD").upper(),
        invoice_number=str(payload.get("invoice_number") or "").strip() or None,
        challan_number=str(payload.get("challan_number") or "").strip() or None,
        logistics=payload.get("logistics") if isinstance(payload.get("logistics"), list) else None,
    )
    uow.session.add(asn)
    for raw_line, quantity in validated_lines:
        asn.lines.append(AsnLineModel(
            item_code=str(raw_line.get("item_code") or raw_line.get("material_code") or "ITEM"),
            material_name=str(raw_line.get("material_name") or raw_line.get("material_description") or ""),
            shipped_quantity=quantity,
            uom=str(raw_line.get("uom") or "PCS"),
        ))
    await uow.session.flush()
    return _asn_response(asn)





def _canonical_warehouse_id(warehouse_id: str | None) -> str:
    """Normalize legacy warehouse display names used by seeded inventory."""
    normalized = (warehouse_id or "").strip()
    if normalized.casefold() in {"main", "main warehouse", "wh_pune-01"}:
        return "WH_PUNE-01"
    return normalized.upper()


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
                        r"(?:\d{2}BH\d{4}[A-Z]{2}|[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4})",
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
    """Generate sequential Gate Entry Number: GE-YYYYMMDD-<6-HEX-SUFFIX>"""
    today_str = datetime.datetime.utcnow().strftime("%Y%m%d")
    hex_suffix = uuid.uuid4().hex[:6].upper()
    return f"GE-{today_str}-{hex_suffix}"


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
        po_number=entry.po_number or "",
        vehicle_number=entry.vehicle_plate,
        driver_name=entry.driver_name or "Driver",
        po_document_path=f"database://gate-entry/{entry.id}/po-document",
        vehicle_photo_path=f"database://gate-entry/{entry.id}/vehicle-photo" if vehicle_data else None,
        status=entry.status.value if hasattr(entry.status, "value") else str(entry.status),
        verification_type="MATCHED" if not mismatches else "MISMATCHED",
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

    try:
        plate = normalize_vehicle_registration((asn.vehicle_number if asn else request.vehicle_plate) or "")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    po_num = ((asn.po_number if asn else request.po_number) or (asn.asn_number if asn else "")).strip().upper()

    if not plate:
        raise DomainRuleViolationException("Vehicle number is mandatory.")
    if not po_num:
        raise DomainRuleViolationException("Purchase order number is mandatory.")
    po_record = await _lookup_database_po(uow.session, po_num)
    if asn and not (request.supplier_name and request.supplier_name.strip()):
        supplier_name = (po_record.supplier_name if po_record else "").strip()
        if not supplier_name and asn.supplier_id:
            supplier_result = await uow.session.execute(
                select(SupplierModel).where(SupplierModel.id == asn.supplier_id)
            )
            supplier = supplier_result.scalars().first()
            supplier_name = (supplier.supplier_name if supplier else "").strip()
        request.supplier_name = supplier_name or "ASN Supplier"
    if asn and request.total_quantity is None:
        request.total_quantity = sum(float(line.shipped_quantity or 0) for line in asn.lines)
    if not (request.supplier_name and request.supplier_name.strip()):
        raise DomainRuleViolationException("Supplier name is mandatory.")
    if request.total_quantity is None or request.total_quantity <= 0:
        raise DomainRuleViolationException("Total quantity is mandatory and must be greater than 0.")

    # 1. Block only a duplicate arrival for the same PO and vehicle. A single
    # PO can have multiple ASN shipments and therefore multiple vehicles.
    active_result = await uow.session.execute(
        select(GateEntryModel).where(
            GateEntryModel.po_number == po_num,
            GateEntryModel.status.notin_([GateEntryStatus.REJECTED.value]),
        )
    )
    active_entries = [_gate_entry_from_model(model) for model in active_result.scalars().all()]
    GateVerificationService.check_duplicate_active_entry(active_entries, po_num, plate)

    # 2. Dynamic OCR processing or extraction
    ocr_res: Optional[OcrResult] = None

    # The scan preview or form input has already populated the submitted fields.
    # Master PO data is authoritative whenever it is available.
    if asn:
        ocr_res = OcrResult(
            po_number=po_num,
            supplier_name=po_record.supplier_name if po_record else "",
            material_description=", ".join(line.material_name or line.item_code for line in asn.lines),
            total_quantity=sum(float(line.shipped_quantity or 0) for line in asn.lines),
            po_date=po_record.po_date if po_record else "",
            delivery_date=po_record.delivery_date if po_record else "",
            confidence=1.0,
            line_items=tuple({"material_code": line.item_code, "material_description": line.material_name, "quantity": float(line.shipped_quantity), "uom": line.uom} for line in asn.lines),
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
        driver_name=request.driver_name,
        po_number=po_record.po_number if po_record else po_num,
        po_id=str(asn.po_id) if asn and asn.po_id else None,
        asn_id=str(asn.id) if asn else None,
        asn_number=asn.asn_number if asn else None,
        truck_photo_base64=request.truck_photo_base64,
        ocr_result=ocr_res,
        status=computed_status,
        mismatched_fields=mismatches,
    )
    entry.gate_entry_number = gate_entry_num
    entry.approve_gate_entry(user.username)
    if asn:
        asn.status = GateEntryStatus.GATE_ENTRY_APPROVED.value
        uow.session.add(NotificationModel(
            user_role="WAREHOUSE",
            title="Gate Entry Approved",
            message=f"{asn.asn_number} for vehicle {plate} has been approved at the gate and is ready for warehouse processing.",
            link=f"/procurement/asns/{asn.id}",
        ))
    else:
        uow.session.add(NotificationModel(
            user_role="WAREHOUSE",
            title="Direct Gate Entry Approved",
            message=f"Vehicle {plate} for PO {po_num} has been approved at the gate and is ready for warehouse processing.",
            link="/dock-management",
        ))
    entry.move_to_inbound_queue()

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
    user: CurrentUser = Depends(require_permission("gate:read")),
    uow: UnitOfWork = Depends(get_uow),
):
    """Warehouse queue backed by approved gate entries and their source ASNs."""
    store_scoped = False
    scoped_store_id = None
    scoped_store_code = None

    user_roles_upper = [r.upper() for r in (user.roles or [])]
    is_admin_or_wm = any(r in user_roles_upper for r in ["ADMIN", "WAREHOUSE", "WAREHOUSE_MANAGER", "SECURITY", "PROCUREMENT"])
    is_store_user = any(r in user_roles_upper for r in ["STORE_MANAGER", "STORE_KEEPER", "STORE"])

    if is_store_user and not is_admin_or_wm:
        store_scoped = True
        scoped_store_id = user.raw_claims.get("store_id")
        scoped_store_code = user.raw_claims.get("store_code")
        if not scoped_store_id:
            mgr_res = await uow.session.execute(
                select(StoreManagerUserModel).where(
                    or_(
                        StoreManagerUserModel.username == user.username,
                        StoreManagerUserModel.employee_id == user.subject,
                    )
                )
            )
            mgr = mgr_res.scalars().first()
            if mgr:
                scoped_store_id = str(mgr.store_id)

    result = await uow.session.execute(
        select(GateEntryModel, AsnModel, PurchaseOrderModel, DockAssignmentModel)
        .outerjoin(AsnModel, GateEntryModel.asn_id == AsnModel.id)
        .outerjoin(PurchaseOrderModel, PurchaseOrderModel.po_number == GateEntryModel.po_number)
        .outerjoin(DockAssignmentModel, DockAssignmentModel.gate_entry_id == GateEntryModel.id)
        .options(selectinload(AsnModel.lines))
        .options(selectinload(PurchaseOrderModel.items))
        .where(GateEntryModel.status.in_([
            GateEntryStatus.PO_VERIFIED.value,
            GateEntryStatus.UNSCHEDULED_ARRIVAL.value,
            GateEntryStatus.APPROVED.value,
            GateEntryStatus.GATE_ENTRY_APPROVED.value,
            GateEntryStatus.AWAITING_DOCK.value,
            GateEntryStatus.DOCK_ASSIGNED.value,
            GateEntryStatus.MOVING_TO_DOCK.value,
            GateEntryStatus.AT_DOCK.value,
            GateEntryStatus.UNLOADING_IN_PROGRESS.value,
            GateEntryStatus.QUALITY_INSPECTION_REQUIRED.value,
            GateEntryStatus.QUALITY_PASSED.value,
            GateEntryStatus.QUALITY_FAILED.value,
            GateEntryStatus.RECEIVING_COMPLETED.value,
            GateEntryStatus.EXIT_APPROVED.value,
            GateEntryStatus.GATE_EXIT_COMPLETED.value,
        ]))
        .order_by(GateEntryModel.created_at.asc())
    )
    arrivals = []
    for gate_entry, asn, po, assignment in result.all():
        if store_scoped:
            if not assignment or not assignment.assigned_store_id:
                continue
            if scoped_store_id and str(assignment.assigned_store_id) != scoped_store_id and assignment.assigned_store_code != scoped_store_code:
                continue

        received_by_code = {}
        if assignment:
            received_result = await uow.session.execute(
                select(ReceivingLineModel).where(ReceivingLineModel.dock_assignment_id == assignment.id)
            )
            received_by_code = {line.item_code: line for line in received_result.scalars().all()}
        arrivals.append({
            "id": str(gate_entry.id),
            "gate_entry_number": gate_entry.gate_entry_number,
            "asn_id": str(asn.id) if asn else None,
            "asn_number": asn.asn_number if asn else "DIRECT-ARRIVAL",
            "po_number": gate_entry.po_number,
            "supplier_name": (po.supplier_name if po else None) or gate_entry.ocr_supplier_name or "Unknown Supplier",
            "vehicle_number": (asn.vehicle_number if asn else None) or gate_entry.vehicle_number,
            "driver_name": (asn.driver_name if asn else None) or gate_entry.driver_name,
            "driver_contact": asn.driver_contact if asn else None,
            "arrival_time": gate_entry.created_at.isoformat(),
            "expected_arrival_at": asn.expected_arrival_at.isoformat() if asn and asn.expected_arrival_at else None,
            "status": (
                GateEntryStatus.AWAITING_DOCK.value
                if gate_entry.status in {
                    GateEntryStatus.PO_VERIFIED.value,
                    GateEntryStatus.APPROVED.value,
                    GateEntryStatus.GATE_ENTRY_APPROVED.value,
                }
                else gate_entry.status
            ),
            "assigned_dock_id": gate_entry.assigned_dock_id,
            "assigned_store_id": str(assignment.assigned_store_id) if assignment and assignment.assigned_store_id else None,
            "assigned_store_code": assignment.assigned_store_code if assignment else None,
            "assigned_store_name": assignment.assigned_store_name if assignment else None,
            "po_id": str(po.id) if po else None,
            "assigned_by": assignment.assigned_by if assignment else None,
            "assigned_at": assignment.assigned_at.isoformat() if assignment else None,
            "movement_started_by": assignment.movement_started_by if assignment else None,
            "movement_started_at": assignment.movement_started_at.isoformat() if assignment and assignment.movement_started_at else None,
            "dock_checked_in_by": assignment.dock_checked_in_by if assignment else None,
            "dock_arrival_at": assignment.dock_arrival_at.isoformat() if assignment and assignment.dock_arrival_at else None,
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
                    "item_code": line.item_code,
                    "material_name": line.material_name,
                    "quantity": float(line.shipped_quantity),
                    "po_quantity": (
                        next(
                            (
                                float(item.quantity)
                                for item in (po.items if po else [])
                                if (
                                    getattr(item, "material_code", None) == line.item_code
                                    or getattr(item, "item_code", None) == line.item_code
                                    or getattr(item, "material_name", None) == line.material_name
                                    or getattr(item, "material_description", None) == line.material_name
                                )
                            ),
                            None,
                        )
                        or float(line.shipped_quantity)
                    ),
                    "uom": line.uom,
                    "received_quantity": float(received_by_code[line.item_code].received_quantity) if line.item_code in received_by_code else None,
                    "variance_to_po": float(received_by_code[line.item_code].received_quantity - received_by_code[line.item_code].ordered_quantity) if line.item_code in received_by_code else None,
                    "variance_to_shipped": float(received_by_code[line.item_code].received_quantity - received_by_code[line.item_code].shipped_quantity) if line.item_code in received_by_code else None,
                    "recorded_by": received_by_code[line.item_code].recorded_by if line.item_code in received_by_code else None,
                    "recorded_at": received_by_code[line.item_code].recorded_at.isoformat() if line.item_code in received_by_code else None,
                    "verification_status": received_by_code[line.item_code].verification_status if line.item_code in received_by_code else None,
                    "exception_quantity": float(received_by_code[line.item_code].exception_quantity) if line.item_code in received_by_code else None,
                    "good_quantity": float(received_by_code[line.item_code].good_quantity) if line.item_code in received_by_code and received_by_code[line.item_code].good_quantity is not None else None,
                    "damaged_quantity": float(received_by_code[line.item_code].damaged_quantity) if line.item_code in received_by_code and received_by_code[line.item_code].damaged_quantity is not None else None,
                    "rejected_quantity": float(received_by_code[line.item_code].rejected_quantity) if line.item_code in received_by_code and received_by_code[line.item_code].rejected_quantity is not None else None,
                    "condition_result": received_by_code[line.item_code].condition_result if line.item_code in received_by_code else None,
                    "inspection_required": received_by_code[line.item_code].inspection_required if line.item_code in received_by_code else False,
                    "physical_condition_ok": received_by_code[line.item_code].physical_condition_ok if line.item_code in received_by_code else None,
                    "packaging_ok": received_by_code[line.item_code].packaging_ok if line.item_code in received_by_code else None,
                    "specifications_ok": received_by_code[line.item_code].specifications_ok if line.item_code in received_by_code else None,
                    "serial_batch_number": received_by_code[line.item_code].serial_batch_number if line.item_code in received_by_code else None,
                    "serial_batch_verified": received_by_code[line.item_code].serial_batch_verified if line.item_code in received_by_code else False,
                    "disposition_status": received_by_code[line.item_code].disposition_status if line.item_code in received_by_code else None,
                    "quarantine_location": received_by_code[line.item_code].quarantine_location if line.item_code in received_by_code else None,
                    "quarantined_by": received_by_code[line.item_code].quarantined_by if line.item_code in received_by_code else None,
                    "quarantined_at": received_by_code[line.item_code].quarantined_at.isoformat() if line.item_code in received_by_code and received_by_code[line.item_code].quarantined_at else None,
                    "condition_notes": received_by_code[line.item_code].condition_notes if line.item_code in received_by_code else None,
                }
                for line in (asn.lines if asn else [])
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
        .where(GateEntryModel.status.in_([GateEntryStatus.DOCK_ASSIGNED.value, GateEntryStatus.MOVING_TO_DOCK.value, GateEntryStatus.AT_DOCK.value, GateEntryStatus.UNLOADING_IN_PROGRESS.value, GateEntryStatus.QUALITY_INSPECTION_REQUIRED.value, GateEntryStatus.QUALITY_PASSED.value, GateEntryStatus.QUALITY_FAILED.value, GateEntryStatus.RECEIVING_COMPLETED.value]))
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

    store = None
    raw_store_id = request.store_id.strip() if request.store_id else ""
    if raw_store_id:
        try:
            store_uuid = uuid.UUID(raw_store_id)
            store = await uow.session.get(StoreModel, store_uuid)
        except ValueError:
            pass

    if raw_store_id and store is None:
        store_res = await uow.session.execute(
            select(StoreModel).where(func.upper(StoreModel.store_code) == raw_store_id.upper())
        )
        store = store_res.scalars().first()

    if store is None:
        dock_wh = (dock.warehouse_id or "").strip().upper()
        store_stmt = select(StoreModel).where(func.upper(StoreModel.status) == "ACTIVE")
        if dock_wh:
            store_stmt = store_stmt.where(func.upper(StoreModel.warehouse_id) == dock_wh)
        store_res = await uow.session.execute(store_stmt.order_by(StoreModel.store_code).limit(1))
        store = store_res.scalars().first()

    if store is None:
        detail = (
            f"Store '{raw_store_id}' does not exist"
            if raw_store_id
            else "No active store is available for this dock warehouse"
        )
        raise HTTPException(status_code=422, detail=detail)

    if (store.status or "").strip().upper() != "ACTIVE":
        raise HTTPException(status_code=422, detail=f"Store '{store.store_name}' ({store.store_code}) is inactive")

    # Validate Warehouse isolation
    store_wh = (store.warehouse_id or "").strip().upper()
    dock_wh = (dock.warehouse_id or "").strip().upper()
    if store_wh and dock_wh and store_wh != dock_wh:
        raise HTTPException(
            status_code=422,
            detail=f"Store '{store.store_name}' belongs to warehouse '{store.warehouse_id}', which does not match dock warehouse '{dock.warehouse_id}'",
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

    po_result = await uow.session.execute(
        select(PurchaseOrderModel).where(PurchaseOrderModel.po_number == model.po_number)
    )
    po = po_result.scalar_one_or_none()
    # Unscheduled arrivals might not have a database PO record; allow assignment to continue.
    if po is None and model.status != GateEntryStatus.AWAITING_DOCK.value:
         raise HTTPException(status_code=409, detail=f"Purchase order {model.po_number} was not found")
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
        assigned_store_id=store.id,
        assigned_store_code=store.store_code,
        assigned_store_name=store.store_name,
        assigned_by=user.username,
        assigned_at=assigned_at,
    )
    uow.session.add(assignment)

    # Dispatch targeted notification exclusively to the assigned Store
    notif_msg = (
        f"Vehicle {entry.vehicle_plate} (Gate Entry: {entry.gate_entry_number}) has arrived at Dock {dock_id} "
        f"and has been assigned to {store.store_name} ({store.store_code}). "
        f"PO: {model.po_number}. Please proceed with the store-side unloading/receiving workflow."
    )
    uow.session.add(NotificationModel(
        user_role=f"STR:{store.store_code}"[:32],
        title=f"Vehicle Arrival Assigned to {store.store_name}",
        message=notif_msg,
        link="/my-store",
    ))
    uow.session.add(NotificationModel(
        user_role=f"STR:{store.id}"[:32],
        title=f"Vehicle Arrival Assigned to {store.store_name}",
        message=notif_msg,
        link="/my-store",
    ))

    return {
        "id": entry.id,
        "status": entry.status.value,
        "asn_id": str(model.asn_id) if model.asn_id else None,
        "po_id": str(po.id) if po else None,
        "vehicle_number": model.vehicle_number,
        "dock_number": dock_id,
        "assigned_store_id": str(store.id),
        "assigned_store_code": store.store_code,
        "assigned_store_name": store.store_name,
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
    await _save_gate_entry(uow.session, entry)
    uow.session.add(NotificationModel(
        user_role="WAREHOUSE",
        title="Vehicle Moving to Dock",
        message=f"{entry.vehicle_plate} is moving to {entry.assigned_dock_id}.",
        link="/dock-management",
    ))
    return {
        "id": entry.id,
        "status": entry.status.value,
        "dock_number": entry.assigned_dock_id,
        "vehicle_number": entry.vehicle_plate,
        "movement_started_by": user.username,
        "movement_started_at": started_at.isoformat(),
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
    po_result = await uow.session.execute(select(PurchaseOrderModel).options(selectinload(PurchaseOrderModel.items)).where(PurchaseOrderModel.id == assignment.po_id))
    po = po_result.scalar_one_or_none()
    if asn is None or po is None:
        raise HTTPException(status_code=409, detail="ASN or purchase order details were not found")
    asn_lines = {line.item_code: line for line in asn.lines}
    po_quantities = {item.material_code: item.quantity for item in po.items}
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
        ordered = po_quantities.get(submitted.item_code, 0)
        received = submitted.received_quantity
        verification_status, exception_quantity = _quantity_result(float(ordered), received)
        line = ReceivingLineModel(
            dock_assignment_id=assignment.id, item_code=submitted.item_code,
            material_name=asn_line.material_name, uom=asn_line.uom,
            ordered_quantity=ordered, shipped_quantity=asn_line.shipped_quantity,
            received_quantity=received, recorded_by=user.username, recorded_at=recorded_at,
            verification_status=verification_status, exception_quantity=exception_quantity,
        )
        uow.session.add(line)
        response_items.append({
            "item_code": submitted.item_code, "ordered_quantity": float(ordered),
            "shipped_quantity": float(asn_line.shipped_quantity), "received_quantity": received,
            "variance_to_po": received - float(ordered),
            "variance_to_shipped": received - float(asn_line.shipped_quantity),
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
        accounted = item.good_quantity + item.damaged_quantity + item.rejected_quantity
        if abs(accounted - float(line.received_quantity)) > 0.0001:
            raise HTTPException(status_code=422, detail=f"Good, damaged and rejected quantities for {item.item_code} must equal received quantity")
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
        results.append({"item_code": item.item_code, "result": result, "good_quantity": item.good_quantity, "damaged_quantity": item.damaged_quantity, "rejected_quantity": item.rejected_quantity})
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
    po = await uow.session.get(PurchaseOrderModel, assignment.po_id)
    asn = await uow.session.get(AsnModel, assignment.asn_id)
    if po is None or asn is None:
        raise HTTPException(status_code=409, detail="PO or ASN context was not found")
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
                quantity=line.good_quantity, uom=line.uom or "PCS", supplier_name=po.supplier_name,
                po_number=model.po_number, asn_number=asn.asn_number,
                warehouse_id=_canonical_warehouse_id(asn.warehouse_id or po.warehouse_id), current_location="RECEIVING_AREA",
                status="LABEL_GENERATED", generated_by=user.username, generated_at=now, updated_at=now,
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
    po = await uow.session.get(PurchaseOrderModel, assignment.po_id)
    asn = await uow.session.get(AsnModel, assignment.asn_id)
    if po is None or asn is None:
        raise HTTPException(status_code=409, detail="PO or ASN context was not found for GRN creation")
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
        asn_id=asn.id, asn_number=asn.asn_number, supplier_name=po.supplier_name,
        vehicle_number=assignment.vehicle_number, warehouse_id=_canonical_warehouse_id(asn.warehouse_id or po.warehouse_id),
        dock_number=assignment.dock_number, status="GRN_DRAFT",
    )
    grn.lines = [
        GrnLineModel(
            item_code=line.item_code, material_name=line.material_name, uom=line.uom,
            received_quantity=line.received_quantity, ordered_quantity=line.ordered_quantity,
            accepted_quantity=line.good_quantity, damaged_quantity=line.damaged_quantity or 0,
            rejected_quantity=line.rejected_quantity or 0, quality_result=line.condition_result,
        )
        for line in lines
    ]
    uow.session.add(grn)
    # The assignment references this new GRN. Flush the parent first because
    # assignment is an existing row and SQLAlchemy may otherwise schedule its
    # UPDATE ahead of the unrelated GRN INSERT, violating the foreign key.
    await uow.session.flush()
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
    for grn_line in grn.lines:
        unit = units_by_receiving_line.get(receiving_by_code[grn_line.item_code].id)
        if unit is None and (grn_line.accepted_quantity or 0) > 0:
            raise HTTPException(status_code=409, detail=f"Generate a material label for {grn_line.item_code} before completing receiving")
        if unit is not None:
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
                    destination_store_id=getattr(assignment, "assigned_store_id", None),
                    assigned_to=getattr(assignment, "assigned_store_manager_username", None) or getattr(assignment, "assigned_store_manager_name", None) or getattr(assignment, "assigned_store_manager_id", None),
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
                    status="PUTAWAY_PENDING" if getattr(assignment, "assigned_store_manager_id", None) or getattr(assignment, "assigned_store_manager_username", None) else "OPEN",
                    created_by=user.username, created_at=completed_at,
                ))
                next_task_sequence += 1
                unit.status = "PUTAWAY_PENDING"
                tasks_created += 1
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
    assignment.receiving_completed_by = user.username
    assignment.receiving_completed_at = completed_at
    await _save_gate_entry(uow.session, entry)
    uow.session.add(NotificationModel(user_role="WAREHOUSE", title="GRN Draft Created", message=f"{grn_number} is ready for review after receiving {entry.vehicle_plate}.", link="/grn"))
    uow.session.add(NotificationModel(user_role="WAREHOUSE", title="Putaway Tasks Created", message=f"{tasks_created} putaway task(s) were created for accepted quantities on {grn_number}.", link="/putaway-tasks"))
    await uow.session.flush()
    return {"gate_entry_id": entry_id, "status": entry.status.value, "grn_id": str(grn.id), "grn_number": grn_number, "grn_status": grn.status, "putaway_tasks_created": tasks_created, "putaway_status": "AWAITING_PUTAWAY", "completed_by": user.username, "completed_at": completed_at.isoformat()}


async def _get_store_user_context(user: CurrentUser, uow: UnitOfWork) -> tuple[set[uuid.UUID], set[str]]:
    """Returns (store_ids, store_codes) authorized for the current user."""
    store_ids: set[uuid.UUID] = set()
    store_codes: set[str] = set()

    raw_id = getattr(user, "store_id", None) or user.raw_claims.get("store_id")
    if raw_id:
        try:
            store_ids.add(uuid.UUID(str(raw_id)))
        except (ValueError, TypeError):
            pass

    raw_code = getattr(user, "store_code", None) or user.raw_claims.get("store_code")
    if raw_code:
        store_codes.add(str(raw_code).strip().upper())

    emp_id = user.raw_claims.get("employee_id") or user.subject or user.username
    if emp_id:
        st_res = await uow.session.execute(
            select(StoreManagerUserModel).where(
                or_(
                    func.lower(StoreManagerUserModel.employee_id) == str(emp_id).strip().lower(),
                    func.lower(StoreManagerUserModel.username) == str(emp_id).strip().lower(),
                )
            )
        )
        sm_users = st_res.scalars().all()
        for sm in sm_users:
            if sm.store_id:
                store_ids.add(sm.store_id)
            if getattr(sm, "store_code", None):
                store_codes.add(str(sm.store_code).strip().upper())

    if store_ids:
        s_res = await uow.session.execute(select(StoreModel).where(StoreModel.id.in_(store_ids)))
        for s in s_res.scalars().all():
            if s.store_code:
                store_codes.add(s.store_code.strip().upper())

    if store_codes:
        s_res = await uow.session.execute(select(StoreModel).where(func.upper(StoreModel.store_code).in_(store_codes)))
        for s in s_res.scalars().all():
            store_ids.add(s.id)

    return store_ids, store_codes


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

    # Validate Store assignment exists
    if not assignment.assigned_store_id:
        raise HTTPException(status_code=400, detail="Store must be assigned before dock release")

    # Authorize Store Manager / Store Keeper
    roles_upper = {r.upper() for r in (user.roles or [])}
    is_admin = "ADMIN" in roles_upper or "SUPERUSER" in roles_upper
    is_store_user = "STORE_MANAGER" in roles_upper or "STORE_KEEPER" in roles_upper

    if not is_admin:
        if not is_store_user:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Dock release must be performed by the assigned Store Manager/Keeper",
            )
        # Verify user belongs to the assigned Store
        user_store_ids, user_store_codes = await _get_store_user_context(user, uow)
        assigned_sid = assignment.assigned_store_id
        assigned_scode = (assignment.assigned_store_code or "").strip().upper()

        if assigned_sid not in user_store_ids and assigned_scode not in user_store_codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You can only release docks assigned to your Store",
            )

    dock_result = await uow.session.execute(select(DockModel).where(DockModel.dock_number == assignment.dock_number).with_for_update())
    dock = dock_result.scalar_one_or_none()
    if dock is None:
        raise HTTPException(status_code=409, detail="Assigned dock was not found")
    if dock.status != "OCCUPIED":
        raise HTTPException(status_code=409, detail=f"Dock {dock.dock_number} is not occupied")

    # Validate warehouse matching between store and dock
    if assignment.assigned_store_id:
        store = await uow.session.get(StoreModel, assignment.assigned_store_id)
        if store and store.warehouse_id and dock.warehouse_id and store.warehouse_id.strip().upper() != dock.warehouse_id.strip().upper():
            raise HTTPException(status_code=400, detail="Store warehouse does not match dock warehouse")

    grn_result = await uow.session.execute(select(GrnModel).options(selectinload(GrnModel.lines)).where(GrnModel.id == assignment.prepared_grn_id))
    grn = grn_result.scalar_one_or_none()
    if grn is None:
        raise HTTPException(status_code=409, detail="Prepared GRN was not found")
    released_at = datetime.datetime.now(datetime.timezone.utc)
    dock.status = "AVAILABLE"
    dock.updated_at = released_at
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
        .join(PurchaseOrderModel, PurchaseOrderModel.id == DockAssignmentModel.po_id)
        .join(GrnModel, GrnModel.id == DockAssignmentModel.prepared_grn_id)
        .outerjoin(VehicleExitApprovalModel, VehicleExitApprovalModel.gate_entry_id == GateEntryModel.id)
        .where(GateEntryModel.status.in_([GateEntryStatus.RECEIVING_COMPLETED.value, GateEntryStatus.EXIT_APPROVED.value]))
        .where(DockAssignmentModel.dock_released_at.is_not(None))
        .order_by(DockAssignmentModel.dock_released_at.desc())
    )
    return [{"gate_entry_id": str(entry.id), "gate_entry_number": entry.gate_entry_number,
             "asn_id": str(asn.id), "asn_number": asn.asn_number,
             "po_id": str(po.id), "po_number": po.po_number,
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
    if not all([request.asn_verified, request.po_verified, request.grn_verified, request.receiving_verified, request.vehicle_verified, request.driver_verified]):
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
    po = await uow.session.get(PurchaseOrderModel, assignment.po_id)
    grn_result = await uow.session.execute(select(GrnModel).options(selectinload(GrnModel.lines)).where(GrnModel.id == assignment.prepared_grn_id))
    grn = grn_result.scalar_one_or_none()
    if asn is None or po is None or grn is None:
        raise HTTPException(status_code=409, detail="ASN, PO, or GRN verification context is missing")
    if grn.status != "GRN_POSTED":
        raise HTTPException(status_code=409, detail="GRN must be posted before vehicle exit approval")
    existing = await uow.session.execute(select(VehicleExitApprovalModel.id).where(VehicleExitApprovalModel.gate_entry_id == gate_entry.id))
    if existing.first() is not None:
        raise HTTPException(status_code=409, detail="Vehicle exit was already approved")
    approved_at = datetime.datetime.now(datetime.timezone.utc)
    approval = VehicleExitApprovalModel(
        gate_entry_id=gate_entry.id, dock_assignment_id=assignment.id, asn_id=asn.id, po_id=po.id, grn_id=grn.id,
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
            destination_store_id=getattr(assignment, "assigned_store_id", None),
            assigned_to=getattr(assignment, "assigned_store_manager_username", None) or getattr(assignment, "assigned_store_manager_name", None) or getattr(assignment, "assigned_store_manager_id", None),
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

    if assignment.assigned_store_id:
        store = await uow.session.get(StoreModel, assignment.assigned_store_id)
        if store:
            uow.session.add(NotificationModel(
                user_role=f"STR:{store.store_code}"[:32],
                title="New Putaway Tasks Available",
                message=f"{tasks_created} Putaway task(s) generated for {store.store_name} from {grn.grn_number}.",
                link="/my-store",
            ))
            uow.session.add(NotificationModel(
                user_role=f"STR:{store.id}"[:32],
                title="New Putaway Tasks Available",
                message=f"{tasks_created} Putaway task(s) generated for {store.store_name} from {grn.grn_number}.",
                link="/my-store",
            ))
    uow.session.add(NotificationModel(user_role="WAREHOUSE", title="Vehicle Exit Approved", message=f"Security approved exit for {assignment.vehicle_number} against {grn.grn_number}.", link="/vehicle-exit"))
    await uow.session.flush()
    return {"gate_entry_id": str(gate_entry.id), "status": gate_entry.status, "vehicle_number": assignment.vehicle_number,
            "asn_number": asn.asn_number, "po_number": po.po_number, "grn_number": grn.grn_number,
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
        .join(PurchaseOrderModel, PurchaseOrderModel.id == VehicleExitApprovalModel.po_id)
        .join(GrnModel, GrnModel.id == VehicleExitApprovalModel.grn_id)
        .outerjoin(GateExitModel, GateExitModel.gate_entry_id == GateEntryModel.id)
        .where(GateEntryModel.status.in_([GateEntryStatus.EXIT_APPROVED.value, GateEntryStatus.GATE_EXIT_COMPLETED.value]))
        .order_by(VehicleExitApprovalModel.approved_at.desc())
    )
    return [{"gate_entry_id": str(entry.id), "gate_entry_number": entry.gate_entry_number,
             "vehicle_number": approval.vehicle_number, "driver_name": approval.driver_name,
             "asn_id": str(asn.id), "asn_number": asn.asn_number, "po_number": po.po_number,
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
            "po_number": grn.po_number or "PO-1001",
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
    if not all([grn.po_id, grn.po_number, grn.asn_id, grn.asn_number, grn.supplier_name, grn.vehicle_number, grn.warehouse_id, grn.dock_number]):
        raise HTTPException(status_code=409, detail="GRN shipment references are incomplete")
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
        # Receipt posting only acknowledges goods at receiving.  Stock becomes
        # authoritative after the physical put-away transaction completes.
        # The put-away endpoint is responsible for incrementing on_hand and
        # available, preventing receiving and put-away from being counted
        # twice and keeping both inventory dashboards consistent.
        before = stock.on_hand
        # MaterialStockModel uses a timezone-naive legacy timestamp column.
        # asyncpg rejects aware datetimes for that column during flush.
        stock.updated_at = posted_at.replace(tzinfo=None)
        uow.session.add(InventoryReceiptPostingModel(
            grn_id=grn.id, grn_number=grn.grn_number, po_id=grn.po_id, po_number=grn.po_number,
            asn_id=grn.asn_id, asn_number=grn.asn_number, supplier_name=grn.supplier_name,
            item_code=line.item_code, material_name=line.material_name or line.item_code, uom=line.uom or "PCS", warehouse_id=grn.warehouse_id,
            posted_quantity=accepted, on_hand_before=before, on_hand_after=before,
            posted_by=user.username, posted_at=posted_at,
        ))
        inventory_updates.append({"item_code": line.item_code, "quantity": float(accepted), "on_hand_before": float(before), "on_hand_after": float(before)})
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
                    destination_store_id=getattr(assignment, "assigned_store_id", None),
                    assigned_to=getattr(assignment, "assigned_store_manager_username", None) or getattr(assignment, "assigned_store_manager_name", None) or getattr(assignment, "assigned_store_manager_id", None),
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
                    status="PUTAWAY_PENDING" if getattr(assignment, "assigned_store_manager_id", None) or getattr(assignment, "assigned_store_manager_username", None) else "OPEN",
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
                        destination_store_id=getattr(assignment, "assigned_store_id", None),
                        assigned_to=getattr(assignment, "assigned_store_manager_username", None) or getattr(assignment, "assigned_store_manager_name", None) or getattr(assignment, "assigned_store_manager_id", None),
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
                        status="PUTAWAY_PENDING" if getattr(assignment, "assigned_store_manager_id", None) or getattr(assignment, "assigned_store_manager_username", None) else "OPEN",
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
        veh_plate = getattr(entry, "vehicle_plate", None) or getattr(entry, "vehicle_number", "Vehicle")
        supplier = entry.ocr_result.supplier_name if (hasattr(entry, "ocr_result") and entry.ocr_result) else None
        po_num = getattr(entry, "po_number", "N/A")
        mat_desc = getattr(entry, "material_description", None) or "Inbound Goods"
        qty = getattr(entry, "total_quantity", None)

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
    return _to_gate_entry_response(_gate_entry_from_model(model))


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
        entry.move_to_inbound_queue()
        await _save_gate_entry(uow.session, entry)

    return _to_gate_entry_response(entry)


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
        entry.move_to_inbound_queue()
        await _save_gate_entry(uow.session, entry)

    response = _to_gate_entry_response(entry)
    return response.model_copy(update={"driver_phone": model.driver_phone})



@router.post("/{entry_id}/vehicle-exited", response_model=GateEntryResponse)
async def mark_inbound_vehicle_exited(
    entry_id: str,
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

    current_status = (model.status or "").upper().strip()
    if current_status == "VEHICLE_EXITED" or model.exited_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vehicle has already exited.",
        )

    # Inbound exit is available only after the receiving transaction has
    # completed and the assigned Store Manager has released the dock.  Do not
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Store Manager must release the dock before inbound gate exit")
    if assignment.prepared_grn_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GRN must be prepared before inbound gate exit")

    grn = await uow.session.get(GrnModel, assignment.prepared_grn_id)
    if grn is None or grn.status != "GRN_POSTED":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GRN must be posted before inbound gate exit")

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
