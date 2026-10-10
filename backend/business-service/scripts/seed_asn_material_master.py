"""Seed the existing 22-item ASN material catalog into the Material Master.

This is idempotent: existing material codes are preserved and skipped.
"""
import asyncio
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select

from app.database.session import session_scope
from app.common.persistence.models import MaterialModel
from app.modules.gate.infrastructure.api.router import DEFAULT_MATERIAL_COMPONENTS


async def seed() -> None:
    created = 0
    skipped = 0
    async with session_scope() as session:
        for item in DEFAULT_MATERIAL_COMPONENTS:
            code = str(item["code"]).strip()
            existing = await session.scalar(select(MaterialModel).where(MaterialModel.material_code == code))
            if existing:
                skipped += 1
                continue
            session.add(MaterialModel(
                material_code=code,
                material_name=str(item["name"]).strip(),
                category=str(item.get("category") or "General"),
                base_uom=str(item.get("uom") or "PCS"),
                status="Active",
                created_at=datetime.now(),
                created_by="SYSTEM_ASN_MATERIAL_SEED",
                updated_at=datetime.now(),
                updated_by="SYSTEM_ASN_MATERIAL_SEED",
            ))
            created += 1
        await session.commit()
    print(f"Material seed complete: created={created}, skipped_existing={skipped}")


if __name__ == "__main__":
    asyncio.run(seed())
