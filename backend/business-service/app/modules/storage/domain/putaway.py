from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum
import uuid


class PutawayStatus(str, Enum):
    OPEN = "OPEN"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "PUTAWAY_IN_PROGRESS"
    COMPLETED = "PUTAWAY_COMPLETED"


@dataclass(frozen=True)
class PutawayTask:
    task_number: str
    grn_id: str
    item_code: str
    quantity: Decimal
    warehouse_id: str
    source_location: str
    destination_location_id: uuid.UUID | None
    destination_zone: str | None
    destination_rack: str | None
    destination_bin: str | None
    location_assigned_by: str | None
    location_assigned_at: datetime | None
    status: PutawayStatus = PutawayStatus.OPEN
