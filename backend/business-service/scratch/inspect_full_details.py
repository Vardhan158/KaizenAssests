import asyncio
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload
from app.database.session import AsyncSessionFactory
from app.modules.assembly.infrastructure.persistence.models import (
    AssemblyOrderModel, AssemblyFinishedGoodsModel, AssemblyQualityInspectionModel,
    AssemblyMaterialConsumptionModel, AssemblyTeamModel
)
from app.modules.procurement.infrastructure.persistence.models import (
    FinishedGoodsRequestModel, MaterialRequestModel, PickTaskModel, MaterialIssueModel
)
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionModel, AssemblyStockReservationModel, InventoryIssueTransactionModel,
    PickupTaskModel, PutawayTaskModel, HandlingUnitModel, PutawayMovementModel
)
from app.modules.store.infrastructure.persistence.models import StoreModel

async def inspect_full_details():
    async with AsyncSessionFactory() as session:
        # 1. AR
        ar = await session.scalar(
            select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(AssemblyRequisitionModel.requisition_number == "AR-2026-0002")
        )
        if ar:
            print(f"AR found: {ar.requisition_number}, ID: {ar.id}, Status: {ar.status}, Remarks: {ar.remarks}, ReqDate: {ar.required_date}")
            for it in ar.items or []:
                print(f"  Item: {it.material_code} ({it.material_name}) - Req: {it.requested_quantity}, Issued: {it.issued_quantity}")

        # 2. Pickup tasks
        pickup_tasks = (await session.execute(
            select(PickupTaskModel).where(
                or_(PickupTaskModel.requisition_id == (ar.id if ar else None), PickupTaskModel.requisition_number == "AR-2026-0002")
            )
        )).scalars().all()
        print(f"Pickup tasks for AR: {len(pickup_tasks)}")
        for pt in pickup_tasks:
            print(f"  PT: {pt.task_number} - {pt.material_code}: Req={pt.requested_quantity}, Picked={pt.picked_quantity}, Status={pt.status}")

        # 3. Issue transactions
        issue_txs = (await session.execute(
            select(InventoryIssueTransactionModel).where(
                or_(InventoryIssueTransactionModel.requisition_id == (ar.id if ar else None), InventoryIssueTransactionModel.requisition_number == "AR-2026-0002")
            )
        )).scalars().all()
        print(f"Issue transactions for AR: {len(issue_txs)}")
        for itx in issue_txs:
            print(f"  IssueTX: {itx.issue_number} - {itx.material_code}: Qty={itx.quantity}, Store={itx.store_code}")

        # 4. Assembly Orders
        orders = (await session.execute(select(AssemblyOrderModel))).scalars().all()
        print(f"Total Assembly Orders in DB: {len(orders)}")
        for o in orders:
            print(f"  Order: {o.order_number}, Prod: {o.product_name}, Status: {o.status}, Planned: {o.planned_quantity}, Completed: {o.completed_quantity}, ReqNo: {o.request_number}")

        # 5. Finished Goods
        fgs = (await session.execute(select(AssemblyFinishedGoodsModel))).scalars().all()
        print(f"Total Finished Goods in DB: {len(fgs)}")
        for fg in fgs:
            print(f"  FG: {fg.product_code} ({fg.product_name}), Qty: {fg.quantity}, QR: {fg.qr_code}, Status: {fg.status}")

        # 6. Putaway Tasks
        putaways = (await session.execute(select(PutawayTaskModel))).scalars().all()
        print(f"Total Putaway Tasks in DB: {len(putaways)}")
        for p in putaways:
            print(f"  PUT: {p.task_number}, Item: {p.item_code}, Qty: {p.quantity}, Status: {p.status}, FG_ID: {p.finished_goods_id}")

        # 7. Motor Handling Units / Movements / GRN
        motor_hus = (await session.execute(
            select(HandlingUnitModel).where(HandlingUnitModel.item_code == "MAT-MOTOR-001")
        )).scalars().all()
        print(f"Handling Units for MAT-MOTOR-001: {len(motor_hus)}")
        for hu in motor_hus:
            print(f"  HU: {hu.barcode_value}, GRN: {hu.grn_number}, Batch: {hu.batch_number}, Loc: {hu.current_location}")

        motor_movs = (await session.execute(
            select(PutawayMovementModel).where(PutawayMovementModel.material_code == "MAT-MOTOR-001")
        )).scalars().all()
        print(f"Movements for MAT-MOTOR-001: {len(motor_movs)}")
        for m in motor_movs:
            print(f"  Mov: {m.movement_id}, Task: {m.task_id}, Dest: {m.destination_location}, Batch: {m.batch_lot}")

if __name__ == "__main__":
    asyncio.run(inspect_full_details())
