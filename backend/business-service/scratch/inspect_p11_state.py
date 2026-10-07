import asyncio
from sqlalchemy import select, or_
from app.database.session import AsyncSessionFactory
from app.modules.assembly.infrastructure.persistence.models import (
    AssemblyOrderModel, AssemblyFinishedGoodsModel, AssemblyQualityInspectionModel,
    AssemblyMaterialConsumptionModel, AssemblyTeamModel
)
from app.modules.procurement.infrastructure.persistence.models import (
    FinishedGoodsRequestModel, MaterialRequestModel, PickTaskModel, MaterialIssueModel
)
from app.modules.storage.infrastructure.persistence.models import (
    PutawayTaskModel, HandlingUnitModel, PutawayMovementModel
)
from app.modules.store.infrastructure.persistence.models import StoreModel

from sqlalchemy.orm import selectinload

async def inspect_state():
    async with AsyncSessionFactory() as session:
        # Check FGR
        fgr = await session.scalar(select(FinishedGoodsRequestModel).where(
            FinishedGoodsRequestModel.request_number == "FGR-20260924-0001"
        ))
        print("FGR:", fgr.request_number if fgr else None, "ID:", fgr.id if fgr else None, "Status:", fgr.status if fgr else None, "Qty:", fgr.quantity if fgr else None)
        
        # Check MR / AR
        mrs = (await session.execute(
            select(MaterialRequestModel).options(selectinload(MaterialRequestModel.items)).where(
                or_(
                    MaterialRequestModel.request_number.ilike("%AR-2026-0002%"),
                    MaterialRequestModel.request_number.ilike("%MR-202609-0001%"),
                    MaterialRequestModel.remarks.ilike("%FGR-20260924-0001%"),
                    MaterialRequestModel.remarks.ilike("%AR-2026-0002%")
                )
            )
        )).scalars().all()
        for mr in mrs:
            print("MR:", mr.request_number, "ID:", mr.id, "Status:", mr.status, "Remarks:", mr.remarks)
            for item in mr.items or []:
                print("  Item:", item.material_code, item.material_name, item.quantity, item.uom)

        # Check Pick Tasks
        picks = (await session.execute(select(PickTaskModel))).scalars().all()
        for p in picks:
            if "2026" in p.task_number or (p.request_number and "2026" in p.request_number):
                print("PickTask:", p.task_number, "Req:", p.request_number, "Status:", p.status, "Dest:", p.destination)

        # Check Material Issues
        issues = (await session.execute(select(MaterialIssueModel))).scalars().all()
        for iss in issues:
            if "2026" in iss.issue_number or (iss.request_id and any(iss.request_id == mr.id for mr in mrs)):
                print("Issue:", iss.issue_number, "Status:", iss.status, "IssuedBy:", iss.issued_by, "Items count:", len(iss.items or []))

        # Check Assembly Orders
        orders = (await session.execute(select(AssemblyOrderModel))).scalars().all()
        for ord in orders:
            print("AssemblyOrder:", ord.order_number, "Prod:", ord.product_name, "Req:", ord.request_number, "Status:", ord.status, "Planned:", ord.planned_quantity, "Completed:", ord.completed_quantity)

        # Check FG Store
        stores = (await session.execute(select(StoreModel))).scalars().all()
        for s in stores:
            print("Store:", s.store_code, s.store_name, s.store_type, s.status, s.id)

        # Check Teams
        teams = (await session.execute(select(AssemblyTeamModel))).scalars().all()
        for t in teams:
            print("Team:", t.name, "Active:", t.active, "Leader:", t.team_leader)

if __name__ == "__main__":
    asyncio.run(inspect_state())
