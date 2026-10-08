"""
FastAPI entrypoint for ams-wms-business-service.
"""
# Reload triggered for seed-test-data endpoint registration - v5
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.settings import get_settings
from app.kafka.producer import start_producer, stop_producer
from app.logging.logger import configure_logging, get_logger
from app.middleware.error_handler import register_exception_handlers
from app.middleware.request_context import RequestContextMiddleware
from app.modules.dock.infrastructure.api.router import router as dock_router
from app.modules.gate.infrastructure.api.router import (
    preview_router as gate_preview_router,
    
    router as gate_router,
)
from app.modules.gate.infrastructure.api.dashboard import router as dashboard_router
from app.modules.gate.infrastructure.api.quality import router as quality_router
from app.modules.gate.infrastructure.api.damage_claims import router as damage_claims_router
from app.modules.notification.infrastructure.api.router import router as notification_router
from app.modules.receiving.infrastructure.api.router import router as receiving_router
from app.modules.returns.infrastructure.api.router import router as returns_router
from app.modules.storage.infrastructure.api.router import router as storage_router
from app.modules.assembly.infrastructure.api.router import router as assembly_router
from app.modules.dispatch.infrastructure.api.router import router as dispatch_router
from app.modules.storage.infrastructure.api.pickup_router import pickup_router
from app.modules.storage.infrastructure.api.assembly_requisition_router import router as assembly_requisition_router
from app.modules.storage.infrastructure.api.inventory_router import inventory_router, storage_req_router, v1_inventory_router
from app.modules.store.infrastructure.api.router import router as store_router, zone_router, bin_router
from app.modules.quarantine.infrastructure.api.router import router as quarantine_router
from app.workers.notification_consumer import start_notification_consumer
from app.workers.outbox_relay import relay_once

configure_logging()
logger = get_logger(__name__)

