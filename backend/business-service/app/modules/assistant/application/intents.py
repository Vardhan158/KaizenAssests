"""Shared vocabulary for deterministic matching; never interprets chat as permissions."""
from __future__ import annotations

import re
import unicodedata


ALIASES = {
    "inventry": "inventory", "invntory": "inventory", "warehosue": "warehouse",
    "recieving": "receiving", "receving": "receiving", "reciept": "receipt",
    "putway": "putaway", "put-away": "putaway", "assambly": "assembly",
    "asemmbly": "assembly", "despatch": "dispatch", "dispach": "dispatch",
    "suplier": "supplier", "suppplier": "supplier", "vehical": "vehicle",
    "vechicle": "vehicle", "puchase": "purchase", "pruchase": "purchase",
    "quanity": "quantity", "availble": "available", "manufaturing": "manufacturing",
    "quarentine": "quarantine", "allotement": "allocation",
    "qty": "quantity", "avl": "available", "pls": "please", "plz": "please",
    "p.o.": "PO", "g.r.n.": "GRN", "a.s.n.": "ASN",
}


def normalize_query(query: str) -> str:
    query = unicodedata.normalize("NFKC", query).translate(str.maketrans({
        "\u2019": "'", "\u2013": "-", "\u2014": "-", "\u2011": "-", "\u2010": "-", "\u200b": "",
    }))
    for word, replacement in ALIASES.items():
        query = re.sub(rf"(?<!\w){re.escape(word)}(?!\w)", replacement, query, flags=re.I)
    return re.sub(r"\s+", " ", query).strip()


# Specific phrases precede generic stock/material words. Generic "open orders"
# deliberately needs clarification instead of guessing a business module.
CATEGORY_PATTERNS = {
    "admin": r"users?|accounts?|employees?|permissions?|roles?|audit[ _-]?(?:logs?|activity)|login[ _-]?activity|assembly[ _-]?units?",
    "putaway": r"put[ _-]?aways?|stow(?:ing)?|bin[ _-]?placements?|storage[ _-]?assignments?|pending[ _-]?placements?|received[ _-]?stock[ _-]?(?:placement|movement)|move[ _-]?to[ _-]?bin",
    "docks": r"docks?|(?:un)?loading[ _-]?bays?",
    "purchase_orders": r"pos?|purchase[ _-]?orders?|procurement|rfqs?|quotations?|sourcing|(?:supplier|vendor)[ _-]?orders?|ordered[ _-]?materials?",
    "dispatch": r"dispatch(?:es)?|outbound|shipments?|shipped|customer[ _-]?orders?|consignments?|transport|logistics|pick[ _-]?(?:lists?|waves?)|picking|packing|packed|loading|loaded|ready[ _-]?to[ _-]?ship|gate[ _-]?out|proof[ _-]?of[ _-]?delivery|pod|delivery[ _-]?routes?",
    "gate_entries": r"gates?|security|gate[ _-]?(?:entr(?:y|ies)|pass(?:es)?)|vehicles?|drivers?|inbound|arriv(?:al|als|ed|ing)|trucks?|lorr(?:y|ies)|asns?|advance[ _-]?shipping[ _-]?notices?|grns?|goods[ _-]?receipts?|receiving|unloading|weighbridge|deliver(?:y|ies)",
    "assembly": r"assembl(?:y|ies)|manufacturing|shop[ _-]?floor|wip|work[ _-]?orders?|boms?|bill[ _-]?of[ _-]?materials?|production|material[ _-]?(?:requests?|requisitions?)|requisitions?|finished[ _-]?goods?|fg[ _-]?(?:warehouse|pickup)",
    "locations": r"zones?|bins?|racks?|shelves?|aisles?|storage[ _-]?(?:locations?|capacity)|location[ _-]?hierarchy|warehouse[ _-]?(?:layout|map)|space[ _-]?utili[sz]ation",
    "inventory": r"stocks?|inventory|on[ _-]?hands?|availability|reorders?|shortages?|skus?|items?|materials?|batches?|lots?|serial[ _-]?numbers?|expiry|expired|fifo|fefo|quarantine|quality[ _-]?hold|qc[ _-]?hold|cycle[ _-]?count|stock[ _-]?take|balances?",
}

IDENTIFIERS = {
    "purchase_orders": "PO", "putaway": "TASK|PUT|PT",
    "gate_entries": "GE|GATE|ASN|GRN", "assembly": "AO|ASSY|WO",
    "dispatch": "DISP|DSP|DO|ORD", "inventory": "MAT|RM|PKG|FG|ITEM|SKU",
}


def detect_category(query: str) -> str | None:
    q = normalize_query(query)
    if re.match(r"\s*(?:(?:please|can you|could you|would you)\s+)*(?:approve|create|delete|update|drop|cancel|execute|issue|reserve|modify|remove|edit|allocate)\b", q, re.I):
        return None
    # A record number is more precise than incidental words in the question.
    for category, prefixes in IDENTIFIERS.items():
        if re.search(rf"\b(?:{prefixes})-[A-Z0-9]+(?:-[A-Z0-9]+)*\b", q, re.I):
            return category
    # "Where is material ... in a bin" is a stock lookup, not a bin master lookup.
    if re.search(r"\b(?:where\s+(?:is|are)|availability\s+of|stock\s+(?:of|for))\s+(?:the\s+)?(?:materials?|items?|stock|skus?)\b", q, re.I):
        return "inventory"
    if re.search(r"\b(?:fifo|fefo)\b", q, re.I):
        return "inventory"
    for category, pattern in CATEGORY_PATTERNS.items():
        if re.search(rf"\b(?:{pattern})\b", q, re.I):
            return category
    return None


def is_mutation(query: str) -> bool:
    # Guidance about an action is safe; direct requests to perform it are read-only.
    if re.match(r"^(?:how\b|what\b|why\b|explain\b|steps\b|guide\b|where\s+(?:can|do|should)\s+i\b)", query, re.I):
        return False
    return bool(re.search(
        r"(?:^|[.!?;]\s*|\b(?:please|also|then|and|can you|could you|would you|i need you to|i want you to)\s+)"
        r"(?:please\s+)?(?:create|add|edit|update|change|delete|remove|approve|reject|issue|reserve|allocate|cancel|execute|submit|post|assign|unassign|release|close|complete|mark|upload|import|modify)\b",
        query, re.I,
    ))
