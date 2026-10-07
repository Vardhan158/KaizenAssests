import datetime
import uuid
from typing import Any, List, Optional
from decimal import Decimal
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, or_, func, desc
from sqlalchemy.orm import selectinload

from app.database.session import UnitOfWork, get_uow
from app.security.dependencies import CurrentUser, get_current_user
from app.modules.quarantine.infrastructure.persistence.models import (
    QuarantineRecordModel,
    QuarantineAuditModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    PutawayTaskModel,
    HandlingUnitModel,
    StorageLocationModel,
)
from app.modules.procurement.infrastructure.persistence.models import NotificationModel

router = APIRouter(prefix="/api/quarantine", tags=["quarantine"])

ALLOWED_WAREHOUSE_ROLES = {"WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"}
VALID_DISPOSITIONS = {
    "ACCEPTED_WITH_DEVIATION",
    "RETURN_TO_VENDOR",
    "SCRAPPED",
    "REWORK",
}


def _check_warehouse_access(user: CurrentUser) -> None:
    """Ensure caller has warehouse/admin role and strictly block Store Manager / Store Keeper."""
    user_roles = set(r.upper() for r in (user.roles or []))
    
    # Store Keepers and Store Managers are explicitly blocked
    if "STORE_KEEPER" in user_roles or "STORE_MANAGER" in user_roles:
        if not user_roles.intersection({"ADMIN", "SUPERUSER"}):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Store Managers and Store Keepers do not have access to global Warehouse Quarantine.",
            )

    # Must have at least one allowed warehouse role or admin permission
    if not user_roles.intersection(ALLOWED_WAREHOUSE_ROLES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted to Warehouse personnel.",
        )


class QuarantineReviewRequest(BaseModel):
    disposition: str = Field(..., description="Decision: ACCEPTED_WITH_DEVIATION, RETURN_TO_VENDOR, SCRAPPED, REWORK")
    remarks: Optional[str] = Field(None, description="Detailed review remarks / justification")


