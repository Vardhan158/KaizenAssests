import pytest
import uuid
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.database.base import Base
from app.modules.dock.application.service import DockAllocationService
from app.modules.dock.domain.enums import AllocationStatus, DockStatus, DockType
from app.modules.dock.infrastructure.persistence.models import (
    DockMasterModel,
    DockAllocationRequestModel,
    DockAllocationHistoryModel,
    DockStatusHistoryModel,
)
# Ensure models are imported
from app.modules.procurement.infrastructure.persistence.models import NotificationModel
import app.modules.receiving.infrastructure.persistence.models  # noqa
import app.modules.gate.infrastructure.persistence.models  # noqa


from app.database.session import AsyncSessionFactory, engine
from sqlalchemy import update, delete


@pytest.fixture
async def async_session():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionFactory() as session:
        # Reset tables and seed test docks
        await session.execute(delete(DockStatusHistoryModel))
        await session.execute(delete(DockAllocationHistoryModel))
        await session.execute(delete(DockAllocationRequestModel))
        await session.execute(delete(DockMasterModel))
        await session.execute(delete(NotificationModel))
        await session.commit()

        await DockAllocationService.seed_default_docks_if_empty(session)
        from app.modules.gate.infrastructure.persistence.models import GateEntryModel
        await session.execute(update(GateEntryModel).values(status="GATE_EXIT_COMPLETED"))
        await session.commit()

        yield session

        await session.execute(update(GateEntryModel).values(status="GATE_EXIT_COMPLETED"))
        await session.execute(update(DockMasterModel).values(status="AVAILABLE"))
        await session.execute(delete(DockStatusHistoryModel))
        await session.execute(delete(DockAllocationHistoryModel))
        await session.execute(delete(DockAllocationRequestModel))
        await session.commit()




@pytest.mark.asyncio
async def test_seed_and_get_overview_metrics(async_session):
    await DockAllocationService.seed_default_docks_if_empty(async_session)
    metrics = await DockAllocationService.get_overview_metrics(async_session)
    assert metrics["total_docks"] == 9
    assert metrics["available_docks"] == 9
    assert metrics["occupied_docks"] == 0
    assert metrics["reserved_docks"] == 0
    assert metrics["pending_allocations_count"] == 0

    docks = await DockAllocationService.list_docks(async_session)
    types_found = {d.dock_type for d in docks}
    assert "RAW_MATERIAL" in types_found
    assert "CHEMICAL_HAZARDOUS" in types_found
    assert "ELECTRICAL" in types_found
    assert "ELECTRONICS" in types_found
    assert "MAIN_RECEIVING" in types_found


@pytest.mark.asyncio
async def test_dock_type_filtering(async_session):
    await DockAllocationService.seed_default_docks_if_empty(async_session)
    rm_docks = await DockAllocationService.list_docks(async_session, dock_type="RAW_MATERIAL")
    assert len(rm_docks) == 2
    for d in rm_docks:
        assert d.dock_type == "RAW_MATERIAL"

    chem_haz_docks = await DockAllocationService.list_docks(async_session, dock_type="CHEMICAL_HAZARDOUS")
    assert len(chem_haz_docks) == 2

    elec_docks = await DockAllocationService.list_docks(async_session, dock_type="ELECTRICAL")
    assert len(elec_docks) == 2

    electronics_docks = await DockAllocationService.list_docks(async_session, dock_type="ELECTRONICS")
    assert len(electronics_docks) == 2

    mr_docks = await DockAllocationService.list_docks(async_session, dock_type="MAIN_RECEIVING")
    assert len(mr_docks) == 1


