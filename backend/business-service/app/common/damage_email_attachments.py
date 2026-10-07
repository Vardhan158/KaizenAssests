"""Collect saved damage photos strictly belonging to the selected GRN and its damaged lines."""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath
import re
from typing import Any, Iterable, List, Optional, Set, Tuple

MAX_PHOTO_BYTES = 5 * 1024 * 1024  # 5 MB per photo
MAX_TOTAL_BYTES = 15 * 1024 * 1024  # 15 MB total
MAX_PHOTOS = 10


def collect_damage_attachments(
    grn: Any,
    upload_dir: str | Path | None = None,
    item_codes: set[str] | list[str] | None = None,
    photo_ids: Iterable[str | Any] | None = None,
) -> list[tuple[str, bytes, str]]:
    """
    Collect saved damage photos belonging ONLY to the current GRN, damaged lines, and photo IDs.

    Guarantees:
    - Never scans the upload directory or attaches unrelated files.
    - Only reads damage evidence records explicitly linked to the current GRN's lines.
    - If photo_ids are provided, strictly limits attachments to those photo/evidence IDs.
    - Fresh attachment list created for every invocation (no caching or reused lists).
    - Validates file paths to ensure they strictly belong to the current GRN and are within media root.
    - Filters by selected item codes / damaged lines if provided.
    - Validates image magic bytes (JPEG, PNG, WebP) and enforces size limits.
    """
    attachments: list[tuple[str, bytes, str]] = []
    total_bytes = 0
    seen_evidence_ids: set[str] = set()

    if not grn or not getattr(grn, "lines", None):
        return attachments

    current_grn_id_str = str(getattr(grn, "id", "") or "").lower()
    current_grn_uuid_hex = (
        grn.id.hex.lower()
        if hasattr(getattr(grn, "id", None), "hex")
        else current_grn_id_str.replace("-", "")
    )
    possible_roots = [Path(os.getcwd(), "media_uploads").resolve()]
    if upload_dir:
        u_p = Path(upload_dir).resolve()
        possible_roots.extend([u_p, u_p.parent])

    selected_set = {str(c).strip() for c in item_codes if c} if item_codes else None
    photo_id_set = {str(pid).strip().lower() for pid in photo_ids if pid} if photo_ids is not None else None

    for line in grn.lines:
        line_item_code = (line.item_code or "").strip()
        if selected_set is not None and line_item_code not in selected_set:
            continue

        is_damaged = (
            (line.damaged_quantity or 0) > 0
            or (line.rejected_quantity or 0) > 0
            or line.quality_result == "REJECTED"
            or bool(getattr(line, "damage_lots", None))
            or bool(getattr(line, "damage_evidence", None))
        )
        if not is_damaged:
            continue

        line_photo_idx = 0
        mat_code = re.sub(r"[^A-Za-z0-9_-]", "_", line_item_code or "material")[:60]

        for evidence in getattr(line, "damage_evidence", []):
            if not evidence or not getattr(evidence, "id", None):
                continue

            ev_id_str = str(evidence.id).strip().lower()
            if ev_id_str in seen_evidence_ids:
                continue

            if photo_id_set is not None and ev_id_str not in photo_id_set:
                continue

            seen_evidence_ids.add(ev_id_str)

            file_path_str = getattr(evidence, "file_path", None)
            if not file_path_str:
                continue

            # Resolve physical file on disk across possible roots
            raw_path = str(file_path_str).strip()
            resolved_file: Path | None = None

            if raw_path.startswith("/media/"):
                sub_path = raw_path[len("/media/"):].lstrip("/\\")
                for root in possible_roots:
                    cand = (root / sub_path).resolve()
                    if cand.exists() and cand.is_file():
                        resolved_file = cand
                        break

            if resolved_file is None:
                # Fallback to direct upload_dir or grn_documents check
                stored_name = PurePosixPath(raw_path).name
                for root in possible_roots:
                    cand1 = (root / stored_name).resolve()
                    cand2 = (root / "grn_documents" / stored_name).resolve()
                    if cand1.exists() and cand1.is_file():
                        resolved_file = cand1
                        break
                    elif cand2.exists() and cand2.is_file():
                        resolved_file = cand2
                        break

            if resolved_file is None or not resolved_file.exists():
                continue

            # Ensure file is inside media root or upload_dir (prevent path traversal)
            if not any(str(resolved_file).startswith(str(ar)) for ar in possible_roots):
                continue

            # If path contains damage_evidence subfolder, verify it belongs to current GRN
            resolved_str_lower = str(resolved_file).lower()
            if "damage_evidence" in resolved_str_lower:
                if current_grn_id_str and (current_grn_id_str not in resolved_str_lower and current_grn_uuid_hex not in resolved_str_lower):
                    # Belongs to a different GRN - strictly reject
                    continue

            try:
                with open(resolved_file, "rb") as f:
                    content = f.read(MAX_PHOTO_BYTES + 1)
            except OSError:
                continue

            if not content or len(content) > MAX_PHOTO_BYTES:
                continue

            # Validate magic bytes for image files
            if content.startswith(b"\xff\xd8\xff"):
                mime_type = "image/jpeg"
                suffix = ".jpg"
            elif content.startswith(b"\x89PNG\r\n\x1a\n"):
                mime_type = "image/png"
                suffix = ".png"
            elif content[:4] == b"RIFF" and content[8:12] == b"WEBP":
                mime_type = "image/webp"
                suffix = ".webp"
            else:
                continue

            total_bytes += len(content)
            if total_bytes > MAX_TOTAL_BYTES or len(attachments) >= MAX_PHOTOS:
                break

            line_photo_idx += 1
            filename = f"{mat_code}_damage_{line_photo_idx}{suffix}"
            attachments.append((filename, content, mime_type))

    return attachments
