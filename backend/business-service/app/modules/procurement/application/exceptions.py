"""
Exceptions for the procurement application layer.
"""
from app.common.domain.exceptions import NotFoundException


class PurchaseOrderNotFoundException(NotFoundException):
    def __init__(self, po_identifier: str) -> None:
        super().__init__(f"Purchase Order not found: {po_identifier}")


class AttachmentNotFoundException(NotFoundException):
    def __init__(self, attachment_id: str) -> None:
        super().__init__(f"Attachment not found: {attachment_id}")
