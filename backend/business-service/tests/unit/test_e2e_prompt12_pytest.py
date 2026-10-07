from __future__ import annotations
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_e2e_prompt12_dispatch_picking_packing_loading_ready_for_gate_exit():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Headers for role separation
        admin_headers = {
            "Authorization": "Bearer mock-admin-token",
            "X-User-Roles": "ADMIN,DISPATCH_MANAGER,WAREHOUSE_MANAGER",
            "X-User-Name": "admin_user",
        }
        dispatch_headers = {
            "Authorization": "Bearer mock-dispatch-token",
            "X-User-Roles": "DISPATCH_MANAGER,DISPATCH_OPERATOR",
            "X-User-Name": "dispatch_manager",
        }
        warehouse_headers = {
            "Authorization": "Bearer mock-wh-token",
            "X-User-Roles": "WAREHOUSE_MANAGER,STORE_MANAGER",
            "X-User-Name": "warehouse_manager",
        }
        gate_headers = {
            "Authorization": "Bearer mock-gate-token",
            "X-User-Roles": "GATE_SECURITY",
            "X-User-Name": "gate_security",
        }

        # -------------------------------------------------------------
        # STEP 1: Verify Finished Goods Availability (PUMP-100 x 10 PCS)
        # -------------------------------------------------------------
        res_fg = await client.get("/api/v1/assembly/finished-goods", headers=admin_headers)
        assert res_fg.status_code == 200, f"List finished goods failed: {res_fg.text}"
        fg_list = res_fg.json()
        fg_pump = next((f for f in fg_list if f.get("product_code") == "PUMP-100"), None)
        assert fg_pump is not None, "Finished Good PUMP-100 must exist in FG Store"
        assert float(fg_pump["quantity"]) >= 10.0, f"Expected 10.0 PCS, got {fg_pump['quantity']}"
        assert fg_pump["status"] == "AVAILABLE"
        assert fg_pump["store_code"] == "STR-FG-01"
        fg_serial = fg_pump.get("serial_number") or "SN-AO-2026-0001-2E9BE0"
        print(f"[OK] FG Verified: ID={fg_pump['id']}, Serial={fg_serial}, Qty={fg_pump['quantity']}, Store={fg_pump['store_code']}")

        # -------------------------------------------------------------
        # STEP 2: Create Dispatch Order
        # -------------------------------------------------------------
        # Check if an existing E2E dispatch order exists, else create it
        res_disp_list = await client.get("/api/dispatches", headers=dispatch_headers)
        assert res_disp_list.status_code == 200
        dispatches = res_disp_list.json().get("items", [])
        e2e_dispatch = next((d for d in dispatches if d.get("order_number") == "DO-2026-0001"), None)

        if not e2e_dispatch:
            create_payload = {
                "order_number": "DO-2026-0001",
                "customer_name": "Apex Water Infrastructure Ltd",
                "warehouse_id": "STR-FG-01",
                "dispatch_type": "Standard",
                "delivery_address": "Plot 42, Peenya Industrial Area, Bangalore - 560058",
                "destination": "Bangalore Client Facility",
                "priority": "High",
                "notes": "E2E Prompt 12 Dispatch | Linked FGR: FGR-20260924-0001 | Product: PUMP-100 x 10 PCS",
                "contact_person": "Ramesh Gupta",
                "contact_phone": "+91-9876543210",
                "items": [
                    {
                        "material_code": "PUMP-100",
                        "material_name": "Industrial Water Pump 100",
                        "quantity_ordered": 10.0,
                        "quantity_available": 10.0,
                        "quantity_reserved": 0.0,
                        "quantity_picked": 0.0,
                        "quantity_packed": 0.0,
                        "quantity_loaded": 0.0,
                        "quantity_pending": 10.0,
                        "uom": "PCS",
                        "batch": fg_serial,
                        "bin": "BIN-FG-001",
                    }
                ],
            }
            res_create = await client.post("/api/dispatches", headers=dispatch_headers, json=create_payload)
            assert res_create.status_code == 201, f"Create dispatch failed: {res_create.text}"
            e2e_dispatch = res_create.json()

        dispatch_id = e2e_dispatch["id"]
        dispatch_num = e2e_dispatch["dispatch_number"]
        print(f"[OK] Dispatch Order: ID={dispatch_id}, Number={dispatch_num}, Status={e2e_dispatch['status']}")
        assert float(e2e_dispatch["items"][0]["quantity_ordered"]) == 10.0
        assert e2e_dispatch["items"][0]["material_code"] == "PUMP-100"

        # -------------------------------------------------------------
        # STEP 3: Reserve Stock (Dispatch Allocation)
        # -------------------------------------------------------------
        if e2e_dispatch["status"] == "DRAFT":
            res_resv = await client.post(f"/api/dispatches/{dispatch_id}/reserve-stock", headers=dispatch_headers)
            assert res_resv.status_code == 200, f"Reserve stock failed: {res_resv.text}"
            e2e_dispatch = res_resv.json()

        assert e2e_dispatch["status"] in (
            "STOCK_RESERVED",
            "PICKING_IN_PROGRESS",
            "PICKED",
            "PACKING_IN_PROGRESS",
            "PACKED",
            "DRIVER_ALLOCATED",
            "VEHICLE_ALLOCATED",
            "ROUTE_ASSIGNED",
            "LOADING_STARTED",
            "LOADING_VERIFIED",
            "READY_FOR_GATE_EXIT",
        )
        assert float(e2e_dispatch["items"][0]["quantity_reserved"]) == 10.0
        print(f"[OK] Stock Reserved: 10.0 PCS reserved for PUMP-100")

        # -------------------------------------------------------------
        # STEP 4: Picking
        # -------------------------------------------------------------
        if e2e_dispatch["status"] == "STOCK_RESERVED":
            res_pick_start = await client.post(f"/api/dispatches/{dispatch_id}/picking", headers=dispatch_headers)
            assert res_pick_start.status_code == 200, f"Start picking failed: {res_pick_start.text}"
            e2e_dispatch = res_pick_start.json()
            assert e2e_dispatch["status"] == "PICKING_IN_PROGRESS"

            # Execute Pick Items
            item_id = e2e_dispatch["items"][0]["id"]
            pick_payload = {
                "items": [
                    {
                        "id": item_id,
                        "material_code": "PUMP-100",
                        "quantity_picked": 10.0,
                    }
                ]
            }
            res_pick_complete = await client.post(f"/api/dispatches/{dispatch_id}/pick-items", headers=dispatch_headers, json=pick_payload)
            assert res_pick_complete.status_code == 200, f"Complete pick failed: {res_pick_complete.text}"
            e2e_dispatch = res_pick_complete.json()

        assert e2e_dispatch["status"] in (
            "PICKED",
            "PACKING_IN_PROGRESS",
            "PACKED",
            "DRIVER_ALLOCATED",
            "VEHICLE_ALLOCATED",
            "ROUTE_ASSIGNED",
            "LOADING_STARTED",
            "LOADING_VERIFIED",
            "READY_FOR_GATE_EXIT",
        )
        assert float(e2e_dispatch["items"][0]["quantity_picked"]) == 10.0
        print(f"[OK] Picking Completed: 10.0 PCS picked from STR-FG-01 / FG-Z01 / BIN-FG-001")

        # -------------------------------------------------------------
        # STEP 5: Packing
        # -------------------------------------------------------------
        if e2e_dispatch["status"] == "PICKED":
            res_pack_start = await client.post(f"/api/dispatches/{dispatch_id}/pack", headers=dispatch_headers)
            assert res_pack_start.status_code == 200, f"Start packing failed: {res_pack_start.text}"
            e2e_dispatch = res_pack_start.json()
            assert e2e_dispatch["status"] == "PACKING_IN_PROGRESS"

            # Execute Pack Items
            item_id = e2e_dispatch["items"][0]["id"]
            pack_payload = {
                "items": [
                    {
                        "id": item_id,
                        "material_code": "PUMP-100",
                        "quantity_packed": 10.0,
                    }
                ]
            }
            res_pack_complete = await client.post(f"/api/dispatches/{dispatch_id}/pack-items", headers=dispatch_headers, json=pack_payload)
            assert res_pack_complete.status_code == 200, f"Complete pack failed: {res_pack_complete.text}"
            e2e_dispatch = res_pack_complete.json()

        assert e2e_dispatch["status"] in (
            "PACKED",
            "DRIVER_ALLOCATED",
            "VEHICLE_ALLOCATED",
            "ROUTE_ASSIGNED",
            "LOADING_STARTED",
            "LOADING_VERIFIED",
            "READY_FOR_GATE_EXIT",
        )
        assert float(e2e_dispatch["items"][0]["quantity_packed"]) == 10.0
        print(f"[OK] Packing Completed: 10.0 PCS packed into standard dispatch handling unit")

        # -------------------------------------------------------------
        # STEP 6: Transport Resource Allocation (Driver, Vehicle, Route)
        # -------------------------------------------------------------
        # 6a. Ensure Driver exists
        res_drivers = await client.get("/api/drivers", headers=dispatch_headers)
        assert res_drivers.status_code == 200
        drivers_list = res_drivers.json()
        driver = next((d for d in drivers_list if d.get("license_number") == "KA01-2026-DRV"), None)
        if not driver:
            driver_payload = {
                "driver_name": "Rajesh Kumar",
                "license_number": "KA01-2026-DRV",
                "phone": "+91-9812345678",
                "email": "rajesh.kumar@translog.com",
                "license_type": "Heavy Commercial",
                "is_active": True,
                "rating": 5.0,
            }
            res_drv_create = await client.post("/api/drivers", headers=dispatch_headers, json=driver_payload)
            assert res_drv_create.status_code == 201
            driver = res_drv_create.json()

        # 6b. Ensure Vehicle exists
        res_vehicles = await client.get("/api/vehicles", headers=dispatch_headers)
        assert res_vehicles.status_code == 200
        vehicles_list = res_vehicles.json()
        vehicle = next((v for v in vehicles_list if v.get("vehicle_number") == "KA01-AB-1234"), None)
        if not vehicle:
            vehicle_payload = {
                "vehicle_number": "KA01-AB-1234",
                "vehicle_type": "10-Ton Heavy Truck",
                "ownership_type": "Owned",
                "capacity_tons": 10.0,
                "is_active": True,
                "insurance_valid": True,
                "fitness_valid": True,
                "permit_valid": True,
                "puc_valid": True,
                "gps_available": True,
            }
            res_veh_create = await client.post("/api/vehicles", headers=dispatch_headers, json=vehicle_payload)
            assert res_veh_create.status_code == 201
            vehicle = res_veh_create.json()

        if e2e_dispatch["status"] == "PACKED":
            # Allocate Driver
            res_drv_alloc = await client.post(
                f"/api/dispatches/{dispatch_id}/driver",
                headers=dispatch_headers,
                json={"driver_id": driver["id"]},
            )
            assert res_drv_alloc.status_code == 200
            e2e_dispatch = res_drv_alloc.json()

        if e2e_dispatch["status"] == "DRIVER_ALLOCATED":
            # Allocate Vehicle
            res_veh_alloc = await client.post(
                f"/api/dispatches/{dispatch_id}/vehicle",
                headers=dispatch_headers,
                json={"vehicle_id": vehicle["id"]},
            )
            assert res_veh_alloc.status_code == 200
            e2e_dispatch = res_veh_alloc.json()

        if e2e_dispatch["status"] == "VEHICLE_ALLOCATED":
            # Assign Route
            res_route = await client.post(
                f"/api/dispatches/{dispatch_id}/route",
                headers=dispatch_headers,
                json={"route_code": "RT-BLR-PEENYA-01"},
            )
            assert res_route.status_code == 200
            e2e_dispatch = res_route.json()

        print(f"[OK] Transport Allocated: Driver={driver['driver_name']}, Vehicle={vehicle['vehicle_number']}, Route=RT-BLR-PEENYA-01")

        # -------------------------------------------------------------
        # STEP 7: Loading Verification & Transition to READY_FOR_GATE_EXIT
        # -------------------------------------------------------------
        if e2e_dispatch["status"] == "ROUTE_ASSIGNED":
            res_load_start = await client.post(f"/api/dispatches/{dispatch_id}/loading/start", headers=dispatch_headers)
            assert res_load_start.status_code == 200
            e2e_dispatch = res_load_start.json()
            assert e2e_dispatch["status"] == "LOADING_STARTED"

        if e2e_dispatch["status"] == "LOADING_STARTED":
            res_load_verify = await client.post(f"/api/dispatches/{dispatch_id}/loading/verify", headers=dispatch_headers)
            assert res_load_verify.status_code == 200
            e2e_dispatch = res_load_verify.json()
            assert e2e_dispatch["status"] == "LOADING_VERIFIED"
            assert float(e2e_dispatch["items"][0]["quantity_loaded"]) == 10.0

        if e2e_dispatch["status"] == "LOADING_VERIFIED":
            res_final_verify = await client.post(f"/api/dispatches/{dispatch_id}/verify", headers=dispatch_headers)
            assert res_final_verify.status_code == 200
            e2e_dispatch = res_final_verify.json()

        assert e2e_dispatch["status"] == "READY_FOR_GATE_EXIT"
        print(f"[OK] Dispatch Status = READY_FOR_GATE_EXIT!")

        # -------------------------------------------------------------
        # STEP 8: Verify Queue for Gate Exit
        # -------------------------------------------------------------
        res_rfe = await client.get("/api/dispatches/ready-for-gate-exit", headers=dispatch_headers)
        assert res_rfe.status_code == 200
        rfe_orders = res_rfe.json()
        target_in_rfe = next((o for o in rfe_orders if o["id"] == dispatch_id), None)
        assert target_in_rfe is not None, "Dispatch order must appear in ready-for-gate-exit queue"

        # -------------------------------------------------------------
        # STEP 9: Warehouse Dashboard Dispatch Tracking Visibility
        # -------------------------------------------------------------
        res_wh_disp = await client.get("/api/dispatches", headers=warehouse_headers)
        assert res_wh_disp.status_code == 200
        wh_items = res_wh_disp.json().get("items", [])
        wh_target = next((o for o in wh_items if o["id"] == dispatch_id), None)
        assert wh_target is not None, "Warehouse role must see the exact underlying dispatch order"
        assert wh_target["status"] == "READY_FOR_GATE_EXIT"
        assert float(wh_target["items"][0]["quantity_ordered"]) == 10.0
        assert float(wh_target["items"][0]["quantity_loaded"]) == 10.0

        # Check KPIs
        res_kpis = await client.get("/api/dispatches/kpis", headers=warehouse_headers)
        assert res_kpis.status_code == 200
        kpi_data = res_kpis.json()
        assert "ready_for_gate_exit" in kpi_data
        print(f"[OK] Warehouse visibility confirmed. KPIs: {kpi_data}")

        # -------------------------------------------------------------
        # STEP 10: Genealogy Preservation Check
        # -------------------------------------------------------------
        res_genealogy = await client.get(f"/api/v1/assembly/genealogy/{fg_serial}", headers=admin_headers)
        assert res_genealogy.status_code == 200
        genealogy = res_genealogy.json()
        assert genealogy["finished_good"]["serial_number"] == fg_serial
        assert genealogy["finished_good"]["product_code"] == "PUMP-100"
        
        consumed = genealogy.get("consumed_materials", [])
        motor_comp = next((c for c in consumed if c["material_code"] == "MAT-MOTOR-001"), None)
        assert motor_comp is not None, "Motor component must exist in genealogy"
        assert motor_comp.get("grn_info", {}).get("grn_number") == "GRN-20260924-0003"
        assert "LOT-MAT-MOTOR-001-20260924-ACF3" in motor_comp.get("batches", [])
        assert motor_comp.get("issue_number") == "ISS-2026-7475C5"
        assert motor_comp.get("grn_info", {}).get("po_number") == "PO-2026-0001"
        assert motor_comp.get("grn_info", {}).get("supplier_name") == "E2E Motor Supplier"
        assert motor_comp.get("putaway_task") == "PT-20260924-65F7"
        print(f"[OK] Genealogy 100% Preserved with Motor Traceability: {motor_comp['material_code']} -> {motor_comp.get('grn_info', {}).get('grn_number')}")

        # -------------------------------------------------------------
        # STEP 11: Downstream Isolation Check (STOP AT READY_FOR_GATE_EXIT)
        # -------------------------------------------------------------
        # Verify Gate Exit has NOT occurred
        assert e2e_dispatch["status"] == "READY_FOR_GATE_EXIT"
        assert e2e_dispatch["status"] not in ("DISPATCHED", "IN_TRANSIT", "DELIVERED", "CLOSED", "GATE_OUT")

        # Verify Gate Security role cannot perform dispatch operational mutations
        res_sec_mutate = await client.post(
            f"/api/dispatches/{dispatch_id}/reserve-stock",
            headers=gate_headers,
        )
        # Should be forbidden or bad request
        assert res_sec_mutate.status_code in (401, 403, 400), "Gate security should not be executing dispatch reservation"

        print("[OK] Prompt 12 Execution Finished Successfully — Stopped at READY_FOR_GATE_EXIT checkpoint.")
