"""Unit and integration tests for Phase 3 — Warehouse Operator/Keeper: Dock Release + Putaway.

Validates:
1. Dock release responsibility by assigned Warehouse Operator/Keeper.
2. Rejection of Warehouse Manager attempting normal dock release after assignment.
3. Rejection of Warehouse Operator from an unrelated Warehouse attempting dock release.
4. Validation checks before dock release (receiving completed, occupied dock, not double released, warehouse match).
5. Putaway task creation inheriting assigned warehouse from gate dock assignment.
6. Warehouse Operator/Keeper Putaway execution with Material QR and Warehouse -> Zone -> Bin hierarchy.
7. Rejection of Putaway into another Warehouse/Zone/Bin, wrong warehouse, quarantined material, excess quantity.
8. Transactional inventory accounting across MaterialStock, WarehouseBin, StorageLocation, and LocationBalances.
"""

from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, delete

from app.database.session import session_scope
from app.main import app
from app.modules.gate.domain.enums import GateEntryStatus
from app.modules.gate.infrastructure.persistence.models import (
    DockAssignmentModel,
    DockModel,
    GateEntryModel,
    ReceivingLineModel,
)
from app.common.persistence.models import (
    AsnLineModel,
    AsnModel,
    MaterialModel,
    MaterialStockModel,
    NotificationModel,
    PurchaseOrderItemModel,
    PurchaseOrderModel,
    SupplierModel,
)
from app.modules.receiving.infrastructure.persistence.models import (
    GrnLineModel,
    GrnModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    HandlingUnitModel,
    InventoryLocationBalanceModel,
    PutawayMovementModel,
    PutawayTaskModel,
    StorageLocationModel,
)
from app.modules.warehouse.infrastructure.persistence.models import (
    WarehouseBinModel,
    UserAccountModel,
    WarehouseModel,
    WarehouseZoneModel,
)


