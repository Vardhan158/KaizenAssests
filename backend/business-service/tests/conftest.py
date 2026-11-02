"""Safety gates for backend tests."""

from __future__ import annotations

import os
from urllib.parse import unquote, urlparse


TEST_DATABASE_ENV = "KAIZENASSESTS_TEST_DATABASE_URL"
PROTECTED_DATABASE_NAMES = {
    "ams_business",
    "ams_business_dev",
    "ams_business_development",
    "ams_business_staging",
    "ams_business_prod",
    "ams_business_production",
}


def _get_test_database_url() -> str:
    raw_url = os.environ.get(TEST_DATABASE_ENV, "").strip()
    if not raw_url:
        raise RuntimeError(
            f"Refusing to run tests: set {TEST_DATABASE_ENV} to a dedicated "
            "disposable PostgreSQL test database URL."
        )

    parsed = urlparse(raw_url)
    database_name = unquote(parsed.path.lstrip("/")).lower()
    safe_name = database_name.startswith("kaizenassests_test_") or database_name.endswith("_test")
    if parsed.scheme.lower() not in {"postgresql", "postgresql+asyncpg"}:
        raise RuntimeError(f"Refusing to run tests: {TEST_DATABASE_ENV} must use PostgreSQL.")
    if not database_name or database_name in PROTECTED_DATABASE_NAMES or not safe_name:
        raise RuntimeError(
            f"Refusing to run tests: database '{database_name or '<missing>'}' is not an "
            "allowlisted disposable test database. Use a name prefixed with "
            "'kaizenassests_test_' or suffixed with '_test'."
        )
    return raw_url


# Set the application setting before importing the app session module.
os.environ["DATABASE_URL"] = _get_test_database_url()

import pytest
from sqlalchemy import text

from app.database.session import session_scope


_db_initialized = False


@pytest.fixture(autouse=True)
async def ensure_db_schema_compatible():
    """Run legacy compatibility additions only inside the test database."""

    global _db_initialized
    if _db_initialized:
        return
    _db_initialized = True

    async with session_scope() as session:
        for table, columns in {
            "notification": [
                ("dock_code", "VARCHAR(64)"),
                ("dock_name", "VARCHAR(128)"),
                ("dock_location", "VARCHAR(256)"),
                ("dock_type", "VARCHAR(64)"),
                ("warehouse_name", "VARCHAR(128)"),
                ("allocation_time", "TIMESTAMP WITH TIME ZONE"),
                ("gate_pass_number", "VARCHAR(64)"),
                ("vehicle_number", "VARCHAR(64)"),
                ("driver_name", "VARCHAR(128)"),
                ("driver_phone", "VARCHAR(32)"),
                ("asn_number", "VARCHAR(64)"),
                ("po_number", "VARCHAR(64)"),
            ],
            "dock_assignment": [
                ("assigned_warehouse_ref_id", "UUID"),
                ("assigned_warehouse_code", "VARCHAR(64)"),
                ("assigned_warehouse_name", "VARCHAR(128)"),
                ("assigned_warehouse_operator_id", "VARCHAR(128)"),
                ("assigned_warehouse_operator_username", "VARCHAR(128)"),
                ("assigned_warehouse_operator_name", "VARCHAR(128)"),
                ("movement_started_by", "VARCHAR(128)"),
                ("movement_started_at", "TIMESTAMP WITH TIME ZONE"),
                ("dock_checked_in_by", "VARCHAR(128)"),
                ("dock_arrival_at", "TIMESTAMP WITH TIME ZONE"),
                ("unloading_started_by", "VARCHAR(128)"),
                ("unloading_started_at", "TIMESTAMP WITH TIME ZONE"),
                ("quality_inspected_by", "VARCHAR(128)"),
                ("quality_inspected_at", "TIMESTAMP WITH TIME ZONE"),
                ("quality_decision", "VARCHAR(16)"),
                ("quality_notes", "TEXT"),
                ("quality_issue_image_data", "BYTEA"),
                ("quality_issue_filename", "VARCHAR(256)"),
                ("quality_issue_content_type", "VARCHAR(128)"),
                ("quality_issue_status", "VARCHAR(32)"),
                ("quality_issue_sent_at", "TIMESTAMP WITH TIME ZONE"),
                ("quality_issue_forwarded_at", "TIMESTAMP WITH TIME ZONE"),
                ("prepared_grn_id", "UUID"),
                ("receiving_completed_by", "VARCHAR(128)"),
                ("receiving_completed_at", "TIMESTAMP WITH TIME ZONE"),
                ("dock_released_by", "VARCHAR(128)"),
                ("dock_released_at", "TIMESTAMP WITH TIME ZONE"),
            ],
        }.items():
            exists = await session.scalar(text("SELECT to_regclass(:table_name)"), {"table_name": table})
            if exists is None:
                continue
            for column_name, column_type in columns:
                await session.execute(
                    text(
                        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "
                        f"{column_name} {column_type}"
                    )
                )
