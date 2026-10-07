"""
ConfirmGrnUseCase / GetGrnUseCase - counterparts of the Java use cases.
Orchestrates one transaction: look up the PO, ask the domain layer to
confirm the receipt, save it. The only "framework" dependency this layer
has is the UnitOfWork it's handed - wiring and transaction boundaries,
never business rules.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.modules.receiving.application.commands import (
    ConfirmGrnCommand,
    GetGrnContextQuery,
)
from app.modules.receiving.application.exceptions import PurchaseOrderNotFoundException
from app.modules.receiving.application.repository import (
    GrnContextLineSnapshot,
    GrnContextSnapshot,
    GrnRepository,
)
from app.modules.receiving.domain.grn import GoodsReceiptNote
from app.modules.receiving.domain.receipt_line import ReceiptLine
from app.modules.receiving.domain.value_objects import GrnId, PurchaseOrderId
from app.common.domain.exceptions import NotFoundException


class ConfirmGrnUseCase:
    def __init__(self, grn_repository: GrnRepository) -> None:
        self._grn_repository = grn_repository

    async def handle(self, command: ConfirmGrnCommand) -> GrnId:
        po_id = PurchaseOrderId.of(command.po_id)
        po = await self._grn_repository.find_purchase_order(po_id)
        if po is None:
            raise PurchaseOrderNotFoundException(command.po_id)

        lines = [
            ReceiptLine(
                item_code=l.item_code,
                received_quantity=l.quantity,
                ordered_quantity=po.ordered_quantity_by_item_code.get(l.item_code),
            )
            for l in command.lines
        ]

        grn = GoodsReceiptNote.confirm(po_id, lines)
        await self._grn_repository.save(grn)
        return grn.id


class GetGrnUseCase:
    def __init__(self, grn_repository: GrnRepository) -> None:
        self._grn_repository = grn_repository

    async def handle(self, grn_id: GrnId) -> GoodsReceiptNote:
        grn = await self._grn_repository.find_by_id(grn_id)
        if grn is None:
            raise NotFoundException(f"GRN not found: {grn_id}")
        return grn


class GetGrnContextUseCase:
    def __init__(self, grn_repository: Any) -> None:
        self._grn_repository = grn_repository

    async def handle(self, query: GetGrnContextQuery) -> GrnContextSnapshot:
        if query.receipt_type == "UNEXPECTED_DELIVERY" or (not query.po_id and not query.po_number):
            gate_entry = None
            if query.gate_entry_id:
                gate_entry = await self._grn_repository.find_gate_entry_by_id(query.gate_entry_id)
            if not gate_entry and query.vehicle_number:
                gate_entry = await self._grn_repository.find_latest_gate_entry_for_vehicle(query.vehicle_number)

            dock_options = await self._grn_repository.list_docks_for_warehouse("WH-MAIN")

            return GrnContextSnapshot(
                receipt_type="UNEXPECTED_DELIVERY",
                po_id=None,
                po_number=None,
                supplier_name=None,
                supplier_company_name=None,
                supplier_email=None,
                supplier_contact_person=None,
                warehouse_id="WH-MAIN",
                warehouse_name="Main Warehouse",
                asn=None,
                gate_entry=gate_entry,
                existing_grn=None,
                dock_options=dock_options,
                lines=[],
            )

        po = None
        if query.po_id:
            po = await self._grn_repository.find_purchase_order(PurchaseOrderId.of(query.po_id))
        elif query.po_number:
            po = await self._grn_repository.find_purchase_order_by_number(query.po_number)

        if po is None:
            raise PurchaseOrderNotFoundException(query.po_id or query.po_number or "unknown")

        po_str_id = str(po.id.value) if hasattr(po.id, "value") else str(po.id)
        asn = await self._grn_repository.find_latest_asn_for_po(po_id=po_str_id, po_number=po.po_number)
        gate_entry = None
        if not gate_entry and asn:
            gate_entry = await self._grn_repository.find_latest_gate_entry_for_asn(asn.id)
        if not gate_entry and po.po_number:
            gate_entry = await self._grn_repository.find_latest_gate_entry_for_po(po.po_number)

        existing_grn = await self._grn_repository.find_grn_header_by_po(po_id=po_str_id, po_number=po.po_number)

        dock_options = []
        if po.warehouse_id:
            dock_options = await self._grn_repository.list_docks_for_warehouse(po.warehouse_id)
        if not dock_options:
            dock_options = await self._grn_repository.list_docks_for_warehouse()

        lines = [
            GrnContextLineSnapshot(
                item_code=l.item_code,
                material_name=l.material_name,
                material_category=l.material_category,
                uom=l.uom,
                variant_code=l.variant_code,
                size=l.size,
                color=l.color,
                grade=l.grade,
                ordered_quantity=l.ordered_quantity,
                received_quantity=Decimal("0"),
                balance_quantity=l.ordered_quantity,
            )
            for l in po.lines
        ]

        return GrnContextSnapshot(
            receipt_type="PO_RECEIPT",
            po_id=po_str_id,
            po_number=po.po_number,
            supplier_name=po.supplier_name,
            supplier_company_name=po.supplier_company_name,
            supplier_email=po.supplier_email,
            supplier_contact_person=po.supplier_contact_person,
            warehouse_id=po.warehouse_id,
            warehouse_name=po.warehouse_name,
            asn=asn,
            gate_entry=gate_entry,
            existing_grn=existing_grn,
            dock_options=dock_options,
            lines=lines,
        )
