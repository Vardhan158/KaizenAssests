import datetime
from decimal import Decimal
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.main import app
from app.database.session import session_scope
from app.modules.gate.infrastructure.persistence.models import (
    DockAssignmentModel,
    DockModel,
    GateEntryModel,
    GateExitModel,
)
from app.modules.procurement.infrastructure.persistence.models import (
    AsnModel,
    MaterialStockModel,
    NotificationModel,
    PurchaseOrderModel,
)
from app.modules.receiving.infrastructure.persistence.models import (
    GrnBatchModel,
    GrnBatchQrModel,
    GrnLineModel,
    GrnModel,
    InventoryReceiptPostingModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionModel,
    PutawayMovementModel,
    PutawayTaskModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreBinModel,
    StoreModel,
    StoreZoneModel,
)
from app.modules.assembly.infrastructure.persistence.models import AssemblyOrderModel
from app.modules.dispatch.infrastructure.persistence.models import DispatchModel


@pytest.mark.asyncio
async def test_e2e_prompt9_dock_release_and_putaway_flow():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        store_headers = {
            "Authorization": "Bearer mock-jwt-store-mgr-token",
            "X-User-Roles": "STORE_MANAGER,STORE_KEEPER",
            "X-Store-Id": "9e93cb84-e799-424c-a0e5-ce06175222ec",
            "X-Store-Code": "STR-1E6BD7",
        }

        # 1. VERIFY DOCK RELEASE STATE
        async with session_scope() as session:
            ge = (await session.execute(
                select(GateEntryModel).where(GateEntryModel.gate_entry_number == "GE-20260924-E3A989")
            )).scalar_one_or_none()
            assert ge is not None
            assert ge.status == "RECEIVING_COMPLETED"

            dock = (await session.execute(
                select(DockModel).where(DockModel.dock_number == "DK-0CE4")
            )).scalar_one_or_none()
            assert dock is not None
            assert dock.status == "AVAILABLE", "Dock DK-0CE4 must be released and AVAILABLE"

            da = (await session.execute(
                select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == ge.id)
            )).scalar_one_or_none()
            assert da is not None
            assert da.dock_released_at is not None
            assert da.assigned_store_code == "STR-1E6BD7"

        # 2. VERIFY DUPLICATE DOCK RELEASE IS REJECTED (IDEMPOTENCY)
        resp_double_rel = await client.post(f"/api/gate-entries/{ge.id}/release-dock", headers=store_headers)
        assert resp_double_rel.status_code in (400, 409, 422), "Double dock release must be rejected"

        # 3. VERIFY PUTAWAY TASK & EXECUTION
        async with session_scope() as session:
            tasks = (await session.execute(
                select(PutawayTaskModel).where(PutawayTaskModel.grn_id == da.prepared_grn_id)
            )).scalars().all()
            assert len(tasks) == 1, "Exactly one putaway task must exist for the GRN"
            task = tasks[0]
            assert task.item_code == "MAT-MOTOR-001"
            assert task.destination_store_id == uuid.UUID("9e93cb84-e799-424c-a0e5-ce06175222ec")
            assert task.status == "PUTAWAY_COMPLETED"
            assert task.completed_at is not None

            # Verify Movement
            movs = (await session.execute(
                select(PutawayMovementModel).where(PutawayMovementModel.putaway_task_id == task.id)
            )).scalars().all()
            assert len(movs) >= 1
            assert movs[0].confirmed_quantity == Decimal("4.0000")

        # 4. VERIFY DUPLICATE PUTAWAY IS REJECTED
        resp_double_put = await client.post(
            f"/api/storage/putaway-tasks/{task.id}/complete",
            json={"material_scan": "MAT-MOTOR-001", "location_scan": "ELE-Z01-2E34", "quantity": 4.0},
            headers=store_headers,
        )
        assert resp_double_put.status_code in (400, 409, 422), "Duplicate putaway execution must be rejected"

        # 5. VERIFY INVENTORY BALANCES & LEDGER
        async with session_scope() as session:
            stock = (await session.execute(
                select(MaterialStockModel).where(MaterialStockModel.material_code == "MAT-MOTOR-001")
            )).scalar_one_or_none()
            assert stock is not None
            assert stock.on_hand == Decimal("10.0000"), "Total physically on hand must be 10 PCS (6 previously + 4 newly received)"
            assert stock.allocated == Decimal("6.0000"), "Allocated stock must remain 6 PCS for Assembly Requisition"
            assert stock.available == Decimal("4.0000"), "Available free stock must be 4 PCS"

            # Verify Inventory Receipt Posting
            postings = (await session.execute(
                select(InventoryReceiptPostingModel).where(InventoryReceiptPostingModel.grn_id == da.prepared_grn_id)
            )).scalars().all()
            assert len(postings) == 1
            assert postings[0].posted_quantity == Decimal("4.0000")
            assert postings[0].item_code == "MAT-MOTOR-001"

        # 6. VERIFY RESERVATION INTEGRITY
        async with session_scope() as session:
            req = (await session.execute(
                select(AssemblyRequisitionModel)
                .options(selectinload(AssemblyRequisitionModel.items))
                .where(AssemblyRequisitionModel.requisition_number == "AR-2026-0002")
            )).scalar_one_or_none()
            assert req is not None
            assert req.status == "PENDING"
            motor_items = [it for it in req.items if it.material_code == "MAT-MOTOR-001"]
            assert len(motor_items) == 1
            motor_item = motor_items[0]
            assert motor_item.requested_quantity == Decimal("10.0000")
            assert motor_item.reserved_quantity == Decimal("6.0000"), "Existing 6-unit reservation must be preserved"
            assert motor_item.issued_quantity == Decimal("0.0000"), "No premature stock consumption"

        # 7. VERIFY DOWNSTREAM ISOLATION
        async with session_scope() as session:
            # Assembly orders = 0
            orders = (await session.execute(select(AssemblyOrderModel))).scalars().all()
            assert len(orders) == 0, "No Assembly orders should exist yet"

            # Dispatch orders = 0
            dispatches = (await session.execute(select(DispatchModel))).scalars().all()
            assert len(dispatches) == 0, "No Dispatch orders should exist yet"

            # Gate exits = 0
            exits = (await session.execute(select(GateExitModel))).scalars().all()
            assert len(exits) == 0, "No Gate Exits should exist yet"
