"""Role-aware capabilities and prompt suggestions for the deterministic assistant."""
from __future__ import annotations

from typing import Iterable


ROLE_ALIASES = {
    "SUPERUSER": "ADMIN",
    "SUPER_ADMIN": "ADMIN",
    "ADMIN_OFFICER": "ADMIN",
    "WAREHOUSE_MANAGER": "WAREHOUSE",
    "ASSEMBLY_MANAGER": "ASSEMBLY",
    "ASSEMBLY_OPERATOR": "ASSEMBLY",
    "DISPATCH_MANAGER": "DISPATCH",
    "DISPATCH_OPERATOR": "DISPATCH",
    "PROCUREMENT_MANAGER": "PROCUREMENT",
    "PROCUREMENT_OFFICER": "PROCUREMENT",
    "QUALITY_MANAGER": "QUALITY",
    "QUALITY_INSPECTOR": "QUALITY",
    "GATE_OPERATOR": "GATE_SECURITY",
    "GATE_OFFICER": "GATE_SECURITY",
    "GRN_MANAGER": "GRN",
    "RECEIVING_OPERATOR": "RECEIVING",
    "QC": "QUALITY",
}

ALL_CATEGORIES = frozenset({
    "inventory", "purchase_orders", "putaway", "gate_entries",
    "assembly", "dispatch", "locations", "docks", "admin",
})

# This controls assistant visibility, not application write permissions. The data
# retriever still applies record-level restrictions (supplier ownership, warehouse, etc.).
ROLE_CATEGORIES = {
    "ADMIN": ALL_CATEGORIES,
    "WAREHOUSE": ALL_CATEGORIES - {"admin"},
    "MANAGER": ALL_CATEGORIES - {"admin"},
    "GATE_SECURITY": frozenset({"gate_entries", "docks", "dispatch"}),
    "GRN": frozenset({"gate_entries", "docks", "purchase_orders", "inventory", "putaway"}),
    "RECEIVING": frozenset({"gate_entries", "docks", "purchase_orders", "inventory", "putaway"}),
    "WAREHOUSE_OPERATOR": frozenset({"inventory", "putaway", "locations"}),
    "ASSEMBLY": frozenset({"assembly", "inventory", "locations"}),
    "DISPATCH": frozenset({"dispatch", "inventory", "gate_entries", "docks"}),
    "SUPPLIER": frozenset({"purchase_orders", "gate_entries"}),
    "PROCUREMENT": frozenset({"purchase_orders", "inventory", "gate_entries"}),
    "QUALITY": frozenset({"inventory", "gate_entries", "assembly"}),
    "FINANCE": frozenset({"purchase_orders", "inventory"}),
}

CATEGORY_LABELS = {
    "admin": "administration KPIs, users, assembly units, and audit activity",
    "inventory": "inventory and stock",
    "purchase_orders": "purchase orders and suppliers",
    "putaway": "putaway tasks",
    "gate_entries": "gate entries and inbound vehicles",
    "assembly": "assembly and production orders",
    "dispatch": "dispatch and outbound shipments",
    "locations": "warehouse zones and bins",
    "docks": "warehouse docks",
}

