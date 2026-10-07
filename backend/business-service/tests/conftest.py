import pytest
from sqlalchemy import text
from app.database.session import session_scope

_db_initialized = False

@pytest.fixture(autouse=True)
async def ensure_db_schema_compatible():
    global _db_initialized
    if _db_initialized:
        return
    _db_initialized = True
    try:
        async with session_scope() as session:
            # 1. notification table
            for col in [
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
            ]:
                try:
                    await session.execute(text(f"ALTER TABLE notification ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}"))
                except Exception:
                    pass

            # 2. dock_assignment table
            for col in [
                ("assigned_store_id", "UUID"),
                ("assigned_store_code", "VARCHAR(64)"),
                ("assigned_store_name", "VARCHAR(128)"),
                ("assigned_store_manager_id", "VARCHAR(128)"),
                ("assigned_store_manager_username", "VARCHAR(128)"),
                ("assigned_store_manager_name", "VARCHAR(128)"),
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
            ]:
                try:
                    await session.execute(text(f"ALTER TABLE dock_assignment ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}"))
                except Exception:
                    pass

            try:
                await session.execute(text("ALTER TABLE dock_masters ADD COLUMN IF NOT EXISTS store_id UUID"))
            except Exception:
                pass

            for col in [
                ("assigned_store_id", "UUID"),
                ("assigned_store_code", "VARCHAR(64)"),
                ("assigned_store_name", "VARCHAR(128)"),
                ("assigned_store_manager_id", "VARCHAR(128)"),
                ("assigned_store_manager_username", "VARCHAR(128)"),
                ("assigned_store_manager_name", "VARCHAR(128)"),
            ]:
                try:
                    await session.execute(text(f"ALTER TABLE dock_allocation_requests ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}"))
                except Exception:
                    pass

            # 3. receiving_line table
            for col in [
                ("physical_condition_ok", "BOOLEAN"),
                ("packaging_ok", "BOOLEAN"),
                ("specifications_ok", "BOOLEAN"),
                ("serial_batch_number", "VARCHAR(128)"),
                ("serial_batch_verified", "BOOLEAN NOT NULL DEFAULT FALSE"),
                ("disposition_status", "VARCHAR(32)"),
                ("quarantine_location", "VARCHAR(128)"),
                ("quarantined_by", "VARCHAR(128)"),
                ("quarantined_at", "TIMESTAMP WITH TIME ZONE"),
                ("good_quantity", "NUMERIC(18, 4)"),
                ("damaged_quantity", "NUMERIC(18, 4)"),
                ("rejected_quantity", "NUMERIC(18, 4)"),
                ("condition_result", "VARCHAR(32)"),
                ("inspection_required", "BOOLEAN NOT NULL DEFAULT FALSE"),
                ("condition_notes", "TEXT"),
                ("condition_checked_by", "VARCHAR(128)"),
                ("condition_checked_at", "TIMESTAMP WITH TIME ZONE"),
            ]:
                try:
                    await session.execute(text(f"ALTER TABLE receiving_line ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}"))
                except Exception:
                    pass

            # 4. grn table
            for col in [
                ("po_number", "VARCHAR(64)"),
                ("grn_number", "VARCHAR(64)"),
                ("asn_id", "UUID"),
                ("asn_number", "VARCHAR(64)"),
                ("gate_entry_id", "UUID"),
                ("gate_entry_number", "VARCHAR(64)"),
                ("supplier_name", "VARCHAR(255)"),
                ("supplier_company_name", "VARCHAR(255)"),
                ("warehouse_id", "VARCHAR(64)"),
                ("warehouse_name", "VARCHAR(255)"),
                ("dock_number", "VARCHAR(32)"),
                ("vehicle_number", "VARCHAR(64)"),
                ("driver_name", "VARCHAR(128)"),
                ("invoice_number", "VARCHAR(128)"),
                ("receipt_type", "VARCHAR(32) DEFAULT 'PO_RECEIPT'"),
                ("receipt_date", "TIMESTAMP WITH TIME ZONE"),
                ("received_by", "VARCHAR(128)"),
                ("status", "VARCHAR(32) DEFAULT 'DRAFT'"),
                ("posted_by", "VARCHAR(128)"),
                ("posted_at", "TIMESTAMP WITH TIME ZONE"),
                ("verification_notes", "TEXT"),
                ("created_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
                ("updated_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
            ]:
                try:
                    await session.execute(text(f"ALTER TABLE grn ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}"))
                except Exception:
                    pass

            # 5. grn_line table
            for col in [
                ("material_name", "VARCHAR(256)"),
                ("material_category", "VARCHAR(128)"),
                ("uom", "VARCHAR(32)"),
                ("ordered_quantity", "NUMERIC(18, 4)"),
                ("received_quantity", "NUMERIC(18, 4) DEFAULT 0"),
                ("good_quantity", "NUMERIC(18, 4) DEFAULT 0"),
                ("damaged_quantity", "NUMERIC(18, 4) DEFAULT 0"),
                ("accepted_quantity", "NUMERIC(18, 4)"),
                ("rejected_quantity", "NUMERIC(18, 4) DEFAULT 0"),
                ("quality_approved_quantity", "NUMERIC(18, 4) DEFAULT 0"),
                ("balance_quantity", "NUMERIC(18, 4) DEFAULT 0"),
                ("quality_result", "VARCHAR(32)"),
            ]:
                try:
                    await session.execute(text(f"ALTER TABLE grn_line ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}"))
                except Exception:
                    pass

            # 6. storage_location table
            for col in [
                ("store_id", "UUID"),
                ("zone_id", "UUID"),
                ("bin_id", "UUID"),
            ]:
                try:
                    await session.execute(text(f"ALTER TABLE storage_location ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}"))
                except Exception:
                    pass

            # 7. putaway_task table
            for col in [
                ("destination_store_id", "UUID"),
                ("destination_zone_id", "UUID"),
                ("destination_bin_id", "UUID"),
            ]:
                try:
                    await session.execute(text(f"ALTER TABLE putaway_task ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}"))
                except Exception:
                    pass

            await session.commit()
    except Exception:
        pass