scheduler = AsyncIOScheduler()
_consumer_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    global _consumer_task

    # Ensure ORM-owned tables exist before applying the legacy compatibility
    # DDL below.  This is especially important for local databases whose data
    # tables were cleared while their Alembic revision marker was retained:
    # create_all resolves foreign-key dependencies and creates parent tables
    # (supplier, rfq, asn) before children such as purchase_order.
    try:
        from app.database.base import Base
        from app.database.session import engine

        # Import every model module so its tables are registered in metadata.
        from app.events import outbox_model  # noqa: F401
        from app.modules.gate.infrastructure.persistence import models as gate_models  # noqa: F401
        from app.modules.notification.infrastructure.persistence import models as notification_models  # noqa: F401
        from app.modules.receiving.infrastructure.persistence import models as receiving_models  # noqa: F401
        from app.modules.returns.infrastructure.persistence import models as returns_models  # noqa: F401
        from app.modules.storage.infrastructure.persistence import models as storage_models  # noqa: F401
        from app.modules.store.infrastructure.persistence import models as store_models  # noqa: F401
        from app.modules.assembly.infrastructure.persistence import models as assembly_models  # noqa: F401
        from app.modules.dispatch.infrastructure.persistence import models as dispatch_models  # noqa: F401

        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        logger.info("Ensured ORM database schema exists")
    except Exception as exc:
        logger.exception("Failed to initialize ORM database schema: %s", exc)
        raise

    # --- Development schema compatibility guard ---
    #
    # Older local databases can predate some of the fields now mapped by the
    # procurement ORM.  Use PostgreSQL's idempotent form rather than catching
    # duplicate-column errors: after a PostgreSQL statement fails, the whole
    # transaction is aborted and every later migration statement would fail.
    try:
        from sqlalchemy import text
        from app.database.session import session_scope

        # Helper to run DDL in its own transaction
        async def run_ddl(ddl_query: str):
            async with session_scope() as session:
                await session.execute(text(ddl_query))
                await session.commit()

        # Warehouse location master additions. These are deliberately additive
        # so existing Store → Zone → Bin records remain valid during rollout.
        for column, column_type in [
            ("position", "VARCHAR(64)"),
            ("storage_type", "VARCHAR(64) NOT NULL DEFAULT 'GENERAL'"),
            ("maximum_weight", "NUMERIC(18, 4)"),
            ("maximum_volume", "NUMERIC(18, 4)"),
            ("allowed_material_category", "VARCHAR(128)"),
            ("hazardous_material_permitted", "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("temperature_requirement", "VARCHAR(128)"),
            ("qr_identifier", "VARCHAR(128)"),
        ]:
            await run_ddl(f"ALTER TABLE store_bin ADD COLUMN IF NOT EXISTS {column} {column_type}")
        await run_ddl("CREATE UNIQUE INDEX IF NOT EXISTS ix_store_bin_qr_identifier ON store_bin (qr_identifier)")
        await run_ddl("ALTER TABLE assembly_stock_reservation ADD COLUMN IF NOT EXISTS allocations JSON NOT NULL DEFAULT '[]'")

        # Upgrade legacy Material Data columns to the canonical Warehouse
        # Material Master shape. create_all() intentionally does not alter an
        # existing table, so older developer databases need this data-safe,
        # idempotent compatibility step before the material API can query it.
        for column, column_type in [
            ("material_code", "VARCHAR(64)"),
            ("material_name", "VARCHAR(256)"),
            ("base_uom", "VARCHAR(32) DEFAULT 'PCS'"),
            ("status", "VARCHAR(32) DEFAULT 'Active'"),
            ("created_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
            ("created_by", "VARCHAR(64)"),
            ("updated_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
            ("updated_by", "VARCHAR(64)"),
        ]:
            await run_ddl(
                f"ALTER TABLE material ADD COLUMN IF NOT EXISTS {column} {column_type}"
            )

        await run_ddl("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'material' AND column_name = 'code'
                ) THEN
                    UPDATE material
                    SET material_code = code
                    WHERE material_code IS NULL;
                END IF;

                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'material' AND column_name = 'name'
                ) THEN
                    UPDATE material
                    SET material_name = name
                    WHERE material_name IS NULL;
                END IF;

                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'material' AND column_name = 'uom'
                ) THEN
                    UPDATE material
                    SET base_uom = COALESCE(NULLIF(base_uom, ''), uom, 'PCS');
                END IF;
            END $$;
        """)
        await run_ddl(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_material_material_code "
            "ON material (material_code) WHERE material_code IS NOT NULL"
        )
        logger.info("Ensured canonical Material Master columns and legacy data mapping")

        # Allow nullable PO columns in inventory_receipt_posting for Unexpected Delivery
        try:
            await run_ddl("ALTER TABLE inventory_receipt_posting ALTER COLUMN po_id DROP NOT NULL")
            await run_ddl("ALTER TABLE inventory_receipt_posting ALTER COLUMN po_number DROP NOT NULL")
            await run_ddl("ALTER TABLE inventory_receipt_posting ALTER COLUMN asn_id DROP NOT NULL")
            await run_ddl("ALTER TABLE inventory_receipt_posting ALTER COLUMN asn_number DROP NOT NULL")
        except Exception:
            pass

        # Ensure finished_goods_request has requested_date
        try:
            await run_ddl("ALTER TABLE finished_goods_request ADD COLUMN IF NOT EXISTS requested_date DATE DEFAULT CURRENT_DATE")
        except Exception:
            pass

        # Ensure gate_entry has exited_at and exited_by
        for col in [
            ("exited_at", "TIMESTAMP WITH TIME ZONE"),
            ("exited_by", "VARCHAR(64)"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE gate_entry ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception:
                pass

        # Add columns to asn
        for col in [
            ("shipment_date", "DATE DEFAULT CURRENT_DATE"),
            ("driver_name", "VARCHAR(128)"),
            ("driver_contact", "VARCHAR(32)"),
            ("warehouse_id", "VARCHAR(64)"),
            ("transporter", "VARCHAR(128)"),
            ("number_of_packages", "INTEGER"),
            ("package_type", "VARCHAR(64)"),
            ("shipping_method", "VARCHAR(64)"),
            ("asn_number", "VARCHAR(64)"),
            ("supplier_id", "UUID"),
            ("po_id", "VARCHAR(64)"),
            ("invoice_number", "VARCHAR(128)"),
            ("invoice_date", "DATE"),
            ("challan_number", "VARCHAR(128)"),
            ("challan_date", "DATE"),
            ("shipment_type", "VARCHAR(32) DEFAULT 'STANDARD'"),
            ("replacement_request_id", "UUID"),
            ("original_asn_id", "UUID"),
            ("logistics", "JSONB"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE asn ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
                logger.debug(f"Ensured column {col[0]} exists on asn")
            except Exception: pass

        for col in [
            ("priority", "VARCHAR(32) DEFAULT 'MEDIUM'"),
            ("suggested_supplier", "VARCHAR(255)"),
            ("attachments", "JSONB DEFAULT '[]'::jsonb"),
            ("approval_history", "JSONB DEFAULT '[]'::jsonb"),
            ("updated_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE material_request ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception: pass

        for col in [
            ("is_custom", "BOOLEAN DEFAULT FALSE"),
            ("custom_material_name", "VARCHAR(256)"),
            ("reserved_quantity", "NUMERIC(18, 4) DEFAULT 0.0"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE assembly_requisition_item ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
                if col[0] != "reserved_quantity":
                    await run_ddl(f"ALTER TABLE material_request_item ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception: pass

        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS assembly_stock_reservation (
                    id UUID PRIMARY KEY,
                    requisition_id UUID NOT NULL,
                    requisition_item_id UUID NOT NULL,
                    requisition_number VARCHAR(64) NOT NULL,
                    material_code VARCHAR(64) NOT NULL,
                    material_name VARCHAR(256) NOT NULL,
                    required_quantity NUMERIC(18, 4) NOT NULL,
                    reserved_quantity NUMERIC(18, 4) NOT NULL,
                    uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
                    status VARCHAR(32) NOT NULL DEFAULT 'RESERVED FOR ASSEMBLY',
                    store_id UUID,
                    store_code VARCHAR(64),
                    store_name VARCHAR(128),
                    zone_code VARCHAR(64),
                    bin_code VARCHAR(64),
                    location_code VARCHAR(64),
                    storage_location_id UUID,
                    reserved_by VARCHAR(64) NOT NULL,
                    reserved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS ix_assembly_stock_reservation_req_id ON assembly_stock_reservation (requisition_id);
                CREATE INDEX IF NOT EXISTS ix_assembly_stock_reservation_mat_code ON assembly_stock_reservation (material_code);
                CREATE INDEX IF NOT EXISTS ix_assembly_stock_reservation_store_id ON assembly_stock_reservation (store_id);
            """)
        except Exception: pass

        # Ensure supplier_contact has primary_email and secondary_email
        try:
            await run_ddl("ALTER TABLE supplier_contact RENAME COLUMN email TO primary_email")
            logger.debug("Renamed 'email' to 'primary_email' on supplier_contact")
        except Exception: pass

        try:
            await run_ddl("ALTER TABLE supplier_contact ADD COLUMN IF NOT EXISTS primary_email VARCHAR(128)")
        except Exception: pass

        try:
            await run_ddl("ALTER TABLE supplier_contact ADD COLUMN IF NOT EXISTS secondary_email VARCHAR(128)")
            logger.debug("Ensured primary/secondary email columns exist on supplier_contact")
        except Exception: pass

        # Ensure supplier has missing columns
        for col in [
            ("created_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
            ("updated_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
            ("supplier_code", "VARCHAR(64)"),
            ("rating", "NUMERIC(3,2) DEFAULT 0"),
            ("performance_score", "NUMERIC(5,2) DEFAULT 0"),
            ("payment_terms", "VARCHAR(128)"),
            ("credit_period_days", "INTEGER"),
            ("remarks", "VARCHAR(1000)"),
            ("status", "VARCHAR(32) DEFAULT 'Active'"),
            ("main_materials", "JSON"),
            ("industry", "VARCHAR(64)"),
            ("gstin", "VARCHAR(32)"),
            ("registered_company_name", "VARCHAR(256)"),
            ("vendor_type", "VARCHAR(64)"),
            ("category", "JSON"),
            ("created_by", "VARCHAR(64)"),
            ("updated_by", "VARCHAR(64)"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE supplier ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception: pass

        # Ensure category is JSONB (it was incorrectly VARCHAR(64) in early versions)
        try:
            # More robust migration: handle existing VARCHAR data
            await run_ddl("""
                ALTER TABLE supplier
                ALTER COLUMN category TYPE JSONB
                USING (
                    CASE
                        WHEN category IS NULL THEN '[]'::JSONB
                        WHEN category = '' THEN '[]'::JSONB
                        WHEN category LIKE '[%' THEN category::JSONB
                        ELSE jsonb_build_array(category)
                    END
                )
            """)

            # Also ensure main_materials is JSONB
            await run_ddl("""
                ALTER TABLE supplier
                ALTER COLUMN main_materials TYPE JSONB
                USING (
                    CASE
                        WHEN main_materials IS NULL THEN '[]'::JSONB
                        WHEN main_materials = '' THEN '[]'::JSONB
                        WHEN main_materials LIKE '[%' THEN main_materials::JSONB
                        ELSE jsonb_build_array(main_materials)
                    END
                )
            """)
            logger.debug("Migrated 'category' and 'main_materials' to JSONB on supplier table")
        except Exception as e:
            logger.debug(f"JSONB migration skipped or already done: {e}")

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
                await run_ddl(f"ALTER TABLE notification ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception: pass

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
                await run_ddl(f"ALTER TABLE dock_assignment ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception: pass

        try:
            await run_ddl("ALTER TABLE dock_masters ADD COLUMN IF NOT EXISTS store_id UUID")
        except Exception: pass

        for col in [
            ("assigned_store_id", "UUID"),
            ("assigned_store_code", "VARCHAR(64)"),
            ("assigned_store_name", "VARCHAR(128)"),
            ("assigned_store_manager_id", "VARCHAR(128)"),
            ("assigned_store_manager_username", "VARCHAR(128)"),
            ("assigned_store_manager_name", "VARCHAR(128)"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE dock_allocation_requests ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception: pass

        for col in [
            ("role", "VARCHAR(64) NOT NULL DEFAULT 'Store Manager'"),
            ("applications", "JSONB NOT NULL DEFAULT '[\"WMS\"]'::jsonb"),
            ("auth_token_hash", "VARCHAR(128)"),
            ("last_login", "TIMESTAMP WITH TIME ZONE"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE store_manager_user ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception as exc:
                logger.warning("Unable to ensure store_manager_user.%s: %s", col[0], exc)

        try:
            await run_ddl("ALTER TABLE store ADD COLUMN IF NOT EXISTS store_type VARCHAR(64)")
        except Exception: pass

        for col in [
            ("material_name", "VARCHAR(256)"),
            ("source_location", "VARCHAR(64) DEFAULT 'RECEIVING_AREA'"),
            ("warehouse_id", "VARCHAR(64) DEFAULT 'Main Warehouse'"),
            ("destination_store_id", "UUID"),
            ("destination_zone_id", "UUID"),
            ("destination_bin_id", "UUID"),
            ("finished_goods_id", "UUID"),
            ("batch_number", "VARCHAR(128)"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE putaway_task ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception: pass

        # Receiving/damage-claim compatibility for local databases created
        # before the damaged-goods workflow was introduced. SQLAlchemy's
        # create_all creates missing tables but intentionally does not add
        # columns to existing tables.
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
        ]:
            try:
                await run_ddl(f"ALTER TABLE receiving_line ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception as exc:
                logger.warning("Unable to ensure receiving_line.%s: %s", col[0], exc)

        for col in [
            ("report_number", "VARCHAR(32)"),
            ("received_quantity", "NUMERIC(18,4)"),
            ("status", "VARCHAR(32) NOT NULL DEFAULT 'PENDING_PROCUREMENT'"),
            ("submitted_by", "VARCHAR(128)"),
            ("submitted_at", "TIMESTAMP WITH TIME ZONE"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE damage_report ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception as exc:
                logger.warning("Unable to ensure damage_report.%s: %s", col[0], exc)

        for col in [
            ("supplier_response", "VARCHAR(32)"),
            ("resolution", "VARCHAR(32)"),
            ("supplier_remarks", "TEXT"),
            ("return_required", "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("responded_at", "TIMESTAMP WITH TIME ZONE"),
            ("closed_by", "VARCHAR(128)"),
            ("closed_at", "TIMESTAMP WITH TIME ZONE"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE supplier_damage_claim ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception as exc:
                logger.warning("Unable to ensure supplier_damage_claim.%s: %s", col[0], exc)

        # Ensure rfq has missing columns
        for col in [
            ("rfq_number", "VARCHAR(64)"),
            ("rfq_date", "DATE DEFAULT CURRENT_DATE"),
            ("material_request_number", "VARCHAR(64)"),
            ("required_delivery_date", "DATE"),
            ("warehouse", "VARCHAR(128)"),
            ("procurement_officer", "VARCHAR(128)"),
            ("remarks", "TEXT"),
            ("closing_date", "TIMESTAMP WITH TIME ZONE"),
            ("selected_supplier_id", "UUID"),
            ("selection_date", "DATE"),
            ("selected_by", "VARCHAR(128)"),
            ("selection_reason", "VARCHAR(500)"),
            ("selection_comments", "VARCHAR(500)"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE rfq ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception: pass
        try:
            await run_ddl("UPDATE rfq SET rfq_date = CURRENT_DATE WHERE rfq_date IS NULL")
        except Exception: pass
        logger.debug("Ensured columns exist on rfq")

        # Ensure quotation has missing columns
        for col in [
            ("discount", "NUMERIC(18,4) DEFAULT 0"),
            ("tax", "NUMERIC(18,4) DEFAULT 0"),
            ("freight_charges", "NUMERIC(18,4) DEFAULT 0"),
            ("delivery_time", "VARCHAR(128)"),
            ("expected_delivery_date", "DATE"),
            ("payment_terms", "VARCHAR(128)"),
            ("quotation_validity", "DATE"),
            ("remarks", "VARCHAR(500)"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE quotation ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception: pass
        logger.debug("Ensured columns exist on quotation")

        # Create purchase_order table if not exists
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS purchase_order (
                    id UUID PRIMARY KEY,
                    po_number VARCHAR(64) UNIQUE NOT NULL,
                    po_date DATE NOT NULL DEFAULT CURRENT_DATE,
                    status VARCHAR(32) NOT NULL,
                    rfq_id UUID REFERENCES rfq(id),
                    quotation_id UUID REFERENCES quotation(id),
                    supplier_id UUID REFERENCES supplier(id),
                    supplier_name VARCHAR(255),
                    warehouse_id VARCHAR(64),
                    total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    expected_delivery_date DATE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            logger.debug("Ensured purchase_order table exists")
        except Exception as e:
            logger.warning(f"Failed to create purchase_order table: {e}")

        # Create purchase_order_item table if not exists
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS purchase_order_item (
                    id UUID PRIMARY KEY,
                    purchase_order_id UUID REFERENCES purchase_order(id) ON DELETE CASCADE,
                    material_code VARCHAR(64) NOT NULL,
                    material_name VARCHAR(255),
                    quantity NUMERIC(18, 4) NOT NULL,
                    unit_price NUMERIC(18, 4) NOT NULL,
                    uom VARCHAR(32) NOT NULL DEFAULT 'PCS'
                )
            """)
            logger.debug("Ensured purchase_order_item table exists")
        except Exception as e:
            logger.warning(f"Failed to create purchase_order_item table: {e}")

        # Ensure purchase_order_item has missing columns
        for col in [
            ("category", "VARCHAR(128)"),
            ("discount", "NUMERIC(18, 4) DEFAULT 0"),
            ("tax", "NUMERIC(18, 4) DEFAULT 0"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE purchase_order_item ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception: pass

        # Ensure purchase_order has missing columns
        for col in [
            ("subtotal", "NUMERIC(18, 4) DEFAULT 0"),
            ("quotation_id", "UUID REFERENCES quotation(id)"),
            ("discount_amount", "NUMERIC(18, 4) DEFAULT 0"),
            ("tax_amount", "NUMERIC(18, 4) DEFAULT 0"),
            ("freight_charges", "NUMERIC(18, 4) DEFAULT 0"),
            ("selection_reason", "VARCHAR(500)"),
            ("procurement_comments", "TEXT"),
            ("selection_date", "TIMESTAMP WITH TIME ZONE"),
            ("selected_by", "VARCHAR(128)"),
            ("procurement_officer", "VARCHAR(128)"),
            ("payment_terms", "VARCHAR(128)"),
            ("delivery_terms", "VARCHAR(255)"),
            ("warranty", "VARCHAR(128)"),
            ("billing_address", "TEXT"),
            ("notes", "TEXT"),
            ("attachments", "JSONB DEFAULT '[]'::jsonb"),
            ("revision_number", "INTEGER DEFAULT 1"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception: pass

        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS po_revision (
                    id UUID PRIMARY KEY,
                    purchase_order_id UUID REFERENCES purchase_order(id) ON DELETE CASCADE,
                    revision_number INTEGER NOT NULL,
                    changed_field VARCHAR(128) NOT NULL,
                    old_value TEXT,
                    new_value TEXT,
                    changed_by VARCHAR(128) NOT NULL,
                    reason TEXT NOT NULL,
                    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
        except Exception: pass

        # Additional PO Columns for full data snapshot
        for col in [
            ("department", "VARCHAR(128)"),
            ("supplier_code", "VARCHAR(64)"),
            ("supplier_contact_person", "VARCHAR(128)"),
            ("supplier_phone", "VARCHAR(32)"),
            ("supplier_email", "VARCHAR(128)"),
            ("supplier_gstin", "VARCHAR(32)"),
            ("supplier_address", "TEXT"),
            ("delivery_warehouse_name", "VARCHAR(128)"),
            ("delivery_address", "TEXT"),
            ("additional_charges", "NUMERIC(18, 4) DEFAULT 0"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS {col[0]} {col[1]}")
            except Exception: pass

        try:
            await run_ddl("ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS rejection_reason TEXT")
            await run_ddl("ALTER TABLE quotation ADD COLUMN IF NOT EXISTS additional_charges NUMERIC(18, 4) DEFAULT 0")
            await run_ddl("ALTER TABLE quotation ADD COLUMN IF NOT EXISTS warranty VARCHAR(128)")
            await run_ddl("ALTER TABLE quotation ADD COLUMN IF NOT EXISTS mode_of_payment VARCHAR(128)")
        except Exception: pass

        # Create po_approval_history table
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS po_approval_history (
                    id UUID PRIMARY KEY,
                    purchase_order_id UUID REFERENCES purchase_order(id) ON DELETE CASCADE,
                    status VARCHAR(32) NOT NULL,
                    actor_name VARCHAR(128) NOT NULL,
                    comments TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            logger.debug("Ensured po_approval_history table exists")
        except Exception as e:
            logger.warning(f"Failed to create po_approval_history table: {e}")

        # Create notification table
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS notification (
                    id UUID PRIMARY KEY,
                    user_role VARCHAR(32) NOT NULL,
                    title VARCHAR(256) NOT NULL,
                    message TEXT NOT NULL,
                    link VARCHAR(512),
                    is_read BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            for col, col_type in [
                ("dock_code", "VARCHAR(32)"),
                ("dock_name", "VARCHAR(128)"),
                ("dock_location", "VARCHAR(128)"),
                ("dock_type", "VARCHAR(64)"),
                ("warehouse_name", "VARCHAR(128)"),
                ("allocation_time", "TIMESTAMP"),
                ("gate_pass_number", "VARCHAR(64)"),
                ("vehicle_number", "VARCHAR(64)"),
                ("driver_name", "VARCHAR(128)"),
                ("driver_phone", "VARCHAR(32)"),
                ("asn_number", "VARCHAR(64)"),
                ("po_number", "VARCHAR(64)"),
                ("grn_number", "VARCHAR(64)"),
                ("supplier_name", "VARCHAR(255)"),
                ("notification_type", "VARCHAR(64)"),
                ("idempotency_key", "VARCHAR(255)"),
                ("payload_json", "TEXT"),
            ]:
                try:
                    await run_ddl(f"ALTER TABLE notification ADD COLUMN IF NOT EXISTS {col} {col_type}")
                except Exception: pass
            logger.debug("Ensured notification table and columns exist")
        except Exception as e:
            logger.warning(f"Failed to create notification table: {e}")

        # Create material_request table if not exists
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS material_request (
                    id UUID PRIMARY KEY,
                    request_number VARCHAR(64) UNIQUE NOT NULL,
                    warehouse_id VARCHAR(64) NOT NULL,
                    department VARCHAR(64) NOT NULL,
                    requested_by VARCHAR(128) NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
                    required_date DATE NOT NULL,
                    remarks TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            logger.debug("Ensured material_request table exists")
            await run_ddl("ALTER TABLE material_request ADD COLUMN IF NOT EXISTS approved_by VARCHAR(128)")
            await run_ddl("ALTER TABLE material_request ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE")
        except Exception as e:
            logger.warning(f"Failed to create material_request table: {e}")

        # Create material_request_item table if not exists
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS material_request_item (
                    id UUID PRIMARY KEY,
                    request_id UUID REFERENCES material_request(id) ON DELETE CASCADE,
                    material_id UUID REFERENCES material(id) ON DELETE SET NULL,
                    material_variant_id UUID REFERENCES material_variant(id) ON DELETE SET NULL,
                    material_code VARCHAR(64) NOT NULL,
                    variant_code VARCHAR(128),
                    material_name VARCHAR(255),
                    quantity NUMERIC(18, 4) NOT NULL,
                    uom VARCHAR(32) NOT NULL DEFAULT 'PCS'
                )
            """)
            logger.debug("Ensured material_request_item table exists")
        except Exception as e:
            logger.warning(f"Failed to create material_request_item table: {e}")

        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS stock_reservation (
                    id UUID PRIMARY KEY, request_id UUID NOT NULL REFERENCES material_request(id),
                    request_item_id UUID NOT NULL UNIQUE REFERENCES material_request_item(id),
                    material_code VARCHAR(64) NOT NULL, warehouse_id VARCHAR(64) NOT NULL,
                    quantity NUMERIC(18,4) NOT NULL, uom VARCHAR(32) NOT NULL,
                    status VARCHAR(32) NOT NULL, allocations JSON NOT NULL DEFAULT '[]', reserved_by VARCHAR(128) NOT NULL,
                    reserved_at TIMESTAMP WITH TIME ZONE NOT NULL
                )
            """)
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS pick_task (
                    id UUID PRIMARY KEY, task_number VARCHAR(64) NOT NULL UNIQUE,
                    request_id UUID NOT NULL UNIQUE REFERENCES material_request(id),
                    request_number VARCHAR(64) NOT NULL, warehouse_id VARCHAR(64) NOT NULL,
                    department VARCHAR(64) NOT NULL, items JSON NOT NULL,
                    status VARCHAR(32) NOT NULL, created_by VARCHAR(128) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL
                )
            """)
            await run_ddl("ALTER TABLE stock_reservation ADD COLUMN IF NOT EXISTS allocations JSON NOT NULL DEFAULT '[]'")
            await run_ddl("ALTER TABLE pick_task ADD COLUMN IF NOT EXISTS destination VARCHAR(128) NOT NULL DEFAULT 'Production Staging Area'")
            await run_ddl("ALTER TABLE pick_task ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(128)")
            await run_ddl("ALTER TABLE pick_task ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE")
            await run_ddl("ALTER TABLE pick_task ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE")
            await run_ddl("ALTER TABLE pick_task ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE")
            await run_ddl("ALTER TABLE pick_task ADD COLUMN IF NOT EXISTS completed_by VARCHAR(128)")
            await run_ddl("""CREATE TABLE IF NOT EXISTS material_issue (
                id UUID PRIMARY KEY, issue_number VARCHAR(64) NOT NULL UNIQUE,
                pick_task_id UUID NOT NULL UNIQUE REFERENCES pick_task(id),
                request_id UUID NOT NULL REFERENCES material_request(id), department VARCHAR(64) NOT NULL,
                items JSON NOT NULL, issued_by VARCHAR(128) NOT NULL, received_by VARCHAR(128) NOT NULL,
                issued_at TIMESTAMP WITH TIME ZONE NOT NULL)""")
            logger.debug("Ensured outbound reservation and pick task tables exist")
        except Exception as e:
            logger.warning(f"Failed to create outbound workflow tables: {e}")

        try:
            for tbl in ["material_request_item", "purchase_order_item", "material_stock", "asn_line"]:
                await run_ddl(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES material(id) ON DELETE SET NULL")
                await run_ddl(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS material_variant_id UUID REFERENCES material_variant(id) ON DELETE SET NULL")
                await run_ddl(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS variant_code VARCHAR(128)")
            logger.debug("Ensured material linkage columns exist across item tables")
        except Exception as e:
            logger.warning(f"Failed to alter material linkage columns: {e}")

        # Create material_stock table
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS material_stock (
                    id UUID PRIMARY KEY,
                    material_code VARCHAR(64) UNIQUE NOT NULL,
                    material_name VARCHAR(255) NOT NULL,
                    category VARCHAR(128) NOT NULL,
                    on_hand NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    allocated NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    available NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
                    warehouse_id VARCHAR(64) NOT NULL,
                    reorder_point NUMERIC(18, 4) NOT NULL DEFAULT 10,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            logger.debug("Ensured material_stock table exists")
        except Exception as e:
            logger.warning(f"Failed to create material_stock table: {e}")

        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS grn_damage_lot (
                    id UUID PRIMARY KEY,
                    grn_line_id UUID NOT NULL REFERENCES grn_line(id) ON DELETE CASCADE,
                    damage_lot_number VARCHAR(64) NOT NULL UNIQUE,
                    damaged_quantity NUMERIC(18, 4) NOT NULL,
                    uom VARCHAR(32),
                    reason TEXT,
                    qa_status VARCHAR(32) DEFAULT 'REJECTED',
                    quarantine_location VARCHAR(64) DEFAULT 'QUARANTINE-ZONE-A',
                    status VARCHAR(32) NOT NULL DEFAULT 'DAMAGED',
                    created_by VARCHAR(128) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS grn_damage_qr (
                    id UUID PRIMARY KEY,
                    damage_lot_id UUID NOT NULL UNIQUE REFERENCES grn_damage_lot(id) ON DELETE CASCADE,
                    grn_line_id UUID NOT NULL REFERENCES grn_line(id) ON DELETE CASCADE,
                    grn_number VARCHAR(64) NOT NULL,
                    item_code VARCHAR(64) NOT NULL,
                    qr_code VARCHAR(128) NOT NULL UNIQUE,
                    qr_payload TEXT NOT NULL,
                    generated_by VARCHAR(128),
                    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            logger.debug("Ensured grn_damage_lot and grn_damage_qr tables exist")
        except Exception as e:
            logger.warning(f"Failed to create grn_damage_lot/grn_damage_qr tables: {e}")

        # Create finished_goods_request table
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS finished_goods_request (
                    id UUID PRIMARY KEY,
                    request_number VARCHAR(64) UNIQUE NOT NULL,
                    warehouse_id VARCHAR(64) NOT NULL DEFAULT 'MAIN',
                    finished_goods_code VARCHAR(64),
                    finished_goods_name VARCHAR(255) NOT NULL,
                    quantity NUMERIC(18, 4) NOT NULL,
                    uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
                    required_date DATE NOT NULL,
                    requested_by VARCHAR(128) NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'SENT_TO_ASSEMBLY',
                    bom_attachment_url VARCHAR(512),
                    bom_attachment_name VARCHAR(256),
                    remarks TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            for col, col_type in [
                ("bom_attachment_url", "VARCHAR(512)"),
                ("bom_attachment_name", "VARCHAR(256)"),
                ("finished_goods_code", "VARCHAR(64)"),
                ("warehouse_id", "VARCHAR(64) DEFAULT 'MAIN'"),
                ("uom", "VARCHAR(32) DEFAULT 'PCS'"),
                ("remarks", "TEXT"),
            ]:
                try:
                    await run_ddl(f"ALTER TABLE finished_goods_request ADD COLUMN IF NOT EXISTS {col} {col_type}")
                except Exception: pass
            logger.debug("Ensured finished_goods_request table and columns exist")
        except Exception as e:
            logger.warning(f"Failed to create finished_goods_request table: {e}")

        # Create bill_of_materials and bill_of_materials_item tables
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS bill_of_materials (
                    id UUID PRIMARY KEY,
                    bom_number VARCHAR(64) UNIQUE NOT NULL,
                    product_code VARCHAR(64),
                    product_name VARCHAR(255) NOT NULL,
                    description TEXT,
                    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
                    created_by VARCHAR(128) NOT NULL DEFAULT 'Assembly',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS bill_of_materials_item (
                    id UUID PRIMARY KEY,
                    bom_id UUID NOT NULL REFERENCES bill_of_materials(id) ON DELETE CASCADE,
                    material_id UUID,
                    material_code VARCHAR(64) NOT NULL,
                    material_name VARCHAR(255) NOT NULL,
                    variant_code VARCHAR(128),
                    quantity_per_unit NUMERIC(18, 4) NOT NULL,
                    uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
                    notes TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await run_ddl("CREATE INDEX IF NOT EXISTS ix_bom_product_code ON bill_of_materials(product_code)")
            await run_ddl("CREATE INDEX IF NOT EXISTS ix_bom_product_name ON bill_of_materials(product_name)")
            await run_ddl("CREATE INDEX IF NOT EXISTS ix_bom_item_bom_id ON bill_of_materials_item(bom_id)")
            logger.debug("Ensured bill_of_materials and bill_of_materials_item tables exist")
        except Exception as e:
            logger.warning(f"Failed to create BOM tables: {e}")

        # Create arrival_notification table
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS arrival_notification (
                    id VARCHAR(128) PRIMARY KEY,
                    asn_id UUID NOT NULL REFERENCES asn(id) ON DELETE CASCADE,
                    asn_number VARCHAR(64) NOT NULL,
                    po_id VARCHAR(64),
                    po_number VARCHAR(64) NOT NULL,
                    warehouse_id VARCHAR(64) NOT NULL,
                    supplier_name VARCHAR(128) NOT NULL,
                    vehicle_number VARCHAR(64) NOT NULL,
                    expected_arrival_time TIMESTAMP WITH TIME ZONE NOT NULL,
                    driver_phone VARCHAR(32),
                    message TEXT,
                    recipients VARCHAR(256),
                    status VARCHAR(32) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            logger.debug("Ensured arrival_notification table exists")
        except Exception as e:
            logger.warning(f"Failed to create arrival_notification table: {e}")

        # Ensure supplier_document has file_type, file_size and upload_id
        try:
            await run_ddl("ALTER TABLE supplier_document ADD COLUMN IF NOT EXISTS file_type VARCHAR(64)")
            await run_ddl("ALTER TABLE supplier_document ADD COLUMN IF NOT EXISTS file_size BIGINT")
            await run_ddl("ALTER TABLE supplier_document ADD COLUMN IF NOT EXISTS upload_id VARCHAR(128)")

            # Ensure they are nullable to prevent IntegrityErrors on incomplete data
            await run_ddl("ALTER TABLE supplier_document ALTER COLUMN file_type DROP NOT NULL")
            await run_ddl("ALTER TABLE supplier_document ALTER COLUMN file_size DROP NOT NULL")
            logger.debug("Ensured extended columns exist and are nullable on supplier_document")
        except Exception: pass

        # Create or ensure complete columns on gate_entry
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS gate_entry (
                    id UUID PRIMARY KEY,
                    gate_entry_number VARCHAR(64) UNIQUE,
                    po_id UUID,
                    asn_id UUID,
                    assigned_dock_id VARCHAR(32),
                    po_number VARCHAR(64) NOT NULL,
                    vehicle_number VARCHAR(32) NOT NULL,
                    driver_name VARCHAR(128) NOT NULL DEFAULT 'Driver',
                    driver_license_number VARCHAR(64),
                    driver_phone VARCHAR(32),
                    driver_photo_path VARCHAR(256),
                    po_document_path VARCHAR(256) NOT NULL DEFAULT '',
                    vehicle_photo_path VARCHAR(256),
                    po_document_data BYTEA,
                    vehicle_photo_data BYTEA,
                    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_VERIFICATION',
                    verification_type VARCHAR(32),
                    mismatched_fields JSONB,
                    reasons JSONB,
                    anpr_detected_vehicle VARCHAR(32),
                    anpr_confidence NUMERIC(5, 4),
                    anpr_metadata JSONB,
                    ocr_po_number VARCHAR(64),
                    ocr_supplier_name VARCHAR(128),
                    ocr_product_material VARCHAR(128),
                    ocr_quantity NUMERIC(18, 4),
                    ocr_po_date VARCHAR(32),
                    ocr_expected_delivery_date VARCHAR(32),
                    ocr_confidence NUMERIC(5, 4),
                    ocr_raw_text TEXT,
                    ocr_line_items JSONB,
                    security_officer_id VARCHAR(64) NOT NULL DEFAULT 'SECURITY',
                    verified_by_user_id VARCHAR(64),
                    manual_verification_notes TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
        except Exception: pass

        for col, col_type in [
            ("gate_entry_number", "VARCHAR(64)"),
            ("po_id", "UUID"),
            ("asn_id", "UUID"),
            ("assigned_dock_id", "VARCHAR(32)"),
            ("driver_license_number", "VARCHAR(64)"),
            ("driver_phone", "VARCHAR(32)"),
            ("driver_photo_path", "VARCHAR(256)"),
            ("po_document_path", "VARCHAR(256) DEFAULT ''"),
            ("vehicle_photo_path", "VARCHAR(256)"),
            ("po_document_data", "BYTEA"),
            ("vehicle_photo_data", "BYTEA"),
            ("verification_type", "VARCHAR(32)"),
            ("mismatched_fields", "JSONB"),
            ("reasons", "JSONB"),
            ("anpr_detected_vehicle", "VARCHAR(32)"),
            ("anpr_confidence", "NUMERIC(5, 4)"),
            ("anpr_metadata", "JSONB"),
            ("ocr_po_number", "VARCHAR(64)"),
            ("ocr_supplier_name", "VARCHAR(128)"),
            ("ocr_product_material", "VARCHAR(128)"),
            ("ocr_quantity", "NUMERIC(18, 4)"),
            ("ocr_po_date", "VARCHAR(32)"),
            ("ocr_expected_delivery_date", "VARCHAR(32)"),
            ("ocr_confidence", "NUMERIC(5, 4)"),
            ("ocr_raw_text", "TEXT"),
            ("ocr_line_items", "JSONB"),
            ("security_officer_id", "VARCHAR(64) DEFAULT 'SECURITY'"),
            ("verified_by_user_id", "VARCHAR(64)"),
            ("manual_verification_notes", "TEXT"),
            ("created_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
            ("updated_at", "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE gate_entry ADD COLUMN IF NOT EXISTS {col} {col_type}")
            except Exception: pass

        # Create warehouse workflow tables if not exist
        for col, col_type in [
            ("quality_issue_image_data", "BYTEA"),
            ("quality_issue_filename", "VARCHAR(256)"),
            ("quality_issue_content_type", "VARCHAR(128)"),
            ("quality_issue_status", "VARCHAR(32)"),
            ("quality_issue_sent_at", "TIMESTAMP WITH TIME ZONE"),
            ("quality_issue_forwarded_at", "TIMESTAMP WITH TIME ZONE"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE dock_assignment ADD COLUMN IF NOT EXISTS {col} {col_type}")
            except Exception: pass

        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS warehouse_dock (
                    id UUID PRIMARY KEY,
                    dock_number VARCHAR(32) UNIQUE NOT NULL,
                    warehouse_id VARCHAR(64) NOT NULL,
                    dock_type VARCHAR(64) NOT NULL,
                    capacity INTEGER NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
        except Exception: pass

        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS inventory_receipt_posting (
                    id UUID PRIMARY KEY,
                    grn_id UUID NOT NULL,
                    grn_number VARCHAR(64),
                    po_id UUID,
                    po_number VARCHAR(64),
                    asn_id UUID,
                    asn_number VARCHAR(64),
                    supplier_name VARCHAR(256),
                    item_code VARCHAR(64) NOT NULL,
                    material_name VARCHAR(256),
                    uom VARCHAR(32),
                    warehouse_id VARCHAR(64),
                    posted_quantity NUMERIC(18, 4) NOT NULL,
                    on_hand_before NUMERIC(18, 4) NOT NULL,
                    on_hand_after NUMERIC(18, 4) NOT NULL,
                    posted_by VARCHAR(128) NOT NULL,
                    posted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
        except Exception: pass

        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS storage_location (
                    id UUID PRIMARY KEY,
                    warehouse_id VARCHAR(64) NOT NULL,
                    zone VARCHAR(32) NOT NULL,
                    rack VARCHAR(32) NOT NULL,
                    bin VARCHAR(32) NOT NULL,
                    capacity NUMERIC(18, 4) NOT NULL DEFAULT 1000,
                    occupied_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
        except Exception: pass

        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS putaway_task (
                    id UUID PRIMARY KEY,
                    task_number VARCHAR(64) UNIQUE NOT NULL,
                    grn_id UUID,
                    grn_number VARCHAR(64),
                    handling_unit_id UUID,
                    item_code VARCHAR(64) NOT NULL,
                    batch_number VARCHAR(128),
                    material_name VARCHAR(256),
                    quantity NUMERIC(18, 4) NOT NULL,
                    uom VARCHAR(32),
                    warehouse_id VARCHAR(64),
                    source_location VARCHAR(64),
                    destination_store_id UUID,
                    destination_zone_id UUID,
                    destination_bin_id UUID,
                    destination_location_id UUID,
                    destination_zone VARCHAR(32),
                    destination_rack VARCHAR(32),
                    destination_bin VARCHAR(32),
                    destination_bin_code VARCHAR(64),
                    location_assigned_by VARCHAR(128),
                    location_assigned_at TIMESTAMP WITH TIME ZONE,
                    assigned_to VARCHAR(128),
                    assigned_by VARCHAR(128),
                    assigned_at TIMESTAMP WITH TIME ZONE,
                    material_category VARCHAR(128),
                    handling_requirement VARCHAR(128),
                    rotation_policy VARCHAR(16),
                    placement_metadata JSON,
                    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
                    started_by VARCHAR(128),
                    started_at TIMESTAMP WITH TIME ZONE,
                    completed_by VARCHAR(128),
                    completed_at TIMESTAMP WITH TIME ZONE,
                    created_by VARCHAR(128) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
        except Exception: pass
        for column, column_type in [
            ("batch_number", "VARCHAR(128)"),
            ("handling_unit_id", "UUID"),
            ("destination_store_id", "UUID"),
            ("destination_zone_id", "UUID"),
            ("destination_bin_id", "UUID"),
            ("destination_location_id", "UUID"),
            ("destination_zone", "VARCHAR(128)"),
            ("destination_rack", "VARCHAR(64)"),
            ("destination_bin", "VARCHAR(64)"),
            ("destination_bin_code", "VARCHAR(64)"),
            ("location_assigned_by", "VARCHAR(128)"),
            ("location_assigned_at", "TIMESTAMP WITH TIME ZONE"),
            ("assigned_to", "VARCHAR(128)"),
            ("assigned_by", "VARCHAR(128)"),
            ("assigned_at", "TIMESTAMP WITH TIME ZONE"),
            ("material_category", "VARCHAR(128)"),
            ("handling_requirement", "VARCHAR(128)"),
            ("rotation_policy", "VARCHAR(16)"),
            ("placement_metadata", "JSON"),
            ("started_by", "VARCHAR(128)"),
            ("started_at", "TIMESTAMP WITH TIME ZONE"),
            ("completed_by", "VARCHAR(128)"),
            ("completed_at", "TIMESTAMP WITH TIME ZONE"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE putaway_task ADD COLUMN IF NOT EXISTS {column} {column_type}")
            except Exception: pass
        for column, column_type in [
            ("priority", "VARCHAR(16) NOT NULL DEFAULT 'MEDIUM'"),
            ("required_date", "DATE"),
            ("assigned_team", "VARCHAR(128)"),
            ("assembly_steps", "JSON NOT NULL DEFAULT '[]'"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE assembly_order ADD COLUMN IF NOT EXISTS {column} {column_type}")
            except Exception: pass
        try:
            await run_ddl("UPDATE assembly_order SET status = 'READY' WHERE status = 'PENDING'")
            await run_ddl("UPDATE assembly_order SET status = 'QUALITY_CHECK' WHERE status = 'QUALITY_PENDING'")
        except Exception: pass
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS assembly_material_reservation (
                    id UUID PRIMARY KEY,
                    assembly_order_id UUID NOT NULL REFERENCES assembly_order(id) ON DELETE RESTRICT,
                    material_code VARCHAR(64) NOT NULL,
                    quantity NUMERIC(18, 4) NOT NULL,
                    uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
                    status VARCHAR(32) NOT NULL DEFAULT 'RESERVED',
                    reserved_by VARCHAR(128) NOT NULL,
                    reserved_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    CONSTRAINT uq_assembly_reservation_order_material UNIQUE (assembly_order_id, material_code)
                )
            """)
            await run_ddl("CREATE INDEX IF NOT EXISTS ix_assembly_material_reservation_order ON assembly_material_reservation (assembly_order_id)")
            await run_ddl("CREATE INDEX IF NOT EXISTS ix_assembly_material_reservation_material ON assembly_material_reservation (material_code)")
        except Exception: pass
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS assembly_team (
                    id UUID PRIMARY KEY, name VARCHAR(128) NOT NULL UNIQUE,
                    team_leader VARCHAR(128) NOT NULL, workers JSON NOT NULL DEFAULT '[]',
                    shift VARCHAR(64) NOT NULL, workstation VARCHAR(64) NOT NULL,
                    active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
                )
            """)
            await run_ddl("CREATE UNIQUE INDEX IF NOT EXISTS ix_assembly_team_name ON assembly_team (name)")
        except Exception: pass
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS assembly_material_consumption (
                    id UUID PRIMARY KEY, assembly_order_id UUID NOT NULL REFERENCES assembly_order(id) ON DELETE RESTRICT,
                    material_code VARCHAR(64) NOT NULL, expected_per_unit NUMERIC(18, 4) NOT NULL,
                    assembled_quantity NUMERIC(18, 4) NOT NULL, actual_consumed NUMERIC(18, 4) NOT NULL,
                    uom VARCHAR(32) NOT NULL, recorded_by VARCHAR(128) NOT NULL,
                    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL, updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    CONSTRAINT uq_assembly_consumption_order_material UNIQUE (assembly_order_id, material_code)
                )
            """)
            await run_ddl("CREATE INDEX IF NOT EXISTS ix_assembly_consumption_order ON assembly_material_consumption (assembly_order_id)")
            await run_ddl("CREATE INDEX IF NOT EXISTS ix_assembly_consumption_material ON assembly_material_consumption (material_code)")
        except Exception: pass
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS assembly_scrap (
                    id UUID PRIMARY KEY, assembly_order_id UUID NOT NULL REFERENCES assembly_order(id) ON DELETE RESTRICT,
                    material_code VARCHAR(64) NOT NULL, quantity NUMERIC(18, 4) NOT NULL, uom VARCHAR(32) NOT NULL,
                    reason TEXT NOT NULL, employee_team VARCHAR(128) NOT NULL,
                    approval_required BOOLEAN NOT NULL DEFAULT TRUE, status VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL',
                    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL, approved_by VARCHAR(128), approved_at TIMESTAMP WITH TIME ZONE
                )
            """)
            await run_ddl("CREATE INDEX IF NOT EXISTS ix_assembly_scrap_order ON assembly_scrap (assembly_order_id)")
            await run_ddl("CREATE INDEX IF NOT EXISTS ix_assembly_scrap_material ON assembly_scrap (material_code)")
        except Exception: pass
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS assembly_quality_inspection (
                    id UUID PRIMARY KEY, assembly_order_id UUID NOT NULL UNIQUE REFERENCES assembly_order(id) ON DELETE RESTRICT,
                    produced_quantity NUMERIC(18, 4) NOT NULL, passed_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    failed_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0, rework_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_INSPECTION', inspected_by VARCHAR(128), notes TEXT,
                    inspected_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
                )
            """)
            await run_ddl("CREATE UNIQUE INDEX IF NOT EXISTS ix_assembly_quality_order ON assembly_quality_inspection (assembly_order_id)")
        except Exception: pass
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS assembly_rework_order (
                    id UUID PRIMARY KEY, assembly_order_id UUID NOT NULL REFERENCES assembly_order(id) ON DELETE RESTRICT,
                    rework_number VARCHAR(80) NOT NULL UNIQUE, reason_for_failure TEXT NOT NULL,
                    failed_quantity NUMERIC(18, 4) NOT NULL, assigned_team VARCHAR(128) NOT NULL,
                    assigned_worker VARCHAR(128), status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
                    final_result VARCHAR(32) NOT NULL DEFAULT 'PENDING_INSPECTION', notes TEXT,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL, started_at TIMESTAMP WITH TIME ZONE,
                    completed_at TIMESTAMP WITH TIME ZONE, updated_at TIMESTAMP WITH TIME ZONE NOT NULL
                )
            """)
            await run_ddl("CREATE INDEX IF NOT EXISTS ix_assembly_rework_order ON assembly_rework_order (assembly_order_id)")
            await run_ddl("CREATE UNIQUE INDEX IF NOT EXISTS ix_assembly_rework_number ON assembly_rework_order (rework_number)")
        except Exception: pass
        try:
            await run_ddl("ALTER TABLE assembly_order ADD COLUMN IF NOT EXISTS putaway_status VARCHAR(32) NOT NULL DEFAULT 'PUTAWAY_PENDING'")
            await run_ddl("CREATE INDEX IF NOT EXISTS ix_assembly_order_putaway_status ON assembly_order (putaway_status)")
        except Exception: pass
        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS assembly_finished_goods (
                    id UUID PRIMARY KEY, assembly_order_id UUID NOT NULL UNIQUE REFERENCES assembly_order(id) ON DELETE RESTRICT,
                    product_code VARCHAR(64) NOT NULL, product_name VARCHAR(255) NOT NULL,
                    quantity NUMERIC(18, 4) NOT NULL, uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
                    status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE', warehouse_id VARCHAR(64) NOT NULL,
                    location_code VARCHAR(64) NOT NULL, on_hand_before NUMERIC(18, 4) NOT NULL,
                    on_hand_after NUMERIC(18, 4) NOT NULL, posted_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
                )
            """)
            await run_ddl("CREATE UNIQUE INDEX IF NOT EXISTS ix_assembly_fg_order ON assembly_finished_goods (assembly_order_id)")
            await run_ddl("CREATE INDEX IF NOT EXISTS ix_assembly_fg_product ON assembly_finished_goods (product_code)")
            for column, column_type in [
                ("qr_code", "VARCHAR(255)"),
                ("serial_number", "VARCHAR(128)"),
                ("store_id", "UUID"),
            ]:
                await run_ddl(f"ALTER TABLE assembly_finished_goods ADD COLUMN IF NOT EXISTS {column} {column_type}")
        except Exception: pass
        try:
            await run_ddl("UPDATE putaway_task SET status = 'OPEN' WHERE status = 'PUTAWAY_PENDING'")
        except Exception: pass
        for column, column_type in [
            ("material_code", "VARCHAR(64)"), ("material_name", "VARCHAR(256)"),
            ("source_location", "VARCHAR(128)"), ("destination_location", "VARCHAR(128)"),
            ("batch_lot", "VARCHAR(128)"), ("serial_number", "VARCHAR(128)"),
            ("container_pallet", "VARCHAR(128)"),
        ]:
            try:
                await run_ddl(f"ALTER TABLE putaway_movement ADD COLUMN IF NOT EXISTS {column} {column_type}")
            except Exception: pass

        try:
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS grn (
                    id UUID PRIMARY KEY,
                    po_id UUID UNIQUE,
                    po_number VARCHAR(64) UNIQUE,
                    grn_number VARCHAR(64) UNIQUE,
                    asn_id UUID,
                    asn_number VARCHAR(64),
                    gate_entry_id UUID,
                    gate_entry_number VARCHAR(64),
                    supplier_name VARCHAR(255),
                    supplier_company_name VARCHAR(255),
                    warehouse_id VARCHAR(64),
                    warehouse_name VARCHAR(255),
                    dock_number VARCHAR(32),
                    vehicle_number VARCHAR(64),
                    driver_name VARCHAR(128),
                    invoice_number VARCHAR(128),
                    receipt_type VARCHAR(32) NOT NULL DEFAULT 'PO_RECEIPT',
                    receipt_date TIMESTAMP WITH TIME ZONE,
                    received_by VARCHAR(128),
                    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
                    posted_by VARCHAR(128),
                    posted_at TIMESTAMP WITH TIME ZONE,
                    verification_notes TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS grn_line (
                    id UUID PRIMARY KEY,
                    grn_id UUID NOT NULL REFERENCES grn(id) ON DELETE CASCADE,
                    item_code VARCHAR(64) NOT NULL,
                    material_name VARCHAR(256),
                    material_category VARCHAR(128),
                    uom VARCHAR(32),
                    ordered_quantity NUMERIC(18, 4),
                    received_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    good_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    damaged_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    accepted_quantity NUMERIC(18, 4),
                    rejected_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    quality_approved_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    balance_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
                    quality_result VARCHAR(32)
                )
            """)
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS grn_damage_evidence (
                    id UUID PRIMARY KEY,
                    grn_line_id UUID NOT NULL REFERENCES grn_line(id) ON DELETE CASCADE,
                    damaged_quantity NUMERIC(18, 4) NOT NULL,
                    reason TEXT,
                    remarks TEXT,
                    file_name VARCHAR(255) NOT NULL,
                    file_path VARCHAR(512) NOT NULL,
                    uploaded_by VARCHAR(128) NOT NULL,
                    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS grn_batch (
                    id UUID PRIMARY KEY,
                    grn_line_id UUID NOT NULL REFERENCES grn_line(id) ON DELETE CASCADE,
                    batch_number VARCHAR(64) UNIQUE NOT NULL,
                    batch_quantity NUMERIC(18, 4) NOT NULL,
                    created_by VARCHAR(128) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS grn_document (
                    id UUID PRIMARY KEY,
                    grn_id UUID NOT NULL REFERENCES grn(id) ON DELETE CASCADE,
                    document_type VARCHAR(64) NOT NULL,
                    file_name VARCHAR(255) NOT NULL,
                    file_path VARCHAR(512) NOT NULL,
                    uploaded_by VARCHAR(128) NOT NULL,
                    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS grn_batch_qr (
                    id UUID PRIMARY KEY,
                    item_code VARCHAR(64) UNIQUE NOT NULL,
                    qr_code VARCHAR(128) UNIQUE NOT NULL,
                    qr_payload TEXT NOT NULL,
                    batch_id UUID REFERENCES grn_batch(id) ON DELETE SET NULL,
                    generated_by VARCHAR(128),
                    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await run_ddl("ALTER TABLE grn_batch_qr ADD COLUMN IF NOT EXISTS item_code VARCHAR(64);")
            await run_ddl("ALTER TABLE grn_batch_qr ADD COLUMN IF NOT EXISTS qr_payload TEXT;")
            await run_ddl("ALTER TABLE grn_batch_qr ALTER COLUMN batch_id DROP NOT NULL;")
            await run_ddl("CREATE UNIQUE INDEX IF NOT EXISTS uq_grn_batch_qr_item_code ON grn_batch_qr (item_code);")
            await run_ddl("ALTER TABLE grn_line ADD COLUMN IF NOT EXISTS variant_code VARCHAR(128);")
            logger.debug("Ensured GRN module tables exist")
        except Exception as e:
            logger.warning(f"Failed to create GRN module tables: {e}")

        try:
            await run_ddl(
                """
                CREATE TABLE IF NOT EXISTS store (
                    id UUID PRIMARY KEY,
                    store_code VARCHAR(64) UNIQUE NOT NULL,
                    store_name VARCHAR(128) NOT NULL,
                    description TEXT,
                    warehouse_id VARCHAR(64) NOT NULL DEFAULT 'Main Warehouse',
                    store_manager_id VARCHAR(128),
                    store_manager_name VARCHAR(128),
                    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS ix_store_store_code ON store (store_code);
                CREATE INDEX IF NOT EXISTS ix_store_store_name ON store (store_name);
                CREATE INDEX IF NOT EXISTS ix_store_warehouse_id ON store (warehouse_id);
                CREATE INDEX IF NOT EXISTS ix_store_status ON store (status);
                """
            )
            logger.info("Ensured table 'store' exists")

            await run_ddl(
                """
                CREATE TABLE IF NOT EXISTS store_zone (
                    id UUID PRIMARY KEY,
                    store_id UUID NOT NULL REFERENCES store(id) ON DELETE RESTRICT,
                    zone_code VARCHAR(64) NOT NULL,
                    zone_name VARCHAR(128) NOT NULL,
                    description TEXT,
                    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_store_zone_code UNIQUE (store_id, zone_code)
                );
                CREATE INDEX IF NOT EXISTS ix_store_zone_store_id ON store_zone (store_id);
                CREATE INDEX IF NOT EXISTS ix_store_zone_zone_code ON store_zone (zone_code);
                CREATE INDEX IF NOT EXISTS ix_store_zone_status ON store_zone (status);
                """
            )
            logger.info("Ensured table 'store_zone' exists")

            # Phase 3: Store Manager User Accounts DDL
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS store_manager_user (
                    id UUID PRIMARY KEY,
                    store_id UUID NOT NULL REFERENCES store(id) ON DELETE RESTRICT,
                    employee_id VARCHAR(64) UNIQUE NOT NULL,
                    username VARCHAR(64) UNIQUE NOT NULL,
                    full_name VARCHAR(128) NOT NULL,
                    email VARCHAR(128) UNIQUE NOT NULL,
                    password_hash VARCHAR(256) NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS ix_store_manager_user_store_id ON store_manager_user (store_id);
                CREATE INDEX IF NOT EXISTS ix_store_manager_user_employee_id ON store_manager_user (employee_id);
                CREATE INDEX IF NOT EXISTS ix_store_manager_user_username ON store_manager_user (username);
                CREATE INDEX IF NOT EXISTS ix_store_manager_user_email ON store_manager_user (email);
            """)
            logger.info("Ensured table 'store_manager_user' exists")

            # Assembly Requisition & Stock Reservation DDL
            await run_ddl("ALTER TABLE assembly_requisition_item ADD COLUMN IF NOT EXISTS reserved_quantity NUMERIC(18,4) NOT NULL DEFAULT 0")
            await run_ddl("""
                CREATE TABLE IF NOT EXISTS assembly_stock_reservation (
                    id UUID PRIMARY KEY,
                    requisition_id UUID NOT NULL REFERENCES assembly_requisition(id) ON DELETE CASCADE,
                    requisition_item_id UUID NOT NULL REFERENCES assembly_requisition_item(id) ON DELETE CASCADE,
                    requisition_number VARCHAR(64) NOT NULL,
                    material_code VARCHAR(64) NOT NULL,
                    material_name VARCHAR(256) NOT NULL,
                    required_quantity NUMERIC(18,4) NOT NULL,
                    reserved_quantity NUMERIC(18,4) NOT NULL,
                    uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
                    status VARCHAR(64) NOT NULL DEFAULT 'RESERVED FOR ASSEMBLY',
                    store_id UUID REFERENCES store(id) ON DELETE SET NULL,
                    store_code VARCHAR(64),
                    store_name VARCHAR(256),
                    zone_code VARCHAR(64),
                    bin_code VARCHAR(64),
                    location_code VARCHAR(64),
                    storage_location_id UUID REFERENCES storage_location(id) ON DELETE SET NULL,
                    reserved_by VARCHAR(128) NOT NULL,
                    reserved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS ix_assembly_stock_res_req_id ON assembly_stock_reservation (requisition_id);
                CREATE INDEX IF NOT EXISTS ix_assembly_stock_res_store_id ON assembly_stock_reservation (store_id);
                CREATE INDEX IF NOT EXISTS ix_assembly_stock_res_status ON assembly_stock_reservation (status);
            """)
            logger.info("Ensured table 'assembly_stock_reservation' exists")
        except Exception as exc:
            logger.debug(f"Store / Zone / Manager / Reservation table DDL note: {exc}")
    except Exception as e:
        logger.warning(f"Auto-migration failed: {e}", exc_info=True)

    try:
        await start_producer()
    except Exception as exc:
        logger.debug(f"Kafka producer start skipped (Kafka offline or unavailable): {exc}")

    scheduler.add_job(
        relay_once,
        "interval",
        seconds=settings.outbox_poll_interval_seconds,
        id="outbox-relay",
        max_instances=1,
        coalesce=True,
    )

    scheduler.start()

    try:
        _consumer_task = asyncio.create_task(start_notification_consumer())
    except Exception as exc:
        logger.debug(f"Notification consumer task failed to start: {exc}")

    try:
        _consumer_task = asyncio.create_task(start_notification_consumer())
    except Exception as exc:
        logger.debug(f"Notification consumer task failed to start: {exc}")

    logger.info("business-service started", extra={"extra_fields": {"environment": settings.environment}})

    yield

    scheduler.shutdown(wait=False)
    if _consumer_task is not None:
        _consumer_task.cancel()
    try:
        await stop_producer()
    except Exception:
        pass
    logger.info("business-service stopped")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="AMS/WMS Business Service",
        description="Python business backend: inventory, warehouse, receiving, returns, gate entry, and related domains.",
        version="1.0.0",
        lifespan=lifespan,
    )

    # --- CORS Configuration -----------------------------------------------
    # Robustly handle origins from settings (could be List[str] or comma-separated string)
    raw_origins = settings.cors_allow_origins
    if isinstance(raw_origins, str):
        try:
            import json
            origins = json.loads(raw_origins)
        except:
            origins = [o.strip() for o in raw_origins.split(",") if o.strip()]
    else:
        origins = list(raw_origins)

    for o in [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:8082",
        "http://127.0.0.1:8082",
        "http://localhost:3000",
        "http://localhost:5173",
    ]:
        if o not in origins:
            origins.append(o)

    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|.*\.loca\.lt)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
    register_exception_handlers(app)

    app.include_router(dock_router)
    app.include_router(receiving_router)
    app.include_router(returns_router)
    app.include_router(storage_router)
    app.include_router(notification_router)
    app.include_router(gate_router)
    app.include_router(gate_preview_router)
    app.include_router(dashboard_router)
    app.include_router(quality_router)
    app.include_router(damage_claims_router)
    app.include_router(assembly_router)
    app.include_router(dispatch_router)

    @app.get("/api/debug-assembly")
    async def debug_assembly():
        return {"status": "ok"}
    app.include_router(store_router)
    app.include_router(zone_router)
    app.include_router(bin_router)
    app.include_router(quarantine_router)
    app.include_router(pickup_router)
    app.include_router(assembly_requisition_router)
    app.include_router(inventory_router)
    app.include_router(storage_req_router)
    app.include_router(v1_inventory_router)

    from fastapi.staticfiles import StaticFiles
    import os
    os.makedirs("media_uploads", exist_ok=True)
    app.mount("/media", StaticFiles(directory="media_uploads"), name="media")

    @app.get("/q/{code}")
    async def redirect_short_link_root(code: str):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=f"http://localhost:8080/q/{code}", status_code=307)

    @app.get("/po/{code}")
    async def redirect_po_short_link_root(code: str):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=f"http://localhost:8080/po/{code}", status_code=307)

    @app.get("/health", tags=["ops"])
    async def health() -> dict:
        return {"status": "UP", "service": settings.service_name}

    @app.get("/health/ready", tags=["ops"])
    async def readiness() -> dict:
        return {"status": "READY"}

    if settings.prometheus_enabled:
        from prometheus_fastapi_instrumentator import Instrumentator

        Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)

    return app


app = create_app()
