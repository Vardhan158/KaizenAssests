"""Unit tests verifying Store Manager authorization for Dock Release in the Dock Allocation module.

Covers:
1. Store Manager A + Store A + Dock A -> Release succeeds (200 OK).
2. Store Manager A + Store A + Dock B (assigned to Store B) -> 403 Forbidden.
3. Warehouse Manager -> Cannot release dock -> 403 Forbidden.
4. Non-authorized roles (e.g. Procurement, Finance) -> 403 Forbidden.
5. Unauthenticated user -> 401 Unauthorized.
6. Store Manager with no store assignment -> 403 Forbidden.
"""

from __future__ import annotations

import datetime
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, delete

from app.database.session import session_scope
from app.main import app
from app.modules.dock.domain.enums import AllocationPriority, AllocationStatus, DockStatus, DockType
from app.modules.dock.infrastructure.persistence.models import (
    DockAllocationHistoryModel,
    DockAllocationRequestModel,
    DockMasterModel,
    DockStatusHistoryModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreManagerUserModel,
    StoreModel,
)


@pytest.mark.asyncio
async def test_dock_release_store_manager_authorization():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        now_tz = datetime.datetime.now(datetime.timezone.utc)
        wh_id = "WH-BLR-01"

        async with session_scope() as session:
            # 1. Create two stores: Store A (Electronics) and Store B (Raw Materials)
            store_a = StoreModel(
                id=uuid.uuid4(),
                store_code=f"STR-A-{uuid.uuid4().hex[:4].upper()}",
                store_name="Electronics Testing Store",
                warehouse_id=wh_id,
                status="ACTIVE",
                created_at=now_tz,
                updated_at=now_tz,
            )
            store_b = StoreModel(
                id=uuid.uuid4(),
                store_code=f"STR-B-{uuid.uuid4().hex[:4].upper()}",
                store_name="Raw Materials Bulk Store",
                warehouse_id=wh_id,
                status="ACTIVE",
                created_at=now_tz,
                updated_at=now_tz,
            )
            session.add_all([store_a, store_b])

            # 2. Create Store Managers for Store A and Store B
            mgr_a_user = f"mgr_a_{uuid.uuid4().hex[:4]}"
            mgr_b_user = f"mgr_b_{uuid.uuid4().hex[:4]}"
            mgr_unassigned_user = f"mgr_un_{uuid.uuid4().hex[:4]}"

            mgr_a = StoreManagerUserModel(
                id=uuid.uuid4(),
                employee_id=f"EMP-A-{uuid.uuid4().hex[:4].upper()}",
                username=mgr_a_user,
                full_name="Alice Electronics Manager",
                email=f"{mgr_a_user}@test.com",
                password_hash="mock",
                store_id=store_a.id,
                status="ACTIVE",
                created_at=now_tz,
                updated_at=now_tz,
            )
            mgr_b = StoreManagerUserModel(
                id=uuid.uuid4(),
                employee_id=f"EMP-B-{uuid.uuid4().hex[:4].upper()}",
                username=mgr_b_user,
                full_name="Bob Materials Manager",
                email=f"{mgr_b_user}@test.com",
                password_hash="mock",
                store_id=store_b.id,
                status="ACTIVE",
                created_at=now_tz,
                updated_at=now_tz,
            )
            session.add_all([mgr_a, mgr_b])

            # 3. Create two Docks and Allocation Requests: Dock A (for Store A) and Dock B (for Store B)
            dock_a = DockMasterModel(
                id=uuid.uuid4(),
                dock_code=f"DK-A-{uuid.uuid4().hex[:4].upper()}",
                dock_name="Dock A Electronics",
                dock_type=DockType.ELECTRONICS.value,
                store_id=store_a.id,
                status=DockStatus.OCCUPIED.value,
                is_active=True,
                created_at=now_tz,
                updated_at=now_tz,
            )
            dock_b = DockMasterModel(
                id=uuid.uuid4(),
                dock_code=f"DK-B-{uuid.uuid4().hex[:4].upper()}",
                dock_name="Dock B Materials",
                dock_type=DockType.RAW_MATERIAL.value,
                store_id=store_b.id,
                status=DockStatus.OCCUPIED.value,
                is_active=True,
                created_at=now_tz,
                updated_at=now_tz,
            )
            session.add_all([dock_a, dock_b])
            await session.flush()

            alloc_a = DockAllocationRequestModel(
                id=uuid.uuid4(),
                existing_gate_pass_id=f"GP-A-{uuid.uuid4().hex[:6].upper()}",
                vendor_reference="Sony Components",
                vehicle_number="KA-01-EL-1111",
                material_reference="Microcontrollers",
                quantity=500,
                security_approved_at=now_tz,
                priority=AllocationPriority.NORMAL.value,
                status=AllocationStatus.OCCUPIED.value,
                assigned_dock_id=dock_a.id,
                assigned_store_id=store_a.id,
                assigned_store_code=store_a.store_code,
                assigned_store_name=store_a.store_name,
                assigned_at=now_tz,
                arrived_at=now_tz,
                created_at=now_tz,
                updated_at=now_tz,
            )
            alloc_b = DockAllocationRequestModel(
                id=uuid.uuid4(),
                existing_gate_pass_id=f"GP-B-{uuid.uuid4().hex[:6].upper()}",
                vendor_reference="Steel Corp",
                vehicle_number="KA-01-RM-2222",
                material_reference="Steel Sheets",
                quantity=1000,
                security_approved_at=now_tz,
                priority=AllocationPriority.HIGH.value,
                status=AllocationStatus.OCCUPIED.value,
                assigned_dock_id=dock_b.id,
                assigned_store_id=store_b.id,
                assigned_store_code=store_b.store_code,
                assigned_store_name=store_b.store_name,
                assigned_at=now_tz,
                arrived_at=now_tz,
                created_at=now_tz,
                updated_at=now_tz,
            )
            session.add_all([alloc_a, alloc_b])
            await session.commit()

            alloc_a_id_str = str(alloc_a.id)
            alloc_b_id_str = str(alloc_b.id)
            store_a_id_str = str(store_a.id)
            store_b_id_str = str(store_b.id)
            store_a_code = store_a.store_code
            store_b_code = store_b.store_code
            dock_a_id_str = str(dock_a.id)

        # Header definitions for different actors
        headers_store_mgr_a = {
            "Authorization": "Bearer mock-jwt-token",
            "X-User-Roles": "STORE_MANAGER",
            "X-User-Permissions": "gate:write,store:write",
            "X-Store-Id": store_a_id_str,
            "X-Store-Code": store_a_code,
        }

        headers_store_mgr_b = {
            "Authorization": "Bearer mock-jwt-token",
            "X-User-Roles": "STORE_MANAGER",
            "X-User-Permissions": "gate:write,store:write",
            "X-Store-Id": store_b_id_str,
            "X-Store-Code": store_b_code,
        }

        headers_warehouse_mgr = {
            "Authorization": "Bearer mock-jwt-token",
            "X-User-Roles": "WAREHOUSE_MANAGER",
            "X-User-Permissions": "gate:write,warehouse:admin",
        }

        headers_procurement_user = {
            "Authorization": "Bearer mock-jwt-token",
            "X-User-Roles": "PROCUREMENT",
            "X-User-Permissions": "procurement:read",
        }

        headers_store_mgr_unassigned = {
            "Authorization": "Bearer mock-jwt-token",
            "X-User-Roles": "STORE_MANAGER",
            "X-User-Permissions": "gate:write,store:write",
            # No X-Store-Id provided and user has no store in database
            "X-User-Name": mgr_unassigned_user,
        }

        # Case 5: Unauthenticated user -> 401
        resp_unauth = await client.post(f"/api/v1/warehouse/dock-allocations/{alloc_a_id_str}/release")
        assert resp_unauth.status_code == 401

        # Case 3: Warehouse Manager attempts to release dock -> 403 Forbidden
        resp_wh = await client.post(
            f"/api/v1/warehouse/dock-allocations/{alloc_a_id_str}/release",
            headers=headers_warehouse_mgr,
        )
        assert resp_wh.status_code == 403
        assert "Warehouse Manager is not authorized to release docks" in resp_wh.json()["detail"]

        # Case 4: Non-authorized role (Procurement) -> 403 Forbidden
        resp_proc = await client.post(
            f"/api/v1/warehouse/dock-allocations/{alloc_a_id_str}/release",
            headers=headers_procurement_user,
        )
        assert resp_proc.status_code == 403

        # Case 6: Store Manager with no store assignment -> 403 Forbidden
        resp_unassigned = await client.post(
            f"/api/v1/warehouse/dock-allocations/{alloc_a_id_str}/release",
            headers=headers_store_mgr_unassigned,
        )
        assert resp_unassigned.status_code == 403
        assert "does not have an assigned store" in resp_unassigned.json()["detail"]

        # Case 2: Store Manager B attempts to release Dock A (Store A) -> 403 Forbidden
        resp_sm_cross = await client.post(
            f"/api/v1/warehouse/dock-allocations/{alloc_a_id_str}/release",
            headers=headers_store_mgr_b,
        )
        assert resp_sm_cross.status_code == 403
        assert "only release docks assigned to your Store" in resp_sm_cross.json()["detail"]

        # Case 1: Store Manager A releases Dock A (Store A) -> 200 OK
        resp_sm_a = await client.post(
            f"/api/v1/warehouse/dock-allocations/{alloc_a_id_str}/release",
            headers=headers_store_mgr_a,
        )
        assert resp_sm_a.status_code == 200
        data = resp_sm_a.json()
        assert data["status"] == "RELEASED"

        # Verify DB state: dock returned to AVAILABLE
        async with session_scope() as session:
            d = (await session.execute(
                select(DockMasterModel).where(DockMasterModel.id == uuid.UUID(dock_a_id_str))
            )).scalar_one()
            assert d.status == "AVAILABLE"

            req = (await session.execute(
                select(DockAllocationRequestModel).where(DockAllocationRequestModel.id == uuid.UUID(alloc_a_id_str))
            )).scalar_one()
            assert req.status == "RELEASED"
            assert req.released_at is not None

        # Re-release attempt on already released dock -> 400 Bad Request
        resp_double = await client.post(
            f"/api/v1/warehouse/dock-allocations/{alloc_a_id_str}/release",
            headers=headers_store_mgr_a,
        )
        assert resp_double.status_code == 400
