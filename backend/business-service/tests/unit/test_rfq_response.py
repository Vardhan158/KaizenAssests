import uuid
from datetime import date, datetime
from app.modules.procurement.infrastructure.api.router import _to_rfq_response
from app.modules.procurement.infrastructure.api.schemas import RfqResponse


class DummyRfq:
    def __init__(self, rfq_date=None, created_at=None):
        self.id = uuid.uuid4()
        self.rfq_number = "RFQ-2026-001"
        self.rfq_date = rfq_date
        self.status = "DRAFT"
        self.material_request_number = "MR-100"
        self.required_delivery_date = date.today()
        self.warehouse = "Main Warehouse"
        self.procurement_officer = "Officer"
        self.remarks = "Test remarks"
        self.items = []
        self.suppliers = []
        self.created_at = created_at or datetime.now()


def test_to_rfq_response_with_null_rfq_date():
    rfq = DummyRfq(rfq_date=None)
    response = _to_rfq_response(rfq)
    assert isinstance(response, RfqResponse)
    assert response.rfq_date is not None
    assert isinstance(response.rfq_date, date)


def test_to_rfq_response_with_valid_rfq_date():
    today = date(2026, 9, 1)
    rfq = DummyRfq(rfq_date=today)
    response = _to_rfq_response(rfq)
    assert isinstance(response, RfqResponse)
    assert response.rfq_date == today
