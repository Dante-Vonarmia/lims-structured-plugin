from typing import Any

from .aliases import apply_aliases
from .formulas import apply_formulas
from .rules import load_field_dictionary_rules


def apply_field_dictionary(context: dict[str, Any] | None) -> dict[str, Any]:
    normalized = dict(context or {})
    rules = load_field_dictionary_rules()
    normalized = apply_aliases(normalized, rules.get("aliases", {}))
    normalized = apply_formulas(normalized, rules.get("formulas", []))
    return normalized
