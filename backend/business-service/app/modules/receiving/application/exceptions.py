from app.common.domain.exceptions import NotFoundException


class PurchaseOrderNotFoundException(NotFoundException):
    def __init__(self, po_id: str) -> None:
        super().__init__(f"Purchase order not found: {po_id}")
