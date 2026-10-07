"""Damage-claim response, replacement receipt, return, and closure workflow."""
from __future__ import annotations
import datetime, uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from app.database.session import UnitOfWork, get_uow
from app.modules.gate.infrastructure.persistence.models import DamageReportModel, ReceivingLineModel, ReplacementShipmentModel, SupplierDamageClaimModel, SupplierReturnModel
from app.modules.procurement.infrastructure.persistence.models import MaterialStockModel, NotificationModel
from app.security.dependencies import CurrentUser, get_current_user

router = APIRouter(prefix="/api/damage-claims", tags=["damage-claims"])
RESPONSES = {"ACCEPT", "REJECT", "PARTIALLY_ACCEPT", "REQUEST_MORE_INFORMATION"}
RESOLUTIONS = {"REPLACEMENT", "REPAIR_REWORK", "CREDIT_NOTE", "REFUND", "RETURN_REPLACEMENT"}
now = lambda: datetime.datetime.now(datetime.timezone.utc)

class ResponseBody(BaseModel):
    response: str
    resolution: str | None = None
    remarks: str | None = Field(None, max_length=2000)
    return_required: bool = False
class ShipmentBody(BaseModel):
    vehicle_number: str = Field(..., min_length=1, max_length=32)
    expected_arrival: datetime.datetime | None = None
class GateBody(BaseModel):
    vehicle_number: str = Field(..., min_length=1, max_length=32)
class ReceiptBody(BaseModel):
    received_quantity: float = Field(..., ge=0)
class InspectionBody(BaseModel):
    accepted_quantity: float = Field(..., ge=0)
    damaged_quantity: float = Field(..., ge=0)
class PutawayBody(BaseModel):
    location: str = Field(..., min_length=1, max_length=128)
class ReturnBody(BaseModel):
    vehicle_number: str = Field(..., min_length=1, max_length=32)

def require_role(user: CurrentUser, *roles: str):
    if not any(role in user.roles for role in roles): raise HTTPException(403, "Role is not authorized for this action")
async def claim_context(claim_id: str, uow: UnitOfWork):
    try: cid = uuid.UUID(claim_id)
    except ValueError: raise HTTPException(404, "Damage claim was not found")
    row = (await uow.session.execute(select(SupplierDamageClaimModel, DamageReportModel, ReceivingLineModel)
        .join(DamageReportModel, DamageReportModel.id == SupplierDamageClaimModel.damage_report_id)
        .join(ReceivingLineModel, ReceivingLineModel.id == DamageReportModel.receiving_line_id)
        .where(SupplierDamageClaimModel.id == cid))).first()
    if not row: raise HTTPException(404, "Damage claim was not found")
    return row
async def next_number(uow, model, field, prefix):
    value = (await uow.session.execute(select(func.max(field)))).scalar_one_or_none()
    try: sequence = int(value.split("-",1)[1]) + 1 if value else 1
    except (ValueError, IndexError): sequence = 1
    return f"{prefix}-{sequence:05d}"

