from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional
import json
import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.dock.domain.enums import (
    AllocationAction,
    AllocationStatus,
    DockStatus,
)
from app.modules.dock.infrastructure.persistence.models import (
    DockAllocationHistoryModel,
    DockAllocationRequestModel,
    DockMasterModel,
    DockStatusHistoryModel,
)
from app.common.persistence.models import NotificationModel


class DockAllocationService:

    @staticmethod
    async def seed_default_docks_if_empty(session: AsyncSession) -> None:
        """No automatic dock seeding; docks are created through the Dock Management UI."""
        return None

    @staticmethod
    async def sync_pending_gate_entries(session: AsyncSession) -> None:
        """Backfill only explicitly approved persisted gate entries through the normal notification path."""
        from app.modules.gate.infrastructure.persistence.models import GateEntryModel
        entries = (await session.execute(
            select(GateEntryModel).where(
                GateEntryModel.assigned_dock_id.is_(None),
                GateEntryModel.status.in_(["PO_VERIFIED", "APPROVED", "GATE_ENTRY_APPROVED", "AWAITING_DOCK"]),
            )
        )).scalars().all()
        for entry in entries:
            if not entry.vehicle_number:
                continue
            await DockAllocationService.auto_create_allocation_request(
                session=session,
                gate_pass_id=entry.gate_entry_number or str(entry.id),
                vehicle_number=entry.vehicle_number,
                vendor_reference=entry.ocr_supplier_name,
                material_reference=entry.ocr_product_material,
                material_description=entry.ocr_product_material,
                quantity=entry.ocr_quantity if entry.ocr_quantity is not None else 0,
            )
        await session.flush()

    @staticmethod
    async def get_overview_metrics(session: AsyncSession) -> dict:
        await DockAllocationService.sync_pending_gate_entries(session)
        from app.modules.gate.infrastructure.persistence.models import DockModel
        docks_result = await session.execute(select(DockMasterModel).where(DockMasterModel.is_active == True))
        docks = docks_result.scalars().all()
        receiving_docks_result = await session.execute(select(DockModel))
        receiving_status = {
            dock.dock_number.upper(): dock.status
            for dock in receiving_docks_result.scalars().all()
        }
        dock_ids = [dock.id for dock in docks]
        active_allocations = await DockAllocationService.get_active_allocations_for_docks(session, dock_ids)

        pending_result = await session.execute(
            select(func.count(DockAllocationRequestModel.id)).where(
                DockAllocationRequestModel.status.in_(["PENDING", "PENDING_ALLOCATION", "AWAITING_DOCK"])
            )
        )
        pending_count = pending_result.scalar() or 0

        return {
            "total_docks": len(docks),
            "available_docks": sum(
                1 for d in docks
                if d.status == DockStatus.AVAILABLE.value
                and receiving_status.get(d.dock_code.upper(), DockStatus.AVAILABLE.value) == DockStatus.AVAILABLE.value
                and d.id not in active_allocations
            ),
            "occupied_docks": sum(
                1 for d in docks
                if d.status == DockStatus.OCCUPIED.value
                or receiving_status.get(d.dock_code.upper()) == DockStatus.OCCUPIED.value
                or d.id in active_allocations
            ),
            "reserved_docks": sum(1 for d in docks if d.status in [DockStatus.RESERVED.value, "DOCK_ASSIGNED"]),
            "maintenance_docks": sum(1 for d in docks if d.status == DockStatus.MAINTENANCE.value),
            "pending_allocations_count": pending_count,
        }

    @staticmethod
    async def list_docks(
        session: AsyncSession,
        dock_type: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[DockMasterModel]:
        query = select(DockMasterModel).where(DockMasterModel.is_active == True)
        if dock_type and isinstance(dock_type, str) and dock_type.strip().upper() != "ALL":
            query = query.where(DockMasterModel.dock_type == dock_type.strip().upper())
        if status and isinstance(status, str) and status.strip().upper() != "ALL":
            query = query.where(DockMasterModel.status == status.strip().upper())
        query = query.order_by(DockMasterModel.dock_code)
        result = await session.execute(query)
        docks = list(result.scalars().all())
        if status and status.strip().upper() == DockStatus.AVAILABLE.value:
            active_allocations = await DockAllocationService.get_active_allocations_for_docks(session, [dock.id for dock in docks])
            return [dock for dock in docks if dock.id not in active_allocations]
        return docks

    @staticmethod
    async def get_active_allocations_for_docks(
        session: AsyncSession, dock_ids: List[uuid.UUID]
    ) -> dict[uuid.UUID, DockAllocationRequestModel]:
        from sqlalchemy import desc
        if not dock_ids:
            return {}
        query = (
            select(DockAllocationRequestModel)
            .where(
                DockAllocationRequestModel.assigned_dock_id.in_(dock_ids),
                DockAllocationRequestModel.status.in_(["DOCK_ASSIGNED", "RESERVED", "OCCUPIED", "AT_DOCK"])
            )
            .order_by(desc(DockAllocationRequestModel.created_at))
        )
        res = await session.execute(query)
        reqs = res.scalars().all()
        mapping = {}
        for r in reqs:
            if r.assigned_dock_id and r.assigned_dock_id not in mapping:
                mapping[r.assigned_dock_id] = r
        return mapping

    @staticmethod
    async def auto_create_allocation_request(
        session: AsyncSession,
        gate_pass_id: str,
        vehicle_number: str,
        vendor_reference: Optional[str] = None,
        material_reference: Optional[str] = None,
        material_description: Optional[str] = None,
        quantity: Optional[Decimal] = None,
        priority: str = "NORMAL",
    ) -> DockAllocationRequestModel:
        """Idempotent auto-creation of a Dock Allocation Request when Security approves a Gate Pass."""
        existing = await session.execute(
            select(DockAllocationRequestModel).where(
                DockAllocationRequestModel.existing_gate_pass_id == gate_pass_id
            )
        )
        found = existing.scalars().first()
        if found:
            return found

        request_model = DockAllocationRequestModel(
            existing_gate_pass_id=gate_pass_id,
            vehicle_number=vehicle_number,
            vendor_reference=vendor_reference,
            material_reference=material_reference,
            material_description=material_description,
            quantity=Decimal(str(quantity)) if quantity is not None else None,
            security_approved_at=datetime.now(timezone.utc),
            priority=priority.upper(),
            status="AWAITING_DOCK",
        )
        session.add(request_model)
        await session.flush()

        # Log history
        hist = DockAllocationHistoryModel(
            allocation_request_id=request_model.id,
            action=AllocationAction.REQUESTED.value,
            previous_status=None,
            new_status="AWAITING_DOCK",
            performed_by="SECURITY_SYSTEM",
            performed_at=datetime.now(timezone.utc),
            remarks=f"Automatic request triggered upon Security approval of Gate Pass {gate_pass_id}",
        )
        session.add(hist)
        session.add(NotificationModel(
            user_role="WAREHOUSE",
            title="Truck waiting for dock",
            message=f"Approved gate entry {gate_pass_id} for vehicle {vehicle_number} is waiting for dock allocation.",
            link=f"/inventory?tab=locations&gateEntry={gate_pass_id}",
            notification_type="GATE_DOCK_REQUEST",
            payload_json=json.dumps({"gate_pass_id": gate_pass_id, "vehicle_number": vehicle_number}),
        ))
        await session.flush()
        return request_model

    @staticmethod
    async def _sync_gate_entry_status(
        session: AsyncSession,
        gate_pass_id: str,
        vehicle_number: str,
        new_status: str,
        dock_code: Optional[str] = None,
    ) -> None:
        """Safely sync status to GateEntryModel without UUID type conversion errors."""
        try:
            from app.modules.gate.infrastructure.persistence.models import GateEntryModel
            from sqlalchemy import or_

            conds = [
                GateEntryModel.gate_entry_number == gate_pass_id,
                GateEntryModel.vehicle_number == vehicle_number,
            ]
            try:
                parsed_uuid = uuid.UUID(gate_pass_id)
                conds.append(GateEntryModel.id == parsed_uuid)
            except (ValueError, TypeError, AttributeError):
                pass

            stmt = select(GateEntryModel).where(or_(*conds))
            ge_res = await session.execute(stmt)
            ge_list = ge_res.scalars().all()
            for ge in ge_list:
                ge.status = new_status
                if dock_code:
                    ge.assigned_dock_id = dock_code
        except Exception:
            pass

    @staticmethod
    async def _sync_warehouse_dock_status(
        session: AsyncSession,
        dock_code: str,
        new_status: str,
    ) -> None:
        """Safely sync status to DockModel (warehouse_dock)."""
        try:
            from app.modules.gate.infrastructure.persistence.models import DockModel
            stmt = select(DockModel).where(
                or_(
                    DockModel.dock_number == dock_code,
                    func.upper(DockModel.dock_number) == dock_code.upper(),
                )
            )
            res = await session.execute(stmt)
            wh_dock = res.scalars().first()
            if wh_dock:
                wh_dock.status = new_status
                wh_dock.updated_at = datetime.now(timezone.utc)
        except Exception:
            pass

    @staticmethod
    async def allocate_dock(
        session: AsyncSession,
        allocation_request_id: uuid.UUID,
        dock_id: uuid.UUID,
        allocated_by: str,
        assigned_warehouse_ref_id: Optional[uuid.UUID] = None,
        warehouse_operator_id: Optional[str] = None,
        warehouse_operator_username: Optional[str] = None,
        warehouse_operator_name: Optional[str] = None,
    ) -> DockAllocationRequestModel:
        """Allocate dock with strict backend pessimistic concurrency lock (AVAILABLE -> RESERVED / DOCK_ASSIGNED)."""
        # 1. Lock Dock with pessimistic FOR UPDATE
        dock_query = await session.execute(
            select(DockMasterModel).where(DockMasterModel.id == dock_id).with_for_update()
        )
        dock = dock_query.scalar_one_or_none()
        if not dock:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected dock does not exist")

        if dock.status == DockStatus.MAINTENANCE.value:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This dock is currently under maintenance and cannot be allocated.",
            )

        if dock.status != DockStatus.AVAILABLE.value:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This dock is no longer available.\n\nAnother user has already allocated this dock.\n\nPlease select another available dock.",
            )

        from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel
        # Warehouse assignment is optional. If the dock is already tied to a
        # warehouse, use that relationship; otherwise allocate the dock
        # without requiring a warehouse or warehouse operator from the UI.
        assigned_warehouse = await session.scalar(select(WarehouseModel).where(WarehouseModel.status == "ACTIVE"))
        if assigned_warehouse_ref_id and (not assigned_warehouse or assigned_warehouse_ref_id != assigned_warehouse.id):
            raise HTTPException(status_code=422, detail="The allocation must use the configured warehouse")
        if assigned_warehouse and (assigned_warehouse.status or "").upper() != "ACTIVE":
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Selected warehouse is not active or available")
        if dock.warehouse_ref_id and assigned_warehouse and dock.warehouse_ref_id != assigned_warehouse.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Selected dock is permanently assigned to another warehouse")

        # 2. Lock Allocation Request
        req_query = await session.execute(
            select(DockAllocationRequestModel)
            .where(DockAllocationRequestModel.id == allocation_request_id)
            .with_for_update()
        )
        req = req_query.scalar_one_or_none()
        if not req:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allocation request not found")

        if req.status not in ["PENDING", "PENDING_ALLOCATION", "AWAITING_DOCK"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Allocation request is already in status '{req.status}'",
            )

        # 3. Perform Allocation (AWAITING_DOCK -> DOCK_ASSIGNED)
        previous_dock_status = dock.status
        previous_req_status = req.status

        req.assigned_dock_id = dock_id
        req.assigned_by = allocated_by
        req.assigned_at = datetime.now(timezone.utc)
        req.status = "DOCK_ASSIGNED"

        req.assigned_warehouse_ref_id = assigned_warehouse.id if assigned_warehouse else None
        req.assigned_warehouse_code = assigned_warehouse.warehouse_code if assigned_warehouse else None
        req.assigned_warehouse_name = assigned_warehouse.warehouse_name if assigned_warehouse else None

        # Resolve and assign Warehouse Operator
        if warehouse_operator_id or warehouse_operator_username or warehouse_operator_name:
            req.assigned_warehouse_operator_id = str(warehouse_operator_id) if warehouse_operator_id else None
            req.assigned_warehouse_operator_username = str(warehouse_operator_username) if warehouse_operator_username else None
            req.assigned_warehouse_operator_name = str(warehouse_operator_name) if warehouse_operator_name else str(warehouse_operator_username or warehouse_operator_id)
            try:
                from app.modules.warehouse.infrastructure.persistence.models import UserAccountModel, WarehouseModel
                filter_conds = []
                if warehouse_operator_id:
                    filter_conds.append(UserAccountModel.employee_id == str(warehouse_operator_id))
                if warehouse_operator_username:
                    filter_conds.append(UserAccountModel.username == str(warehouse_operator_username))
                if warehouse_operator_name:
                    filter_conds.append(func.lower(UserAccountModel.full_name) == str(warehouse_operator_name).lower())

                if filter_conds:
                    sm_stmt = select(UserAccountModel).where(or_(*filter_conds))
                    sm_res = await session.execute(sm_stmt)
                    sm_user = sm_res.scalars().first()
                    if sm_user:
                        req.assigned_warehouse_operator_id = sm_user.employee_id
                        req.assigned_warehouse_operator_username = sm_user.username
                        req.assigned_warehouse_operator_name = sm_user.full_name
                        if sm_user.warehouse_ref_id and not req.assigned_warehouse_ref_id:
                            req.assigned_warehouse_ref_id = sm_user.warehouse_ref_id
                            st_obj = await session.get(WarehouseModel, sm_user.warehouse_ref_id)
                            if st_obj:
                                req.assigned_warehouse_code = st_obj.warehouse_code
                                req.assigned_warehouse_name = st_obj.warehouse_name
            except Exception:
                pass
        elif not req.assigned_warehouse_operator_id and req.assigned_warehouse_ref_id:
            try:
                from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel, UserAccountModel
                st_obj = await session.get(WarehouseModel, req.assigned_warehouse_ref_id)
                if st_obj and st_obj.warehouse_operator_id:
                    req.assigned_warehouse_operator_id = st_obj.warehouse_operator_id
                    req.assigned_warehouse_operator_name = st_obj.warehouse_operator_name
                    sm_res = await session.execute(
                        select(UserAccountModel.username).where(UserAccountModel.employee_id == st_obj.warehouse_operator_id)
                    )
                    sm_u = sm_res.scalar_one_or_none()
                    if sm_u:
                        req.assigned_warehouse_operator_username = sm_u
            except Exception:
                pass

        dock.status = DockStatus.OCCUPIED.value
        await DockAllocationService._sync_warehouse_dock_status(session, dock.dock_code, "OCCUPIED")

        # Update GateEntryModel and DockAssignmentModel
        from app.modules.gate.infrastructure.persistence.models import GateEntryModel, DockAssignmentModel, DockModel
        gate_entry = None
        try:
            gate_entry = await session.get(GateEntryModel, uuid.UUID(req.existing_gate_pass_id), with_for_update=True)
        except (ValueError, TypeError):
            pass
        if gate_entry is None:
            gate_entry = (await session.execute(
                select(GateEntryModel).where(GateEntryModel.gate_entry_number == req.existing_gate_pass_id).with_for_update()
            )).scalar_one_or_none()
        if gate_entry is None:
            # Security can request a dock before the gate-entry record is
            # persisted. Keep the warehouse allocation as a reservation and
            # let the later gate-entry flow link it to the vehicle.
            dock.status = DockStatus.RESERVED.value
            await DockAllocationService._sync_warehouse_dock_status(
                session, dock.dock_code, DockStatus.RESERVED.value
            )
            return req
        if gate_entry.vehicle_number != req.vehicle_number:
            raise HTTPException(status_code=409, detail="Gate entry vehicle does not match the dock request")
        gate_entry.status = "DOCK_ASSIGNED"
        gate_entry.assigned_dock_id = dock.dock_code

        gate_dock = (await session.execute(
            select(DockModel).where(DockModel.dock_number == dock.dock_code).with_for_update()
        )).scalar_one_or_none()
        if gate_dock is None:
            # Older warehouse rows may not have a warehouse value, and some docks
            # are intentionally not tied to a warehouse. Keep gate receiving
            # functional by using the application's default warehouse.
            warehouse_id = (
                getattr(assigned_warehouse, "warehouse_id", None)
                or getattr(dock, "warehouse_id", None)
                or "Main Warehouse"
            )
            gate_dock = DockModel(
                dock_number=dock.dock_code,
                warehouse_id=warehouse_id,
                dock_type=dock.dock_type,
                capacity=1,
                status=DockStatus.OCCUPIED.value,
            )
            session.add(gate_dock)
            await session.flush()
        elif gate_dock.status != DockStatus.AVAILABLE.value:
            # A dock can be released through the warehouse workflow while an
            # older gate-side row still has OCCUPIED status. Reconcile that
            # stale flag only when no active, unreleased gate assignment
            # exists; never bypass a real active allocation.
            from app.modules.gate.infrastructure.persistence.models import DockAssignmentModel
            active_assignment = await session.execute(
                select(DockAssignmentModel.id)
                .join(GateEntryModel, DockAssignmentModel.gate_entry_id == GateEntryModel.id)
                .where(
                    DockAssignmentModel.dock_number == dock.dock_code,
                    DockAssignmentModel.dock_released_at.is_(None),
                    GateEntryModel.status.notin_(["RELEASED", "EXITED", "CANCELLED"]),
                )
                .limit(1)
            )
            if active_assignment.scalar_one_or_none() is not None:
                raise HTTPException(status_code=409, detail=f"Gate receiving dock {dock.dock_code} is not available")
            gate_dock.status = DockStatus.AVAILABLE.value
            gate_dock.updated_at = datetime.now(timezone.utc)
        gate_dock.status = DockStatus.OCCUPIED.value
        existing_assignment = (await session.execute(
            select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == gate_entry.id).with_for_update()
        )).scalar_one_or_none()
        if existing_assignment:
            raise HTTPException(status_code=409, detail="A dock assignment already exists for this gate entry")
        session.add(DockAssignmentModel(
            gate_entry_id=gate_entry.id,
            asn_id=gate_entry.asn_id,
            po_id=gate_entry.po_id,
            vehicle_number=gate_entry.vehicle_number,
            dock_number=dock.dock_code,
            assigned_warehouse_ref_id=assigned_warehouse.id if assigned_warehouse else None,
            assigned_warehouse_code=assigned_warehouse.warehouse_code if assigned_warehouse else None,
            assigned_warehouse_name=assigned_warehouse.warehouse_name if assigned_warehouse else None,
            assigned_warehouse_operator_id=req.assigned_warehouse_operator_id,
            assigned_warehouse_operator_username=req.assigned_warehouse_operator_username,
            assigned_warehouse_operator_name=req.assigned_warehouse_operator_name,
            assigned_by=allocated_by,
            assigned_at=req.assigned_at,
        ))

        # History logs
        hist = DockAllocationHistoryModel(
            allocation_request_id=req.id,
            dock_id=dock_id,
            action=AllocationAction.ALLOCATED.value,
            previous_status=previous_req_status,
            new_status="DOCK_ASSIGNED",
            performed_by=allocated_by,
            performed_at=datetime.now(timezone.utc),
            remarks=f"Allocated Dock {dock.dock_code} (Status updated to DOCK_ASSIGNED)",
        )
        session.add(hist)

        dock_hist = DockStatusHistoryModel(
            dock_id=dock_id,
            previous_status=previous_dock_status,
            new_status=DockStatus.OCCUPIED.value,
            reason=f"Allocated to Gate Pass {req.existing_gate_pass_id} (DOCK_ASSIGNED)",
            changed_by=allocated_by,
            changed_at=datetime.now(timezone.utc),
        )
        session.add(dock_hist)

        driver_name = None
        driver_phone = None
        asn_number = None
        po_number = req.material_reference

        # Fetch Gate Entry for additional details (driver, ASN, PO)
        try:
            from app.modules.gate.infrastructure.persistence.models import GateEntryModel
            from app.common.persistence.models import AsnModel
            from sqlalchemy import or_

            ge_res = await session.execute(
                select(GateEntryModel).where(
                    or_(
                        GateEntryModel.gate_entry_number == req.existing_gate_pass_id,
                        GateEntryModel.vehicle_number == req.vehicle_number,
                    )
                )
            )
            ge = ge_res.scalars().first()
            if ge:
                driver_name = ge.driver_name
                driver_phone = ge.driver_phone
                if ge.po_number:
                    po_number = ge.po_number
                if ge.asn_id:
                    asn_res = await session.execute(select(AsnModel).where(AsnModel.id == ge.asn_id))
                    asn_obj = asn_res.scalar_one_or_none()
                    if asn_obj:
                        asn_number = asn_obj.asn_number
                        if not po_number and asn_obj.po_number:
                            po_number = asn_obj.po_number
                        if not driver_name and asn_obj.driver_name:
                            driver_name = asn_obj.driver_name
                        if not driver_phone and asn_obj.driver_contact:
                            driver_phone = asn_obj.driver_contact
                try:
                    from app.modules.gate.infrastructure.persistence.models import DockAssignmentModel
                    da_res = await session.execute(
                        select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == ge.id)
                    )
                    da = da_res.scalar_one_or_none()
                    if da and da.assigned_warehouse_ref_id:
                        req.assigned_warehouse_ref_id = da.assigned_warehouse_ref_id
                        req.assigned_warehouse_code = da.assigned_warehouse_code
                        req.assigned_warehouse_name = da.assigned_warehouse_name
                except Exception:
                    pass
        except Exception:
            pass

        material_text = req.material_reference or req.material_description
        notif_msg = f"Dock {dock.dock_code} has been assigned to vehicle {req.vehicle_number}."
        if material_text:
            notif_msg = f"{notif_msg[:-1]} for material {material_text}."
        
        # Notification to GRN Module / Receiving
        session.add(
            NotificationModel(
                user_role="GRN",
                title="Dock Allocated — Ready for GRN",
                message=f"Dock {dock.dock_code} allocated for vehicle {req.vehicle_number} (Gate Pass {req.existing_gate_pass_id}). Inbound goods are ready for receiving and GRN creation.",
                link=f"/grn?tab=wizard&gatePassId={req.existing_gate_pass_id}&dock={dock.dock_code}",
            )
        )

        # Notification to Warehouse Module
        session.add(
            NotificationModel(
                user_role="WAREHOUSE",
                title="DOCK ALLOCATED",
                message=notif_msg,
                link=f"/dock-management?requestId={req.id}",
            )
        )

        session.add(
            NotificationModel(
                user_role="GATE_SECURITY",
                title="Dock available for vehicle",
                message=f"Dock {dock.dock_code} is allocated to vehicle {req.vehicle_number} (Gate Pass {req.existing_gate_pass_id}). Send the vehicle to the assigned dock.",
                link="/vehicle-queue",
            )
        )

        # Mandatory Notification to Quality Inspector
        session.add(
            NotificationModel(
                user_role="QUALITY_INSPECTOR",
                title="DOCK ALLOCATED",
                message=notif_msg,
                link=f"/dock-management?requestId={req.id}",
            )
        )

        if not asn_number:
            try:
                from app.common.persistence.models import AsnModel
                asn_res = await session.execute(
                    select(AsnModel).where(AsnModel.vehicle_number == req.vehicle_number).order_by(AsnModel.created_at.desc())
                )
                asn_obj = asn_res.scalars().first()
                if asn_obj:
                    asn_number = asn_obj.asn_number
                    if not po_number and asn_obj.po_number:
                        po_number = asn_obj.po_number
                    if not driver_name and asn_obj.driver_name:
                        driver_name = asn_obj.driver_name
                    if not driver_phone and asn_obj.driver_contact:
                        driver_phone = asn_obj.driver_contact
            except Exception:
                pass

        alloc_time = req.assigned_at or datetime.now(timezone.utc)
        alloc_time_str = alloc_time.strftime("%d-%b-%Y %I:%M %p")
        location_str = dock.location
        warehouse_str = req.assigned_warehouse_name

        details = [
            f"Gate Pass: {req.existing_gate_pass_id}", f"Vehicle: {req.vehicle_number}",
            f"Dock Code: {dock.dock_code}", f"Dock Name: {dock.dock_name}",
            f"Dock Type: {dock.dock_type}", f"Allocated At: {alloc_time_str}",
        ]
        details.extend(f"{label}: {value}" for label, value in (
            ("Driver", driver_name), ("Driver Phone", driver_phone), ("ASN", asn_number),
            ("PO", po_number), ("Location", location_str), ("Assigned Warehouse", warehouse_str),
        ) if value)
        notif_msg = "DOCK ALLOCATION CONFIRMED\n" + "\n".join(details) + f"\nProceed to Dock {dock.dock_code}."

        try:
            for role in ["WAREHOUSE", "WAREHOUSE_OPERATOR", "QUALITY_INSPECTOR"]:
                session.add(
                    NotificationModel(
                        user_role=role,
                        title="DOCK ALLOCATION CONFIRMED",
                        message=notif_msg,
                        link=f"/dock-management?requestId={req.id}",
                        dock_code=dock.dock_code,
                        dock_name=dock.dock_name,
                        dock_location=location_str,
                        dock_type=dock.dock_type,
                        warehouse_name=warehouse_str,
                        allocation_time=alloc_time.replace(tzinfo=None) if hasattr(alloc_time, "tzinfo") and alloc_time.tzinfo else alloc_time,
                        gate_pass_number=req.existing_gate_pass_id,
                        vehicle_number=req.vehicle_number,
                        driver_name=driver_name,
                        driver_phone=driver_phone,
                        asn_number=asn_number,
                        po_number=po_number,
                    )
                )
        except Exception:
            pass

        await session.commit()
        return req

    @staticmethod
    async def reassign_dock(
        session: AsyncSession,
        allocation_request_id: uuid.UUID,
        new_dock_id: uuid.UUID,
        reassigned_by: str,
        reason: str,
    ) -> DockAllocationRequestModel:
        """Reassign an existing allocation to another dock."""
        req_query = await session.execute(
            select(DockAllocationRequestModel)
            .where(DockAllocationRequestModel.id == allocation_request_id)
            .with_for_update()
        )
        req = req_query.scalar_one_or_none()
        if not req:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allocation request not found")

        old_dock_id = req.assigned_dock_id

        # Lock new dock
        new_dock = (
            await session.execute(select(DockMasterModel).where(DockMasterModel.id == new_dock_id).with_for_update())
        ).scalar_one_or_none()
        if not new_dock or new_dock.status != DockStatus.AVAILABLE.value:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Target dock is not available for reassignment")

        # Release old dock
        if old_dock_id:
            old_dock = (await session.execute(select(DockMasterModel).where(DockMasterModel.id == old_dock_id))).scalar_one_or_none()
            if old_dock:
                old_dock.status = DockStatus.AVAILABLE.value
                session.add(
                    DockStatusHistoryModel(
                        dock_id=old_dock.id,
                        previous_status=DockStatus.RESERVED.value,
                        new_status=DockStatus.AVAILABLE.value,
                        reason=f"Reassigned to {new_dock.dock_code}. Reason: {reason}",
                        changed_by=reassigned_by,
                        changed_at=datetime.now(timezone.utc),
                    )
                )

        # Update assignment & new dock status
        req.assigned_dock_id = new_dock_id
        req.assigned_by = reassigned_by
        new_dock.status = DockStatus.RESERVED.value

        await DockAllocationService._sync_gate_entry_status(
            session, req.existing_gate_pass_id, req.vehicle_number, "DOCK_ASSIGNED", new_dock.dock_code
        )

        session.add(
            DockStatusHistoryModel(
                dock_id=new_dock_id,
                previous_status=DockStatus.AVAILABLE.value,
                new_status=DockStatus.RESERVED.value,
                reason=f"Reassigned from old dock. Reason: {reason}",
                changed_by=reassigned_by,
                changed_at=datetime.now(timezone.utc),
            )
        )

        hist = DockAllocationHistoryModel(
            allocation_request_id=req.id,
            dock_id=new_dock_id,
            action=AllocationAction.REASSIGNED.value,
            previous_status=req.status,
            new_status=req.status,
            performed_by=reassigned_by,
            performed_at=datetime.now(timezone.utc),
            remarks=f"Reassigned to Dock {new_dock.dock_code}. Reason: {reason}",
        )
        session.add(hist)

        # Notify QI & SM
        for role in ["QUALITY_INSPECTOR", "WAREHOUSE_OPERATOR"]:
            session.add(
                NotificationModel(
                    user_role=role,
                    title="DOCK REASSIGNED",
                    message=f"Gate Pass: {req.existing_gate_pass_id}\nVehicle: {req.vehicle_number}\nReassigned to Dock: {new_dock.dock_code}\nReason: {reason}",
                    link=f"/dock-management?requestId={req.id}",
                )
            )

        await session.commit()
        return req

    @staticmethod
    async def mark_vehicle_arrived(
        session: AsyncSession, allocation_request_id: uuid.UUID, performed_by: str
    ) -> DockAllocationRequestModel:
        """Record physical arrival at the assigned dock (DOCK_ASSIGNED -> AT_DOCK)."""
        from sqlalchemy import desc
        req_query = await session.execute(
            select(DockAllocationRequestModel)
            .where(
                (DockAllocationRequestModel.id == allocation_request_id) |
                (DockAllocationRequestModel.assigned_dock_id == allocation_request_id)
            )
            .order_by(desc(DockAllocationRequestModel.created_at))
            .with_for_update()
        )
        req = req_query.scalars().first()

        if not req:
            dock_direct = (
                await session.execute(
                    select(DockMasterModel).where(DockMasterModel.id == allocation_request_id).with_for_update()
                )
            ).scalar_one_or_none()
            if dock_direct:
                old_dock_st = dock_direct.status
                dock_direct.status = DockStatus.OCCUPIED.value
                session.add(
                    DockStatusHistoryModel(
                        dock_id=dock_direct.id,
                        previous_status=old_dock_st,
                        new_status=DockStatus.OCCUPIED.value,
                        reason="Direct vehicle arrival marked on dock",
                        changed_by=performed_by,
                        changed_at=datetime.now(timezone.utc),
                    )
                )
                await session.commit()
                return DockAllocationRequestModel(
                    existing_gate_pass_id="N/A",
                    vehicle_number="N/A",
                    security_approved_at=datetime.now(timezone.utc),
                    priority="NORMAL",
                    status=DockStatus.OCCUPIED.value,
                    assigned_dock_id=dock_direct.id,
                    arrived_at=datetime.now(timezone.utc),
                )
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allocation request not found")

        dock_code = "N/A"
        if req.assigned_dock_id:
            dock_query = await session.execute(
                select(DockMasterModel).where(DockMasterModel.id == req.assigned_dock_id).with_for_update()
            )
            dock = dock_query.scalar_one_or_none()
            if dock:
                old_dock_st = dock.status
                dock.status = DockStatus.OCCUPIED.value
                dock_code = dock.dock_code

                session.add(
                    DockStatusHistoryModel(
                        dock_id=dock.id,
                        previous_status=old_dock_st,
                        new_status=DockStatus.OCCUPIED.value,
                        reason=f"Vehicle {req.vehicle_number} arrived",
                        changed_by=performed_by,
                        changed_at=datetime.now(timezone.utc),
                    )
                )

        arrived_at = datetime.now(timezone.utc)

        # Persist the same check-in timestamp on the gate assignment consumed by
        # the inbound-arrivals details view. The allocation request remains the
        # source of the transition, while DockAssignment warehouses the warehouse
        # workflow timestamps.
        try:
            from app.modules.gate.infrastructure.persistence.models import GateEntryModel, DockAssignmentModel
            gate_result = await session.execute(
                select(GateEntryModel).where(
                    or_(
                        GateEntryModel.gate_entry_number == req.existing_gate_pass_id,
                        GateEntryModel.vehicle_number == req.vehicle_number,
                    )
                )
            )
            for gate_entry in gate_result.scalars().all():
                assignment_result = await session.execute(
                    select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == gate_entry.id)
                )
                assignment = assignment_result.scalar_one_or_none()
                if assignment:
                    assignment.dock_arrival_at = arrived_at
                    assignment.dock_checked_in_by = performed_by
        except Exception:
            # Status transition must not be lost if a legacy gate record has no
            # corresponding DockAssignment row; the allocation record remains authoritative.
            pass

        # Update GateEntryModel if present
        await DockAllocationService._sync_gate_entry_status(
            session, req.existing_gate_pass_id, req.vehicle_number, "AT_DOCK"
        )

        previous_status = req.status
        req.status = "AT_DOCK"
        req.arrived_at = arrived_at

        session.add(
            DockAllocationHistoryModel(
                allocation_request_id=req.id,
                dock_id=req.assigned_dock_id,
                action=AllocationAction.ARRIVED.value,
                previous_status=previous_status,
                new_status="AT_DOCK",
                performed_by=performed_by,
                performed_at=datetime.now(timezone.utc),
                remarks=f"Vehicle arrived at allocated Dock {dock_code}",
            )
        )

        # Vehicle arrival notifications
        session.add(
            NotificationModel(
                user_role="GRN",
                title="Vehicle Arrived at Dock — Ready for Unloading",
                message=f"Vehicle {req.vehicle_number} has arrived at Dock {dock_code} for Gate Pass {req.existing_gate_pass_id}. Ready for unloading and GRN inspection.",
                link=f"/grn?tab=wizard&gatePassId={req.existing_gate_pass_id}&dock={dock_code}",
            )
        )

        session.add(
            NotificationModel(
                user_role="WAREHOUSE_OPERATOR",
                title="VEHICLE ARRIVED AT DOCK",
                message=f"Vehicle {req.vehicle_number} has arrived at Dock {dock_code} for Gate Pass {req.existing_gate_pass_id}.",
                link=f"/dock-management?requestId={req.id}",
            )
        )

        await session.commit()
        return req

    @staticmethod
    async def start_receiving(
        session: AsyncSession, allocation_request_id: uuid.UUID, performed_by: str
    ) -> DockAllocationRequestModel:
        req = (
            await session.execute(select(DockAllocationRequestModel).where(DockAllocationRequestModel.id == allocation_request_id).with_for_update())
        ).scalar_one_or_none()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req.status != "AT_DOCK":
            raise HTTPException(status_code=409, detail=f"Receiving cannot start while allocation is {req.status}")

        previous_status = req.status
        req.status = "OCCUPIED"
        req.started_at = datetime.now(timezone.utc)

        session.add(
            DockAllocationHistoryModel(
                allocation_request_id=req.id,
                dock_id=req.assigned_dock_id,
                action=AllocationAction.RECEIVING_STARTED.value,
                previous_status=previous_status,
                new_status="OCCUPIED",
                performed_by=performed_by,
                performed_at=datetime.now(timezone.utc),
                remarks="Material receiving started at allocated dock",
            )
        )
        await session.commit()
        return req

    @staticmethod
    async def complete_receiving(
        session: AsyncSession, allocation_request_id: uuid.UUID, performed_by: str
    ) -> DockAllocationRequestModel:
        req = (
            await session.execute(select(DockAllocationRequestModel).where(DockAllocationRequestModel.id == allocation_request_id).with_for_update())
        ).scalar_one_or_none()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        # A vehicle can reach the dock through either the legacy OCCUPIED
        # state or the gate workflow's AT_DOCK state. Both mean receiving is
        # ready to be completed.
        completed_assignment = None
        if req.status == "DOCK_ASSIGNED" and req.assigned_dock_id:
            # Older GRN flows can finish receiving without advancing the
            # allocation. Reconcile only with completion evidence for this
            # exact gate entry, vehicle and dock.
            from app.modules.gate.infrastructure.persistence.models import DockAssignmentModel, GateEntryModel
            from app.modules.receiving.infrastructure.persistence.models import GrnModel

            gate_refs = [GateEntryModel.gate_entry_number == req.existing_gate_pass_id]
            try:
                gate_refs.append(GateEntryModel.id == uuid.UUID(req.existing_gate_pass_id))
            except (ValueError, TypeError, AttributeError):
                pass
            normalized_vehicle = req.vehicle_number.replace("-", "").replace(" ", "").upper()
            completed_assignment = (await session.execute(
                select(DockAssignmentModel)
                .join(GateEntryModel, GateEntryModel.id == DockAssignmentModel.gate_entry_id)
                .join(DockMasterModel, DockMasterModel.dock_code == DockAssignmentModel.dock_number)
                .where(
                    or_(*gate_refs),
                    DockMasterModel.id == req.assigned_dock_id,
                    DockMasterModel.status == DockStatus.OCCUPIED.value,
                    func.upper(
                        func.replace(func.replace(DockAssignmentModel.vehicle_number, "-", ""), " ", "")
                    ) == normalized_vehicle,
                    DockAssignmentModel.prepared_grn_id.is_not(None),
                    DockAssignmentModel.receiving_completed_at.is_not(None),
                    DockAssignmentModel.dock_released_at.is_(None),
                ).with_for_update()
            )).scalar_one_or_none()

            if completed_assignment is None:
                # A formerly broad ASN match may have attached the GRN to a
                # sibling vehicle.  The completed GRN itself is authoritative
                # evidence, so repair the exact gate/vehicle/dock assignment
                # before advancing the allocation.
                exact_assignment = (await session.execute(
                    select(DockAssignmentModel)
                    .join(GateEntryModel, GateEntryModel.id == DockAssignmentModel.gate_entry_id)
                    .join(DockMasterModel, DockMasterModel.dock_code == DockAssignmentModel.dock_number)
                    .where(
                        or_(*gate_refs),
                        DockMasterModel.id == req.assigned_dock_id,
                        DockMasterModel.status == DockStatus.OCCUPIED.value,
                        func.upper(
                            func.replace(func.replace(DockAssignmentModel.vehicle_number, "-", ""), " ", "")
                        ) == normalized_vehicle,
                        DockAssignmentModel.dock_released_at.is_(None),
                    )
                    .with_for_update()
                )).scalar_one_or_none()
                completed_grn = None
                if exact_assignment is not None:
                    completed_grn = (await session.execute(
                        select(GrnModel).where(
                            GrnModel.status.in_(["COMPLETED", "POSTED", "RECEIVING_COMPLETE"]),
                            or_(
                                GrnModel.gate_entry_id == exact_assignment.gate_entry_id,
                                func.upper(GrnModel.gate_entry_number)
                                == req.existing_gate_pass_id.strip().upper(),
                            ),
                            func.upper(
                                func.replace(func.replace(GrnModel.vehicle_number, "-", ""), " ", "")
                            ) == normalized_vehicle,
                            func.upper(GrnModel.dock_number)
                            == exact_assignment.dock_number.strip().upper(),
                        ).with_for_update()
                    )).scalar_one_or_none()
                if exact_assignment is not None and completed_grn is not None:
                    conflicting_assignment = (await session.execute(
                        select(DockAssignmentModel).where(
                            DockAssignmentModel.prepared_grn_id == completed_grn.id,
                            DockAssignmentModel.id != exact_assignment.id,
                        ).with_for_update()
                    )).scalar_one_or_none()
                    if conflicting_assignment is not None:
                        conflicting_assignment.prepared_grn_id = None
                    exact_assignment.prepared_grn_id = completed_grn.id
                    exact_assignment.receiving_completed_at = completed_grn.posted_at or datetime.now(timezone.utc)
                    exact_assignment.receiving_completed_by = completed_grn.posted_by or performed_by
                    completed_assignment = exact_assignment
        if req.status == AllocationStatus.COMPLETED.value:
            return req

        valid_complete_statuses = {
            "OCCUPIED",
            "AT_DOCK",
            "DOCK_ASSIGNED",
            "DOCK_ALLOCATED",
            "ASSIGNED",
            "IN_PROGRESS",
            "IN_RECEIVING",
            "RECEIVING",
        }
        if req.status not in valid_complete_statuses and completed_assignment is None:
            raise HTTPException(status_code=409, detail=f"Receiving cannot complete while allocation is {req.status}")

        previous_status = req.status
        req.status = AllocationStatus.COMPLETED.value
        req.completed_at = (
            completed_assignment.receiving_completed_at
            if completed_assignment is not None else datetime.now(timezone.utc)
        )

        session.add(
            DockAllocationHistoryModel(
                allocation_request_id=req.id,
                dock_id=req.assigned_dock_id,
                action=AllocationAction.COMPLETED.value,
                previous_status=previous_status,
                new_status=AllocationStatus.COMPLETED.value,
                performed_by=performed_by,
                performed_at=datetime.now(timezone.utc),
                remarks="Material receiving completed successfully",
            )
        )
        await session.commit()
        return req

    @staticmethod
    async def release_dock(
        session: AsyncSession, allocation_request_id: uuid.UUID, performed_by: str
    ) -> DockAllocationRequestModel:
        """Release Dock transition (OCCUPIED -> AVAILABLE only)."""
        from sqlalchemy import desc
        req_query = await session.execute(
            select(DockAllocationRequestModel)
            .where(DockAllocationRequestModel.id == allocation_request_id)
            .order_by(desc(DockAllocationRequestModel.created_at))
            .with_for_update()
        )
        req = req_query.scalars().first()

        if not req:
            raise HTTPException(status_code=404, detail="Allocation request or dock not found")

        if req.status != AllocationStatus.COMPLETED.value:
            if req.status in {
                "OCCUPIED",
                "AT_DOCK",
                "DOCK_ASSIGNED",
                "DOCK_ALLOCATED",
                "ASSIGNED",
                "IN_PROGRESS",
                "IN_RECEIVING",
                "RECEIVING",
            }:
                req.status = AllocationStatus.COMPLETED.value
                req.completed_at = datetime.now(timezone.utc)
            else:
                raise HTTPException(status_code=409, detail="Receiving must be completed before the dock can be released")

        if not req.assigned_dock_id:
            raise HTTPException(status_code=409, detail="Allocation has no dock to release")
        dock_query = await session.execute(
                select(DockMasterModel).where(DockMasterModel.id == req.assigned_dock_id).with_for_update()
            )
        dock = dock_query.scalar_one_or_none()
        if not dock:
            raise HTTPException(status_code=409, detail="Assigned dock no longer exists")
        if dock.status != DockStatus.OCCUPIED.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dock is not occupied")

        old_dock_st = dock.status
        dock.status = DockStatus.AVAILABLE.value
        dock_code = dock.dock_code

        session.add(
            DockStatusHistoryModel(
                dock_id=dock.id,
                previous_status=old_dock_st,
                new_status=DockStatus.AVAILABLE.value,
                reason=f"Released from Gate Pass {req.existing_gate_pass_id}",
                changed_by=performed_by,
                changed_at=datetime.now(timezone.utc),
            )
        )
        from app.modules.gate.infrastructure.persistence.models import DockModel
        gate_dock = (await session.execute(select(DockModel).where(
            DockModel.dock_number == dock.dock_code
        ).with_for_update())).scalar_one_or_none()
        if not gate_dock:
            raise HTTPException(status_code=409, detail="Gate receiving dock record is missing")
        gate_dock.status = DockStatus.AVAILABLE.value
        gate_dock.updated_at = datetime.now(timezone.utc)

        previous_status = req.status
        req.status = AllocationStatus.RELEASED.value
        req.released_at = datetime.now(timezone.utc)
        if not req.completed_at:
            req.completed_at = datetime.now(timezone.utc)

        from app.modules.gate.infrastructure.persistence.models import GateEntryModel
        gate_entry = (await session.execute(select(GateEntryModel).where(
            GateEntryModel.gate_entry_number == req.existing_gate_pass_id
        ).with_for_update())).scalar_one_or_none()
        if not gate_entry:
            raise HTTPException(status_code=409, detail="Linked Gate Entry is missing; dock release was not recorded")
        # Keep the gate entry in the receiving-complete state until Security
        # records the actual vehicle exit. Dock release is a prerequisite for
        # exit, not the exit itself.
        gate_entry.status = "RECEIVING_COMPLETED"
        from app.modules.gate.infrastructure.persistence.models import DockAssignmentModel
        assignment = (await session.execute(select(DockAssignmentModel).where(
            DockAssignmentModel.gate_entry_id == gate_entry.id
        ).with_for_update())).scalar_one_or_none()
        if not assignment:
            raise HTTPException(status_code=409, detail="Linked Gate Entry dock assignment is missing")
        assignment.dock_released_by = performed_by
        assignment.dock_released_at = datetime.now(timezone.utc)

        session.add(
            DockAllocationHistoryModel(
                allocation_request_id=req.id,
                dock_id=req.assigned_dock_id,
                action=AllocationAction.RELEASED.value,
                previous_status=previous_status,
                new_status=AllocationStatus.RELEASED.value,
                performed_by=performed_by,
                performed_at=datetime.now(timezone.utc),
                remarks=f"Dock {dock_code} released back to AVAILABLE",
            )
        )
        session.add(
            NotificationModel(
                user_role="GATE_SECURITY",
                title="GRN Alert: Dock Released",
                message=f"Dock {dock_code} is now available after vehicle {req.vehicle_number} left. Another vehicle can enter.",
                link=f"/vehicle-queue?gateEntry={req.existing_gate_pass_id}",
                notification_type="GATE_DOCK_RELEASED",
                payload_json=json.dumps({"allocation_request_id": str(req.id), "gate_pass_id": req.existing_gate_pass_id,
                                         "vehicle_number": req.vehicle_number, "dock_code": dock_code}),
            )
        )
        await session.commit()
        return req

    @staticmethod
    async def cancel_request(
        session: AsyncSession, allocation_request_id: uuid.UUID, performed_by: str, reason: str = "User cancelled"
    ) -> DockAllocationRequestModel:
        req = (
            await session.execute(select(DockAllocationRequestModel).where(DockAllocationRequestModel.id == allocation_request_id))
        ).scalar_one_or_none()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")

        previous_status = req.status
        req.status = AllocationStatus.CANCELLED.value
        req.cancelled_at = datetime.now(timezone.utc)
        req.cancellation_reason = reason

        if req.assigned_dock_id:
            dock = (await session.execute(select(DockMasterModel).where(DockMasterModel.id == req.assigned_dock_id))).scalar_one_or_none()
            if dock:
                old_st = dock.status
                dock.status = DockStatus.AVAILABLE.value
                session.add(
                    DockStatusHistoryModel(
                        dock_id=dock.id,
                        previous_status=old_st,
                        new_status=DockStatus.AVAILABLE.value,
                        reason=f"Allocation cancelled: {reason}",
                        changed_by=performed_by,
                        changed_at=datetime.now(timezone.utc),
                    )
                )

        session.add(
            DockAllocationHistoryModel(
                allocation_request_id=req.id,
                dock_id=req.assigned_dock_id,
                action=AllocationAction.CANCELLED.value,
                previous_status=previous_status,
                new_status=AllocationStatus.CANCELLED.value,
                performed_by=performed_by,
                performed_at=datetime.now(timezone.utc),
                remarks=f"Allocation request cancelled. Reason: {reason}",
            )
        )
        await session.commit()
        return req
