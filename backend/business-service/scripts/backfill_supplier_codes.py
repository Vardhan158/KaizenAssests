"""Assign permanent codes to legacy suppliers that do not have one."""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select

from app.database.session import session_scope
from app.modules.procurement.infrastructure.persistence.models import SupplierModel


async def backfill_supplier_codes() -> None:
    async with session_scope() as session:
        result = await session.execute(select(SupplierModel.supplier_code))
        used = {
            int(code[4:])
            for code in result.scalars()
            if code and code.startswith("SUP-") and code[4:].isdigit()
        }
        result = await session.execute(
            select(SupplierModel)
            .where(SupplierModel.supplier_code.is_(None))
            .order_by(SupplierModel.created_at, SupplierModel.id)
        )
        suppliers = result.scalars().all()
        sequence = 1
        for supplier in suppliers:
            while sequence in used:
                sequence += 1
            supplier.supplier_code = f"SUP-{sequence:05d}"
            used.add(sequence)
            sequence += 1
        print(f"Assigned codes to {len(suppliers)} supplier(s).")


if __name__ == "__main__":
    asyncio.run(backfill_supplier_codes())
