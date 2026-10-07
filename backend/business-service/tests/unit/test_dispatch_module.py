import pytest
from app.modules.dispatch.domain.dispatch import DispatchOrder, DispatchItem, DispatchStatus
from app.modules.dispatch.domain.driver import Driver, DriverStatus
from app.modules.dispatch.domain.vehicle import Vehicle, VehicleStatus
from app.modules.dispatch.application.commands import (
    CreateDispatchCommand,
    DispatchItemDTO,
    CreateDriverCommand,
    CreateVehicleCommand,
    PickItemsCommand,
    PackItemsCommand,
    AllocateDriverCommand,
    AllocateVehicleCommand,
    AssignRouteCommand,
)


def test_dispatch_domain_lifecycle():
    items = [
        DispatchItem(
            material_code="FG-001",
            material_name="Test Finished Good",
            quantity_ordered=10.0,
            quantity_available=20.0,
        )
    ]
    order = DispatchOrder.create(
        order_number="SO-1001",
        customer_name="Customer Acme",
        items=items,
    )
    assert order.status == DispatchStatus.DRAFT

    # Reserve Stock
    order.reserve_stock()
    assert order.status == DispatchStatus.STOCK_RESERVED
    assert order.items[0].quantity_reserved == 10.0
    assert order.items[0].quantity_available == 10.0

    # Start Picking & Pick Items
    order.start_picking()
    assert order.status == DispatchStatus.PICKING_IN_PROGRESS
    order.pick_items([{"material_code": "FG-001", "quantity_picked": 10.0}])
    assert order.status == DispatchStatus.PICKED

    # Start Packing & Pack Items
    order.start_packing()
    assert order.status == DispatchStatus.PACKING_IN_PROGRESS
    order.pack_items([{"material_code": "FG-001", "quantity_packed": 10.0}])
    assert order.status == DispatchStatus.PACKED

    # Allocation
    order.allocate_driver("DRV-001")
    assert order.status == DispatchStatus.DRIVER_ALLOCATED
    order.allocate_vehicle("VEH-001")
    assert order.status == DispatchStatus.VEHICLE_ALLOCATED
    order.assign_route("ROUTE-BGL-MYS")
    assert order.status == DispatchStatus.ROUTE_ASSIGNED

    # Loading
    order.start_loading()
    assert order.status == DispatchStatus.LOADING_STARTED
    order.verify_loading()
    assert order.status == DispatchStatus.LOADING_VERIFIED

    # Final Verification for Gate Exit
    order.verify_final()
    assert order.status == DispatchStatus.READY_FOR_GATE_EXIT

    # Dispatch & Transit & Delivery
    order.dispatch()
    assert order.status == DispatchStatus.DISPATCHED
    order.transit()
    assert order.status == DispatchStatus.IN_TRANSIT
    order.deliver()
    assert order.status == DispatchStatus.DELIVERED


def test_driver_domain_creation():
    driver = Driver.create(
        driver_name="Ramesh Kumar",
        license_number="DL-KA-01-2022-0001",
        phone="+91 9876543210",
        email="ramesh@example.com",
    )
    assert driver.driver_name == "Ramesh Kumar"
    assert driver.status == DriverStatus.AVAILABLE


def test_vehicle_domain_creation():
    vehicle = Vehicle.create(
        vehicle_number="KA-01-AB-1234",
        vehicle_type="Truck 10T",
        capacity_tons=10.0,
    )
    assert vehicle.vehicle_number == "KA-01-AB-1234"
    assert vehicle.status == VehicleStatus.AVAILABLE
