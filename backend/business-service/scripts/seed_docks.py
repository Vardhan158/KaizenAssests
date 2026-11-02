"""
Seed 9 standard industrial docks and associated warehouses into WMS database.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from decimal import Decimal

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select, text
from app.database.session import session_scope
from app.modules.dock.infrastructure.persistence.models import DockMasterModel
from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel, WarehouseZoneModel, WarehouseBinModel

WAREHOUSE_SETUP = [{
    "warehouse_code": "WH-001", "warehouse_name": "Main Warehouse",
    "description": "The application's single warehouse.", "warehouse_id": "Main Warehouse",
    "zones": ["Receiving", "Raw Materials", "Finished Goods"],
}]

DOCKS_9 = [
    {
        "code": "RM-01",
        "name": "Raw Material Dock 01",
        "type": "RAW_MATERIAL",
        "location": "North Warehouse - Bay 1",
        "description": "Primary inbound dock for raw materials, metals, and standard fabrication items.",
        "warehouse_code": "WH-001",
    },
    {
        "code": "RM-02",
        "name": "Raw Material Dock 02",
        "type": "RAW_MATERIAL",
        "location": "East Warehouse - Bay 2",
        "description": "Secondary inbound dock for raw materials and heavy bulk cargo.",
        "warehouse_code": "WH-001",
    },
    {
        "code": "CH-01",
        "name": "Chemical/Hazardous Dock 01",
        "type": "CHEMICAL_HAZARDOUS",
        "location": "South Warehouse - HazMat Bay 1",
        "description": "Ventilated hazardous cargo bay with containment protocol for chemicals and coatings.",
        "warehouse_code": "WH-001",
    },
    {
        "code": "CH-02",
        "name": "Chemical/Hazardous Dock 02",
        "type": "CHEMICAL_HAZARDOUS",
        "location": "South Warehouse - HazMat Bay 2",
        "description": "Secondary hazardous and volatile materials receiving dock.",
        "warehouse_code": "WH-001",
    },
    {
        "code": "EL-01",
        "name": "Electrical Dock 01",
        "type": "ELECTRICAL",
        "location": "North Warehouse - Bay 3",
        "description": "Specialized inbound dock for electrical components, wires, cables, and switchgear.",
        "warehouse_code": "WH-001",
    },
    {
        "code": "EL-02",
        "name": "Electrical Dock 02",
        "type": "ELECTRICAL",
        "location": "North Warehouse - Bay 4",
        "description": "Secondary dock for electrical hardware and sub-assemblies.",
        "warehouse_code": "WH-001",
    },
    {
        "code": "EC-01",
        "name": "Electronics Dock 01",
        "type": "ELECTRONICS",
        "location": "West Warehouse - Bay 1",
        "description": "ESD-controlled dock for sensitive electronic circuits, microcontrollers, and chips.",
        "warehouse_code": "WH-001",
    },
    {
        "code": "EC-02",
        "name": "Electronics Dock 02",
        "type": "ELECTRONICS",
        "location": "West Warehouse - Bay 2",
        "description": "Secondary ESD-compliant dock for electronic devices and sensor components.",
        "warehouse_code": "WH-001",
    },
    {
        "code": "MR-01",
        "name": "Main Receiving Dock 01",
        "type": "MAIN_RECEIVING",
        "location": "Central Receiving - Main Bay 1",
        "description": "Primary high-throughput receiving dock for general consignments and mixed shipments.",
        "warehouse_code": "WH-001",
    },
]


async def seed_warehouses_and_docks():
    print("==================================================")
    print("SEEDING 9 DOCKS IN THE SINGLE WAREHOUSE INTO POSTGRESQL DATABASE")
    print("==================================================")

    async with session_scope() as session:
        warehouse_map = {}
        now = datetime.now(timezone.utc)

        # 1. Seed Warehouses, Zones, and Bins
        for st_data in WAREHOUSE_SETUP:
            code = st_data["warehouse_code"]
            stmt = select(WarehouseModel).limit(1)
            res = await session.execute(stmt)
            existing_warehouse = res.scalar_one_or_none()

            if not existing_warehouse:
                new_warehouse = WarehouseModel(
                    id=uuid.uuid4(),
                    warehouse_code=code,
                    warehouse_name=st_data["warehouse_name"],
                    description=st_data["description"],
                    warehouse_id=st_data["warehouse_id"],
                    status="ACTIVE",
                )
                session.add(new_warehouse)
                await session.flush()
                warehouse_map[code] = new_warehouse
                print(f"[CREATED WAREHOUSE_OPERATOR] {code} - {st_data['warehouse_name']}")

                # Create Zones and Bins
                for idx, z_name in enumerate(st_data["zones"], start=1):
                    z_code = f"ZN-{code.replace('STR-', '')}-{idx:02d}"
                    zone = WarehouseZoneModel(
                        id=uuid.uuid4(),
                        warehouse_ref_id=new_warehouse.id,
                        zone_code=z_code,
                        zone_name=z_name,
                        description=f"Storage zone {z_name} in {st_data['warehouse_name']}",
                        status="ACTIVE",
                    )
                    session.add(zone)
                    await session.flush()

                    # Create Bins
                    for b_num in range(1, 4):
                        bin_code = f"BIN-{z_code}-{b_num:02d}"
                        bin_obj = WarehouseBinModel(
                            id=uuid.uuid4(),
                            warehouse_ref_id=new_warehouse.id,
                            zone_id=zone.id,
                            bin_code=bin_code,
                            bin_name=f"Bin {b_num} ({z_name})",
                            rack=f"R{idx}",
                            shelf=f"S{b_num}",
                            capacity=Decimal("1000.0"),
                            occupied_quantity=Decimal("0.0"),
                            status="ACTIVE",
                        )
                        session.add(bin_obj)
            else:
                warehouse_map[code] = existing_warehouse

        await session.flush()

        # 2. Seed 9 Docks
        for d in DOCKS_9:
            code = d["code"]
            st_code = d.get("warehouse_code")
            target_warehouse = warehouse_map.get(st_code)
            target_warehouse_ref_id = target_warehouse.id if target_warehouse else None

            # Insert into dock_masters
            dock_stmt = select(DockMasterModel).where(DockMasterModel.dock_code == code)
            dock_res = await session.execute(dock_stmt)
            existing_dock = dock_res.scalar_one_or_none()

            if not existing_dock:
                dock = DockMasterModel(
                    id=uuid.uuid4(),
                    dock_code=code,
                    dock_name=d["name"],
                    dock_type=d["type"],
                    location=d["location"],
                    description=d["description"],
                    status="AVAILABLE",
                    is_active=True,
                    warehouse_ref_id=target_warehouse_ref_id,
                )
                session.add(dock)
                print(f"[CREATED DOCK] {code} - {d['name']} (Type: {d['type']}, Warehouse: {st_code})")
            else:
                existing_dock.status = "AVAILABLE"
                existing_dock.is_active = True
                existing_dock.warehouse_ref_id = target_warehouse_ref_id

            # Insert/Update warehouse_dock for legacy compatibility
            wh_dock_stmt = text("SELECT id FROM warehouse_dock WHERE dock_number = :dn")
            wh_res = await session.execute(wh_dock_stmt, {"dn": code})
            wh_row = wh_res.fetchone()
            if not wh_row:
                await session.execute(
                    text("""
                        INSERT INTO warehouse_dock (id, dock_number, warehouse_id, dock_type, capacity, status, created_at, updated_at)
                        VALUES (:id, :dock_number, 'WH-01', :dock_type, 1, 'AVAILABLE', :created_at, :updated_at)
                    """),
                    {
                        "id": uuid.uuid4(),
                        "dock_number": code,
                        "dock_type": d["type"],
                        "created_at": now,
                        "updated_at": now,
                    }
                )

        await session.commit()
        print("==================================================")
        print("[SUCCESS] ALL 9 DOCKS & WAREHOUSE LOCATIONS CREATED SUCCESSFULLY!")
        print("==================================================")


if __name__ == "__main__":
    asyncio.run(seed_warehouses_and_docks())
