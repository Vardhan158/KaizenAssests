"""
Regression test for Warehouse authorization & permissions on storage and inventory endpoints.
Verifies that Warehouse users have full access to warehouse endpoints, while Store Managers
remain properly restricted from global gate/storage endpoints.
"""
import pytest
from fastapi.security import HTTPAuthorizationCredentials
from httpx import ASGITransport, AsyncClient
from starlette.requests import Request

from app.main import app
from app.security.dependencies import get_current_user


@pytest.mark.asyncio
async def test_warehouse_authorization_on_inventory_and_storage_endpoints():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        warehouse_bearer_headers = {
            "Authorization": "Bearer mock-jwt-warehouse-token",
        }
        warehouse_custom_headers = {
            "X-User-Roles": "WAREHOUSE",
            "X-User-Name": "warehouse_user",
        }

        # 1. Test /api/storage/putaway-tasks/inventory-locations with Bearer token
        res_loc_bearer = await client.get("/api/storage/putaway-tasks/inventory-locations", headers=warehouse_bearer_headers)
        assert res_loc_bearer.status_code == 200, f"Expected 200, got {res_loc_bearer.status_code}: {res_loc_bearer.text}"
        assert isinstance(res_loc_bearer.json(), list)

        # 2. Test /api/storage/putaway-tasks/inventory-locations with X-User-Roles header
        res_loc_custom = await client.get("/api/storage/putaway-tasks/inventory-locations", headers=warehouse_custom_headers)
        assert res_loc_custom.status_code == 200, f"Expected 200, got {res_loc_custom.status_code}: {res_loc_custom.text}"
        assert isinstance(res_loc_custom.json(), list)

        # 3. Test /api/gate-entries/inventory-transactions with Bearer token
        res_tx_bearer = await client.get("/api/gate-entries/inventory-transactions", headers=warehouse_bearer_headers)
        assert res_tx_bearer.status_code == 200, f"Expected 200, got {res_tx_bearer.status_code}: {res_tx_bearer.text}"
        assert isinstance(res_tx_bearer.json(), list)

        # 4. Test /api/gate-entries/inventory-transactions with X-User-Roles header
        res_tx_custom = await client.get("/api/gate-entries/inventory-transactions", headers=warehouse_custom_headers)
        assert res_tx_custom.status_code == 200, f"Expected 200, got {res_tx_custom.status_code}: {res_tx_custom.text}"
        assert isinstance(res_tx_custom.json(), list)


@pytest.mark.asyncio
async def test_manager_mock_token_has_explicit_approval_permissions_only():
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="mock-jwt-manager-token")

    user = await get_current_user(request, credentials)

    assert "ADMIN" not in user.roles
    assert "procurement:approve" in user.permissions
    assert "gate:approve" in user.permissions


@pytest.mark.asyncio
async def test_store_manager_restricted_from_global_warehouse_endpoints():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        store_mgr_headers = {
            "Authorization": "Bearer mock-jwt-store-manager-elec",
        }

        # 1. Store Manager should NOT have access to global gate inventory transactions (403 Forbidden)
        res_tx = await client.get("/api/gate-entries/inventory-transactions", headers=store_mgr_headers)
        assert res_tx.status_code == 403, f"Store manager should get 403 on global transactions, got: {res_tx.status_code}"

        # 2. Store Manager should NOT have access to another Store's inventory locations (403 Forbidden)
        res_loc = await client.get("/api/storage/putaway-tasks/inventory-locations?store_id=00000000-0000-0000-0000-000000000000", headers=store_mgr_headers)
        assert res_loc.status_code == 403, f"Store manager should get 403 on cross-store locations, got: {res_loc.status_code}"
