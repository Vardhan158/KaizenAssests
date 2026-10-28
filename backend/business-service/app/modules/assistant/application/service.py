"""Deterministic, read-only assistant for Kaizen AMS warehouse operations."""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.assistant.application.data_retriever import AssistantDataRetriever
from app.modules.assistant.domain.schemas import AssistantChatRequest, AssistantChatResponse
from app.security.dependencies import CurrentUser

logger = logging.getLogger("ams.assistant.service")

STANDARD_FALLBACK = (
    "I’m the Kaizen AMS operations assistant. I can help with warehouse inventory, "
    "purchase orders, inbound and gate entries, putaway, assembly, and dispatch. "
    "Please ask a question about one of these areas."
)
READ_ONLY_REPLY = (
    "I can look up operational information, but I can’t create, edit, approve, reserve, "
    "issue, or otherwise change records. Please use the relevant AMS workflow."
)
UNSUPPORTED_REPLY = (
    "I can help with live warehouse records and basic receiving, putaway, inventory, "
    "assembly, and dispatch guidance. Please include a record number or ask about one "
    "of those workflows."
)

DOMAIN_TERMS = re.compile(
    r"\b(warehouses?|inventory|stocks?|materials?|skus?|items?|batches?|lots?|bins?|zones?|"
    r"racks?|shelves?|aisles?|locations?|putaway|stow|storage|"
    r"purchase\s*orders?|procurement|\bpos?\b|\brfqs?\b|vendors?|suppliers?|gate|security|inbound|"
    r"arrival|truck|asn|docks?|grns?|goods\s+receipt|receiving|quarantine|"
    r"assembly|manufacturing|work\s+orders?|bom|production|wip|finished\s+goods|dispatch|"
    r"shipment|outbound|transport|logistics|delivery|picking|packing|loading|gate\s*out|"
    r"requisition|fifo|fefo|aging|ageing|allocation|allocated|"
    r"reservation|reserved|quantity|capacity|"
    r"qc|quality|inspection|damage|claims?|hold|holds|returns?|cycle.count|stock.take|shortage|"
    r"receipt|receipts|issue|issued|issue.stock|material.request|assembly.request)\b",
    re.IGNORECASE,
)
MUTATION_REQUEST = re.compile(
    r"^\s*(?:(?:please|can you|could you|would you|i want you to|i need you to)\s+)*(?:create|add|edit|"
    r"update|change|delete|remove|approve|reject|issue|reserve|allocate|"
    r"cancel|execute|submit|post)\b",
    re.IGNORECASE,
)
GREETING = re.compile(r"^(hi|hello|hey|good morning|good afternoon|good evening)[!. ]*$", re.I)
THANKS = re.compile(r"^(thanks|thank you|thx|appreciate it)[!. ]*$", re.I)

SPELLING_VARIANTS = {
    "inventry": "inventory",
    "invntory": "inventory",
    "warehosue": "warehouse",
    "recieving": "receiving",
    "receving": "receiving",
    "putway": "putaway",
    "put-away": "putaway",
    "assambly": "assembly",
    "asemmbly": "assembly",
    "despatch": "dispatch",
    "dispach": "dispatch",
    "suplier": "supplier",
    "suppplier": "supplier",
    "vehical": "vehicle",
}


def normalize_query(query: str) -> str:
    """Normalize common operational spelling variants before intent matching."""
    normalized = query
    for variant, replacement in SPELLING_VARIANTS.items():
        normalized = re.sub(rf"\b{re.escape(variant)}\b", replacement, normalized, flags=re.I)
    return normalized


