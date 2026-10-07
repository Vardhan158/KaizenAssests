from __future__ import annotations
from typing import Sequence
from app.modules.dispatch.application.commands import (
    CreateDispatchCommand,
    PickItemsCommand,
    PackItemsCommand,
    AllocateDriverCommand,
    AllocateVehicleCommand,
    AssignRouteCommand,
    CreateDriverCommand,
    CreateVehicleCommand,
)
from app.modules.dispatch.application.repository import (
    DispatchRepository,
    DriverRepository,
    VehicleRepository,
)
from app.modules.dispatch.domain.dispatch import DispatchOrder, DispatchItem, DispatchStatus
from app.modules.dispatch.domain.driver import Driver, DriverStatus
from app.modules.dispatch.domain.vehicle import Vehicle, VehicleStatus

class DispatchUseCases:
    def __init__(
        self,
        dispatch_repo: DispatchRepository,
        driver_repo: DriverRepository,
        vehicle_repo: VehicleRepository,
    ):
        self.dispatch_repo = dispatch_repo
        self.driver_repo = driver_repo
        self.vehicle_repo = vehicle_repo

    async def create_dispatch(self, cmd: CreateDispatchCommand) -> DispatchOrder:
        items = [
            DispatchItem(
                material_code=i.material_code,
                material_name=i.material_name,
                quantity_ordered=i.quantity_ordered,
                quantity_available=i.quantity_available,
                quantity_reserved=i.quantity_reserved,
                quantity_picked=i.quantity_picked,
                quantity_packed=i.quantity_packed,
                quantity_loaded=i.quantity_loaded,
                quantity_pending=i.quantity_pending,
                uom=i.uom,
                batch=i.batch,
                bin=i.bin,
            )
            for i in cmd.items
        ]
        order = DispatchOrder.create(
            order_number=cmd.order_number,
            customer_name=cmd.customer_name,
            warehouse_id=cmd.warehouse_id,
            dispatch_type=cmd.dispatch_type,
            items=items,
            delivery_address=cmd.delivery_address,
            destination=cmd.destination,
            scheduled_date=cmd.scheduled_date,
            expected_delivery_date=cmd.expected_delivery_date,
            priority=cmd.priority,
            contact_person=cmd.contact_person,
            contact_phone=cmd.contact_phone,
            delivery_instructions=cmd.delivery_instructions,
            transport_mode=cmd.transport_mode,
            transport_type=cmd.transport_type,
            transporter=cmd.transporter,
            dispatch_number=cmd.dispatch_number,
            notes=cmd.notes,
        )
        return await self.dispatch_repo.save(order)

    async def get_dispatch(self, dispatch_id: str) -> DispatchOrder | None:
        return await self.dispatch_repo.get_by_id(dispatch_id)

    async def list_dispatches(
        self,
        status: str | None = None,
        warehouse_id: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[DispatchOrder], int]:
        return await self.dispatch_repo.list_all(status=status, warehouse_id=warehouse_id, skip=skip, limit=limit)

    async def reserve_stock(self, dispatch_id: str) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.reserve_stock()
        return await self.dispatch_repo.save(order)

    async def start_picking(self, dispatch_id: str) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.start_picking()
        return await self.dispatch_repo.save(order)

    async def pick_items(self, dispatch_id: str, cmd: PickItemsCommand) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        data = [i.model_dump() for i in cmd.items]
        order.pick_items(data)
        return await self.dispatch_repo.save(order)

    async def start_packing(self, dispatch_id: str) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.start_packing()
        return await self.dispatch_repo.save(order)

    async def pack_items(self, dispatch_id: str, cmd: PackItemsCommand) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        data = [i.model_dump() for i in cmd.items]
        order.pack_items(data)
        return await self.dispatch_repo.save(order)

    async def allocate_driver(self, dispatch_id: str, cmd: AllocateDriverCommand) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        driver = await self.driver_repo.get_by_id(cmd.driver_id)
        if not driver:
            raise ValueError(f"Driver not found: {cmd.driver_id}")
        order.allocate_driver(cmd.driver_id)
        driver.status = DriverStatus.ASSIGNED
        driver.assigned_vehicle_id = order.vehicle_id
        await self.driver_repo.save(driver)
        return await self.dispatch_repo.save(order)

    async def allocate_vehicle(self, dispatch_id: str, cmd: AllocateVehicleCommand) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        vehicle = await self.vehicle_repo.get_by_id(cmd.vehicle_id)
        if not vehicle:
            raise ValueError(f"Vehicle not found: {cmd.vehicle_id}")
        order.allocate_vehicle(cmd.vehicle_id)
        vehicle.status = VehicleStatus.ASSIGNED
        await self.vehicle_repo.save(vehicle)
        return await self.dispatch_repo.save(order)

    async def assign_route(self, dispatch_id: str, cmd: AssignRouteCommand) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.assign_route(cmd.route_code)
        return await self.dispatch_repo.save(order)

    async def start_loading(self, dispatch_id: str) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.start_loading()
        return await self.dispatch_repo.save(order)

    async def verify_loading(self, dispatch_id: str) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.verify_loading()
        return await self.dispatch_repo.save(order)

    async def verify_final(self, dispatch_id: str) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.verify_final()
        return await self.dispatch_repo.save(order)

    async def dispatch_order(self, dispatch_id: str) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.dispatch()
        return await self.dispatch_repo.save(order)

    async def transit_order(self, dispatch_id: str) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.transit()
        return await self.dispatch_repo.save(order)

    async def deliver_order(self, dispatch_id: str) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.deliver()
        if order.vehicle_id:
            v = await self.vehicle_repo.get_by_id(order.vehicle_id)
            if v:
                v.status = VehicleStatus.AVAILABLE
                await self.vehicle_repo.save(v)
        if order.driver_id:
            d = await self.driver_repo.get_by_id(order.driver_id)
            if d:
                d.status = DriverStatus.AVAILABLE
                d.assigned_vehicle_id = None
                await self.driver_repo.save(d)
        return await self.dispatch_repo.save(order)

    async def close_order(self, dispatch_id: str) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.close()
        if order.vehicle_id:
            v = await self.vehicle_repo.get_by_id(order.vehicle_id)
            if v:
                v.status = VehicleStatus.AVAILABLE
                await self.vehicle_repo.save(v)
        if order.driver_id:
            d = await self.driver_repo.get_by_id(order.driver_id)
            if d:
                d.status = DriverStatus.AVAILABLE
                d.assigned_vehicle_id = None
                await self.driver_repo.save(d)
        return await self.dispatch_repo.save(order)

    async def cancel_order(self, dispatch_id: str) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.cancel()
        return await self.dispatch_repo.save(order)

    async def return_order(self, dispatch_id: str) -> DispatchOrder:
        order = await self._get_or_raise(dispatch_id)
        order.return_order()
        return await self.dispatch_repo.save(order)

    async def get_ready_for_gate_exit(self) -> list[DispatchOrder]:
        return await self.dispatch_repo.get_ready_for_gate_exit()

    async def get_kpis(self) -> dict:
        counts = await self.dispatch_repo.count_by_status()
        drivers = await self.driver_repo.list_all()
        vehicles = await self.vehicle_repo.list_all()

        total_dispatches = sum(counts.values())
        return {
            "todays_dispatches": total_dispatches,
            "pending_dispatches": counts.get("DRAFT", 0),
            "stock_reserved": counts.get("STOCK_RESERVED", 0),
            "picking": counts.get("PICKING_IN_PROGRESS", 0) + counts.get("PICKED", 0),
            "packing": counts.get("PACKING_IN_PROGRESS", 0) + counts.get("PACKED", 0),
            "dispatch_ready": counts.get("ROUTE_ASSIGNED", 0),
            "loading": counts.get("LOADING_STARTED", 0) + counts.get("LOADING_VERIFIED", 0),
            "ready_for_gate_exit": counts.get("READY_FOR_GATE_EXIT", 0),
            "dispatched": counts.get("DISPATCHED", 0),
            "in_transit": counts.get("IN_TRANSIT", 0),
            "delivered": counts.get("DELIVERED", 0),
            "delayed": counts.get("DELAYED", 0),
            "cancelled": counts.get("CANCELLED", 0),
            "driver_kpis": {
                "total": len(drivers),
                "available": sum(1 for d in drivers if d.status == DriverStatus.AVAILABLE),
                "assigned": sum(1 for d in drivers if d.status != DriverStatus.AVAILABLE),
            },
            "vehicle_kpis": {
                "total": len(vehicles),
                "available": sum(1 for v in vehicles if v.status == VehicleStatus.AVAILABLE),
                "assigned": sum(1 for v in vehicles if v.status != VehicleStatus.AVAILABLE),
            },
        }

    async def _get_or_raise(self, dispatch_id: str) -> DispatchOrder:
        order = await self.dispatch_repo.get_by_id(dispatch_id)
        if not order:
            raise ValueError(f"Dispatch order not found: {dispatch_id}")
        return order

    async def list_drivers(self) -> Sequence[Driver]:
        return await self.driver_repo.list_all()

    async def create_driver(self, cmd: CreateDriverCommand) -> DispatchOrder | Driver:
        driver = Driver.create(
            driver_name=cmd.driver_name,
            license_number=cmd.license_number,
            phone=cmd.phone,
            email=cmd.email,
            license_type=cmd.license_type,
            is_active=cmd.is_active,
            photo_path=cmd.photo_path,
            address=cmd.address,
            aadhaar_number=cmd.aadhaar_number,
            rating=cmd.rating,
        )
        return await self.driver_repo.save(driver)

    async def update_driver(self, driver_id: str, cmd: CreateDriverCommand) -> Driver:
        driver = await self.driver_repo.get_by_id(driver_id)
        if not driver:
            raise ValueError(f"Driver not found: {driver_id}")
        driver.driver_name = cmd.driver_name
        driver.license_number = cmd.license_number
        driver.phone = cmd.phone
        driver.email = cmd.email
        driver.license_type = cmd.license_type
        driver.is_active = cmd.is_active
        if cmd.photo_path:
            driver.photo_path = cmd.photo_path
        if cmd.address:
            driver.address = cmd.address
        if cmd.aadhaar_number:
            driver.aadhaar_number = cmd.aadhaar_number
        return await self.driver_repo.save(driver)

    async def delete_driver(self, driver_id: str) -> bool:
        driver = await self.driver_repo.get_by_id(driver_id)
        if not driver:
            raise ValueError(f"Driver not found: {driver_id}")
        return await self.driver_repo.delete(driver_id)

    async def list_vehicles(self) -> Sequence[Vehicle]:
        return await self.vehicle_repo.list_all()

    async def create_vehicle(self, cmd: CreateVehicleCommand) -> DispatchOrder | Vehicle:
        vehicle = Vehicle.create(
            vehicle_number=cmd.vehicle_number,
            vehicle_type=cmd.vehicle_type,
            ownership_type=cmd.ownership_type,
            capacity_tons=cmd.capacity_tons,
            is_active=cmd.is_active,
            insurance_valid=cmd.insurance_valid,
            fitness_valid=cmd.fitness_valid,
            permit_valid=cmd.permit_valid,
            puc_valid=cmd.puc_valid,
            gps_available=cmd.gps_available,
            rc_number=cmd.rc_number,
            chassis_number=cmd.chassis_number,
            registration_date=cmd.registration_date,
            registration_expiry_date=cmd.registration_expiry_date,
            insurance_expiry=cmd.insurance_expiry,
            fitness_expiry=cmd.fitness_expiry,
            permit_expiry=cmd.permit_expiry,
            puc_expiry=cmd.puc_expiry,
            rc_book_number=cmd.rc_book_number,
        )
        return await self.vehicle_repo.save(vehicle)

    async def update_vehicle(self, vehicle_id: str, cmd: CreateVehicleCommand) -> Vehicle:
        vehicle = await self.vehicle_repo.get_by_id(vehicle_id)
        if not vehicle:
            raise ValueError(f"Vehicle not found: {vehicle_id}")
        vehicle.vehicle_number = cmd.vehicle_number
        vehicle.vehicle_type = cmd.vehicle_type
        vehicle.ownership_type = cmd.ownership_type
        vehicle.capacity_tons = cmd.capacity_tons
        vehicle.is_active = cmd.is_active
        vehicle.insurance_valid = cmd.insurance_valid
        vehicle.fitness_valid = cmd.fitness_valid
        vehicle.permit_valid = cmd.permit_valid
        vehicle.puc_valid = cmd.puc_valid
        vehicle.gps_available = cmd.gps_available
        vehicle.rc_number = cmd.rc_number
        vehicle.chassis_number = cmd.chassis_number
        vehicle.registration_date = cmd.registration_date
        vehicle.registration_expiry_date = cmd.registration_expiry_date
        vehicle.insurance_expiry = cmd.insurance_expiry
        vehicle.fitness_expiry = cmd.fitness_expiry
        vehicle.permit_expiry = cmd.permit_expiry
        vehicle.puc_expiry = cmd.puc_expiry
        vehicle.rc_book_number = cmd.rc_book_number
        return await self.vehicle_repo.save(vehicle)

    async def delete_vehicle(self, vehicle_id: str) -> bool:
        vehicle = await self.vehicle_repo.get_by_id(vehicle_id)
        if not vehicle:
            raise ValueError(f"Vehicle not found: {vehicle_id}")
        return await self.vehicle_repo.delete(vehicle_id)
