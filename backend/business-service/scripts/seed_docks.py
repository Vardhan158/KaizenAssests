"""
Seed 9 standard industrial docks and associated stores into WMS database.
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
from app.modules.store.infrastructure.persistence.models import StoreModel, StoreZoneModel, StoreBinModel

STORES = [
    {
        "store_code": "STR-RM",
        "store_name": "Raw Material Store",
        "description": "Primary storage for metals, steel rods, copper wire, and raw fabrication materials.",
        "warehouse_id": "Main Warehouse",
        "zones": ["Aisle A1", "Aisle A2", "Aisle A3"],
    },
    {
        "store_code": "STR-CH",
        "store_name": "Chemical & Hazardous Store",
        "description": "Temperature and ventilation-controlled hazardous material storage.",
        "warehouse_id": "Main Warehouse",
        "zones": ["HazMat Zone 1", "HazMat Zone 2"],
    },
    {
        "store_code": "STR-EL",
        "store_name": "Electrical Store",
        "description": "Enclosed store for electrical wire coils, motors, cables, and switchgear.",
        "warehouse_id": "Main Warehouse",
        "zones": ["Electrical Bay 1", "Electrical Bay 2"],
    },
    {
        "store_code": "STR-EC",
        "store_name": "Electronics Store",
        "description": "ESD-safe climate-controlled facility for microchips and circuit boards.",
        "warehouse_id": "Main Warehouse",
        "zones": ["ESD Cleanroom A", "ESD Cleanroom B"],
    },
    {
        "store_code": "STR-MR",
        "store_name": "Main Receiving Store",
        "description": "General receiving store and staging buffer.",
        "warehouse_id": "Main Warehouse",
        "zones": ["General Aisle 1", "General Aisle 2"],
    },
]

DOCKS_9 = [
    {
        "code": "RM-01",
        "name": "Raw Material Dock 01",
        "type": "RAW_MATERIAL",
        "location": "North Warehouse - Bay 1",
        "description": "Primary inbound dock for raw materials, metals, and standard fabrication items.",
        "store_code": "STR-RM",
    },
    {
        "code": "RM-02",
        "name": "Raw Material Dock 02",
        "type": "RAW_MATERIAL",
        "location": "East Warehouse - Bay 2",
        "description": "Secondary inbound dock for raw materials and heavy bulk cargo.",
        "store_code": "STR-RM",
    },
    {
        "code": "CH-01",
        "name": "Chemical/Hazardous Dock 01",
        "type": "CHEMICAL_HAZARDOUS",
        "location": "South Warehouse - HazMat Bay 1",
        "description": "Ventilated hazardous cargo bay with containment protocol for chemicals and coatings.",
        "store_code": "STR-CH",
    },
    {
        "code": "CH-02",
        "name": "Chemical/Hazardous Dock 02",
        "type": "CHEMICAL_HAZARDOUS",
        "location": "South Warehouse - HazMat Bay 2",
        "description": "Secondary hazardous and volatile materials receiving dock.",
        "store_code": "STR-CH",
    },
    {
        "code": "EL-01",
        "name": "Electrical Dock 01",
        "type": "ELECTRICAL",
        "location": "North Warehouse - Bay 3",
        "description": "Specialized inbound dock for electrical components, wires, cables, and switchgear.",
        "store_code": "STR-EL",
    },
    {
        "code": "EL-02",
        "name": "Electrical Dock 02",
        "type": "ELECTRICAL",
        "location": "North Warehouse - Bay 4",
        "description": "Secondary dock for electrical hardware and sub-assemblies.",
        "store_code": "STR-EL",
    },
    {
        "code": "EC-01",
        "name": "Electronics Dock 01",
        "type": "ELECTRONICS",
        "location": "West Warehouse - Bay 1",
        "description": "ESD-controlled dock for sensitive electronic circuits, microcontrollers, and chips.",
        "store_code": "STR-EC",
    },
    {
        "code": "EC-02",
        "name": "Electronics Dock 02",
        "type": "ELECTRONICS",
        "location": "West Warehouse - Bay 2",
        "description": "Secondary ESD-compliant dock for electronic devices and sensor components.",
        "store_code": "STR-EC",
    },
    {
        "code": "MR-01",
        "name": "Main Receiving Dock 01",
        "type": "MAIN_RECEIVING",
        "location": "Central Receiving - Main Bay 1",
        "description": "Primary high-throughput receiving dock for general consignments and mixed shipments.",
        "store_code": "STR-MR",
    },
]


async def seed_stores_and_docks():
    print("==================================================")
    print("SEEDING 9 DOCKS AND STORES INTO POSTGRESQL DATABASE")
    print("==================================================")

    async with session_scope() as session:
        store_map = {}
        now = datetime.now(timezone.utc)

        # 1. Seed Stores, Zones, and Bins
        for st_data in STORES:
            code = st_data["store_code"]
            stmt = select(StoreModel).where(StoreModel.store_code == code)
            res = await session.execute(stmt)
            existing_store = res.scalar_one_or_none()

            if not existing_store:
                new_store = StoreModel(
                    id=uuid.uuid4(),
                    store_code=code,
                    store_name=st_data["store_name"],
                    description=st_data["description"],
                    warehouse_id=st_data["warehouse_id"],
                    status="ACTIVE",
                )
                session.add(new_store)
                await session.flush()
                store_map[code] = new_store
                print(f"[CREATED STORE] {code} - {st_data['store_name']}")

                # Create Zones and Bins
                for idx, z_name in enumerate(st_data["zones"], start=1):
                    z_code = f"ZN-{code.replace('STR-', '')}-{idx:02d}"
                    zone = StoreZoneModel(
                        id=uuid.uuid4(),
                        store_id=new_store.id,
                        zone_code=z_code,
                        zone_name=z_name,
                        description=f"Storage zone {z_name} in {st_data['store_name']}",
                        status="ACTIVE",
                    )
                    session.add(zone)
                    await session.flush()

                    # Create Bins
                    for b_num in range(1, 4):
                        bin_code = f"BIN-{z_code}-{b_num:02d}"
                        bin_obj = StoreBinModel(
                            id=uuid.uuid4(),
                            store_id=new_store.id,
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
                store_map[code] = existing_store

        await session.flush()

        # 2. Seed 9 Docks
        for d in DOCKS_9:
            code = d["code"]
            st_code = d.get("store_code")
            target_store = store_map.get(st_code)
            target_store_id = target_store.id if target_store else None

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
                    store_id=target_store_id,
                )
                session.add(dock)
                print(f"[CREATED DOCK] {code} - {d['name']} (Type: {d['type']}, Store: {st_code})")
            else:
                existing_dock.status = "AVAILABLE"
                existing_dock.is_active = True
                existing_dock.store_id = target_store_id

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
        print("[SUCCESS] ALL 9 DOCKS & STORES CREATED SUCCESSFULLY!")
        print("==================================================")


if __name__ == "__main__":
    asyncio.run(seed_stores_and_docks())
