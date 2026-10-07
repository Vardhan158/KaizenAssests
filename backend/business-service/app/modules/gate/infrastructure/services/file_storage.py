"""
File Storage Service for validating and persisting uploaded images and documents.
"""
from __future__ import annotations

import os
import uuid

from app.modules.gate.application.exceptions import InvalidFileException

ALLOWED_MIME_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


class FileStorageService:
    def __init__(self, storage_dir: str = "media_uploads") -> None:
        self.storage_dir = storage_dir
        os.makedirs(self.storage_dir, exist_ok=True)

    def validate_file(self, content: bytes, filename: str, content_type: str | None) -> None:
        if not content:
            raise InvalidFileException(f"File '{filename}' is empty")

        if len(content) > MAX_FILE_SIZE_BYTES:
            raise InvalidFileException(
                f"File '{filename}' exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES / (1024 * 1024):.0f} MB"
            )

        if content_type and content_type.lower() not in ALLOWED_MIME_TYPES:
            # Fall back to checking filename extension
            ext = os.path.splitext(filename)[1].lower()
            if ext not in (".jpg", ".jpeg", ".png", ".webp", ".pdf"):
                raise InvalidFileException(
                    f"Unsupported file type '{content_type or ext}' for file '{filename}'. Supported types: JPG, PNG, WEBP, PDF."
                )

    async def save_file(self, content: bytes, filename: str, subfolder: str = "general") -> str:
        folder_path = os.path.join(self.storage_dir, subfolder)
        os.makedirs(folder_path, exist_ok=True)

        ext = os.path.splitext(filename)[1].lower() or ".bin"
        unique_name = f"{uuid.uuid4()}{ext}"
        file_path = os.path.join(folder_path, unique_name)

        with open(file_path, "wb") as f:
            f.write(content)

        return file_path.replace("\\", "/")
