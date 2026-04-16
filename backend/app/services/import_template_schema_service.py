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


def _normalize_explicit_key(text: Any) -> str:
    key = re.sub(r"[^a-zA-Z0-9_]+", "_", str(text or "")).strip("_").lower()
    return key


def _normalize_info_fields(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    result: list[dict[str, str]] = []
    for item in raw:
        if isinstance(item, str):
            key = _normalize_explicit_key(item)
            if key:
                result.append({"key": key, "label": str(item).strip() or key})
            continue
        if not isinstance(item, dict):
            continue
        key = _normalize_explicit_key(item.get("key", ""))
        label = _normalize_label(item.get("label", ""))
        if not key:
            continue
        result.append({"key": key, "label": label or key})
    return result


def _merge_choices_into_rule(rule: dict[str, Any], values: list[dict[str, str]]) -> None:
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


def _extract_rule_from_field_entry(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    rule = dict(raw)
    rule.pop("label", None)
    rule.pop("index", None)
    rule.pop("group", None)
    return rule


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
    value_library = _load_steel_cylinder_value_library()
    if not value_library:
        return merged
    field_rules = merged.get("field_rules")
    if not isinstance(field_rules, dict):
        field_rules = {}
    for label, values in value_library.items():
        rule = field_rules.get(label)
        if not isinstance(rule, dict):
            continue
        _merge_choices_into_rule(rule, values)

    fields = merged.get("fields")
    if isinstance(fields, dict):
        normalized_library = {k.lower(): v for k, v in value_library.items()}
        for raw_key, entry in fields.items():
            key = _normalize_explicit_key(raw_key)
            if not key or not isinstance(entry, dict):
                continue
            label = _normalize_label(entry.get("label", "")).lower()
            if not label:
                continue
            values = normalized_library.get(label)
            if not values:
                continue
            _merge_choices_into_rule(entry, values)
            fields[key] = entry

    field_meta_by_key = merged.get("field_meta_by_key")
    field_rules_by_key = merged.get("field_rules_by_key")
    if isinstance(field_meta_by_key, dict) and isinstance(field_rules_by_key, dict):
        normalized_library = {k.lower(): v for k, v in value_library.items()}
        for raw_key, meta in field_meta_by_key.items():
            if not isinstance(meta, dict):
                continue
            key = _normalize_explicit_key(raw_key)
            label = _normalize_label(meta.get("label", "")).lower()
            if not key or not label:
                continue
            values = normalized_library.get(label)
            if not values:
                continue
            rule = field_rules_by_key.get(key)
            if not isinstance(rule, dict):
                continue
            _merge_choices_into_rule(rule, values)

    merged["field_rules"] = field_rules
    if isinstance(fields, dict):
        merged["fields"] = fields
    if isinstance(field_rules_by_key, dict):
        merged["field_rules_by_key"] = field_rules_by_key
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

    companion_rules = _load_companion_rules(csv_path)
    explicit_meta_by_index: dict[int, dict[str, Any]] = {}
    unified_fields = companion_rules.get("fields")
    if isinstance(unified_fields, dict):
        for raw_key, raw_field in unified_fields.items():
            key = _normalize_explicit_key(raw_key)
            if not key or not isinstance(raw_field, dict):
                continue
            index = int(raw_field.get("index", -1) or -1)
            if index < 0:
                continue
            explicit_meta_by_index[index] = {
                "key": key,
                "label": _normalize_label(raw_field.get("label", "")),
            }
    if not explicit_meta_by_index:
        raw_field_meta = companion_rules.get("field_meta_by_key")
        if isinstance(raw_field_meta, dict):
            for raw_key, raw_meta in raw_field_meta.items():
                key = _normalize_explicit_key(raw_key)
                if not key or not isinstance(raw_meta, dict):
                    continue
                index = int(raw_meta.get("index", -1) or -1)
                if index < 0:
                    continue
                explicit_meta_by_index[index] = {
                    "key": key,
                    "label": _normalize_label(raw_meta.get("label", "")),
                }

    explicit_field_keys: list[str] = []
    raw_field_keys = companion_rules.get("field_keys")
    if isinstance(raw_field_keys, list):
        explicit_field_keys = [_normalize_explicit_key(item) for item in raw_field_keys]

    used_keys: set[str] = set()
    columns: list[dict[str, Any]] = []
    for i in range(width):
        csv_label = _normalize_label(field_row[i])
        if not csv_label:
            continue
        csv_group = _resolve_group_name(i)

        explicit_meta = explicit_meta_by_index.get(i) if explicit_meta_by_index else None
        label = _normalize_label((explicit_meta or {}).get("label", "")) or csv_label
        group = csv_group
        explicit_key = ""
        if explicit_meta and explicit_meta.get("key"):
            explicit_key = _normalize_explicit_key(explicit_meta.get("key", ""))
        elif i < len(explicit_field_keys):
            explicit_key = explicit_field_keys[i]
        if explicit_key:
            key = explicit_key
            seq = 2
            while key in used_keys:
                key = f"{explicit_key}_{seq}"
                seq += 1
            used_keys.add(key)
        else:
            key = _to_key(label, i, used_keys)
        columns.append({
            "index": i,
            "key": key,
            "label": label,
            "group": group,
        })

    legacy_field_rules = companion_rules.get("field_rules")
    field_rules_by_key: dict[str, Any] = {}
    if isinstance(unified_fields, dict):
        for raw_key, raw_field in unified_fields.items():
            key = _normalize_explicit_key(raw_key)
            if key:
                rule = _extract_rule_from_field_entry(raw_field)
                if rule:
                    field_rules_by_key[key] = rule
    raw_field_rules_by_key = companion_rules.get("field_rules_by_key")
    if isinstance(raw_field_rules_by_key, dict):
        for raw_key, raw_rule in raw_field_rules_by_key.items():
            key = _normalize_explicit_key(raw_key)
            if key and isinstance(raw_rule, dict):
                field_rules_by_key[key] = dict(raw_rule)

    for col in columns:
        key = str(col.get("key", "")).strip()
        label = str(col.get("label", "")).strip()
        if not key or key in field_rules_by_key:
            continue
        if isinstance(legacy_field_rules, dict):
            rule_by_key = legacy_field_rules.get(key)
            if isinstance(rule_by_key, dict):
                field_rules_by_key[key] = dict(rule_by_key)
                continue
            rule_by_label = legacy_field_rules.get(label)
            if isinstance(rule_by_label, dict):
                field_rules_by_key[key] = dict(rule_by_label)

    normalized_rules = dict(companion_rules) if isinstance(companion_rules, dict) else {}
    normalized_rules["info_fields"] = _normalize_info_fields(normalized_rules.get("info_fields"))
    normalized_fields: dict[str, dict[str, Any]] = {}
    for col in columns:
        key = str(col.get("key", "")).strip()
        if not key:
            continue
        entry: dict[str, Any] = {
            "label": str(col.get("label", "")).strip(),
            "index": int(col.get("index", 0) or 0),
        }
        rule = field_rules_by_key.get(key)
        if isinstance(rule, dict):
            entry.update(rule)
        normalized_fields[key] = entry
    normalized_rules["fields"] = normalized_fields
    normalized_rules.pop("field_meta_by_key", None)
    normalized_rules.pop("field_rules_by_key", None)
    normalized_rules.pop("field_keys", None)

    groups_map: dict[str, list[dict[str, Any]]] = {}
    for col in columns:
        name = str(col["group"])
        groups_map.setdefault(name, []).append(col)

    groups = [{"name": name, "columns": cols} for name, cols in groups_map.items()]
    return {
        "template_name": csv_path.name,
        "columns": columns,
        "groups": groups,
        "rules": normalized_rules,
    }
