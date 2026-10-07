"""
SqlAlchemy implementations for procurement repositories.
Purchase Order module has been removed.
"""
from __future__ import annotations

from datetime import date, datetime
import uuid
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import delete, select, func, cast, String, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from app.events.outbox_repository import to_outbox_row
from app.modules.procurement.application.repository import (
    AsnRepository,
    QuotationRepository,
    RfqRepository,
    SupplierRepository,
    ArrivalNotificationRepository,
    MaterialRequestRepository,
)
from app.modules.procurement.domain.asn import ASN, AsnLine, AsnDocument
from app.modules.procurement.domain.arrival_notification import ArrivalNotification
from app.modules.procurement.domain.quotation import Quotation, QuotationLine
from app.modules.procurement.domain.rfq import RFQ
from app.modules.procurement.domain.rfq_item import RFQItem
from app.modules.procurement.domain.supplier import (
    Supplier,
    SupplierAddress,
    SupplierBankInfo,
    SupplierContact,
    SupplierDocument,
)
from app.modules.procurement.domain.value_objects import (
    AsnId,
    PurchaseOrderId,
    QuotationId,
    RfqId,
    SupplierId,
)
from app.modules.procurement.infrastructure.persistence.models import (
    AsnLineModel,
    AsnModel,
    MaterialRequestModel,
    QuotationLineModel,
    QuotationModel,
    RfqModel,
    RfqItemModel,
    SupplierAddressModel,
    SupplierBankInfoModel,
    SupplierContactModel,
    SupplierDocumentModel,
    SupplierModel,
    rfq_supplier_link,
    AsnDocumentModel,
    ArrivalNotificationModel,
    QuotationDocumentModel,
    PurchaseOrderModel,
    PurchaseOrderItemModel,
)


