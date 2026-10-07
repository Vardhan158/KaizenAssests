"""
SQLAlchemy Repository Implementation for Gate Entry module.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.events.outbox_repository import to_outbox_row
from app.modules.gate.application.repository import GateEntryRepository, PurchaseOrderLookupRepository
from app.modules.gate.domain.aggregate import AuditLogEntry, GateEntry
from app.modules.gate.domain.enums import GateEntryStatus, MismatchField, VerificationResultType
from app.modules.gate.domain.services import PurchaseOrderDetails
from app.modules.gate.domain.value_objects import (
    AnprResult,
    DriverInfo,
    GateEntryId,
    OcrResult,
    VehicleNumber,
    VerificationResult,
)
from app.modules.gate.infrastructure.persistence.models import GateEntryAuditLogModel, GateEntryModel


class SqlAlchemyGateEntryRepository(GateEntryRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(self, gate_entry: GateEntry) -> None:
        # Check if entity already exists in session/db
        result = await self._session.execute(
            select(GateEntryModel)
            .options(selectinload(GateEntryModel.audit_logs))
            .where(GateEntryModel.id == gate_entry.id.value)
        )
        entity = result.scalar_one_or_none()

        mismatched_str = [m.value for m in gate_entry.mismatched_fields]
        reasons_list = gate_entry.verification_result.reasons if gate_entry.verification_result else []
        v_type = gate_entry.verification_result.verification_type.value if gate_entry.verification_result else None

        anpr_detected = gate_entry.anpr_result.detected_vehicle_number if gate_entry.anpr_result else None
        anpr_conf = Decimal(str(gate_entry.anpr_result.confidence)) if gate_entry.anpr_result else None
        anpr_meta = gate_entry.anpr_result.raw_metadata if gate_entry.anpr_result else None

        ocr_po = gate_entry.ocr_result.po_number if gate_entry.ocr_result else None
        ocr_supp = gate_entry.ocr_result.supplier_name if gate_entry.ocr_result else None
        ocr_prod = gate_entry.ocr_result.product_material if gate_entry.ocr_result else None
        ocr_qty = gate_entry.ocr_result.quantity if gate_entry.ocr_result else None
        ocr_po_date_str = str(gate_entry.ocr_result.po_date) if (gate_entry.ocr_result and gate_entry.ocr_result.po_date) else None
        ocr_deliv_date_str = (
            str(gate_entry.ocr_result.expected_delivery_date)
            if (gate_entry.ocr_result and gate_entry.ocr_result.expected_delivery_date)
            else None
        )
        ocr_conf = Decimal(str(gate_entry.ocr_result.confidence)) if gate_entry.ocr_result else None
        ocr_raw = gate_entry.ocr_result.raw_text if gate_entry.ocr_result else None

        po_uuid = uuid.UUID(gate_entry.po_id) if gate_entry.po_id else None

        if entity is None:
            entity = GateEntryModel(
                id=gate_entry.id.value,
                po_id=po_uuid,
                po_number=gate_entry.po_number,
                vehicle_number=gate_entry.vehicle_number.value,
                driver_name=gate_entry.driver_info.driver_name,
                driver_license_number=gate_entry.driver_info.driver_license_number,
                driver_phone=gate_entry.driver_info.driver_phone,
                driver_photo_path=gate_entry.driver_photo_path,
                po_document_path=gate_entry.po_document_path,
                vehicle_photo_path=gate_entry.vehicle_photo_path,
                status=gate_entry.status.value,
                verification_type=v_type,
                mismatched_fields=mismatched_str,
                reasons=reasons_list,
                anpr_detected_vehicle=anpr_detected,
                anpr_confidence=anpr_conf,
                anpr_metadata=anpr_meta,
                ocr_po_number=ocr_po,
                ocr_supplier_name=ocr_supp,
                ocr_product_material=ocr_prod,
                ocr_quantity=ocr_qty,
                ocr_po_date=ocr_po_date_str,
                ocr_expected_delivery_date=ocr_deliv_date_str,
                ocr_confidence=ocr_conf,
                ocr_raw_text=ocr_raw,
                security_officer_id=gate_entry.security_officer_id,
                verified_by_user_id=gate_entry.verified_by_user_id,
                manual_verification_notes=gate_entry.manual_verification_notes,
                created_at=gate_entry.created_at,
                updated_at=gate_entry.updated_at,
            )
            self._session.add(entity)
        else:
            entity.po_id = po_uuid
            entity.vehicle_photo_path = gate_entry.vehicle_photo_path
            entity.status = gate_entry.status.value
            entity.verification_type = v_type
            entity.mismatched_fields = mismatched_str
            entity.reasons = reasons_list
            entity.anpr_detected_vehicle = anpr_detected
            entity.anpr_confidence = anpr_conf
            entity.anpr_metadata = anpr_meta
            entity.ocr_po_number = ocr_po
            entity.ocr_supplier_name = ocr_supp
            entity.ocr_product_material = ocr_prod
            entity.ocr_quantity = ocr_qty
            entity.ocr_po_date = ocr_po_date_str
            entity.ocr_expected_delivery_date = ocr_deliv_date_str
            entity.ocr_confidence = ocr_conf
            entity.ocr_raw_text = ocr_raw
            entity.verified_by_user_id = gate_entry.verified_by_user_id
            entity.manual_verification_notes = gate_entry.manual_verification_notes
            entity.updated_at = gate_entry.updated_at

        # Save audit logs
        existing_log_ids = {l.id for l in entity.audit_logs}
        for log in gate_entry.audit_logs:
            if log.id not in existing_log_ids:
                log_entity = GateEntryAuditLogModel(
                    id=log.id,
                    gate_entry_id=gate_entry.id.value,
                    action=log.action,
                    performed_by=log.performed_by,
                    timestamp=log.timestamp,
                    details=log.details,
                )
                self._session.add(log_entity)

        # Write domain events to outbox within same transaction
        for event in gate_entry.domain_events:
            self._session.add(to_outbox_row("GateEntry", str(gate_entry.id), event))

        gate_entry.clear_domain_events()
        await self._session.flush()

    async def find_by_id(self, gate_entry_id: GateEntryId) -> Optional[GateEntry]:
        result = await self._session.execute(
            select(GateEntryModel)
            .options(selectinload(GateEntryModel.audit_logs))
            .where(GateEntryModel.id == gate_entry_id.value)
        )
        entity = result.scalar_one_or_none()
        if entity is None:
            return None
        return self._to_domain(entity)

    async def find_active_by_po_and_vehicle(
        self, po_number: str, vehicle_number: VehicleNumber
    ) -> Optional[GateEntry]:
        active_statuses = [
            GateEntryStatus.PENDING_VERIFICATION.value,
            GateEntryStatus.PO_VERIFIED.value,
            GateEntryStatus.MANUAL_VERIFICATION_REQUIRED.value,
            GateEntryStatus.APPROVED.value,
        ]
        result = await self._session.execute(
            select(GateEntryModel)
            .options(selectinload(GateEntryModel.audit_logs))
            .where(
                GateEntryModel.po_number == po_number,
                GateEntryModel.vehicle_number == vehicle_number.value,
                GateEntryModel.status.in_(active_statuses),
            )
        )
        entity = result.scalar_one_or_none()
        if entity is None:
            return None
        return self._to_domain(entity)

    async def list_entries(
        self,
        status: GateEntryStatus | None = None,
        po_number: str | None = None,
        vehicle_number: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[GateEntry]:
        stmt = select(GateEntryModel).options(selectinload(GateEntryModel.audit_logs))
        if status:
            stmt = stmt.where(GateEntryModel.status == status.value)
        if po_number:
            stmt = stmt.where(GateEntryModel.po_number == po_number)
        if vehicle_number:
            stmt = stmt.where(GateEntryModel.vehicle_number == vehicle_number)

        stmt = stmt.order_by(GateEntryModel.created_at.desc()).offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        entities = result.scalars().all()
        return [self._to_domain(e) for e in entities]

    def _to_domain(self, entity: GateEntryModel) -> GateEntry:
        anpr_res = None
        if entity.anpr_detected_vehicle:
            anpr_res = AnprResult(
                detected_vehicle_number=entity.anpr_detected_vehicle,
                confidence=float(entity.anpr_confidence) if entity.anpr_confidence is not None else 0.0,
                raw_metadata=entity.anpr_metadata or {},
            )

        ocr_res = None
        if entity.ocr_po_number or entity.ocr_raw_text:
            po_d = date.fromisoformat(entity.ocr_po_date) if entity.ocr_po_date else None
            exp_d = date.fromisoformat(entity.ocr_expected_delivery_date) if entity.ocr_expected_delivery_date else None
            ocr_res = OcrResult(
                po_number=entity.ocr_po_number,
                supplier_name=entity.ocr_supplier_name,
                product_material=entity.ocr_product_material,
                quantity=entity.ocr_quantity,
                po_date=po_d,
                expected_delivery_date=exp_d,
                confidence=float(entity.ocr_confidence) if entity.ocr_confidence is not None else 1.0,
                raw_text=entity.ocr_raw_text or "",
            )

        mismatched_enums = []
        if isinstance(entity.mismatched_fields, list):
            for m in entity.mismatched_fields:
                try:
                    mismatched_enums.append(MismatchField(m))
                except ValueError:
                    pass

        raw_status = entity.status.strip().upper().replace(" ", "_") if entity.status else "PENDING_VERIFICATION"
        try:
            parsed_status = GateEntryStatus(raw_status)
        except ValueError:
            parsed_status = getattr(GateEntryStatus, raw_status, GateEntryStatus.PENDING_VERIFICATION)

        v_res = None
        if entity.verification_type:
            try:
                v_type = VerificationResultType(entity.verification_type)
            except ValueError:
                v_type = VerificationResultType.MISMATCHED
            v_res = VerificationResult(
                status=parsed_status,
                verification_type=v_type,
                mismatched_fields=mismatched_enums,
                reasons=entity.reasons if isinstance(entity.reasons, list) else [],
            )

        entry = GateEntry(
            id=GateEntryId.of(entity.id),
            po_id=str(entity.po_id) if entity.po_id else None,
            po_number=entity.po_number,
            vehicle_number=VehicleNumber(entity.vehicle_number),
            driver_info=DriverInfo(
                driver_name=entity.driver_name,
                driver_license_number=entity.driver_license_number,
                driver_phone=entity.driver_phone,
            ),
            security_officer_id=entity.security_officer_id,
            driver_photo_path=entity.driver_photo_path,
            po_document_path=entity.po_document_path,
            vehicle_photo_path=entity.vehicle_photo_path,
            status=parsed_status,
            anpr_result=anpr_res,
            ocr_result=ocr_res,
            verification_result=v_res,
            mismatched_fields=mismatched_enums,
            verified_by_user_id=entity.verified_by_user_id,
            manual_verification_notes=entity.manual_verification_notes,
            created_at=entity.created_at,
            updated_at=entity.updated_at,
        )

        for log_entity in entity.audit_logs:
            entry.audit_logs.append(
                AuditLogEntry(
                    id=log_entity.id,
                    action=log_entity.action,
                    performed_by=log_entity.performed_by,
                    timestamp=log_entity.timestamp,
                    details=log_entity.details or {},
                )
            )

        return entry


class SqlAlchemyPurchaseOrderLookupRepository(PurchaseOrderLookupRepository):
    """
    Looks up Purchase Orders from the existing project `purchase_order` database table.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def find_po_details_by_number(self, po_number: str) -> Optional[PurchaseOrderDetails]:
        # Purchase Order module has been removed.
        # Returning a generic object so gate entry can proceed with manual verification if needed,
        # or returning None if we want to force UNSCHEDULED status.
        # Given the previous requirement to remove PO completely, we'll return a stub.
        return PurchaseOrderDetails(
            po_id=str(uuid.uuid4()),
            po_number=po_number,
            supplier_name="Manual Entry",
            product_material="General Cargo",
            total_quantity=Decimal("0"),
            po_date=date.today(),
            expected_delivery_date=date.today(),
        )
