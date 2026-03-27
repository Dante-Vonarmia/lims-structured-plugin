import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

RULES_FILE = Path(__file__).resolve().parents[1] / "rules" / "template_mapping_library.yaml"


@lru_cache(maxsize=1)
def load_template_mapping_library() -> dict[str, Any]:
    if not RULES_FILE.exists():
        return {"templates": {}}
    with RULES_FILE.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    templates = data.get("templates", {})
    if not isinstance(templates, dict):
        templates = {}
    return {"templates": templates}


def resolve_handler_key(template_name: str) -> str | None:
    config = _find_profile_by_template_name(template_name)
    if not config:
        return None
    handler_key = _normalize_handler_key(config.get("handler_key", ""))
    if not handler_key:
        return None
    return handler_key


def get_editor_schema(template_name: str) -> dict[str, Any] | None:
    config = _find_profile_by_template_name(template_name)
    if not config:
        return None
    return _normalize_editor_schema(config.get("editor"))


def get_editor_schemas(template_names: list[str]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for template_name in template_names:
        schema = get_editor_schema(template_name)
        if schema:
            result[template_name] = schema
    return result


def _find_profile_by_template_name(template_name: str) -> dict[str, Any] | None:
    normalized_template_name = _normalize_for_match(template_name)
    if not normalized_template_name:
        return None
    for code, config in _iter_profiles():
        if _template_matches_profile(normalized_template_name, code, config):
            return config
    return None


def match_mapping_code_by_keywords(normalized_source: str) -> str | None:
    for code, config in _iter_profiles():
        keywords = config.get("source_keywords", []) or []
        normalized_keywords = [_normalize_for_match(keyword) for keyword in keywords]
        if normalized_keywords and all(keyword in normalized_source for keyword in normalized_keywords):
            return code
    return None


def _iter_profiles() -> list[tuple[str, dict[str, Any]]]:
    templates = load_template_mapping_library().get("templates", {})
    result: list[tuple[str, dict[str, Any]]] = []
    for code, config in templates.items():
        if not isinstance(code, str) or not isinstance(config, dict):
            continue
        normalized_code = _normalize_template_code(code)
        if not normalized_code:
            continue
        result.append((normalized_code, config))
    return result


def _template_matches_profile(
    normalized_template_name: str,
    code: str,
    config: dict[str, Any],
) -> bool:
    aliases = config.get("template_aliases", []) or []
    normalized_aliases = [_normalize_for_match(alias) for alias in aliases if isinstance(alias, str)]
    if any(alias and alias in normalized_template_name for alias in normalized_aliases):
        return True
    if code and code in normalized_template_name:
        return True
    return False


def _normalize_editor_schema(editor: Any) -> dict[str, Any] | None:
    if not isinstance(editor, dict):
        return None
    raw_fields = editor.get("fields", [])
    if not isinstance(raw_fields, list):
        return None

    fields: list[dict[str, Any]] = []
    for raw_field in raw_fields:
        if not isinstance(raw_field, dict):
            continue
        key = str(raw_field.get("key", "")).strip()
        label = str(raw_field.get("label", "")).strip()
        if not key or not label:
            continue
        fields.append(
            {
                "key": key,
                "label": label,
                "wide": bool(raw_field.get("wide", False)),
            }
        )

    if not fields:
        return None

    note = str(editor.get("note", "")).strip()
    return {
        "note": note,
        "fields": fields,
    }


def _normalize_handler_key(value: str) -> str:
    return _normalize_for_match(value).replace("-", "").replace("_", "")


def _normalize_template_code(code: str) -> str:
    normalized = _normalize_for_match(code)
    match = re.search(r"r[-_ ]?(\d{3}[a-z])", normalized, flags=re.IGNORECASE)
    if not match:
        return ""
    return f"r-{match.group(1).lower()}"


def _normalize_for_match(value: str) -> str:
    return re.sub(r"\s+", "", value or "").lower()