class SqlAlchemySupplierRepository(SupplierRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def find_by_id(self, supplier_id: SupplierId) -> Optional[Supplier]:
        val = supplier_id.value if hasattr(supplier_id, "value") else supplier_id
        try:
            lookup_id = uuid.UUID(str(val))
        except (ValueError, TypeError):
            lookup_id = val
        result = await self._session.execute(
            select(SupplierModel)
            .options(
                selectinload(SupplierModel.address),
                selectinload(SupplierModel.contact),
                selectinload(SupplierModel.bank_info),
                selectinload(SupplierModel.documents),
            )
            .where(SupplierModel.id == lookup_id)
        )
        entity = result.scalar_one_or_none()
        if entity is None:
            return None
        return self._to_aggregate(entity)

    async def list_all(self) -> List[Supplier]:
        result = await self._session.execute(
            select(SupplierModel).options(
                selectinload(SupplierModel.address),
                selectinload(SupplierModel.contact),
                selectinload(SupplierModel.bank_info),
                selectinload(SupplierModel.documents),
            )
        )
        return [self._to_aggregate(e) for e in result.scalars().all()]

    async def exists_by_gstin(self, gstin: str, exclude_id: Optional[str] = None) -> bool:
        if not gstin:
            return False
        stmt = select(func.count(SupplierModel.id)).where(func.upper(SupplierModel.gstin) == gstin.upper())
        if exclude_id:
            try:
                ex_id = uuid.UUID(str(exclude_id))
            except (ValueError, TypeError):
                ex_id = exclude_id
            stmt = stmt.where(SupplierModel.id != ex_id)
        res = await self._session.execute(stmt)
        return (res.scalar() or 0) > 0

    async def exists_by_company_name(self, name: str, exclude_id: Optional[str] = None) -> bool:
        if not name:
            return False
        stmt = select(func.count(SupplierModel.id)).where(func.upper(SupplierModel.registered_company_name) == name.upper())
        if exclude_id:
            try:
                ex_id = uuid.UUID(str(exclude_id))
            except (ValueError, TypeError):
                ex_id = exclude_id
            stmt = stmt.where(SupplierModel.id != ex_id)
        res = await self._session.execute(stmt)
        return (res.scalar() or 0) > 0

    async def get_next_sequence(self) -> int:
        # Supplier rows can be deleted and legacy UUID-only rows may exist, so
        # COUNT(*) is not a safe source for the next permanent supplier code.
        result = await self._session.execute(select(SupplierModel.supplier_code))
        used_sequences = []
        for code in result.scalars():
            if code and code.startswith("SUP-") and code[4:].isdigit():
                used_sequences.append(int(code[4:]))
        return max(used_sequences, default=0) + 1

    async def save(self, supplier: Supplier) -> None:
        val = supplier.id.value if hasattr(supplier.id, "value") else supplier.id
        try:
            lookup_id = uuid.UUID(str(val))
        except (ValueError, TypeError):
            lookup_id = val
        model = await self._session.get(
            SupplierModel,
            lookup_id,
            options=[
                selectinload(SupplierModel.address),
                selectinload(SupplierModel.contact),
                selectinload(SupplierModel.bank_info),
                selectinload(SupplierModel.documents),
            ]
        )
        if not model:
            model = SupplierModel(id=lookup_id)
            self._session.add(model)

        model.supplier_name = supplier.supplier_name
        model.registered_company_name = supplier.registered_company_name
        model.vendor_type = supplier.vendor_type
        model.category = supplier.category
        model.industry = supplier.industry
        model.gstin = supplier.gstin
        model.supplier_code = supplier.supplier_code
        model.main_materials = supplier.main_materials
        model.rating = Decimal(str(supplier.rating))
        model.performance_score = Decimal(str(supplier.performance_score))
        model.remarks = supplier.remarks
        model.status = supplier.status
        model.created_by = supplier.created_by
        model.created_at = supplier.created_at
        model.updated_by = supplier.updated_by
        model.updated_at = supplier.updated_at

        # Address
        if supplier.address:
            if not model.address:
                model.address = SupplierAddressModel(supplier_id=supplier.id.value)
            model.address.registered_address = supplier.address.registered_address
            model.address.city = supplier.address.city
            model.address.country = supplier.address.country
            model.address.state = supplier.address.state
            model.address.pincode = supplier.address.pincode
        elif model.address:
            await self._session.delete(model.address)

        # Contact
        if supplier.contact:
            if not model.contact:
                model.contact = SupplierContactModel(supplier_id=supplier.id.value)
            model.contact.primary_contact_name = supplier.contact.primary_contact_name
            model.contact.primary_email = supplier.contact.primary_email
            model.contact.secondary_email = supplier.contact.secondary_email
            model.contact.designation = supplier.contact.designation
            model.contact.phone = supplier.contact.phone
            model.contact.website = supplier.contact.website
        elif model.contact:
            await self._session.delete(model.contact)

        # Bank Info
        if supplier.bank_info:
            if not model.bank_info:
                model.bank_info = SupplierBankInfoModel(supplier_id=supplier.id.value)
            model.bank_info.bank_name = supplier.bank_info.bank_name
            model.bank_info.account_number = supplier.bank_info.account_number
            model.bank_info.account_holder_name = supplier.bank_info.account_holder_name
            model.bank_info.ifsc = supplier.bank_info.ifsc
            model.bank_info.branch = supplier.bank_info.branch
            model.bank_info.swift_bic = supplier.bank_info.swift_bic
            model.bank_info.tds_section = supplier.bank_info.tds_section
        elif model.bank_info:
            await self._session.delete(model.bank_info)

        # Documents
        await self._session.execute(delete(SupplierDocumentModel).where(SupplierDocumentModel.supplier_id == model.id))
        for doc in supplier.documents:
            model.documents.append(
                SupplierDocumentModel(
                    supplier_id=model.id,
                    document_type=doc.document_type,
                    file_name=doc.file_name,
                    file_type=doc.file_type,
                    file_size=doc.file_size,
                    storage_path=doc.storage_path,
                    upload_id=doc.upload_id
                )
            )

        # Write outbox domain events
        for event in supplier.domain_events:
            self._session.add(to_outbox_row("Supplier", str(supplier.id.value), event))
        supplier.clear_events()

        await self._session.flush()

    async def exists_by_email(self, email: str, exclude_id: Optional[str] = None) -> bool:
        if not email:
            return False
        stmt = select(func.count(SupplierContactModel.id)).where(func.upper(SupplierContactModel.primary_email) == email.upper())
        if exclude_id:
            try:
                ex_id = uuid.UUID(str(exclude_id))
            except (ValueError, TypeError):
                ex_id = exclude_id
            stmt = stmt.where(SupplierContactModel.supplier_id != ex_id)
        res = await self._session.execute(stmt)
        return (res.scalar() or 0) > 0

    async def exists_by_phone(self, phone: str, exclude_id: Optional[str] = None) -> bool:
        if not phone:
            return False
        stmt = select(func.count(SupplierContactModel.id)).where(SupplierContactModel.phone == phone)
        if exclude_id:
            try:
                ex_id = uuid.UUID(str(exclude_id))
            except (ValueError, TypeError):
                ex_id = exclude_id
            stmt = stmt.where(SupplierContactModel.supplier_id != ex_id)
        res = await self._session.execute(stmt)
        return (res.scalar() or 0) > 0

    async def exists_by_bank_account(self, account_number: str, exclude_id: Optional[str] = None) -> bool:
        if not account_number:
            return False
        stmt = select(func.count(SupplierBankInfoModel.id)).where(SupplierBankInfoModel.account_number == account_number)
        if exclude_id:
            try:
                ex_id = uuid.UUID(str(exclude_id))
            except (ValueError, TypeError):
                ex_id = exclude_id
            stmt = stmt.where(SupplierBankInfoModel.supplier_id != ex_id)
        res = await self._session.execute(stmt)
        return (res.scalar() or 0) > 0

    async def exists_by_swift(self, swift: str, exclude_id: Optional[str] = None) -> bool:
        if not swift:
            return False
        stmt = select(func.count(SupplierBankInfoModel.id)).where(func.upper(SupplierBankInfoModel.swift_bic) == swift.upper())
        if exclude_id:
            try:
                ex_id = uuid.UUID(str(exclude_id))
            except (ValueError, TypeError):
                ex_id = exclude_id
            stmt = stmt.where(SupplierBankInfoModel.supplier_id != ex_id)
        res = await self._session.execute(stmt)
        return (res.scalar() or 0) > 0

    def _to_aggregate(self, entity: SupplierModel) -> Supplier:
        address = None
        if entity.address:
            address = SupplierAddress(
                registered_address=entity.address.registered_address,
                city=entity.address.city,
                country=entity.address.country,
                state=entity.address.state,
                pincode=entity.address.pincode
            )

        contact = None
        if entity.contact:
            contact = SupplierContact(
                primary_contact_name=entity.contact.primary_contact_name,
                primary_email=entity.contact.primary_email,
                secondary_email=entity.contact.secondary_email,
                designation=entity.contact.designation,
                phone=entity.contact.phone,
                website=entity.contact.website
            )

        bank_info = None
        if entity.bank_info:
            bank_info = SupplierBankInfo(
                bank_name=entity.bank_info.bank_name,
                account_number=entity.bank_info.account_number,
                account_holder_name=entity.bank_info.account_holder_name,
                ifsc=entity.bank_info.ifsc,
                branch=entity.bank_info.branch,
                swift_bic=entity.bank_info.swift_bic,
                tds_section=entity.bank_info.tds_section
            )

        documents = [
            SupplierDocument(
                document_type=doc.document_type,
                file_name=doc.file_name,
                file_type=doc.file_type,
                file_size=doc.file_size,
                storage_path=doc.storage_path,
                upload_id=doc.upload_id
            )
            for doc in entity.documents
        ]

        return Supplier.rehydrate(
            id=SupplierId.of(entity.id),
            supplier_name=entity.supplier_name,
            registered_company_name=entity.registered_company_name,
            vendor_type=entity.vendor_type,
            category=entity.category or [],
            industry=entity.industry,
            gstin=entity.gstin,
            supplier_code=entity.supplier_code,
            main_materials=entity.main_materials or [],
            rating=float(entity.rating) if entity.rating else 0.0,
            performance_score=float(entity.performance_score) if entity.performance_score else 0.0,
            address=address,
            contact=contact,
            bank_info=bank_info,
            documents=documents,
            remarks=entity.remarks,
            status=entity.status,
            created_by=entity.created_by,
            created_at=entity.created_at,
            updated_by=entity.updated_by,
            updated_at=entity.updated_at
        )


class SqlAlchemyRfqRepository(RfqRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(self, rfq: RFQ) -> None:
        model = await self._session.get(
            RfqModel,
            rfq.id.value,
            options=[
                selectinload(RfqModel.items),
                selectinload(RfqModel.suppliers)
            ]
        )
        if not model:
            model = RfqModel(id=rfq.id.value)
            self._session.add(model)

        model.rfq_number = rfq.rfq_number
        model.rfq_date = rfq.rfq_date
        model.material_request_number = rfq.material_request_number
        model.required_delivery_date = rfq.required_delivery_date
        model.warehouse = rfq.warehouse
        model.procurement_officer = rfq.procurement_officer
        model.remarks = rfq.remarks
        model.status = rfq.status
        model.closing_date = rfq.closing_date
        model.selected_supplier_id = rfq.selected_supplier_id.value if rfq.selected_supplier_id else None
        model.selection_date = rfq.selection_date
        model.selected_by = rfq.selected_by
        model.selection_reason = rfq.selection_reason
        model.selection_comments = rfq.selection_comments

        # Sync items
        model.items = [
            RfqItemModel(
                rfq_id=rfq.id.value,
                material_id=uuid.UUID(str(item.material_id)) if item.material_id else None,
                material_variant_id=uuid.UUID(str(item.material_variant_id)) if item.material_variant_id else None,
                material_code=item.material_code,
                variant_code=item.variant_code,
                material_name=item.material_name,
                category=item.category,
                quantity=item.quantity,
                uom=item.uom,
                required_delivery_date=item.required_delivery_date or rfq.required_delivery_date or date.today(),
                warehouse=item.warehouse,
                special_requirements=item.special_requirements
            )
            for item in rfq.items
        ]

        # Sync suppliers
        if rfq.supplier_ids:
            supplier_uuids = []
            for sid in rfq.supplier_ids:
                val = sid.value if hasattr(sid, "value") else sid
                if isinstance(val, uuid.UUID):
                    supplier_uuids.append(val)
                else:
                    try:
                        supplier_uuids.append(uuid.UUID(str(val)))
                    except (ValueError, TypeError):
                        supplier_uuids.append(val)
            supplier_res = await self._session.execute(
                select(SupplierModel).where(SupplierModel.id.in_(supplier_uuids))
            )
            model.suppliers = list(supplier_res.scalars().all())
        else:
            model.suppliers = []

        # Write outbox domain events
        for event in rfq.domain_events:
            self._session.add(to_outbox_row("RFQ", str(rfq.id.value), event))
        rfq.clear_events()

        await self._session.flush()

    async def get_by_id(self, rfq_id: RfqId) -> Optional[RFQ]:
        stmt = (
            select(RfqModel)
            .options(
                selectinload(RfqModel.items),
                selectinload(RfqModel.suppliers).joinedload(SupplierModel.contact)
            )
            .where(RfqModel.id == rfq_id.value)
        )
        result = await self._session.execute(stmt)
        model = result.scalar_one_or_none()
        if not model:
            return None
        return self._to_aggregate(model)

    async def list_all(self) -> List[RFQ]:
        result = await self._session.execute(
            select(RfqModel).options(
                selectinload(RfqModel.items),
                selectinload(RfqModel.suppliers).joinedload(SupplierModel.contact)
            )
        )
        return [self._to_aggregate(e) for e in result.scalars().all()]

    def _to_aggregate(self, model: RfqModel) -> RFQ:
        rfq_date_val = model.rfq_date
        if not rfq_date_val:
            from datetime import date
            if hasattr(model, "created_at") and model.created_at:
                rfq_date_val = model.created_at.date() if hasattr(model.created_at, "date") else date.today()
            else:
                rfq_date_val = date.today()

        return RFQ(
            id=RfqId.of(model.id),
            rfq_number=model.rfq_number,
            rfq_date=rfq_date_val,
            warehouse=model.warehouse,
            procurement_officer=model.procurement_officer,
            status=model.status,
            supplier_ids=[SupplierId.of(s.id) for s in model.suppliers],
            items=[
                RFQItem(
                    material_code=it.material_code,
                    material_name=it.material_name,
                    category=it.category,
                    quantity=it.quantity,
                    uom=it.uom,
                    material_id=str(it.material_id) if it.material_id else None,
                    material_variant_id=str(it.material_variant_id) if it.material_variant_id else None,
                    variant_code=it.variant_code,
                    required_delivery_date=it.required_delivery_date,
                    warehouse=it.warehouse,
                    special_requirements=it.special_requirements
                )
                for it in model.items
            ],
            material_request_number=model.material_request_number,
            required_delivery_date=model.required_delivery_date,
            remarks=model.remarks,
            created_at=model.created_at,
            closing_date=model.closing_date,
            selected_supplier_id=SupplierId.of(model.selected_supplier_id) if model.selected_supplier_id else None,
            selection_date=model.selection_date,
            selected_by=model.selected_by,
            selection_reason=model.selection_reason,
            selection_comments=model.selection_comments
        )

    async def get_next_sequence(self, year: int) -> int:
        stmt = select(func.count(RfqModel.id)).where(func.extract('year', RfqModel.created_at) == year)
        result = await self._session.execute(stmt)
        return (result.scalar() or 0) + 1


class SqlAlchemyQuotationRepository(QuotationRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(self, quotation: Quotation) -> None:
        model = await self._session.get(
            QuotationModel,
            quotation.id.value,
            options=[
                selectinload(QuotationModel.lines),
                selectinload(QuotationModel.documents),
            ]
        )
        if not model:
            model = QuotationModel(id=quotation.id.value)
            self._session.add(model)

        model.rfq_id = quotation.rfq_id.value
        model.supplier_id = quotation.supplier_id.value
        model.status = quotation.status
        model.total_amount = quotation.total_amount
        model.discount = quotation.discount
        model.tax = quotation.tax
        model.freight_charges = quotation.freight_charges
        model.additional_charges = getattr(quotation, "additional_charges", None)
        model.delivery_time = quotation.delivery_time
        model.expected_delivery_date = quotation.expected_delivery_date
        model.payment_terms = quotation.payment_terms
        model.mode_of_payment = getattr(quotation, "mode_of_payment", None)
        model.warranty = getattr(quotation, "warranty", None)
        model.quotation_validity = quotation.quotation_validity
        model.remarks = quotation.remarks

        # Sync lines
        model.lines = [
            QuotationLineModel(
                quotation_id=quotation.id.value,
                material_id=uuid.UUID(str(line.material_id)) if getattr(line, "material_id", None) else None,
                material_variant_id=uuid.UUID(str(line.material_variant_id)) if getattr(line, "material_variant_id", None) else None,
                item_code=line.item_code,
                variant_code=getattr(line, "variant_code", None),
                quantity=line.quantity,
                unit_price=line.unit_price
            )
            for line in quotation.lines
        ]

        # Sync documents
        model.documents = [
            QuotationDocumentModel(
                quotation_id=quotation.id.value,
                document_type=doc.document_type,
                file_name=doc.file_name,
                file_url=doc.file_url
            )
            for doc in quotation.documents
        ]

        # Write outbox domain events
        for event in quotation.domain_events:
            self._session.add(to_outbox_row("Quotation", str(quotation.id.value), event))
        quotation.clear_events()

        await self._session.flush()

    async def get_by_id(self, quotation_id: QuotationId) -> Optional[Quotation]:
        stmt = select(QuotationModel).options(
            selectinload(QuotationModel.lines),
            selectinload(QuotationModel.documents)
        ).where(QuotationModel.id == quotation_id.value)
        result = await self._session.execute(stmt)
        model = result.scalar_one_or_none()
        if not model:
            return None
        return self._to_aggregate(model)

    async def list_all(self) -> List[Quotation]:
        result = await self._session.execute(select(QuotationModel).options(selectinload(QuotationModel.lines)))
        return [self._to_aggregate(e) for e in result.scalars().all()]

    def _to_aggregate(self, model: QuotationModel) -> Quotation:
        from app.modules.procurement.domain.quotation import QuotationDocument
        return Quotation(
            id=QuotationId.of(model.id),
            rfq_id=RfqId.of(model.rfq_id),
            supplier_id=SupplierId.of(model.supplier_id),
            status=model.status,
            lines=[
                QuotationLine(
                    item_code=line.item_code,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    material_id=str(line.material_id) if line.material_id else None,
                    material_variant_id=str(line.material_variant_id) if line.material_variant_id else None,
                    variant_code=line.variant_code
                )
                for line in model.lines
            ],
            total_amount=model.total_amount,
            created_at=model.created_at,
            discount=model.discount,
            tax=model.tax,
            freight_charges=model.freight_charges,
            additional_charges=getattr(model, "additional_charges", None),
            delivery_time=model.delivery_time,
            expected_delivery_date=model.expected_delivery_date,
            payment_terms=model.payment_terms,
            warranty=getattr(model, "warranty", None),
            quotation_validity=model.quotation_validity,
            remarks=model.remarks,
            documents=[
                QuotationDocument(
                    document_type=doc.document_type,
                    file_name=doc.file_name,
                    file_url=doc.file_url
                )
                for doc in model.documents
            ]
        )

class SqlAlchemyPurchaseOrderRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_all(self) -> List[PurchaseOrderModel]:
        stmt = select(PurchaseOrderModel).options(selectinload(PurchaseOrderModel.items)).order_by(PurchaseOrderModel.created_at.desc())
        res = await self._session.execute(stmt)
        return res.scalars().all()

    async def get_by_id(self, po_id: uuid.UUID) -> Optional[PurchaseOrderModel]:
        stmt = select(PurchaseOrderModel).options(selectinload(PurchaseOrderModel.items)).where(PurchaseOrderModel.id == po_id)
        res = await self._session.execute(stmt)
        return res.scalar_one_or_none()

    async def save(self, model: PurchaseOrderModel) -> None:
        self._session.add(model)
        await self._session.flush()


class SqlAlchemyAsnRepository(AsnRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(self, asn: ASN) -> None:
        stmt = select(AsnModel).options(selectinload(AsnModel.lines), selectinload(AsnModel.documents)).where(AsnModel.id == asn.id.value)
        res = await self._session.execute(stmt)
        model = res.scalar_one_or_none()
        if not model:
            model = AsnModel(id=asn.id.value, asn_number=asn.asn_number, status=asn.status)
            self._session.add(model)
        model.po_number = asn.po_number
        model.status = asn.status
        model.po_id = str(asn.po_id.value) if asn.po_id else None
        model.warehouse_id = asn.warehouse_id
        model.vehicle_number = asn.vehicle_number
        model.driver_name = asn.driver_name
        model.driver_contact = asn.driver_contact
        model.expected_arrival_at = asn.expected_arrival_at
        model.shipment_date = asn.shipment_date
        model.transporter = asn.transporter
        model.number_of_packages = asn.number_of_packages
        model.package_type = asn.package_type
        model.shipping_method = asn.shipping_method
        model.logistics = asn.logistics
        if asn.supplier_id:
            model.supplier_id = asn.supplier_id

        # Sync lines
        model.lines = [
            AsnLineModel(
                asn_id=asn.id.value,
                item_code=l.item_code,
                shipped_quantity=l.shipped_quantity,
                material_name=getattr(l, "material_name", None),
                uom=getattr(l, "uom", "PCS"),
            )
            for l in asn.lines
        ]

        # Sync documents
        model.documents = [
            AsnDocumentModel(
                asn_id=asn.id.value,
                document_type=d.document_type,
                file_name=d.file_name,
                file_url=d.file_url,
                uploaded_by=d.uploaded_by,
                uploaded_at=d.uploaded_at,
            )
            for d in asn.documents
        ]

        # Write outbox domain events
        for event in asn.domain_events:
            self._session.add(to_outbox_row("ASN", str(asn.id.value), event))
        asn.clear_events()

        await self._session.flush()

    def _to_aggregate(self, model: AsnModel) -> ASN:
        from app.modules.procurement.domain.value_objects import PurchaseOrderId
        return ASN(
            id=AsnId.of(model.id),
            po_number=model.po_number,
            asn_number=model.asn_number,
            status=model.status,
            lines=[
                AsnLine(
                    item_code=l.item_code,
                    shipped_quantity=l.shipped_quantity,
                    material_name=l.material_name,
                    uom=l.uom,
                )
                for l in model.lines
            ],
            po_id=PurchaseOrderId.of(model.po_id) if model.po_id else None,
            warehouse_id=model.warehouse_id,
            vehicle_number=model.vehicle_number,
            driver_name=model.driver_name,
            driver_contact=model.driver_contact,
            expected_arrival_at=model.expected_arrival_at,
            shipment_date=model.shipment_date,
            transporter=model.transporter,
            number_of_packages=model.number_of_packages,
            package_type=model.package_type,
            shipping_method=model.shipping_method,
            documents=[
                AsnDocument(
                    document_type=d.document_type,
                    file_name=d.file_name,
                    file_url=d.file_url,
                    uploaded_by=d.uploaded_by,
                    uploaded_at=d.uploaded_at,
                )
                for d in model.documents
            ],
            created_at=model.created_at,
            supplier_id=str(model.supplier_id) if model.supplier_id else None,
            logistics=model.logistics,
        )

    async def get_by_id(self, asn_id: AsnId) -> Optional[ASN]:
        stmt = (
            select(AsnModel)
            .options(
                selectinload(AsnModel.lines),
                selectinload(AsnModel.documents),
            )
            .where(AsnModel.id == asn_id.value)
        )
        res = await self._session.execute(stmt)
        model = res.scalar_one_or_none()
        if not model:
            return None
        return self._to_aggregate(model)

    async def get_by_po_id(self, po_id: PurchaseOrderId) -> List[ASN]:
        stmt = (
            select(AsnModel)
            .options(
                selectinload(AsnModel.lines),
                selectinload(AsnModel.documents),
            )
            .where(AsnModel.po_id == str(po_id.value))
        )
        res = await self._session.execute(stmt)
        return [self._to_aggregate(m) for m in res.scalars().all()]

    async def list_all(self, supplier_id: Optional[str] = None) -> List[ASN]:
        stmt = select(AsnModel).options(
            selectinload(AsnModel.lines),
            selectinload(AsnModel.documents),
        )
        if supplier_id:
            stmt = stmt.where(AsnModel.supplier_id == supplier_id)
        res = await self._session.execute(stmt)
        return [self._to_aggregate(m) for m in res.scalars().all()]

    async def get_next_sequence(self, year: int) -> int:
        from sqlalchemy import func
        stmt = select(func.count(AsnModel.id)).where(func.extract('year', AsnModel.created_at) == year)
        res = await self._session.execute(stmt)
        return (res.scalar() or 0) + 1


class SqlAlchemyArrivalNotificationRepository(ArrivalNotificationRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(self, notification: ArrivalNotification) -> None:
        model = ArrivalNotificationModel(
            id=notification.id,
            asn_id=uuid.UUID(notification.asn_id),
            asn_number=notification.asn_number,
            po_number=notification.po_number,
            warehouse_id=notification.warehouse_id,
            supplier_name=notification.supplier_name,
            vehicle_number=notification.vehicle_number,
            expected_arrival_time=notification.expected_arrival_time,
            status=notification.status.value if hasattr(notification.status, "value") else notification.status,
        )
        self._session.add(model)
        await self._session.flush()

    async def get_by_id(self, notification_id: str) -> Optional[ArrivalNotification]:
        res = await self._session.execute(
            select(ArrivalNotificationModel).where(ArrivalNotificationModel.id == notification_id)
        )
        m = res.scalar_one_or_none()
        if not m:
            return None
        return ArrivalNotification(
            id=m.id,
            asn_id=str(m.asn_id),
            asn_number=m.asn_number,
            po_id=m.po_id,
            po_number=m.po_number,
            warehouse_id=m.warehouse_id,
            supplier_name=m.supplier_name,
            vehicle_number=m.vehicle_number,
            expected_arrival_time=m.expected_arrival_time,
            driver_phone=m.driver_phone,
            message=m.message,
            status=m.status,
            created_at=m.created_at,
            updated_at=m.updated_at,
        )

    async def list_all(self) -> List[ArrivalNotification]:
        res = await self._session.execute(select(ArrivalNotificationModel).order_by(ArrivalNotificationModel.created_at.desc()))
        models = res.scalars().all()
        return [
            ArrivalNotification(
                id=m.id,
                asn_id=str(m.asn_id),
                asn_number=m.asn_number,
                po_id=m.po_id,
                po_number=m.po_number,
                warehouse_id=m.warehouse_id,
                supplier_name=m.supplier_name,
                vehicle_number=m.vehicle_number,
                expected_arrival_time=m.expected_arrival_time,
                driver_phone=m.driver_phone,
                message=m.message,
                status=m.status,
                created_at=m.created_at,
                updated_at=m.updated_at
            )
            for m in models
        ]

class SqlAlchemyMaterialRequestRepository(MaterialRequestRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_next_sequence(self, year_month: str) -> int:
        # Pattern MR-YYYYMM-%
        pattern = f"MR-{year_month}-%"
        stmt = select(func.count(MaterialRequestModel.id)).where(MaterialRequestModel.request_number.like(pattern))
        res = await self._session.execute(stmt)
        return (res.scalar() or 0) + 1