@pytest.mark.asyncio
async def test_auto_create_allocation_request_idempotent(async_session):
    req1 = await DockAllocationService.auto_create_allocation_request(
        session=async_session,
        gate_pass_id="GP-2026-00100",
        vehicle_number="KA01AB1234",
        vendor_reference="ABC Industries",
        material_reference="Copper Wire",
        material_description="500 KG Copper Wire",
        quantity=Decimal("500.0"),
        priority="NORMAL",
    )
    assert req1.existing_gate_pass_id == "GP-2026-00100"
    assert req1.status in ["PENDING", "PENDING_ALLOCATION", "AWAITING_DOCK"]

    # Idempotent call with same gate pass ID should return exact same object
    req2 = await DockAllocationService.auto_create_allocation_request(
        session=async_session,
        gate_pass_id="GP-2026-00100",
        vehicle_number="KA01AB1234",
        vendor_reference="ABC Industries",
    )
    assert req2.id == req1.id

    # Verify no pre-allocation notification was sent during request creation
    from app.modules.procurement.infrastructure.persistence.models import NotificationModel
    notifs = (await async_session.execute(select(NotificationModel).where(NotificationModel.user_role == "WAREHOUSE"))).scalars().all()
    assert len(notifs) == 0


@pytest.mark.asyncio
async def test_dock_allocation_lifecycle(async_session):
    # 1. Seed docks
    await DockAllocationService.seed_default_docks_if_empty(async_session)
    docks = await DockAllocationService.list_docks(async_session)
    dock1 = docks[0]  # RM-01

    # 2. Create allocation request
    req = await DockAllocationService.auto_create_allocation_request(
        session=async_session,
        gate_pass_id="GP-2026-00200",
        vehicle_number="KA05CD9876",
        vendor_reference="XYZ Steel",
        material_reference="Steel Plates",
        quantity=Decimal("2000.0"),
        priority="URGENT",
    )

    # 3. Allocate Dock RM-01
    allocated = await DockAllocationService.allocate_dock(
        session=async_session,
        allocation_request_id=req.id,
        dock_id=dock1.id,
        allocated_by="Warehouse Manager",
    )
    assert allocated.status == "DOCK_ASSIGNED"
    assert allocated.assigned_dock_id == dock1.id

    updated_dock = (await async_session.execute(select(DockMasterModel).where(DockMasterModel.id == dock1.id))).scalar_one()
    assert updated_dock.status == DockStatus.RESERVED.value

    # Attempting to release dock while RESERVED must fail with HTTP 400
    with pytest.raises(HTTPException) as exc_info:
        await DockAllocationService.release_dock(
            session=async_session,
            allocation_request_id=req.id,
            performed_by="Warehouse Manager",
        )
    assert exc_info.value.status_code == 400
    assert "Dock can only be released when it is OCCUPIED" in exc_info.value.detail

    # 4. Mark Vehicle Arrived (RESERVED -> OCCUPIED)
    arrived = await DockAllocationService.mark_vehicle_arrived(
        session=async_session,
        allocation_request_id=req.id,
        performed_by="Warehouse Manager",
    )
    assert arrived.status == "OCCUPIED"
    assert arrived.arrived_at is not None

    updated_dock = (await async_session.execute(select(DockMasterModel).where(DockMasterModel.id == dock1.id))).scalar_one()
    assert updated_dock.status == DockStatus.OCCUPIED.value

    # 5. Start receiving
    started = await DockAllocationService.start_receiving(
        session=async_session,
        allocation_request_id=req.id,
        performed_by="Warehouse Manager",
    )
    assert started.started_at is not None

    # 6. Complete receiving
    completed = await DockAllocationService.complete_receiving(
        session=async_session,
        allocation_request_id=req.id,
        performed_by="Warehouse Manager",
    )
    assert completed.status == AllocationStatus.COMPLETED.value
    assert completed.completed_at is not None

    # 7. Release Dock (OCCUPIED -> AVAILABLE)
    released = await DockAllocationService.release_dock(
        session=async_session,
        allocation_request_id=req.id,
        performed_by="Warehouse Manager",
    )
    assert released.status == AllocationStatus.RELEASED.value
    assert released.released_at is not None

    updated_dock = (await async_session.execute(select(DockMasterModel).where(DockMasterModel.id == dock1.id))).scalar_one()
    assert updated_dock.status == DockStatus.AVAILABLE.value


