from decimal import Decimal
import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.receiving.infrastructure.persistence.models import GrnLineModel, GrnModel
from app.modules.storage.infrastructure.persistence.models import PutawayMovementModel, PutawayTaskModel


async def validate_grn_putaway_quantity(
    session: AsyncSession, grn_id: uuid.UUID | None, item_code: str, quantity: Decimal,
) -> None:
    """Cap all batches/tasks for a GRN material at its accepted quantity."""
    if grn_id is None:
        return  # Finished goods tasks have no source GRN.
    # Serialize different tasks/batches from the same receipt as well as
    # repeated confirmations of a single task.
    grn = await session.scalar(
        select(GrnModel.id).where(GrnModel.id == grn_id).with_for_update()
    )
    if grn is None:
        raise HTTPException(status_code=409, detail="Source GRN was not found")
    accepted = await session.scalar(
        select(func.sum(func.coalesce(
            func.nullif(GrnLineModel.accepted_quantity, 0),
            func.nullif(GrnLineModel.quality_approved_quantity, 0),
            GrnLineModel.good_quantity,
            0,
        ))).where(
            GrnLineModel.grn_id == grn_id,
            func.upper(GrnLineModel.item_code) == item_code.upper(),
        )
    )
    if accepted is None:
        raise HTTPException(status_code=409, detail="Source GRN material was not found")
    stored = await session.scalar(
        select(func.coalesce(func.sum(PutawayMovementModel.confirmed_quantity), 0))
        .join(PutawayTaskModel, PutawayTaskModel.id == PutawayMovementModel.putaway_task_id)
        .where(
            PutawayTaskModel.grn_id == grn_id,
            func.upper(PutawayTaskModel.item_code) == item_code.upper(),
        )
    )
    remaining = max(Decimal("0"), Decimal(str(accepted)) - Decimal(str(stored or 0)))
    if quantity > remaining:
        raise HTTPException(
            status_code=422,
            detail=f"Putaway quantity ({quantity}) exceeds GRN accepted quantity remaining ({remaining}). "
                   f"Accepted: {accepted}; already put away: {stored or 0}.",
        )
