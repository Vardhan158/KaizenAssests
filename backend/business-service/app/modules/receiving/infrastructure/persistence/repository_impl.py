"""
SQLAlchemy implementation of the Goods Receiving / GRN repository.

This adapter connects the receiving application layer to the existing
PostgreSQL models for:

    Purchase Order
        -> ASN
        -> Gate Entry
        -> Existing GRN
        -> Warehouse Dock

Important receiving rule:
GateEntryModel.assigned_dock_id is NOT copied automatically to
GrnModel.dock_number.  The receiving dock remains a manual GRN selection.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Optional
import uuid

from datetime import datetime, timezone
from sqlalchemy import bindparam, func, insert, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.events.outbox_repository import to_outbox_row

from app.common.persistence.models import (
    AsnModel,
    MaterialModel,
    MaterialStockModel,
    MaterialVariantModel,
    PurchaseOrderModel,
    SupplierModel,
)

from app.modules.gate.infrastructure.persistence.models import (
    DockAssignmentModel,
    DockModel,
    GateEntryModel,
    SupplierDamageClaimModel,
)
from app.modules.dock.infrastructure.persistence.models import (
    DockAllocationRequestModel,
    DockMasterModel,
)
from app.modules.store.infrastructure.persistence.models import StoreModel

from app.modules.receiving.application.repository import (
    AsnDocumentSnapshot,
    AsnLineSnapshot,
    AsnSnapshot,
    GateEntrySnapshot,
    GrnHeaderSnapshot,
    GrnRepository,
    PurchaseOrderLineSnapshot,
    PurchaseOrderSnapshot,
    WarehouseDockSnapshot,
)

from app.modules.receiving.domain.grn import GoodsReceiptNote
from app.modules.receiving.domain.grn_status import GrnStatus
from app.modules.receiving.domain.receipt_line import ReceiptLine
from app.modules.receiving.domain.value_objects import (
    GrnId,
    PurchaseOrderId,
)

from app.modules.receiving.infrastructure.persistence.models import (
    GrnBatchModel,
    GrnBatchQrModel,
    GrnDamageEvidenceModel,
    GrnDamageLotModel,
    GrnDamageQrModel,
    GrnDocumentModel,
    GrnLineModel,
    GrnModel,
    InventoryReceiptPostingModel,
)
from app.modules.storage.infrastructure.persistence.models import PutawayTaskModel


# ============================================================================
# HELPERS
# ============================================================================

def _uuid_or_none(value: str | uuid.UUID | None) -> uuid.UUID | None:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def _qc_released_quantity(line: GrnLineModel) -> Decimal:
    """Only explicitly released positive QC quantities may enter putaway."""
    released_statuses = {"ACCEPTED", "APPROVED", "RELEASED", "PASS", "PASSED"}
    if (line.quality_result or "").strip().upper() not in released_statuses:
        return Decimal("0")
    return max(Decimal("0"), Decimal(str(line.quality_approved_quantity or 0)))


def _string_or_none(value: object | None) -> str | None:
    if value is None:
        return None
    return str(value)


def _is_uuid_string(val: str | None) -> bool:
    if not val:
        return False
    try:
        uuid.UUID(str(val).strip())
        return True
    except Exception:
        return False


async def _resolve_real_supplier_names(
    session: AsyncSession,
    po_id: str | uuid.UUID | None = None,
    po_number: str | None = None,
    raw_supplier_name: str | None = None,
    raw_supplier_company: str | None = None,
    is_unexpected: bool = False,
) -> tuple[str, str]:
    supplier_name = (raw_supplier_name or "").strip()
    supplier_company = (raw_supplier_company or "").strip()

    # If supplier_name is a valid human name, keep it
    if supplier_name and not _is_uuid_string(supplier_name) and supplier_name.lower() not in ("none", "null", "unknown"):
        if not supplier_company or _is_uuid_string(supplier_company):
            supplier_company = supplier_name
        return supplier_name, supplier_company

    # 1. Try resolving via PurchaseOrderModel
    if po_number or po_id:
        po_cond = (PurchaseOrderModel.po_number == str(po_number).strip()) if po_number else (PurchaseOrderModel.id == _uuid_or_none(po_id))
        po_res = await session.execute(select(PurchaseOrderModel).where(po_cond))
        po_obj = po_res.scalars().first()
        if po_obj:
            if po_obj.supplier_name and not _is_uuid_string(po_obj.supplier_name):
                supplier_name = po_obj.supplier_name
            if po_obj.supplier_id:
                sup_res = await session.execute(select(SupplierModel).where(SupplierModel.id == po_obj.supplier_id))
                sup_obj = sup_res.scalars().first()
                if sup_obj:
                    supplier_name = sup_obj.supplier_name or supplier_name
                    supplier_company = sup_obj.registered_company_name or sup_obj.supplier_name or supplier_company

    # 2. Try resolving via UUID lookup on SupplierModel
    if (not supplier_name or _is_uuid_string(supplier_name)) and raw_supplier_name and _is_uuid_string(raw_supplier_name):
        sup_uuid = _uuid_or_none(raw_supplier_name)
        if sup_uuid:
            sup_res = await session.execute(select(SupplierModel).where(SupplierModel.id == sup_uuid))
            sup_obj = sup_res.scalars().first()
            if sup_obj:
                supplier_name = sup_obj.supplier_name
                supplier_company = sup_obj.registered_company_name or sup_obj.supplier_name

    if (not supplier_company or _is_uuid_string(supplier_company)) and raw_supplier_company and _is_uuid_string(raw_supplier_company):
        sup_uuid = _uuid_or_none(raw_supplier_company)
        if sup_uuid:
            sup_res = await session.execute(select(SupplierModel).where(SupplierModel.id == sup_uuid))
            sup_obj = sup_res.scalars().first()
            if sup_obj:
                supplier_company = sup_obj.registered_company_name or sup_obj.supplier_name

    # 3. Fallbacks
    if not supplier_name or _is_uuid_string(supplier_name):
        supplier_name = "Unexpected Supplier" if is_unexpected else "Supplier"
    if not supplier_company or _is_uuid_string(supplier_company):
        supplier_company = "Unexpected Delivery" if is_unexpected else supplier_name

    return supplier_name, supplier_company


# ============================================================================
# REPOSITORY
# ============================================================================

def next_grn_number(numbers, year):
    prefix = f"GRN-{year}-"
    sequence = max(
        (int(number[len(prefix):]) for number in numbers
         if number and number.startswith(prefix) and number[len(prefix):].isdigit()),
        default=0,
    ) + 1
    return f"{prefix}{sequence:03d}"


class SqlAlchemyGrnRepository(GrnRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ========================================================================
    # PURCHASE ORDER
    # ========================================================================

    async def find_purchase_order(
        self,
        po_id: PurchaseOrderId,
    ) -> Optional[PurchaseOrderSnapshot]:
        """
        Legacy lookup used by ConfirmGrnUseCase.

        Unlike the old stub, this reads the real purchase_order and
        purchase_order_item records.
        """

        result = await self._session.execute(
            select(PurchaseOrderModel)
            .options(selectinload(PurchaseOrderModel.items))
            .where(PurchaseOrderModel.id == po_id.value)
        )

        entity = result.scalar_one_or_none()

        if entity is None:
            return None

        return await self._to_purchase_order_snapshot(entity)

    async def find_purchase_order_by_number(
        self,
        po_number: str,
    ) -> Optional[PurchaseOrderSnapshot]:
        normalized = po_number.strip()

        if not normalized:
            return None

        result = await self._session.execute(
            select(PurchaseOrderModel)
            .options(selectinload(PurchaseOrderModel.items))
            .where(PurchaseOrderModel.po_number == normalized)
        )

        entity = result.scalar_one_or_none()

        if entity is None:
            return None

        return await self._to_purchase_order_snapshot(entity)

    async def _to_purchase_order_snapshot(
        self,
        entity: PurchaseOrderModel,
    ) -> PurchaseOrderSnapshot:
        """
        Convert procurement ORM state into an immutable receiving snapshot.
        """

        ordered_by_item: dict[str, Decimal] = defaultdict(
            lambda: Decimal("0")
        )

        line_snapshots: list[PurchaseOrderLineSnapshot] = []

        for item in entity.items:
            quantity = Decimal(item.quantity)

            ordered_by_item[item.material_code] += quantity

            material_category = getattr(item, 'category', None)
            variant_code = getattr(item, "variant_code", None)
            variant_size = None
            variant_color = None
            variant_grade = None
            variant_uom = None

            if getattr(item, "material_variant_id", None) or variant_code:
                variant_filters = []
                if getattr(item, "material_variant_id", None):
                    variant_filters.append(MaterialVariantModel.id == item.material_variant_id)
                if variant_code:
                    variant_filters.append(MaterialVariantModel.variant_code == variant_code)
                variant_res = await self._session.execute(
                    select(MaterialVariantModel).where(or_(*variant_filters))
                )
                variant = variant_res.scalars().first()
                if variant:
                    variant_code = variant_code or variant.variant_code
                    variant_size = variant.size
                    variant_color = variant.color
                    variant_grade = variant.grade
                    variant_uom = variant.uom

            if not material_category:
                mat_res = await self._session.execute(
                    select(MaterialModel.category).where(
                        (MaterialModel.code == item.material_code) | (MaterialModel.name == item.material_name)
                    )
                )
                material_category = mat_res.scalar_one_or_none()

            line_snapshots.append(
                PurchaseOrderLineSnapshot(
                    item_code=item.material_code,
                    ordered_quantity=quantity,
                    material_name=item.material_name,
                    material_category=material_category or "General",
                    uom=variant_uom or item.uom,
                    variant_code=variant_code,
                    size=variant_size,
                    color=variant_color,
                    grade=variant_grade,
                )
            )

        supplier_company_name: str | None = None
        supplier_email: str | None = entity.supplier_email
        supplier_contact_person: str | None = entity.supplier_contact_person

        if entity.supplier_id is not None:
            supplier_result = await self._session.execute(
                select(SupplierModel)
                .options(selectinload(SupplierModel.contact))
                .where(
                    (SupplierModel.id == entity.supplier_id) | (SupplierModel.id == str(entity.supplier_id))
                )
            )

            supplier = supplier_result.scalar_one_or_none()

            if supplier is not None:
                supplier_company_name = getattr(supplier, 'registered_company_name', None) or getattr(supplier, 'supplier_name', None)
                if getattr(supplier, "contact", None) and supplier.contact:
                    supplier_email = supplier.contact.primary_email or supplier.contact.secondary_email or supplier_email
                    supplier_contact_person = supplier.contact.primary_contact_name or supplier_contact_person

        if not supplier_email and (entity.supplier_name or supplier_company_name):
            sup_res2 = await self._session.execute(
                select(SupplierModel)
                .options(selectinload(SupplierModel.contact))
                .where(
                    (SupplierModel.supplier_name.ilike(entity.supplier_name or "")) |
                    (SupplierModel.registered_company_name.ilike(supplier_company_name or ""))
                )
            )
            sup2 = sup_res2.scalars().first()
            if sup2 and getattr(sup2, "contact", None) and sup2.contact:
                supplier_email = sup2.contact.primary_email or sup2.contact.secondary_email or supplier_email
                supplier_contact_person = sup2.contact.primary_contact_name or supplier_contact_person

        return PurchaseOrderSnapshot(
            id=PurchaseOrderId.of(entity.id),
            ordered_quantity_by_item_code=dict(ordered_by_item),
            po_number=entity.po_number,
            status=entity.status,
            supplier_id=_string_or_none(entity.supplier_id),
            supplier_name=entity.supplier_name or "",
            supplier_company_name=(
                supplier_company_name or entity.supplier_name or ""
            ),
            supplier_email=supplier_email,
            supplier_contact_person=supplier_contact_person,
            warehouse_id=entity.warehouse_id,
            warehouse_name=entity.delivery_warehouse_name or "Main Warehouse",
            expected_delivery_date=entity.expected_delivery_date,
            lines=tuple(line_snapshots),
        )

    # ========================================================================
    # ASN
    # ========================================================================

    async def find_asn_by_reference(
        self,
        reference: str,
    ) -> Optional[AsnSnapshot]:
        """
        Find an ASN by either:
        - ASN UUID
        - ASN number
        """

        normalized = reference.strip()

        if not normalized:
            return None

        reference_uuid = _uuid_or_none(normalized)

        conditions = [AsnModel.asn_number == normalized]

        if reference_uuid is not None:
            conditions.append(AsnModel.id == reference_uuid)

        result = await self._session.execute(
            select(AsnModel)
            .options(
                selectinload(AsnModel.lines),
                selectinload(AsnModel.documents),
            )
            .where(or_(*conditions))
            .order_by(AsnModel.created_at.desc())
            .limit(1)
        )

        entity = result.scalar_one_or_none()

        if entity is None:
            return None

        return self._to_asn_snapshot(entity)

    async def find_latest_asn_for_po(
        self,
        *,
        po_id: str | None = None,
        po_number: str | None = None,
        asn_number: str | None = None,
    ) -> Optional[AsnSnapshot]:
        """
        Return the newest ASN linked to the PO.

        The current ASN table stores po_id as text, so UUID PO IDs are
        compared using their canonical string representation.
        """

        conditions = []

        if po_id:
            conditions.append(AsnModel.po_id == str(po_id).strip())

        if po_number:
            conditions.append(
                AsnModel.po_number == str(po_number).strip()
            )

        if not conditions:
            return None

        result = await self._session.execute(
            select(AsnModel)
            .options(
                selectinload(AsnModel.lines),
                selectinload(AsnModel.documents),
            )
            .where(or_(*conditions))
            .order_by(
                AsnModel.created_at.desc(),
                AsnModel.id.desc(),
            )
            .limit(1)
        )

        entity = result.scalar_one_or_none()

        if entity is None:
            return None

        return self._to_asn_snapshot(entity)

    @staticmethod
    def _to_asn_snapshot(
        entity: AsnModel,
    ) -> AsnSnapshot:
        return AsnSnapshot(
            id=str(entity.id),
            asn_number=entity.asn_number,
            status=entity.status,
            po_id=entity.po_id,
            po_number=entity.po_number,
            supplier_id=_string_or_none(entity.supplier_id),
            warehouse_id=entity.warehouse_id,
            vehicle_number=entity.vehicle_number,
            driver_name=entity.driver_name,
            driver_contact=entity.driver_contact,
            expected_arrival_at=entity.expected_arrival_at,
            shipment_date=entity.shipment_date,
            transporter=entity.transporter,
            number_of_packages=entity.number_of_packages,
            package_type=entity.package_type,
            shipping_method=entity.shipping_method,
            lines=tuple(
                AsnLineSnapshot(
                    item_code=line.item_code,
                    shipped_quantity=Decimal(line.shipped_quantity),
                    material_name=line.material_name,
                    uom=line.uom,
                )
                for line in entity.lines
            ),
            documents=tuple(
                AsnDocumentSnapshot(
                    document_type=document.document_type,
                    file_name=document.file_name,
                    file_url=document.file_url,
                )
                for document in entity.documents
            ),
        )

    # ========================================================================
    # GATE ENTRY
    # ========================================================================

    async def find_latest_gate_entry_for_asn(
        self,
        asn_id: str,
    ) -> Optional[GateEntrySnapshot]:
        asn_uuid = _uuid_or_none(asn_id)

        if asn_uuid is None:
            return None

        result = await self._session.execute(
            select(GateEntryModel)
            .where(GateEntryModel.asn_id == asn_uuid)
            .order_by(
                GateEntryModel.created_at.desc(),
                GateEntryModel.id.desc(),
            )
            .limit(1)
        )

        entity = result.scalar_one_or_none()

        if entity is None:
            return None

        return self._to_gate_entry_snapshot(entity)

    async def find_latest_gate_entry_for_po(
        self,
        po_number: str,
    ) -> Optional[GateEntrySnapshot]:
        normalized = po_number.strip()

        if not normalized:
            return None

        result = await self._session.execute(
            select(GateEntryModel)
            .where(func.upper(GateEntryModel.po_number) == normalized.upper())
            .order_by(
                GateEntryModel.created_at.desc(),
                GateEntryModel.id.desc(),
            )
            .limit(1)
        )

        entity = result.scalar_one_or_none()

        if entity is None:
            return None

        return self._to_gate_entry_snapshot(entity)

    async def find_gate_entry_by_id(
        self,
        gate_entry_id: str,
    ) -> Optional[GateEntrySnapshot]:
        gate_uuid = _uuid_or_none(gate_entry_id)
        if gate_uuid is None:
            return None

        result = await self._session.execute(
            select(GateEntryModel).where(GateEntryModel.id == gate_uuid).limit(1)
        )
        entity = result.scalar_one_or_none()
        if entity is None:
            return None
        return self._to_gate_entry_snapshot(entity)

    async def find_latest_gate_entry_for_vehicle(
        self,
        vehicle_number: str,
    ) -> Optional[GateEntrySnapshot]:
        normalized = vehicle_number.strip()
        if not normalized:
            return None

        result = await self._session.execute(
            select(GateEntryModel)
            .where(GateEntryModel.vehicle_number.ilike(normalized))
            .order_by(
                GateEntryModel.created_at.desc(),
                GateEntryModel.id.desc(),
            )
            .limit(1)
        )
        entity = result.scalar_one_or_none()
        if entity is None:
            return None
        return self._to_gate_entry_snapshot(entity)

    @staticmethod
    def _to_gate_entry_snapshot(
        entity: GateEntryModel,
    ) -> GateEntrySnapshot:
        return GateEntrySnapshot(
            id=str(entity.id),
            gate_entry_number=entity.gate_entry_number,
            status=entity.status,
            po_id=_string_or_none(entity.po_id),
            po_number=entity.po_number,
            asn_id=_string_or_none(entity.asn_id),
            vehicle_number=entity.vehicle_number,
            driver_name=entity.driver_name,
            driver_phone=entity.driver_phone,
            assigned_dock_id=entity.assigned_dock_id,
            created_at=entity.created_at,
        )

    # ========================================================================
    # EXISTING GRN
    # ========================================================================

    async def find_grn_header_by_po(
        self,
        *,
        po_id: str | None = None,
        po_number: str | None = None,
    ) -> Optional[GrnHeaderSnapshot]:
        """
        Find the already-existing GRN for the PO.

        This method is important for:
            One PO -> One GRN

        Later partial receipts must update/reuse this row rather than create
        another GRN.
        """

        conditions = []

        po_uuid = _uuid_or_none(po_id)

        if po_uuid is not None:
            conditions.append(GrnModel.po_id == po_uuid)

        if po_number:
            conditions.append(
                GrnModel.po_number == str(po_number).strip()
            )

        if not conditions:
            return None

        result = await self._session.execute(
            select(GrnModel)
            .where(or_(*conditions))
            .limit(1)
        )

        entity = result.scalar_one_or_none()

        if entity is None:
            return None

        return GrnHeaderSnapshot(
            id=str(entity.id),
            status=entity.status,
            grn_number=entity.grn_number,
            po_id=_string_or_none(entity.po_id),
            po_number=entity.po_number,
            asn_id=_string_or_none(entity.asn_id),
            asn_number=entity.asn_number,
            gate_entry_id=_string_or_none(entity.gate_entry_id),
            gate_entry_number=entity.gate_entry_number,
            supplier_name=entity.supplier_name,
            supplier_company_name=entity.supplier_company_name,
            warehouse_id=entity.warehouse_id,
            warehouse_name=entity.warehouse_name,
            dock_number=entity.dock_number,
            vehicle_number=entity.vehicle_number,
            driver_name=entity.driver_name,
            invoice_number=entity.invoice_number,
            receipt_type=entity.receipt_type,
            receipt_date=entity.receipt_date,
            received_by=entity.received_by,
        )

    # ========================================================================
    # RECEIVING DOCK OPTIONS
    # ========================================================================

    async def list_docks_for_warehouse(
        self,
        warehouse_id: str | None = None,
    ) -> list[WarehouseDockSnapshot]:
        """
        Return valid dock options.

        MAINTENANCE docks are excluded.
        AVAILABLE/OCCUPIED state is still returned so the UI/use case can
        decide what should be selectable.

        Crucially, this does not copy Gate Entry assigned_dock_id into GRN.
        """

        stmt = select(DockModel).where(DockModel.status != "MAINTENANCE")
        if warehouse_id and warehouse_id.strip():
            stmt = stmt.where(DockModel.warehouse_id == warehouse_id.strip())

        stmt = stmt.order_by(DockModel.dock_number.asc())
        result = await self._session.execute(stmt)
        docks = result.scalars().all()

        return [
            WarehouseDockSnapshot(
                id=str(dock.id),
                dock_number=dock.dock_number,
                warehouse_id=dock.warehouse_id,
                dock_type=dock.dock_type,
                capacity=dock.capacity,
                status=dock.status,
            )
            for dock in docks
        ]

    # ========================================================================
    # LEGACY GRN AGGREGATE PERSISTENCE
    # ========================================================================

    async def save(
        self,
        grn: GoodsReceiptNote,
    ) -> None:
        """
        Persist the existing domain aggregate.

        This method remains compatible with the old ConfirmGrnUseCase.
        The richer page-wise GRN workflow can use dedicated application
        methods/repository operations added in the next step.
        """

        entity = GrnModel(
            id=grn.id.value,
            po_id=grn.po_id.value,
            status=grn.status.value,
        )

        for line in grn.lines:
            received_quantity = Decimal(line.received_quantity)

            entity.lines.append(
                GrnLineModel(
                    item_code=line.item_code,
                    received_quantity=received_quantity,
                    ordered_quantity=line.ordered_quantity,

                    # New GRN schema fields have safe defaults, but setting
                    # these explicitly keeps the persisted row clear.
                    good_quantity=received_quantity,
                    damaged_quantity=Decimal("0"),
                    rejected_quantity=Decimal("0"),
                    quality_approved_quantity=Decimal("0"),

                    # Remaining quantity for this simple legacy flow.
                    balance_quantity=(
                        max(
                            Decimal(line.ordered_quantity)
                            - received_quantity,
                            Decimal("0"),
                        )
                        if line.ordered_quantity is not None
                        else Decimal("0")
                    ),
                )
            )

        self._session.add(entity)

        for event in grn.domain_events:
            self._session.add(
                to_outbox_row(
                    "GoodsReceiptNote",
                    str(grn.id),
                    event,
                )
            )

        await self._session.flush()

    async def find_by_id(
        self,
        grn_id: GrnId,
    ) -> Optional[GoodsReceiptNote]:
        """
        Rehydrate the legacy GoodsReceiptNote aggregate.

        The legacy domain aggregate requires a PO ID, so an
        UNEXPECTED_DELIVERY GRN (po_id is NULL) is intentionally not
        represented through this old method.
        """

        result = await self._session.execute(
            select(GrnModel)
            .options(selectinload(GrnModel.lines))
            .where(GrnModel.id == grn_id.value)
        )

        entity = result.scalar_one_or_none()

        if entity is None:
            return None

        if entity.po_id is None:
            return None

        lines = [
            ReceiptLine(
                item_code=line.item_code,
                received_quantity=Decimal(line.received_quantity),
                ordered_quantity=(
                    Decimal(line.ordered_quantity)
                    if line.ordered_quantity is not None
                    else None
                ),
            )
            for line in entity.lines
        ]

        return GoodsReceiptNote.rehydrate(
            GrnId.of(entity.id),
            PurchaseOrderId.of(entity.po_id),
            GrnStatus(entity.status),
            lines,
        )

    # ========================================================================
    # EXTENDED GRN WORKFLOW METHODS
    # ========================================================================

    async def create_or_update_grn_header(
        self,
        *,
        receipt_type: str,
        dock_number: str,
        grn_id: str | None = None,
        po_id: str | None = None,
        po_number: str | None = None,
        asn_number: str | None = None,
        gate_entry_id: str | None = None,
        gate_entry_number: str | None = None,
        invoice_number: str | None = None,
        supplier_name: str | None = None,
        supplier_company_name: str | None = None,
        warehouse_id: str | None = None,
        warehouse_name: str | None = None,
        vehicle_number: str | None = None,
        driver_name: str | None = None,
        received_by: str,
        verification_notes: str | None = None,
    ) -> GrnModel:
        now = datetime.now(timezone.utc)
        grn_uuid: uuid.UUID | None = _uuid_or_none(grn_id) if grn_id else None
        existing: GrnModel | None = None
        is_unexpected = receipt_type == "UNEXPECTED_DELIVERY"
        asn_receipt = receipt_type == "ASN_RECEIPT"

        resolved_sup_name, resolved_sup_company = await _resolve_real_supplier_names(
            self._session,
            po_id=po_id,
            po_number=po_number,
            raw_supplier_name=supplier_name,
            raw_supplier_company=supplier_company_name,
            is_unexpected=is_unexpected,
        )

        if not grn_uuid and asn_receipt and asn_number:
            # Repeated Fetch Details must resume the same persisted draft.
            existing_id = await self._session.scalar(
                select(GrnModel.id).where(GrnModel.asn_number == asn_number.strip())
                .order_by(GrnModel.created_at.desc()).limit(1)
            )
            if existing_id:
                grn_uuid = existing_id

        if not grn_uuid and (po_id or po_number):
            existing_snapshot = await self.find_grn_header_by_po(po_id=po_id, po_number=po_number)
            if existing_snapshot:
                grn_uuid = _uuid_or_none(existing_snapshot.id)

        if grn_uuid:
            res = await self._session.execute(
                select(GrnModel).options(selectinload(GrnModel.lines)).where(GrnModel.id == grn_uuid)
            )
            existing = res.scalar_one_or_none()

        if existing:
            if not grn_id and str(existing.status).upper() in {"COMPLETED", "PARTIALLY_COMPLETED", "PARTIALLY COMPLETED", "POSTED"}:
                raise ValueError(f"ASN already received under {existing.grn_number}. Open GRN History to view it.")
            existing.dock_number = dock_number
            existing.receipt_type = receipt_type
            if receipt_type == "UNEXPECTED_DELIVERY":
                existing.po_id = None
                existing.po_number = None
                existing.asn_id = None
                existing.asn_number = None
            if invoice_number is not None: existing.invoice_number = invoice_number
            existing.supplier_name = resolved_sup_name
            existing.supplier_company_name = resolved_sup_company
            if warehouse_id is not None: existing.warehouse_id = warehouse_id
            if warehouse_name is not None: existing.warehouse_name = warehouse_name
            if vehicle_number is not None: existing.vehicle_number = vehicle_number
            if driver_name is not None: existing.driver_name = driver_name
            if gate_entry_id is not None: existing.gate_entry_id = _uuid_or_none(gate_entry_id)
            if gate_entry_number is not None: existing.gate_entry_number = gate_entry_number
            if verification_notes is not None: existing.verification_notes = verification_notes

            # Older ASN-based GRNs may contain only the header because ASN
            # lines were not copied when they were first created. Backfill
            # the editable receiving rows from the persisted ASN once, while
            # preserving any lines already entered by the operator.
            if asn_receipt and asn_number and not existing.lines:
                asn_result = await self._session.execute(
                    select(AsnModel)
                    .options(selectinload(AsnModel.lines))
                    .where(AsnModel.asn_number == asn_number.strip())
                    .order_by(AsnModel.created_at.desc())
                )
                asn_for_lines = asn_result.scalars().first()
                if asn_for_lines:
                    for line in (asn_for_lines.lines or []):
                        existing.lines.append(
                            GrnLineModel(
                                id=uuid.uuid4(),
                                item_code=line.item_code,
                                material_name=line.material_name or line.item_code,
                                material_category="General",
                                uom=line.uom or "PCS",
                                ordered_quantity=line.shipped_quantity or Decimal("0"),
                                received_quantity=Decimal("0"),
                                good_quantity=Decimal("0"),
                                damaged_quantity=Decimal("0"),
                                rejected_quantity=Decimal("0"),
                                quality_approved_quantity=Decimal("0"),
                                balance_quantity=line.shipped_quantity or Decimal("0"),
                            )
                        )
            existing.updated_at = now
            await self._session.flush()
            return existing

        year = now.strftime("%Y")
        year_prefix = f"GRN-{year}-"
        if self._session.get_bind().dialect.name == "postgresql":
            await self._session.execute(
                text("SELECT pg_advisory_xact_lock(:key)"), {"key": 740000 + int(year)}
            )
        count_res = await self._session.execute(
            select(GrnModel).where(GrnModel.grn_number.like(f"{year_prefix}%"))
        )
        grn_num = next_grn_number(
            [row.grn_number for row in count_res.scalars().all()], year,
        )

        po_uuid = None if is_unexpected or asn_receipt else _uuid_or_none(po_id)
        po_num_val = None if is_unexpected or asn_receipt else po_number
        asn_id_val: uuid.UUID | None = None
        asn_num_val: str | None = asn_number if asn_receipt else None
        gate_id_val: uuid.UUID | None = _uuid_or_none(gate_entry_id) if gate_entry_id else None
        gate_num_val: str | None = gate_entry_number
        gate = None

        if asn_receipt and asn_number:
            asn = (await self._session.execute(
                select(AsnModel)
                .options(selectinload(AsnModel.lines))
                .where(AsnModel.asn_number == asn_number.strip())
                .order_by(AsnModel.created_at.desc())
            )).scalars().first()
            if asn:
                asn_id_val = _uuid_or_none(asn.id)
                asn_num_val = asn.asn_number
                vehicle_number = vehicle_number or asn.vehicle_number
                driver_name = driver_name or asn.driver_name
                warehouse_id = warehouse_id or asn.warehouse_id

                # Prefer the gate pass carried by the receiving context. Older
                # records may have a valid GateEntry but a missing ASN FK, so
                # also resolve against the ASN's PO/vehicle before rejecting.
                gate_linked_by_assignment = False
                if gate_entry_id:
                    gate = await self.find_gate_entry_by_id(gate_entry_id)
                if gate is None and gate_entry_number:
                    gate_result = await self._session.execute(
                        select(GateEntryModel)
                        .where(func.upper(GateEntryModel.gate_entry_number) == gate_entry_number.strip().upper())
                        .limit(1)
                    )
                    gate_model = gate_result.scalar_one_or_none()
                    if gate_model is not None:
                        gate = self._to_gate_entry_snapshot(gate_model)
                if gate is None:
                    gate = await self.find_latest_gate_entry_for_asn(asn.id)

                # In migrated data the gate row's ASN FK can be empty while
                # the dock assignment still retains the correct ASN link.
                if gate is None:
                    assigned_gate_result = await self._session.execute(
                        select(GateEntryModel)
                        .join(
                            DockAssignmentModel,
                            DockAssignmentModel.gate_entry_id == GateEntryModel.id,
                        )
                        .where(DockAssignmentModel.asn_id == asn.id)
                        .order_by(DockAssignmentModel.assigned_at.desc())
                        .limit(1)
                    )
                    assigned_gate = assigned_gate_result.scalars().first()
                    if assigned_gate is not None:
                        gate = self._to_gate_entry_snapshot(assigned_gate)
                        # The dock assignment is an explicit ASN-to-gate link.
                        if not gate.asn_id or _uuid_or_none(gate.asn_id) == _uuid_or_none(asn.id):
                            gate_linked_by_assignment = True
                            gate_id_val = _uuid_or_none(gate.id)
                            gate_num_val = gate.gate_entry_number
                        else:
                            gate = None

                def gate_matches_asn(candidate: GateEntrySnapshot) -> bool:
                    if candidate.asn_id:
                        return _uuid_or_none(candidate.asn_id) == _uuid_or_none(asn.id)
                    po_matches = bool(
                        candidate.po_number
                        and asn.po_number
                        and candidate.po_number.strip().upper() == asn.po_number.strip().upper()
                    )
                    gate_vehicle = (candidate.vehicle_number or "").replace(" ", "").upper()
                    asn_vehicle = (asn.vehicle_number or "").replace(" ", "").upper()
                    vehicle_matches = bool(gate_vehicle and asn_vehicle and gate_vehicle == asn_vehicle)
                    if gate_vehicle and asn_vehicle:
                        return vehicle_matches and (po_matches or not asn.po_number)
                    return po_matches

                if gate is not None and not gate_linked_by_assignment and not gate_matches_asn(gate):
                    gate = None
                # Prefer the explicit ASN-to-dock assignment when a legacy
                # gate row carries a stale or missing ASN foreign key. The
                # assignment is created during dock allocation and records
                # which ASN is being received.
                if gate is None:
                    assigned_gate_result = await self._session.execute(
                        select(GateEntryModel)
                        .join(
                            DockAssignmentModel,
                            DockAssignmentModel.gate_entry_id == GateEntryModel.id,
                        )
                        .where(DockAssignmentModel.asn_id == asn.id)
                        .order_by(DockAssignmentModel.assigned_at.desc())
                        .limit(1)
                    )
                    assigned_gate = assigned_gate_result.scalars().first()
                    if assigned_gate is not None:
                        gate = self._to_gate_entry_snapshot(assigned_gate)
                        gate_linked_by_assignment = True
                if gate is None and asn.po_number:
                    candidate = await self.find_latest_gate_entry_for_po(asn.po_number)
                    if candidate and gate_matches_asn(candidate):
                        gate = candidate
                if gate is None and asn.vehicle_number:
                    candidate = await self.find_latest_gate_entry_for_vehicle(asn.vehicle_number)
                    if candidate and gate_matches_asn(candidate):
                        gate = candidate

                # Some legacy allocations have no ASN foreign key on either
                # the gate row or the dock assignment. When this exact dock
                # is actively allocated to the ASN vehicle, use that persisted
                # allocation as the link to its gate entry.
                active_allocation = None
                if dock_number and (vehicle_number or gate_entry_number or gate_entry_id):
                    allocation_links = []
                    if vehicle_number:
                        allocation_links.append(
                            func.upper(DockAllocationRequestModel.vehicle_number)
                            == vehicle_number.strip().upper()
                        )
                    if gate_entry_number:
                        allocation_links.append(
                            func.upper(DockAllocationRequestModel.existing_gate_pass_id)
                            == gate_entry_number.strip().upper()
                        )
                    if gate_entry_id:
                        allocation_links.append(
                            func.upper(DockAllocationRequestModel.existing_gate_pass_id)
                            == gate_entry_id.strip().upper()
                        )
                    allocation_result = await self._session.execute(
                        select(DockAllocationRequestModel)
                        .join(
                            DockMasterModel,
                            DockMasterModel.id == DockAllocationRequestModel.assigned_dock_id,
                        )
                        .where(
                            func.upper(DockMasterModel.dock_code) == dock_number.strip().upper(),
                            or_(*allocation_links),
                            DockAllocationRequestModel.status.in_(
                                ["DOCK_ASSIGNED", "RESERVED", "OCCUPIED", "AT_DOCK"]
                            ),
                        )
                        .order_by(DockAllocationRequestModel.assigned_at.desc())
                        .limit(1)
                    )
                    active_allocation = allocation_result.scalars().first()
                    if gate is None and active_allocation and active_allocation.existing_gate_pass_id:
                        allocation_gate = await self.find_gate_entry_by_id(
                            active_allocation.existing_gate_pass_id
                        )
                        if allocation_gate is None:
                            gate_result = await self._session.execute(
                                select(GateEntryModel)
                                .where(
                                    func.upper(GateEntryModel.gate_entry_number)
                                    == active_allocation.existing_gate_pass_id.strip().upper()
                                )
                                .limit(1)
                            )
                            gate_model = gate_result.scalar_one_or_none()
                            if gate_model is not None:
                                allocation_gate = self._to_gate_entry_snapshot(gate_model)
                        if allocation_gate is not None:
                            gate = allocation_gate
                            gate_linked_by_assignment = True
                if gate:
                    gate_id_val = _uuid_or_none(gate.id)
                    gate_num_val = gate.gate_entry_number

                if gate is None:
                    raise ValueError("ASN is not linked to a valid gate entry")
                assignment_result = await self._session.execute(
                    select(DockAssignmentModel).where(
                        DockAssignmentModel.gate_entry_id == gate.id
                    )
                )
                assignment = assignment_result.scalars().first()
                # The configured warehouse workflow begins receiving as soon
                # as the dock is allocated. Older installations may not
                # record a separate arrival timestamp, so the assignment is
                # the authoritative link for GRN eligibility.
                if assignment is None and active_allocation is None:
                    raise ValueError("Receiving can start only after a dock is allocated")
                if assignment is None and active_allocation is not None:
                    # Backfill the missing gate-side assignment for this
                    # legacy warehouse allocation so GRN completion can
                    # release the same dock through the normal workflow.
                    assignment = DockAssignmentModel(
                        gate_entry_id=_uuid_or_none(gate.id),
                        asn_id=asn_id_val,
                        po_id=_uuid_or_none(asn.po_id) if getattr(asn, "po_id", None) else None,
                        vehicle_number=vehicle_number or asn.vehicle_number,
                        dock_number=dock_number.strip(),
                        assigned_by=active_allocation.assigned_by or "WAREHOUSE",
                        assigned_at=active_allocation.assigned_at or now,
                    )
                    self._session.add(assignment)
                    await self._session.flush()

                if not (warehouse_id or "").strip():
                    warehouse_id = await _warehouse_for_receiving_dock(self._session, assignment.dock_number)

                duplicate_result = await self._session.execute(
                    select(GrnModel)
                    .options(selectinload(GrnModel.lines))
                    .where(
                        GrnModel.asn_id == asn_id_val,
                        GrnModel.status.notin_(["CANCELLED", "VOID"]),
                    )
                    .limit(1)
                )
                existing_for_asn = duplicate_result.scalar_one_or_none()
                if existing_for_asn is not None:
                    # This ASN already has the receiving event. Resume and
                    # update that GRN instead of creating or rejecting a
                    # second header when the operator clicks Save & Continue.
                    existing_for_asn.dock_number = dock_number or existing_for_asn.dock_number or assignment.dock_number
                    existing_for_asn.gate_entry_id = _uuid_or_none(gate.id)
                    existing_for_asn.gate_entry_number = gate.gate_entry_number
                    existing_for_asn.vehicle_number = vehicle_number or existing_for_asn.vehicle_number
                    existing_for_asn.driver_name = driver_name or existing_for_asn.driver_name
                    existing_for_asn.warehouse_id = warehouse_id or existing_for_asn.warehouse_id
                    existing_for_asn.asn_id = asn_id_val
                    existing_for_asn.asn_number = asn.asn_number
                    existing_for_asn.updated_at = now
                    await self._session.flush()
                    return existing_for_asn
        if not is_unexpected and not asn_receipt and (po_uuid or po_number):
            asn = await self.find_latest_asn_for_po(po_id=po_id, po_number=po_number)
            if asn:
                asn_id_val = _uuid_or_none(asn.id)
                asn_num_val = asn.asn_number
                vehicle_number = vehicle_number or asn.vehicle_number
                driver_name = driver_name or asn.driver_name
                warehouse_id = warehouse_id or asn.warehouse_id
                gate = await self.find_latest_gate_entry_for_asn(asn.id)
                if gate:
                    gate_id_val = _uuid_or_none(gate.id)
                    gate_num_val = gate.gate_entry_number

        if not is_unexpected and not gate_id_val and po_number:
            gate = await self.find_latest_gate_entry_for_po(po_number)
            if gate:
                gate_id_val = _uuid_or_none(gate.id)
                gate_num_val = gate.gate_entry_number

        if is_unexpected and not gate_id_val and vehicle_number:
            gate = await self.find_latest_gate_entry_for_vehicle(vehicle_number)
            if gate:
                gate_id_val = _uuid_or_none(gate.id)
                gate_num_val = gate.gate_entry_number

        if not (warehouse_id or "").strip():
            warehouse_id = await _warehouse_for_receiving_dock(self._session, dock_number)
        if not (warehouse_id or "").strip():
            raise ValueError("A configured warehouse must be selected before creating a GRN")
        if not (received_by or "").strip():
            raise ValueError("Authenticated receiving user is required to create a GRN")

        new_grn = GrnModel(
            id=uuid.uuid4(),
            po_id=po_uuid,
            po_number=po_num_val,
            grn_number=grn_num,
            asn_id=asn_id_val,
            asn_number=asn_num_val,
            gate_entry_id=gate_id_val,
            gate_entry_number=gate_num_val,
            supplier_name=resolved_sup_name,
            supplier_company_name=resolved_sup_company,
            warehouse_id=warehouse_id,
            warehouse_name=warehouse_name,
            dock_number=dock_number,
            vehicle_number=vehicle_number,
            driver_name=driver_name,
            invoice_number=invoice_number,
            receipt_type=receipt_type,
            receipt_date=now,
            received_by=received_by,
            status="DRAFT",
            verification_notes=verification_notes,
            created_at=now,
            updated_at=now,
        )

        if not is_unexpected and (po_uuid or po_number):
            po_snap = None
            if po_uuid:
                try:
                    po_snap = await self.find_purchase_order(PurchaseOrderId.of(po_uuid))
                except Exception:
                    pass
            if not po_snap and po_number:
                po_snap = await self.find_purchase_order_by_number(po_number)
            if po_snap:
                if not new_grn.supplier_name or _is_uuid_string(new_grn.supplier_name):
                    new_grn.supplier_name = po_snap.supplier_name
                    new_grn.supplier_company_name = po_snap.supplier_company_name or po_snap.supplier_name
                for line in po_snap.lines:
                    new_grn.lines.append(
                        GrnLineModel(
                            id=uuid.uuid4(),
                            item_code=line.item_code,
                            material_name=line.material_name or line.item_code,
                            material_category=line.material_category or "General",
                            variant_code=line.variant_code,
                            uom=line.uom or "PCS",
                            ordered_quantity=line.ordered_quantity,
                            received_quantity=Decimal("0"),
                            good_quantity=Decimal("0"),
                            damaged_quantity=Decimal("0"),
                            rejected_quantity=Decimal("0"),
                            quality_approved_quantity=Decimal("0"),
                            balance_quantity=line.ordered_quantity,
                        )
                    )

        # ASN receipts do not require a PO. Seed the editable receiving rows
        # from the persisted ASN shipment lines so Item Receiving opens with
        # the actual material, quantity, and UOM from the shipment.
        if asn_receipt and asn is not None:
            for line in (asn.lines or []):
                new_grn.lines.append(
                    GrnLineModel(
                        id=uuid.uuid4(),
                        item_code=line.item_code,
                        material_name=line.material_name or line.item_code,
                        material_category="General",
                        uom=line.uom or "PCS",
                        ordered_quantity=line.shipped_quantity or Decimal("0"),
                        received_quantity=Decimal("0"),
                        good_quantity=Decimal("0"),
                        damaged_quantity=Decimal("0"),
                        rejected_quantity=Decimal("0"),
                        quality_approved_quantity=Decimal("0"),
                        balance_quantity=line.shipped_quantity or Decimal("0"),
                    )
                )

        self._session.add(new_grn)
        await self._session.flush()
        return new_grn

    async def update_grn_lines(
        self,
        grn_id: uuid.UUID,
        lines_data: list[dict],
    ) -> GrnModel:
        res = await self._session.execute(
            select(GrnModel).options(selectinload(GrnModel.lines)).where(GrnModel.id == grn_id)
        )
        grn = res.scalar_one_or_none()
        if not grn:
            raise ValueError(f"GRN not found: {grn_id}")
        if not (grn.warehouse_id or "").strip():
            raise ValueError("GRN must be assigned to a warehouse before it can be posted")

        is_unexpected = grn.receipt_type == "UNEXPECTED_DELIVERY"
        line_map = {l.item_code: l for l in grn.lines}
        submitted_codes = set()

        for item in lines_data:
            code = item["item_code"]
            submitted_codes.add(code)
            if item.get("received_quantity") is not None:
                received = Decimal(str(item["received_quantity"]))
                good = Decimal(str(item["good_quantity"])) if item.get("good_quantity") is not None else received
                damaged = Decimal(str(item["damaged_quantity"])) if item.get("damaged_quantity") is not None else Decimal("0")
                rejected = Decimal(str(item.get("rejected_quantity", 0) or 0))
                held = Decimal(str(item.get("held_quantity", 0) or 0))
            else:
                good = Decimal(str(item.get("good_quantity", 0)))
                damaged = Decimal(str(item.get("damaged_quantity", 0)))
                rejected = Decimal(str(item.get("rejected_quantity", 0) or 0))
                held = Decimal(str(item.get("held_quantity", 0) or 0))
                received = good + damaged + rejected + held

            if code in line_map:
                line = line_map[code]
                if item.get("material_name"): line.material_name = item["material_name"]
                if item.get("material_category"): line.material_category = item["material_category"]
                if item.get("variant_code"): line.variant_code = item["variant_code"]
                if item.get("uom"): line.uom = item["uom"]
                line.received_quantity = received
                line.good_quantity = good
                line.damaged_quantity = damaged
                line.rejected_quantity = rejected
                line.held_quantity = held
                line.rejected_reason = item.get("rejected_reason")
                line.damage_reason = item.get("damage_reason")
                line.held_reason = item.get("held_reason")
                line.quality_approved_quantity = good
                if is_unexpected:
                    line.ordered_quantity = None
                    line.balance_quantity = Decimal("0")
                else:
                    ordered = line.ordered_quantity or Decimal("0")
                    line.balance_quantity = max(ordered - received, Decimal("0"))
            else:
                ordered = None if is_unexpected else Decimal("0")
                grn.lines.append(
                    GrnLineModel(
                        id=uuid.uuid4(),
                        grn_id=grn.id,
                        item_code=code,
                        material_name=item.get("material_name", code),
                        material_category=item.get("material_category", "General"),
                        variant_code=item.get("variant_code"),
                        uom=item.get("uom", "PCS"),
                        ordered_quantity=ordered,
                        received_quantity=received,
                        good_quantity=good,
                        damaged_quantity=damaged,
                        rejected_quantity=rejected,
                        held_quantity=held,
                        rejected_reason=item.get("rejected_reason"),
                        damage_reason=item.get("damage_reason"),
                        held_reason=item.get("held_reason"),
                        quality_approved_quantity=good,
                        balance_quantity=Decimal("0"),
                    )
                )

        if is_unexpected and submitted_codes:
            lines_to_keep = [l for l in grn.lines if l.item_code in submitted_codes]
            for l in list(grn.lines):
                if l.item_code not in submitted_codes:
                    await self._session.delete(l)
            grn.lines = lines_to_keep

        grn.status = "PARTIALLY_COMPLETED"
        grn.updated_at = datetime.now(timezone.utc)
        await self._session.flush()
        return grn

    async def add_damage_evidence(
        self,
        grn_line_id: uuid.UUID,
        damaged_quantity: Decimal,
        reason: str | None,
        remarks: str | None,
        file_name: str,
        file_path: str,
        uploaded_by: str,
    ) -> GrnDamageEvidenceModel:
        evidence = GrnDamageEvidenceModel(
            id=uuid.uuid4(),
            grn_line_id=grn_line_id,
            damaged_quantity=damaged_quantity,
            reason=reason,
            remarks=remarks,
            file_name=file_name,
            file_path=file_path,
            uploaded_by=uploaded_by,
            uploaded_at=datetime.now(timezone.utc),
        )
        self._session.add(evidence)
        await self._session.flush()
        return evidence

    async def update_quality_inspection(
        self,
        grn_id: uuid.UUID,
        quality_data: list[dict],
    ) -> GrnModel:
        res = await self._session.execute(
            select(GrnModel).options(selectinload(GrnModel.lines)).where(GrnModel.id == grn_id)
        )
        grn = res.scalar_one_or_none()
        if not grn:
            raise ValueError(f"GRN not found: {grn_id}")

        line_id_map = {str(l.id): l for l in grn.lines}
        line_code_map = {l.item_code: l for l in grn.lines}

        for item in quality_data:
            line = None
            if "grn_line_id" in item and str(item["grn_line_id"]) in line_id_map:
                line = line_id_map[str(item["grn_line_id"])]
            elif "item_code" in item and item["item_code"] in line_code_map:
                line = line_code_map[item["item_code"]]

            if line is not None:
                received_qty = line.received_quantity or Decimal("0")
                accepted_qty = Decimal(str(item.get("accepted_quantity", item.get("good_quantity", 0)) or 0))
                rejected_qty = Decimal(str(item.get("rejected_quantity", 0) or 0))
                damaged_qty = Decimal(str(item.get("damaged_quantity", 0) or 0))
                held_qty = Decimal(str(item.get("held_quantity", 0) or 0))
                if accepted_qty + rejected_qty + damaged_qty + held_qty != received_qty:
                    raise ValueError(
                        f"Accepted, rejected, damaged, and held quantities must equal received quantity for {line.item_code}"
                    )
                if rejected_qty > 0 and not str(item.get("rejected_reason") or "").strip():
                    raise ValueError(f"Rejected reason is required for {line.item_code}")
                if damaged_qty > 0 and not str(item.get("damage_reason") or "").strip():
                    raise ValueError(f"Damage reason is required for {line.item_code}")
                if held_qty > 0 and not str(item.get("held_reason") or "").strip():
                    raise ValueError(f"Held reason is required for {line.item_code}")
                line.quality_result = item.get("quality_result", "ACCEPTED")
                line.accepted_quantity = accepted_qty
                line.rejected_quantity = rejected_qty
                line.held_quantity = held_qty
                line.rejected_reason = item.get("rejected_reason")
                line.damage_reason = item.get("damage_reason")
                line.held_reason = item.get("held_reason")
                line.quality_approved_quantity = line.accepted_quantity
                line.good_quantity = line.accepted_quantity
                line.damaged_quantity = damaged_qty

        grn.updated_at = datetime.now(timezone.utc)
        await self._session.flush()
        return grn

    async def create_batches_for_line(
        self,
        grn_line_id: uuid.UUID,
        batch_quantities: list[Decimal],
        created_by: str,
    ) -> list[GrnBatchModel]:
        res = await self._session.execute(
            select(GrnLineModel).where(GrnLineModel.id == grn_line_id)
        )
        line = res.scalar_one_or_none()
        if not line:
            raise ValueError(f"GRN Line not found: {grn_line_id}")

        now = datetime.now(timezone.utc)

        approved_qty = line.quality_approved_quantity if (line.quality_approved_quantity is not None and line.quality_approved_quantity > Decimal("0")) else line.good_quantity
        if approved_qty <= Decimal("0"):
            return []

        if not batch_quantities or any(q <= Decimal("0") for q in batch_quantities):
            raise ValueError("Batch quantities must be greater than zero")
        existing_batches = await self._session.execute(
            select(GrnBatchModel)
            .where(GrnBatchModel.grn_line_id == grn_line_id)
            .where(GrnBatchModel.superseded.is_(False))
            .order_by(GrnBatchModel.created_at.asc())
        )
        persisted_batches = list(existing_batches.scalars().all())
        if persisted_batches:
            # Batch creation is idempotent. A retry returns the original
            # records instead of generating another set of LOT identifiers.
            return persisted_batches
        if sum(batch_quantities, Decimal("0")) != approved_qty:
            raise ValueError("Total batch quantity must equal the QC-accepted quantity")

        # Fetch warehouse name for QR payload
        wh_res = await self._session.execute(
            select(GrnModel.warehouse_name).where(GrnModel.id == line.grn_id)
        )
        wh_name = wh_res.scalar_one_or_none() or "Main Warehouse"

        # 1. Reuse the material-level QR if present. Batch QRs below are
        # intentionally one-per-batch and may share the same item_code.
        qr_res = await self._session.execute(
            select(GrnBatchQrModel)
            .where(GrnBatchQrModel.item_code == line.item_code)
            .order_by(GrnBatchQrModel.generated_at.asc())
        )
        # Older data may contain more than one material QR for the same item
        # code. Reuse the first deterministic record instead of failing with
        # MultipleResultsFound during an otherwise idempotent batch retry.
        qr = qr_res.scalars().first()
        if not qr:
            qr_payload = "\n".join([
                f"Material Code: {line.item_code}",
                f"Material Name: {line.material_name or line.item_code}",
                f"Material Category: {line.material_category or 'Raw Materials'}",
                f"Material Variant Code: {line.variant_code or f'{line.item_code}-V001'}",
                f"Batch: BATCH-{line.item_code}-001",
                "Size: 25 mm × 3 m",
                "Color: White",
                f"Warehouse: {wh_name}",
                "Grade: ISI",
                f"UOM: {line.uom or 'PCS'}",
                "Inspection Status: COMPLETED",
                f"Batch Quantity: {approved_qty} {line.uom or 'PCS'}",
            ])
            qr = GrnBatchQrModel(
                id=uuid.uuid4(),
                item_code=line.item_code,
                qr_code=f"QR-MAT-{line.item_code}",
                qr_payload=qr_payload,
                generated_at=now,
            )
            self._session.add(qr)
            await self._session.flush()

        created_batches: list[GrnBatchModel] = []
        for idx, qty in enumerate(batch_quantities, 1):
            batch_num = f"LOT-{line.item_code}-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
            batch = GrnBatchModel(
                id=uuid.uuid4(),
                grn_line_id=grn_line_id,
                batch_number=batch_num,
                batch_quantity=qty,
                created_by=created_by,
                created_at=now,
            )
            self._session.add(batch)
            created_batches.append(batch)

        await self._session.flush()
        for batch in created_batches:
            self._session.add(GrnBatchQrModel(
                id=uuid.uuid4(),
                batch_id=batch.id,
                item_code=line.item_code,
                qr_code=f"QR-BATCH-{batch.batch_number}",
                qr_payload=(
                    f"Material Code: {line.item_code}\n"
                    f"Material Name: {line.material_name or line.item_code}\n"
                    f"GRN ID: {line.grn_id}\n"
                    f"Batch: {batch.batch_number}\n"
                    f"Batch Quantity: {batch.batch_quantity} {line.uom or 'PCS'}\n"
                    "Status: QC_ACCEPTED"
                ),
                generated_at=now,
            ))
        await self._session.flush()
        return created_batches

    async def create_or_get_damage_lots_for_grn(
        self,
        grn_id: uuid.UUID,
        created_by: str = "System User",
    ) -> list[GrnDamageLotModel]:
        """
        Creates or retrieves Damage Lots and Damage QRs for all GRN lines where
        damaged_quantity > 0 or rejected_quantity > 0.
        One Damage Lot = One Damage QR.
        Chain: GRN -> GRN Line -> Damage Evidence -> Damage Lot -> Damage QR -> Quarantine Area
        """
        res = await self._session.execute(
            select(GrnModel)
            .options(
                selectinload(GrnModel.lines).selectinload(GrnLineModel.damage_evidence),
                selectinload(GrnModel.lines).selectinload(GrnLineModel.batches),
                selectinload(GrnModel.lines).selectinload(GrnLineModel.damage_lots).selectinload(GrnDamageLotModel.qr_code),
            )
            # The same GRN may already be present in this UoW's identity map
            # from the preceding save/post operation.  Refresh the existing
            # instances so the selectinload options are applied; otherwise a
            # relationship access below can fall back to async lazy loading,
            # which raises MissingGreenlet in this request handler.
            .execution_options(populate_existing=True)
            .where(GrnModel.id == grn_id)
        )
        grn = res.scalar_one_or_none()
        if not grn:
            raise ValueError(f"GRN not found: {grn_id}")

        if (grn.status or "").upper() in {"COMPLETED", "POSTED", "APPROVED", "ACCEPTED", "RECEIVING_COMPLETE", "GRN_POSTED"}:
            # Opening saved labels is read-only for a finalized receipt.
            # Never regenerate lots or change quantities after completion.
            return [lot for line in grn.lines for lot in line.damage_lots]
        if not grn.lines:
            raise ValueError("GRN cannot be completed without material lines")
        for line in grn.lines:
            accepted_qty = line.quality_approved_quantity or line.good_quantity or Decimal("0")
            if accepted_qty < Decimal("0"):
                raise ValueError(f"Accepted quantity is invalid for {line.item_code}")
            active_batches = [b for b in line.batches if not b.superseded]
            if active_batches and sum((b.batch_quantity or Decimal("0")) for b in active_batches) != accepted_qty:
                raise ValueError(f"Batch quantities do not match accepted quantity for {line.item_code}")

        now = datetime.now(timezone.utc)
        damage_lots: list[GrnDamageLotModel] = []

        for line in grn.lines:
            ev_qty = Decimal("0")
            if line.damage_evidence:
                ev_qty = max((e.damaged_quantity for e in line.damage_evidence if e.damaged_quantity), default=Decimal("0"))

            # Rejected and held quantities are separate QC outcomes. Never
            # substitute them for the actual damaged quantity.
            damaged_qty = line.damaged_quantity if line.damaged_quantity > Decimal("0") else ev_qty
            if damaged_qty <= Decimal("0"):
                continue

            if line.damaged_quantity != damaged_qty:
                line.damaged_quantity = damaged_qty

            # 1. Reuse existing Damage Lot for line if present AND update quantity if changed
            if line.damage_lots:
                lot = line.damage_lots[0]
                if lot.damaged_quantity != damaged_qty:
                    lot.damaged_quantity = damaged_qty
                    self._session.add(lot)

                reasons = [e.reason for e in line.damage_evidence if e.reason]
                reason_text = line.damage_evidence[0].reason if line.damage_evidence and line.damage_evidence[0].reason else (reasons[0] if reasons else "Damaged/Rejected during receiving inspection")
                wh_name = grn.warehouse_name if grn and grn.warehouse_name else "Main Warehouse"
                qr_code_str = f"DMG-{grn.grn_number}-{line.item_code}-01"
                qr_payload = "\n".join([
                    f"Material Code: {line.item_code}",
                    f"Material Name: {line.material_name or line.item_code}",
                    f"Material Category: {line.material_category or 'Raw Materials'}",
                    f"Material Variant Code: {line.item_code}-V001",
                    f"Batch: {lot.damage_lot_number}",
                    "Size: 25 mm × 3 m",
                    "Color: White",
                    f"Warehouse: {wh_name}",
                    "Grade: ISI",
                    f"UOM: {line.uom or 'BUNDLE'}",
                    "Inspection Status: PARTIAL",
                    f"Batch Quantity: {lot.damaged_quantity} {line.uom or 'BUNDLE'}",
                ])

                if not lot.qr_code:
                    qr = GrnDamageQrModel(
                        id=uuid.uuid4(),
                        damage_lot_id=lot.id,
                        grn_line_id=line.id,
                        grn_number=grn.grn_number or "",
                        item_code=line.item_code,
                        qr_code=qr_code_str,
                        qr_payload=qr_payload,
                        generated_by=created_by,
                        generated_at=now,
                    )
                    self._session.add(qr)
                    lot.qr_code = qr
                else:
                    lot.qr_code.qr_payload = qr_payload
                    lot.qr_code.item_code = line.item_code

                await self._session.flush()
                damage_lots.append(lot)
                continue

            # 2. Create new Damage Lot
            lot_num = f"DMG-LOT-{grn.grn_number}-{line.item_code}"
            reasons = [e.reason for e in line.damage_evidence if e.reason]
            reason_text = line.damage_evidence[0].reason if line.damage_evidence and line.damage_evidence[0].reason else (reasons[0] if reasons else "Damaged/Rejected during receiving inspection")

            lot = GrnDamageLotModel(
                id=uuid.uuid4(),
                grn_line_id=line.id,
                damage_lot_number=lot_num,
                damaged_quantity=damaged_qty,
                uom=line.uom or "BUNDLE",
                reason=reason_text,
                qa_status=line.quality_result or "REJECTED",
                quarantine_location="QUARANTINE-ZONE-A",
                status="DAMAGED",
                created_by=created_by,
                created_at=now,
            )
            self._session.add(lot)
            await self._session.flush()

            # 3. Create unique Damage QR
            wh_name = grn.warehouse_name if grn and grn.warehouse_name else "Main Warehouse"
            qr_code_str = f"DMG-{grn.grn_number}-{line.item_code}-01"
            qr_payload = "\n".join([
                f"Material Code: {line.item_code}",
                f"Material Name: {line.material_name or line.item_code}",
                f"Material Category: {line.material_category or 'Raw Materials'}",
                f"Material Variant Code: {line.item_code}-V001",
                f"Batch: {lot.damage_lot_number}",
                "Size: 25 mm × 3 m",
                "Color: White",
                f"Warehouse: {wh_name}",
                "Grade: ISI",
                f"UOM: {line.uom or 'BUNDLE'}",
                "Inspection Status: PARTIAL",
                f"Batch Quantity: {damaged_qty} {line.uom or 'BUNDLE'}",
            ])
            qr = GrnDamageQrModel(
                id=uuid.uuid4(),
                damage_lot_id=lot.id,
                grn_line_id=line.id,
                grn_number=grn.grn_number or "",
                item_code=line.item_code,
                qr_code=qr_code_str,
                qr_payload=qr_payload,
                generated_by=created_by,
                generated_at=now,
            )
            self._session.add(qr)
            lot.qr_code = qr
            await self._session.flush()

            damage_lots.append(lot)

        return damage_lots

    async def add_document(
        self,
        grn_id: uuid.UUID,
        document_type: str,
        file_name: str,
        file_path: str,
        uploaded_by: str,
    ) -> GrnDocumentModel:
        doc = GrnDocumentModel(
            id=uuid.uuid4(),
            grn_id=grn_id,
            document_type=document_type,
            file_name=file_name,
            file_path=file_path,
            uploaded_by=uploaded_by,
            uploaded_at=datetime.now(timezone.utc),
        )
        self._session.add(doc)
        await self._session.flush()
        return doc

    async def complete_grn_posting(
        self,
        grn_id: uuid.UUID,
        posted_by: str,
        verification_notes: str | None = None,
    ) -> GrnModel:
        # Serialize GRN completion so two receiving operators cannot create
        # duplicate receipt postings or putaway tasks for the same document.
        res = await self._session.execute(
            select(GrnModel)
            .options(
                selectinload(GrnModel.lines).selectinload(GrnLineModel.batches),
                selectinload(GrnModel.documents),
            )
            .where(GrnModel.id == grn_id)
            .with_for_update()
        )
        grn = res.scalar_one_or_none()
        if not grn:
            raise ValueError(f"GRN not found: {grn_id}")

        # A completed GRN is immutable from the warehouse posting perspective.
        # Return it on retries rather than posting stock/tasks a second time.
        if (grn.status or "").upper() in {"COMPLETED", "POSTED", "RECEIVING_COMPLETE"}:
            return grn

        # ASN is the authoritative inbound document for this project.  A GRN
        # cannot be completed until its ASN copy has been persisted.
        has_asn_document = any(
            "ASN" in str(document.document_type or "").upper()
            and bool(document.file_path)
            for document in (grn.documents or [])
        )
        if not has_asn_document:
            raise ValueError("ASN document must be uploaded and saved before completing the GRN")

        now = datetime.now(timezone.utc)
        now_naive = now.replace(tzinfo=None)
        grn.status = "COMPLETED"
        grn.posted_by = posted_by
        grn.posted_at = now
        if verification_notes:
            grn.verification_notes = verification_notes

        # Retrieve dock assignment for store routing & manager assignment
        dock_assignment = None
        da_conditions = []
        if grn.id:
            da_conditions.append(DockAssignmentModel.prepared_grn_id == grn.id)
        if grn.gate_entry_id:
            da_conditions.append(DockAssignmentModel.gate_entry_id == grn.gate_entry_id)
        if grn.asn_id:
            da_conditions.append(DockAssignmentModel.asn_id == grn.asn_id)
        if grn.po_id:
            da_conditions.append(DockAssignmentModel.po_id == grn.po_id)
        if grn.vehicle_number:
            da_conditions.append(DockAssignmentModel.vehicle_number == grn.vehicle_number)

        if da_conditions:
            da_res = await self._session.execute(
                select(DockAssignmentModel)
                .where(or_(*da_conditions))
                .order_by(DockAssignmentModel.assigned_at.desc())
            )
            dock_assignment = da_res.scalars().first()
            if dock_assignment:
                dock_assignment.prepared_grn_id = grn.id
                dock_assignment.receiving_completed_at = now
                dock_assignment.receiving_completed_by = posted_by
                if dock_assignment.gate_entry_id:
                    ge_res = await self._session.execute(
                        select(GateEntryModel).where(GateEntryModel.id == dock_assignment.gate_entry_id)
                    )
                    ge_obj = ge_res.scalar_one_or_none()
                    if ge_obj:
                        ge_obj.status = "RECEIVING_COMPLETED"

        base_dest_store_id = dock_assignment.assigned_store_id if dock_assignment else None
        base_assigned_to = (
            (dock_assignment.assigned_store_manager_username or dock_assignment.assigned_store_manager_id or dock_assignment.assigned_store_manager_name)
            if dock_assignment
            else None
        )
        assigned_by = (dock_assignment.assigned_by if dock_assignment else None) or posted_by
        assigned_at = (dock_assignment.assigned_at if dock_assignment else None) or now

        # Fallback to dock definition if not populated on dock assignment
        if not base_dest_store_id and grn.dock_number:
            dock_res = await self._session.execute(
                select(DockModel).where(DockModel.dock_number == grn.dock_number)
            )
            dock_obj = dock_res.scalars().first()
            if dock_obj and getattr(dock_obj, "assigned_store_id", None):
                base_dest_store_id = dock_obj.assigned_store_id
                base_assigned_to = base_assigned_to or getattr(dock_obj, "assigned_store_manager_username", None) or getattr(dock_obj, "assigned_store_manager_id", None)

        # Pre-fetch all active stores to match by category
        store_res = await self._session.execute(
            select(StoreModel).where(StoreModel.status == "ACTIVE").order_by(StoreModel.created_at.asc())
        )
        active_stores = list(store_res.scalars().all())

        # Post inventory updates & putaway tasks
        for line in grn.lines:
            dest_store_id = base_dest_store_id
            assigned_to = base_assigned_to

            if dest_store_id and not assigned_to:
                for st in active_stores:
                    if st.id == dest_store_id:
                        assigned_to = st.store_manager_name or st.store_manager_id
                        break
            # Only QC-accepted material may create a putaway task. Received
            # but rejected, damaged, or held quantities remain unavailable.
            post_qty = line.quality_approved_quantity or line.good_quantity or Decimal("0")

            if post_qty > Decimal("0"):
                # Record accepted receipt quantity for traceability. The
                # material stock balance remains unchanged until putaway is
                # physically confirmed.
                on_hand_before = await self._session.scalar(
                    select(func.coalesce(func.sum(MaterialStockModel.on_hand_quantity), Decimal("0"))).where(
                        MaterialStockModel.material_code == line.item_code,
                        func.lower(MaterialStockModel.warehouse_id) == grn.warehouse_id.strip().lower(),
                    )
                ) or Decimal("0")
                receipt_posting = await self._session.scalar(
                    select(InventoryReceiptPostingModel).where(
                        InventoryReceiptPostingModel.grn_id == grn.id,
                        InventoryReceiptPostingModel.item_code == line.item_code,
                    ).with_for_update()
                )
                if receipt_posting:
                    receipt_posting.posted_quantity += post_qty
                    receipt_posting.posted_by = posted_by
                    receipt_posting.posted_at = now
                else:
                    self._session.add(InventoryReceiptPostingModel(
                        id=uuid.uuid4(),
                        grn_id=grn.id,
                        grn_number=grn.grn_number,
                        po_id=grn.po_id,
                        po_number=grn.po_number,
                        asn_id=grn.asn_id,
                        asn_number=grn.asn_number,
                        supplier_name=grn.supplier_name,
                        item_code=line.item_code,
                        material_name=line.material_name or line.item_code,
                        uom=line.uom,
                        warehouse_id=grn.warehouse_id,
                        posted_quantity=post_qty,
                        on_hand_before=on_hand_before,
                        on_hand_after=on_hand_before,
                        posted_by=posted_by,
                        posted_at=now,
                    ))

                # Create putaway task for line or batches
                if line.batches and len(line.batches) > 0:
                    eligible_remaining = post_qty
                    seen_batch_numbers: set[str] = set()
                    for batch in line.batches:
                        batch_key = str(batch.batch_number or "").strip().upper()
                        if not batch_key or batch_key in seen_batch_numbers or eligible_remaining <= Decimal("0"):
                            continue
                        seen_batch_numbers.add(batch_key)
                        eligible_quantity = min(batch.batch_quantity or Decimal("0"), eligible_remaining)
                        if eligible_quantity > Decimal("0"):
                            existing_task = await self._session.execute(
                                select(PutawayTaskModel.id).where(
                                    PutawayTaskModel.grn_id == grn.id,
                                    PutawayTaskModel.item_code == line.item_code,
                                    func.upper(func.trim(func.coalesce(PutawayTaskModel.batch_number, ""))) == batch_key,
                                    PutawayTaskModel.status.notin_(["CANCELLED", "VOID"]),
                                ).limit(1),
                                {
                                    "grn_id": grn.id,
                                    "code": line.item_code,
                                    "batch_number": batch.batch_number,
                                },
                            )
                            if existing_task.scalar_one_or_none() is not None:
                                eligible_remaining -= eligible_quantity
                                continue
                            task_num = f"PT-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
                            await self._session.execute(
                                insert(PutawayTaskModel.__table__).values(
                                    id=bindparam("id"),
                                    task_number=bindparam("task_num"),
                                    grn_id=bindparam("grn_id"),
                                    grn_number=bindparam("grn_num"),
                                    item_code=bindparam("code"),
                                    material_name=bindparam("name"),
                                    quantity=bindparam("qty"),
                                    uom=bindparam("uom"),
                                    warehouse_id=bindparam("wh"),
                                    source_location=bindparam("source"),
                                    destination_store_id=bindparam("dest_store_id"),
                                    assigned_to=bindparam("assigned_to"),
                                    assigned_by=bindparam("assigned_by"),
                                    assigned_at=bindparam("assigned_at"),
                                    status="PUTAWAY_PENDING",
                                    created_by=bindparam("user"),
                                    created_at=bindparam("now"),
                                    batch_number=bindparam("batch_number")
                                ),
                                {
                                    "id": uuid.uuid4(),
                                    "task_num": task_num,
                                    "grn_id": grn.id,
                                    "grn_num": grn.grn_number,
                                    "code": line.item_code,
                                    "name": line.material_name or line.item_code,
                                    "qty": eligible_quantity,
                                    "uom": line.uom or "PCS",
                                    "wh": grn.warehouse_id,
                                    "source": f"RECEIVING_DOCK_{grn.dock_number}" if grn.dock_number else "RECEIVING_DOCK",
                                    "dest_store_id": dest_store_id,
                                    "assigned_to": assigned_to,
                                    "assigned_by": assigned_by,
                                    "assigned_at": assigned_at,
                                    "user": posted_by,
                                    "now": now,
                                    "batch_number": batch.batch_number,
                                },
                            )
                            eligible_remaining -= eligible_quantity
                else:
                    existing_task = await self._session.execute(
                        select(PutawayTaskModel.id).where(
                            PutawayTaskModel.grn_id == grn.id,
                            PutawayTaskModel.item_code == line.item_code,
                            PutawayTaskModel.batch_number.is_(None),
                        ).limit(1)
                    )
                    if existing_task.scalar_one_or_none():
                        continue
                    task_num = f"PT-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
                    await self._session.execute(
                        insert(PutawayTaskModel.__table__).values(
                                    id=bindparam("id"),
                                    task_number=bindparam("task_num"),
                                    grn_id=bindparam("grn_id"),
                                    grn_number=bindparam("grn_num"),
                                    item_code=bindparam("code"),
                                    material_name=bindparam("name"),
                                    quantity=bindparam("qty"),
                                    uom=bindparam("uom"),
                                    warehouse_id=bindparam("wh"),
                                    source_location=bindparam("source"),
                                    destination_store_id=bindparam("dest_store_id"),
                                    assigned_to=bindparam("assigned_to"),
                                    assigned_by=bindparam("assigned_by"),
                                    assigned_at=bindparam("assigned_at"),
                                    status="PUTAWAY_PENDING",
                                    created_by=bindparam("user"),
                                    created_at=bindparam("now")
                                ),
                        {
                            "id": uuid.uuid4(),
                            "task_num": task_num,
                            "grn_id": grn.id,
                            "grn_num": grn.grn_number,
                            "code": line.item_code,
                            "name": line.material_name or line.item_code,
                            "qty": post_qty,
                            "uom": line.uom or "PCS",
                            "wh": grn.warehouse_id,
                            "source": f"RECEIVING_DOCK_{grn.dock_number}" if grn.dock_number else "RECEIVING_DOCK",
                            "dest_store_id": dest_store_id,
                            "assigned_to": assigned_to,
                            "assigned_by": assigned_by,
                            "assigned_at": assigned_at,
                            "user": posted_by,
                            "now": now,
                        },
                    )

        await self._session.flush()
        return grn

    async def list_grns(
        self,
        status: str | None = None,
        search: str | None = None,
        actor_identities: list[str] | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[GrnModel], int]:
        stmt = select(GrnModel).options(selectinload(GrnModel.lines))
        conditions = []
        if actor_identities:
            normalized_identities = [value.strip().lower() for value in actor_identities if value.strip()]
            conditions.append(or_(
                func.lower(GrnModel.received_by).in_(normalized_identities),
                func.lower(GrnModel.posted_by).in_(normalized_identities),
            ))
        if status and status.strip() and status.strip().upper() != "ALL":
            s = status.strip().upper().replace(" ", "_").replace("-", "_")
            if s in ["COMPLETED", "POSTED", "APPROVED", "ACCEPTED"]:
                conditions.append(GrnModel.status.in_(["COMPLETED", "POSTED", "APPROVED", "RECEIVING_COMPLETE"]))
            elif s in ["PARTIAL", "PARTIALLY_COMPLETED", "IN_PROGRESS", "DRAFT", "PENDING", "RECEIVING"]:
                conditions.append(GrnModel.status.in_(["PARTIALLY_COMPLETED", "PARTIALLY COMPLETED", "IN_PROGRESS", "DRAFT", "PENDING", "RECEIVING"]))
            else:
                conditions.append(GrnModel.status == status.strip())
        if search and search.strip():
            term = f"%{search.strip()}%"
            conditions.append(
                or_(
                    GrnModel.grn_number.ilike(term),
                    GrnModel.po_number.ilike(term),
                    GrnModel.supplier_name.ilike(term),
                    GrnModel.vehicle_number.ilike(term),
                    GrnModel.driver_name.ilike(term),
                    GrnModel.dock_number.ilike(term),
                )
            )
        if conditions:
            stmt = stmt.where(*conditions)

        from sqlalchemy import func
        count_stmt = select(func.count(GrnModel.id))
        if conditions:
            count_stmt = count_stmt.where(*conditions)
        total_res = await self._session.execute(count_stmt)
        total = total_res.scalar() or 0

        stmt = stmt.order_by(GrnModel.created_at.desc()).limit(limit).offset(offset)
        result = await self._session.execute(stmt)
        grn_list = list(result.scalars().all())

        for g in grn_list:
            if not g.supplier_name or _is_uuid_string(g.supplier_name) or _is_uuid_string(g.supplier_company_name):
                s_name, s_comp = await _resolve_real_supplier_names(
                    self._session,
                    po_id=g.po_id,
                    po_number=g.po_number,
                    raw_supplier_name=g.supplier_name,
                    raw_supplier_company=g.supplier_company_name,
                    is_unexpected=(g.receipt_type == "UNEXPECTED_DELIVERY"),
                )
                g.supplier_name = s_name
                g.supplier_company_name = s_comp
                await self._session.flush()

        return grn_list, total

    async def get_grn_detail_by_id(self, grn_id_or_number: str | uuid.UUID) -> GrnModel | None:
        def _to_uuid(val):
            try:
                return uuid.UUID(str(val))
            except Exception:
                return None

        u_id = _to_uuid(grn_id_or_number)
        cond = GrnModel.id == u_id if u_id else GrnModel.grn_number.ilike(str(grn_id_or_number).strip())
        stmt = (
            select(GrnModel)
            .options(
                selectinload(GrnModel.lines).selectinload(GrnLineModel.damage_evidence),
                # Batch QR is material-level and older data can contain
                # multiple matching rows; do not eager-load it as one-to-one.
                selectinload(GrnModel.lines).selectinload(GrnLineModel.batches),
                selectinload(GrnModel.lines).selectinload(GrnLineModel.damage_lots).selectinload(GrnDamageLotModel.qr_code),
                selectinload(GrnModel.documents),
            )
            .where(cond)
        )
        res = await self._session.execute(stmt)
        g = res.scalar_one_or_none()
        # Older ASN-based GRNs could have been saved with only a header.  Make
        # the persisted GRN self-contained before returning it so every client
        # (including a refreshed Step 2 page) receives the actual ASN lines.
        if g and not g.lines and not g.asn_id and not g.asn_number and g.gate_entry_id:
            gate_result = await self._session.execute(
                select(GateEntryModel.asn_id).where(GateEntryModel.id == g.gate_entry_id)
            )
            gate_asn_id = gate_result.scalar_one_or_none()
            if gate_asn_id:
                g.asn_id = gate_asn_id

        if g and not g.lines and (g.asn_id or g.asn_number):
            asn_conditions = []
            if g.asn_id:
                asn_conditions.append(AsnModel.id == g.asn_id)
            if g.asn_number:
                asn_conditions.append(AsnModel.asn_number == g.asn_number.strip())
            asn_result = await self._session.execute(
                select(AsnModel)
                .options(selectinload(AsnModel.lines))
                .where(or_(*asn_conditions))
                .order_by(AsnModel.created_at.desc())
            )
            asn = asn_result.scalar_one_or_none()
            if asn and asn.lines:
                for line in asn.lines:
                    g.lines.append(
                        GrnLineModel(
                            id=uuid.uuid4(),
                            item_code=line.item_code,
                            material_name=line.material_name or line.item_code,
                            material_category="General",
                            uom=line.uom or "PCS",
                            ordered_quantity=line.shipped_quantity or Decimal("0"),
                            received_quantity=Decimal("0"),
                            good_quantity=Decimal("0"),
                            damaged_quantity=Decimal("0"),
                            rejected_quantity=Decimal("0"),
                            held_quantity=Decimal("0"),
                            quality_approved_quantity=Decimal("0"),
                            balance_quantity=line.shipped_quantity or Decimal("0"),
                        )
                    )
                await self._session.flush()
        if g and (not g.supplier_name or _is_uuid_string(g.supplier_name) or _is_uuid_string(g.supplier_company_name)):
            s_name, s_comp = await _resolve_real_supplier_names(
                self._session,
                po_id=g.po_id,
                po_number=g.po_number,
                raw_supplier_name=g.supplier_name,
                raw_supplier_company=g.supplier_company_name,
                is_unexpected=(g.receipt_type == "UNEXPECTED_DELIVERY"),
            )
            g.supplier_name = s_name
            g.supplier_company_name = s_comp
            await self._session.flush()
        return g

    async def delete_grn(self, grn_id: uuid.UUID) -> bool:
        result = await self._session.execute(
            select(GrnModel)
            .options(
                selectinload(GrnModel.lines).selectinload(GrnLineModel.damage_evidence),
                selectinload(GrnModel.lines).selectinload(GrnLineModel.batches),
                selectinload(GrnModel.lines).selectinload(GrnLineModel.damage_lots),
                selectinload(GrnModel.documents),
                selectinload(GrnModel.receiving_sessions),
            )
            .where(GrnModel.id == grn_id)
        )
        grn = result.scalar_one_or_none()
        if grn is None:
            return False

        # Dock assignments are operational history and must not be deleted
        # with the GRN.  The FK is intentionally RESTRICT, so clear the
        # optional back-reference before removing the GRN.
        assignments_result = await self._session.execute(
            select(DockAssignmentModel).where(DockAssignmentModel.prepared_grn_id == grn_id)
        )
        for assignment in assignments_result.scalars().all():
            assignment.prepared_grn_id = None
        await self._session.flush()

        # GRN-native supplier claims reference the GRN and its lines. They
        # are created when a completed GRN publishes damage/rejection data,
        # so remove those claims before deleting the owned lines. Legacy
        # damage-report claims are intentionally left untouched because they
        # belong to the gate-entry workflow rather than this GRN aggregate.
        claim_result = await self._session.execute(
            select(SupplierDamageClaimModel).where(
                SupplierDamageClaimModel.source_grn_id == grn_id
            )
        )
        for claim in claim_result.scalars().all():
            await self._session.delete(claim)
        await self._session.flush()

        await self._session.delete(grn)
        await self._session.flush()
        return True


async def _warehouse_for_receiving_dock(session: AsyncSession, dock_number: str | None) -> str | None:
    """Resolve a missing warehouse from the actual configured receiving dock."""
    if not (dock_number or "").strip():
        return None
    result = await session.execute(
        select(DockModel.warehouse_id).where(DockModel.dock_number == dock_number.strip())
    )
    warehouse_id = result.scalar_one_or_none()
    return warehouse_id.strip() if warehouse_id and warehouse_id.strip() else None
