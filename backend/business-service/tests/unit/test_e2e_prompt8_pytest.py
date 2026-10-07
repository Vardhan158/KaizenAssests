import datetime
from decimal import Decimal
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, func

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
    PurchaseOrderModel,
)
from app.modules.receiving.infrastructure.persistence.models import (
    GrnBatchModel,
    GrnBatchQrModel,
    GrnLineModel,
    GrnModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionModel,
    PutawayTaskModel,
)
from app.modules.dispatch.infrastructure.persistence.models import DispatchModel
from app.modules.store.infrastructure.persistence.models import StoreModel


@pytest.mark.asyncio
async def test_e2e_prompt8_inbound_flow():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        gate_headers = {"Authorization": "Bearer mock-jwt-token"}
        wh_headers = {"Authorization": "Bearer mock-jwt-warehouse-token"}
        rec_headers = {"Authorization": "Bearer mock-jwt-token"}

        # 1. VERIFY PO & ASN FROM PROMPT 7
        async with session_scope() as session:
            po = (await session.execute(
                select(PurchaseOrderModel).where(PurchaseOrderModel.po_number == "PO-2026-0001")
            )).scalar_one_or_none()
            assert po is not None, "PO-2026-0001 must exist"
            assert po.supplier_name == "E2E Motor Supplier"

            asn = (await session.execute(
                select(AsnModel).where(AsnModel.asn_number == "ASN-20260924-0001")
            )).scalar_one_or_none()
            assert asn is not None, "ASN-20260924-0001 must exist"
            assert asn.po_number == "PO-2026-0001"

        # 2. VERIFY GATE ENTRY PERSISTENCE & IDEMPOTENCY
        async with session_scope() as session:
            ge = (await session.execute(
                select(GateEntryModel).where(GateEntryModel.po_number == "PO-2026-0001")
            )).scalar_one_or_none()
            assert ge is not None, "Gate Entry must be created and persisted"
            assert ge.asn_id == asn.id
            assert ge.po_number == "PO-2026-0001"
            assert ge.vehicle_number == "KA-01-E-2026"
            assert ge.assigned_dock_id == "DK-0CE4"
            assert ge.status == "DOCK_ASSIGNED"
            gate_entry_id = str(ge.id)
            gate_entry_num = ge.gate_entry_number

        # Verify duplicate Gate Entry creation is rejected
        dup_ge_payload = {
            "asn_reference": "ASN-20260924-0001",
            "po_number": "PO-2026-0001",
            "supplier_name": "E2E Motor Supplier",
            "material_description": "Motor",
            "total_quantity": 4.0,
            "vehicle_plate": "E2E-TEST-001",
            "driver_name": "E2E Test Driver",
        }
        dup_ge_res = await client.post("/api/gate-entries", json=dup_ge_payload, headers=gate_headers)
        assert dup_ge_res.status_code in (400, 409, 422), "Duplicate active Gate Entry for same PO must be rejected"

        # 3. VERIFY DOCK ALLOCATION & RECEIVING STORE
        async with session_scope() as session:
            dock_alloc = (await session.execute(
                select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == ge.id)
            )).scalar_one_or_none()
            assert dock_alloc is not None, "Dock assignment record must exist"
            assert dock_alloc.dock_number == "DK-0CE4"
            assert dock_alloc.assigned_store_code == "STR-1E6BD7"
            assert dock_alloc.assigned_store_name == "Electrical Store"

            # Verify Dock status is OCCUPIED
            dock = (await session.execute(
                select(DockModel).where(DockModel.dock_number == "DK-0CE4")
            )).scalar_one_or_none()
            assert dock is not None
            assert dock.status == "OCCUPIED"

            # Verify Store is ACTIVE and in Main Warehouse
            store = (await session.execute(
                select(StoreModel).where(StoreModel.store_code == "STR-1E6BD7")
            )).scalar_one_or_none()
            assert store is not None
            assert store.status == "ACTIVE"
            assert store.warehouse_id == "Main Warehouse"

        # Verify duplicate dock assignment is rejected
        dup_dock_res = await client.post(
            f"/api/gate-entries/{gate_entry_id}/assign-dock",
            json={"dock_id": "DK-0CE4", "store_id": "STR-1E6BD7"},
            headers=wh_headers,
        )
        assert dup_dock_res.status_code in (400, 409, 422), "Duplicate dock assignment must be rejected"

        # 4. VERIFY GRN RECORD & LINES
        async with session_scope() as session:
            grn = (await session.execute(
                select(GrnModel).where(GrnModel.gate_entry_id == ge.id)
            )).scalar_one_or_none()
            assert grn is not None, "GRN must exist for the Gate Entry"
            assert grn.po_number == "PO-2026-0001"
            assert grn.asn_number == "ASN-20260924-0001"
            assert grn.supplier_name == "E2E Motor Supplier"
            assert grn.dock_number == "DK-0CE4"
            assert grn.warehouse_id == "Main Warehouse"

            grn_lines = (await session.execute(
                select(GrnLineModel).where(GrnLineModel.grn_id == grn.id)
            )).scalars().all()
            assert len(grn_lines) == 1, "Exactly one GRN line for Motor must exist"
            line = grn_lines[0]
            assert line.item_code == "MAT-MOTOR-001"
            assert line.material_name == "Motor"
            assert line.received_quantity == Decimal("4.0")
            assert line.good_quantity == Decimal("4.0")
            assert line.damaged_quantity == Decimal("0.0")

            # 5. VERIFY QUALITY INSPECTION
            assert line.quality_result == "PASSED"
            assert line.accepted_quantity == Decimal("4.0")
            assert line.rejected_quantity == Decimal("0.0")
            assert line.quality_approved_quantity == Decimal("4.0")

            # 6. VERIFY BATCH & QR CODE GENERATION
            batches = (await session.execute(
                select(GrnBatchModel).where(GrnBatchModel.grn_line_id == line.id)
            )).scalars().all()
            assert len(batches) == 1, "Exactly 1 Batch must be generated"
            batch = batches[0]
            assert batch.batch_quantity == Decimal("4.0")
            assert "MAT-MOTOR-001" in batch.batch_number

            qr_records = (await session.execute(
                select(GrnBatchQrModel).where(GrnBatchQrModel.item_code == "MAT-MOTOR-001")
            )).scalars().all()
            assert len(qr_records) >= 1, "QR code record must be generated"
            qr = qr_records[0]
            assert qr.item_code == "MAT-MOTOR-001"
            assert "MAT-MOTOR-001" in qr.qr_payload
            assert "4.0000 PCS" in qr.qr_payload

        # 7. VERIFY DOWNSTREAM ISOLATION
        async with session_scope() as session:
            # Putaway tasks must be 0 for this GRN
            putaway_tasks = (await session.execute(
                select(PutawayTaskModel).where(PutawayTaskModel.grn_id == grn.id)
            )).scalars().all()
            assert len(putaway_tasks) == 0, "Putaway tasks must be 0 (stopped after QR generation)"

            # Gate Exits must be 0 for this Gate Entry
            gate_exits = (await session.execute(
                select(GateExitModel).where(GateExitModel.gate_entry_id == ge.id)
            )).scalars().all()
            assert len(gate_exits) == 0, "Gate exit records must be 0"

            # Dispatch orders must be 0
            dispatch_orders = (await session.execute(
                select(DispatchModel)
            )).scalars().all()
            assert len(dispatch_orders) == 0, "Dispatch orders must be 0"

            # Requisition status must still be PENDING (not yet picked)
            req = (await session.execute(
                select(AssemblyRequisitionModel).where(AssemblyRequisitionModel.requisition_number == "AR-2026-0002")
            )).scalar_one_or_none()
            assert req is not None
            assert req.status == "PENDING", "Assembly Requisition should remain in PENDING state"
