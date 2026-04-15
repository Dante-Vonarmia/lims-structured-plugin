import csv
import io
import json
import re
from pathlib import Path
from typing import Any

from ..config import TEMPLATE_BUNDLE_ROOT, TEMPLATE_DIR

_STEEL_CYLINDER_VALUE_LIBRARY_FILE = Path(__file__).resolve().parents[1] / "rules" / "steel_cylinder_value_library.json"


def _safe_read_text(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return path.read_text(encoding=encoding)
        except Exception:
            continue
    return ""


def _normalize_label(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip())


def _to_key(label: str, index: int, used: set[str]) -> str:
    base = re.sub(r"[^a-zA-Z0-9]+", "_", label).strip("_").lower()
    if not base:
        base = f"col_{index + 1:02d}"
    key = base
    seq = 2
    while key in used:
        key = f"{base}_{seq}"
        seq += 1
    used.add(key)
    return key


def _resolve_template_csv_path(raw_path: str) -> Path | None:
    text = str(raw_path or "").strip()
    if not text:
        return None
    path = Path(text)
    normalized_name = path.name
    normalized_parts = [part for part in path.parts if part not in ("", "/", "\\")]
    trailing_parts: list[str] = []
    if "template-bundles" in normalized_parts:
      idx = normalized_parts.index("template-bundles")
      trailing_parts = normalized_parts[idx + 1:]
    elif "input" in normalized_parts:
      idx = normalized_parts.index("input")
      trailing_parts = normalized_parts[idx:]
    candidates: list[Path] = []
    if path.is_absolute():
        if path.exists():
            candidates.append(path)
        else:
            # Stored host absolute paths are invalid in container runtime.
            candidates.append(TEMPLATE_DIR / normalized_name)
            if trailing_parts:
                candidates.append(TEMPLATE_BUNDLE_ROOT.joinpath(*trailing_parts))
            candidates.append(TEMPLATE_BUNDLE_ROOT / "input" / normalized_name)
    else:
        candidates.append(TEMPLATE_DIR / normalized_name)
        candidates.append(TEMPLATE_BUNDLE_ROOT / path)
        candidates.append(TEMPLATE_BUNDLE_ROOT / "input" / path)
        candidates.append(TEMPLATE_BUNDLE_ROOT / "input" / normalized_name)

    allowed_roots: list[Path] = []
    for root in (TEMPLATE_DIR, TEMPLATE_BUNDLE_ROOT):
        try:
            allowed_roots.append(root.resolve())
        except Exception:
            continue

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except Exception:
            continue
        if not resolved.exists() or resolved.suffix.lower() != ".csv":
            continue
        if not any((resolved == root or root in resolved.parents) for root in allowed_roots):
            continue
        return resolved
    return None


def _load_companion_rules(csv_path: Path) -> dict[str, Any]:
    candidates = [
        csv_path.with_suffix(".rules.json"),
        csv_path.parent / "rules.json",
    ]
    for rules_path in candidates:
        if not rules_path.exists():
            continue
        text = _safe_read_text(rules_path)
        if not text.strip():
            continue
        try:
            loaded = json.loads(text)
        except Exception:
            continue
        if isinstance(loaded, dict):
            return _merge_value_library_into_rules(loaded)
    return {}


def _load_steel_cylinder_value_library() -> dict[str, list[dict[str, str]]]:
    if not _STEEL_CYLINDER_VALUE_LIBRARY_FILE.exists():
        return {}
    text = _safe_read_text(_STEEL_CYLINDER_VALUE_LIBRARY_FILE)
    if not text.strip():
        return {}
    try:
        payload = json.loads(text)
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    fields = payload.get("fields")
    if not isinstance(fields, dict):
        return {}
    result: dict[str, list[dict[str, str]]] = {}
    for label, options in fields.items():
        name = _normalize_label(str(label or ""))
        if not name or not isinstance(options, list):
            continue
        cleaned: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in options:
            if isinstance(item, dict):
                value = _normalize_label(str(item.get("label", "") or ""))
            else:
                value = _normalize_label(str(item or ""))
            if not value:
                continue
            key = value.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append({"label": value})
        if cleaned:
            result[name] = cleaned
    return result


def _merge_value_library_into_rules(rules: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(rules, dict):
        return {}
    merged = dict(rules)
    field_rules = merged.get("field_rules")
    if not isinstance(field_rules, dict):
        return merged
    value_library = _load_steel_cylinder_value_library()
    if not value_library:
        return merged
    for label, values in value_library.items():
        rule = field_rules.get(label)
        if not isinstance(rule, dict):
            continue
        existing = rule.get("choices")
        existing_labels: set[str] = set()
        merged_choices: list[dict[str, str]] = []
        if isinstance(existing, list):
            for item in existing:
                if not isinstance(item, dict):
                    continue
                text = _normalize_label(str(item.get("label", "") or ""))
                if not text:
                    continue
                key = text.lower()
                if key in existing_labels:
                    continue
                existing_labels.add(key)
                merged_choices.append({"label": text})
        for item in values:
            text = _normalize_label(str((item or {}).get("label", "") or ""))
            if not text:
                continue
            key = text.lower()
            if key in existing_labels:
                continue
            existing_labels.add(key)
            merged_choices.append({"label": text})
        if merged_choices:
            rule["choices"] = merged_choices
            rule["options_source"] = "steel_cylinder_value_library"
            rule["options_edit_hint"] = str(_STEEL_CYLINDER_VALUE_LIBRARY_FILE)
    merged["field_rules"] = field_rules
    return merged


def load_import_template_schema(import_template_path: str) -> dict[str, Any]:
    csv_path = _resolve_template_csv_path(import_template_path)
    if not csv_path:
        return {"template_name": "", "columns": [], "groups": [], "rules": {}}

    text = _safe_read_text(csv_path)
    if not text.strip():
        return {"template_name": csv_path.name, "columns": [], "groups": [], "rules": _load_companion_rules(csv_path)}

    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if len(rows) < 2:
        return {"template_name": csv_path.name, "columns": [], "groups": [], "rules": _load_companion_rules(csv_path)}

    group_row = rows[0]
    field_row = rows[1]
    width = max(len(group_row), len(field_row))
    group_row = group_row + [""] * (width - len(group_row))
    field_row = field_row + [""] * (width - len(field_row))

    def _resolve_group_name(index: int) -> str:
        current = _normalize_label(group_row[index]) if 0 <= index < len(group_row) else ""
        if current:
            return current
        for pos in range(index - 1, -1, -1):
            left = _normalize_label(group_row[pos])
            if left:
                return left
        # Left-side inheritance not available (leading blank): fallback to right.
        for pos in range(index + 1, len(group_row)):
            right = _normalize_label(group_row[pos])
            if right:
                return right
        return "基础信息"

    used_keys: set[str] = set()
    columns: list[dict[str, Any]] = []
    for i in range(width):
        label = _normalize_label(field_row[i])
        if not label:
            continue
        group = _resolve_group_name(i)
        key = _to_key(label, i, used_keys)
        columns.append({
            "index": i,
            "key": key,
            "label": label,
            "group": group,
        })

    groups_map: dict[str, list[dict[str, Any]]] = {}
    for col in columns:
        name = str(col["group"])
        groups_map.setdefault(name, []).append(col)

    groups = [{"name": name, "columns": cols} for name, cols in groups_map.items()]
    return {
        "template_name": csv_path.name,
        "columns": columns,
        "groups": groups,
        "rules": _load_companion_rules(csv_path),
    }
