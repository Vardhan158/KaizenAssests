"""
SQLAlchemy Implementation of SupplierRepositoryProtocol.
"""
from typing import Sequence
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.events.outbox_repository import to_outbox_row
from app.modules.masterdata.application.repository import SupplierRepositoryProtocol
from app.modules.masterdata.domain.supplier import Supplier, SupplierRating, SupplierStatus
from app.modules.masterdata.infrastructure.persistence.models import SupplierModel


class SQLAlchemySupplierRepository(SupplierRepositoryProtocol):
    def __init__(self, session: AsyncSession):
        self._session = session

    async def save(self, supplier: Supplier) -> Supplier:
        model = await self._session.get(SupplierModel, supplier.id)
        if not model:
            model = SupplierModel(id=supplier.id)
            self._session.add(model)

        model.supplier_code = supplier.supplier_code
        model.supplier_name = supplier.supplier_name
        model.category = supplier.category
        model.contact_person = supplier.contact_person
        model.email = supplier.email
        model.phone = supplier.phone
        model.address = supplier.address
        model.gst_number = supplier.gst_number
        model.payment_terms = supplier.payment_terms
        model.bank_details = supplier.bank_details
        model.status = supplier.status.value if isinstance(supplier.status, SupplierStatus) else str(supplier.status)
        model.on_time_delivery_rate = supplier.rating.on_time_delivery_rate
        model.quality_score = supplier.rating.quality_score
        model.total_orders_fulfilled = supplier.rating.total_orders_fulfilled
        model.updated_at = supplier.updated_at

        for event in supplier.recorded_events:
            self._session.add(to_outbox_row("Supplier", supplier.id, event))
        supplier.recorded_events.clear()

        await self._session.flush()
        return self._to_domain(model)

    async def get_by_id(self, supplier_id: str) -> Supplier | None:
        model = await self._session.get(SupplierModel, supplier_id)
        return self._to_domain(model) if model else None

    async def get_by_code(self, supplier_code: str) -> Supplier | None:
        stmt = select(SupplierModel).where(SupplierModel.supplier_code == supplier_code)
        res = await self._session.execute(stmt)
        model = res.scalar_one_or_none()
        return self._to_domain(model) if model else None

    async def list_all(
        self,
        category: str | None = None,
        status: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[Supplier], int]:
        stmt = select(SupplierModel)
        count_stmt = select(func.count(SupplierModel.id))

        if category:
            stmt = stmt.where(SupplierModel.category == category)
            count_stmt = count_stmt.where(SupplierModel.category == category)
        if status:
            stmt = stmt.where(SupplierModel.status == status)
            count_stmt = count_stmt.where(SupplierModel.status == status)

        stmt = stmt.offset(skip).limit(limit).order_by(SupplierModel.supplier_code)
        
        count_res = await self._session.execute(count_stmt)
        total = count_res.scalar() or 0

        res = await self._session.execute(stmt)
        models = res.scalars().all()
        return [self._to_domain(m) for m in models], total

    def _to_domain(self, model: SupplierModel) -> Supplier:
        rating = SupplierRating(
            on_time_delivery_rate=model.on_time_delivery_rate,
            quality_score=model.quality_score,
            total_orders_fulfilled=model.total_orders_fulfilled,
        )
        return Supplier(
            id=model.id,
            supplier_code=model.supplier_code,
            supplier_name=model.supplier_name,
            category=model.category,
            contact_person=model.contact_person,
            email=model.email,
            phone=model.phone,
            address=model.address,
            gst_number=model.gst_number,
            payment_terms=model.payment_terms,
            bank_details=model.bank_details,
            status=SupplierStatus(model.status),
            rating=rating,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )
