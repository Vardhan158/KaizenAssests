from __future__ import annotations
from typing import Sequence
from sqlalchemy import func, select, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.events.outbox_repository import to_outbox_row
from app.modules.dispatch.application.repository import (
    DispatchRepository,
    DriverRepository,
    VehicleRepository,
)
from app.modules.dispatch.domain.dispatch import DispatchOrder, DispatchItem, DispatchStatus
from app.modules.dispatch.domain.driver import Driver, DriverStatus
from app.modules.dispatch.domain.vehicle import Vehicle, VehicleStatus
from app.modules.dispatch.infrastructure.persistence.models import (
    DispatchModel,
    DispatchItemModel,
    DriverModel,
    VehicleModel,
)


class SQLAlchemyDispatchRepository(DispatchRepository):
    def __init__(self, session: AsyncSession):
        self._session = session

    async def save(self, order: DispatchOrder) -> DispatchOrder:
        stmt = select(DispatchModel).options(selectinload(DispatchModel.items)).where((DispatchModel.id.cast(String) == str(order.id)) | (DispatchModel.dispatch_number == order.dispatch_number))
        res = await self._session.execute(stmt)
        model = res.scalar_one_or_none()
        if not model:
            model = DispatchModel(id=order.id)
            self._session.add(model)
            existing_items_map = {}
        else:
            existing_items_map = {str(item.id): item for item in (model.items or [])}

        model.dispatch_number = order.dispatch_number
        model.order_number = order.order_number
        model.customer_name = order.customer_name
        model.warehouse_id = order.warehouse_id
        model.dispatch_type = order.dispatch_type
        model.status = order.status.value if isinstance(order.status, DispatchStatus) else str(order.status)
        model.driver_id = order.driver_id
        model.vehicle_id = order.vehicle_id
        model.route_code = order.route_code
        model.delivery_address = order.delivery_address
        model.destination = order.destination
        model.scheduled_date = order.scheduled_date
        model.expected_delivery_date = order.expected_delivery_date
        model.priority = order.priority
        model.contact_person = order.contact_person
        model.contact_phone = order.contact_phone
        model.delivery_instructions = order.delivery_instructions
        model.transport_mode = order.transport_mode
        model.transport_type = order.transport_type
        model.transporter = order.transporter
        model.notes = order.notes
        model.updated_at = order.updated_at

        incoming_item_ids = set()
        for d_item in order.items:
            incoming_item_ids.add(str(d_item.id))
            item_model = existing_items_map.get(str(d_item.id))
            if not item_model:
                item_model = DispatchItemModel(
                    id=d_item.id,
                    dispatch_order_id=model.id,
                )
                self._session.add(item_model)
            item_model.material_code = d_item.material_code
            item_model.material_name = d_item.material_name
            item_model.quantity_ordered = d_item.quantity_ordered
            item_model.quantity_available = d_item.quantity_available
            item_model.quantity_reserved = d_item.quantity_reserved
            item_model.quantity_picked = d_item.quantity_picked
            item_model.quantity_packed = d_item.quantity_packed
            item_model.quantity_loaded = d_item.quantity_loaded
            item_model.quantity_pending = d_item.quantity_pending
            item_model.uom = d_item.uom
            item_model.batch = d_item.batch
            item_model.bin = d_item.bin
            item_model.status = d_item.status

        for item_id, item_model in existing_items_map.items():
            if item_id not in incoming_item_ids:
                await self._session.delete(item_model)

        for event in order.recorded_events:
            self._session.add(to_outbox_row("DispatchOrder", order.id, event))
        order.recorded_events.clear()

        await self._session.flush()
        
        # Reload with items loaded
        stmt_reload = select(DispatchModel).options(selectinload(DispatchModel.items)).where(DispatchModel.id == model.id)
        res_reload = await self._session.execute(stmt_reload)
        reloaded_model = res_reload.scalar_one_or_none()
        return self._to_domain(reloaded_model or model)

    async def get_by_id(self, dispatch_id: str) -> DispatchOrder | None:
        stmt = select(DispatchModel).options(selectinload(DispatchModel.items)).where((DispatchModel.id.cast(String) == str(dispatch_id)) | (DispatchModel.dispatch_number == str(dispatch_id)))
        res = await self._session.execute(stmt)
        model = res.scalar_one_or_none()
        return self._to_domain(model) if model else None

    async def get_by_number(self, dispatch_number: str) -> DispatchOrder | None:
        stmt = select(DispatchModel).options(selectinload(DispatchModel.items)).where(DispatchModel.dispatch_number == dispatch_number)
        res = await self._session.execute(stmt)
        model = res.scalar_one_or_none()
        return self._to_domain(model) if model else None

    async def list_all(
        self,
        status: DispatchStatus | str | None = None,
        warehouse_id: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[DispatchOrder], int]:
        stmt = select(DispatchModel).options(selectinload(DispatchModel.items))
        count_stmt = select(func.count(DispatchModel.id))

        if status:
            st_val = status.value if isinstance(status, DispatchStatus) else str(status)
            stmt = stmt.where(DispatchModel.status == st_val)
            count_stmt = count_stmt.where(DispatchModel.status == st_val)
        if warehouse_id:
            stmt = stmt.where(DispatchModel.warehouse_id == warehouse_id)
            count_stmt = count_stmt.where(DispatchModel.warehouse_id == warehouse_id)

        stmt = stmt.offset(skip).limit(limit).order_by(DispatchModel.created_at.desc())

        count_res = await self._session.execute(count_stmt)
        total = count_res.scalar() or 0

        res = await self._session.execute(stmt)
        models = res.scalars().all()
        return [self._to_domain(m) for m in models], total

    async def get_ready_for_gate_exit(self) -> list[DispatchOrder]:
        stmt = select(DispatchModel).options(selectinload(DispatchModel.items)).where(DispatchModel.status == DispatchStatus.READY_FOR_GATE_EXIT.value)
        res = await self._session.execute(stmt)
        models = res.scalars().all()
        return [self._to_domain(m) for m in models]

    async def count_by_status(self) -> dict[str, int]:
        stmt = select(DispatchModel.status, func.count(DispatchModel.id)).group_by(DispatchModel.status)
        res = await self._session.execute(stmt)
        return {row[0]: row[1] for row in res.all()}

    def _to_domain(self, model: DispatchModel) -> DispatchOrder:
        items = [
            DispatchItem(
                id=str(im.id),
                material_code=im.material_code,
                material_name=im.material_name,
                quantity_ordered=float(im.quantity_ordered),
                quantity_available=float(im.quantity_available),
                quantity_reserved=float(im.quantity_reserved),
                quantity_picked=float(im.quantity_picked),
                quantity_packed=float(im.quantity_packed),
                quantity_loaded=float(im.quantity_loaded),
                quantity_pending=float(im.quantity_pending),
                uom=im.uom,
                batch=im.batch,
                bin=im.bin,
                status=im.status,
            )
            for im in (model.items or [])
        ]
        return DispatchOrder(
            id=str(model.id),
            dispatch_number=model.dispatch_number,
            order_number=model.order_number,
            customer_name=model.customer_name,
            warehouse_id=model.warehouse_id,
            dispatch_type=model.dispatch_type,
            status=DispatchStatus(model.status),
            items=items,
            driver_id=model.driver_id,
            vehicle_id=model.vehicle_id,
            route_code=model.route_code,
            delivery_address=model.delivery_address,
            destination=model.destination,
            scheduled_date=model.scheduled_date,
            expected_delivery_date=model.expected_delivery_date,
            priority=model.priority or "Normal",
            contact_person=model.contact_person,
            contact_phone=model.contact_phone,
            delivery_instructions=model.delivery_instructions,
            transport_mode=model.transport_mode,
            transport_type=model.transport_type,
            transporter=model.transporter,
            notes=model.notes,
            current_location=model.current_location,
            distance_travelled_km=float(model.distance_travelled_km or 0),
            remaining_distance_km=float(model.remaining_distance_km or 0),
            eta_minutes=float(model.eta_minutes or 0),
            route_path=model.route_path,
            route_deviation=model.route_deviation,
            driver_status=model.driver_status,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )


class SQLAlchemyDriverRepository(DriverRepository):
    def __init__(self, session: AsyncSession):
        self._session = session

    async def save(self, driver: Driver) -> Driver:
        model = await self._session.get(DriverModel, driver.id)
        if not model:
            model = DriverModel(id=driver.id)
            self._session.add(model)

        model.driver_name = driver.driver_name
        model.license_number = driver.license_number
        model.phone = driver.phone
        model.email = driver.email
        model.license_type = driver.license_type
        model.is_active = driver.is_active
        model.photo_path = driver.photo_path
        model.address = driver.address
        model.aadhaar_number = driver.aadhaar_number
        model.status = driver.status.value if isinstance(driver.status, DriverStatus) else str(driver.status)
        model.rating = driver.rating
        model.assigned_vehicle_id = driver.assigned_vehicle_id
        model.updated_at = driver.updated_at

        await self._session.flush()
        return self._to_domain(model)

    async def get_by_id(self, driver_id: str) -> Driver | None:
        try:
            model = await self._session.get(DriverModel, driver_id)
            if model:
                return self._to_domain(model)
        except Exception:
            pass
        stmt = select(DriverModel).where((DriverModel.id.cast(String) == driver_id) | (DriverModel.license_number == driver_id) | (DriverModel.driver_name == driver_id))
        res = await self._session.execute(stmt)
        model = res.scalar_one_or_none()
        return self._to_domain(model) if model else None

    async def list_all(self) -> Sequence[Driver]:
        stmt = select(DriverModel)
        res = await self._session.execute(stmt)
        return [self._to_domain(m) for m in res.scalars().all()]

    async def delete(self, driver_id: str) -> bool:
        model = await self._session.get(DriverModel, driver_id)
        if not model:
            return False
        await self._session.delete(model)
        await self._session.flush()
        return True

    def _to_domain(self, model: DriverModel) -> Driver:
        return Driver(
            id=str(model.id),
            driver_name=model.driver_name,
            license_number=model.license_number,
            phone=model.phone,
            email=model.email,
            license_type=model.license_type or "Heavy",
            is_active=bool(model.is_active),
            photo_path=model.photo_path,
            address=model.address,
            aadhaar_number=model.aadhaar_number,
            status=DriverStatus(model.status),
            rating=float(model.rating),
            assigned_vehicle_id=model.assigned_vehicle_id,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )


class SQLAlchemyVehicleRepository(VehicleRepository):
    def __init__(self, session: AsyncSession):
        self._session = session

    async def save(self, vehicle: Vehicle) -> Vehicle:
        model = await self._session.get(VehicleModel, vehicle.id)
        if not model:
            model = VehicleModel(id=vehicle.id)
            self._session.add(model)

        model.vehicle_number = vehicle.vehicle_number
        model.vehicle_type = vehicle.vehicle_type
        model.ownership_type = vehicle.ownership_type
        model.capacity_tons = vehicle.capacity_tons
        model.status = vehicle.status.value if isinstance(vehicle.status, VehicleStatus) else str(vehicle.status)
        model.is_active = vehicle.is_active
        model.insurance_valid = vehicle.insurance_valid
        model.fitness_valid = vehicle.fitness_valid
        model.permit_valid = vehicle.permit_valid
        model.puc_valid = vehicle.puc_valid
        model.gps_available = vehicle.gps_available
        model.rc_number = vehicle.rc_number
        model.chassis_number = vehicle.chassis_number
        model.registration_date = vehicle.registration_date
        model.registration_expiry_date = vehicle.registration_expiry_date
        model.insurance_expiry = vehicle.insurance_expiry
        model.fitness_expiry = vehicle.fitness_expiry
        model.permit_expiry = vehicle.permit_expiry
        model.puc_expiry = vehicle.puc_expiry
        model.rc_book_number = vehicle.rc_book_number
        model.current_driver_id = vehicle.current_driver_id
        model.updated_at = vehicle.updated_at

        await self._session.flush()
        return self._to_domain(model)

    async def get_by_id(self, vehicle_id: str) -> Vehicle | None:
        try:
            model = await self._session.get(VehicleModel, vehicle_id)
            if model:
                return self._to_domain(model)
        except Exception:
            pass
        stmt = select(VehicleModel).where((VehicleModel.id.cast(String) == vehicle_id) | (VehicleModel.vehicle_number == vehicle_id))
        res = await self._session.execute(stmt)
        model = res.scalar_one_or_none()
        return self._to_domain(model) if model else None

    async def list_all(self) -> Sequence[Vehicle]:
        stmt = select(VehicleModel)
        res = await self._session.execute(stmt)
        return [self._to_domain(m) for m in res.scalars().all()]

    async def delete(self, vehicle_id: str) -> bool:
        model = await self._session.get(VehicleModel, vehicle_id)
        if not model:
            return False
        await self._session.delete(model)
        await self._session.flush()
        return True

    def _to_domain(self, model: VehicleModel) -> Vehicle:
        return Vehicle(
            id=str(model.id),
            vehicle_number=model.vehicle_number,
            vehicle_type=model.vehicle_type,
            ownership_type=model.ownership_type or "Owned",
            capacity_tons=float(model.capacity_tons),
            status=VehicleStatus(model.status),
            is_active=bool(model.is_active),
            insurance_valid=bool(model.insurance_valid),
            fitness_valid=bool(model.fitness_valid),
            permit_valid=bool(model.permit_valid),
            puc_valid=bool(model.puc_valid),
            gps_available=bool(model.gps_available),
            rc_number=model.rc_number,
            chassis_number=model.chassis_number,
            registration_date=model.registration_date,
            registration_expiry_date=model.registration_expiry_date,
            insurance_expiry=model.insurance_expiry,
            fitness_expiry=model.fitness_expiry,
            permit_expiry=model.permit_expiry,
            puc_expiry=model.puc_expiry,
            rc_book_number=model.rc_book_number,
            current_driver_id=model.current_driver_id,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )
