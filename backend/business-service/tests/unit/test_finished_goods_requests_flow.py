"""
Unit and API integration tests for Finished Goods Request flow:
Procurement -> Finished Goods Request -> Send to Assembly -> Assembly inspects FG Store -> Warehouse tracks request.
"""
from datetime import date, datetime
from decimal import Decimal
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.database.session import session_scope
from app.main import app
from app.modules.assembly.infrastructure.persistence.models import AssemblyFinishedGoodsModel, AssemblyOrderModel
from app.modules.procurement.infrastructure.persistence.models import (
    FinishedGoodsRequestModel,
    NotificationModel,
)


@pytest.fixture(autouse=True)
async def clean_finished_goods_test_data():
    """Clean up test records before and after each test."""
    async with session_scope() as session:
        await session.execute(delete(FinishedGoodsRequestModel))
        await session.execute(
            delete(NotificationModel).where(
                NotificationModel.title.in_(["New Finished Goods Request", "Finished Goods Request Tracking"])
            )
        )
        await session.commit()
    yield
    async with session_scope() as session:
        await session.execute(delete(FinishedGoodsRequestModel))
        await session.commit()


@pytest.mark.asyncio
async def test_create_finished_goods_request_validation():
    """Validate quantity > 0 and product required."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {"X-User-Roles": "PROCUREMENT", "X-User-Name": "procurement_officer"}

        # 1. Invalid quantity <= 0
        res_zero = await client.post(
            "/api/v1/procurement/finished-goods-requests",
            json={
                "finished_goods_code": "FG-001",
                "finished_goods_name": "Product Alpha",
                "quantity": 0,
                "uom": "PCS",
            },
            headers=headers,
        )
        assert res_zero.status_code in (400, 422)

        # 2. Negative quantity
        res_neg = await client.post(
            "/api/v1/procurement/finished-goods-requests",
            json={
                "finished_goods_code": "FG-001",
                "finished_goods_name": "Product Alpha",
                "quantity": -10,
                "uom": "PCS",
            },
            headers=headers,
        )
        assert res_neg.status_code in (400, 422)

        # 3. Missing product name
        res_no_prod = await client.post(
            "/api/v1/procurement/finished-goods-requests",
            json={
                "finished_goods_code": "FG-001",
                "finished_goods_name": "   ",
                "quantity": 50,
                "uom": "PCS",
            },
            headers=headers,
        )
        assert res_no_prod.status_code in (400, 422)


@pytest.mark.asyncio
async def test_procurement_to_assembly_and_warehouse_flow():
    """
    Test complete flow:
    Procurement creates Finished Goods Request -> Send to Assembly -> Status is SENT_TO_ASSEMBLY ->
    Assembly inspects FG Store -> Warehouse tracks request.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        proc_headers = {"X-User-Roles": "PROCUREMENT", "X-User-Name": "sarah_procurement"}
        assembly_headers = {"X-User-Roles": "ASSEMBLY_MANAGER", "X-User-Name": "alex_assembly"}
        wh_headers = {"X-User-Roles": "WAREHOUSE", "X-User-Name": "mark_warehouse"}

        # 1. Procurement creates Finished Goods Request with optional BOM attachment
        create_payload = {
            "warehouse_id": "MAIN",
            "finished_goods_code": "FG-PROD-A",
            "finished_goods_name": "Product A",
            "quantity": 100,
            "uom": "PCS",
            "required_date": date.today().isoformat(),
            "bom_attachment_url": "/media/bom_attachments/sample_bom.pdf",
            "bom_attachment_name": "Sample_ProductA_BOM.pdf",
            "remarks": "Priority order for customer batch",
        }
        res_create = await client.post(
            "/api/v1/procurement/finished-goods-requests",
            json=create_payload,
            headers=proc_headers,
        )
        assert res_create.status_code == 201
        created_data = res_create.json()
        req_id = created_data["id"]
        req_number = created_data["request_number"]

        assert req_number.startswith("FGR-")
        assert created_data["status"] == "SENT_TO_ASSEMBLY"
        assert created_data["quantity"] == 100.0
        assert created_data["product_name"] == "Product A"
        assert created_data["bom_attachment_url"] == "/media/bom_attachments/sample_bom.pdf"
        assert created_data["bom_attachment_name"] == "Sample_ProductA_BOM.pdf"

        # 2. Verify notifications sent to Assembly and Warehouse
        async with session_scope() as session:
            notifs = (await session.execute(select(NotificationModel))).scalars().all()
            assembly_notifs = [n for n in notifs if n.user_role == "ASSEMBLY"]
            wh_notifs = [n for n in notifs if n.user_role == "WAREHOUSE"]
            assert len(assembly_notifs) >= 1
            assert req_number in assembly_notifs[0].message
            assert "Product A" in assembly_notifs[0].message
            assert len(wh_notifs) >= 1
            assert req_number in wh_notifs[0].message

        # 3. Assembly receives and lists the requests
        res_assembly_list = await client.get(
            "/api/v1/assembly/finished-goods-requests",
            headers=assembly_headers,
        )
        assert res_assembly_list.status_code == 200
        assembly_items = res_assembly_list.json()
        assert any(item["request_number"] == req_number for item in assembly_items)

        # 4. Assembly opens the specific request and checks Finished Goods Store
        res_assembly_detail = await client.get(
            f"/api/v1/assembly/finished-goods-requests/{req_id}",
            headers=assembly_headers,
        )
        assert res_assembly_detail.status_code == 200
        detail_data = res_assembly_detail.json()
        assert detail_data["request_number"] == req_number
        assert detail_data["product_name"] == "Product A"
        assert detail_data["requested_quantity"] == 100.0
        assert detail_data["bom_attachment_url"] == "/media/bom_attachments/sample_bom.pdf"
        assert "fg_store_available" in detail_data
        assert "shortage" in detail_data

        # 5. Warehouse tracks the exact same request
        res_wh_track = await client.get(
            f"/api/v1/procurement/finished-goods-requests/{req_id}",
            headers=wh_headers,
        )
        assert res_wh_track.status_code == 200
        wh_data = res_wh_track.json()
        assert wh_data["id"] == req_id
        assert wh_data["request_number"] == req_number
        assert wh_data["created_by"] == "sarah_procurement"
        assert wh_data["status"] == "SENT_TO_ASSEMBLY"


