"""
Use Cases for Gate Entry application layer.
"""
from __future__ import annotations

from typing import Optional

from app.modules.gate.application.commands import CreateGateEntryCommand, ManualVerifyCommand
from app.modules.gate.application.exceptions import (
    DuplicateGateEntryException,
    GateEntryNotFoundException,
    InvalidStatusTransitionException,
)
from app.modules.gate.application.interfaces import AnprService, NotificationGateway, OcrService
from app.modules.gate.application.repository import GateEntryRepository, PurchaseOrderLookupRepository
from app.modules.gate.domain.aggregate import GateEntry
from app.modules.gate.domain.enums import GateEntryStatus
from app.modules.gate.domain.services import GateEntryVerificationDomainService
from app.modules.gate.domain.value_objects import GateEntryId, VehicleNumber
from app.modules.gate.infrastructure.services.file_storage import FileStorageService


class CreateGateEntryUseCase:
    def __init__(
        self,
        gate_entry_repo: GateEntryRepository,
        po_lookup_repo: PurchaseOrderLookupRepository,
        anpr_service: AnprService,
        ocr_service: OcrService,
        file_storage_service: FileStorageService,
        notification_gateway: NotificationGateway | None = None,
        verification_domain_service: GateEntryVerificationDomainService | None = None,
    ) -> None:
        self.gate_entry_repo = gate_entry_repo
        self.po_lookup_repo = po_lookup_repo
        self.anpr_service = anpr_service
        self.ocr_service = ocr_service
        self.file_storage_service = file_storage_service
        self.notification_gateway = notification_gateway
        self.verification_domain_service = verification_domain_service or GateEntryVerificationDomainService()

    async def execute(self, command: CreateGateEntryCommand) -> GateEntry:
        # 1. Validate files
        self.file_storage_service.validate_file(
            command.po_document_bytes, command.po_document_filename, command.po_document_content_type
        )
        if command.driver_photo_bytes:
            self.file_storage_service.validate_file(
                command.driver_photo_bytes,
                command.driver_photo_filename or "driver.jpg",
                command.driver_photo_content_type or "image/jpeg",
            )
        if command.vehicle_photo_bytes:
            self.file_storage_service.validate_file(
                command.vehicle_photo_bytes,
                command.vehicle_photo_filename or "vehicle.jpg",
                command.vehicle_photo_content_type or "image/jpeg",
            )

        # 2. Execute ANPR (vehicle plate recognition) and OCR (PO document extraction)
        anpr_input = command.vehicle_photo_bytes or command.vehicle_number or b"empty"
        anpr_result = await self.anpr_service.recognize_license_plate(anpr_input)
        ocr_result = await self.ocr_service.process_po_document(command.po_document_bytes)

        # Auto-populate vehicle_number, po_number, and driver_name from ANPR/OCR if not provided
        effective_vehicle_number = (
            command.vehicle_number
            or (anpr_result.detected_vehicle_number if (anpr_result and anpr_result.detected_vehicle_number) else None)
            or "UNKNOWN"
        )
        effective_po_number = (
            command.po_number
            or (ocr_result.po_number if (ocr_result and ocr_result.po_number) else None)
            or "UNKNOWN"
        )
        effective_driver_name = command.driver_name or "Driver"

        # 3. Check duplicate active entry
        vehicle = VehicleNumber(effective_vehicle_number)
        active_entry = await self.gate_entry_repo.find_active_by_po_and_vehicle(effective_po_number, vehicle)
        if active_entry is not None:
            raise DuplicateGateEntryException(effective_po_number, effective_vehicle_number)

        # 4. Save files
        po_doc_path = await self.file_storage_service.save_file(
            command.po_document_bytes, command.po_document_filename, "po_documents"
        )
        driver_photo_path: str | None = None
        if command.driver_photo_bytes:
            driver_photo_path = await self.file_storage_service.save_file(
                command.driver_photo_bytes,
                command.driver_photo_filename or "driver.jpg",
                "driver_photos",
            )
        vehicle_photo_path: str | None = None
        if command.vehicle_photo_bytes:
            vehicle_photo_path = await self.file_storage_service.save_file(
                command.vehicle_photo_bytes,
                command.vehicle_photo_filename or "vehicle.jpg",
                "vehicle_photos",
            )

        # 5. Create Gate Entry Aggregate
        gate_entry = GateEntry.create(
            po_number=effective_po_number,
            vehicle_number=effective_vehicle_number,
            driver_name=effective_driver_name,
            driver_license_number=command.driver_license_number,
            driver_phone=command.driver_phone,
            security_officer_id=command.security_officer_id,
            driver_photo_path=driver_photo_path,
            po_document_path=po_doc_path,
            vehicle_photo_path=vehicle_photo_path,
        )

        # 6. Query existing PO record from database
        target_po_num = ocr_result.po_number if (ocr_result and ocr_result.po_number) else effective_po_number
        po_details = await self.po_lookup_repo.find_po_details_by_number(target_po_num)
        if po_details is None and target_po_num != effective_po_number:
            po_details = await self.po_lookup_repo.find_po_details_by_number(effective_po_number)

        po_id = po_details.po_id if po_details else None

        # 7. Perform Domain Verification & Mismatch Detection
        verification_result = self.verification_domain_service.verify(
            vehicle_number=effective_vehicle_number,
            anpr_result=anpr_result,
            ocr_result=ocr_result,
            po_details=po_details,
        )

        # 9. Apply Verification Result to Aggregate
        gate_entry.apply_verification(
            po_id=po_id,
            anpr_result=anpr_result,
            ocr_result=ocr_result,
            verification_result=verification_result,
        )

        # 10. Persist Gate Entry & Outbox Events
        await self.gate_entry_repo.save(gate_entry)

        # 11. Send notification if ready for receiving
        if self.notification_gateway and gate_entry.status in (GateEntryStatus.PO_VERIFIED, GateEntryStatus.APPROVED):
            await self.notification_gateway.notify_ready_for_receiving(
                gate_entry_id=str(gate_entry.id),
                po_number=gate_entry.po_number,
                vehicle_number=gate_entry.vehicle_number.value,
                details={"status": gate_entry.status.value},
            )

        return gate_entry


