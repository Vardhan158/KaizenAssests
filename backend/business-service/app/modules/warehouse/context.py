"""The application has exactly one warehouse, shared by operational users."""
from sqlalchemy import select
from app.modules.warehouse.infrastructure.persistence.models import WarehouseModel


async def warehouse_context(session):
    warehouse = await session.scalar(select(WarehouseModel).where(WarehouseModel.status == "ACTIVE"))
    if warehouse is None:
        return set(), set()
    return {warehouse.id}, {warehouse.warehouse_code}