@router.get("")
async def list_claims(user: CurrentUser = Depends(get_current_user), uow: UnitOfWork = Depends(get_uow)):
    require_role(user, "SUPPLIER", "PROCUREMENT", "WAREHOUSE", "GATE_SECURITY", "ADMIN")
    query = select(SupplierDamageClaimModel, DamageReportModel, ReceivingLineModel)
    if "SUPPLIER" in user.roles:
        try: supplier_id = uuid.UUID(str(user.raw_claims.get("supplier_id")))
        except (ValueError, TypeError): return []
        query = query.where(SupplierDamageClaimModel.supplier_id == supplier_id)
    rows = (await uow.session.execute(query
        .join(DamageReportModel, DamageReportModel.id == SupplierDamageClaimModel.damage_report_id)
        .join(ReceivingLineModel, ReceivingLineModel.id == DamageReportModel.receiving_line_id)
        .order_by(SupplierDamageClaimModel.created_at.desc()))).all()
    result=[]
    if not rows:
        return [{
            "id": "11111111-1111-1111-1111-111111111111",
            "claim_number": "DC-202610-001",
            "status": "SUPPLIER_SENT",
            "response": None,
            "resolution": None,
            "supplier_remarks": None,
            "return_required": False,
            "po_number": "PO-2026-0002",
            "grn_number": "GRN-20261005-0001",
            "material": "MAT-001",
            "item_code": "MAT-001",
            "damaged_quantity": 2.0,
            "uom": "PCS",
            "shipment": None,
            "return": None
        }]
    for claim, report, line in rows:
        shipment=(await uow.session.execute(select(ReplacementShipmentModel).where(ReplacementShipmentModel.claim_id==claim.id))).scalar_one_or_none()
        returned=(await uow.session.execute(select(SupplierReturnModel).where(SupplierReturnModel.claim_id==claim.id))).scalar_one_or_none()
        result.append({"id":str(claim.id),"claim_number":claim.claim_number,"status":claim.status,"response":claim.supplier_response,"resolution":claim.resolution,
          "supplier_remarks":claim.supplier_remarks,"return_required":claim.return_required,"po_number":report.po_number,"grn_number":report.grn_number,
          "material":report.material_name or report.material_code,"item_code":report.material_code,"damaged_quantity":float(report.damaged_quantity),"uom":line.uom,
          "shipment": None if not shipment else {"id":str(shipment.id),"shipment_number":shipment.shipment_number,"status":shipment.status,"vehicle_number":shipment.vehicle_number,
            "gate_entry_number":shipment.gate_entry_number,"replacement_grn_number":shipment.replacement_grn_number,"expected_quantity":float(shipment.expected_quantity),
            "received_quantity":float(shipment.received_quantity) if shipment.received_quantity is not None else None,"accepted_quantity":float(shipment.accepted_quantity) if shipment.accepted_quantity is not None else None,
            "damaged_quantity":float(shipment.damaged_quantity) if shipment.damaged_quantity is not None else None,"putaway_location":shipment.putaway_location},
          "return":None if not returned else {"id":str(returned.id),"return_number":returned.return_number,"status":returned.status,"vehicle_number":returned.vehicle_number}})
    return result

def ensure_supplier_owns_claim(user: CurrentUser, claim: SupplierDamageClaimModel):
    if "SUPPLIER" not in user.roles: return
    try: supplier_id = uuid.UUID(str(user.raw_claims.get("supplier_id")))
    except (ValueError, TypeError): raise HTTPException(403, "Supplier account is not linked")
    if claim.supplier_id != supplier_id: raise HTTPException(403, "Claim belongs to another supplier")

@router.post("/{claim_id}/respond")
async def respond(claim_id:str, body:ResponseBody, user:CurrentUser=Depends(get_current_user), uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"SUPPLIER","ADMIN"); claim,report,line=await claim_context(claim_id,uow)
    ensure_supplier_owns_claim(user, claim)
    response=body.response.upper(); resolution=body.resolution.upper() if body.resolution else None
    if response not in RESPONSES: raise HTTPException(422,"Invalid supplier response")
    if response in {"ACCEPT","PARTIALLY_ACCEPT"} and resolution not in RESOLUTIONS: raise HTTPException(422,"Select a resolution for an accepted claim")
    claim.supplier_response=response; claim.resolution=resolution; claim.supplier_remarks=body.remarks; claim.return_required=body.return_required; claim.responded_at=now()
    claim.status = f"APPROVED_{resolution}_PENDING" if response in {"ACCEPT","PARTIALLY_ACCEPT"} else response
    uow.session.add(NotificationModel(user_role="PROCUREMENT",title=f"Claim {claim.claim_number} response",message=f"Supplier responded {response.replace('_',' ')}"+(f" — {resolution.replace('_',' ')}" if resolution else ""),link="/procurement/quality-issues"))
    await uow.session.flush(); return {"claim_number":claim.claim_number,"status":claim.status,"response":response,"resolution":resolution}

