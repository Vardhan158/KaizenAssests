from __future__ import annotations

from dataclasses import dataclass
from app.modules.procurement.domain.value_objects import SupplierId


@dataclass
class SupplierUser:
    supplier_id: SupplierId
    username: str
    password_hash: str
    must_change_password: bool = True
