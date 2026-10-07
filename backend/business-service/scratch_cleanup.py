import asyncio
from app.database.session import session_scope
from sqlalchemy import text

async def cleanup():
    async with session_scope() as session:
        await session.execute(text("DELETE FROM rfq WHERE rfq_number LIKE 'RFQ-2026-%'"))
        await session.execute(text("DELETE FROM supplier WHERE supplier_name = 'Test Supplier'"))
        await session.commit()
        print("Cleanup done.")

if __name__ == "__main__":
    asyncio.run(cleanup())