class AssistantService:
    """Classify requests with rules, and use existing authorized lookups for live facts."""

    def __init__(self, data_retriever: Optional[AssistantDataRetriever] = None) -> None:
        self.data_retriever = data_retriever or AssistantDataRetriever()

    async def retrieve_context(
        self, query: str, user: CurrentUser, session: AsyncSession
    ) -> Optional[Dict[str, Any]]:
        category = self.data_retriever.detect_category(query)
        if not category:
            return None
        methods = {
            "inventory": self.data_retriever.retrieve_inventory,
            "purchase_orders": self.data_retriever.retrieve_purchase_orders,
            "putaway": self.data_retriever.retrieve_putaway_tasks,
            "gate_entries": self.data_retriever.retrieve_gate_entries,
            "assembly": self.data_retriever.retrieve_assembly_orders,
            "dispatch": self.data_retriever.retrieve_dispatch_status,
            "locations": self.data_retriever.retrieve_warehouse_locations,
            "docks": self.data_retriever.retrieve_docks,
        }
        try:
            method = methods.get(category)
            return await method(query, user, session) if method else None
        except Exception:
            logger.exception("Assistant lookup failed for category %s", category)
            return {"category": category, "error": True}

    @staticmethod
    def _format_records(facts: Dict[str, Any], query: str = "") -> str:
        category = facts.get("category", "records")
        if not facts.get("authorized", True):
            return facts.get("reason", "Your role is not authorized to view these records.")
        if facts.get("error"):
            return "I couldn’t retrieve those records because of a temporary database issue. Please try again."
        if not facts.get("found", True):
            if facts.get("category") == "docks" and re.search(r"\bhow\s+many\b", query, re.IGNORECASE):
                return "There are 0 warehouse docks configured."
            if facts.get("category") == "locations" and re.search(r"\bhow\s+many\b", query, re.IGNORECASE):
                if re.search(r"\bbins?\b", query, re.IGNORECASE):
                    return "There are 0 storage bins configured across 0 zones."
                return "There are 0 storage zones configured in your warehouse."
            return facts.get("message", "No matching records were found.")

        if category == "locations":
            zones = facts.get("zones") or []
            bins = [bin_record for zone in zones for bin_record in zone.get("bins", [])]
            q = query.lower()
            if (
                re.search(r"\bhow\s+many\b", q)
                and re.search(r"\bbin", q)
                and re.search(r"\b(each|per)\s+zone\b", q)
            ):
                if not zones:
                    return "No storage zones are configured in the warehouse."
                lines = ["Configured bins by zone:"]
                for zone in zones:
                    zone_bins = zone.get("bins") or []
                    name = zone.get("zone_name") or zone.get("zone_code") or "Unnamed zone"
                    lines.append(f"• {name}: {len(zone_bins)} bin{'s' if len(zone_bins) != 1 else ''}.")
                return "\n".join(lines)
            if re.search(r"\bhow\s+many\b", q) and re.search(r"\bzone", q) and re.search(r"\bbin", q):
                return (
                    f"Your warehouse has {len(zones)} zone{'s' if len(zones) != 1 else ''} "
                    f"and {len(bins)} bin{'s' if len(bins) != 1 else ''} configured."
                )
            if re.search(r"\bhow\s+many\b", q) and re.search(r"\bzone", q):
                return f"There {'is' if len(zones) == 1 else 'are'} {len(zones)} storage zone{'s' if len(zones) != 1 else ''} configured in your warehouse."
            if re.search(r"\bhow\s+many\b", q) and re.search(r"\bbin", q):
                return f"There {'is' if len(bins) == 1 else 'are'} {len(bins)} storage bin{'s' if len(bins) != 1 else ''} configured across {len(zones)} zone{'s' if len(zones) != 1 else ''}."
            if not zones:
                return "No storage zones are configured in the warehouse."
            lines = [f"Warehouse storage layout: {len(zones)} zone{'s' if len(zones) != 1 else ''}, {len(bins)} bin{'s' if len(bins) != 1 else ''}."]
            for zone in zones:
                title = f"{zone.get('zone_code', 'Zone')} — {zone.get('zone_name', 'Unnamed zone')}"
                zone_bins = zone.get("bins") or []
                if zone_bins:
                    lines.append(f"• {title} ({len(zone_bins)} bins): " + ", ".join(
                        f"{item.get('bin_code')} — {item.get('bin_name')}" for item in zone_bins
                    ))
                else:
                    lines.append(f"• {title}: no bins configured.")
            return "\n".join(lines)

        if category == "docks":
            docks = facts.get("docks") or []
            status_filter = facts.get("status_filter")
            if re.search(r"\bhow\s+many\b", query, re.IGNORECASE):
                scope = f" {status_filter.lower()}" if status_filter else ""
                return f"There {'is' if len(docks) == 1 else 'are'} {len(docks)}{scope} dock{'s' if len(docks) != 1 else ''} configured in your warehouse."
            if not docks:
                return "No warehouse docks are configured."
            lines = [f"Warehouse docks ({len(docks)}):"]
            for dock in docks:
                detail = f"{dock.get('dock_number', 'Dock')} — {dock.get('status', 'Status unknown')}"
                if dock.get("dock_type"):
                    detail += f", {dock['dock_type']}"
                if dock.get("warehouse"):
                    detail += f", warehouse {dock['warehouse']}"
                lines.append(f"• {detail}.")
            return "\n".join(lines)

        keys = {
            "inventory": ("items", "Inventory"),
            "purchase_orders": ("orders", "Purchase order"),
            "putaway": ("tasks", "Putaway task"),
            "gate_entries": ("entries", "Inbound record"),
            "assembly": ("orders", "Assembly order"),
            "dispatch": ("dispatches", "Dispatch"),
            "locations": ("zones", "Zone"),
            "docks": ("docks", "Dock"),
        }
        collection_key, label = keys.get(category, ("items", "Record"))
        records = facts.get(collection_key) or []
        if not records:
            return "No matching records were found."

        lines = [f"{label}{'s' if len(records) != 1 else ''} ({len(records)}):"]
        for item in records[:10]:
            if category == "inventory":
                name = item.get("material_name") or item.get("material_code", "Material")
                code = item.get("material_code")
                quantity = item.get("available_quantity", item.get("available", item.get("on_hand")))
                total = item.get("total_quantity", item.get("on_hand"))
                uom = item.get("uom") or "units"
                location = item.get("location") or item.get("bin") or item.get("warehouse")
                detail = f"available {quantity} {uom}"
                if total is not None and total != quantity:
                    detail += f", on hand {total} {uom}"
                if location:
                    detail += f", location {location}"
                lines.append(f"• {name}{f' ({code})' if code else ''}: {detail}.")
            else:
                identifier = next(
                    (item.get(k) for k in (
                        "po_number", "task_number", "gate_entry_number", "asn_number",
                        "order_number", "dispatch_number",
                    ) if item.get(k)),
                    None,
                )
                details = []
                for key, title in (
                    ("status", "status"), ("supplier_name", "supplier"),
                    ("vehicle_number", "vehicle"), ("assigned_dock", "dock"),
                    ("material_name", "material"), ("quantity", "quantity"),
                    ("destination_bin", "bin"), ("destination_zone", "zone"),
                    ("product_name", "product"), ("planned_quantity", "planned"),
                    ("completed_quantity", "completed"), ("scheduled_date", "scheduled"),
                    ("required_date", "required"), ("customer_name", "customer"),
                    ("current_location", "location"),
                ):
                    value = item.get(key)
                    if value not in (None, "", "[RESTRICTED_FINANCIAL_FIELD]"):
                        details.append(f"{title} {value}")
                title = f"{identifier}: " if identifier else ""
                lines.append(f"• {title}{'; '.join(details) or 'record found'}.")
        if len(records) == 10:
            lines.append("Showing up to 10 records. Add a record number to narrow the search.")
        return "\n".join(lines)

    @staticmethod
    def _workflow_reply(query: str) -> Optional[str]:
        q = query.lower()
        # Short, plain-language definitions for the labels users see in the
        # warehouse dashboard. Keep these ahead of broader workflow matches.
        metric_replies = []
        if re.search(r"\b(stocked\s+(?:locations?|allocations?)|occupied\s+bins?)\b", q):
            metric_replies.append(
                "Stocked Locations counts distinct location labels that appear on inventory summary rows, excluding blank or dash-only locations. It counts locations, not stock units. If stock has no bin assignment, the dashboard may count its ‘Unassigned location’ label as one location."
            )
        if re.search(r"\bmaterial\s+lines?\b", q):
            metric_replies.append(
                "Material Lines is the number of inventory summary rows shown by the dashboard. It represents stock records or lines, not the number of units; a material can have more than one line when it is represented in multiple records or locations."
            )
        if re.search(r"\b(available\s+(?:stock|inventory)|free\s+stock)\b", q):
            metric_replies.append(
                "Available stock is the quantity currently free to pick or issue. It excludes quantities already reserved or otherwise unavailable; the exact balance is shown in the inventory lookup."
            )
        if re.search(r"\b(on.hand|total\s+stock|physical\s+stock)\b", q):
            metric_replies.append(
                "On-hand stock is the total recorded quantity physically held in inventory. Available stock can be lower when some units are reserved or unavailable."
            )
        if re.search(r"\b(reserved|reservation|allocated\s+stock)\b", q):
            metric_replies.append(
                "Reserved or allocated stock is set aside for a request or operation, so it is not available for another pick. Use the relevant requisition or inventory record to see its current status."
            )
        if re.search(r"\b(zone|zones|bin|bins|storage\s+location)\b", q) and re.search(
            r"\b(mean|means|meaning|definition|difference|explain)\b", q
        ):
            metric_replies.append(
                "A zone is a named area of the warehouse. A bin is a specific storage position inside a zone. Stock should be assigned to the bin where it is physically stored."
            )
        if re.search(r"\b(dock|docks)\b", q) and re.search(
            r"\b(mean|means|meaning|definition|used\s+for|purpose)\b", q
        ):
            metric_replies.append(
                "A dock is the warehouse vehicle loading or unloading point. In this warehouse, the configured dock is allocated to an inbound arrival and becomes available again when receiving is completed and the GRN workflow releases it."
            )
        if metric_replies:
            return "\n\n".join(metric_replies)

        workflows = (
            (r"\b(fifo|pick\s+order|older\s+stock|oldest\s+stock|expiry|expired)\b",
             "Use FIFO: pick the oldest eligible stock first. If older eligible stock remains, the system should block picking a newer batch until the older stock is cleared. Quarantined or expired stock is not eligible."),
            (r"\b(grn|goods\s+receipt|receive\s+goods|receiving)\b",
             "For receiving, verify the inbound or gate entry and purchase order, record the received quantities and any discrepancies, then post the GRN. Posted receipt quantities become available for putaway and inventory workflows."),
            (r"\b(available\s+vs\s+on.hand|on.hand\s+vs\s+available|difference\s+between\s+(?:available|on.hand))\b",
             "On-hand is the total recorded stock quantity. Available is the portion free to use after reservations or other unavailable quantities are accounted for."),
            (r"\b(putaway|put\s+away)\b",
             "Putaway moves received stock from its receiving area into a configured warehouse bin. Review the open task, confirm the material and quantity, and place it in the assigned eligible bin."),
            (r"\b(requisition|material\s+request)\b",
             "A material requisition requests stock for an operation. Review its lines and availability, then use the requisition workflow to approve or fulfill it; I can look up requisition-related inventory and assembly records."),
            (r"\b(dock\s+allocation|allocate\s+a\s+dock)\b",
             "Dock allocation is tied to an inbound gate entry. Select the active inbound entry, allocate the available dock, and complete receiving through the GRN workflow."),
            (r"\b(quarantine|quality\s+(?:hold|check|inspection)|qc\s+hold)\b",
             "Quarantined or QC-held stock is not eligible for normal picking or issue. Check the material or batch status and follow the quality workflow to release it before use."),
            (r"\b(pick(?:ing)?|fifo|older\s+stock|oldest\s+stock)\b",
             "For picking, select the oldest eligible stock first (FIFO). If older eligible stock remains, newer stock must stay blocked until the older stock is cleared. Quarantined and expired stock is excluded."),
            (r"\b(assembly|work\s+order|production)\b",
             "Assembly requisitions request materials for an assembly or work order. Review the request and its material availability, then handle approval and fulfillment in Assembly Requisitions. I can look up available stock, but I cannot reserve or issue it."),
            (r"\b(dispatch|shipment|outbound|delivery)\b",
             "Dispatch tracks outbound orders and shipment progress. Ask for a dispatch or order number to look up a specific record; dispatch changes must be made in the Dispatch workflow."),
            (r"\b(purchase\s+order|\bpo\b|supplier|vendor)\b",
             "Purchase orders record supplier orders and their fulfillment status. Ask with a PO number for a specific lookup. Supplier pricing and other restricted fields are hidden according to your role."),
            (r"\b(gate\s+entry|gate\s+pass|asn|inbound|truck\s+arrival)\b",
             "Inbound and gate-entry records track expected or arrived vehicles and their receiving progress. Include the gate-entry, ASN, or vehicle number to look up a specific arrival."),
            (r"\b(damage|damaged|shortage|excess|discrepancy|claim|replacement|return)\b",
             "Record damaged, short, or excess quantities during receiving or quality inspection. Attach evidence where required, then use the damage-claim or return workflow for supplier response, replacement, and closure."),
            (r"\b(cycle\s*count|stock\s*take|physical\s+count|stock\s+audit)\b",
             "A cycle count compares physical stock with the recorded balance for selected materials or locations. Investigate differences and post approved adjustments through the inventory workflow."),
            (r"\b(material\s+issue|issue\s+material|issue\s+stock)\b",
             "Material issue records stock handed to an approved request or production order. Confirm the request, eligible batch, quantity, and destination before posting the issue."),
            (r"\b(finished\s+goods|fg\s+store|fg\s+pickup)\b",
             "Finished goods move from completed assembly and quality checks into finished-goods storage, then into an approved dispatch or supplier pickup workflow."),
            (r"\b(vehicle\s+(?:entry|exit)|check[ -]?in|check[ -]?out|gate\s*out)\b",
             "Vehicle entry verifies the expected delivery or pickup, driver, vehicle, and documents. Vehicle exit is completed only after the related receiving or dispatch checks are satisfied."),
            (r"\b(zone|bin|storage\s+location)s?\s+(?:setup|configuration|creation)|"
             r"\b(?:create|configure|set\s+up|add)\s+(?:a\s+)?(?:zone|bin|storage\s+location)\b",
             "Warehouse locations are organized by zone and bin. Create or maintain zones and bins in Warehouse Location Hierarchy, use a clear zone name and unique location code, and assign stock to a bin within its zone. I can explain the setup, but record changes must be made in that module."),
        )
        for pattern, reply in workflows:
            if re.search(pattern, q):
                return reply
        if re.search(r"\b(help|what can you do|how do i use you)\b", q):
            return (
                "I can look up inventory, purchase orders, inbound gate entries, putaway tasks, "
                "assembly orders, and dispatches, and explain basic receiving, FIFO, and putaway workflows. "
                "Include a record number when you have one. I’m read-only and can’t change records."
            )
        return None

    async def generate_reply(
        self,
        request: AssistantChatRequest,
        user: CurrentUser,
        session: Optional[AsyncSession] = None,
    ) -> AssistantChatResponse:
        query = normalize_query(request.message.strip())
        if MUTATION_REQUEST.search(query):
            reply = READ_ONLY_REPLY
        elif GREETING.fullmatch(query):
            reply = "Hello! I can help with Kaizen AMS warehouse and operations questions. What would you like to look up?"
        elif THANKS.fullmatch(query):
            reply = "You’re welcome. Ask whenever you need help with an AMS operations lookup."
        elif not DOMAIN_TERMS.search(query):
            reply = STANDARD_FALLBACK
        else:
            asks_for_guidance = bool(re.search(
                r"\b(how\b|why\b|when\b|where\b|who\b|steps?\s+to|explain|"
                r"guide|what\b|tell\s+me|meaning|difference|purpose|used\s+for|"
                r"can\s+i|should\s+i|do\s+i)\b",
                query,
                re.IGNORECASE,
            ))
            asks_for_live_records = bool(re.search(
                r"\b(show|list|find|search|look\s+up|lookup|status|how\s+many|count|"
                r"available|availability|on[ -]hand|where\s+is|which|details|records?)\b",
                query,
                re.IGNORECASE,
            )) or bool(re.search(r"\b(?:PO|GE|GATE|ASN|AO|ASSY|WO|DISP|DO|MAT|RM|PKG|FG|ITEM|TASK|PUT|PT)-[A-Z0-9-]+\b", query, re.I))
            reply = self._workflow_reply(query) if asks_for_guidance and not asks_for_live_records else None
            reply = reply or ""
            if not reply and session is not None:
                facts = await self.retrieve_context(query, user, session)
                if facts:
                    reply = self._format_records(facts, query)
            if not reply:
                reply = UNSUPPORTED_REPLY

        return AssistantChatResponse(reply=reply, model="rules-v1", role="assistant")


def get_assistant_service() -> AssistantService:
    return AssistantService()
