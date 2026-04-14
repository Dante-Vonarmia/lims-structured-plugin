import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from ..config import OUTPUT_DIR

_SIGNATURES_FILE = OUTPUT_DIR / "signatures.json"
_SIGNATURES_DIR = OUTPUT_DIR / "signatures"
_LOCK = threading.Lock()


def _now_text() -> str:
    return datetime.now().strftime("%Y/%m/%d %H:%M:%S")


def _ensure_store() -> None:
    _SIGNATURES_DIR.mkdir(parents=True, exist_ok=True)
    _SIGNATURES_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not _SIGNATURES_FILE.exists():
        _write_signatures_unlocked([])


def _read_signatures_unlocked() -> list[dict[str, Any]]:
    _ensure_store()
    try:
        payload = json.loads(_SIGNATURES_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(payload, list):
        return []
    rows = [x for x in payload if isinstance(x, dict)]
    changed = False
    for row in rows:
        if "role" not in row:
            row["role"] = ""
            changed = True
    if changed:
        _write_signatures_unlocked(rows)
    return rows


def _write_signatures_unlocked(rows: list[dict[str, Any]]) -> None:
    tmp_path = Path(f"{_SIGNATURES_FILE}.tmp")
    tmp_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(_SIGNATURES_FILE)


def list_signatures() -> list[dict[str, Any]]:
    with _LOCK:
        rows = _read_signatures_unlocked()
    result: list[dict[str, Any]] = []
    for row in rows:
        row_id = str(row.get("id", "")).strip()
        if not row_id:
            continue
        file_name = str(row.get("file_name", "")).strip()
        result.append(
            {
                "id": row_id,
                "name": str(row.get("name", "")).strip(),
                "role": str(row.get("role", "")).strip(),
                "file_name": file_name,
                "image_url": f"/api/signatures/{row_id}/image",
                "created_at": str(row.get("created_at", "")).strip(),
                "updated_at": str(row.get("updated_at", "")).strip(),
            }
        )
    return result


def create_signature(*, name: str, role: str, content: bytes, suffix: str) -> dict[str, Any]:
    row_id = f"sig-{uuid4().hex}"
    safe_suffix = str(suffix or "").strip().lower()
    if safe_suffix not in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
        safe_suffix = ".png"
    file_name = f"{row_id}{safe_suffix}"
    file_path = _SIGNATURES_DIR / file_name
    file_path.write_bytes(content)
    now = _now_text()
    row = {
        "id": row_id,
        "name": str(name or "").strip(),
        "role": str(role or "").strip(),
        "file_name": file_name,
        "created_at": now,
        "updated_at": now,
    }
    with _LOCK:
        rows = _read_signatures_unlocked()
        rows.insert(0, row)
        _write_signatures_unlocked(rows)
    return {
        "id": row_id,
        "name": row["name"],
        "role": row["role"],
        "file_name": file_name,
        "image_url": f"/api/signatures/{row_id}/image",
        "created_at": now,
        "updated_at": now,
    }


def update_signature(
    signature_id: str,
    *,
    name: str | None = None,
    role: str | None = None,
    content: bytes | None = None,
    suffix: str = "",
) -> dict[str, Any] | None:
    with _LOCK:
        rows = _read_signatures_unlocked()
        for row in rows:
            if str(row.get("id", "")).strip() != signature_id:
                continue
            if name is not None:
                row["name"] = str(name).strip()
            if role is not None:
                row["role"] = str(role).strip()
            if content is not None:
                old_file = _SIGNATURES_DIR / str(row.get("file_name", "")).strip()
                safe_suffix = str(suffix or "").strip().lower()
                if safe_suffix not in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
                    safe_suffix = old_file.suffix.lower() or ".png"
                new_file_name = f"{signature_id}{safe_suffix}"
                new_file = _SIGNATURES_DIR / new_file_name
                new_file.write_bytes(content)
                row["file_name"] = new_file_name
                if old_file != new_file and old_file.exists():
                    try:
                        old_file.unlink()
                    except Exception:
                        pass
            row["updated_at"] = _now_text()
            _write_signatures_unlocked(rows)
            return {
                "id": str(row.get("id", "")).strip(),
                "name": str(row.get("name", "")).strip(),
                "role": str(row.get("role", "")).strip(),
                "file_name": str(row.get("file_name", "")).strip(),
                "image_url": f"/api/signatures/{signature_id}/image",
                "created_at": str(row.get("created_at", "")).strip(),
                "updated_at": str(row.get("updated_at", "")).strip(),
            }
    return None


def delete_signature(signature_id: str) -> bool:
    with _LOCK:
        rows = _read_signatures_unlocked()
        for idx, row in enumerate(rows):
            if str(row.get("id", "")).strip() != signature_id:
                continue
            file_name = str(row.get("file_name", "")).strip()
            del rows[idx]
            _write_signatures_unlocked(rows)
            file_path = _SIGNATURES_DIR / file_name
            if file_path.exists():
                try:
                    file_path.unlink()
                except Exception:
                    pass
            return True
    return False


def get_signature_file_path(signature_id: str) -> Path | None:
    with _LOCK:
        rows = _read_signatures_unlocked()
        for row in rows:
            if str(row.get("id", "")).strip() != signature_id:
                continue
            file_name = str(row.get("file_name", "")).strip()
            if not file_name:
                return None
            path = _SIGNATURES_DIR / file_name
            if path.exists() and path.is_file():
                return path
            return None
    return None


def resolve_signature_image_path(value: str) -> Path | None:
    candidate = str(value or "").strip()
    if not candidate:
        return None
    if candidate.startswith("sig-"):
        return get_signature_file_path(candidate)
    with _LOCK:
        rows = _read_signatures_unlocked()
        for row in rows:
            if str(row.get("name", "")).strip() == candidate:
                path = _SIGNATURES_DIR / str(row.get("file_name", "")).strip()
                if path.exists() and path.is_file():
                    return path
                return None
    path = Path(candidate)
    if path.exists() and path.is_file():
        return path
    return None
