import json
import re

from .docx_cell_utils import normalize_space

_PLACEHOLDER_VALUES = {"", "-", "--", "—", "/", "／"}


def extract_hammer_actual_rows(tables: list[list[list[str]]]) -> list[list[str]]:
    result: list[list[str]] = []
    for rows in tables:
        for row in rows:
            label_idx = -1
            for idx, cell in enumerate(row):
                if "实际值(g)" in normalize_space(cell):
                    label_idx = idx
                    break
            if label_idx < 0:
                continue

            values = [normalize_space(cell) for cell in row[label_idx + 1 :] if normalize_space(cell)]
            if values:
                result.append(values[:10])
    return result[:3]


def extract_hammer_actual_rows_from_text(text: str) -> list[list[str]]:
    if not text:
        return []
    result: list[list[str]] = []
    for line in text.splitlines():
        if "实际值(g)" not in line:
            continue
        values = re.findall(r"\d+(?:\.\d+)?", line)
        if len(values) >= 10:
            result.append(values[-10:])
    return result[:3]


def extract_hammer_actual_rows_from_context(context: dict[str, str]) -> dict[int, list[str]]:
    result: dict[int, list[str]] = {}
    for idx in range(1, 4):
        raw_value = normalize_space(context.get(f"hammer_actual_row_{idx}", ""))
        if not raw_value:
            continue
        values = re.findall(r"\d+(?:\.\d+)?", raw_value)
        if not values:
            continue
        result[idx - 1] = values[:10]
    return result


def merge_hammer_actual_rows(
    source_rows: list[list[str]],
    context_rows: dict[int, list[str]],
) -> list[list[str]]:
    merged = [list(row) for row in source_rows[:3]]
    if len(merged) < 3:
        merged.extend([[] for _ in range(3 - len(merged))])

    for row_idx, values in context_rows.items():
        if row_idx < 0 or row_idx > 2:
            continue
        merged[row_idx] = values
    return merged


def clean_item_name(name: str) -> str:
    value = normalize_space(name)
    value = re.sub(r"^[□■☑▣√]+", "", value)
    return normalize_space(value)


def sanitize_instrument_cell(value: str) -> str:
    text = normalize_space(value)
    if text in _PLACEHOLDER_VALUES:
        return ""
    return text


def normalize_catalog_token(value: str) -> str:
    text = re.sub(r"[\s:：/\\\-_.|*（）()]+", "", str(value or "").lower())
    if text in _PLACEHOLDER_VALUES:
        return ""
    return text


def parse_instrument_catalog_tokens(raw_text: str) -> set[str]:
    tokens: set[str] = set()
    for line in str(raw_text or "").splitlines():
        text = sanitize_instrument_cell(line)
        if not text:
            continue
        token = normalize_catalog_token(text)
        if token:
            tokens.add(token)
    return tokens


def parse_instrument_catalog_rows_json(raw_text: str) -> list[dict[str, str]]:
    text = str(raw_text or "").strip()
    if not text:
        return []
    try:
        payload = json.loads(text)
    except Exception:
        return []
    if not isinstance(payload, list):
        return []

    rows: list[dict[str, str]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        row = {
            "name": sanitize_instrument_cell(item.get("name", "")),
            "model": sanitize_instrument_cell(item.get("model", "")),
            "code": sanitize_instrument_cell(item.get("code", "")),
            "measurement_range": sanitize_instrument_cell(item.get("measurement_range", "")),
            "uncertainty": sanitize_instrument_cell(item.get("uncertainty", "")),
            "certificate_no": sanitize_instrument_cell(item.get("certificate_no", "")),
            "valid_date": sanitize_instrument_cell(item.get("valid_date", "")),
            "traceability_institution": sanitize_instrument_cell(item.get("traceability_institution", "")),
        }
        if not row["name"]:
            continue
        rows.append(row)
    return rows[:2000]


def merge_instrument_rows_with_catalog(
    instrument_rows: list[dict[str, str]],
    catalog_rows: list[dict[str, str]],
) -> list[dict[str, str]]:
    catalog_by_token: dict[str, dict[str, str]] = {}
    for row in catalog_rows:
        token = normalize_catalog_token(row.get("name", ""))
        if token and token not in catalog_by_token:
            catalog_by_token[token] = row

    merged: list[dict[str, str]] = []
    for item in instrument_rows:
        token = normalize_catalog_token(item.get("name", ""))
        catalog = catalog_by_token.get(token) if token else None
        if not catalog:
            merged.append(item)
            continue

        cert_value = sanitize_instrument_cell(catalog.get("certificate_no", ""))
        valid_value = sanitize_instrument_cell(catalog.get("valid_date", ""))
        merged.append(
            {
                "name": sanitize_instrument_cell(catalog.get("name", "")) or sanitize_instrument_cell(item.get("name", "")),
                "model": sanitize_instrument_cell(catalog.get("model", "")) or sanitize_instrument_cell(item.get("model", "")),
                "code": sanitize_instrument_cell(catalog.get("code", "")) or sanitize_instrument_cell(item.get("code", "")),
                "measurement_range": sanitize_instrument_cell(catalog.get("measurement_range", "")) or sanitize_instrument_cell(item.get("measurement_range", "")),
                "uncertainty": sanitize_instrument_cell(catalog.get("uncertainty", "")) or sanitize_instrument_cell(item.get("uncertainty", "")),
                "certificate_no": cert_value or sanitize_instrument_cell(item.get("certificate_no", "")),
                "valid_date": valid_value or sanitize_instrument_cell(item.get("valid_date", "")),
                "traceability_institution": sanitize_instrument_cell(catalog.get("traceability_institution", "")) or sanitize_instrument_cell(item.get("traceability_institution", "")),
            }
        )
    return merged


def pick_cell(row: list[str], index: int) -> str:
    if index < 0 or index >= len(row):
        return ""
    return row[index]


def first_meaningful_value(values: list[str]) -> str:
    for candidate in values:
        candidate_value = normalize_space(candidate)
        if candidate_value and not looks_like_label(candidate_value):
            return candidate_value
    return ""


def looks_like_label(value: str) -> bool:
    normalized_value = normalize_space(value)
    if normalized_value.endswith(":") or normalized_value.endswith("："):
        return True
    if "溯源机构名称" in normalized_value:
        return True
    if normalized_value.lower() in {"client", "manufacturer", "instrument name"}:
        return True
    ascii_compact = re.sub(r"[^a-z]", "", normalized_value.lower())
    if ascii_compact in {
        "client",
        "manufacturer",
        "instrumentname",
        "devicename",
        "equipmentname",
        "instrumentserialnumber",
        "modelspecification",
        "modelnumber",
        "measurementrange",
        "certificateseriesnumber",
        "certificate",
        "number",
        "serialnumber",
        "code",
        "receiveddate",
        "dateforcalibration",
        "year",
        "month",
        "day",
    }:
        return True
    if re.search(r"(?:model|specification|serial|number|manufacturer|measurement|range|traceability|institution)", ascii_compact):
        if not re.search(r"\d", normalized_value):
            return True
    return False
