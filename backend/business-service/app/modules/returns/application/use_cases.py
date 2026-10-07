"""
CreateReturnUseCase / GetReturnUseCase - counterparts of the Java use cases.
"""
from __future__ import annotations

from app.common.domain.exceptions import NotFoundException
from app.modules.returns.application.commands import CreateReturnCommand
from app.modules.returns.application.repository import ReturnRepository
from app.modules.returns.domain.return_line import ReturnLine
from app.modules.returns.domain.return_reason import ReturnReason
from app.modules.returns.domain.return_request import ReturnRequest
from app.modules.returns.domain.value_objects import ReturnId


class CreateReturnUseCase:
    def __init__(self, return_repository: ReturnRepository) -> None:
        self._return_repository = return_repository

    async def handle(self, command: CreateReturnCommand) -> ReturnId:
        lines = [
            ReturnLine(item_code=l.item_code, quantity=l.quantity, reason=ReturnReason(l.reason))
            for l in command.lines
        ]
        return_request = ReturnRequest.request(lines)
        await self._return_repository.save(return_request)
        return return_request.id


class GetReturnUseCase:
    def __init__(self, return_repository: ReturnRepository) -> None:
        self._return_repository = return_repository

    async def handle(self, return_id: ReturnId) -> ReturnRequest:
        return_request = await self._return_repository.find_by_id(return_id)
        if return_request is None:
            raise NotFoundException(f"Return request not found: {return_id}")
        return return_request
