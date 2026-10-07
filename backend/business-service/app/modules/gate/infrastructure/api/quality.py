"""
FastAPI Router for Quality Issues and Notifications.
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException

from app.database.session import UnitOfWork, get_uow
from app.modules.gate.infrastructure.persistence.models import (
    DamagePhotoModel,
    DamageReportModel,
    DockAssignmentModel,
    GateEntryModel,
    ReceivingLineModel,
    SupplierDamageClaimModel,
)
from app.modules.procurement.infrastructure.persistence.models import (
    AsnModel,
    SupplierModel,
    SupplierContactModel,
    NotificationModel,
    SupplierUserModel,
)
from app.security.dependencies import get_current_user, CurrentUser
from sqlalchemy import func, select
from app.common.email_utils import render_premium_email, send_email

router = APIRouter(prefix="/api/gate-entries/quality", tags=["gate"])
logger = logging.getLogger(__name__)


@router.get("/issues")
async def list_quality_issues(
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    if not any(role in user.roles for role in ("PROCUREMENT", "SUPPLIER", "ADMIN")):
        raise HTTPException(status_code=403, detail="Quality issues are available to Procurement and Suppliers")

    stmt = (
        select(DockAssignmentModel, GateEntryModel, AsnModel, SupplierModel)
        .join(GateEntryModel, GateEntryModel.id == DockAssignmentModel.gate_entry_id)
        .outerjoin(AsnModel, AsnModel.id == DockAssignmentModel.asn_id)
        .outerjoin(SupplierModel, SupplierModel.id == AsnModel.supplier_id)
        .where(DockAssignmentModel.quality_issue_status.is_not(None))
        .order_by(DockAssignmentModel.quality_issue_sent_at.desc())
    )

    if "SUPPLIER" in user.roles:
        supplier_id = user.raw_claims.get("supplier_id")
        if not supplier_id:
            return []
        try:
            supplier_uuid = uuid.UUID(str(supplier_id))
        except ValueError:
            return []
        stmt = stmt.where(AsnModel.supplier_id == supplier_uuid, DockAssignmentModel.quality_issue_status == "SUPPLIER_SENT")

    rows = (await uow.session.execute(stmt)).all()

    legacy_issues = [{
        "gate_entry_id": str(gate.id),
        "asn_number": asn.asn_number if asn else None,
        "po_number": gate.po_number,
        "vehicle_number": assignment.vehicle_number,
        "supplier_name": supplier.supplier_name if supplier else None,
        "status": assignment.quality_issue_status,
        "filename": assignment.quality_issue_filename,
        "content_type": assignment.quality_issue_content_type,
        "image_base64": base64.b64encode(assignment.quality_issue_image_data).decode("ascii") if assignment.quality_issue_image_data else None,
        "sent_at": assignment.quality_issue_sent_at.isoformat() if assignment.quality_issue_sent_at else None,
        "forwarded_at": assignment.quality_issue_forwarded_at.isoformat() if assignment.quality_issue_forwarded_at else None,
    } for assignment, gate, asn, supplier in rows]

    damage_stmt = (
        select(DamageReportModel, ReceivingLineModel, GateEntryModel, AsnModel, SupplierModel, SupplierDamageClaimModel)
        .join(ReceivingLineModel, ReceivingLineModel.id == DamageReportModel.receiving_line_id)
        .join(GateEntryModel, GateEntryModel.id == DamageReportModel.gate_entry_id)
        .outerjoin(AsnModel, AsnModel.id == GateEntryModel.asn_id)
        .outerjoin(SupplierModel, SupplierModel.id == AsnModel.supplier_id)
        .outerjoin(SupplierDamageClaimModel, SupplierDamageClaimModel.damage_report_id == DamageReportModel.id)
        .where(DamageReportModel.submitted_at.is_not(None))
        .order_by(DamageReportModel.submitted_at.desc())
    )
    if "SUPPLIER" in user.roles:
        supplier_id = user.raw_claims.get("supplier_id")
        if not supplier_id:
            return legacy_issues
        try:
            supplier_uuid = uuid.UUID(str(supplier_id))
        except ValueError:
            return legacy_issues
        damage_stmt = damage_stmt.where(SupplierModel.id == supplier_uuid, SupplierDamageClaimModel.id.is_not(None))
    damage_rows = (await uow.session.execute(damage_stmt)).all()
    damage_issues = []
    for report, line, gate, asn, supplier, claim in damage_rows:
        photos = (await uow.session.execute(select(DamagePhotoModel).where(
            DamagePhotoModel.damage_report_id == report.id
        ))).scalars().all()
        damage_issues.append({
            "type": "DAMAGE_REPORT", "id": str(report.id), "gate_entry_id": str(gate.id),
            "report_number": report.report_number, "claim_number": claim.claim_number if claim else None,
            "asn_number": asn.asn_number if asn else None, "po_number": report.po_number,
            "grn_number": report.grn_number, "supplier_name": supplier.supplier_name if supplier else None,
            "material": report.material_name or report.material_code,
            "received_quantity": float(report.received_quantity), "damaged_quantity": float(report.damaged_quantity),
            "uom": line.uom, "damage_reason": report.damage_reason, "remarks": report.remarks,
            "inspection_date": report.inspection_date.isoformat(), "inspector": report.inspector,
            "status": claim.status if claim else report.status,
            "photos": [{"filename": p.filename, "content_type": p.content_type,
                        "image_base64": base64.b64encode(p.image_data).decode("ascii")} for p in photos],
        })
    return damage_issues + legacy_issues


@router.post("/damage-reports/{report_id}/claims", status_code=201)
async def create_supplier_damage_claim(
    report_id: str,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    if "PROCUREMENT" not in user.roles and "ADMIN" not in user.roles:
        raise HTTPException(status_code=403, detail="Only Procurement can create supplier claims")
    try:
        damage_id = uuid.UUID(report_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Damage report was not found")
    row = (await uow.session.execute(
        select(DamageReportModel, ReceivingLineModel, GateEntryModel, AsnModel, SupplierModel, SupplierContactModel)
        .join(ReceivingLineModel, ReceivingLineModel.id == DamageReportModel.receiving_line_id)
        .join(GateEntryModel, GateEntryModel.id == DamageReportModel.gate_entry_id)
        .outerjoin(AsnModel, AsnModel.id == GateEntryModel.asn_id)
        .outerjoin(SupplierModel, SupplierModel.id == AsnModel.supplier_id)
        .outerjoin(SupplierContactModel, SupplierContactModel.supplier_id == SupplierModel.id)
        .where(DamageReportModel.id == damage_id)
    )).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Damage report was not found")
    report, line, gate, asn, supplier, contact = row
    if report.submitted_at is None:
        raise HTTPException(status_code=409, detail="Warehouse has not submitted this damage report")
    existing = (await uow.session.execute(select(SupplierDamageClaimModel).where(
        SupplierDamageClaimModel.damage_report_id == report.id
    ))).scalar_one_or_none()
    if existing:
        return {"claim_number": existing.claim_number, "status": existing.status, "recipient": contact.primary_email if contact else None}
    if supplier is None or contact is None or not contact.primary_email:
        raise HTTPException(status_code=409, detail="Supplier contact email is not configured")
    last_claim = (await uow.session.execute(select(func.max(SupplierDamageClaimModel.claim_number)))).scalar_one_or_none()
    try:
        sequence = int(last_claim.split("-", 1)[1]) + 1 if last_claim else 1
    except (ValueError, IndexError):
        sequence = 1
    claim_number = f"DC-{sequence:05d}"
    photos = (await uow.session.execute(select(DamagePhotoModel).where(DamagePhotoModel.damage_report_id == report.id))).scalars().all()
    subject = f"Damage Claim {claim_number} - {report.po_number}"
    body = (f"Dear {supplier.supplier_name},\n\nDamage Claim: {claim_number}\nPO: {report.po_number}\n"
            f"Material: {report.material_name or report.material_code}\nDamaged Qty: {report.damaged_quantity} {line.uom or ''}\n"
            f"Reason: {report.damage_reason}\n\nInspection photos are attached.\n\nRegards,\nKaizenX Procurement Team")
    html = render_premium_email(
        eyebrow="Supplier damage claim", title=f"Damage Claim {claim_number}", greeting=f"Hello {supplier.supplier_name},",
        intro="Procurement has raised a claim for material damaged on receipt.",
        details=[("PO", report.po_number), ("Material", report.material_name or report.material_code),
                 ("Damaged quantity", f"{report.damaged_quantity} {line.uom or ''}"), ("Reason", report.damage_reason)],
        primary_cta=("Review damage claim", "http://localhost:8080/supplier/quality-issues"),
        note="Inspection photos are attached for review.",
    )
    delivered = await send_email(contact.primary_email, subject, body, html,
                                 [(p.filename, p.image_data, p.content_type) for p in photos])
    if delivered is not True:
        raise HTTPException(status_code=503, detail="SMTP is not configured; supplier claim was not sent")
    now = datetime.datetime.now(datetime.timezone.utc)
    claim = SupplierDamageClaimModel(claim_number=claim_number, damage_report_id=report.id,
                                     supplier_id=supplier.id, status="SUPPLIER_SENT", created_by=user.username,
                                     created_at=now, sent_at=now)
    uow.session.add(claim)
    report.status = "SUPPLIER_CLAIM_SENT"
    uow.session.add(NotificationModel(user_role="SUPPLIER", title=f"Damage Claim {claim_number}",
                                      message=f"Claim for {report.damaged_quantity} {line.uom or ''} {report.material_name or report.material_code} against {report.po_number}.",
                                      link="/supplier/quality-issues"))
    await uow.session.flush()
    return {"claim_number": claim_number, "status": claim.status, "recipient": contact.primary_email, "sent_at": now.isoformat()}


@router.post("/issues/{entry_id}/forward")
async def forward_quality_issue_to_supplier(
    entry_id: str,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
):
    if "PROCUREMENT" not in user.roles and "ADMIN" not in user.roles:
        raise HTTPException(status_code=403, detail="Only Procurement can forward quality issues")

    try:
        gate_id = uuid.UUID(entry_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Quality issue was not found")

    row = (await uow.session.execute(
        select(DockAssignmentModel, GateEntryModel, AsnModel, SupplierModel, SupplierContactModel)
        .join(GateEntryModel, GateEntryModel.id == DockAssignmentModel.gate_entry_id)
        .outerjoin(AsnModel, AsnModel.id == DockAssignmentModel.asn_id)
        .outerjoin(SupplierModel, SupplierModel.id == AsnModel.supplier_id)
        .outerjoin(SupplierContactModel, SupplierContactModel.supplier_id == SupplierModel.id)
        .where(DockAssignmentModel.gate_entry_id == gate_id)
    )).first()

    if row is None or row[0].quality_issue_status is None:
        raise HTTPException(status_code=404, detail="Quality issue was not found")

    assignment, gate, asn, supplier, contact = row
    if not assignment.quality_issue_image_data:
        raise HTTPException(status_code=409, detail="The quality issue has no inspection image")
    if contact is None or not contact.primary_email:
        raise HTTPException(status_code=409, detail="The supplier does not have a primary contact email")

    # Generate or reset portal credentials for the supplier only if they don't have a permanent one
    su_stmt = select(SupplierUserModel).where(SupplierUserModel.supplier_id == supplier.id)
    su_result = await uow.session.execute(su_stmt)
    sup_user = su_result.scalar_one_or_none()

    temp_password = None
    if sup_user:
        portal_username = sup_user.username
        # Only provide/reset password if they haven't changed it yet
        if sup_user.must_change_password:
            temp_password = f"Sup{uuid.uuid4().hex[:6].upper()}!"
            sup_user.password_hash = hashlib.sha256(temp_password.encode()).hexdigest()
    else:
        portal_username = f"sup_{supplier.supplier_code or str(supplier.id)[:8]}".lower()
        temp_password = f"Sup{uuid.uuid4().hex[:6].upper()}!"
        password_hash = hashlib.sha256(temp_password.encode()).hexdigest()
        sup_user = SupplierUserModel(
            id=uuid.uuid4(),
            supplier_id=supplier.id,
            username=portal_username,
            password_hash=password_hash,
            must_change_password=True
        )
        uow.session.add(sup_user)

    # Generate a one-time magic link token (valid for 24 hours)
    # In a real app, this would be a signed JWT or stored in a tokens table.
    # For this implementation, we'll use a simple base64 encoded credential string that the login page can parse.
    auth_payload = f"{portal_username}:{sup_user.password_hash}"
    magic_token = base64.b64encode(auth_payload.encode()).decode()
    magic_link = f"http://localhost:8080/login?token={magic_token}&next=/supplier/quality-issues"

    subject = f"Quality inspection issue - {asn.asn_number if asn else gate.po_number}"

    cred_text = f"Username: {portal_username}\n"
    if temp_password:
        cred_text += f"Temporary Password: {temp_password}\n"
    else:
        cred_text += "Password: Use your registered portal password\n"

    body = (
        f"Dear {supplier.supplier_name if supplier else 'Supplier'},\n\n"
        "A warehouse quality inspection has failed. The inspection image is attached for your review.\n\n"
        f"ASN: {asn.asn_number if asn else 'N/A'}\n"
        f"PO: {gate.po_number or 'N/A'}\n"
        f"Vehicle: {assignment.vehicle_number or 'N/A'}\n\n"
        "Portal Access:\n"
        f"{cred_text}\n"
        f"Quick Login Link: {magic_link}\n\n"
        "Regards,\nKaizenX Procurement Team"
    )

    details = [
        ("ASN", asn.asn_number if asn else "N/A"),
        ("PO", gate.po_number or "N/A"),
        ("Vehicle", assignment.vehicle_number or "N/A"),
        ("Portal Username", portal_username),
    ]
    if temp_password:
        details.append(("Temporary Password", temp_password))
    else:
        details.append(("Password", "Use your registered password"))

    html_body = render_premium_email(
        eyebrow="Supplier quality issue",
        title="Inspection evidence requires your review",
        greeting=f"Hello {supplier.supplier_name if supplier else 'Supplier'},",
        intro="A warehouse quality inspection has failed. The inspection image is attached for your review.",
        details=details,
        primary_cta=("One-Click Login & Review", magic_link),
        note="You can use the link above to log in automatically, or use the credentials provided.",
    )

    try:
        delivered = await send_email(
            contact.primary_email,
            subject,
            body,
            html_body,
            [(assignment.quality_issue_filename or "inspection-evidence.jpg", assignment.quality_issue_image_data, assignment.quality_issue_content_type or "image/jpeg")],
        )
    except Exception as exc:
        logger.exception("Quality issue email delivery failed for %s", contact.primary_email)
        raise HTTPException(status_code=502, detail=f"Email delivery failed: {exc}") from exc

    if delivered is not True:
        raise HTTPException(status_code=503, detail="SMTP is not configured; quality issue email was not sent")

    assignment.quality_issue_status = "SUPPLIER_SENT"
    assignment.quality_issue_forwarded_at = datetime.datetime.now(datetime.timezone.utc)
    uow.session.add(NotificationModel(user_role="SUPPLIER", title="Quality Issue Received", message=f"Procurement emailed failed inspection evidence for vehicle {assignment.vehicle_number}.", link="/supplier/quality-issues"))
    await uow.session.flush()

    return {
        "gate_entry_id": entry_id,
        "status": assignment.quality_issue_status,
        "forwarded_at": assignment.quality_issue_forwarded_at.isoformat(),
        "recipient": contact.primary_email
    }
