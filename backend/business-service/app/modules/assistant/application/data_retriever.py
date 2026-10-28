"""
Dedicated read-only data retrieval service for the Kaizen AMS Assistant.
Executes curated, parameterized SQLAlchemy queries with strict role-based access control (RBAC)
and tenant boundaries before returning facts to the assistant.
"""
from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.persistence.models import (
    AsnLineModel,
    AsnModel,
    MaterialModel,
    MaterialStockModel,
    PurchaseOrderItemModel,
    PurchaseOrderModel,
    SupplierModel,
    SupplierUserModel,
)
from app.config.settings import get_settings
from app.modules.assembly.infrastructure.persistence.models import AssemblyOrderModel
from app.modules.dispatch.infrastructure.persistence.models import DispatchModel
from app.modules.gate.infrastructure.persistence.models import GateEntryModel
from app.modules.gate.infrastructure.persistence.models import DockModel
from app.modules.storage.infrastructure.persistence.models import (
    InventoryLocationBalanceModel,
    PutawayTaskModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreBinModel,
    StoreManagerUserModel,
    StoreModel,
    StoreZoneModel,
)
from app.security.dependencies import CurrentUser

logger = logging.getLogger("ams.assistant.data_retriever")


# ==============================================================================
# Helper Functions for Context & Tenant Identification
# ==============================================================================

async def resolve_user_store_context(
    user: CurrentUser, session: AsyncSession
) -> Tuple[Set[uuid.UUID], Set[str]]:
    """
    Resolve store IDs and store codes assigned to a store manager / store keeper.
    Returns (set(), set()) if the user has global admin/warehouse privileges.
    """
    roles_upper = {r.upper() for r in (user.roles or [])}
    if "ADMIN" in roles_upper or "SUPERUSER" in roles_upper:
        return set(), set()

    store_ids: Set[uuid.UUID] = set()
    store_codes: Set[str] = set()

    # 1. From raw claims
    raw_id = (user.raw_claims or {}).get("store_id")
    if raw_id:
        try:
            store_ids.add(uuid.UUID(str(raw_id)))
        except (ValueError, TypeError):
            pass

    raw_code = (user.raw_claims or {}).get("store_code")
    if raw_code:
        store_codes.add(str(raw_code).strip().upper())

    # 2. Lookup StoreManagerUserModel by username or employee_id
    identifiers = {
        str(user.username).strip().lower() if user.username else "",
        str(user.subject).strip().lower() if user.subject else "",
        str((user.raw_claims or {}).get("employee_id") or "").strip().lower(),
    }
    identifiers.discard("")

    if identifiers:
        stmt = select(StoreManagerUserModel).where(
            or_(
                func.lower(StoreManagerUserModel.employee_id).in_(identifiers),
                func.lower(StoreManagerUserModel.username).in_(identifiers),
                func.lower(StoreManagerUserModel.email).in_(identifiers),
            )
        )
        res = await session.execute(stmt)
        for sm in res.scalars().all():
            if sm.store_id:
                store_ids.add(sm.store_id)
            if getattr(sm, "store_code", None):
                store_codes.add(str(sm.store_code).strip().upper())

        # 3. Lookup store table directly
        stmt2 = select(StoreModel).where(
            or_(
                func.lower(StoreModel.store_manager_id).in_(identifiers),
                func.lower(StoreModel.store_manager_name).in_(identifiers),
            )
        )
        res2 = await session.execute(stmt2)
        for s in res2.scalars().all():
            store_ids.add(s.id)
            if s.store_code:
                store_codes.add(s.store_code.strip().upper())

    # 4. Cross-populate missing codes or IDs
    if store_ids and not store_codes:
        s_res = await session.execute(select(StoreModel).where(StoreModel.id.in_(store_ids)))
        for s in s_res.scalars().all():
            if s.store_code:
                store_codes.add(s.store_code.strip().upper())

    if store_codes and not store_ids:
        s_res2 = await session.execute(
            select(StoreModel).where(func.upper(StoreModel.store_code).in_(store_codes))
        )
        for s in s_res2.scalars().all():
            store_ids.add(s.id)

    return store_ids, store_codes


