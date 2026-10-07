"""
Domain-level exceptions - counterparts of DomainRuleViolationException and
NotFoundException. The domain layer never imports anything HTTP-related;
translation to HTTP status codes happens once, in
app/middleware/error_handler.py, exactly like GlobalExceptionHandler did
on the Java side.
"""


class DomainRuleViolationException(Exception):
    """Raised when a business rule is violated."""


class NotFoundException(Exception):
    """Raised when a requested aggregate does not exist."""
