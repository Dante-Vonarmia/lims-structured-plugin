import re
from datetime import datetime, timedelta

from .docx_basis_utils import extract_standard_codes
from .docx_cell_utils import normalize_space, split_date_parts
from .docx_instrument_text_utils import looks_like_label


def tables_to_text_block(tables: list[list[list[str]]]) -> str:
    lines: list[str] = []
    for table in tables:
        for row in table:
            text = " | ".join([cell for cell in row if cell])
            if text:
                lines.append(text)
    return "\n".join(lines)


def sanitize_context_value(value: str) -> str:
    normalized = normalize_space(value)
    if not normalized:
        return ""
    if looks_like_label(normalized):
        return ""
    return normalized


def sanitize_context_date(value: str) -> str:
    normalized = normalize_space(value)
    if not normalized:
        return ""
    parts = split_date_parts(normalized)
    if not parts:
        return ""
    year, month, day = parts
    return f"{year}年{month}月{day}日"


def add_days(date_text: str, days: int) -> str:
    parts = split_date_parts(date_text)
    if not parts:
        return ""
    year, month, day = parts
    try:
        dt = datetime(int(year), int(month), int(day))
    except ValueError:
        return ""
    target = dt + timedelta(days=days)
    return f"{target.year:04d}年{target.month:02d}月{target.day:02d}日"


def resolve_report_dates(
    receive_date: str,
    calibration_date: str,
    publish_date: str,
) -> tuple[str, str, str]:
    receive = sanitize_context_date(receive_date)
    calibration = sanitize_context_date(calibration_date)
    publish = sanitize_context_date(publish_date)

    base_date = calibration or receive
    if not base_date:
        return receive, calibration, publish

    receive = base_date
    calibration = base_date
    next_day = add_days(base_date, 1)
    publish = next_day or publish
    return receive, calibration, publish


def split_model_code_combined(value: str) -> tuple[str, str]:
    text = normalize_space(value)
    if not text:
        return "", ""
    parts = [normalize_space(part) for part in re.split(r"[:：/|]", text) if normalize_space(part)]
    if len(parts) >= 2:
        left = sanitize_context_value(parts[0])
        right = sanitize_context_value(parts[1])
        if left and right:
            return left, right
    return sanitize_context_value(text), ""


def extract_basis_from_cell(text: str) -> str:
    match = re.search(r"依据[:：]\s*(.*)$", normalize_space(text))
    if not match:
        return ""
    basis_text = normalize_space(match.group(1))
    basis_codes = extract_standard_codes(basis_text)
    if basis_codes:
        return "、".join(basis_codes)
    return basis_text