@pytest.mark.asyncio
async def test_manual_input_pump_100_quantity_10():
    """
    Test submitting manual Finished Product input: PUMP-100 with Quantity 10.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        proc_headers = {"X-User-Roles": "PROCUREMENT", "X-User-Name": "procurement_user"}

        payload = {
            "warehouse_id": "MAIN",
            "finished_goods_name": "PUMP-100",
            "quantity": 10,
            "uom": "PCS",
            "required_date": date.today().isoformat(),
        }

        res = await client.post(
            "/api/v1/procurement/finished-goods-requests",
            json=payload,
            headers=proc_headers,
        )
        assert res.status_code == 201
        data = res.json()
        assert data["product_name"] == "PUMP-100"
        assert data["product_code"] == "PUMP-100"
        assert data["quantity"] == 10.0
        assert data["status"] == "SENT_TO_ASSEMBLY"
        assert data["created_by"] == "procurement_user"


@pytest.mark.asyncio
async def test_fg_store_availability_and_shortage_calculation():
    """
    Test Finished Goods Store availability check and shortage calculation against database inventory.
    Requested: 100, FG Store Available: 70 -> Shortage: 30
    """
    from app.modules.procurement.infrastructure.persistence.models import (
        MaterialRequestModel,
        PickTaskModel,
        MaterialIssueModel,
    )

    test_product_code = f"FG-TEST-{uuid.uuid4().hex[:6].upper()}"
    test_req_id = uuid.uuid4()
    test_task_id = uuid.uuid4()
    test_issue_id = uuid.uuid4()
    test_order_id = uuid.uuid4()
    now = datetime.now()

    async with session_scope() as session:
        mat_req = MaterialRequestModel(
            id=test_req_id,
            request_number=f"MR-TEST-{uuid.uuid4().hex[:4].upper()}",
            warehouse_id="MAIN",
            department="Assembly",
            requested_by="tester",
            status="ISSUED",
            required_date=now.date(),
            created_at=now,
        )
        session.add(mat_req)
        await session.commit()

    async with session_scope() as session:
        pick_task = PickTaskModel(
            id=test_task_id,
            task_number=f"PT-TEST-{uuid.uuid4().hex[:4].upper()}",
            request_id=test_req_id,
            request_number=mat_req.request_number,
            warehouse_id="MAIN",
            department="Assembly",
            items=[],
            status="COMPLETED",
            created_by="warehouse",
        )
        session.add(pick_task)
        await session.commit()

    async with session_scope() as session:
        mat_issue = MaterialIssueModel(
            id=test_issue_id,
            issue_number=f"MI-TEST-{uuid.uuid4().hex[:4].upper()}",
            pick_task_id=test_task_id,
            request_id=test_req_id,
            department="Assembly",
            items=[],
            issued_by="warehouse_operator",
            received_by="assembly_operator",
            issued_at=now,
        )
        session.add(mat_issue)
        await session.commit()

    async with session_scope() as session:
        order = AssemblyOrderModel(
            id=test_order_id,
            order_number=f"AO-TEST-{uuid.uuid4().hex[:4].upper()}",
            material_request_id=test_req_id,
            pick_task_id=test_task_id,
            material_issue_id=test_issue_id,
            request_number="MR-TEST",
            department="Assembly",
            product_name="Test Widget Model",
            status="COMPLETED",
            planned_quantity=Decimal("70"),
            completed_quantity=Decimal("70"),
            created_by="assembly_operator",
            created_at=now,
        )
        session.add(order)
        await session.commit()

    async with session_scope() as session:
        fg_record = AssemblyFinishedGoodsModel(
            id=uuid.uuid4(),
            assembly_order_id=test_order_id,
            product_code=test_product_code,
            product_name="Test Widget Model",
            quantity=Decimal("70.0"),
            uom="PCS",
            status="AVAILABLE",
            warehouse_id="MAIN",
            location_code="FG-ZONE-A",
            on_hand_before=Decimal("0"),
            on_hand_after=Decimal("70.0"),
            posted_at=now,
        )
        session.add(fg_record)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {"X-User-Roles": "PROCUREMENT", "X-User-Name": "procurement"}

        # Request quantity 100
        res = await client.post(
            "/api/v1/procurement/finished-goods-requests",
            json={
                "warehouse_id": "MAIN",
                "finished_goods_code": test_product_code,
                "finished_goods_name": "Test Widget Model",
                "quantity": 100,
                "uom": "PCS",
            },
            headers=headers,
        )
        assert res.status_code == 201
        data = res.json()
        assert data["requested_quantity"] == 100.0
        assert data["fg_store_available"] == 70.0
        assert data["shortage"] == 30.0

    # Clean up seeded records
    async with session_scope() as session:
        await session.execute(
            delete(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.assembly_order_id == test_order_id)
        )
        await session.execute(
            delete(AssemblyOrderModel).where(AssemblyOrderModel.id == test_order_id)
        )
        await session.execute(
            delete(MaterialIssueModel).where(MaterialIssueModel.id == test_issue_id)
        )
        await session.execute(
            delete(PickTaskModel).where(PickTaskModel.id == test_task_id)
        )
        await session.execute(
            delete(MaterialRequestModel).where(MaterialRequestModel.id == test_req_id)
        )
        await session.commit()


@pytest.mark.asyncio
async def test_assembly_dashboard_pending_orders_metric():
    """
    Test that Assembly Dashboard Pending Assembly Orders card dynamically reflects
    Finished Goods Requests sent to assembly, and updates when status changes.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        assembly_headers = {"X-User-Roles": "ASSEMBLY_MANAGER", "X-User-Name": "assembly_mgr"}
        proc_headers = {"X-User-Roles": "PROCUREMENT", "X-User-Name": "procurement_user"}

        # 1. Get initial baseline dashboard stats
        res0 = await client.get("/api/v1/assembly/dashboard", headers=assembly_headers)
        assert res0.status_code == 200
        initial_pending = res0.json()["stats"]["pending"]

        # 2. Create Finished Goods Request for Pump-100, quantity 10
        create_res = await client.post(
            "/api/v1/procurement/finished-goods-requests",
            json={
                "warehouse_id": "MAIN",
                "finished_goods_name": "Pump-100",
                "quantity": 10,
                "uom": "PCS",
            },
            headers=proc_headers,
        )
        assert create_res.status_code == 201
        fgr_id = create_res.json()["id"]
        assert create_res.json()["status"] == "SENT_TO_ASSEMBLY"

        # 3. Verify Assembly Dashboard reflects the new pending request
        res1 = await client.get("/api/v1/assembly/dashboard", headers=assembly_headers)
        assert res1.status_code == 200
        assert res1.json()["stats"]["pending"] == initial_pending + 1

        # 4. Change status of the finished goods request to CANCELLED / COMPLETED
        async with session_scope() as session:
            fgr_record = await session.get(FinishedGoodsRequestModel, uuid.UUID(fgr_id))
            fgr_record.status = "COMPLETED"
            await session.commit()

        # 5. Verify Assembly Dashboard dynamically decrements back
        res2 = await client.get("/api/v1/assembly/dashboard", headers=assembly_headers)
        assert res2.status_code == 200
        assert res2.json()["stats"]["pending"] == initial_pending

        # 6. Change status back to SENT_TO_ASSEMBLY and verify dynamic increment
        async with session_scope() as session:
            fgr_record = await session.get(FinishedGoodsRequestModel, uuid.UUID(fgr_id))
            fgr_record.status = "SENT_TO_ASSEMBLY"
            await session.commit()

        res3 = await client.get("/api/v1/assembly/dashboard", headers=assembly_headers)
        assert res3.status_code == 200
        assert res3.json()["stats"]["pending"] == initial_pending + 1

        # 7. Clean up
        async with session_scope() as session:
            await session.execute(
                delete(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.id == uuid.UUID(fgr_id))
            )
            await session.commit()

