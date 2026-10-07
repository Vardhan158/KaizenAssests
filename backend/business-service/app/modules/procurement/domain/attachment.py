"""
PurchaseOrderAttachment entity representing Section 5: ATTACHMENTS.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import uuid

from app.modules.procurement.domain.value_objects import AttachmentCategory


@dataclass
class PurchaseOrderAttachment:
    id: uuid.UUID
    filename: str
    file_type: str
    file_path: str
    file_size_bytes: int
    category: AttachmentCategory
    created_at: datetime

    @classmethod
    def create(
        cls,
        filename: str,
        file_type: str,
        file_path: str,
        file_size_bytes: int,
        category: AttachmentCategory | str = AttachmentCategory.SUPPORTING_DOC,
        attachment_id: uuid.UUID | None = None,
        created_at: datetime | None = None,
    ) -> "PurchaseOrderAttachment":
        cat = AttachmentCategory(category) if isinstance(category, str) else category
        return cls(
            id=attachment_id or uuid.uuid4(),
            filename=filename,
            file_type=file_type,
            file_path=file_path,
            file_size_bytes=file_size_bytes,
            category=cat,
            created_at=created_at or datetime.now(timezone.utc),
        )
