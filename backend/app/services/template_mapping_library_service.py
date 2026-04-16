import re
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from .template_profile_service import load_template_profiles
from .template_schema import infer_editor_schema
from .template_bundle import BundleError, resolve_output_bundle

RULES_FILE = Path(__file__).resolve().parents[1] / "rules" / "template_mapping_library.yaml"


@lru_cache(maxsize=1)
def load_template_mapping_library() -> dict[str, Any]:
    if not RULES_FILE.exists():
        data = {}
    else:
        with RULES_FILE.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    templates = data.get("templates", {})
    if not isinstance(templates, dict):
        templates = {}
    generated_profiles = load_template_profiles()
    merged = {**generated_profiles, **templates}
    return {"templates": merged}


def resolve_handler_key(template_name: str) -> str | None:
    config = _find_profile_by_template_name(template_name)
    if not config:
        return None
    handler_key = _normalize_handler_key(config.get("handler_key", ""))
    if not handler_key:
        return None
    return handler_key


def get_editor_schema(template_name: str) -> dict[str, Any] | None:
    bundle_schema = _load_bundle_editor_schema(template_name)
    if bundle_schema:
        return bundle_schema
    config = _find_profile_by_template_name(template_name)
    if config:
        schema = _normalize_editor_schema(config.get("editor"))
        if schema:
            return schema
    return infer_editor_schema(template_name)


def get_fill_placeholders(template_name: str) -> list[dict[str, Any]]:
    config = _find_profile_by_template_name(template_name)
    if not config:
        return []
    fill = config.get("fill")
    if not isinstance(fill, dict):
        return []
    raw_placeholders = fill.get("placeholders")
    if not isinstance(raw_placeholders, list):
        return []
    result: list[dict[str, Any]] = []
    for item in raw_placeholders:
        if not isinstance(item, dict):
            continue
        marker = str(item.get("marker", "")).strip()
        key = str(item.get("key", "")).strip()
        if not marker or not key:
            continue
        fallback_keys = [
            str(x).strip()
            for x in (item.get("fallback_keys") or [])
            if str(x).strip()
        ] if isinstance(item.get("fallback_keys"), list) else []
        result.append(
            {
                "marker": marker,
                "key": key,
                "fallback_keys": fallback_keys,
                "default": str(item.get("default", "")).strip(),
            }
        )
    return result


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
        keywords_all = config.get("source_keywords", []) or []
        normalized_keywords_all = [_normalize_for_match(keyword) for keyword in keywords_all if _normalize_for_match(keyword)]
        if normalized_keywords_all and all(keyword in normalized_source for keyword in normalized_keywords_all):
            return code

        keywords_any = config.get("source_keywords_any", []) or []
        normalized_keywords_any = [_normalize_for_match(keyword) for keyword in keywords_any if _normalize_for_match(keyword)]
        if normalized_keywords_any and any(keyword in normalized_source for keyword in normalized_keywords_any):
            return code
    return None


def match_mapping_code_by_source_alias(normalized_source: str) -> str | None:
    for code, config in _iter_profiles():
        aliases = config.get("source_aliases", []) or []
        normalized_aliases = [_normalize_for_match(alias) for alias in aliases if _normalize_for_match(alias)]
        if normalized_aliases and any(alias in normalized_source for alias in normalized_aliases):
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
                "options": [
                    str(option).strip()
                    for option in (raw_field.get("options") or [])
                    if str(option).strip()
                ] if isinstance(raw_field.get("options"), list) else [],
            }
        )

    if not fields:
        return None

    note = str(editor.get("note", "")).strip()
    return {
        "note": note,
        "fields": fields,
    }


def _load_bundle_editor_schema(template_name: str) -> dict[str, Any] | None:
    text = str(template_name or "").strip()
    if not text.lower().startswith("bundle:"):
        return None
    bundle_id = text.split(":", 1)[1].strip()
    if not bundle_id:
        return None
    try:
        bundle = resolve_output_bundle(bundle_id)
    except BundleError:
        return None
    entries = bundle.get("entries") if isinstance(bundle.get("entries"), dict) else {}
    schema_path = Path(str((entries or {}).get("editor_schema") or "").strip())
    if not schema_path.exists() or not schema_path.is_file():
        return None
    try:
        loaded = json.loads(schema_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return _normalize_editor_schema(loaded)


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