@pytest.mark.asyncio
async def test_dock_notifications_on_allocation(async_session):
    await DockAllocationService.seed_default_docks_if_empty(async_session)
    docks = await DockAllocationService.list_docks(async_session)
    dock1 = docks[0]  # RM-01

    req = await DockAllocationService.auto_create_allocation_request(
        session=async_session,
        gate_pass_id="GP-2026-00125",
        vehicle_number="KA01AB1234",
        vendor_reference="ABC Industries",
    )

    await DockAllocationService.allocate_dock(
        session=async_session,
        allocation_request_id=req.id,
        dock_id=dock1.id,
        allocated_by="Warehouse Manager",
    )

    # Check notification records in session
    from app.modules.procurement.infrastructure.persistence.models import NotificationModel

    notifs = (await async_session.execute(select(NotificationModel).where(NotificationModel.link.like(f"%{req.id}%")))).scalars().all()
    roles_notified = {n.user_role for n in notifs}
    assert "WAREHOUSE" in roles_notified
    assert "QUALITY_INSPECTOR" in roles_notified
    assert "STORE_MANAGER" in roles_notified

    qi_notif = next(n for n in notifs if n.user_role == "QUALITY_INSPECTOR")
    assert qi_notif.title == "DOCK ALLOCATION CONFIRMED"
    assert "GP-2026-00125" in qi_notif.message
    assert "KA01AB1234" in qi_notif.message
    assert "Proceed directly to Dock" in qi_notif.message
    assert qi_notif.dock_code == dock1.dock_code
    assert qi_notif.gate_pass_number == "GP-2026-00125"

    sm_notif = next(n for n in notifs if n.user_role == "STORE_MANAGER")
    assert sm_notif.title == "DOCK ALLOCATION CONFIRMED"
    assert "GP-2026-00125" in sm_notif.message
    assert "KA01AB1234" in sm_notif.message


@pytest.mark.asyncio
async def test_conflict_on_already_reserved_dock(async_session):
    await DockAllocationService.seed_default_docks_if_empty(async_session)
    docks = await DockAllocationService.list_docks(async_session)
    dock1 = docks[0]  # RM-01

    req1 = await DockAllocationService.auto_create_allocation_request(
        session=async_session,
        gate_pass_id="GP-2026-00301",
        vehicle_number="KA01AA1111",
    )
    req2 = await DockAllocationService.auto_create_allocation_request(
        session=async_session,
        gate_pass_id="GP-2026-00302",
        vehicle_number="KA01BB2222",
    )

    # Manager A allocates dock1
    await DockAllocationService.allocate_dock(
        session=async_session,
        allocation_request_id=req1.id,
        dock_id=dock1.id,
        allocated_by="Manager A",
    )

    # Manager B attempts to allocate the exact same dock1 -> must fail with 409 conflict
    with pytest.raises(HTTPException) as exc_info:
        await DockAllocationService.allocate_dock(
            session=async_session,
            allocation_request_id=req2.id,
            dock_id=dock1.id,
            allocated_by="Manager B",
        )
    assert exc_info.value.status_code == 409
    assert "no longer available" in exc_info.value.detail


@pytest.mark.asyncio
async def test_dock_reassignment(async_session):
    await DockAllocationService.seed_default_docks_if_empty(async_session)
    docks = await DockAllocationService.list_docks(async_session)
    dock1 = docks[0]  # RM-01
    dock2 = docks[1]  # RM-02

    req = await DockAllocationService.auto_create_allocation_request(
        session=async_session,
        gate_pass_id="GP-2026-00400",
        vehicle_number="KA01CC3333",
    )

    await DockAllocationService.allocate_dock(
        session=async_session,
        allocation_request_id=req.id,
        dock_id=dock1.id,
        allocated_by="Manager",
    )

    # Reassign from RM-01 to RM-02
    await DockAllocationService.reassign_dock(
        session=async_session,
        allocation_request_id=req.id,
        new_dock_id=dock2.id,
        reassigned_by="Manager",
        reason="Maintenance on RM-01",
    )

    d1 = (await async_session.execute(select(DockMasterModel).where(DockMasterModel.id == dock1.id))).scalar_one()
    d2 = (await async_session.execute(select(DockMasterModel).where(DockMasterModel.id == dock2.id))).scalar_one()
    assert d1.status == DockStatus.AVAILABLE.value
    assert d2.status == DockStatus.RESERVED.value
