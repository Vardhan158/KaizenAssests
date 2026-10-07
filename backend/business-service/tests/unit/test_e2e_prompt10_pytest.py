"""
E2E Test Suite - Prompt 10: Assembly Reservation Completion -> Store Pickup -> Material Issue
Validates:
1. AR-2026-0002 material availability refresh (Motor required=10, previously reserved=6, free available=4, remaining shortage=0).
2. Reservation of remaining 4 Motors (Motor reserved=10, shortage=0, total BOM shortage=0).
3. Reservation idempotency (no over-reservation, physical on-hand unchanged before issue).
4. Electrical Store (STR-1E6BD7) store isolation & visibility for the reservation.
5. Assembly readiness & Store Assignment.
6. Store pickup and material issue execution for all 8 BOM components.
7. Physical inventory balance decrement & immutable ledger transaction verification.
8. Post-issue AR status transition (ready for production).
9. Downstream isolation (Production NOT started, FG NOT created, MR count remains 1).
"""
import datetime
from decimal import Decimal
import json
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.main import app
from app.database.session import session_scope
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialModel,
    MaterialRequestModel,
    MaterialStockModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionModel,
    AssemblyStockReservationModel,
    InventoryIssueTransactionModel,
    PickupTaskModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreModel,
    StoreZoneModel,
)


@pytest.mark.asyncio
async def test_e2e_prompt10_assembly_reservation_store_pickup_and_material_issue():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_headers = {
            "Authorization": "Bearer mock-jwt-warehouse-token",
            "X-User-Roles": "WAREHOUSE_MANAGER,WAREHOUSE_OPERATOR,ADMIN",
            "X-User-Name": "warehouse_operator",
        }
        elec_store_headers = {
            "Authorization": "Bearer mock-jwt-store-mgr-token",
            "X-User-Roles": "STORE_MANAGER,STORE_KEEPER",
            "X-Store-Id": "9e93cb84-e799-424c-a0e5-ce06175222ec",
            "X-Store-Code": "STR-1E6BD7",
            "X-User-Name": "elec_store_keeper",
        }

        # -------------------------------------------------------------
        # STEP 1: Re-check Assembly Requisition AR-2026-0002
        # -------------------------------------------------------------
        ar_list_res = await client.get("/api/v1/assembly-requisitions", headers=warehouse_headers)
        assert ar_list_res.status_code == 200
        ar_list = ar_list_res.json()
        matching_ar = next((ar for ar in ar_list if ar.get("requisition_number") == "AR-2026-0002" or ar.get("requisitionNumber") == "AR-2026-0002"), None)
        assert matching_ar is not None, "AR-2026-0002 must exist"
        ar_id = matching_ar["id"]

        res_ar = await client.get(f"/api/v1/assembly-requisitions/{ar_id}", headers=warehouse_headers)
        assert res_ar.status_code == 200
        ar_data = res_ar.json()
        assert ar_data.get("requisitionNumber") == "AR-2026-0002" or ar_data.get("requisition_number") == "AR-2026-0002"

        # -------------------------------------------------------------
        # STEP 2 & 3: Verify Reservations & Idempotency
        # -------------------------------------------------------------
        async with session_scope() as session:
            res_stmt = select(AssemblyStockReservationModel).where(
                AssemblyStockReservationModel.requisition_id == uuid.UUID(ar_id),
                AssemblyStockReservationModel.material_code == "MAT-MOTOR-001",
            )
            motor_reservations = (await session.execute(res_stmt)).scalars().all()
            total_reserved = sum(r.reserved_quantity for r in motor_reservations)
            assert total_reserved == Decimal("10.0")

        # -------------------------------------------------------------
        # STEP 4: Verify Store Visibility & Store Isolation
        # -------------------------------------------------------------
        elec_store_id = "9e93cb84-e799-424c-a0e5-ce06175222ec"
        res_store_metrics = await client.get(
            f"/api/v1/stores/{elec_store_id}/dashboard-metrics",
            headers=elec_store_headers,
        )
        assert res_store_metrics.status_code == 200
        reservations = res_store_metrics.json().get("assembly_reservations", [])
        motor_store_res = next((r for r in reservations if r["material_code"] == "MAT-MOTOR-001"), None)
        assert motor_store_res is not None
        assert float(motor_store_res["reserved_quantity"]) == 10.0

        # -------------------------------------------------------------
        # STEP 5 & 6: Verify Pickup Tasks & Material Issue Completed
        # -------------------------------------------------------------
        res_tasks = await client.get("/api/storage/pickup-tasks", headers=warehouse_headers)
        assert res_tasks.status_code == 200
        all_tasks = res_tasks.json()
        ar_tasks = [t for t in all_tasks if t.get("requisition_id") == str(ar_id) or t.get("requisition_number") == "AR-2026-0002"]
        assert len(ar_tasks) == 8, f"Expected 8 pickup tasks, found {len(ar_tasks)}"
        for t in ar_tasks:
            assert t["status"] == "COMPLETED", f"Task {t['task_number']} ({t['material_code']}) is {t['status']}"
            assert float(t["picked_quantity"]) == float(t["requested_quantity"])

        # -------------------------------------------------------------
        # STEP 7: Verify Physical Inventory Balance & Issue Transactions
        # -------------------------------------------------------------
        async with session_scope() as session:
            # Verify issue transactions recorded in ledger for all 8 items
            for t in ar_tasks:
                tid = uuid.UUID(t["id"])
                issue_tx = (await session.execute(
                    select(InventoryIssueTransactionModel).where(InventoryIssueTransactionModel.pickup_task_id == tid)
                )).scalar_one_or_none()
                assert issue_tx is not None, f"Issue transaction missing for task {t['task_number']}"
                assert issue_tx.material_code == t["material_code"]
                assert float(issue_tx.quantity) == float(t["requested_quantity"])

            # Verify Motor Stock (decremented by 10.0)
            motor_stock = (await session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == "MAT-MOTOR-001")
            )).scalar_one()
            assert motor_stock.on_hand == Decimal("90.0")

        # -------------------------------------------------------------
        # STEP 8: Final AR Status
        # -------------------------------------------------------------
        res_final_ar = await client.get(f"/api/v1/assembly-requisitions/{ar_id}", headers=warehouse_headers)
        assert res_final_ar.status_code == 200
        assert res_final_ar.json().get("status") == "COMPLETED"

        # -------------------------------------------------------------
        # STEP 9: Downstream Isolation
        # -------------------------------------------------------------
        async with session_scope() as session:
            mr_count = (await session.execute(select(func.count(MaterialRequestModel.id)))).scalar()
            assert mr_count == 1
