"""
Seed Standard Materials (Wire, Steel, Iron, etc.) into WMS Business Database.
Adds standard materials with full specifications, variants, and stock tracking.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime
from decimal import Decimal

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select
from app.database.session import session_scope
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialModel,
    MaterialVariantModel,
    MaterialStockModel,
)

STANDARD_MATERIALS = [
    {
        "material_code": "MAT-WIRE-001",
        "material_name": "Copper Winding Wire",
        "category": "Electrical & Electronics",
        "description": "Enamelled copper winding wire for transformers, motors, and electrical coil winding.",
        "base_uom": "KG",
        "status": "Active",
        "reorder_point": Decimal("100.0"),
        "variants": [
            {
                "variant_code": "MAT-WIRE-001-V001",
                "size": "1.5 mm / 16 SWG",
                "color": "Copper / Brown",
                "grade": "Class H (180°C)",
                "specification": "Dual Coated Modified Polyester Enamelled Copper Wire (IS 13730 / IEC 60317)",
                "uom": "KG",
                "attributes": {"swg": 16, "conductor": "Copper", "temperature_class": "180C"},
                "status": "Active",
            }
        ],
    },
    {
        "material_code": "MAT-STEEL-001",
        "material_name": "Structural Steel Rod",
        "category": "Metals & Fabrication",
        "description": "High-strength structural steel reinforcement rod for fabrication and framework.",
        "base_uom": "KG",
        "status": "Active",
        "reorder_point": Decimal("500.0"),
        "variants": [
            {
                "variant_code": "MAT-STEEL-001-V001",
                "size": "12 mm Dia x 6m Length",
                "color": "Metallic Grey",
                "grade": "Fe 500D TMT Steel",
                "specification": "IS 1786 / High Yield Strength Deformed Steel Bar",
                "uom": "KG",
                "attributes": {"diameter_mm": 12, "length_meters": 6, "standard": "IS 1786"},
                "status": "Active",
            }
        ],
    },
    {
        "material_code": "MAT-IRON-001",
        "material_name": "Foundry Cast Iron Ingot",
        "category": "Metals & Raw Materials",
        "description": "Foundry grade grey cast iron ingots for casting, machining, and component manufacturing.",
        "base_uom": "KG",
        "status": "Active",
        "reorder_point": Decimal("1000.0"),
        "variants": [
            {
                "variant_code": "MAT-IRON-001-V001",
                "size": "25 kg Ingot Block",
                "color": "Dark Grey",
                "grade": "FG 200 / Grade 25 Cast Iron",
                "specification": "IS 210 / ASTM A48 Class 30 Grey Iron",
                "uom": "KG",
                "attributes": {"block_weight_kg": 25, "carbon_content": "3.2-3.5%", "grade": "FG200"},
                "status": "Active",
            }
        ],
    },
]


async def seed_materials():
    print("==================================================")
    print("SEEDING MATERIALS (WIRE, STEEL, IRON) INTO WMS DB")
    print("==================================================")

    async with session_scope() as session:
        for mat_data in STANDARD_MATERIALS:
            code = mat_data["material_code"]
            stmt = select(MaterialModel).where(MaterialModel.material_code == code)
            res = await session.execute(stmt)
            existing = res.scalar_one_or_none()

            if existing:
                print(f"[SKIP] Material '{code}' already exists.")
                continue

            mat_id = uuid.uuid4()
            mat_model = MaterialModel(
                id=mat_id,
                material_code=code,
                material_name=mat_data["material_name"],
                category=mat_data["category"],
                description=mat_data["description"],
                base_uom=mat_data["base_uom"],
                status=mat_data["status"],
                created_at=datetime.now(),
                created_by="SYSTEM",
                updated_at=datetime.now(),
                updated_by="SYSTEM",
            )
            session.add(mat_model)

            for v in mat_data["variants"]:
                var_id = uuid.uuid4()
                var_model = MaterialVariantModel(
                    id=var_id,
                    material_id=mat_id,
                    variant_code=v["variant_code"],
                    size=v["size"],
                    color=v["color"],
                    grade=v["grade"],
                    specification=v["specification"],
                    uom=v["uom"],
                    attributes=v["attributes"],
                    status=v["status"],
                    created_at=datetime.now(),
                    created_by="SYSTEM",
                    updated_at=datetime.now(),
                    updated_by="SYSTEM",
                )
                session.add(var_model)

                # Add stock tracking record
                stock_model = MaterialStockModel(
                    id=uuid.uuid4(),
                    material_id=mat_id,
                    material_variant_id=var_id,
                    material_code=code,
                    variant_code=v["variant_code"],
                    material_name=mat_data["material_name"],
                    category=mat_data["category"],
                    on_hand=Decimal("0.0"),
                    allocated=Decimal("0.0"),
                    available=Decimal("0.0"),
                    uom=v["uom"],
                    warehouse_id="WH-01",
                    reorder_point=mat_data["reorder_point"],
                    updated_at=datetime.now(),
                )
                session.add(stock_model)

            print(f"[CREATED] Material '{code}' - {mat_data['material_name']} with variant & stock tracking.")

        await session.commit()
        print("==================================================")
        print("SEEDING COMPLETE!")
        print("==================================================")


if __name__ == "__main__":
    asyncio.run(seed_materials())
