from datetime import date
from decimal import Decimal
import asyncio
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, delete
from fastapi import HTTPException
from app.main import app
from app.database.session import session_scope
from app.modules.assembly.infrastructure.persistence.models import (
    AssemblyOrderModel, AssemblyFinishedGoodsModel, AssemblyQualityInspectionModel, FinishedGoodsSectionModel,
)
from app.modules.gate.infrastructure.persistence.models import FinishedGoodsPickupGateVisitModel
from app.common.persistence.models import FinishedGoodsRequestModel, NotificationModel


def headers(role, subject="section_supplier"):
    return {"X-User-Roles": role, "X-User-Id": subject, "X-User-Name": subject}


@pytest.mark.asyncio
async def test_two_vehicle_section_dispatch_and_guards():
    order_id, source_id = uuid.uuid4(), uuid.uuid4()
    token = uuid.uuid4().hex[:10]
    fg_id = None
    request_ids = []
    async with session_scope() as db:
        db.add(AssemblyOrderModel(id=order_id, order_number=f"SECTION-{token}", product_code=f"PROD-{token}",
            product_name="Transportable product", status="QC_PENDING", planned_quantity=Decimal(1),
            completed_quantity=Decimal(1), created_by="test"))
        db.add(FinishedGoodsRequestModel(id=source_id, request_number=f"SOURCE-{token}", material_code=f"PROD-{token}",
            material_name="Transportable product", quantity=1, uom="PCS", warehouse="ASSEMBLY", requested_by="test",
            department="SUPPLIER", required_date=date.today(), supplier_id="section_supplier", work_order_id=order_id))
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            qc_payload = {"order_id": str(order_id), "passed_quantity": 1, "failed_quantity": 0, "rework_quantity": 0,
                "held_quantity": 0, "inspector_name": "Quality Inspector", "authorized_person_confirmed": True}
            qc = await client.post("/api/v1/assembly/quality/inspect", json=qc_payload, headers=headers("QUALITY"))
            assert qc.status_code == 200, qc.text
            fg_id = uuid.UUID(qc.json()["finished_goods"]["fg_id"])
            original_qr = qc.json()["finished_goods"]["qr_code"]
            retry = await client.post("/api/v1/assembly/quality/inspect", json=qc_payload, headers=headers("QUALITY"))
            assert retry.status_code in (200, 400, 409)
            detail = await client.get(f"/api/v1/assembly/finished-goods/{fg_id}", headers=headers("ASSEMBLY"))
            assert detail.status_code == 200, detail.text
            sections = detail.json()["sections"]
            assert len(sections) == len({s["qr_identity"] for s in sections}) == 8
            assert [s["sub_id"][-4:] for s in sections] == [f"-S{n:02d}" for n in range(1, 9)]
            assert detail.json()["qr_code"] == original_qr
            own = await client.get("/api/v1/assembly/supplier/pickup-finished-goods", headers=headers("SUPPLIER"))
            assert str(fg_id) in [r["id"] for r in own.json()]
            other = await client.get("/api/v1/assembly/supplier/pickup-finished-goods", headers=headers("SUPPLIER", "other"))
            assert str(fg_id) in [r["id"] for r in other.json()]
            assert next(r for r in other.json() if r["id"] == str(fg_id))["dispatch_eligible"] is True
            denied = await client.get("/api/v1/assembly/fg-loading", headers=headers("SUPPLIER"))
            assert denied.status_code == 403
            for index, chosen in enumerate((sections[:3], sections[3:])):
                registration = {"finished_goods_id": str(fg_id), "product_code": "ignored", "product_name": "ignored",
                    "quantity": 1, "vehicle_number": f"KA02AH{2755+index}", "driver_name": "Ravi Kumar",
                    "driver_contact": "9876543210", "expected_pickup_date": date.today().isoformat()}
                unauthorized = await client.post("/api/v1/assembly/supplier/finished-goods-dispatch-requests", json=registration, headers=headers("ASSEMBLY"))
                assert unauthorized.status_code == 403
                registered = await client.post("/api/v1/assembly/supplier/finished-goods-dispatch-requests", json=registration, headers=headers("SUPPLIER", "section_supplier" if index == 0 else "other"))
                assert registered.status_code == 200, registered.text
                number = registered.json()["request_number"]
                async with session_scope() as db:
                    request_ids.append(await db.scalar(select(FinishedGoodsRequestModel.id).where(FinishedGoodsRequestModel.request_number == number)))
                queue_before_entry = await client.get("/api/v1/assembly/fg-loading", headers=headers("ASSEMBLY"))
                assert queue_before_entry.status_code == 200
                assert not any(row["fg_id"] == str(fg_id) for row in queue_before_entry.json())
                before_entry = await client.post("/api/v1/assembly/fg-loading/NOENTRY/confirm",
                    json={"qr_identities": [chosen[0]["qr_identity"]]}, headers=headers("ASSEMBLY"))
                assert before_entry.status_code == 409
                entry_payload = {k: registration[k] for k in ("vehicle_number", "driver_name", "driver_contact")}
                entry_payload["request_number"] = number
                entry = await client.post("/api/gate-entries/finished-goods-pickup", json=entry_payload, headers=headers("ADMIN"))
                assert entry.status_code == 201, entry.text
                gate_pass = entry.json()["gate_pass_number"]
                queue_after_entry = await client.get("/api/v1/assembly/fg-loading", headers=headers("ASSEMBLY"))
                assert any(row["fg_id"] == str(fg_id) and row["gate_pass_number"] == gate_pass for row in queue_after_entry.json())
                premature_exit = await client.post(f"/api/gate-entries/finished-goods-pickup/{gate_pass}/exit",
                    json={"vehicle_number": registration["vehicle_number"], "driver_name": registration["driver_name"],
                          "documents_verified": True, "section_qr_identities": [s["qr_identity"] for s in chosen]}, headers=headers("ADMIN"))
                assert premature_exit.status_code == 409
                repeated = await client.post("/api/gate-entries/finished-goods-pickup", json=entry_payload, headers=headers("ADMIN"))
                assert repeated.json()["gate_pass_number"] == gate_pass
                scans = [s["qr_identity"] for s in chosen]
                load_url = f"/api/v1/assembly/fg-loading/{gate_pass}/confirm"
                denied = await client.post(load_url, json={"qr_identities": scans}, headers=headers("SUPPLIER"))
                assert denied.status_code == 403
                invalid = await client.post(load_url, json={"qr_identities": [scans[0], "WRONG"]}, headers=headers("ASSEMBLY"))
                assert invalid.status_code == 409
                results = await asyncio.gather(*[client.post(load_url, json={"qr_identities": scans}, headers=headers("ASSEMBLY")) for _ in range(2)])
                assert sorted(r.status_code for r in results) == [200, 409], [r.text for r in results]
                duplicate = await client.post(load_url, json={"qr_identities": scans}, headers=headers("ASSEMBLY"))
                assert duplicate.status_code == 409
                before_exit = await client.get(f"/api/v1/assembly/finished-goods/{fg_id}", headers=headers("ASSEMBLY"))
                assert before_exit.json()["dispatched_sections"] == (0 if index == 0 else 3)
                exit_payload = {"vehicle_number": registration["vehicle_number"], "driver_name": registration["driver_name"],
                    "documents_verified": True, "section_qr_identities": scans}
                wrong = await client.post(f"/api/gate-entries/finished-goods-pickup/{gate_pass}/exit", json={**exit_payload, "section_qr_identities": scans[:-1]}, headers=headers("ADMIN"))
                assert wrong.status_code == 422
                exited = await client.post(f"/api/gate-entries/finished-goods-pickup/{gate_pass}/exit", json=exit_payload, headers=headers("ADMIN"))
                assert exited.status_code == 200, exited.text
                assert exited.json()["gate_pass_number"] == gate_pass
                assert exited.json()["dispatched_sections"] == (3 if index == 0 else 8)
                assert exited.json()["dispatch_status"] == ("PARTIALLY_DISPATCHED" if index == 0 else "FULLY_DISPATCHED")
                duplicate_exit = await client.post(f"/api/gate-entries/finished-goods-pickup/{gate_pass}/exit", json=exit_payload, headers=headers("ADMIN"))
                assert duplicate_exit.status_code == 409
            final = await client.get(f"/api/v1/assembly/finished-goods/{fg_id}", headers=headers("ASSEMBLY"))
            assert final.json()["qr_code"] == original_qr
            trace = await client.get(f"/api/v1/assembly/finished-goods/{fg_id}/traceability", headers=headers("ASSEMBLY"))
            assert trace.status_code == 200, trace.text
            assert trace.json()["finished_goods"]["qr_identity"] == original_qr
    finally:
        async with session_scope() as db:
            if fg_id:
                await db.execute(delete(FinishedGoodsSectionModel).where(FinishedGoodsSectionModel.finished_goods_id == fg_id))
            if request_ids:
                await db.execute(delete(FinishedGoodsPickupGateVisitModel).where(FinishedGoodsPickupGateVisitModel.request_id.in_(request_ids)))
                await db.execute(delete(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.id.in_(request_ids)))
            await db.execute(delete(AssemblyQualityInspectionModel).where(AssemblyQualityInspectionModel.assembly_order_id == order_id))
            await db.execute(delete(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.assembly_order_id == order_id))
            await db.execute(delete(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.id == source_id))
            await db.execute(delete(AssemblyOrderModel).where(AssemblyOrderModel.id == order_id))


