"""
Queries for procurement use cases.
"""
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class ListPurchaseOrdersQuery:
    status: Optional[str] = None
    supplier_id: Optional[str] = None
    search_query: Optional[str] = None
    limit: int = 50
    offset: int = 0