ROLE_SUGGESTIONS = {
    "ADMIN": (
        "Show today's inbound arrivals", "Show available inventory",
        "Show active assembly orders", "Show dispatch status",
        "How many zones, bins, and docks are configured?",
    ),
    "WAREHOUSE": (
        "Show available inventory", "Show pending putaway tasks",
        "Show today's inbound arrivals", "Where is material MAT-001?",
        "How many zones, bins, and docks are configured?",
    ),
    "GATE_SECURITY": (
        "Show today's inbound arrivals", "Show the vehicle queue",
        "Which docks are available?", "Show dispatches ready for gate out",
        "Explain vehicle check-in and check-out",
    ),
    "GRN": (
        "Show arrivals waiting for receiving", "Show open purchase orders",
        "Explain the GRN workflow", "Show pending putaway tasks",
        "Explain damaged material handling",
    ),
    "WAREHOUSE_OPERATOR": (
        "Show available inventory", "Show pending putaway tasks",
        "Where is material MAT-001?", "Explain FIFO picking",
        "Show warehouse zones and bins",
    ),
    "ASSEMBLY": (
        "Show active assembly orders", "Show material availability",
        "Explain material requests", "Show production progress",
        "Explain finished goods handover",
    ),
    "DISPATCH": (
        "Show dispatch status", "Show outbound orders",
        "Explain picking and packing", "Explain loading and gate out",
        "Show available inventory",
    ),
    "SUPPLIER": (
        "Show my purchase orders", "Show my inbound ASN status",
        "Explain ASN creation", "Explain damaged material claims",
        "Explain finished goods pickup",
    ),
    "PROCUREMENT": (
        "Show open purchase orders", "Show supplier orders",
        "Show out of stock inventory", "Show inbound ASN status",
        "Explain purchase order fulfillment",
    ),
    "QUALITY": (
        "Explain quarantined stock", "Explain quality inspection",
        "Explain damaged material handling", "Show assembly orders",
        "Explain stock release from quality hold",
    ),
    "FINANCE": (
        "Show purchase order status", "Show inventory summary",
        "Explain purchase order fulfillment",
    ),
}


def canonical_roles(roles: Iterable[str] | None) -> set[str]:
    normalized = {
        str(role).strip().upper().replace(" ", "_").replace("-", "_")
        for role in (roles or []) if str(role).strip()
    }
    return {ROLE_ALIASES.get(role, role) for role in normalized}


def allowed_categories(roles: Iterable[str] | None) -> set[str]:
    canonical = canonical_roles(roles)
    allowed: set[str] = set()
    for role in canonical:
        allowed.update(ROLE_CATEGORIES.get(role, ()))
    return allowed


def can_access_category(roles: Iterable[str] | None, category: str) -> bool:
    return category in allowed_categories(roles)


def primary_role(roles: Iterable[str] | None) -> str:
    canonical = canonical_roles(roles)
    priority = (
        "ADMIN", "WAREHOUSE", "GRN", "RECEIVING", "GATE_SECURITY", "WAREHOUSE_OPERATOR",
        "ASSEMBLY", "DISPATCH", "SUPPLIER", "PROCUREMENT", "QUALITY", "FINANCE", "MANAGER",
    )
    return next((role for role in priority if role in canonical), next(iter(canonical), "USER"))


def suggestions_for_roles(roles: Iterable[str] | None) -> tuple[str, ...]:
    role = primary_role(roles)
    role = {"RECEIVING": "GRN", "MANAGER": "WAREHOUSE"}.get(role, role)
    return ROLE_SUGGESTIONS.get(role, ("What can you do?",))


def capabilities_reply(roles: Iterable[str] | None) -> str:
    role = primary_role(roles).replace("_", " ").title()
    categories = allowed_categories(roles)
    if not categories:
        return (
            f"You are signed in as {role}. I can explain Kaizen AMS workflows, but no live-data "
            "areas are configured for this role. I am read-only and cannot change records."
        )
    labels = [CATEGORY_LABELS[key] for key in CATEGORY_LABELS if key in categories]
    examples = suggestions_for_roles(roles)[:3]
    return (
        f"You are signed in as {role}. I can securely look up "
        + ", ".join(labels)
        + ".\n\nTry: " + "; ".join(examples)
        + ".\n\nI am read-only and cannot create, approve, edit, or delete records."
    )


def unauthorized_reply(roles: Iterable[str] | None, category: str) -> str:
    role = primary_role(roles).replace("_", " ").title()
    label = CATEGORY_LABELS.get(category, "that area")
    return (
        f"Your {role} role is not permitted to view {label} through the assistant. "
        "Ask 'what can you do?' to see the live information available to your role."
    )