class ManualVerifyGateEntryUseCase:
    def __init__(
        self,
        gate_entry_repo: GateEntryRepository,
        notification_gateway: NotificationGateway | None = None,
    ) -> None:
        self.gate_entry_repo = gate_entry_repo
        self.notification_gateway = notification_gateway

    async def execute(self, command: ManualVerifyCommand) -> GateEntry:
        entry_id = GateEntryId.of(command.gate_entry_id)
        entry = await self.gate_entry_repo.find_by_id(entry_id)
        if entry is None:
            raise GateEntryNotFoundException(command.gate_entry_id)

        try:
            entry.manual_verify(
                approved=command.approved,
                verified_by_user_id=command.verified_by_user_id,
                notes=command.notes,
            )
        except ValueError as exc:
            raise InvalidStatusTransitionException(entry.status.value, "manual_verify") from exc

        await self.gate_entry_repo.save(entry)

        if self.notification_gateway and entry.status == GateEntryStatus.APPROVED:
            await self.notification_gateway.notify_ready_for_receiving(
                gate_entry_id=str(entry.id),
                po_number=entry.po_number,
                vehicle_number=entry.vehicle_number.value,
                details={"status": entry.status.value, "notes": command.notes},
            )

        return entry


class GetGateEntryUseCase:
    def __init__(self, gate_entry_repo: GateEntryRepository) -> None:
        self.gate_entry_repo = gate_entry_repo

    async def execute(self, gate_entry_id: str) -> GateEntry:
        entry = await self.gate_entry_repo.find_by_id(GateEntryId.of(gate_entry_id))
        if entry is None:
            raise GateEntryNotFoundException(gate_entry_id)
        return entry


class ListGateEntriesUseCase:
    def __init__(self, gate_entry_repo: GateEntryRepository) -> None:
        self.gate_entry_repo = gate_entry_repo

    async def execute(
        self,
        status: GateEntryStatus | None = None,
        po_number: str | None = None,
        vehicle_number: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[GateEntry]:
        return await self.gate_entry_repo.list_entries(
            status=status,
            po_number=po_number,
            vehicle_number=vehicle_number,
            limit=limit,
            offset=offset,
        )
