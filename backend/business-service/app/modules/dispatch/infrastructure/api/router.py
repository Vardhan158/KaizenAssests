import uuid
import datetime
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.persistence.models import NotificationModel
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
from app.modules.dispatch.application.use_cases import DispatchUseCases
from app.modules.dispatch.infrastructure.persistence.repository_impl import (
    SQLAlchemyDispatchRepository,
    SQLAlchemyDriverRepository,
    SQLAlchemyVehicleRepository,
)
from app.modules.dispatch.infrastructure.persistence.models import DriverModel, VehicleModel
from app.modules.dispatch.infrastructure.api.schemas import (
    DispatchOrderResponse,
    DispatchItemResponse,
    DispatchListResponse,
    DriverResponse,
    VehicleResponse,
)
from app.security.dependencies import get_current_user, CurrentUser

router = APIRouter(tags=["Finished Goods Dispatch"])


def _to_dispatch_dto(o, *, driver_name: str | None = None, vehicle_number: str | None = None) -> DispatchOrderResponse:
    items = [
        DispatchItemResponse(
            id=i.id,
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
            status=i.status,
        )
        for i in o.items
    ]
    return DispatchOrderResponse(
        id=o.id,
        dispatch_number=o.dispatch_number,
        order_number=o.order_number,
        customer_name=o.customer_name,
        warehouse_id=o.warehouse_id,
        status=o.status.value if hasattr(o.status, "value") else str(o.status),
        items=items,
        driver_id=o.driver_id,
        driver_name=driver_name,
        vehicle_id=o.vehicle_id,
        vehicle_number=vehicle_number,
        route_code=o.route_code,
        delivery_address=o.delivery_address,
        destination=o.destination,
        scheduled_date=o.scheduled_date,
        expected_delivery_date=o.expected_delivery_date,
        priority=o.priority,
        notes=o.notes,
        current_location=o.current_location,
        distance_travelled_km=o.distance_travelled_km,
        remaining_distance_km=o.remaining_distance_km,
        eta_minutes=o.eta_minutes,
        route_path=o.route_path,
        route_deviation=o.route_deviation,
        driver_status=o.driver_status,
        created_at=o.created_at,
        updated_at=o.updated_at,
    )


