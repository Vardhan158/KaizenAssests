import datetime
from decimal import Decimal
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, delete

from app.main import app
from app.database.session import session_scope
from app.modules.gate.infrastructure.persistence.models import (
    DockAssignmentModel,
    DockModel,
    GateEntryModel,
)
from app.modules.procurement.infrastructure.persistence.models import (
    AsnModel,
    AsnLineModel,
    MaterialModel,
    NotificationModel,
    PurchaseOrderModel,
    PurchaseOrderItemModel,
    SupplierModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreManagerUserModel,
    StoreModel,
)


@pytest.mark.asyncio
async def test_phase2_post_arrival_store_assignment_flow():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        wh_manager_headers = {"Authorization": "Bearer mock-jwt-warehouse-token"}
        store_a_headers = {"Authorization": "Bearer mock-jwt-store-mgr-elec-token"}
        store_b_headers = {"Authorization": "Bearer mock-jwt-store-mgr-mech-token"}

        async with session_scope() as session:
            now_utc = datetime.datetime.now()
            today = datetime.date.today()

            # 1. Setup Active Stores in WH-01
            s_elec = (await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-PH2-ELEC"))).scalar_one_or_none()
            if not s_elec:
                s_elec = StoreModel(
                    id=uuid.uuid4(),
                    store_code="STR-PH2-ELEC",
                    store_name="Phase 2 Electrical Store",
                    warehouse_id="WH-01",
                    status="ACTIVE",
                )
                session.add(s_elec)

            s_mech = (await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-PH2-MECH"))).scalar_one_or_none()
            if not s_mech:
                s_mech = StoreModel(
                    id=uuid.uuid4(),
                    store_code="STR-PH2-MECH",
                    store_name="Phase 2 Mechanical Store",
                    warehouse_id="WH-01",
                    status="ACTIVE",
                )
                session.add(s_mech)

            # Inactive Store
            s_inactive = (await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-PH2-INACT"))).scalar_one_or_none()
            if not s_inactive:
                s_inactive = StoreModel(
                    id=uuid.uuid4(),
                    store_code="STR-PH2-INACT",
                    store_name="Inactive Store",
                    warehouse_id="WH-01",
                    status="INACTIVE",
                )
                session.add(s_inactive)

            # Store in another Warehouse (WH-NORTH)
            s_other_wh = (await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-PH2-NORTH"))).scalar_one_or_none()
            if not s_other_wh:
                s_other_wh = StoreModel(
                    id=uuid.uuid4(),
                    store_code="STR-PH2-NORTH",
                    store_name="North Warehouse Store",
                    warehouse_id="WH-NORTH",
                    status="ACTIVE",
                )
                session.add(s_other_wh)

            # 2. Setup Docks in WH-01
            dock_01 = (await session.execute(select(DockModel).where(DockModel.dock_number == "DOCK-PH2-01"))).scalar_one_or_none()
            if not dock_01:
                dock_01 = DockModel(
                    id=uuid.uuid4(),
                    dock_number="DOCK-PH2-01",
                    warehouse_id="WH-01",
                    dock_type="RAW_MATERIAL",
                    capacity=1,
                    status="AVAILABLE",
                )
                session.add(dock_01)
            else:
                dock_01.status = "AVAILABLE"

            dock_02 = (await session.execute(select(DockModel).where(DockModel.dock_number == "DOCK-PH2-02"))).scalar_one_or_none()
            if not dock_02:
                dock_02 = DockModel(
                    id=uuid.uuid4(),
                    dock_number="DOCK-PH2-02",
                    warehouse_id="WH-01",
                    dock_type="RAW_MATERIAL",
                    capacity=1,
                    status="AVAILABLE",
                )
                session.add(dock_02)
            else:
                dock_02.status = "AVAILABLE"

            # 3. Setup Supplier, PO, ASN, Material
            sup = (await session.execute(select(SupplierModel).where(SupplierModel.supplier_code == "SUP-PH2-01"))).scalar_one_or_none()
            if not sup:
                sup = SupplierModel(
                    id=uuid.uuid4(),
                    supplier_code="SUP-PH2-01",
                    supplier_name="Phase2 Industrial Tech",
                    registered_company_name="Phase2 Industrial Tech Private Limited",
                    vendor_type="MANUFACTURER",
                    category=["RAW_MATERIALS"],
                    industry="Electronics",
                    gstin="29AAACH7409R1ZZ",
                    status="Active",
                )
                session.add(sup)
                await session.flush()

            po = (await session.execute(select(PurchaseOrderModel).where(PurchaseOrderModel.po_number == "PO-PH2-001"))).scalar_one_or_none()
            if not po:
                po = PurchaseOrderModel(
                    id=uuid.uuid4(),
                    po_number="PO-PH2-001",
                    po_date=today,
                    supplier_id=sup.id,
                    supplier_name=sup.supplier_name,
                    status="ISSUED",
                    total_amount=Decimal("50000"),
                )
                session.add(po)
                await session.flush()
                po_item = PurchaseOrderItemModel(
                    id=uuid.uuid4(),
                    purchase_order_id=po.id,
                    material_code="MAT-PH2-01",
                    material_name="Industrial Transformers",
                    quantity=Decimal("10"),
                    unit_price=Decimal("5000"),
                    uom="NOS",
                )
                session.add(po_item)

            asn = (await session.execute(select(AsnModel).where(AsnModel.asn_number == "ASN-PH2-001"))).scalar_one_or_none()
            if not asn:
                asn = AsnModel(
                    id=uuid.uuid4(),
                    asn_number="ASN-PH2-001",
                    supplier_id=sup.id,
                    po_id=str(po.id),
                    po_number=po.po_number,
                    status="DISPATCHED",
                    warehouse_id="WH-01",
                    vehicle_number="KA-01-PH2-1234",
                    driver_name="Ramesh",
                    driver_contact="9876543210",
                    expected_arrival_at=now_utc,
                    shipment_date=today,
                    transporter="Fast Logistics",
                    number_of_packages=10,
                )
                session.add(asn)
                await session.flush()
                asn_line = AsnLineModel(
                    id=uuid.uuid4(),
                    asn_id=asn.id,
                    item_code="MAT-PH2-01",
                    material_name="Industrial Transformers",
                    shipped_quantity=Decimal("10"),
                    uom="NOS",
                )
                session.add(asn_line)

            # 4. Create Gate Entry in AWAITING_DOCK
            ge = (await session.execute(select(GateEntryModel).where(GateEntryModel.gate_entry_number == "GE-PH2-001"))).scalar_one_or_none()
            if not ge:
                ge = GateEntryModel(
                    id=uuid.uuid4(),
                    gate_entry_number="GE-PH2-001",
                    po_id=po.id,
                    asn_id=asn.id,
                    po_number=po.po_number,
                    vehicle_number=asn.vehicle_number,
                    driver_name=asn.driver_name,
                    driver_phone=asn.driver_contact,
                    po_document_path="/tmp/po.pdf",
                    status="AWAITING_DOCK",
                    security_officer_id="SEC-001",
                )
                session.add(ge)
            else:
                ge.status = "AWAITING_DOCK"
                ge.assigned_dock_id = None
                # Clear any existing assignment
                await session.execute(delete(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == ge.id))

            await session.commit()
            entry_id = str(ge.id)
            elec_store_id = str(s_elec.id)
            mech_store_id = str(s_mech.id)
            inactive_store_id = str(s_inactive.id)
            north_store_id = str(s_other_wh.id)

        # -------------------------------------------------------------
        # TEST 1: Validation Failures
        # -------------------------------------------------------------
        # 1a. Missing store_id
        res_fail_missing = await client.post(
            f"/api/gate-entries/{entry_id}/assign-dock",
            headers=wh_manager_headers,
            json={"dock_id": "DOCK-PH2-01"},
        )
        assert res_fail_missing.status_code == 422

        # 1b. Unknown store
        res_fail_unknown = await client.post(
            f"/api/gate-entries/{entry_id}/assign-dock",
            headers=wh_manager_headers,
            json={"dock_id": "DOCK-PH2-01", "store_id": str(uuid.uuid4())},
        )
        assert res_fail_unknown.status_code == 422
        assert "does not exist" in res_fail_unknown.json()["detail"]

        # 1c. Inactive store
        res_fail_inactive = await client.post(
            f"/api/gate-entries/{entry_id}/assign-dock",
            headers=wh_manager_headers,
            json={"dock_id": "DOCK-PH2-01", "store_id": inactive_store_id},
        )
        assert res_fail_inactive.status_code == 422
        assert "is inactive" in res_fail_inactive.json()["detail"]

        # 1d. Store belonging to a different warehouse (WH-NORTH vs WH-01)
        res_fail_wh = await client.post(
            f"/api/gate-entries/{entry_id}/assign-dock",
            headers=wh_manager_headers,
            json={"dock_id": "DOCK-PH2-01", "store_id": north_store_id},
        )
        assert res_fail_wh.status_code == 422
        assert "does not match dock warehouse" in res_fail_wh.json()["detail"]

        # -------------------------------------------------------------
        # TEST 2: Successful Post-Arrival Dock & Store Assignment
        # -------------------------------------------------------------
        res_assign = await client.post(
            f"/api/gate-entries/{entry_id}/assign-dock",
            headers=wh_manager_headers,
            json={"dock_id": "DOCK-PH2-01", "store_id": elec_store_id},
        )
        assert res_assign.status_code == 200, res_assign.text
        data = res_assign.json()
        assert data["status"] == "DOCK_ASSIGNED"
        assert data["dock_number"] == "DOCK-PH2-01"
        assert data["assigned_store_id"] == elec_store_id
        assert data["assigned_store_code"] == "STR-PH2-ELEC"
        assert data["assigned_store_name"] == "Phase 2 Electrical Store"

        # -------------------------------------------------------------
        # TEST 3: Verify Database Persistence
        # -------------------------------------------------------------
        async with session_scope() as session:
            assign_row = (
                await session.execute(
                    select(DockAssignmentModel).where(DockAssignmentModel.gate_entry_id == uuid.UUID(entry_id))
                )
            ).scalar_one_or_none()
            assert assign_row is not None
            assert assign_row.dock_number == "DOCK-PH2-01"
            assert str(assign_row.assigned_store_id) == elec_store_id
            assert assign_row.assigned_store_code == "STR-PH2-ELEC"
            assert assign_row.assigned_store_name == "Phase 2 Electrical Store"

            # Verify targeted notification in database
            notif_elec = (
                await session.execute(
                    select(NotificationModel).where(
                        NotificationModel.user_role == "STR:STR-PH2-ELEC"
                    )
                )
            ).scalars().all()
            assert len(notif_elec) >= 1
            assert "Phase 2 Electrical Store" in notif_elec[0].message
            assert "DOCK-PH2-01" in notif_elec[0].message
            assert "KA-01-PH2-1234" in notif_elec[0].message

            # Verify unrelated store (Mechanical Store) did NOT receive this notification
            notif_mech = (
                await session.execute(
                    select(NotificationModel).where(
                        NotificationModel.user_role == "STR:STR-PH2-MECH",
                        NotificationModel.message.like("%GE-PH2-001%"),
                    )
                )
            ).scalars().all()
            assert len(notif_mech) == 0

        # -------------------------------------------------------------
        # TEST 4: Verify Store-Level Arrival Scoping
        # -------------------------------------------------------------
        # Warehouse Manager / Admin sees the arrival
        res_arrivals_wm = await client.get("/api/gate-entries/inbound-arrivals", headers=wh_manager_headers)
        assert res_arrivals_wm.status_code == 200
        wm_arrival_ids = [a["id"] for a in res_arrivals_wm.json()]
        assert entry_id in wm_arrival_ids

        # Assigned arrival contains store details
        assigned_arrival = next(a for a in res_arrivals_wm.json() if a["id"] == entry_id)
        assert assigned_arrival["assigned_dock_id"] == "DOCK-PH2-01"
        assert assigned_arrival["assigned_store_id"] == elec_store_id
        assert assigned_arrival["assigned_store_code"] == "STR-PH2-ELEC"
        assert assigned_arrival["assigned_store_name"] == "Phase 2 Electrical Store"

        # -------------------------------------------------------------
        # TEST 5: Re-assignment Rejection (Already DOCK_ASSIGNED)
        # -------------------------------------------------------------
        res_reassign = await client.post(
            f"/api/gate-entries/{entry_id}/assign-dock",
            headers=wh_manager_headers,
            json={"dock_id": "DOCK-PH2-02", "store_id": mech_store_id},
        )
        assert res_reassign.status_code == 409

        # -------------------------------------------------------------
        # TEST 6: Store-Specific Notification API Isolation
        # -------------------------------------------------------------
        # Electrical Store Manager querying notifications
        res_notif_elec = await client.get(
            "/api/v1/procurement/notifications?role=STORE_MANAGER&store_code=STR-PH2-ELEC",
            headers=wh_manager_headers,
        )
        assert res_notif_elec.status_code == 200
        elec_notifs = res_notif_elec.json()
        assert any("Phase 2 Electrical Store" in n["message"] for n in elec_notifs)

        # Mechanical Store Manager querying notifications (must NOT see Electrical Store's arrival notification)
        res_notif_mech = await client.get(
            "/api/v1/procurement/notifications?role=STORE_MANAGER&store_code=STR-PH2-MECH",
            headers=wh_manager_headers,
        )
        assert res_notif_mech.status_code == 200
        mech_notifs = res_notif_mech.json()
        assert not any("GE-PH2-001" in n["message"] for n in mech_notifs)
