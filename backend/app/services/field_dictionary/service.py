from typing import Any
import re

from .aliases import apply_aliases
from .formulas import apply_formulas
from .rules import load_field_dictionary_rules


def apply_field_dictionary(
    context: dict[str, Any] | None,
    template_name: str = "",
) -> dict[str, Any]:
    normalized = dict(context or {})
    rules = load_field_dictionary_rules()
    normalized = apply_aliases(normalized, rules.get("aliases", {}))
    normalized = apply_formulas(normalized, rules.get("formulas", []))
    profile_formulas = _resolve_profile_formulas(
        template_name=template_name,
        profiles=rules.get("formula_profiles", []),
    )
    if profile_formulas:
        normalized = apply_formulas(normalized, profile_formulas)
    return normalized


def _resolve_profile_formulas(template_name: str, profiles: list[Any]) -> list[Any]:
    name = str(template_name or "").strip()
    if not name or not isinstance(profiles, list):
        return []
    result: list[Any] = []
    for profile in profiles:
        if not isinstance(profile, dict):
            continue
        pattern = str(profile.get("template_pattern", "") or "").strip()
        formulas = profile.get("formulas", [])
        if not pattern or not isinstance(formulas, list):
            continue
        try:
            matched = re.search(pattern, name, flags=re.IGNORECASE)
        except re.error:
            matched = False
        if matched:
            result.extend(formulas)
    return result