async def resolve_supplier_id(
    user: CurrentUser, session: AsyncSession
) -> Optional[uuid.UUID]:
    """
    Resolve the authenticated supplier's durable UUID.
    Never trusts unauthenticated user input.
    """
    # 1. From database link
    mapped = (
        await session.execute(
            select(SupplierUserModel.supplier_id).where(
                SupplierUserModel.username == user.username
            )
        )
    ).scalar_one_or_none()
    if mapped:
        return mapped

    # 2. From raw claims
    raw = (user.raw_claims or {}).get("supplier_id")
    if raw and raw != "None":
        try:
            return uuid.UUID(str(raw))
        except (ValueError, TypeError):
            claimed = (
                await session.execute(
                    select(SupplierModel.id).where(
                        SupplierModel.supplier_code == str(raw)
                    )
                )
            ).scalar_one_or_none()
            if claimed:
                return claimed

    # 3. Local/test fallback for standard mock supplier
    settings = get_settings()
    if (
        settings.environment.lower() in {"local", "test", "development"}
        and user.username in {"supplier", "supplier_partner"}
    ):
        return (
            await session.execute(
                select(SupplierModel.id).where(
                    SupplierModel.supplier_code == "SUP-DEFAULT"
                )
            )
        ).scalar_one_or_none()

    return None


def extract_identifier(query: str, pattern: str) -> Optional[str]:
    """Helper to extract entity codes like PO-2026-001 or MAT-101 using regex."""
    match = re.search(pattern, query, re.IGNORECASE)
    return match.group(0).upper() if match else None


# ==============================================================================
# Curated, Parameterized Read-Only Retrieval Methods
# ==============================================================================

