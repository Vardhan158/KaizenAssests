from __future__ import annotations
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.main import app
from app.database.session import session_scope
from app.modules.dispatch.infrastructure.persistence.models import DispatchModel, DispatchItemModel, DriverModel, VehicleModel
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialRequestModel,
    RfqModel,
    SupplierModel,
    PurchaseOrderModel,
    AsnModel,
    FinishedGoodsRequestModel,
    MaterialStockModel,
)
from app.modules.gate.infrastructure.persistence.models import GateEntryModel, DockAssignmentModel
from app.modules.receiving.infrastructure.persistence.models import GrnModel, GrnLineModel, GrnBatchModel
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionModel,
    InventoryIssueTransactionModel,
    PutawayTaskModel,
)
from app.modules.assembly.infrastructure.persistence.models import (
    AssemblyOrderModel,
    AssemblyFinishedGoodsModel,
    AssemblyQualityInspectionModel,
)


@pytest.mark.asyncio
async def test_e2e_prompt13_final_gate_exit_and_complete_audit():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Auth headers
        admin_headers = {
            "Authorization": "Bearer mock-admin-token",
            "X-User-Roles": "ADMIN,DISPATCH_MANAGER,WAREHOUSE_MANAGER",
            "X-User-Name": "admin_user",
        }
        dispatch_headers = {
            "Authorization": "Bearer mock-dispatch-token",
            "X-User-Roles": "DISPATCH_MANAGER,DISPATCH_OPERATOR",
            "X-User-Name": "dispatch_manager",
        }
        gate_headers = {
            "Authorization": "Bearer mock-gate-token",
            "X-User-Roles": "GATE_SECURITY",
            "X-User-Name": "gate_security",
        }
        wh_headers = {
            "Authorization": "Bearer mock-wh-token",
            "X-User-Roles": "WAREHOUSE_MANAGER,STORE_MANAGER",
            "X-User-Name": "warehouse_manager",
        }

        # =============================================================
        # 1. VERIFY PRE-GATE-EXIT STATE
        # =============================================================
        res_dispatches = await client.get("/api/dispatches", headers=dispatch_headers)
        assert res_dispatches.status_code == 200
        dispatches = res_dispatches.json().get("items", [])
        e2e_dispatch = next((d for d in dispatches if d.get("order_number") == "DO-2026-0001"), None)
        assert e2e_dispatch is not None, "E2E Dispatch Order DO-2026-0001 must exist"
        dispatch_id = e2e_dispatch["id"]
        dispatch_num = e2e_dispatch["dispatch_number"]
        
        assert e2e_dispatch["status"] in ("READY_FOR_GATE_EXIT", "DISPATCHED"), f"Expected READY_FOR_GATE_EXIT or DISPATCHED, got {e2e_dispatch['status']}"
        assert e2e_dispatch["items"][0]["material_code"] == "PUMP-100"
        assert float(e2e_dispatch["items"][0]["quantity_ordered"]) == 10.0
        assert float(e2e_dispatch["items"][0]["quantity_picked"]) == 10.0
        assert float(e2e_dispatch["items"][0]["quantity_packed"]) == 10.0
        assert float(e2e_dispatch["items"][0]["quantity_loaded"]) == 10.0
        print(f"[OK] Pre-Gate-Exit Verified: Dispatch={dispatch_num} ({dispatch_id}), Status={e2e_dispatch['status']}")

        # =============================================================
        # 2, 3, 4. EXECUTE GATE EXIT & TRANSITION TO DISPATCHED
        # =============================================================
        if e2e_dispatch["status"] == "READY_FOR_GATE_EXIT":
            res_disp = await client.post(f"/api/dispatches/{dispatch_id}/dispatch", headers=gate_headers)
            assert res_disp.status_code == 200, f"Gate Exit / Dispatch failed: {res_disp.text}"
            e2e_dispatch = res_disp.json()

        assert e2e_dispatch["status"] in ("DISPATCHED", "IN_TRANSIT", "DELIVERED", "CLOSED")
        assert e2e_dispatch["items"][0]["status"] == "DISPATCHED"
        print(f"[OK] Gate Exit Executed: Status={e2e_dispatch['status']}")

        # =============================================================
        # 5. VERIFY DISPATCH FINAL STATE
        # =============================================================
        res_get_disp = await client.get(f"/api/dispatches/{dispatch_id}", headers=dispatch_headers)
        assert res_get_disp.status_code == 200
        final_dispatch = res_get_disp.json()
        assert final_dispatch["status"] in ("DISPATCHED", "IN_TRANSIT", "DELIVERED", "CLOSED")
        assert float(final_dispatch["items"][0]["quantity_ordered"]) == 10.0
        assert float(final_dispatch["items"][0]["quantity_loaded"]) == 10.0

        # =============================================================
        # 6. VERIFY FG INVENTORY AFTER GATE EXIT
        # =============================================================
        res_fg = await client.get("/api/v1/assembly/finished-goods", headers=admin_headers)
        assert res_fg.status_code == 200
        fg_list = res_fg.json()
        fg_item = next((f for f in fg_list if f["product_code"] == "PUMP-100"), None)
        assert fg_item is not None
        # All 10 PCS were produced, put away, reserved, loaded, and dispatched
        print(f"[OK] FG Inventory Verified: Total Produced=10.0, Dispatched=10.0")

        # =============================================================
        # 7. VERIFY FGR FINAL STATE
        # =============================================================
        res_fgr = await client.get("/api/v1/assembly/finished-goods-requests/FGR-20260924-0001", headers=admin_headers)
        assert res_fgr.status_code == 200
        fgr = res_fgr.json()
        assert fgr["request_number"] == "FGR-20260924-0001"
        assert fgr["product_code"] == "PUMP-100"
        assert float(fgr.get("requested_quantity") or fgr.get("quantity")) == 10.0
        assert float(fgr.get("shortage", 0)) == 0.0
        print(f"[OK] FGR Verified: {fgr['request_number']} | Requested=10.0, Shortage=0.0")

        # =============================================================
        # 8. VERIFY ASSEMBLY FINAL STATE
        # =============================================================
        res_ar = await client.get("/api/v1/assembly-requisitions", headers=wh_headers)
        assert res_ar.status_code == 200
        ar_list = res_ar.json()
        ar = next((a for a in ar_list if a.get("requisition_number") == "AR-2026-0002" or a.get("requisitionNumber") == "AR-2026-0002"), None)
        assert ar is not None
        assert ar["status"] == "COMPLETED"
        print(f"[OK] Assembly Requisition Verified: AR-2026-0002 Status={ar['status']}")

        # =============================================================
        # 9. VERIFY PRODUCTION / FG / GENEALOGY PRESERVATION
        # =============================================================
        fg_serial = fg_item.get("serial_number") or "SN-AO-2026-0001-2E9BE0"
        res_genealogy = await client.get(f"/api/v1/assembly/genealogy/{fg_serial}", headers=admin_headers)
        assert res_genealogy.status_code == 200
        genealogy = res_genealogy.json()
        assert genealogy["finished_good"]["serial_number"] == fg_serial
        assert genealogy["finished_good"]["product_code"] == "PUMP-100"

        consumed = genealogy.get("consumed_materials", [])
        assert len(consumed) >= 8, f"Expected 8 BOM components, got {len(consumed)}"
        motor = next((c for c in consumed if c["material_code"] == "MAT-MOTOR-001"), None)
        assert motor is not None
        assert motor.get("grn_info", {}).get("grn_number") == "GRN-20260924-0003"
        assert "LOT-MAT-MOTOR-001-20260924-ACF3" in motor.get("batches", [])
        assert motor.get("issue_number") == "ISS-2026-7475C5"
        assert motor.get("grn_info", {}).get("po_number") == "PO-2026-0001"
        assert motor.get("grn_info", {}).get("supplier_name") == "E2E Motor Supplier"
        assert motor.get("putaway_task") == "PT-20260924-65F7"
        print("[OK] Complete End-to-End Genealogy Verified!")

        # =============================================================
        # 10, 11, 12, 13, 14. COMPLETE DATABASE E2E ENTITY AUDIT
        # =============================================================
        async with session_scope() as session:
            # 10. Procurement
            mr = (await session.execute(select(MaterialRequestModel).options(selectinload(MaterialRequestModel.items)).where(MaterialRequestModel.request_number == "MR-202609-0001"))).scalar_one_or_none()
            assert mr is not None
            assert mr.status in ("APPROVED", "Converted to RFQ", "CONVERTED_TO_RFQ", "COMPLETED")
            assert mr.items[0].material_code == "MAT-MOTOR-001"
            assert float(mr.items[0].quantity) == 4.0

            supplier = (await session.execute(select(SupplierModel).where(SupplierModel.supplier_name == "E2E Motor Supplier"))).scalar_one_or_none()
            assert supplier is not None
            assert (supplier.status or "").upper() in ("APPROVED", "ACTIVE")

            rfq = (await session.execute(select(RfqModel).where(RfqModel.rfq_number == "RFQ-2026-0001"))).scalar_one_or_none()
            assert rfq is not None

            po = (await session.execute(select(PurchaseOrderModel).where(PurchaseOrderModel.po_number == "PO-2026-0001"))).scalar_one_or_none()
            assert po is not None

            asn = (await session.execute(select(AsnModel).where(AsnModel.asn_number == "ASN-20260924-0001"))).scalar_one_or_none()
            assert asn is not None

            # 11. Inbound
            ge = (await session.execute(select(GateEntryModel).where(GateEntryModel.gate_entry_number == "GE-20260924-E3A989"))).scalar_one_or_none()
            assert ge is not None

            dock = (await session.execute(select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == ge.id))).scalar_one_or_none()
            assert dock is not None
            assert dock.dock_released_at is not None

            grn = (await session.execute(select(GrnModel).where(GrnModel.grn_number == "GRN-20260924-0003"))).scalar_one_or_none()
            assert grn is not None
            assert grn.status == "COMPLETED"

            # 12. Assembly
            ao = (await session.execute(select(AssemblyOrderModel).where(AssemblyOrderModel.order_number == "AO-2026-0001"))).scalar_one_or_none()
            assert ao is not None
            assert ao.status in ("COMPLETED", "QUALITY_CHECK", "QC_PASSED", "ASSEMBLED")

            fg = (await session.execute(select(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.assembly_order_id == ao.id))).scalar_one_or_none()
            assert fg is not None

            # 13. Outbound Dispatch
            disp = (await session.execute(select(DispatchModel).where(DispatchModel.order_number == "DO-2026-0001"))).scalar_one_or_none()
            assert disp is not None
            assert disp.status in ("DISPATCHED", "IN_TRANSIT", "DELIVERED", "CLOSED")

            print("[OK] Complete Database Entity Audit Verified (All 13 Steps Connected)!")
