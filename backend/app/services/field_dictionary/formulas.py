from typing import Any

from .dates import add_days, normalize_date_text


def apply_formulas(context: dict[str, Any], formulas: list[Any]) -> dict[str, Any]:
    normalized = dict(context or {})
    for raw_formula in formulas:
        if not isinstance(raw_formula, dict):
            continue
        formula_type = str(raw_formula.get("type", "") or "").strip()
        if formula_type == "unify_dates":
            normalized = _apply_unify_dates(normalized, raw_formula)
            continue
        if formula_type == "date_offset":
            normalized = _apply_date_offset(normalized, raw_formula)
            continue
    return normalized


def _apply_unify_dates(context: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(context or {})
    receive_key = str(config.get("receive_key", "receive_date") or "receive_date")
    calibration_key = str(config.get("calibration_key", "calibration_date") or "calibration_date")
    receive_date = normalize_date_text(str(normalized.get(receive_key, "") or ""))
    calibration_date = normalize_date_text(str(normalized.get(calibration_key, "") or ""))
    base_date = calibration_date or receive_date
    if not base_date:
        return normalized
    normalized[receive_key] = base_date
    normalized[calibration_key] = base_date
    return normalized


def _apply_date_offset(context: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(context or {})
    source_key = str(config.get("source_key", "") or "")
    fallback_key = str(config.get("fallback_key", "") or "")
    target_key = str(config.get("target_key", "") or "")
    days = int(config.get("days", 0) or 0)
    if not source_key or not target_key:
        return normalized

    source_date = str(normalized.get(source_key, "") or "").strip()
    if not source_date and fallback_key:
        source_date = str(normalized.get(fallback_key, "") or "").strip()
    shifted = add_days(source_date, days)
    if not shifted:
        return normalized
    normalized[target_key] = shifted
    return normalized
