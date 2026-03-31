import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from ..config import LOCAL_DOCUMENT_LIBRARY_FILE, RAW_RECORD_DIR, TEMPLATE_DIR, UPLOAD_DIR
from .docx_fill_service import build_r825b_payload, read_docx_tables

BASIC_FIELDS: tuple[str, ...] = (
    "device_name",
    "manufacturer",
    "device_model",
    "device_code",
    "certificate_no",
    "basis_standard",
    "location",
    "temperature",
    "humidity",
)


def rebuild_local_document_library() -> dict[str, Any]:
    templates = _build_template_index(TEMPLATE_DIR)
    raw_records = _build_raw_record_index(_resolve_raw_record_dirs())

    library: dict[str, Any] = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "basic_fields": list(BASIC_FIELDS),
        "summary": {
            "template_total": len(templates),
            "raw_record_total": len(raw_records),
            "template_with_core_markers": len([t for t in templates if t.get("has_core_markers")]),
            "raw_record_with_any_field": len([r for r in raw_records if r.get("coverage", 0) > 0]),
        },
        "templates": templates,
        "raw_records": raw_records,
    }

    LOCAL_DOCUMENT_LIBRARY_FILE.parent.mkdir(parents=True, exist_ok=True)
    LOCAL_DOCUMENT_LIBRARY_FILE.write_text(
        json.dumps(library, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return library


def load_local_document_library(force_rebuild: bool = False) -> dict[str, Any]:
    if force_rebuild or not LOCAL_DOCUMENT_LIBRARY_FILE.exists():
        return rebuild_local_document_library()
    try:
        data = json.loads(LOCAL_DOCUMENT_LIBRARY_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return rebuild_local_document_library()


def _build_template_index(template_dir: Path) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for path in sorted(template_dir.glob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix not in {".docx", ".html"}:
            continue

        markers = _extract_template_markers(path) if suffix == ".docx" else _empty_markers()
        code = _extract_template_code(path.name)
        has_core_markers = bool(markers["device_name"] and markers["device_model"] and markers["device_code"])
        result.append(
            {
                "name": path.name,
                "path": str(path),
                "suffix": suffix,
                "template_code": code,
                "has_core_markers": has_core_markers,
                "basic_markers": markers,
            }
        )
    return result


def _build_raw_record_index(directories: list[Path]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []

    for directory in directories:
        if not directory.exists() or not directory.is_dir():
            continue
        for path in sorted(directory.glob("*")):
            if not path.is_file():
                continue
            key = str(path.resolve())
            if key in seen:
                continue
            seen.add(key)

            suffix = path.suffix.lower()
            if suffix != ".docx":
                continue

            payload = build_r825b_payload(context={}, source_file_path=path)
            basic_values = {field: _normalize_text(payload.get(field, "")) for field in BASIC_FIELDS}
            coverage = len([value for value in basic_values.values() if value])
            result.append(
                {
                    "name": path.name,
                    "path": str(path),
                    "source_dir": str(directory),
                    "suffix": suffix,
                    "coverage": coverage,
                    "basic_values": basic_values,
                }
            )

    result.sort(key=lambda item: item.get("name", ""))
    return result


def _resolve_raw_record_dirs() -> list[Path]:
    candidates = [
        RAW_RECORD_DIR,
        UPLOAD_DIR,
    ]
    result: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = str(candidate.resolve())
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(candidate)
    return result


def _extract_template_markers(path: Path) -> dict[str, bool]:
    try:
        tables = read_docx_tables(path)
    except Exception:
        return _empty_markers()

    lines: list[str] = []
    for table in tables:
        for row in table:
            row_text = " ".join([_normalize_text(cell) for cell in row if _normalize_text(cell)])
            if row_text:
                lines.append(row_text)
    text_block = "\n".join(lines)

    return {
        "device_name": _contains_any(text_block, ("器具名称", "设备名称", "仪器名称")),
        "manufacturer": _contains_any(text_block, ("制造厂/商", "制造商", "生产厂商", "厂商", "厂家")),
        "device_model": _contains_any(text_block, ("型号/规格", "型号", "规格型号", "型号/编号")),
        "device_code": _contains_any(text_block, ("器具编号", "设备编号", "仪器编号", "编号")),
        "certificate_no": _contains_any(text_block, ("缆专检号", "证书编号", "证书号", "序号")),
        "basis_standard": _contains_any(text_block, ("依据", "检测依据", "校准依据")),
        "location": _contains_any(text_block, ("地点", "检测地点", "校准地点")),
        "temperature": _contains_any(text_block, ("温度",)),
        "humidity": _contains_any(text_block, ("湿度", "RH")),
    }


def _extract_template_code(name: str) -> str:
    match = re.search(r"(?:r[-_ ]?)?(\d{3}(?:\.\d+)?[a-z])", name, flags=re.IGNORECASE)
    if not match:
        return ""
    return f"r-{match.group(1).lower()}"


def _contains_any(text: str, keywords: tuple[str, ...]) -> bool:
    normalized = _normalize_text(text)
    return any(keyword in normalized for keyword in keywords)


def _empty_markers() -> dict[str, bool]:
    return {field: False for field in BASIC_FIELDS}


def _normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u3000", " ")).strip()
