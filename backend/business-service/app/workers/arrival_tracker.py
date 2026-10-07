"""
Worker / Background task for scheduled tracking of incoming ASN arrival dates.
Enforces multi-tier automated alerts:
- 5 Days before expected arrival: Alert to Warehouse Manager
- 3 Days before expected arrival: Alert to Warehouse Manager + Gate Security
- 0-2 Days before expected arrival: Daily Impending Arrival Notifications
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import session_scope
from app.events.outbox_repository import to_outbox_row
from app.logging.logger import get_logger
from app.modules.procurement.domain.arrival_notification import ArrivalNotification, ArrivalNotificationStatus
from app.modules.procurement.domain.events import ArrivalNotificationDispatchedEvent
from app.modules.procurement.domain.supplier_asn import ASNStatus
from app.modules.procurement.infrastructure.persistence.models import ArrivalNotificationModel, AsnModel, SupplierModel

logger = get_logger(__name__)


async def check_arrival_notifications_once() -> int:
    """
    Executes one pass of the arrival tracking alert scan.
    """
    async with session_scope() as session:
        return await process_arrival_alerts(session)


async def process_arrival_alerts(session: AsyncSession) -> int:
    today = date.today()
    # Join with Supplier to get names, po_number is directly on AsnModel
    stmt = (
        select(AsnModel, AsnModel.po_number, SupplierModel.supplier_name)
        .outerjoin(SupplierModel, AsnModel.supplier_id == SupplierModel.id)
        .where(AsnModel.status.in_(["SUBMITTED", "IN_TRANSIT"]))
    )
    result = await session.execute(stmt)
    rows = result.all()

    alerts_generated = 0

    for asn, po_number, supplier_name in rows:
        if not asn.expected_arrival_at:
            continue

        days_until_arrival = (asn.expected_arrival_at.date() - today).days

        recipients = []
        alert_type = None
        message = ""

        if days_until_arrival == 5:
            alert_type = "5_DAYS_NOTICE"
            recipients = ["Warehouse Manager"]
            message = f"Shipment {po_number or 'N/A'} / {asn.asn_number} is arriving in 5 days. Please prepare the warehouse for receiving."
        elif 0 <= days_until_arrival <= 3:
            alert_type = f"{days_until_arrival}_DAYS_NOTICE" if days_until_arrival > 0 else "ARRIVAL_DAY_NOTICE"
            recipients = ["Warehouse Manager", "Security Team"]
            day_str = f"in {days_until_arrival} days" if days_until_arrival > 0 else "today"
            message = f"Shipment {po_number or 'N/A'} / {asn.asn_number} is arriving {day_str}. Please prepare warehouse receiving and gate entry."

        if alert_type:
            # Check if alert for this ASN on this specific date was already dispatched
            # We filter by asn_id and message (or we could just use a daily flag)
            # Using created_at check is better to allow different alert types on same day if needed,
            # but for daily reminders, one per day is enough.
            existing_stmt = select(ArrivalNotificationModel).where(
                ArrivalNotificationModel.asn_id == str(asn.id),
            )
            existing_res = await session.execute(existing_stmt)
            existing_notes = existing_res.scalars().all()

            # Prevent duplicate notifications on the exact same date
            already_notified_today = any(
                n.created_at.date() == today for n in existing_notes
            )

            if not already_notified_today:
                notif = ArrivalNotificationModel(
                    id=f"AN-ALERT-{str(asn.id)[-8:]}-{alert_type}-{today.strftime('%Y%m%d')}",
                    asn_id=str(asn.id),
                    asn_number=asn.asn_number,
                    po_id=str(asn.po_id) if asn.po_id else None,
                    po_number=po_number or "N/A",
                    warehouse_id=asn.warehouse_id,
                    supplier_name=supplier_name or "Independent Supplier",
                    vehicle_number=asn.vehicle_number,
                    expected_arrival_time=asn.expected_arrival_at.replace(tzinfo=timezone.utc),
                    driver_phone=asn.driver_contact,
                    message=message,
                    recipients=",".join(recipients),
                    status=ArrivalNotificationStatus.DISPATCHED.value,
                )
                session.add(notif)

                # Add outbox event for Kafka dispatching to notification service
                event = ArrivalNotificationDispatchedEvent(
                    notification_id=notif.id,
                    asn_id=str(asn.id),
                    po_id=str(asn.po_id),
                    vehicle_number=asn.vehicle_number,
                    warehouse_id=asn.warehouse_id,
                )
                session.add(to_outbox_row("ArrivalNotification", notif.id, event))

                alerts_generated += 1
                logger.info(
                    f"Dispatched {alert_type} for ASN {asn.asn_number} (Vehicle {asn.vehicle_number}). Recipients: {recipients}"
                )

    return alerts_generated
