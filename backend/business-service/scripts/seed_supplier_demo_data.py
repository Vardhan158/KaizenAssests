"""Seed realistic dummy data for Supplier workflows:
1. Vehicles & Drivers (for vehicle selection & ASN / dispatch flows)
2. Assembly Orders & Assembly Finished Goods (for Supplier Dispatch FG dropdown)
3. Supplier Finished Goods Dispatch Requests (for Supplier Dispatch history table)
4. GRNs, GRN Lines, Damage Evidence & Supplier Damage Claims (for Damage Returns workflow in various actionable states)
5. Purchase Orders & Line Items (for testing Create Delivery / ASN)

Idempotent: running multiple times safely updates or skips existing records.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import os
import sys
import uuid

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select, text
from app.database.session import session_scope

# Import all model modules so that all referenced tables (like warehouse, material_request, etc.)
# are registered in SQLAlchemy Base.metadata for foreign key resolution.
import app.common.persistence.models
import app.modules.assembly.infrastructure.persistence.models
import app.modules.dispatch.infrastructure.persistence.models
import app.modules.dock.infrastructure.persistence.models
import app.modules.gate.infrastructure.persistence.models
import app.modules.notification.infrastructure.persistence.models
import app.modules.quarantine.infrastructure.persistence.models
import app.modules.receiving.infrastructure.persistence.models
import app.modules.returns.infrastructure.persistence.models
import app.modules.storage.infrastructure.persistence.models
import app.modules.warehouse.infrastructure.persistence.models

from app.common.persistence.models import (
    SupplierModel,
    SupplierUserModel,
    PurchaseOrderModel,
    PurchaseOrderItemModel,
    FinishedGoodsRequestModel,
)
from app.modules.dispatch.infrastructure.persistence.models import (
    VehicleModel,
    DriverModel,
)
from app.modules.assembly.infrastructure.persistence.models import (
    AssemblyOrderModel,
    AssemblyFinishedGoodsModel,
)
from app.modules.receiving.infrastructure.persistence.models import (
    GrnModel,
    GrnLineModel,
    GrnDamageEvidenceModel,
)
from app.modules.gate.infrastructure.persistence.models import (
    SupplierDamageClaimModel,
    ReplacementShipmentModel,
)


def now_utc():
    return datetime.now(timezone.utc)


async def seed():
    print("=================================================================")
    print("--- Starting Supplier Workflow Demo Data Seeding ---")
    print("=================================================================")

    async with session_scope() as session:
        # 1. Resolve Supplier & Supplier User
        supplier = (await session.execute(
            select(SupplierModel).where(SupplierModel.supplier_code == "SUP-DEFAULT")
        )).scalar_one_or_none()

        if not supplier:
            supplier = (await session.execute(select(SupplierModel))).scalars().first()

        if not supplier:
            supplier = SupplierModel(
                id=uuid.UUID("b6151813-3a0b-44de-a168-d4e8d1e95a8d"),
                supplier_code="SUP-DEFAULT",
                supplier_name="supplier",
                company_name="Apex Precision Components Pvt Ltd",
                contact_person="Ramesh Patel",
                email="supplier@apexcomponents.com",
                phone="9845012345",
                is_active=True,
                created_at=datetime.now(),
            )
            session.add(supplier)
            await session.flush()
            print(f"[+] Created Supplier: {supplier.supplier_name} ({supplier.id})")
        else:
            print(f"[*] Found Supplier: {supplier.supplier_name} ({supplier.id})")

        supplier_id = supplier.id

        # Ensure supplier user exists
        sup_user = (await session.execute(
            select(SupplierUserModel).where(SupplierUserModel.username == "supplier")
        )).scalar_one_or_none()

        if not sup_user:
            sup_user = SupplierUserModel(
                id=uuid.UUID("4ba750d2-579f-4efb-b6ef-6fe86b68b575"),
                username="supplier",
                supplier_id=supplier_id,
                email="supplier@apexcomponents.com",
                full_name="Apex Supplier Portal",
                is_active=True,
                created_at=datetime.now(),
            )
            session.add(sup_user)
            await session.flush()
            print(f"[+] Created Supplier User: {sup_user.username}")
        else:
            print(f"[*] Found Supplier User: {sup_user.username}")

        # -----------------------------------------------------------------
        # 2. Seed Registered Vehicles & Drivers
        # -----------------------------------------------------------------
        vehicles_data = [
            {"number": "KA-01-AB-4582", "type": "10 Ton Truck", "ownership": "Owned", "capacity": 10.0},
            {"number": "MH-12-DE-9876", "type": "16 Ton Multi-Axle", "ownership": "Leased", "capacity": 16.0},
            {"number": "KA-05-XY-1234", "type": "7 Ton Container", "ownership": "Owned", "capacity": 7.0},
            {"number": "DL-01-EF-5678", "type": "12 Ton Closed Body", "ownership": "Dedicated Carrier", "capacity": 12.0},
        ]
        for v in vehicles_data:
            existing_v = (await session.execute(
                select(VehicleModel).where(VehicleModel.vehicle_number == v["number"])
            )).scalar_one_or_none()
            if not existing_v:
                session.add(VehicleModel(
                    id=uuid.uuid4(),
                    vehicle_number=v["number"],
                    vehicle_type=v["type"],
                    ownership_type=v["ownership"],
                    capacity_tons=Decimal(str(v["capacity"])),
                    is_active=True,
                    insurance_valid=True,
                    fitness_valid=True,
                    permit_valid=True,
                    puc_valid=True,
                    gps_available=True,
                    status="AVAILABLE",
                    created_at=now_utc(),
                ))
                print(f"[+] Added Vehicle: {v['number']} ({v['type']})")

        drivers_data = [
            {"name": "Suresh Gowda", "license": "KA0120180004582", "phone": "9845012345", "type": "Heavy", "rating": 4.9},
            {"name": "Ramesh Kumar", "license": "MH1220190009876", "phone": "9876543210", "type": "Heavy", "rating": 4.8},
            {"name": "Anand Patil", "license": "KA0520200001234", "phone": "9123456789", "type": "Medium", "rating": 4.7},
        ]
        for d in drivers_data:
            existing_d = (await session.execute(
                select(DriverModel).where(DriverModel.license_number == d["license"])
            )).scalar_one_or_none()
            if not existing_d:
                session.add(DriverModel(
                    id=uuid.uuid4(),
                    driver_name=d["name"],
                    license_number=d["license"],
                    phone=d["phone"],
                    email=f"{d['name'].lower().replace(' ', '.')}@fastlogistics.in",
                    license_type=d["type"],
                    license_verified=True,
                    is_active=True,
                    status="AVAILABLE",
                    rating=Decimal(str(d["rating"])),
                    created_at=now_utc(),
                ))
                print(f"[+] Added Driver: {d['name']} ({d['phone']})")

        await session.flush()

        # -----------------------------------------------------------------
        # 3. Seed Assembly Finished Goods (for Supplier Dispatch creation dropdown)
        # -----------------------------------------------------------------
        finished_goods_data = [
            {
                "order_number": "AO-2026-001",
                "product_code": "FG-STEEL-BRG",
                "product_name": "Precision Ball Bearing 6205-2RS",
                "quantity": 150.0,
                "uom": "PCS",
                "location": "ASSEMBLY-LOC-A1",
                "qr": "QR-FG-BRG-6205",
                "serial": "SN-BRG-2026-0001",
                "batch": "BAT-BRG-2026-01",
                "status": "AVAILABLE",
            },
            {
                "order_number": "AO-2026-002",
                "product_code": "FG-HYD-CYL",
                "product_name": "Hydraulic Actuator Cylinder 50mm",
                "quantity": 45.0,
                "uom": "PCS",
                "location": "ASSEMBLY-LOC-B2",
                "qr": "QR-FG-HYD-0050",
                "serial": "SN-HYD-2026-0002",
                "batch": "BAT-HYD-2026-02",
                "status": "QC_APPROVED",
            },
            {
                "order_number": "AO-2026-003",
                "product_code": "FG-ELEC-CTRL",
                "product_name": "Electronic Controller Board v3",
                "quantity": 80.0,
                "uom": "SET",
                "location": "ASSEMBLY-LOC-C3",
                "qr": "QR-FG-CTRL-0003",
                "serial": "SN-CTRL-2026-0003",
                "batch": "BAT-CTRL-2026-03",
                "status": "AVAILABLE",
            },
            {
                "order_number": "AO-2026-004",
                "product_code": "FG-PUMP-ASM",
                "product_name": "High Pressure Fuel Pump Assembly",
                "quantity": 60.0,
                "uom": "NOS",
                "location": "ASSEMBLY-LOC-D4",
                "qr": "QR-FG-PUMP-0010",
                "serial": "SN-PUMP-2026-0004",
                "batch": "BAT-PUMP-2026-04",
                "status": "AVAILABLE",
            },
        ]

        for fg in finished_goods_data:
            existing_ao = (await session.execute(
                select(AssemblyOrderModel).where(AssemblyOrderModel.order_number == fg["order_number"])
            )).scalar_one_or_none()

            if not existing_ao:
                existing_ao = AssemblyOrderModel(
                    id=uuid.uuid4(),
                    order_number=fg["order_number"],
                    department="Assembly",
                    product_code=fg["product_code"],
                    product_name=fg["product_name"],
                    uom=fg["uom"],
                    priority="NORMAL",
                    status="COMPLETED",
                    putaway_status="COMPLETED",
                    planned_quantity=Decimal(str(fg["quantity"] + 10)),
                    completed_quantity=Decimal(str(fg["quantity"])),
                    rejected_quantity=Decimal("0"),
                    created_by="Assembly Manager",
                    created_at=datetime.now() - timedelta(days=5),
                    completed_at=datetime.now() - timedelta(days=2),
                )
                session.add(existing_ao)
                await session.flush()

            existing_fg = (await session.execute(
                select(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.assembly_order_id == existing_ao.id)
            )).scalar_one_or_none()

            if not existing_fg:
                session.add(AssemblyFinishedGoodsModel(
                    id=uuid.uuid4(),
                    assembly_order_id=existing_ao.id,
                    product_code=fg["product_code"],
                    product_name=fg["product_name"],
                    quantity=Decimal(str(fg["quantity"])),
                    uom=fg["uom"],
                    status=fg["status"],
                    warehouse_id="WH-ASSEMBLY",
                    location_code=fg["location"],
                    on_hand_before=Decimal("0"),
                    on_hand_after=Decimal(str(fg["quantity"])),
                    qr_code=fg["qr"],
                    serial_number=fg["serial"],
                    batch_number=fg["batch"],
                    posted_at=datetime.now() - timedelta(days=2),
                ))
                print(f"[+] Added Finished Good: {fg['product_code']} - {fg['product_name']} ({fg['quantity']} {fg['uom']})")

        await session.flush()

        # -----------------------------------------------------------------
        # 4. Seed Supplier Finished Goods Dispatch Requests (for Supplier Dispatch Table)
        # -----------------------------------------------------------------
        dispatch_requests_data = [
            {
                "request_number": "FGD-20261016-001",
                "material_code": "FG-STEEL-BRG",
                "material_name": "Precision Ball Bearing 6205-2RS",
                "quantity": 25.0,
                "uom": "PCS",
                "vehicle_number": "KA-01-AB-4582",
                "driver_name": "Suresh Gowda",
                "driver_contact": "9845012345",
                "expected_pickup_date": date.today() + timedelta(days=1),
                "status": "PENDING_ASSEMBLY",
                "priority": "HIGH",
                "remarks": "Priority dispatch for line 2 assembly batch.",
                "created_at": datetime.now() - timedelta(hours=3),
            },
            {
                "request_number": "FGD-20261015-002",
                "material_code": "FG-HYD-CYL",
                "material_name": "Hydraulic Actuator Cylinder 50mm",
                "quantity": 10.0,
                "uom": "PCS",
                "vehicle_number": "MH-12-DE-9876",
                "driver_name": "Ramesh Kumar",
                "driver_contact": "9876543210",
                "expected_pickup_date": date.today(),
                "status": "ALLOCATED",
                "priority": "MEDIUM",
                "remarks": "Stock allocated in bay 4; ready for loading.",
                "created_at": datetime.now() - timedelta(days=1),
            },
            {
                "request_number": "FGD-20261014-003",
                "material_code": "FG-ELEC-CTRL",
                "material_name": "Electronic Controller Board v3",
                "quantity": 15.0,
                "uom": "SET",
                "vehicle_number": "KA-05-XY-1234",
                "driver_name": "Anand Patil",
                "driver_contact": "9123456789",
                "expected_pickup_date": date.today() - timedelta(days=2),
                "status": "COMPLETED",
                "priority": "NORMAL",
                "remarks": "Completed pickup. Security gate exit verified.",
                "created_at": datetime.now() - timedelta(days=3),
            },
        ]

        for req in dispatch_requests_data:
            existing_req = (await session.execute(
                select(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.request_number == req["request_number"])
            )).scalar_one_or_none()

            if not existing_req:
                session.add(FinishedGoodsRequestModel(
                    id=uuid.uuid4(),
                    request_number=req["request_number"],
                    material_code=req["material_code"],
                    material_name=req["material_name"],
                    quantity=Decimal(str(req["quantity"])),
                    uom=req["uom"],
                    warehouse="ASSEMBLY",
                    requested_by="supplier",
                    department="SUPPLIER",
                    priority=req["priority"],
                    required_date=req["expected_pickup_date"],
                    requested_date=req["created_at"].date(),
                    remarks=req["remarks"],
                    status=req["status"],
                    supplier_id=str(supplier_id),
                    supplier_name="supplier",
                    vehicle_number=req["vehicle_number"],
                    driver_name=req["driver_name"],
                    driver_contact=req["driver_contact"],
                    expected_pickup_date=req["expected_pickup_date"],
                    created_at=req["created_at"],
                ))
                print(f"[+] Added Supplier Dispatch Request: {req['request_number']} ({req['status']})")

        await session.flush()

        # -----------------------------------------------------------------
        # 5. Seed GRNs, Damage Evidence & Supplier Damage Claims (for Damage Returns)
        # -----------------------------------------------------------------
        claims_data = [
            # Claim 1: PENDING_RESPONSE (Actionable: Accept/Reject/Partially Accept + Resolution + remarks + submit)
            {
                "claim_number": "DC-00001",
                "po_number": "PO-2026-0089",
                "grn_number": "GRN-2026-0101",
                "asn_number": "ASN-2026-0101",
                "vehicle_number": "KA-01-AB-4582",
                "driver_name": "Suresh Gowda",
                "item_code": "RAW-STL-ROD",
                "material_name": "Alloy Steel Rod 25mm",
                "uom": "PCS",
                "received_qty": 100.0,
                "good_qty": 80.0,
                "damaged_qty": 15.0,
                "rejected_qty": 5.0,
                "damage_reason": "Transit impact damage - bent rods and severe surface scratches",
                "remarks": "15 rods deformed beyond permissible straightness tolerance. 5 rejected due to oxidation.",
                "file_name": "evidence_bent_steel_rods.jpg",
                "file_path": "/media/damage/bent_steel_rods.jpg",
                "claim_status": "SUPPLIER_SENT",
                "supplier_response": None,
                "resolution": None,
                "supplier_remarks": None,
                "return_required": False,
                "shipment": None,
            },
            # Claim 2: ACCEPTED with REPLACEMENT, awaiting shipment (Actionable: Send Replacement!)
            {
                "claim_number": "DC-00002",
                "po_number": "PO-2026-0092",
                "grn_number": "GRN-2026-0102",
                "asn_number": "ASN-2026-0102",
                "vehicle_number": "MH-12-DE-9876",
                "driver_name": "Ramesh Kumar",
                "item_code": "RAW-ALU-PLT",
                "material_name": "Cast Aluminum Plate 10mm",
                "uom": "PCS",
                "received_qty": 50.0,
                "good_qty": 40.0,
                "damaged_qty": 8.0,
                "rejected_qty": 2.0,
                "damage_reason": "Corner chipping and pallet impact fracture during unloading",
                "remarks": "Corner fractures found during receiving quality check. Supplier accepted replacement.",
                "file_name": "evidence_cracked_aluminum.jpg",
                "file_path": "/media/damage/cracked_aluminum.jpg",
                "claim_status": "ACCEPTED",
                "supplier_response": "ACCEPT",
                "resolution": "REPLACEMENT",
                "supplier_remarks": "We accept the claim and will dispatch 10 replacement plates immediately.",
                "return_required": True,
                "shipment": None,
            },
            # Claim 3: REPLACEMENT_IN_TRANSIT (Tracking View)
            {
                "claim_number": "DC-00003",
                "po_number": "PO-2026-0095",
                "grn_number": "GRN-2026-0103",
                "asn_number": "ASN-2026-0103",
                "vehicle_number": "KA-05-XY-1234",
                "driver_name": "Anand Patil",
                "item_code": "RAW-BRS-VLV",
                "material_name": "Brass Safety Relief Valve 1/2-inch",
                "uom": "PCS",
                "received_qty": 60.0,
                "good_qty": 48.0,
                "damaged_qty": 12.0,
                "rejected_qty": 0.0,
                "damage_reason": "Thread cross-strip and dented valve stems during transport",
                "remarks": "Cross-stripped threads on 12 units. Replacement already in transit.",
                "file_name": "evidence_dented_valves.jpg",
                "file_path": "/media/damage/dented_valves.jpg",
                "claim_status": "REPLACEMENT_IN_TRANSIT",
                "supplier_response": "ACCEPT",
                "resolution": "RETURN_REPLACEMENT",
                "supplier_remarks": "Replacement dispatched via vehicle DL-01-EF-5678.",
                "return_required": True,
                "shipment": {
                    "shipment_number": "RS-00001",
                    "vehicle_number": "DL-01-EF-5678",
                    "expected_qty": 12.0,
                    "status": "IN_TRANSIT",
                },
            },
            # Claim 4: RESOLVED via Credit Note (Completed History)
            {
                "claim_number": "DC-00004",
                "po_number": "PO-2026-0078",
                "grn_number": "GRN-2026-0098",
                "asn_number": "ASN-2026-0098",
                "vehicle_number": "KA-01-AB-4582",
                "driver_name": "Suresh Gowda",
                "item_code": "RAW-RUB-GSK",
                "material_name": "High Temp Silicone Gaskets",
                "uom": "PCS",
                "received_qty": 200.0,
                "good_qty": 160.0,
                "damaged_qty": 40.0,
                "rejected_qty": 0.0,
                "damage_reason": "Moisture contamination in packaging causing silicone degradation",
                "remarks": "Credit note CN-2026-44 issued and adjusted against pending invoices.",
                "file_name": "evidence_moisture_gaskets.jpg",
                "file_path": "/media/damage/moisture_gaskets.jpg",
                "claim_status": "CLOSED",
                "supplier_response": "ACCEPT",
                "resolution": "CREDIT_NOTE",
                "supplier_remarks": "Credit note CN-2026-44 issued for 40 units.",
                "return_required": False,
                "closed_at": datetime.now(timezone.utc) - timedelta(days=3),
                "closed_by": "FINANCE_OFFICER",
                "shipment": None,
            },
        ]

        for cd in claims_data:
            # Check if GRN exists
            grn = (await session.execute(
                select(GrnModel).where(GrnModel.grn_number == cd["grn_number"])
            )).scalar_one_or_none()

            if not grn:
                grn = GrnModel(
                    id=uuid.uuid4(),
                    grn_number=cd["grn_number"],
                    po_number=cd["po_number"],
                    asn_number=cd["asn_number"],
                    supplier_name="supplier",
                    supplier_company_name="Apex Precision Components Pvt Ltd",
                    warehouse_id="WH-01",
                    warehouse_name="Central Receiving Warehouse",
                    dock_number="DOCK-01",
                    vehicle_number=cd["vehicle_number"],
                    driver_name=cd["driver_name"],
                    receipt_type="PO_RECEIPT",
                    receipt_date=datetime.now(timezone.utc) - timedelta(days=2),
                    received_by="Receiving Clerk",
                    status="COMPLETED",
                    posted_at=datetime.now(timezone.utc) - timedelta(days=2),
                    posted_by="Warehouse Manager",
                    created_at=datetime.now(timezone.utc) - timedelta(days=2),
                )
                session.add(grn)
                await session.flush()
                print(f"[+] Created GRN: {grn.grn_number}")

            # Check if GRN Line exists
            grn_line = (await session.execute(
                select(GrnLineModel).where(
                    GrnLineModel.grn_id == grn.id,
                    GrnLineModel.item_code == cd["item_code"]
                )
            )).scalar_one_or_none()

            if not grn_line:
                grn_line = GrnLineModel(
                    id=uuid.uuid4(),
                    grn_id=grn.id,
                    item_code=cd["item_code"],
                    material_name=cd["material_name"],
                    received_quantity=Decimal(str(cd["received_qty"])),
                    good_quantity=Decimal(str(cd["good_qty"])),
                    accepted_quantity=Decimal(str(cd["good_qty"])),
                    damaged_quantity=Decimal(str(cd["damaged_qty"])),
                    rejected_quantity=Decimal(str(cd["rejected_qty"])),
                    uom=cd["uom"],
                    quality_result="REJECTED" if cd["damaged_qty"] > 0 else "ACCEPTED",
                    damage_reason=cd["damage_reason"],
                )
                session.add(grn_line)
                await session.flush()
                print(f"[+] Created GRN Line: {grn_line.item_code} (Damaged: {cd['damaged_qty']})")

            # Check if GRN Damage Evidence exists
            evidence = (await session.execute(
                select(GrnDamageEvidenceModel).where(GrnDamageEvidenceModel.grn_line_id == grn_line.id)
            )).scalar_one_or_none()

            if not evidence:
                evidence = GrnDamageEvidenceModel(
                    id=uuid.uuid4(),
                    grn_line_id=grn_line.id,
                    damaged_quantity=Decimal(str(cd["damaged_qty"])),
                    reason=cd["damage_reason"],
                    remarks=cd["remarks"],
                    file_name=cd["file_name"],
                    file_path=cd["file_path"],
                    uploaded_by="QC Inspector",
                    uploaded_at=datetime.now(timezone.utc) - timedelta(days=2),
                )
                session.add(evidence)
                await session.flush()

            # Check if Claim exists
            claim = (await session.execute(
                select(SupplierDamageClaimModel).where(SupplierDamageClaimModel.claim_number == cd["claim_number"])
            )).scalar_one_or_none()

            if not claim:
                claim = SupplierDamageClaimModel(
                    id=uuid.uuid4(),
                    claim_number=cd["claim_number"],
                    source_grn_id=grn.id,
                    source_grn_line_id=grn_line.id,
                    supplier_id=supplier_id,
                    status=cd["claim_status"],
                    created_by="QUALITY_INSPECTION",
                    created_at=datetime.now(timezone.utc) - timedelta(days=2),
                    sent_at=datetime.now(timezone.utc) - timedelta(days=2),
                    supplier_response=cd["supplier_response"],
                    resolution=cd["resolution"],
                    supplier_remarks=cd["supplier_remarks"],
                    return_required=cd["return_required"],
                    responded_at=datetime.now(timezone.utc) - timedelta(days=1) if cd["supplier_response"] else None,
                    closed_by=cd.get("closed_by"),
                    closed_at=cd.get("closed_at"),
                )
                session.add(claim)
                await session.flush()
                print(f"[+] Created Damage Claim: {claim.claim_number} ({cd['claim_status']})")

            # Check replacement shipment if specified
            if cd.get("shipment"):
                ship_data = cd["shipment"]
                existing_ship = (await session.execute(
                    select(ReplacementShipmentModel).where(ReplacementShipmentModel.claim_id == claim.id)
                )).scalar_one_or_none()
                if not existing_ship:
                    session.add(ReplacementShipmentModel(
                        id=uuid.uuid4(),
                        shipment_number=ship_data["shipment_number"],
                        claim_id=claim.id,
                        expected_quantity=Decimal(str(ship_data["expected_qty"])),
                        vehicle_number=ship_data["vehicle_number"],
                        expected_arrival=datetime.now(timezone.utc) + timedelta(days=1),
                        status=ship_data["status"],
                    ))
                    print(f"[+] Created Replacement Shipment: {ship_data['shipment_number']} for {claim.claim_number}")

        await session.flush()

        # -----------------------------------------------------------------
        # 6. Seed Purchase Orders (for creating new ASNs / Deliveries)
        # -----------------------------------------------------------------
        po_data = [
            {
                "po_number": "PO-2026-0105",
                "date": date.today() - timedelta(days=4),
                "delivery_date": date.today() + timedelta(days=7),
                "status": "APPROVED",
                "items": [
                    {"code": "RAW-STL-ROD", "name": "Alloy Steel Rod 25mm", "qty": 500.0, "price": 120.0, "uom": "PCS"},
                    {"code": "RAW-ALU-PLT", "name": "Cast Aluminum Plate 10mm", "qty": 200.0, "price": 350.0, "uom": "PCS"},
                ]
            },
            {
                "po_number": "PO-2026-0106",
                "date": date.today() - timedelta(days=2),
                "delivery_date": date.today() + timedelta(days=10),
                "status": "ISSUED",
                "items": [
                    {"code": "RAW-BRS-VLV", "name": "Brass Safety Relief Valve 1/2-inch", "qty": 150.0, "price": 450.0, "uom": "PCS"},
                    {"code": "RAW-RUB-GSK", "name": "High Temp Silicone Gaskets", "qty": 1000.0, "price": 25.0, "uom": "PCS"},
                ]
            },
        ]

        for p in po_data:
            existing_po = (await session.execute(
                select(PurchaseOrderModel).where(PurchaseOrderModel.po_number == p["po_number"])
            )).scalar_one_or_none()

            if not existing_po:
                subtotal = sum(Decimal(str(it["qty"])) * Decimal(str(it["price"])) for it in p["items"])
                tax = subtotal * Decimal("0.18")
                total = subtotal + tax

                new_po = PurchaseOrderModel(
                    id=uuid.uuid4(),
                    po_number=p["po_number"],
                    po_date=p["date"],
                    status=p["status"],
                    supplier_id=supplier_id,
                    supplier_name="supplier",
                    supplier_code="SUP-DEFAULT",
                    warehouse_id="WH-01",
                    delivery_warehouse_name="Central Receiving Warehouse",
                    expected_delivery_date=p["delivery_date"],
                    subtotal=subtotal,
                    tax_amount=tax,
                    total_amount=total,
                    created_at=datetime.now() - timedelta(days=4),
                )
                session.add(new_po)
                await session.flush()

                for item in p["items"]:
                    session.add(PurchaseOrderItemModel(
                        id=uuid.uuid4(),
                        purchase_order_id=new_po.id,
                        material_code=item["code"],
                        material_name=item["name"],
                        quantity=Decimal(str(item["qty"])),
                        unit_price=Decimal(str(item["price"])),
                        uom=item["uom"],
                    ))
                print(f"[+] Created Purchase Order: {new_po.po_number} with {len(p['items'])} lines")

        await session.commit()

    print("=================================================================")
    print("--- Supplier Demo Data Seeding Completed Successfully! ---")
    print("=================================================================")


if __name__ == "__main__":
    asyncio.run(seed())