class AssistantDataRetriever:
    """Service providing authorized, read-only data queries for Kaizen AMS Assistant."""

    async def retrieve_inventory(
        self, query: str, user: CurrentUser, session: AsyncSession
    ) -> Dict[str, Any]:
        """
        Query inventory stock availability by material or store.
        Restricts Store Users to their assigned store; denies Suppliers and Gate Security.
        """
        roles_upper = {r.upper() for r in (user.roles or [])}

        # Role restrictions: Suppliers and Gate Security cannot view warehouse inventory
        if "SUPPLIER" in roles_upper:
            return {
                "category": "inventory",
                "authorized": False,
                "reason": "Suppliers do not have permission to view internal warehouse inventory levels.",
            }
        if "GATE_SECURITY" in roles_upper:
            return {
                "category": "inventory",
                "authorized": False,
                "reason": "Gate Security personnel do not have permission to view warehouse stock levels.",
            }

        # Extract material code if mentioned (e.g., MAT-001, RM-101)
        material_code = extract_identifier(query, r"\b(MAT|RM|PKG|FG|ITEM)-[A-Z0-9-]+\b")

        # Store users: restrict strictly to their assigned store
        is_store_user = "STORE_MANAGER" in roles_upper or "STORE_KEEPER" in roles_upper
        if is_store_user and "ADMIN" not in roles_upper and "WAREHOUSE" not in roles_upper:
            store_ids, store_codes = await resolve_user_store_context(user, session)
            if not store_ids:
                return {
                    "category": "inventory",
                    "authorized": False,
                    "reason": "You are assigned as a Store user, but no valid store assignment was found for your account.",
                }

            # Query inventory location balances for the user's store
            stmt = (
                select(
                    InventoryLocationBalanceModel.material_code,
                    InventoryLocationBalanceModel.material_name,
                    InventoryLocationBalanceModel.quantity,
                    InventoryLocationBalanceModel.available_quantity,
                    InventoryLocationBalanceModel.uom,
                    StorageLocationModel.location_code,
                    StorageLocationModel.zone,
                    StorageLocationModel.bin,
                )
                .join(
                    StorageLocationModel,
                    InventoryLocationBalanceModel.storage_location_id == StorageLocationModel.id,
                )
                .where(StorageLocationModel.store_id.in_(store_ids))
            )
            if material_code:
                stmt = stmt.where(
                    func.upper(InventoryLocationBalanceModel.material_code) == material_code
                )
            stmt = stmt.limit(10)
            res = await session.execute(stmt)
            rows = res.all()

            if not rows:
                return {
                    "category": "inventory",
                    "authorized": True,
                    "found": False,
                    "message": f"No inventory records found in your assigned store ({', '.join(store_codes)})"
                    + (f" for material {material_code}." if material_code else "."),
                }

            items = [
                {
                    "material_code": row.material_code,
                    "material_name": row.material_name,
                    "total_quantity": float(row.quantity),
                    "available_quantity": float(row.available_quantity),
                    "uom": row.uom,
                    "location": row.location_code,
                    "zone": row.zone,
                    "bin": row.bin,
                }
                for row in rows
            ]
            return {
                "category": "inventory",
                "authorized": True,
                "found": True,
                "store_codes": list(store_codes),
                "items": items,
            }

        # Warehouse / Admin / Procurement / Assembly / Finance global inventory query
        stmt = select(MaterialStockModel)
        if material_code:
            stmt = stmt.where(func.upper(MaterialStockModel.material_code) == material_code)
        stmt = stmt.order_by(MaterialStockModel.material_code).limit(10)

        res = await session.execute(stmt)
        stocks = res.scalars().all()

        if not stocks:
            return {
                "category": "inventory",
                "authorized": True,
                "found": False,
                "message": f"No stock records found"
                + (f" for material code {material_code}." if material_code else " in warehouse stock master."),
            }

        is_finance = "FINANCE" in roles_upper and "ADMIN" not in roles_upper and "WAREHOUSE" not in roles_upper
        items = []
        for s in stocks:
            item_dict: Dict[str, Any] = {
                "material_code": s.material_code,
                "material_name": s.material_name or s.material_code,
                "category": s.category or "General",
                "on_hand": float(s.on_hand),
                "available": float(s.available),
                "allocated": float(s.allocated),
                "uom": s.uom,
                "warehouse": s.warehouse_id or "Main Warehouse",
            }
            if not is_finance:
                item_dict["reorder_point"] = float(s.reorder_point) if s.reorder_point else None
            items.append(item_dict)

        return {
            "category": "inventory",
            "authorized": True,
            "found": True,
            "items": items,
        }

    async def retrieve_purchase_orders(
        self, query: str, user: CurrentUser, session: AsyncSession
    ) -> Dict[str, Any]:
        """
        Query purchase order status and fulfillment.
        Suppliers see ONLY their own POs; Gate & Warehouse staff see operational details with pricing masked.
        """
        roles_upper = {r.upper() for r in (user.roles or [])}
        is_supplier = "SUPPLIER" in roles_upper
        is_gate = "GATE_SECURITY" in roles_upper
        is_warehouse = "WAREHOUSE" in roles_upper or "WAREHOUSE_MANAGER" in roles_upper
        is_store = "STORE_MANAGER" in roles_upper or "STORE_KEEPER" in roles_upper

        po_number = extract_identifier(query, r"\bPO-[A-Z0-9-]+\b")

        stmt = select(PurchaseOrderModel)

        if is_supplier:
            supplier_id = await resolve_supplier_id(user, session)
            if not supplier_id:
                return {
                    "category": "purchase_orders",
                    "authorized": False,
                    "reason": "Unable to verify your supplier account identity for purchase order lookups.",
                }
            stmt = stmt.where(PurchaseOrderModel.supplier_id == supplier_id)

        if po_number:
            stmt = stmt.where(func.upper(PurchaseOrderModel.po_number) == po_number)

        stmt = stmt.order_by(PurchaseOrderModel.po_date.desc()).limit(5)
        res = await session.execute(stmt)
        orders = res.scalars().all()

        if not orders:
            return {
                "category": "purchase_orders",
                "authorized": True,
                "found": False,
                "message": f"No purchase order found"
                + (f" matching '{po_number}'" if po_number else "")
                + (" for your supplier account." if is_supplier else " in the system."),
            }

        # Role-based field masking:
        # Hide unit prices, totals, and financial margins from Gate Security, Warehouse, and Store staff
        mask_financials = (is_gate or is_warehouse or is_store) and "ADMIN" not in roles_upper and "FINANCE" not in roles_upper and "PROCUREMENT" not in roles_upper

        order_list = []
        for po in orders:
            # Query PO lines for line items
            lines_res = await session.execute(
                select(PurchaseOrderItemModel).where(
                    PurchaseOrderItemModel.purchase_order_id == po.id
                )
            )
            po_lines = lines_res.scalars().all()

            lines_data = []
            for line in po_lines:
                ld: Dict[str, Any] = {
                    "material_code": line.material_code,
                    "material_name": line.material_name,
                    "quantity": float(line.quantity),
                    "uom": line.uom,
                }
                if mask_financials:
                    ld["unit_price"] = "[RESTRICTED_FINANCIAL_FIELD]"
                else:
                    ld["unit_price"] = float(line.unit_price)
                lines_data.append(ld)

            po_dict: Dict[str, Any] = {
                "po_number": po.po_number,
                "status": po.status,
                "po_date": po.po_date.isoformat() if po.po_date else None,
                "expected_delivery_date": po.expected_delivery_date.isoformat() if po.expected_delivery_date else None,
                "supplier_name": po.supplier_name or "Unknown",
                "items": lines_data,
            }

            if mask_financials:
                po_dict["total_amount"] = "[RESTRICTED_FINANCIAL_FIELD]"
            else:
                po_dict["total_amount"] = float(po.total_amount)
                po_dict["payment_terms"] = po.payment_terms
                po_dict["delivery_terms"] = po.delivery_terms

            order_list.append(po_dict)

        return {
            "category": "purchase_orders",
            "authorized": True,
            "found": True,
            "orders": order_list,
        }

    async def retrieve_putaway_tasks(
        self, query: str, user: CurrentUser, session: AsyncSession
    ) -> Dict[str, Any]:
        """
        Query pending putaway tasks.
        Store users are restricted to their assigned store; Suppliers/Gate/Finance denied.
        """
        roles_upper = {r.upper() for r in (user.roles or [])}

        if "SUPPLIER" in roles_upper or "GATE_SECURITY" in roles_upper or "FINANCE" in roles_upper:
            return {
                "category": "putaway",
                "authorized": False,
                "reason": "Your role does not have authorization to view internal warehouse putaway tasks.",
            }

        task_number = extract_identifier(query, r"\b(TASK|PUT|PT)-[A-Z0-9-]+\b")

        stmt = select(PutawayTaskModel)

        is_store_user = "STORE_MANAGER" in roles_upper or "STORE_KEEPER" in roles_upper
        if is_store_user and "ADMIN" not in roles_upper and "WAREHOUSE" not in roles_upper:
            store_ids, store_codes = await resolve_user_store_context(user, session)
            if not store_ids:
                return {
                    "category": "putaway",
                    "authorized": False,
                    "reason": "No assigned store found for your store user account.",
                }
            stmt = stmt.where(PutawayTaskModel.destination_store_id.in_(store_ids))

        if task_number:
            stmt = stmt.where(func.upper(PutawayTaskModel.task_number) == task_number)
        else:
            # Show open / active tasks by default
            stmt = stmt.where(
                PutawayTaskModel.status.in_(["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING"])
            )

        stmt = stmt.order_by(PutawayTaskModel.task_number.desc()).limit(10)
        res = await session.execute(stmt)
        tasks = res.scalars().all()

        if not tasks:
            return {
                "category": "putaway",
                "authorized": True,
                "found": False,
                "message": f"No pending putaway tasks found"
                + (f" matching '{task_number}'." if task_number else " in the active queue."),
            }

        task_list = [
            {
                "task_number": t.task_number,
                "material_code": t.item_code,
                "material_name": t.material_name,
                "quantity": float(t.quantity),
                "uom": t.uom,
                "status": t.status,
                "source_location": t.source_location,
                "destination_bin": t.destination_bin_code or t.destination_bin or "Unassigned",
                "destination_zone": t.destination_zone or "General",
                "assigned_to": t.assigned_to or "Unassigned",
            }
            for t in tasks
        ]

        return {
            "category": "putaway",
            "authorized": True,
            "found": True,
            "tasks": task_list,
        }

    async def retrieve_gate_entries(
        self, query: str, user: CurrentUser, session: AsyncSession
    ) -> Dict[str, Any]:
        """
        Query inbound deliveries (ASNs) and physical gate entries.
        Suppliers see ONLY ASNs / gate entries tied to their own supplier identity.
        Finance role is denied physical gate entries and physical dock details.
        Warehouse and Gate Security have financial amounts masked.
        """
        roles_upper = {r.upper() for r in (user.roles or [])}
        is_supplier = "SUPPLIER" in roles_upper

        asn_number = extract_identifier(query, r"\bASN-[A-Z0-9-]+\b")
        entry_number = extract_identifier(query, r"\b(GE|GATE)-[A-Z0-9-]+\b")
        vehicle_number = extract_identifier(query, r"\b[A-Z]{2}[0-9]{1,2}[A-Z]{1,2}[0-9]{4}\b")

        is_asn_inquiry = bool(
            asn_number
            or (
                not entry_number
                and re.search(r"\b(asns?|advance[\s_-]?shipping|expected[\s_-]?deliver(y|ies)|expected[\s_-]?inbounds?)\b", query.lower())
            )
        )

        # ----------------------------------------------------------------------
        # A. Advance Shipping Notice (ASN) / Expected Inbound Delivery Inquiry
        # ----------------------------------------------------------------------
        if is_asn_inquiry:
            if is_supplier:
                supplier_id = await resolve_supplier_id(user, session)
                if not supplier_id:
                    return {
                        "category": "gate_entries",
                        "authorized": False,
                        "reason": "Unable to verify your supplier account identity for ASN and inbound delivery lookups.",
                    }

            asn_stmt = select(AsnModel).options(
                selectinload(AsnModel.lines),
                selectinload(AsnModel.supplier),
            )
            if is_supplier:
                asn_stmt = asn_stmt.where(AsnModel.supplier_id == supplier_id)

            if asn_number:
                asn_stmt = asn_stmt.where(func.upper(AsnModel.asn_number) == asn_number)
            elif vehicle_number:
                asn_stmt = asn_stmt.where(func.upper(AsnModel.vehicle_number) == vehicle_number)

            asn_stmt = asn_stmt.order_by(AsnModel.created_at.desc()).limit(10)
            res = await session.execute(asn_stmt)
            asns = res.scalars().all()

            if not asns:
                return {
                    "category": "gate_entries",
                    "authorized": True,
                    "found": False,
                    "message": f"No Advance Shipping Notice (ASN) records found"
                    + (f" matching '{asn_number or vehicle_number}'" if (asn_number or vehicle_number) else "")
                    + (" for your supplier account." if is_supplier else " in the database."),
                }

            asn_list = []
            for a in asns:
                supplier_name = (
                    a.supplier.supplier_name
                    if a.supplier and getattr(a.supplier, "supplier_name", None)
                    else (getattr(a.supplier, "registered_company_name", None) if a.supplier else "Unknown Supplier")
                ) or "Unknown Supplier"
                lines_info = [
                    {
                        "item_code": line.item_code,
                        "material_name": line.material_name or "Unknown Item",
                        "shipped_quantity": float(line.shipped_quantity) if line.shipped_quantity is not None else 0.0,
                        "uom": line.uom or "PCS",
                    }
                    for line in (a.lines or [])
                ]
                asn_dict: Dict[str, Any] = {
                    "record_type": "Advance Shipping Notice (Expected Inbound Delivery)",
                    "asn_number": a.asn_number,
                    "status": a.status,
                    "supplier_name": supplier_name,
                    "vehicle_number": a.vehicle_number or "Not specified",
                    "driver_name": a.driver_name or "Not specified",
                    "driver_contact": a.driver_contact or "Not specified",
                    "expected_arrival_at": a.expected_arrival_at.isoformat() if a.expected_arrival_at else None,
                    "shipment_date": a.shipment_date.isoformat() if a.shipment_date else None,
                    "po_number": a.po_number or "N/A",
                    "transporter": a.transporter or "N/A",
                    "number_of_packages": a.number_of_packages,
                    "lines": lines_info,
                }
                asn_list.append(asn_dict)

            return {
                "category": "gate_entries",
                "authorized": True,
                "found": True,
                "asns": asn_list,
            }

        # ----------------------------------------------------------------------
        # B. Physical Gate Entry Inquiry
        # ----------------------------------------------------------------------
        if "FINANCE" in roles_upper and "ADMIN" not in roles_upper:
            return {
                "category": "gate_entries",
                "authorized": False,
                "reason": "Finance role does not have access to live physical gate entries.",
            }

        if is_supplier:
            supplier_id = await resolve_supplier_id(user, session)
            if not supplier_id:
                return {
                    "category": "gate_entries",
                    "authorized": False,
                    "reason": "Unable to verify your supplier account identity for gate entry lookups.",
                }

        stmt = select(GateEntryModel)
        if is_supplier:
            # Join ASN to enforce supplier boundary
            stmt = stmt.join(AsnModel, GateEntryModel.asn_id == AsnModel.id).where(
                AsnModel.supplier_id == supplier_id
            )

        if entry_number:
            stmt = stmt.where(func.upper(GateEntryModel.gate_entry_number) == entry_number)
        elif vehicle_number:
            stmt = stmt.where(func.upper(GateEntryModel.vehicle_number) == vehicle_number)

        stmt = stmt.order_by(GateEntryModel.gate_entry_number.desc()).limit(10)
        res = await session.execute(stmt)
        entries = res.scalars().all()

        # If vehicle_number was searched and no gate entry found, check if an ASN exists for that vehicle
        if not entries and vehicle_number and not entry_number:
            asn_fallback_stmt = select(AsnModel).options(
                selectinload(AsnModel.lines),
                selectinload(AsnModel.supplier),
            ).where(func.upper(AsnModel.vehicle_number) == vehicle_number)
            if is_supplier:
                asn_fallback_stmt = asn_fallback_stmt.where(AsnModel.supplier_id == supplier_id)
            res_fb = await session.execute(asn_fallback_stmt)
            asns_fb = res_fb.scalars().all()
            if asns_fb:
                asn_list = []
                for a in asns_fb:
                    supplier_name = (
                        a.supplier.supplier_name
                        if a.supplier and getattr(a.supplier, "supplier_name", None)
                        else (getattr(a.supplier, "registered_company_name", None) if a.supplier else "Unknown Supplier")
                    ) or "Unknown Supplier"
                    lines_info = [
                        {
                            "item_code": line.item_code,
                            "material_name": line.material_name or "Unknown Item",
                            "shipped_quantity": float(line.shipped_quantity) if line.shipped_quantity is not None else 0.0,
                            "uom": line.uom or "PCS",
                        }
                        for line in (a.lines or [])
                    ]
                    asn_list.append({
                        "record_type": "Advance Shipping Notice (Expected Inbound Delivery)",
                        "asn_number": a.asn_number,
                        "status": a.status,
                        "supplier_name": supplier_name,
                        "vehicle_number": a.vehicle_number or "Not specified",
                        "driver_name": a.driver_name or "Not specified",
                        "driver_contact": a.driver_contact or "Not specified",
                        "expected_arrival_at": a.expected_arrival_at.isoformat() if a.expected_arrival_at else None,
                        "shipment_date": a.shipment_date.isoformat() if a.shipment_date else None,
                        "po_number": a.po_number or "N/A",
                        "transporter": a.transporter or "N/A",
                        "lines": lines_info,
                    })
                return {
                    "category": "gate_entries",
                    "authorized": True,
                    "found": True,
                    "asns": asn_list,
                }

        if not entries:
            return {
                "category": "gate_entries",
                "authorized": True,
                "found": False,
                "message": f"No gate entries found"
                + (f" matching '{entry_number or vehicle_number}'" if (entry_number or vehicle_number) else "")
                + (" for your shipments." if is_supplier else " in the active inbound queue."),
            }

        entry_list = [
            {
                "record_type": "Physical Gate Entry (Checked-in at Gate)",
                "gate_entry_number": g.gate_entry_number,
                "po_number": g.po_number,
                "vehicle_number": g.vehicle_number,
                "driver_name": g.driver_name,
                "status": g.status,
                "assigned_dock": g.assigned_dock_id or "Dock unassigned",
                "driver_phone": g.driver_phone if "GATE_SECURITY" in roles_upper or "ADMIN" in roles_upper else None,
            }
            for g in entries
        ]

        return {
            "category": "gate_entries",
            "authorized": True,
            "found": True,
            "entries": entry_list,
        }

    async def retrieve_assembly_orders(
        self, query: str, user: CurrentUser, session: AsyncSession
    ) -> Dict[str, Any]:
        """
        Query manufacturing assembly orders and statuses.
        Suppliers, Gate Security, and Finance are restricted.
        """
        roles_upper = {r.upper() for r in (user.roles or [])}

        if "SUPPLIER" in roles_upper or "GATE_SECURITY" in roles_upper or "FINANCE" in roles_upper:
            return {
                "category": "assembly",
                "authorized": False,
                "reason": "Your role does not have authorization to view internal manufacturing assembly orders.",
            }

        order_number = extract_identifier(query, r"\b(AO|ASSY|WO)-[A-Z0-9-]+\b")

        stmt = select(AssemblyOrderModel)
        if order_number:
            stmt = stmt.where(func.upper(AssemblyOrderModel.order_number) == order_number)

        stmt = stmt.order_by(AssemblyOrderModel.created_at.desc()).limit(10)
        res = await session.execute(stmt)
        orders = res.scalars().all()

        if not orders:
            return {
                "category": "assembly",
                "authorized": True,
                "found": False,
                "message": f"No assembly orders found"
                + (f" matching '{order_number}'." if order_number else " in the production queue."),
            }

        order_list = [
            {
                "order_number": o.order_number,
                "product_name": o.product_name,
                "product_code": o.product_code or "Unspecified",
                "status": o.status,
                "priority": o.priority,
                "planned_quantity": float(o.planned_quantity),
                "completed_quantity": float(o.completed_quantity),
                "rejected_quantity": float(o.rejected_quantity),
                "uom": o.uom,
                "assigned_line": o.assigned_line or "Line unassigned",
                "required_date": o.required_date.isoformat() if o.required_date else None,
            }
            for o in orders
        ]

        return {
            "category": "assembly",
            "authorized": True,
            "found": True,
            "orders": order_list,
        }

    async def retrieve_dispatch_status(
        self, query: str, user: CurrentUser, session: AsyncSession
    ) -> Dict[str, Any]:
        """
        Query customer outbound dispatch status and shipments.
        Suppliers and Finance are restricted. Gate Security receives sanitized vehicle/driver info.
        """
        roles_upper = {r.upper() for r in (user.roles or [])}

        if "SUPPLIER" in roles_upper or "FINANCE" in roles_upper:
            return {
                "category": "dispatch",
                "authorized": False,
                "reason": "Your role does not have authorization to view outbound customer dispatch orders.",
            }

        dispatch_number = extract_identifier(query, r"\b(DISP|DO|ORD)-[A-Z0-9-]+\b")

        stmt = select(DispatchModel)
        if dispatch_number:
            stmt = stmt.where(func.upper(DispatchModel.dispatch_number) == dispatch_number)

        stmt = stmt.order_by(DispatchModel.created_at.desc()).limit(10)
        res = await session.execute(stmt)
        dispatches = res.scalars().all()

        if not dispatches:
            return {
                "category": "dispatch",
                "authorized": True,
                "found": False,
                "message": f"No dispatch orders found"
                + (f" matching '{dispatch_number}'." if dispatch_number else " in the dispatch queue."),
            }

        is_gate = "GATE_SECURITY" in roles_upper and "ADMIN" not in roles_upper and "DISPATCH" not in roles_upper

        dispatch_list = []
        for d in dispatches:
            d_dict: Dict[str, Any] = {
                "dispatch_number": d.dispatch_number,
                "order_number": d.order_number,
                "status": d.status,
                "route_code": d.route_code or "Standard",
                "priority": d.priority,
                "gate_exit_verified": bool(d.gate_exit_vehicle_verified),
            }
            if not is_gate:
                d_dict["customer_name"] = d.customer_name
                d_dict["destination"] = d.destination or "Destination unspecified"
                d_dict["current_location"] = d.current_location
                d_dict["scheduled_date"] = d.scheduled_date.isoformat() if d.scheduled_date else None
            else:
                d_dict["vehicle_id"] = d.vehicle_id
                d_dict["driver_id"] = d.driver_id

            dispatch_list.append(d_dict)

        return {
            "category": "dispatch",
            "authorized": True,
            "found": True,
            "dispatches": dispatch_list,
        }

    async def retrieve_warehouse_locations(
        self, query: str, user: CurrentUser, session: AsyncSession
    ) -> Dict[str, Any]:
        """Read the configured zone/bin hierarchy, respecting store-user assignment."""
        roles_upper = {role.upper() for role in (user.roles or [])}
        if roles_upper.intersection({"SUPPLIER", "GATE_SECURITY", "FINANCE"}):
            return {
                "category": "locations",
                "authorized": False,
                "reason": "Your role does not have authorization to view warehouse storage locations.",
            }

        stmt = select(StoreZoneModel).order_by(StoreZoneModel.zone_code.asc())
        store_ids: Set[uuid.UUID] = set()
        is_store_user = bool(roles_upper.intersection({"STORE_MANAGER", "STORE_KEEPER"}))
        if is_store_user and not roles_upper.intersection({"ADMIN", "WAREHOUSE", "WAREHOUSE_MANAGER"}):
            store_ids, _ = await resolve_user_store_context(user, session)
            if not store_ids:
                return {
                    "category": "locations",
                    "authorized": False,
                    "reason": "No assigned warehouse location scope was found for your account.",
                }
            stmt = stmt.where(StoreZoneModel.store_id.in_(store_ids))

        zones_result = await session.execute(stmt)
        zone_models = zones_result.scalars().all()
        if not zone_models:
            return {
                "category": "locations",
                "authorized": True,
                "found": False,
                "message": "No storage zones are configured in the warehouse.",
                "zones": [],
            }

        zone_ids = [zone.id for zone in zone_models]
        bins_result = await session.execute(
            select(StoreBinModel)
            .where(StoreBinModel.zone_id.in_(zone_ids))
            .order_by(StoreBinModel.bin_code.asc())
        )
        bins_by_zone: Dict[uuid.UUID, List[Dict[str, Any]]] = {zone_id: [] for zone_id in zone_ids}
        for bin_model in bins_result.scalars().all():
            bins_by_zone.setdefault(bin_model.zone_id, []).append({
                "bin_code": bin_model.bin_code,
                "bin_name": bin_model.bin_name,
                "status": bin_model.status,
                "rack": bin_model.rack,
                "shelf": bin_model.shelf,
                "position": bin_model.position,
            })

        return {
            "category": "locations",
            "authorized": True,
            "found": True,
            "zones": [
                {
                    "zone_code": zone.zone_code,
                    "zone_name": zone.zone_name,
                    "status": zone.status,
                    "bins": bins_by_zone.get(zone.id, []),
                }
                for zone in zone_models
            ],
        }

    async def retrieve_docks(
        self, query: str, user: CurrentUser, session: AsyncSession
    ) -> Dict[str, Any]:
        """Read configured warehouse docks and their current operational status."""
        roles_upper = {role.upper() for role in (user.roles or [])}
        if roles_upper.intersection({"SUPPLIER", "FINANCE"}):
            return {
                "category": "docks",
                "authorized": False,
                "reason": "Your role does not have authorization to view warehouse dock details.",
            }

        stmt = select(DockModel).order_by(DockModel.dock_number.asc())
        status_filter = None
        if re.search(r"\bavailable\b", query, re.IGNORECASE):
            status_filter = "AVAILABLE"
        elif re.search(r"\boccupied|in\s+use|at\s+dock\b", query, re.IGNORECASE):
            status_filter = "OCCUPIED"
        elif re.search(r"\bmaintenance|out\s+of\s+service\b", query, re.IGNORECASE):
            status_filter = "MAINTENANCE"
        if status_filter:
            stmt = stmt.where(func.upper(DockModel.status) == status_filter)

        result = await session.execute(stmt)
        docks = result.scalars().all()
        if not docks:
            return {
                "category": "docks",
                "authorized": True,
                "found": False,
                "message": "No warehouse docks match that request.",
                "docks": [],
                "status_filter": status_filter,
            }
        return {
            "category": "docks",
            "authorized": True,
            "found": True,
            "status_filter": status_filter,
            "docks": [
                {
                    "dock_number": dock.dock_number,
                    "warehouse": dock.warehouse_id,
                    "dock_type": dock.dock_type,
                    "status": dock.status,
                    "capacity": dock.capacity,
                }
                for dock in docks
            ],
        }

    def detect_category(self, query: str) -> Optional[str]:
        """
        Determine if the user query asks about a supported live operational category.
        Returns category key or None for general warehouse knowledge questions.
        """
        q = query.lower()

        # Exclude direct write commands without blocking read questions about statuses/actions.
        if re.match(
            r"\s*(?:(?:please|can you|could you|would you)\s+)*(?:approve|create|delete|"
            r"update|drop|cancel|execute|issue|reserve|modify|remove|edit|allocate)\b",
            q,
        ):
            return None

        # 1. Purchase orders
        if re.search(r"\b(pos|po|purchase[\s_-]?orders?|po[\s_-]?numbers?|rfqs?|procurement|sourcing|vendor[\s_-]?orders?|supplier[\s_-]?orders?)\b", q) or extract_identifier(query, r"\bPO-[A-Z0-9-]+\b"):
            return "purchase_orders"

        # 2. Putaway
        if re.search(r"\b(putaways?|put[\s_-]?aways?|bin[\s_-]?placements?|stow(?:ing)?|storage[\s_-]?assignments?|pending[\s_-]?placements?)\b", q) or extract_identifier(query, r"\b(TASK|PUT|PT)-[A-Z0-9-]+\b"):
            return "putaway"

        # 3. Gate entries / Inbound
        if re.search(r"\b(gate|gates|security|gate[\s_-]?entries|gate[\s_-]?entry|gate[\s_-]?passes|gate[\s_-]?pass|vehicle[\s_-]?(?:entry|exit|queue|check[\s_-]?in|check[\s_-]?out)|inbound|arriv(al|als|ed|ing)|truck|asns?|advance[\s_-]?shipping[\s_-]?notices?|dock[\s_-]?arrivals?)\b", q) or extract_identifier(query, r"\b(GE|GATE|ASN)-[A-Z0-9-]+\b"):
            return "gate_entries"

        # 4. Dock master and operational availability. Keep loading bays ahead
        # of dispatch loading so the physical location intent wins.
        if re.search(r"\b(docks?|loading[\s_-]?bays?|unloading[\s_-]?bays?)\b", q):
            return "docks"

        # 5. Assembly
        if re.search(r"\b(assembly|assemblies|manufacturing|shop[\s_-]?floor|wip|assembly[\s_-]?orders?|work[\s_-]?orders?|boms?|production|production[\s_-]?orders?|production[\s_-]?lines?|assembly[\s_-]?builds?)\b", q) or extract_identifier(query, r"\b(AO|ASSY|WO)-[A-Z0-9-]+\b"):
            return "assembly"

        # 6. Dispatch
        if re.search(r"\b(dispatches|dispatch|customer[\s_-]?orders?|outbound|shipments?|shipment[\s_-]?status|delivery|delivery[\s_-]?routes?|consignment|transport|logistics|picking[\s_-]?packing|loading|gate[\s_-]?out)\b", q) or extract_identifier(query, r"\b(DISP|DSP|DO)-[A-Z0-9-]+\b"):
            return "dispatch"

        # 7. Inventory & Stock
        if re.search(r"\b(stocks?|inventory|stock[\s_-]?ledger|stock[\s_-]?balance|on[\s_-]?hands?|available|availability|reorders?|shortages?|skus?|items?|batches?|lots?|material[\s_-]?stocks?|bin[\s_-]?balances?)\b", q) or extract_identifier(query, r"\b(MAT|RM|PKG|FG|ITEM|SKU)-[A-Z0-9-]+\b"):
            return "inventory"

        # 8. Warehouse layout / zone and bin master
        if re.search(r"\b(zones?|bins?|racks?|shelves?|aisles?|storage[\s_-]?locations?|location[\s_-]?hierarchy|warehouse[\s_-]?layout)\b", q):
            return "locations"

        return None