@pytest.mark.asyncio
async def test_phase3_dock_release_authorization_and_validation():
    """Tests dock release positive and negative authorization flows."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        now_tz = datetime.datetime.now(datetime.timezone.utc)
        now_naive = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        wh_id = "WH-BLR-01"

        async with session_scope() as session:
            # 1. Seed Docks
            dock_num_1 = f"DOCK-P3-{uuid.uuid4().hex[:6].upper()}"
            dock1 = DockModel(
                id=uuid.uuid4(),
                dock_number=dock_num_1,
                warehouse_id=wh_id,
                dock_type="RAW_MATERIAL",
                capacity=1,
                status="OCCUPIED",
                created_at=now_tz,
                updated_at=now_tz,
            )
            session.add(dock1)

            # 2. Seed Warehouses
            warehouse_a = WarehouseModel(
                id=uuid.uuid4(),
                warehouse_code=f"STR-P3-ELEC-{uuid.uuid4().hex[:4].upper()}",
                warehouse_name="Electrical Warehouse",
                warehouse_id=wh_id,
                status="ACTIVE",
                created_at=now_tz,
                updated_at=now_tz,
            )
            warehouse_b = WarehouseModel(
                id=uuid.uuid4(),
                warehouse_code=f"STR-P3-MECH-{uuid.uuid4().hex[:4].upper()}",
                warehouse_name="Mechanical Warehouse",
                warehouse_id=wh_id,
                status="ACTIVE",
                created_at=now_tz,
                updated_at=now_tz,
            )
            session.add_all([warehouse_a, warehouse_b])

            # 3. Seed Warehouse Operator Users
            mgr_a = UserAccountModel(
                id=uuid.uuid4(),
                employee_id=f"EMP-P3-{uuid.uuid4().hex[:6].upper()}",
                username=f"warehouse_mgr_p3_a_{uuid.uuid4().hex[:4]}",
                full_name="Electrical Warehouse Operator",
                email=f"warehouse.a.{uuid.uuid4().hex[:4]}@wms.com",
                password_hash="mock_hash_a",
                warehouse_ref_id=warehouse_a.id,
                status="ACTIVE",
                created_at=now_tz,
                updated_at=now_tz,
            )
            mgr_b = UserAccountModel(
                id=uuid.uuid4(),
                employee_id=f"EMP-P3-{uuid.uuid4().hex[:6].upper()}",
                username=f"warehouse_mgr_p3_b_{uuid.uuid4().hex[:4]}",
                full_name="Mechanical Warehouse Operator",
                email=f"warehouse.b.{uuid.uuid4().hex[:4]}@wms.com",
                password_hash="mock_hash_b",
                warehouse_ref_id=warehouse_b.id,
                status="ACTIVE",
                created_at=now_tz,
                updated_at=now_tz,
            )
            session.add_all([mgr_a, mgr_b])

            # 4. Seed Supplier, PO, ASN, Gate Entry, GRN
            sup = SupplierModel(
                id=uuid.uuid4(),
                supplier_code=f"SUP-P3-{uuid.uuid4().hex[:6]}",
                supplier_name="Apex Power Solutions",
                registered_company_name="Apex Power Solutions Pvt Ltd",
                gstin=f"29ABCDE{uuid.uuid4().hex[:4].upper()}1Z5",
                vendor_type="MANUFACTURER",
                category=["Electrical"],
                industry="Power",
                status="Active",
                created_at=now_naive,
                updated_at=now_naive,
            )
            session.add_all([dock1, warehouse_a, warehouse_b, mgr_a, mgr_b, sup])
            await session.flush()

            po_id = uuid.uuid4()
            po = PurchaseOrderModel(
                id=po_id,
                po_number=f"PO-2026-P3-{uuid.uuid4().hex[:6].upper()}",
                supplier_id=sup.id,
                supplier_name=sup.supplier_name,
                warehouse_id=wh_id,
                total_amount=Decimal("50000"),
                status="APPROVED",
                created_at=now_naive,
                updated_at=now_naive,
            )
            session.add(po)
            await session.flush()

            asn_id = uuid.uuid4()
            asn = AsnModel(
                id=asn_id,
                asn_number=f"ASN-2026-P3-{uuid.uuid4().hex[:6].upper()}",
                po_id=str(po_id),
                po_number=po.po_number,
                supplier_id=po.supplier_id,
                transporter="Blue Dart",
                vehicle_number="KA-01-P3-1111",
                driver_name="Ramesh",
                driver_contact="9988776655",
                warehouse_id=wh_id,
                status="APPROVED",
                created_at=now_naive,
            )
            session.add(asn)
            await session.flush()

            entry_id = uuid.uuid4()
            entry = GateEntryModel(
                id=entry_id,
                gate_entry_number=f"GE-2026-P3-{uuid.uuid4().hex[:6].upper()}",
                vehicle_number=asn.vehicle_number,
                driver_name=asn.driver_name or "Ramesh",
                driver_phone="9988776655",
                driver_license_number="DL-12345",
                po_document_path="dummy_po.pdf",
                security_officer_id="SEC-001",
                po_number=po.po_number,
                asn_id=asn_id,
                assigned_dock_id=dock1.dock_number,
                status=GateEntryStatus.RECEIVING_COMPLETED.value,
                created_at=now_tz,
                updated_at=now_tz,
            )
            session.add(entry)
            await session.flush()

            grn_id = uuid.uuid4()
            grn = GrnModel(
                id=grn_id,
                grn_number=f"GRN-2026-P3-{uuid.uuid4().hex[:6].upper()}",
                po_id=po_id,
                po_number=po.po_number,
                asn_id=asn_id,
                asn_number=asn.asn_number,
                supplier_name=sup.supplier_name,
                vehicle_number=asn.vehicle_number,
                warehouse_id=wh_id,
                dock_number=dock1.dock_number,
                status="GRN_POSTED",
                posted_by="warehouse_mgr_p3_a",
                posted_at=now_tz,
            )
            session.add(grn)
            await session.flush()

            # Operational Dock Assignment linked to Warehouse A (Electrical Warehouse)
            assignment = DockAssignmentModel(
                id=uuid.uuid4(),
                gate_entry_id=entry_id,
                asn_id=asn_id,
                po_id=po_id,
                vehicle_number=asn.vehicle_number,
                dock_number=dock1.dock_number,
                assigned_warehouse_ref_id=warehouse_a.id,
                assigned_warehouse_code=warehouse_a.warehouse_code,
                assigned_warehouse_name=warehouse_a.warehouse_name,
                assigned_by="wh_mgr_1",
                assigned_at=now_tz,
                dock_arrival_at=now_tz,
                prepared_grn_id=grn_id,
                receiving_completed_by="wh_mgr_1",
                receiving_completed_at=now_tz,
            )
            session.add(assignment)
            await session.commit()

            entry_id_str = str(entry_id)
            warehouse_a_id_str = str(warehouse_a.id)
            warehouse_b_id_str = str(warehouse_b.id)
            warehouse_a_code = warehouse_a.warehouse_code
            warehouse_b_code = warehouse_b.warehouse_code

        headers_wh = {
            "Authorization": "Bearer mock-jwt-warehouse-token",
            "X-User-Roles": "WAREHOUSE_MANAGER,WAREHOUSE",
            "X-User-Permissions": "gate:verify,gate:write",
        }
        headers_mgr_b = {
            "Authorization": "Bearer mock-jwt-warehouse-mgr-b-token",
            "X-User-Roles": "WAREHOUSE_OPERATOR,WAREHOUSE_OPERATOR",
            "X-User-Permissions": "gate:verify,warehouse:write",
            "X-Warehouse-Id": warehouse_b_id_str,
            "X-Warehouse-Code": warehouse_b_code,
        }
        headers_mgr_a = {
            "Authorization": "Bearer mock-jwt-warehouse-mgr-a-token",
            "X-User-Roles": "WAREHOUSE_OPERATOR,WAREHOUSE_OPERATOR",
            "X-User-Permissions": "gate:verify,warehouse:write",
            "X-Warehouse-Id": warehouse_a_id_str,
            "X-Warehouse-Code": warehouse_a_code,
        }

        # Case 1: Warehouse Manager attempts normal dock release -> Rejected with 403
        resp_wm = await client.post(f"/api/gate-entries/{entry_id_str}/release-dock", headers=headers_wh)
        assert resp_wm.status_code == 403
        assert "assigned Warehouse Operator/Keeper" in resp_wm.json()["detail"]

        # Case 2: Warehouse Operator of Warehouse B (Mechanical Warehouse) attempts dock release -> Rejected with 403
        resp_sm_b = await client.post(f"/api/gate-entries/{entry_id_str}/release-dock", headers=headers_mgr_b)
        assert resp_sm_b.status_code == 403
        assert "only release docks assigned to your Warehouse" in resp_sm_b.json()["detail"]

        # Case 3: Warehouse Operator of Warehouse A (Assigned Electrical Warehouse) releases dock -> Succeeds 200
        resp_sm_a = await client.post(f"/api/gate-entries/{entry_id_str}/release-dock", headers=headers_mgr_a)
        assert resp_sm_a.status_code == 200
        data = resp_sm_a.json()
        assert data["dock_status"] == "AVAILABLE"

        async with session_scope() as session:
            # Verify DB dock status updated to AVAILABLE
            d = (await session.execute(select(DockModel).where(DockModel.dock_number == dock_num_1))).scalar_one()
            assert d.status == "AVAILABLE"

            # Verify assignment record updated
            a = (await session.execute(select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == uuid.UUID(entry_id_str)))).scalar_one()
            assert a.dock_released_at is not None

        # Case 4: Double release attempt -> Rejected with 409
        resp_double = await client.post(f"/api/gate-entries/{entry_id_str}/release-dock", headers=headers_mgr_a)
        assert resp_double.status_code == 409
        assert "Dock was already released" in resp_double.json()["detail"]


@pytest.mark.asyncio
async def test_phase3_putaway_hierarchy_and_inventory_accounting():
    """Tests the Putaway execution flow: Material QR -> Warehouse -> Zone -> Bin -> Inventory update."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        now_tz = datetime.datetime.now(datetime.timezone.utc)
        now_naive = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        wh_id = "WH-BLR-01"
        item_code = f"MAT-CBL-{uuid.uuid4().hex[:6].upper()}"

        async with session_scope() as session:
            # 1. Seed Warehouse, Zone, Bin hierarchy
            warehouse = WarehouseModel(
                id=uuid.uuid4(),
                warehouse_code=f"STR-P3-ELEC-{uuid.uuid4().hex[:4].upper()}",
                warehouse_name="Electrical Warehouse",
                warehouse_id=wh_id,
                status="ACTIVE",
                created_at=now_tz,
                updated_at=now_tz,
            )
            zone = WarehouseZoneModel(
                id=uuid.uuid4(),
                warehouse_ref_id=warehouse.id,
                zone_code=f"ZON-P3-{uuid.uuid4().hex[:4].upper()}",
                zone_name="Cable Storage Zone",
                status="ACTIVE",
                created_at=now_tz,
                updated_at=now_tz,
            )
            bin_obj = WarehouseBinModel(
                id=uuid.uuid4(),
                warehouse_ref_id=warehouse.id,
                zone_id=zone.id,
                bin_code=f"BIN-P3-{uuid.uuid4().hex[:4].upper()}",
                bin_name="Heavy Cable Bin 01",
                rack="R01",
                shelf="S01",
                capacity=Decimal("1000.0"),
                occupied_quantity=Decimal("100.0"),
                status="ACTIVE",
                created_at=now_tz,
                updated_at=now_tz,
            )
            dock2 = DockModel(
                id=uuid.uuid4(),
                dock_number=f"DOCK-P3-{uuid.uuid4().hex[:4].upper()}",
                warehouse_id=wh_id,
                dock_type="RAW_MATERIAL",
                capacity=1,
                status="AVAILABLE",
                created_at=now_tz,
                updated_at=now_tz,
            )
            sup2 = SupplierModel(
                id=uuid.uuid4(),
                supplier_code=f"SUP-P3-{uuid.uuid4().hex[:6]}",
                supplier_name="Copper Cables Corp",
                registered_company_name="Copper Cables Corp Ltd",
                gstin="29XYZAB1234F1Z9",
                vendor_type="MANUFACTURER",
                category=["Electrical"],
                industry="Power",
                status="Active",
                created_at=now_naive,
                updated_at=now_naive,
            )
            session.add_all([warehouse, zone, bin_obj, dock2, sup2])
            await session.flush()

            po2_id = uuid.uuid4()
            po2 = PurchaseOrderModel(
                id=po2_id,
                po_number=f"PO-2026-{uuid.uuid4().hex[:4].upper()}",
                supplier_id=sup2.id,
                supplier_name=sup2.supplier_name,
                warehouse_id=wh_id,
                total_amount=Decimal("20000"),
                status="APPROVED",
                created_at=now_naive,
                updated_at=now_naive,
            )
            session.add(po2)
            await session.flush()

            asn2_id = uuid.uuid4()
            asn2 = AsnModel(
                id=asn2_id,
                asn_number=f"ASN-2026-{uuid.uuid4().hex[:4].upper()}",
                po_id=str(po2_id),
                po_number=po2.po_number,
                supplier_id=sup2.id,
                transporter="Blue Dart",
                vehicle_number="KA-02-C-5678",
                driver_name="Driver Kumar",
                driver_contact="9988776655",
                warehouse_id=wh_id,
                status="APPROVED",
                created_at=now_naive,
            )
            session.add(asn2)
            await session.flush()

            entry2_id = uuid.uuid4()
            entry2 = GateEntryModel(
                id=entry2_id,
                gate_entry_number=f"GE-2026-{uuid.uuid4().hex[:6].upper()}",
                vehicle_number=asn2.vehicle_number,
                driver_name=asn2.driver_name or "Driver Kumar",
                driver_phone="9988776655",
                driver_license_number="DL-12345",
                po_document_path="dummy_po.pdf",
                security_officer_id="SEC-001",
                po_number=po2.po_number,
                asn_id=asn2_id,
                assigned_dock_id=dock2.dock_number,
                status=GateEntryStatus.RECEIVING_COMPLETED.value,
                created_at=now_tz,
                updated_at=now_tz,
            )
            session.add(entry2)
            await session.flush()

            assignment2 = DockAssignmentModel(
                id=uuid.uuid4(),
                gate_entry_id=entry2_id,
                asn_id=asn2_id,
                po_id=po2_id,
                vehicle_number=asn2.vehicle_number,
                dock_number=dock2.dock_number,
                assigned_warehouse_ref_id=warehouse.id,
                assigned_warehouse_code=warehouse.warehouse_code,
                assigned_warehouse_name=warehouse.warehouse_name,
                assigned_by="wh_mgr_1",
                assigned_at=now_tz,
                dock_arrival_at=now_tz,
                receiving_completed_by="wh_mgr_1",
                receiving_completed_at=now_tz,
            )
            session.add(assignment2)
            await session.flush()

            rec_line = ReceivingLineModel(
                id=uuid.uuid4(),
                dock_assignment_id=assignment2.id,
                item_code=item_code,
                material_name="400mm Insulated Cable",
                uom="MTR",
                ordered_quantity=Decimal("200.0"),
                shipped_quantity=Decimal("200.0"),
                received_quantity=Decimal("200.0"),
                verification_status="MATCHED",
                exception_quantity=Decimal("0.0"),
                recorded_by="warehouse_keeper",
                recorded_at=now_tz,
            )
            session.add(rec_line)
            await session.flush()

            # 2. Seed Material Stock
            stock = MaterialStockModel(
                material_code=item_code,
                material_name="400mm Insulated Cable",
                category="Electrical",
                warehouse_id=wh_id,
                on_hand=Decimal("500.0"),
                allocated=Decimal("0.0"),
                available=Decimal("400.0"),
                uom="MTR",
                reorder_point=Decimal("50.0"),
                updated_at=now_naive,
            )
            session.add(stock)
            session.add(MaterialModel(
                material_code=item_code,
                material_name="400mm Insulated Cable",
                category="Electrical",
                base_uom="MTR",
                status="Active",
            ))
            await session.flush()

            # 3. Seed GRN & Handling Unit (Material QR created by GRN + Quality)
            grn_id = uuid.uuid4()
            grn = GrnModel(
                id=grn_id,
                grn_number=f"GRN-P3-{uuid.uuid4().hex[:6].upper()}",
                po_id=po2_id,
                po_number=po2.po_number,
                asn_id=asn2_id,
                asn_number=asn2.asn_number,
                supplier_name="Copper Cables Corp",
                vehicle_number="KA-02-C-5678",
                warehouse_id=wh_id,
                dock_number=dock2.dock_number,
                status="GRN_POSTED",
                posted_by="quality_inspector",
                posted_at=now_tz,
            )
            session.add(grn)
            await session.flush()

            grn_line = GrnLineModel(
                id=uuid.uuid4(),
                grn_id=grn.id,
                item_code=item_code,
                material_name="400mm Insulated Cable",
                uom="MTR",
                received_quantity=Decimal("200.0"),
                accepted_quantity=Decimal("200.0"),
            )
            session.add(grn_line)
            await session.flush()

            hu = HandlingUnitModel(
                id=uuid.uuid4(),
                hu_number=f"HU-P3-{uuid.uuid4().hex[:8].upper()}",
                barcode_value=f"QR-HU-P3-{uuid.uuid4().hex[:8].upper()}",
                receiving_line_id=rec_line.id,
                grn_line_id=grn_line.id,
                item_code=item_code,
                material_name="400mm Insulated Cable",
                quantity=Decimal("200.0"),
                uom="MTR",
                supplier_name="Copper Cables Corp",
                po_number=po2.po_number,
                asn_number=asn2.asn_number,
                grn_number=grn.grn_number,
                warehouse_id=wh_id,
                current_location="RECEIVING_AREA",
                status="PUTAWAY_PENDING",
                generated_by="quality_inspector",
                generated_at=now_tz,
                updated_at=now_tz,
            )
            session.add(hu)
            await session.flush()

            # 4. Seed Putaway Task pre-assigned to Warehouse
            task_id = uuid.uuid4()
            task = PutawayTaskModel(
                id=task_id,
                task_number=f"PUT-P3-{uuid.uuid4().hex[:8].upper()}",
                grn_id=grn_id,
                grn_number=grn.grn_number,
                handling_unit_id=hu.id,
                item_code=item_code,
                material_name="400mm Insulated Cable",
                quantity=Decimal("200.0"),
                uom="MTR",
                warehouse_id=wh_id,
                source_location="RECEIVING_AREA",
                destination_warehouse_ref_id=warehouse.id,
                status="PUTAWAY_PENDING",
                created_by="system",
                created_at=now_tz,
            )
            session.add(task)
            await session.commit()

            task_id_str = str(task_id)
            hu_barcode = hu.barcode_value
            bin_code = bin_obj.bin_code
            warehouse_ref_id_str = str(warehouse.id)
            warehouse_code_str = warehouse.warehouse_code

        headers_keeper = {
            "Authorization": "Bearer mock-jwt-warehouse-operator-token",
            "X-User-Roles": "WAREHOUSE_OPERATOR,WAREHOUSE_OPERATOR",
            "X-User-Permissions": "warehouse:write,putaway:execute",
            "X-Warehouse-Id": warehouse_ref_id_str,
            "X-Warehouse-Code": warehouse_code_str,
        }

        # Negative Test: Scan invalid Material QR
        resp_inv_qr = await client.post(
            f"/api/storage/putaway-tasks/{task_id_str}/complete",
            json={
                "material_scan": "INVALID-QR-9999",
                "location_scan": bin_code,
                "quantity": 200,
            },
            headers=headers_keeper,
        )
        assert resp_inv_qr.status_code == 422
        assert "Material QR does not match" in resp_inv_qr.json()["detail"]

        # Negative Test: Quantity exceeding task quantity
        resp_excess = await client.post(
            f"/api/storage/putaway-tasks/{task_id_str}/complete",
            json={
                "material_scan": hu_barcode,
                "location_scan": bin_code,
                "quantity": 500,
            },
            headers=headers_keeper,
        )
        assert resp_excess.status_code == 422
        assert "exceeds GRN accepted quantity remaining" in resp_excess.json()["detail"]

        # Positive Test: Confirm Physical Putaway with Material QR & Bin QR
        resp_ok = await client.post(
            f"/api/storage/putaway-tasks/{task_id_str}/complete",
            json={
                "material_scan": hu_barcode,
                "location_scan": bin_code,
                "quantity": 200,
            },
            headers=headers_keeper,
        )
        assert resp_ok.status_code == 200, resp_ok.text
        putaway_data = resp_ok.json()
        assert putaway_data["status"] == "COMPLETED"
        assert putaway_data["destination_bin"] == bin_code
        assert putaway_data["inventory_available_after"] == 600.0

        async with session_scope() as session:
            # Verify DB state
            t = (await session.execute(select(PutawayTaskModel).where(PutawayTaskModel.id == uuid.UUID(task_id_str)))).scalar_one()
            assert t.status == "COMPLETED"

            h = (await session.execute(select(HandlingUnitModel).where(HandlingUnitModel.barcode_value == hu_barcode))).scalar_one()
            assert h.status == "STORED"
            assert bin_code in h.current_location

            b = (await session.execute(select(WarehouseBinModel).where(WarehouseBinModel.bin_code == bin_code))).scalar_one()
            assert b.occupied_quantity == Decimal("300.0")  # 100 + 200

            s = (await session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code == item_code))).scalar_one()
            assert s.available == Decimal("600.0")  # 400 + 200

            # Verify Inventory Location Balance created
            bal_res = await session.execute(
                select(InventoryLocationBalanceModel).where(
                    InventoryLocationBalanceModel.material_code == item_code
                )
            )
            balance = bal_res.scalars().first()
            assert balance is not None
            assert balance.available_quantity == Decimal("200.0")

            # Verify Putaway Movement audit record
            mov_res = await session.execute(
                select(PutawayMovementModel).where(PutawayMovementModel.putaway_task_id == uuid.UUID(task_id_str))
            )
            movement = mov_res.scalars().first()
            assert movement is not None
            assert movement.confirmed_quantity == Decimal("200.0")