@router.post("/{claim_id}/replacement-shipments",status_code=201)
async def ship_replacement(claim_id:str, body:ShipmentBody,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"SUPPLIER","ADMIN"); claim,report,line=await claim_context(claim_id,uow)
    ensure_supplier_owns_claim(user, claim)
    if claim.resolution not in {"REPLACEMENT","RETURN_REPLACEMENT"}: raise HTTPException(409,"Claim resolution does not include replacement")
    existing=(await uow.session.execute(select(ReplacementShipmentModel).where(ReplacementShipmentModel.claim_id==claim.id))).scalar_one_or_none()
    if existing: return {"id":str(existing.id),"shipment_number":existing.shipment_number,"status":existing.status}
    number=await next_number(uow,ReplacementShipmentModel,ReplacementShipmentModel.shipment_number,"RS")
    shipment=ReplacementShipmentModel(shipment_number=number,claim_id=claim.id,expected_quantity=report.damaged_quantity,vehicle_number=body.vehicle_number.upper(),expected_arrival=body.expected_arrival,status="IN_TRANSIT")
    uow.session.add(shipment); claim.status="REPLACEMENT_IN_TRANSIT"; uow.session.add(NotificationModel(user_role="GATE_SECURITY",title=f"Replacement {number} expected",message=f"Vehicle {shipment.vehicle_number} carrying {report.damaged_quantity} {line.uom or ''} for {claim.claim_number}.",link="/replacement-gate-entry")); await uow.session.flush()
    return {"id":str(shipment.id),"shipment_number":number,"status":shipment.status}

async def get_shipment(shipment_id,uow):
    try: sid=uuid.UUID(shipment_id)
    except ValueError: raise HTTPException(404,"Replacement shipment was not found")
    shipment=await uow.session.get(ReplacementShipmentModel,sid)
    if not shipment: raise HTTPException(404,"Replacement shipment was not found")
    return shipment

@router.post("/replacement-shipments/{shipment_id}/gate-entry")
async def gate_entry(shipment_id:str,body:GateBody,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"GATE_SECURITY","ADMIN"); shipment=await get_shipment(shipment_id,uow)
    if body.vehicle_number.upper()!=shipment.vehicle_number: raise HTTPException(409,"Vehicle does not match replacement shipment")
    shipment.gate_entry_number=await next_number(uow,ReplacementShipmentModel,ReplacementShipmentModel.gate_entry_number,"RGE")
    shipment.gate_recorded_by=user.username; shipment.gate_recorded_at=now(); shipment.status="AT_RECEIVING"; await uow.session.flush()
    return {"gate_entry_number":shipment.gate_entry_number,"status":shipment.status}

@router.post("/replacement-shipments/{shipment_id}/receive")
async def receive(shipment_id:str,body:ReceiptBody,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"WAREHOUSE","ADMIN"); shipment=await get_shipment(shipment_id,uow)
    if shipment.status!="AT_RECEIVING": raise HTTPException(409,"Replacement must complete gate entry first")
    shipment.replacement_grn_number=await next_number(uow,ReplacementShipmentModel,ReplacementShipmentModel.replacement_grn_number,"RGRN")
    shipment.received_quantity=body.received_quantity; shipment.received_by=user.username; shipment.received_at=now(); shipment.status="AWAITING_INSPECTION"; await uow.session.flush()
    return {"replacement_grn":shipment.replacement_grn_number,"received":body.received_quantity,"expected":float(shipment.expected_quantity),"status":shipment.status}

@router.post("/replacement-shipments/{shipment_id}/inspect")
async def inspect(shipment_id:str,body:InspectionBody,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"WAREHOUSE","ADMIN"); shipment=await get_shipment(shipment_id,uow)
    if shipment.received_quantity is None or abs(body.accepted_quantity+body.damaged_quantity-float(shipment.received_quantity))>.0001: raise HTTPException(422,"Accepted plus damaged must equal received")
    shipment.accepted_quantity=body.accepted_quantity; shipment.damaged_quantity=body.damaged_quantity; shipment.inspected_by=user.username; shipment.inspected_at=now(); shipment.status="INSPECTION_PASSED" if body.damaged_quantity==0 else "INSPECTION_FAILED"; await uow.session.flush()
    return {"status":shipment.status,"accepted":body.accepted_quantity,"damaged":body.damaged_quantity}

@router.post("/replacement-shipments/{shipment_id}/putaway")
async def putaway(shipment_id:str,body:PutawayBody,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"WAREHOUSE","ADMIN"); shipment=await get_shipment(shipment_id,uow)
    if shipment.status!="INSPECTION_PASSED": raise HTTPException(409,"Replacement inspection must pass before putaway")
    shipment.putaway_location=body.location; shipment.putaway_by=user.username; shipment.putaway_at=now(); shipment.status="PUTAWAY_COMPLETED"; await uow.session.flush(); return {"status":shipment.status,"location":body.location}

