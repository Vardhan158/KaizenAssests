"""
FastAPI Router for Supplier Management endpoints.
"""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.modules.masterdata.application.use_cases import (
    CreateSupplierUseCase,
    GetSupplierUseCase,
    ListSuppliersUseCase,
    UpdateSupplierUseCase,
)
from app.modules.masterdata.infrastructure.api.schemas import (
    SupplierCreateDTO,
    SupplierListResponseDTO,
    SupplierRatingDTO,
    SupplierResponseDTO,
    SupplierUpdateDTO,
)
from app.modules.masterdata.infrastructure.persistence.repository_impl import SQLAlchemySupplierRepository
from app.security.dependencies import get_current_user, CurrentUser

router = APIRouter(prefix="/api/v1/suppliers", tags=["Supplier Management"])


def _to_response_dto(s) -> SupplierResponseDTO:
    return SupplierResponseDTO(
        id=s.id,
        supplier_code=s.supplier_code,
        supplier_name=s.supplier_name,
        category=s.category,
        contact_person=s.contact_person,
        email=s.email,
        phone=s.phone,
        address=s.address,
        gst_number=s.gst_number,
        payment_terms=s.payment_terms,
        bank_details=s.bank_details,
        status=s.status.value,
        rating=SupplierRatingDTO(
            on_time_delivery_rate=s.rating.on_time_delivery_rate,
            quality_score=s.rating.quality_score,
            total_orders_fulfilled=s.rating.total_orders_fulfilled,
            overall_rating=s.rating.overall_rating,
        ),
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


@router.post("", response_model=SupplierResponseDTO, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    dto: SupplierCreateDTO,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    repo = SQLAlchemySupplierRepository(db)
    use_case = CreateSupplierUseCase(repo)
    try:
        supplier = await use_case.execute(**dto.model_dump())
        await db.commit()
        return _to_response_dto(supplier)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("", response_model=SupplierListResponseDTO)
async def list_suppliers(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
    category: str | None = Query(None),
    status_param: str | None = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    repo = SQLAlchemySupplierRepository(db)
    use_case = ListSuppliersUseCase(repo)
    items, total = await use_case.execute(category=category, status=status_param, skip=skip, limit=limit)
    return SupplierListResponseDTO(
        items=[_to_response_dto(s) for s in items],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/{supplier_id}", response_model=SupplierResponseDTO)
async def get_supplier(
    supplier_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    repo = SQLAlchemySupplierRepository(db)
    use_case = GetSupplierUseCase(repo)
    try:
        supplier = await use_case.execute(supplier_id)
        return _to_response_dto(supplier)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.patch("/{supplier_id}", response_model=SupplierResponseDTO)
async def update_supplier(
    supplier_id: str,
    dto: SupplierUpdateDTO,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser = Depends(get_current_user),
):
    repo = SQLAlchemySupplierRepository(db)
    use_case = UpdateSupplierUseCase(repo)
    try:
        supplier = await use_case.execute(supplier_id=supplier_id, **dto.model_dump(exclude_unset=True))
        await db.commit()
        return _to_response_dto(supplier)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
