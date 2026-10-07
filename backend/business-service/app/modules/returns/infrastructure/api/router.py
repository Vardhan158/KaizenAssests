"""
Inbound adapter for the returns module - counterpart of ReturnController.java.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.database.session import UnitOfWork, get_uow
from app.modules.returns.application.commands import CreateReturnCommand, CreateReturnLine
from app.modules.returns.application.use_cases import CreateReturnUseCase, GetReturnUseCase
from app.modules.returns.domain.value_objects import ReturnId
from app.modules.returns.infrastructure.api.schemas import (
    CreateReturnRequest,
    ReturnDetailResponse,
    ReturnLineResponse,
    ReturnResponse,
)
from app.modules.returns.infrastructure.persistence.repository_impl import SqlAlchemyReturnRepository
from app.security.dependencies import require_permission

router = APIRouter(prefix="/api/returns", tags=["returns"])


@router.post("", response_model=ReturnResponse)
async def create(
    request: CreateReturnRequest,
    uow: UnitOfWork = Depends(get_uow),
    _user=Depends(require_permission("returns:write")),
) -> ReturnResponse:
    repo = SqlAlchemyReturnRepository(uow.session)
    use_case = CreateReturnUseCase(repo)
    command = CreateReturnCommand(
        lines=[CreateReturnLine(item_code=l.item_code, quantity=l.quantity, reason=l.reason) for l in request.lines]
    )
    return_id = await use_case.handle(command)
    return ReturnResponse(return_id=str(return_id), status="REQUESTED")


@router.get("/{return_id}", response_model=ReturnDetailResponse)
async def get(
    return_id: str,
    uow: UnitOfWork = Depends(get_uow),
    _user=Depends(require_permission("returns:read")),
) -> ReturnDetailResponse:
    repo = SqlAlchemyReturnRepository(uow.session)
    use_case = GetReturnUseCase(repo)
    return_request = await use_case.handle(ReturnId.of(return_id))
    return ReturnDetailResponse(
        return_id=str(return_request.id),
        status=return_request.status.value,
        lines=[
            ReturnLineResponse(item_code=l.item_code, quantity=l.quantity, reason=l.reason.value)
            for l in return_request.lines
        ],
    )