@pytest.mark.asyncio
async def test_different_vehicles_cannot_concurrently_load_same_section():
    from app.modules.assembly.infrastructure.sections import generate_sections, transition_sections
    order_id, fg_id, request_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    token = uuid.uuid4().hex[:10]
    visit_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
    try:
        async with session_scope() as db:
            db.add(AssemblyOrderModel(id=order_id, order_number=f"RACE-{token}", product_name="Race FG", created_by="test"))
            await db.flush()
            fg = AssemblyFinishedGoodsModel(id=fg_id, assembly_order_id=order_id, product_code="RACE", product_name="Race FG",
                quantity=1, status="QC_APPROVED", warehouse_id="ASSEMBLY", location_code="ASSEMBLY-STORAGE-01", on_hand_before=0, on_hand_after=1)
            db.add(fg)
            db.add(FinishedGoodsRequestModel(id=request_id, request_number=f"RACE-REQ-{token}", material_code="RACE",
                material_name="Race FG", quantity=1, warehouse="ASSEMBLY", requested_by="test", department="SUPPLIER", required_date=date.today()))
            await db.flush()
            for i, visit_id in enumerate(visit_ids):
                db.add(FinishedGoodsPickupGateVisitModel(id=visit_id, request_id=request_id, gate_pass_number=uuid.uuid4().hex[:6].upper(),
                    supplier_name="test", vehicle_number=f"KA02AH{3000+i}", driver_name="Ravi Kumar", driver_contact="9876543210", security_officer="test"))
            rows = await generate_sections(db, fg)
            qr_identity = rows[0].qr_identity

        async def attempt(visit_id):
            try:
                async with session_scope() as db:
                    await transition_sections(db, fg_id, visit_id, [qr_identity], "test")
                return 200
            except HTTPException as exc:
                return exc.status_code

        assert sorted(await asyncio.gather(*(attempt(v) for v in visit_ids))) == [200, 409]
        async with session_scope() as db:
            loaded = (await db.scalars(select(FinishedGoodsSectionModel).where(
                FinishedGoodsSectionModel.finished_goods_id == fg_id, FinishedGoodsSectionModel.status == "LOADED"))).all()
            assert len(loaded) == 1
            assert loaded[0].gate_visit_id in visit_ids
    finally:
        async with session_scope() as db:
            await db.execute(delete(FinishedGoodsSectionModel).where(FinishedGoodsSectionModel.finished_goods_id == fg_id))
            await db.execute(delete(FinishedGoodsPickupGateVisitModel).where(FinishedGoodsPickupGateVisitModel.id.in_(visit_ids)))
            await db.execute(delete(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.id == request_id))
            await db.execute(delete(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.id == fg_id))
            await db.execute(delete(AssemblyOrderModel).where(AssemblyOrderModel.id == order_id))


@pytest.mark.asyncio
async def test_supplier_catalog_lists_historical_fg_without_silently_creating_sections():
    order_id, fg_id = uuid.uuid4(), uuid.uuid4()
    try:
        async with session_scope() as db:
            db.add(AssemblyOrderModel(id=order_id, order_number="CATALOG-"+order_id.hex, product_name="Historical catalog FG",created_by="test"))
            await db.flush()
            db.add(AssemblyFinishedGoodsModel(id=fg_id, assembly_order_id=order_id, product_code="CATALOG-HISTORY",
                product_name="Historical catalog FG", quantity=1, status="QC_APPROVED",warehouse_id="ASSEMBLY",
                location_code="ASSEMBLY-STORAGE-01",on_hand_before=0,on_hand_after=1,section_supplier_id="another-supplier"))
        async with AsyncClient(transport=ASGITransport(app=app),base_url="http://test") as client:
            response=await client.get("/api/v1/assembly/supplier/pickup-finished-goods",headers=headers("SUPPLIER"))
            assert response.status_code==200,response.text
            fg=next(r for r in response.json() if r["id"]==str(fg_id))
            assert fg["dispatch_eligible"] is False
            assert fg["remaining_sections"]==0
            assert fg["eligibility_reason"]=="Assembly must create transport sections"
            payload={"finished_goods_id":str(fg_id),"product_code":"CATALOG-HISTORY","product_name":"Historical catalog FG",
                "quantity":1,"vehicle_number":"KA02AH2755","driver_name":"Ravi Kumar","driver_contact":"9876543210",
                "expected_pickup_date":date.today().isoformat()}
            rejected=await client.post("/api/v1/assembly/supplier/finished-goods-dispatch-requests",json=payload,headers=headers("SUPPLIER"))
            assert rejected.status_code==409,rejected.text
        async with session_scope() as db:
            assert not (await db.scalars(select(FinishedGoodsSectionModel.id).where(FinishedGoodsSectionModel.finished_goods_id==fg_id))).all()
    finally:
        async with session_scope() as db:
            await db.execute(delete(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.id==fg_id))
            await db.execute(delete(AssemblyOrderModel).where(AssemblyOrderModel.id==order_id))
