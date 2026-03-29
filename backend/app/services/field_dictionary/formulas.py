from typing import Any
import re

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
        if formula_type == "linearity_metrics":
            normalized = _apply_linearity_metrics(normalized, raw_formula)
            continue
        if formula_type == "list_mean":
            normalized = _apply_list_mean(normalized, raw_formula)
            continue
        if formula_type == "list_stddev":
            normalized = _apply_list_stddev(normalized, raw_formula)
            continue
        if formula_type == "list_subtract":
            normalized = _apply_list_subtract(normalized, raw_formula)
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


def _apply_linearity_metrics(context: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(context or {})
    ux_key = str(config.get("ux_key", "linearity_ux_values") or "linearity_ux_values")
    u2_key = str(config.get("u2_key", "linearity_u2_values") or "linearity_u2_values")
    fi_key = str(config.get("fi_key", "linearity_fi_values") or "linearity_fi_values")
    f_avg_key = str(config.get("f_avg_key", "linearity_f_avg") or "linearity_f_avg")
    delta_key = str(config.get("delta_key", "linearity_fi_delta_percent") or "linearity_fi_delta_percent")
    precision = int(config.get("precision", 6) or 6)
    delta_precision = int(config.get("delta_precision", 4) or 4)

    ux_values = _parse_number_list(str(normalized.get(ux_key, "") or ""))
    u2_values = _parse_number_list(str(normalized.get(u2_key, "") or ""))
    if not ux_values or not u2_values:
        return normalized

    length = min(len(ux_values), len(u2_values))
    fi_values: list[float] = []
    for idx in range(length):
        u2 = u2_values[idx]
        if abs(u2) < 1e-12:
            continue
        fi_values.append(ux_values[idx] / u2)
    if not fi_values:
        return normalized

    f_avg = sum(fi_values) / len(fi_values)
    if abs(f_avg) < 1e-12:
        delta_values = [0.0 for _ in fi_values]
    else:
        delta_values = [((fi - f_avg) / f_avg) * 100.0 for fi in fi_values]

    if not str(normalized.get(fi_key, "") or "").strip():
        normalized[fi_key] = _join_float_list(fi_values, precision)
    if not str(normalized.get(f_avg_key, "") or "").strip():
        normalized[f_avg_key] = _format_float(f_avg, precision)
    if not str(normalized.get(delta_key, "") or "").strip():
        normalized[delta_key] = _join_float_list(delta_values, delta_precision)
    return normalized


def _apply_list_mean(context: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(context or {})
    source_key = str(config.get("source_key", "") or "")
    target_key = str(config.get("target_key", "") or "")
    precision = int(config.get("precision", 6) or 6)
    if not source_key or not target_key:
        return normalized
    values = _parse_number_list(str(normalized.get(source_key, "") or ""))
    if not values:
        return normalized
    if str(normalized.get(target_key, "") or "").strip():
        return normalized
    avg = sum(values) / len(values)
    normalized[target_key] = _format_float(avg, precision)
    return normalized


def _apply_list_stddev(context: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(context or {})
    source_key = str(config.get("source_key", "") or "")
    target_key = str(config.get("target_key", "") or "")
    precision = int(config.get("precision", 6) or 6)
    if not source_key or not target_key:
        return normalized
    values = _parse_number_list(str(normalized.get(source_key, "") or ""))
    if not values:
        return normalized
    if str(normalized.get(target_key, "") or "").strip():
        return normalized
    if len(values) <= 1:
        normalized[target_key] = _format_float(0.0, precision)
        return normalized
    mean = sum(values) / len(values)
    variance = sum((x - mean) ** 2 for x in values) / len(values)
    normalized[target_key] = _format_float(variance ** 0.5, precision)
    return normalized


def _apply_list_subtract(context: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(context or {})
    left_key = str(config.get("left_key", "") or "")
    right_key = str(config.get("right_key", "") or "")
    target_key = str(config.get("target_key", "") or "")
    precision = int(config.get("precision", 4) or 4)
    if not left_key or not right_key or not target_key:
        return normalized
    if str(normalized.get(target_key, "") or "").strip():
        return normalized
    left = _parse_number_list(str(normalized.get(left_key, "") or ""))
    right = _parse_number_list(str(normalized.get(right_key, "") or ""))
    if not left or not right:
        return normalized
    length = min(len(left), len(right))
    if length <= 0:
        return normalized
    diff = [left[i] - right[i] for i in range(length)]
    normalized[target_key] = _join_float_list(diff, precision)
    return normalized


def _parse_number_list(text: str) -> list[float]:
    raw = str(text or "").strip()
    if not raw:
        return []
    parts = [x for x in re.split(r"[\s,，;；\t\r\n]+", raw) if x]
    result: list[float] = []
    for part in parts:
        try:
            result.append(float(part))
        except ValueError:
            continue
    return result


def _format_float(value: float, precision: int) -> str:
    text = f"{value:.{max(0, precision)}f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def _join_float_list(values: list[float], precision: int) -> str:
    return " ".join(_format_float(v, precision) for v in values)
