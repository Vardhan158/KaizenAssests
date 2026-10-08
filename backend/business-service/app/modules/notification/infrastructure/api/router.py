"""
Notification module API router.
Supports:
- GET /api/v1/notifications: Role-based notification list for frontend app-shell and notifications page.
- POST/PUT /api/v1/notifications/{notification_id}/read: Mark single notification read.
- POST/PUT /api/v1/notifications/read-all: Mark all notifications read.
- POST /api/v1/notifications: Create notification.
- POST /webhooks/events: Counterpart of EventWebhookController.java for incoming Kafka/HTTP event ingestion.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import desc, func, or_, select, update

from app.common.persistence.models import NotificationModel
from app.database.session import UnitOfWork, get_uow
from app.modules.notification.application.use_cases import RecordIncomingEventUseCase
from app.modules.notification.infrastructure.persistence.repository_impl import (
    SqlAlchemyNotificationLogRepository,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["notification"])


@router.post("/webhooks/events", status_code=200)
async def receive(request: Request, uow: UnitOfWork = Depends(get_uow)) -> None:
    raw_payload = (await request.body()).decode("utf-8")
    repo = SqlAlchemyNotificationLogRepository(uow.session)
    use_case = RecordIncomingEventUseCase(repo)
    await use_case.handle(raw_payload)


def serialize_notification(n: NotificationModel) -> dict[str, Any]:
    return {
        "id": str(n.id),
        "user_role": n.user_role,
        "role": n.user_role,
        "title": n.title,
        "message": n.message,
        "link": n.link,
        "is_read": bool(n.is_read),
        "isRead": bool(n.is_read),
        "dock_code": n.dock_code,
        "dock_name": n.dock_name,
        "dock_location": n.dock_location,
        "dock_type": n.dock_type,
        "warehouse_name": n.warehouse_name,
        "allocation_time": n.allocation_time.isoformat() if n.allocation_time else None,
        "gate_pass_number": n.gate_pass_number,
        "vehicle_number": n.vehicle_number,
        "driver_name": n.driver_name,
        "driver_phone": n.driver_phone,
        "asn_number": n.asn_number,
        "po_number": n.po_number,
        "grn_number": n.grn_number,
        "supplier_name": n.supplier_name,
        "notification_type": n.notification_type or "GENERAL",
        "type": n.notification_type or "general",
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "createdAt": n.created_at.isoformat() if n.created_at else None,
    }


def _build_role_condition(role: Optional[str], store_code: Optional[str] = None):
    clauses = []
    if role:
        r = role.strip().upper()
        target_roles = {r, "ALL"}
        if "ASSEMBLY" in r:
            target_roles.update(["ASSEMBLY", "ASSEMBLY_MANAGER", "ASSEMBLY_OPERATOR"])
        if "STORE" in r:
            target_roles.update(["STORE", "STORE_MANAGER", "STORE_KEEPER"])
        if "WAREHOUSE" in r:
            target_roles.update(["WAREHOUSE", "WAREHOUSE_MANAGER", "OPERATOR"])
        if "GRN" in r:
            target_roles.update(["GRN", "STORE_MANAGER"])
        if "PROCUREMENT" in r:
            target_roles.update(["PROCUREMENT"])

        clauses.append(func.upper(NotificationModel.user_role).in_(list(target_roles)))
        clauses.append(NotificationModel.user_role.ilike(f"%{r}%"))

    if store_code:
        sc = store_code.strip().upper()
        clauses.append(NotificationModel.user_role == f"STR:{sc}")
        clauses.append(NotificationModel.user_role.ilike(f"%{sc}%"))

    return or_(*clauses) if clauses else None


@router.get("/api/v1/notifications")
async def get_notifications(
    role: Optional[str] = Query(None),
    store_code: Optional[str] = Query(None),
    store_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    uow: UnitOfWork = Depends(get_uow),
) -> List[dict[str, Any]]:
    try:
        stmt = select(NotificationModel)
        cond = _build_role_condition(role, store_code)
        if cond is not None:
            stmt = stmt.where(cond)
        stmt = stmt.order_by(desc(NotificationModel.created_at)).limit(limit)

        result = await uow.session.execute(stmt)
        notifications = result.scalars().all()
        return [serialize_notification(n) for n in notifications]
    except Exception as exc:
        logger.exception("Failed to retrieve notifications: %s", exc)
        return []


class CreateNotificationPayload(BaseModel):
    user_role: str = "ALL"
    title: str
    message: str
    link: Optional[str] = None
    notification_type: Optional[str] = "GENERAL"
    dock_code: Optional[str] = None
    vehicle_number: Optional[str] = None
    asn_number: Optional[str] = None
    po_number: Optional[str] = None
    grn_number: Optional[str] = None
    supplier_name: Optional[str] = None


@router.post("/api/v1/notifications", status_code=201)
async def create_notification(
    payload: CreateNotificationPayload,
    uow: UnitOfWork = Depends(get_uow),
) -> dict[str, Any]:
    n = NotificationModel(
        id=uuid.uuid4(),
        user_role=payload.user_role,
        title=payload.title,
        message=payload.message,
        link=payload.link,
        notification_type=payload.notification_type,
        dock_code=payload.dock_code,
        vehicle_number=payload.vehicle_number,
        asn_number=payload.asn_number,
        po_number=payload.po_number,
        grn_number=payload.grn_number,
        supplier_name=payload.supplier_name,
        is_read=False,
        created_at=datetime.now(),
    )
    uow.session.add(n)
    await uow.commit()
    return serialize_notification(n)


@router.post("/api/v1/notifications/{notification_id}/read")
@router.put("/api/v1/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    uow: UnitOfWork = Depends(get_uow),
) -> dict[str, Any]:
    try:
        nid = uuid.UUID(notification_id)
        stmt = update(NotificationModel).where(NotificationModel.id == nid).values(is_read=True)
        await uow.session.execute(stmt)
        await uow.commit()
    except Exception as exc:
        logger.warning(f"Failed to mark notification {notification_id} read: {exc}")
    return {"status": "OK", "success": True}


@router.post("/api/v1/notifications/read-all")
@router.put("/api/v1/notifications/read-all")
@router.post("/api/v1/notifications/mark-all-read")
async def mark_all_notifications_read(
    role: Optional[str] = Query(None),
    store_code: Optional[str] = Query(None),
    uow: UnitOfWork = Depends(get_uow),
) -> dict[str, Any]:
    try:
        stmt = update(NotificationModel).values(is_read=True)
        cond = _build_role_condition(role, store_code)
        if cond is not None:
            stmt = stmt.where(cond)
        await uow.session.execute(stmt)
        await uow.commit()
    except Exception as exc:
        logger.warning(f"Failed to mark all notifications read: {exc}")
    return {"status": "OK", "success": True}
