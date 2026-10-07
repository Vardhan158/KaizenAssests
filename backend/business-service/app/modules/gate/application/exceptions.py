"""
Application Exceptions for Gate Entry module.
"""
from app.common.domain.exceptions import DomainRuleViolationException, NotFoundException


class GateEntryNotFoundException(NotFoundException):
    def __init__(self, entry_id: str) -> None:
        super().__init__(f"Gate Entry with ID '{entry_id}' was not found")


class DuplicateGateEntryException(DomainRuleViolationException):
    def __init__(self, po_number: str, vehicle_number: str) -> None:
        super().__init__(
            f"An active Gate Entry already exists for Purchase Order '{po_number}' and Vehicle '{vehicle_number}'"
        )


class InvalidFileException(DomainRuleViolationException):
    def __init__(self, reason: str) -> None:
        super().__init__(f"Invalid uploaded file: {reason}")


class InvalidStatusTransitionException(DomainRuleViolationException):
    def __init__(self, current_status: str, target_action: str) -> None:
        super().__init__(f"Cannot perform action '{target_action}' on Gate Entry in status '{current_status}'")
