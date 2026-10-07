"""
Careful cleanup of ONLY dummy / demo / development data introduced during WMS phases.
"""
import asyncio
import os
import sys
from sqlalchemy import text

sys.path.insert(0, os.path.abspath("."))
from app.database.session import session_scope

async def run_clean_step(name: str, sql: str):
    async with session_scope() as session:
        try:
            res = await session.execute(text(sql))
            await session.commit()
            print(f"[CLEANED] {name}")
        except Exception as e:
            print(f"[SKIPPED/NOTE] {name}: {e}")

async def cleanup_dummy_data():
    print("=== STARTING CAREFUL DUMMY DATA CLEANUP ===")

    # 1. Outbound & Assembly Requisitions
    await run_clean_step("inventory_issue_transaction", "DELETE FROM inventory_issue_transaction")
    await run_clean_step("pickup_task", "DELETE FROM pickup_task")
    await run_clean_step("assembly_requisition_item", "DELETE FROM assembly_requisition_item")
    await run_clean_step("assembly_requisition", "DELETE FROM assembly_requisition")

    # 2. Quarantine
    await run_clean_step("quarantine_audit", "DELETE FROM quarantine_audit")
    await run_clean_step("quarantine_record", "DELETE FROM quarantine_record")

    # 3. Location Balances, Movements, Putaway Tasks, Handling Units
    await run_clean_step("inventory_location_balance", "DELETE FROM inventory_location_balance")
    await run_clean_step("putaway_movement", "DELETE FROM putaway_movement")
    await run_clean_step("putaway_task", "DELETE FROM putaway_task")
    await run_clean_step("handling_unit", "DELETE FROM handling_unit")
    await run_clean_step("storage_location", "DELETE FROM storage_location")

    # 4. Receiving & GRNs
    await run_clean_step("inventory_receipt_posting", "DELETE FROM inventory_receipt_posting")
    await run_clean_step("grn_line", "DELETE FROM grn_line")
    await run_clean_step("grn", "DELETE FROM grn")
    await run_clean_step("receiving_line", "DELETE FROM receiving_line")
    await run_clean_step("receiving_record", "DELETE FROM receiving_record")

    # 5. Gate & Vehicle tracking
    await run_clean_step("gate_exit", "DELETE FROM gate_exit")
    await run_clean_step("vehicle_exit_approval", "DELETE FROM vehicle_exit_approval")
    await run_clean_step("gate_entry_audit_log", "DELETE FROM gate_entry_audit_log")
    await run_clean_step("dock_assignment", "DELETE FROM dock_assignment")
    await run_clean_step("gate_entry", "DELETE FROM gate_entry")

    # 6. Notifications
    await run_clean_step("notification", "DELETE FROM notification")

    # 7. Material stock
    await run_clean_step("material_stock", "DELETE FROM material_stock")

    # 8. Test materials
    await run_clean_step("demo test materials", """
        DELETE FROM material
        WHERE material_code LIKE 'TEST-%'
           OR material_code LIKE 'MOT-%'
           OR material_code LIKE 'MAT-DAM-%'
           OR material_code LIKE 'MAT-MOTOR-%'
    """)

    # 9. Store Managers, Store Zones, and Demo Stores
    await run_clean_step("store_manager_user", "DELETE FROM store_manager_user")
    await run_clean_step("store_zone", "DELETE FROM store_zone")
    await run_clean_step("store", "DELETE FROM store")

    print("=== DUMMY DATA CLEANUP COMPLETED ===")

if __name__ == "__main__":
    asyncio.run(cleanup_dummy_data())
