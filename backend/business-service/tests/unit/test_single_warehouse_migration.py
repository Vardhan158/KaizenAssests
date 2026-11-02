"""Isolated migration tests, including data preservation and singleton enforcement."""
import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi import HTTPException

from app.database.single_warehouse_migration import migrate


def test_consolidates_legacy_hierarchy_without_losing_balances_or_accounts():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        conn.exec_driver_sql("CREATE TABLE store (id TEXT PRIMARY KEY, store_code TEXT UNIQUE, store_name TEXT)")
        conn.exec_driver_sql("CREATE TABLE store_zone (id TEXT PRIMARY KEY, store_id TEXT REFERENCES store(id), zone_code TEXT, UNIQUE(store_id,zone_code))")
        conn.exec_driver_sql("CREATE TABLE store_bin (id TEXT PRIMARY KEY, store_id TEXT REFERENCES store(id), zone_id TEXT REFERENCES store_zone(id), bin_code TEXT, UNIQUE(store_id,bin_code))")
        conn.exec_driver_sql("CREATE TABLE store_manager_user (id TEXT PRIMARY KEY, store_id TEXT REFERENCES store(id), role TEXT)")
        conn.exec_driver_sql("CREATE TABLE inventory_location_balance (id TEXT PRIMARY KEY, store_id TEXT REFERENCES store(id), quantity INTEGER)")
        conn.exec_driver_sql("INSERT INTO store VALUES ('a','STR-1','Main Warehouse'),('b','STR-2','Legacy')")
        conn.exec_driver_sql("INSERT INTO store_zone VALUES ('z1','a','ZONE-A'),('z2','b','ZONE-A')")
        conn.exec_driver_sql("INSERT INTO store_bin VALUES ('b1','a','z1','BIN-1'),('b2','b','z2','BIN-1')")
        conn.exec_driver_sql("INSERT INTO store_manager_user VALUES ('u','b','Store Manager')")
        conn.exec_driver_sql("INSERT INTO inventory_location_balance VALUES ('i','b',17)")
        result = migrate(conn)
        assert result["warehouse_count"] == 1
        assert "store" not in inspect(conn).get_table_names()
        assert conn.exec_driver_sql("SELECT warehouse_ref_id, quantity FROM inventory_location_balance").one() == ("a",17)
        assert conn.exec_driver_sql("SELECT role FROM user_account").scalar_one() == "WAREHOUSE_OPERATOR"
        assert conn.exec_driver_sql("SELECT count(*) FROM warehouse_zone").scalar_one() == 2
        assert conn.exec_driver_sql("SELECT count(*) FROM warehouse_bin").scalar_one() == 2
        assert conn.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        assert migrate(conn)["changed"] is False
        with pytest.raises(IntegrityError):
            conn.exec_driver_sql("INSERT INTO warehouse_configuration (id,warehouse_code,warehouse_name) VALUES ('c','WH-002','Another')")


def test_refuses_populated_parallel_schema():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE store (id TEXT)")
        conn.exec_driver_sql("CREATE TABLE warehouse_configuration (id TEXT)")
        conn.exec_driver_sql("INSERT INTO warehouse_configuration VALUES ('new')")
        with pytest.raises(RuntimeError, match="manual reconciliation"):
            migrate(conn)


@pytest.mark.parametrize("role", ["WAREHOUSE_OPERATOR", "WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN"])
async def test_putaway_authorization_keeps_all_warehouse_operational_roles(role, monkeypatch):
    from app.modules.storage.infrastructure.api.router import ExecutePutawayRequest, execute_putaway
    from app.security.dependencies import CurrentUser
    resolver = AsyncMock(side_effect=HTTPException(422, "QR validation reached"))
    monkeypatch.setattr("app.modules.storage.infrastructure.api.router.resolve_grn_qr", resolver)
    with pytest.raises(HTTPException) as error:
        await execute_putaway(
            ExecutePutawayRequest(grn_qr_code="GRN-TEST", bin_qr_code="BIN-TEST", quantity=1),
            CurrentUser("test", "test", [role], [], {}), SimpleNamespace(session=AsyncMock()),
        )
    assert error.value.status_code == 422
    resolver.assert_awaited_once()
