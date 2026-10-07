from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, date
from decimal import Decimal
from typing import List

from app.common.domain.aggregate_root import AggregateRoot
from app.common.domain.events import DomainEvent
from app.modules.procurement.domain.events import AsnCreatedEvent
from app.modules.procurement.domain.value_objects import AsnId, PurchaseOrderId


@dataclass
class AsnLine:
    item_code: str
    shipped_quantity: Decimal
    material_name: str | None = None
    uom: str | None = "PCS"


@dataclass
class AsnDocument:
    document_type: str
    file_name: str
    file_url: str
    uploaded_by: str
    uploaded_at: datetime = field(default_factory=datetime.now)


class ASN(AggregateRoot):
    def __init__(
        self,
        id: AsnId,
        po_number: str | None,
        asn_number: str,
        status: str,
        lines: List[AsnLine],
        po_id: PurchaseOrderId | None = None,
        warehouse_id: str | None = None,
        vehicle_number: str | None = None,
        driver_name: str | None = None,
        driver_contact: str | None = None,
        expected_arrival_at: datetime | None = None,
        shipment_date: date | None = None,
        transporter: str | None = None,
        number_of_packages: int | None = None,
        package_type: str | None = None,
        shipping_method: str | None = None,
        documents: List[AsnDocument] = None,
        created_at: datetime | None = None,
        supplier_id: str | None = None,
        logistics: List[dict] | None = None,
    ) -> None:
        super().__init__()
        self.id = id
        self.po_number = po_number
        self.po_id = po_id
        self.asn_number = asn_number
        self.status = status
        self.lines = lines
        self.warehouse_id = warehouse_id
        self.vehicle_number = vehicle_number
        self.driver_name = driver_name
        self.driver_contact = driver_contact
        self.expected_arrival_at = expected_arrival_at
        self.shipment_date = shipment_date or date.today()
        self.transporter = transporter
        self.number_of_packages = number_of_packages
        self.package_type = package_type
        self.shipping_method = shipping_method
        self.documents = documents or []
        self.created_at = created_at or datetime.now()
        self.supplier_id = supplier_id
        self.logistics = logistics


    @staticmethod
    def create(
        asn_number: str,
        lines: List[AsnLine],
        po_id: PurchaseOrderId | None = None,
        po_number: str | None = None,
        warehouse_id: str | None = None,
        vehicle_number: str | None = None,
        driver_name: str | None = None,
        driver_contact: str | None = None,
        expected_arrival_at: datetime | None = None,
        shipment_date: date | None = None,
        transporter: str | None = None,
        number_of_packages: int | None = None,
        package_type: str | None = None,
        shipping_method: str | None = None,
        status: str = "SUBMITTED",
        documents: List[AsnDocument] = None,
        supplier_id: str | None = None,
        logistics: List[dict] | None = None,
    ) -> ASN:
        asn = ASN(
            id=AsnId.new_id(),
            po_id=po_id,
            po_number=po_number,
            asn_number=asn_number,
            status=status,
            lines=lines,
            warehouse_id=warehouse_id,
            vehicle_number=vehicle_number,
            driver_name=driver_name,
            driver_contact=driver_contact,
            expected_arrival_at=expected_arrival_at,
            shipment_date=shipment_date,
            transporter=transporter,
            number_of_packages=number_of_packages,
            package_type=package_type,
            shipping_method=shipping_method,
            documents=documents,
            supplier_id=supplier_id,
            logistics=logistics,
        )
        if status == "SUBMITTED":
            asn._register_event(
                AsnCreatedEvent(
                    asn_id=str(asn.id),
                    asn_number=asn.asn_number,
                    po_id=str(asn.po_id) if asn.po_id else None,
                    warehouse_id=asn.warehouse_id,
                    vehicle_number=asn.vehicle_number,
                    expected_arrival_at=asn.expected_arrival_at.isoformat() if asn.expected_arrival_at else None,
                    occurred_at=DomainEvent.now(),
                )
            )
        return asn