def _to_driver_dto(d) -> DriverResponse:
    return DriverResponse(
        id=d.id,
        driver_name=d.driver_name,
        license_number=d.license_number,
        phone=d.phone,
        email=d.email,
        license_type=d.license_type,
        is_active=d.is_active,
        photo_path=d.photo_path,
        address=d.address,
        aadhaar_number=d.aadhaar_number,
        status=d.status.value if hasattr(d.status, "value") else str(d.status),
        rating=d.rating,
        assigned_vehicle_id=d.assigned_vehicle_id,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


def _to_vehicle_dto(v) -> VehicleResponse:
    return VehicleResponse(
        id=v.id,
        vehicle_number=v.vehicle_number,
        vehicle_type=v.vehicle_type,
        ownership_type=v.ownership_type,
        capacity_tons=v.capacity_tons,
        rc_number=v.rc_number,
        chassis_number=v.chassis_number,
        registration_date=v.registration_date,
        registration_expiry_date=v.registration_expiry_date,
        insurance_expiry=v.insurance_expiry,
        fitness_expiry=v.fitness_expiry,
        permit_expiry=v.permit_expiry,
        puc_expiry=v.puc_expiry,
        rc_book_number=v.rc_book_number,
        insurance_valid=v.insurance_valid,
        fitness_valid=v.fitness_valid,
        permit_valid=v.permit_valid,
        puc_valid=v.puc_valid,
        gps_available=v.gps_available,
        is_active=v.is_active,
        status=v.status.value if hasattr(v.status, "value") else str(v.status),
        current_driver_id=v.current_driver_id,
        created_at=v.created_at,
        updated_at=v.updated_at,
    )


def _get_use_cases(db: AsyncSession) -> DispatchUseCases:
    return DispatchUseCases(
        SQLAlchemyDispatchRepository(db),
        SQLAlchemyDriverRepository(db),
        SQLAlchemyVehicleRepository(db),
    )


async def _dispatch_party_names(db: AsyncSession, orders) -> tuple[dict[str, str], dict[str, str]]:
    driver_ids = {str(order.driver_id) for order in orders if order.driver_id}
    vehicle_ids = {str(order.vehicle_id) for order in orders if order.vehicle_id}
    drivers: dict[str, str] = {}
    vehicles: dict[str, str] = {}
    if driver_ids:
        result = await db.execute(select(DriverModel).where(DriverModel.id.cast(String).in_(driver_ids)))
        drivers = {str(driver.id): driver.driver_name for driver in result.scalars().all()}
    if vehicle_ids:
        result = await db.execute(select(VehicleModel).where(VehicleModel.id.cast(String).in_(vehicle_ids)))
        vehicles = {str(vehicle.id): vehicle.vehicle_number for vehicle in result.scalars().all()}
    return drivers, vehicles


@router.get("/api/dispatches/ready-for-gate-exit", response_model=list[DispatchOrderResponse])
async def get_ready_for_gate_exit(
    db: Annotated[AsyncSession, Depends(get_db)],
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = Query(None),
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    if status_filter and status_filter.upper() != "READY_FOR_GATE_EXIT":
        orders, _ = await uc.list_dispatches(
            status=None if status_filter.upper() == "ALL" else status_filter.upper(),
            skip=0,
            limit=200,
        )
    else:
        orders = await uc.get_ready_for_gate_exit()
    if search:
        needle = search.strip().lower()
        orders = [order for order in orders if any(
            needle in str(value or "").lower()
            for value in (order.dispatch_number, order.order_number, order.customer_name)
        )]
    driver_ids = {str(order.driver_id) for order in orders if order.driver_id}
    vehicle_ids = {str(order.vehicle_id) for order in orders if order.vehicle_id}

    drivers = {}
    if driver_ids:
        result = await db.execute(select(DriverModel).where(DriverModel.id.cast(String).in_(driver_ids)))
        drivers = {str(driver.id): driver.driver_name for driver in result.scalars().all()}

    vehicles = {}
    if vehicle_ids:
        result = await db.execute(select(VehicleModel).where(VehicleModel.id.cast(String).in_(vehicle_ids)))
        vehicles = {str(vehicle.id): vehicle.vehicle_number for vehicle in result.scalars().all()}

    return [
        _to_dispatch_dto(
            order,
            driver_name=drivers.get(str(order.driver_id)) if order.driver_id else None,
            vehicle_number=vehicles.get(str(order.vehicle_id)) if order.vehicle_id else None,
        )
        for order in orders
    ]


@router.get("/api/dispatches/kpis", response_model=dict)
async def get_dispatch_kpis(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    return await uc.get_kpis()


@router.get("/api/dispatches", response_model=DispatchListResponse)
async def list_dispatches(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
    status_filter: str | None = Query(None, alias="status"),
    warehouse_id: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    uc = _get_use_cases(db)
    items, total = await uc.list_dispatches(status=status_filter, warehouse_id=warehouse_id, skip=skip, limit=limit)
    drivers, vehicles = await _dispatch_party_names(db, items)
    return DispatchListResponse(
        items=[_to_dispatch_dto(o, driver_name=drivers.get(str(o.driver_id)), vehicle_number=vehicles.get(str(o.vehicle_id))) for o in items],
        total=total,
    )


@router.post("/api/dispatches", response_model=DispatchOrderResponse, status_code=status.HTTP_201_CREATED)
async def create_dispatch(
    cmd: CreateDispatchCommand,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.create_dispatch(cmd)
        db.add(NotificationModel(
            id=uuid.uuid4(),
            user_role="DISPATCH",
            title="Dispatch Order Created",
            message=f"New Dispatch Order {order.dispatch_number} created for {order.customer_name} (Order Ref: {order.order_number}).",
            link="/dispatch-orders",
            created_at=datetime.datetime.now(),
        ))
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/api/dispatches/{dispatch_id}", response_model=DispatchOrderResponse)
async def get_dispatch(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    order = await uc.get_dispatch(dispatch_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispatch order not found")
    drivers, vehicles = await _dispatch_party_names(db, [order])
    return _to_dispatch_dto(order, driver_name=drivers.get(str(order.driver_id)), vehicle_number=vehicles.get(str(order.vehicle_id)))


@router.post("/api/dispatches/{dispatch_id}/reserve-stock", response_model=DispatchOrderResponse)
async def reserve_dispatch_stock(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.reserve_stock(dispatch_id)
        db.add(NotificationModel(
            id=uuid.uuid4(),
            user_role="DISPATCH",
            title="Stock Reserved",
            message=f"Stock reserved successfully for Dispatch Order {order.dispatch_number}.",
            link="/dispatch-orders",
            created_at=datetime.datetime.now(),
        ))
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/picking", response_model=DispatchOrderResponse)
async def start_dispatch_picking(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.start_picking(dispatch_id)
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/pick-items", response_model=DispatchOrderResponse)
async def pick_dispatch_items(
    dispatch_id: str,
    cmd: PickItemsCommand,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.pick_items(dispatch_id, cmd)
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/pack", response_model=DispatchOrderResponse)
async def start_dispatch_packing(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.start_packing(dispatch_id)
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/pack-items", response_model=DispatchOrderResponse)
async def pack_dispatch_items(
    dispatch_id: str,
    cmd: PackItemsCommand,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.pack_items(dispatch_id, cmd)
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/driver", response_model=DispatchOrderResponse)
async def allocate_dispatch_driver(
    dispatch_id: str,
    cmd: AllocateDriverCommand,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.allocate_driver(dispatch_id, cmd)
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/vehicle", response_model=DispatchOrderResponse)
async def allocate_dispatch_vehicle(
    dispatch_id: str,
    cmd: AllocateVehicleCommand,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.allocate_vehicle(dispatch_id, cmd)
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/route", response_model=DispatchOrderResponse)
async def assign_dispatch_route(
    dispatch_id: str,
    cmd: AssignRouteCommand,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.assign_route(dispatch_id, cmd)
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/loading/start", response_model=DispatchOrderResponse)
async def start_dispatch_loading(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.start_loading(dispatch_id)
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/loading/verify", response_model=DispatchOrderResponse)
async def verify_dispatch_loading(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.verify_loading(dispatch_id)
        db.add(NotificationModel(
            id=uuid.uuid4(),
            user_role="DISPATCH",
            title="Loading Verified",
            message=f"Loading verified for Dispatch Order {order.dispatch_number}. Ready for Gate Exit.",
            link="/dispatch-loading",
            created_at=datetime.datetime.now(),
        ))
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/verify", response_model=DispatchOrderResponse)
async def verify_dispatch_final(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.verify_final(dispatch_id)
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/dispatch", response_model=DispatchOrderResponse)
async def dispatch_order(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.dispatch_order(dispatch_id)
        db.add(NotificationModel(
            id=uuid.uuid4(),
            user_role="DISPATCH",
            title="Gate Out Approved",
            message=f"Outbound gate exit authorized for Dispatch Order {order.dispatch_number}.",
            link="/dispatch-gate-out",
            created_at=datetime.datetime.now(),
        ))
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/transit", response_model=DispatchOrderResponse)
async def transit_order(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.transit_order(dispatch_id)
        db.add(NotificationModel(
            id=uuid.uuid4(),
            user_role="DISPATCH",
            title="Shipment In Transit",
            message=f"Shipment {order.dispatch_number} is now In Transit to {order.destination}.",
            link="/dispatch-transit",
            created_at=datetime.datetime.now(),
        ))
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/deliver", response_model=DispatchOrderResponse)
async def deliver_order(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.deliver_order(dispatch_id)
        db.add(NotificationModel(
            id=uuid.uuid4(),
            user_role="DISPATCH",
            title="Delivery Completed",
            message=f"Shipment {order.dispatch_number} delivered to {order.customer_name}.",
            link="/dispatch-transit",
            created_at=datetime.datetime.now(),
        ))
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/close", response_model=DispatchOrderResponse)
async def close_order(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.close_order(dispatch_id)
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/cancel", response_model=DispatchOrderResponse)
async def cancel_order(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.cancel_order(dispatch_id)
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/api/dispatches/{dispatch_id}/return", response_model=DispatchOrderResponse)
async def return_order(
    dispatch_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        order = await uc.return_order(dispatch_id)
        await db.commit()
        return _to_dispatch_dto(order)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/api/drivers", response_model=list[DriverResponse])
async def list_drivers(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    drivers = await uc.list_drivers()
    return [_to_driver_dto(d) for d in drivers]


@router.post("/api/drivers", response_model=DriverResponse, status_code=status.HTTP_201_CREATED)
async def create_driver(
    cmd: CreateDriverCommand,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        driver = await uc.create_driver(cmd)
        await db.commit()
        return _to_driver_dto(driver)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.put("/api/drivers/{driver_id}", response_model=DriverResponse)
async def update_driver(
    driver_id: str,
    cmd: CreateDriverCommand,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        driver = await uc.update_driver(driver_id, cmd)
        await db.commit()
        return _to_driver_dto(driver)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/api/drivers/{driver_id}")
async def delete_driver(
    driver_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        await uc.delete_driver(driver_id)
        await db.commit()
        return {"status": "success", "message": f"Driver {driver_id} deleted"}
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/api/vehicles", response_model=list[VehicleResponse])
async def list_vehicles(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    vehicles = await uc.list_vehicles()
    return [_to_vehicle_dto(v) for v in vehicles]


@router.post("/api/vehicles", response_model=VehicleResponse, status_code=status.HTTP_201_CREATED)
async def create_vehicle(
    cmd: CreateVehicleCommand,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        vehicle = await uc.create_vehicle(cmd)
        await db.commit()
        return _to_vehicle_dto(vehicle)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.put("/api/vehicles/{vehicle_id}", response_model=VehicleResponse)
async def update_vehicle(
    vehicle_id: str,
    cmd: CreateVehicleCommand,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        vehicle = await uc.update_vehicle(vehicle_id, cmd)
        await db.commit()
        return _to_vehicle_dto(vehicle)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/api/vehicles/{vehicle_id}")
async def delete_vehicle(
    vehicle_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    uc = _get_use_cases(db)
    try:
        await uc.delete_vehicle(vehicle_id)
        await db.commit()
        return {"status": "success", "message": f"Vehicle {vehicle_id} deleted"}
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

