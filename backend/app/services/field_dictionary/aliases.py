from typing import Any


def apply_aliases(context: dict[str, Any], aliases: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(context or {})
    for canonical_key, alias_list in aliases.items():
        canonical = str(canonical_key or "").strip()
        if not canonical:
            continue
        current = str(normalized.get(canonical, "") or "").strip()
        if current:
            continue
        if not isinstance(alias_list, list):
            continue
        for alias in alias_list:
            alias_key = str(alias or "").strip()
            if not alias_key:
                continue
            candidate = str(normalized.get(alias_key, "") or "").strip()
            if not candidate:
                continue
            normalized[canonical] = candidate
            break
    return normalized