@router.get("")
async def list_quarantine_records(
    status_filter: Optional[str] = Query(None, alias="status"),
    material: Optional[str] = Query(None),
    grn: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    _check_warehouse_access(user)

    stmt = select(QuarantineRecordModel).order_by(desc(QuarantineRecordModel.created_at))

    if status_filter and status_filter.upper() != "ALL":
        stmt = stmt.where(QuarantineRecordModel.status == status_filter.upper())

    if material:
        stmt = stmt.where(
            or_(
                QuarantineRecordModel.item_code.ilike(f"%{material}%"),
                QuarantineRecordModel.material_name.ilike(f"%{material}%"),
            )
        )

    if grn:
        stmt = stmt.where(QuarantineRecordModel.grn_number.ilike(f"%{grn}%"))

    if search:
        search_pattern = f"%{search}%"
        stmt = stmt.where(
            or_(
                QuarantineRecordModel.quarantine_number.ilike(search_pattern),
                QuarantineRecordModel.item_code.ilike(search_pattern),
                QuarantineRecordModel.material_name.ilike(search_pattern),
                QuarantineRecordModel.grn_number.ilike(search_pattern),
                QuarantineRecordModel.supplier_name.ilike(search_pattern),
                QuarantineRecordModel.po_number.ilike(search_pattern),
                QuarantineRecordModel.reason.ilike(search_pattern),
            )
        )

    result = await uow.session.execute(stmt)
    records = result.scalars().all()

    return [
        {
            "id": str(r.id),
            "quarantine_number": r.quarantine_number,
            "grn_id": str(r.grn_id) if r.grn_id else None,
            "grn_number": r.grn_number,
            "grn_line_id": str(r.grn_line_id) if r.grn_line_id else None,
            "receiving_line_id": str(r.receiving_line_id) if r.receiving_line_id else None,
            "item_code": r.item_code,
            "material_name": r.material_name,
            "variant_code": r.variant_code,
            "damaged_quantity": float(r.damaged_quantity),
            "uom": r.uom,
            "batch_number": r.batch_number,
            "material_tag": r.material_tag,
            "supplier_name": r.supplier_name,
            "po_number": r.po_number,
            "asn_number": r.asn_number,
            "warehouse_id": r.warehouse_id,
            "reason": r.reason,
            "receiving_notes": r.receiving_notes,
            "status": r.status,
            "disposition": r.disposition,
            "review_remarks": r.review_remarks,
            "reviewed_by": r.reviewed_by,
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
            "created_by": r.created_by,
            "created_at": r.created_at.isoformat(),
            "updated_at": r.updated_at.isoformat(),
        }
        for r in records
    ]


@router.get("/{quarantine_id}")
async def get_quarantine_record(
    quarantine_id: str,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    _check_warehouse_access(user)

    try:
        qid = uuid.UUID(quarantine_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quarantine record {quarantine_id} not found",
        )

    stmt = (
        select(QuarantineRecordModel)
        .options(selectinload(QuarantineRecordModel.audits))
        .where(QuarantineRecordModel.id == qid)
    )
    result = await uow.session.execute(stmt)
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quarantine record {quarantine_id} not found",
        )

    return {
        "id": str(record.id),
        "quarantine_number": record.quarantine_number,
        "grn_id": str(record.grn_id) if record.grn_id else None,
        "grn_number": record.grn_number,
        "grn_line_id": str(record.grn_line_id) if record.grn_line_id else None,
        "receiving_line_id": str(record.receiving_line_id) if record.receiving_line_id else None,
        "dock_assignment_id": str(record.dock_assignment_id) if record.dock_assignment_id else None,
        "material_id": str(record.material_id) if record.material_id else None,
        "material_variant_id": str(record.material_variant_id) if record.material_variant_id else None,
        "item_code": record.item_code,
        "material_name": record.material_name,
        "variant_code": record.variant_code,
        "damaged_quantity": float(record.damaged_quantity),
        "uom": record.uom,
        "batch_number": record.batch_number,
        "material_tag": record.material_tag,
        "supplier_name": record.supplier_name,
        "po_number": record.po_number,
        "asn_number": record.asn_number,
        "warehouse_id": record.warehouse_id,
        "reason": record.reason,
        "receiving_notes": record.receiving_notes,
        "status": record.status,
        "disposition": record.disposition,
        "review_remarks": record.review_remarks,
        "reviewed_by": record.reviewed_by,
        "reviewed_at": record.reviewed_at.isoformat() if record.reviewed_at else None,
        "created_by": record.created_by,
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
        "audits": [
            {
                "id": str(a.id),
                "previous_status": a.previous_status,
                "new_status": a.new_status,
                "disposition": a.disposition,
                "remarks": a.remarks,
                "performed_by": a.performed_by,
                "performed_at": a.performed_at.isoformat(),
            }
            for a in record.audits
        ],
    }


@router.post("/{quarantine_id}/review")
async def review_quarantine_record(
    quarantine_id: str,
    payload: QuarantineReviewRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    _check_warehouse_access(user)

    try:
        qid = uuid.UUID(quarantine_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quarantine record {quarantine_id} not found",
        )

    stmt = select(QuarantineRecordModel).where(QuarantineRecordModel.id == qid).with_for_update()
    result = await uow.session.execute(stmt)
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quarantine record {quarantine_id} not found",
        )

    if record.status != "PENDING_REVIEW":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Quarantine record has already been reviewed with status '{record.status}'.",
        )

    disp = payload.disposition.strip().upper()
    if disp not in VALID_DISPOSITIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid disposition '{payload.disposition}'. Allowed dispositions: {', '.join(sorted(VALID_DISPOSITIONS))}",
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    prev_status = record.status

    record.status = disp
    record.disposition = disp
    record.review_remarks = payload.remarks.strip() if payload.remarks else None
    record.reviewed_by = user.username
    record.reviewed_at = now
    record.updated_at = now

    audit = QuarantineAuditModel(
        quarantine_id=record.id,
        previous_status=prev_status,
        new_status=disp,
        disposition=disp,
        remarks=record.review_remarks,
        performed_by=user.username,
        performed_at=now,
    )
    uow.session.add(audit)

    # If Accepted with Deviation, route through Putaway workflow for physical placement
    putaway_task_id = None
    if disp == "ACCEPTED_WITH_DEVIATION":
        putaway_task = PutawayTaskModel(
            task_number=f"PUT-DEV-{now.year}-{uuid.uuid4().hex[:8].upper()}",
            grn_id=record.grn_id or uuid.uuid4(),
            grn_number=record.grn_number or f"DEV-{record.quarantine_number}",
            handling_unit_id=None,
            item_code=record.item_code,
            material_name=record.material_name,
            quantity=record.damaged_quantity,
            uom=record.uom,
            warehouse_id=record.warehouse_id,
            source_location="QUARANTINE_AREA",
            status="PUTAWAY_PENDING",
            created_by=user.username,
            created_at=now,
        )
        uow.session.add(putaway_task)
        await uow.session.flush()
        putaway_task_id = str(putaway_task.id)

    # Emit notification
    uow.session.add(
        NotificationModel(
            user_role="WAREHOUSE",
            title="Quarantine Review Completed",
            message=f"{record.quarantine_number} ({record.item_code}) disposition set to {disp} by {user.username}.",
            link="/warehouse/quarantine",
        )
    )

    await uow.session.flush()

    return {
        "id": str(record.id),
        "quarantine_number": record.quarantine_number,
        "status": record.status,
        "disposition": record.disposition,
        "reviewed_by": record.reviewed_by,
        "reviewed_at": record.reviewed_at.isoformat(),
        "putaway_task_id": putaway_task_id,
        "message": f"Quarantine record marked as {disp}.",
    }
