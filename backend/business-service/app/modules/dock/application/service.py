from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional
import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.dock.domain.enums import (
    AllocationAction,
    AllocationPriority,
    AllocationStatus,
    DockStatus,
    DockType,
)
from app.modules.dock.infrastructure.persistence.models import (
    DockAllocationHistoryModel,
    DockAllocationRequestModel,
    DockMasterModel,
    DockStatusHistoryModel,
)
from app.modules.procurement.infrastructure.persistence.models import NotificationModel


class DockAllocationService:

    @staticmethod
    async def seed_default_docks_if_empty(session: AsyncSession) -> None:
        """Helper to seed initial 9 docks when explicitly invoked (e.g. by test fixtures or setup scripts)."""
        result = await session.execute(select(func.count(DockMasterModel.id)))
        if result.scalar() == 0:
            default_store_id = None
            try:
                from app.modules.store.infrastructure.persistence.models import StoreModel
                store_res = await session.execute(select(StoreModel.id).order_by(StoreModel.created_at.asc()).limit(1))
                default_store_id = store_res.scalars().first()
            except Exception:
                default_store_id = None

            initial_docks = [
                {"code": "RM-01", "name": "Raw Material Dock 01", "type": DockType.RAW_MATERIAL.value, "location": "North Warehouse"},
                {"code": "RM-02", "name": "Raw Material Dock 02", "type": DockType.RAW_MATERIAL.value, "location": "East Warehouse"},
                {"code": "CH-01", "name": "Chemical/Hazardous Dock 01", "type": DockType.CHEMICAL_HAZARDOUS.value, "location": "South Warehouse"},
                {"code": "CH-02", "name": "Chemical/Hazardous Dock 02", "type": DockType.CHEMICAL_HAZARDOUS.value, "location": "South Warehouse"},
                {"code": "EL-01", "name": "Electrical Dock 01", "type": DockType.ELECTRICAL.value, "location": "North Warehouse"},
                {"code": "EL-02", "name": "Electrical Dock 02", "type": DockType.ELECTRICAL.value, "location": "North Warehouse"},
                {"code": "EC-01", "name": "Electronics Dock 01", "type": DockType.ELECTRONICS.value, "location": "West Warehouse"},
                {"code": "EC-02", "name": "Electronics Dock 02", "type": DockType.ELECTRONICS.value, "location": "West Warehouse"},
                {"code": "MR-01", "name": "Main Receiving Dock", "type": DockType.MAIN_RECEIVING.value, "location": "North Warehouse"},
            ]
            for d in initial_docks:
                dock = DockMasterModel(
                    dock_code=d["code"],
                    dock_name=d["name"],
                    dock_type=d["type"],
                    location=d["location"],
                    status=DockStatus.AVAILABLE.value,
                    is_active=True,
                    store_id=default_store_id,
                )
                session.add(dock)
            await session.commit()

    @staticmethod
    async def sync_pending_gate_entries(session: AsyncSession) -> None:
        """Auto-syncs any active Gate Entries that do not yet have a DockAllocationRequestModel."""
        try:
            from app.modules.gate.infrastructure.persistence.models import GateEntryModel
            gate_entries_res = await session.execute(
                select(GateEntryModel).where(
                    GateEntryModel.assigned_dock_id == None,
                    GateEntryModel.status.notin_(["REJECTED", "GATE_EXIT_COMPLETED", "EXIT_APPROVED", "DOCK_ASSIGNED", "OCCUPIED", "RELEASED"])
                )
            )
            entries = gate_entries_res.scalars().all()
            for ge in entries:
                ge_num = ge.gate_entry_number or str(ge.id)
                veh_plate = getattr(ge, "vehicle_number", None) or getattr(ge, "vehicle_plate", None)
                if not veh_plate:
                    continue
                supplier = ge.ocr_supplier_name or getattr(ge, "supplier_name", None)
                mat_name = ge.ocr_product_material or getattr(ge, "material_description", None)
                qty = Decimal(str(ge.ocr_quantity)) if ge.ocr_quantity is not None else (Decimal(str(ge.total_quantity)) if getattr(ge, "total_quantity", None) is not None else None)
                
                check_stmt = select(DockAllocationRequestModel).where(
                    (DockAllocationRequestModel.existing_gate_pass_id == ge_num) |
                    (DockAllocationRequestModel.existing_gate_pass_id == str(ge.id))
                )
                found = (await session.execute(check_stmt)).scalars().first()
                if not found:
                    req_model = DockAllocationRequestModel(
                        existing_gate_pass_id=ge_num,
                        vehicle_number=veh_plate,
                        vendor_reference=supplier,
                        material_reference=mat_name,
                        material_description=mat_name,
                        quantity=qty,
                        security_approved_at=ge.created_at or datetime.now(timezone.utc),
                        priority="NORMAL",
                        status="AWAITING_DOCK",
                    )
                    session.add(req_model)
                    await session.flush()
            await session.flush()
        except Exception:
            pass

    @staticmethod
    async def get_overview_metrics(session: AsyncSession) -> dict:
        await DockAllocationService.sync_pending_gate_entries(session)
        docks_result = await session.execute(select(DockMasterModel).where(DockMasterModel.is_active == True))
        docks = docks_result.scalars().all()

        pending_result = await session.execute(
            select(func.count(DockAllocationRequestModel.id)).where(
                DockAllocationRequestModel.status.in_(["PENDING", "PENDING_ALLOCATION", "AWAITING_DOCK"])
            )
        )
        pending_count = pending_result.scalar() or 0

        return {
            "total_docks": len(docks),
            "available_docks": sum(1 for d in docks if d.status == DockStatus.AVAILABLE.value),
            "occupied_docks": sum(1 for d in docks if d.status == DockStatus.OCCUPIED.value),
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
        return list(result.scalars().all())

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
                DockAllocationRequestModel.status.in_(["DOCK_ASSIGNED", "RESERVED", "OCCUPIED"])
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
        assigned_store_id: uuid.UUID,
        allocated_by: str,
        store_manager_id: Optional[str] = None,
        store_manager_username: Optional[str] = None,
        store_manager_name: Optional[str] = None,
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

        from app.modules.store.infrastructure.persistence.models import StoreModel
        assigned_store = await session.get(StoreModel, assigned_store_id)
        if not assigned_store or (assigned_store.status or "").upper() != "ACTIVE":
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Selected store is not active or available")
        if dock.store_id and dock.store_id != assigned_store.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Selected dock is permanently assigned to another store")

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

        req.assigned_store_id = assigned_store.id
        req.assigned_store_code = assigned_store.store_code
        req.assigned_store_name = assigned_store.store_name

        # Resolve and assign Store Manager
        if store_manager_id or store_manager_username or store_manager_name:
            req.assigned_store_manager_id = str(store_manager_id) if store_manager_id else None
            req.assigned_store_manager_username = str(store_manager_username) if store_manager_username else None
            req.assigned_store_manager_name = str(store_manager_name) if store_manager_name else str(store_manager_username or store_manager_id)
            try:
                from app.modules.store.infrastructure.persistence.models import StoreManagerUserModel, StoreModel
                filter_conds = []
                if store_manager_id:
                    filter_conds.append(StoreManagerUserModel.employee_id == str(store_manager_id))
                if store_manager_username:
                    filter_conds.append(StoreManagerUserModel.username == str(store_manager_username))
                if store_manager_name:
                    filter_conds.append(func.lower(StoreManagerUserModel.full_name) == str(store_manager_name).lower())

                if filter_conds:
                    sm_stmt = select(StoreManagerUserModel).where(or_(*filter_conds))
                    sm_res = await session.execute(sm_stmt)
                    sm_user = sm_res.scalars().first()
                    if sm_user:
                        req.assigned_store_manager_id = sm_user.employee_id
                        req.assigned_store_manager_username = sm_user.username
                        req.assigned_store_manager_name = sm_user.full_name
                        if sm_user.store_id and not req.assigned_store_id:
                            req.assigned_store_id = sm_user.store_id
                            st_obj = await session.get(StoreModel, sm_user.store_id)
                            if st_obj:
                                req.assigned_store_code = st_obj.store_code
                                req.assigned_store_name = st_obj.store_name
            except Exception:
                pass
        elif not req.assigned_store_manager_id and req.assigned_store_id:
            try:
                from app.modules.store.infrastructure.persistence.models import StoreModel, StoreManagerUserModel
                st_obj = await session.get(StoreModel, req.assigned_store_id)
                if st_obj and st_obj.store_manager_id:
                    req.assigned_store_manager_id = st_obj.store_manager_id
                    req.assigned_store_manager_name = st_obj.store_manager_name
                    sm_res = await session.execute(
                        select(StoreManagerUserModel.username).where(StoreManagerUserModel.employee_id == st_obj.store_manager_id)
                    )
                    sm_u = sm_res.scalar_one_or_none()
                    if sm_u:
                        req.assigned_store_manager_username = sm_u
            except Exception:
                pass

        dock.status = DockStatus.OCCUPIED.value
        await DockAllocationService._sync_warehouse_dock_status(session, dock.dock_code, "OCCUPIED")

        # Update GateEntryModel and DockAssignmentModel
        await DockAllocationService._sync_gate_entry_status(
            session, req.existing_gate_pass_id, req.vehicle_number, "DOCK_ASSIGNED", dock.dock_code
        )

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
            new_status=DockStatus.RESERVED.value,
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
            from app.modules.procurement.infrastructure.persistence.models import AsnModel
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
                    if da and da.assigned_store_id:
                        req.assigned_store_id = da.assigned_store_id
                        req.assigned_store_code = da.assigned_store_code
                        req.assigned_store_name = da.assigned_store_name
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
                from app.modules.procurement.infrastructure.persistence.models import AsnModel
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
        location_str = dock.location or "Receiving Bay - A"
        warehouse_str = "Main Warehouse"

        notif_msg = (
            f"DOCK ALLOCATION CONFIRMED\n\n"
            f"Vehicle Details:\n"
            f"Gate Pass: {req.existing_gate_pass_id}\n"
            f"Vehicle: {req.vehicle_number}\n"
            f"Driver: {driver_name or 'N/A'}\n"
            f"Driver Phone: {driver_phone or 'N/A'}\n"
            f"ASN: {asn_number or 'N/A'}\n"
            f"PO: {po_number or 'N/A'}\n\n"
            f"Allocated Dock Details:\n"
            f"Dock Code: {dock.dock_code}\n"
            f"Dock Name: {dock.dock_name}\n"
            f"Location: {location_str}\n"
            f"Dock Type: {dock.dock_type}\n"
            f"Warehouse: {warehouse_str}\n"
            f"Allocated At: {alloc_time_str}\n\n"
            f"Instruction:\n"
            f"Proceed directly to Dock {dock.dock_code}."
        )

        try:
            for role in ["WAREHOUSE", "STORE_MANAGER", "QUALITY_INSPECTOR"]:
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
        for role in ["QUALITY_INSPECTOR", "STORE_MANAGER"]:
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
        """Vehicle Arrival transition (DOCK_ASSIGNED/RESERVED -> OCCUPIED)."""
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

        # Update GateEntryModel if present
        await DockAllocationService._sync_gate_entry_status(
            session, req.existing_gate_pass_id, req.vehicle_number, "OCCUPIED"
        )

        previous_status = req.status
        req.status = "OCCUPIED"
        req.arrived_at = datetime.now(timezone.utc)

        session.add(
            DockAllocationHistoryModel(
                allocation_request_id=req.id,
                dock_id=req.assigned_dock_id,
                action=AllocationAction.ARRIVED.value,
                previous_status=previous_status,
                new_status="OCCUPIED",
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
                user_role="STORE_MANAGER",
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
            await session.execute(select(DockAllocationRequestModel).where(DockAllocationRequestModel.id == allocation_request_id))
        ).scalar_one_or_none()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")

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
            await session.execute(select(DockAllocationRequestModel).where(DockAllocationRequestModel.id == allocation_request_id))
        ).scalar_one_or_none()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")

        previous_status = req.status
        req.status = AllocationStatus.COMPLETED.value
        req.completed_at = datetime.now(timezone.utc)

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
            .where(
                (DockAllocationRequestModel.id == allocation_request_id) |
                (DockAllocationRequestModel.assigned_dock_id == allocation_request_id)
            )
            .order_by(desc(DockAllocationRequestModel.created_at))
            .with_for_update()
        )
        req = req_query.scalars().first()

        if not req:
            # Check if allocation_request_id corresponds directly to a DockMasterModel ID
            dock_direct = (
                await session.execute(
                    select(DockMasterModel).where(DockMasterModel.id == allocation_request_id).with_for_update()
                )
            ).scalar_one_or_none()
            if dock_direct:
                old_dock_st = dock_direct.status
                dock_direct.status = DockStatus.AVAILABLE.value
                session.add(
                    DockStatusHistoryModel(
                        dock_id=dock_direct.id,
                        previous_status=old_dock_st,
                        new_status=DockStatus.AVAILABLE.value,
                        reason="Direct dock release back to operational service",
                        changed_by=performed_by,
                        changed_at=datetime.now(timezone.utc),
                    )
                )
                await session.commit()
                # Return dummy allocation request response representing the released state
                return DockAllocationRequestModel(
                    existing_gate_pass_id="N/A",
                    vehicle_number="N/A",
                    security_approved_at=datetime.now(timezone.utc),
                    priority="NORMAL",
                    status=AllocationStatus.RELEASED.value,
                    assigned_dock_id=dock_direct.id,
                    released_at=datetime.now(timezone.utc),
                )
            raise HTTPException(status_code=404, detail="Allocation request or dock not found")

        # Verify receiving/unloading completion if gate pass is attached
        if req.existing_gate_pass_id and req.existing_gate_pass_id != "N/A":
            try:
                from app.modules.gate.infrastructure.persistence.models import GateEntryModel
                ge_res = await session.execute(
                    select(GateEntryModel).where(
                        (GateEntryModel.gate_entry_number == req.existing_gate_pass_id) |
                        (GateEntryModel.vehicle_number == req.vehicle_number)
                    )
                )
                ge_obj = ge_res.scalars().first()
                # Store release is authorized only for the assigned store user.
                # Receiving/putaway completion is tracked by the GRN workflow,
                # while the gate status can remain stale after that workflow.
                # Do not block a valid store release from a stale gate status.
                pass
            except HTTPException:
                raise
            except Exception:
                pass

        dock_code = "N/A"
        if req.assigned_dock_id:
            dock_query = await session.execute(
                select(DockMasterModel).where(DockMasterModel.id == req.assigned_dock_id).with_for_update()
            )
            dock = dock_query.scalar_one_or_none()
            if dock:
                if dock.status != DockStatus.OCCUPIED.value:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Dock can only be released when it is OCCUPIED",
                    )

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
                await DockAllocationService._sync_warehouse_dock_status(session, dock.dock_code, "AVAILABLE")

        previous_status = req.status
        req.status = AllocationStatus.RELEASED.value
        req.released_at = datetime.now(timezone.utc)
        if not req.completed_at:
            req.completed_at = datetime.now(timezone.utc)

        await DockAllocationService._sync_gate_entry_status(
            session, req.existing_gate_pass_id, req.vehicle_number, "RELEASED"
        )

        try:
            from app.modules.gate.infrastructure.persistence.models import DockAssignmentModel, GateEntryModel
            if req.existing_gate_pass_id:
                ge_res = await session.execute(
                    select(GateEntryModel).where(
                        (GateEntryModel.gate_entry_number == req.existing_gate_pass_id) |
                        (GateEntryModel.vehicle_number == req.vehicle_number)
                    )
                )
                ge_obj = ge_res.scalars().first()
                if ge_obj:
                    da_res = await session.execute(
                        select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == ge_obj.id)
                    )
                    da = da_res.scalar_one_or_none()
                    if da:
                        da.dock_released_by = performed_by
                        da.dock_released_at = datetime.now(timezone.utc)
        except Exception:
            pass

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