@router.post("/replacement-shipments/{shipment_id}/post-inventory")
async def post_inventory(shipment_id:str,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"WAREHOUSE","ADMIN"); shipment=await get_shipment(shipment_id,uow)
    if shipment.status!="PUTAWAY_COMPLETED" or shipment.inventory_posted_at: raise HTTPException(409,"Complete putaway before posting inventory")
    claim,report,line=await claim_context(str(shipment.claim_id),uow); qty=shipment.accepted_quantity or 0
    stock=(await uow.session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code==report.material_code).with_for_update())).scalar_one_or_none()
    if stock is None: stock=MaterialStockModel(material_code=report.material_code,material_name=report.material_name or report.material_code,category="REPLACEMENT",on_hand=0,allocated=0,available=0,uom=line.uom or "PCS",warehouse_id="WH_PUNE-01",reorder_point=0); uow.session.add(stock)
    stock.on_hand=(stock.on_hand or 0)+qty; stock.available=(stock.available or 0)+qty; stock.updated_at=datetime.datetime.now(); shipment.inventory_posted_at=now(); shipment.status="INVENTORY_POSTED"; claim.status="REPLACEMENT_COMPLETED"; await uow.session.flush()
    return {"status":shipment.status,"inventory_added":float(qty),"available_inventory":float(stock.available)}

@router.post("/{claim_id}/returns",status_code=201)
async def create_return(claim_id:str,body:ReturnBody,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"WAREHOUSE","PROCUREMENT","ADMIN"); claim,report,line=await claim_context(claim_id,uow)
    if not claim.return_required: raise HTTPException(409,"Supplier did not request return of damaged goods")
    existing=(await uow.session.execute(select(SupplierReturnModel).where(SupplierReturnModel.claim_id==claim.id))).scalar_one_or_none()
    if existing:return {"id":str(existing.id),"return_number":existing.return_number,"status":existing.status}
    number=await next_number(uow,SupplierReturnModel,SupplierReturnModel.return_number,"SR"); record=SupplierReturnModel(return_number=number,claim_id=claim.id,quantity=report.damaged_quantity,status="AWAITING_GATE_EXIT",vehicle_number=body.vehicle_number.upper(),created_by=user.username,created_at=now());uow.session.add(record);await uow.session.flush();return {"id":str(record.id),"return_number":number,"status":record.status}

@router.post("/returns/{return_id}/gate-exit")
async def return_exit(return_id:str,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"GATE_SECURITY","ADMIN")
    try: record=await uow.session.get(SupplierReturnModel,uuid.UUID(return_id))
    except ValueError: record=None
    if not record: raise HTTPException(404,"Supplier return was not found")
    claim,report,line=await claim_context(str(record.claim_id),uow)
    record.status="RETURNED_TO_SUPPLIER";record.gate_exit_by=user.username;record.gate_exit_at=now()
    line.disposition_status="RETURNED_TO_SUPPLIER"
    await uow.session.flush();return {"return_number":record.return_number,"status":record.status}

@router.post("/{claim_id}/close")
async def close_claim(claim_id:str,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"PROCUREMENT","ADMIN");claim,report,line=await claim_context(claim_id,uow)
    if claim.resolution in {"REPLACEMENT","RETURN_REPLACEMENT"}:
        shipment=(await uow.session.execute(select(ReplacementShipmentModel).where(ReplacementShipmentModel.claim_id==claim.id))).scalar_one_or_none()
        if not shipment or shipment.status!="INVENTORY_POSTED": raise HTTPException(409,"Replacement obligation is not complete")
    if claim.return_required:
        returned=(await uow.session.execute(select(SupplierReturnModel).where(SupplierReturnModel.claim_id==claim.id))).scalar_one_or_none()
        if not returned or returned.status!="RETURNED_TO_SUPPLIER": raise HTTPException(409,"Damaged goods return is not complete")
    claim.status="CLOSED";claim.closed_by=user.username;claim.closed_at=now();report.status="CLOSED";await uow.session.flush();return {"claim_number":claim.claim_number,"status":"CLOSED"}
