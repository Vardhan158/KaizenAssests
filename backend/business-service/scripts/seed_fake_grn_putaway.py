import sys
import os
sys.path.insert(0, os.path.abspath('.'))

import asyncio
import uuid
from datetime import datetime
from sqlalchemy import text

import app.modules.warehouse.infrastructure.persistence.models  # noqa
from app.database.session import engine

ITEMS = [
    {
        "item_code": "MAT-BEAR-2002",
        "material_name": "High-Precision Roller Bearings SKF",
        "quantity": 120.0,
        "uom": "PCS",
        "category": "MECHANICAL",
        "supplier": "Precision Bearings Ltd",
    },
    {
        "item_code": "MAT-PCB-3003",
        "material_name": "Control Board Controller Unit V2",
        "quantity": 35.0,
        "uom": "UNITS",
        "category": "ELECTRONICS",
        "supplier": "TechCircuits Global",
    },
    {
        "item_code": "MAT-VALV-4004",
        "material_name": "Hydraulic Solenoid Valve 24V",
        "quantity": 80.0,
        "uom": "PCS",
        "category": "HYDRAULICS",
        "supplier": "FluidTech Hydraulics",
    },
]

async def seed_fake_grn_and_putaway():
    warehouse_id = "Main Warehouse"
    source_location = "DOCK_RECEIVING_AREA"

    print("\n=======================================================")
    print("        Seeding 3 Additional Fake GRN & Putaway Tasks   ")
    print("=======================================================")

    async with engine.begin() as conn:
        for item in ITEMS:
            grn_id = str(uuid.uuid4())
            unique_code = uuid.uuid4().hex[:6].upper()
            grn_number = f"GRN-2026-{unique_code}"
            task_id = str(uuid.uuid4())
            task_number = f"PUT-2026-{unique_code}"
            po_number = f"PO-2026-{unique_code}"
            asn_number = f"ASN-2026-{unique_code}"
            grn_line_id = str(uuid.uuid4())

            # 1. Insert GRN Header
            await conn.execute(
                text("""
                    INSERT INTO grn (id, grn_number, po_number, asn_number, warehouse_id, status, supplier_name, created_at, updated_at)
                    VALUES (:id, :grn_num, :po_num, :asn_num, :wh_id, 'GRN_POSTED', :sup_name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """),
                {
                    "id": grn_id,
                    "grn_num": grn_number,
                    "po_num": po_number,
                    "asn_num": asn_number,
                    "wh_id": warehouse_id,
                    "sup_name": item["supplier"],
                },
            )

            # 2. Insert GRN Line
            await conn.execute(
                text("""
                    INSERT INTO grn_line (id, grn_id, item_code, material_name, received_quantity, good_quantity, damaged_quantity, uom)
                    VALUES (:id, :grn_id, :item_code, :mat_name, :qty, :qty, 0, :uom)
                """),
                {
                    "id": grn_line_id,
                    "grn_id": grn_id,
                    "item_code": item["item_code"],
                    "mat_name": item["material_name"],
                    "qty": item["quantity"],
                    "uom": item["uom"],
                },
            )

            # 3. Insert Putaway Task
            await conn.execute(
                text("""
                    INSERT INTO putaway_task (
                        id, task_number, grn_id, grn_number, item_code, material_name, quantity, uom,
                        warehouse_id, source_location, status, created_by, created_at, material_category
                    ) VALUES (
                        :id, :task_num, :grn_id, :grn_num, :item_code, :mat_name, :qty, :uom,
                        :wh_id, :source_loc, 'OPEN', 'warehouse_manager', CURRENT_TIMESTAMP, :category
                    )
                """),
                {
                    "id": task_id,
                    "task_num": task_number,
                    "grn_id": grn_id,
                    "grn_num": grn_number,
                    "item_code": item["item_code"],
                    "mat_name": item["material_name"],
                    "qty": item["quantity"],
                    "uom": item["uom"],
                    "wh_id": warehouse_id,
                    "source_loc": source_location,
                    "category": item["category"],
                },
            )

            print(f"Created GRN: {grn_number} | Task: {task_number} | Item: {item['item_code']} ({item['material_name']}) - {item['quantity']} {item['uom']}")

    print("\nAll 3 additional items created successfully!\n")

if __name__ == "__main__":
    asyncio.run(seed_fake_grn_and_putaway())
