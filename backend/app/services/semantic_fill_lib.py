import re
from typing import Callable


def normalize_multiline_text_preserve_tabs(value: str, normalize_space: Callable[[str], str]) -> str:
    if not value:
        return ""
    lines: list[str] = []
    for line in str(value).splitlines():
        raw = str(line or "").replace("\u00a0", " ")
        if "\t" in raw:
            cells = [normalize_space(cell) for cell in raw.split("\t")]
            if any(cells):
                lines.append("\t".join(cells))
            continue
        normalized_line = normalize_space(raw)
        if normalized_line:
            lines.append(normalized_line)
    return "\n".join(lines)


def detect_semantic_key_value_columns(row: list[str]) -> tuple[int, int]:
    key_col_idx = -1
    rate_col_idx = -1
    standard_col_idx = -1
    value_col_idx = -1
    for idx, cell in enumerate(row):
        compact = re.sub(r"\s+", "", str(cell or ""))
        if rate_col_idx < 0 and re.search(r"倍率|量程|点位|档位", compact):
            rate_col_idx = idx
        if standard_col_idx < 0 and re.search(r"标准值|标称值|设定值", compact):
            standard_col_idx = idx
        if value_col_idx < 0 and re.search(r"实际值|实测值|示值|读数|测量值", compact):
            value_col_idx = idx
    if standard_col_idx >= 0:
        key_col_idx = standard_col_idx
    elif rate_col_idx >= 0:
        key_col_idx = rate_col_idx
    if value_col_idx >= 0 and key_col_idx < 0:
        key_col_idx = max(0, value_col_idx - 1)
    if key_col_idx == value_col_idx:
        return -1, -1
    return key_col_idx, value_col_idx


def normalize_semantic_key(text: str, normalize_space: Callable[[str], str]) -> str:
    value = normalize_space(text).replace(",", "")
    value = re.sub(r"[Ωω]$", "", value).strip()
    if not value:
        return ""
    sci = re.match(r"^[x×]\s*10\s*(?:\^)?\s*([+-]?\d+)$", value, flags=re.IGNORECASE)
    if sci:
        return f"x10^{sci.group(1)}"
    sci_compact = re.match(r"^[x×]\s*10([+-]?\d+)$", value, flags=re.IGNORECASE)
    if sci_compact:
        return f"x10^{sci_compact.group(1)}"
    if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", value):
        integer, dot, frac = value.partition(".")
        if dot:
            frac = frac.rstrip("0")
            if frac:
                return f"{integer}.{frac}"
            return integer
        return value
    return value.lower()


def is_semantic_section_stop_row(row: list[str], normalize_space: Callable[[str], str]) -> bool:
    text = normalize_space(" ".join([str(x or "") for x in row]))
    if not text:
        return False
    return bool(re.search(r"注[:：]?|以下空白|不确定度评定|检测员|校准员|核验员|结果[:：]?$", text))


def build_semantic_value_maps_from_general_check_text(text: str, normalize_space: Callable[[str], str]) -> list[dict[str, str]]:
    lines = [str(x or "") for x in str(text or "").splitlines()]
    if not lines:
        return []
    table_rows: list[list[str]] = []
    for line in lines:
        if "\t" not in line:
            continue
        row = [normalize_space(cell) for cell in line.split("\t")]
        table_rows.append(row)
    if len(table_rows) < 2:
        return []

    maps: list[dict[str, str]] = []
    for start_idx, row in enumerate(table_rows):
        key_col_idx, value_col_idx = detect_semantic_key_value_columns(row)
        if key_col_idx < 0 or value_col_idx < 0:
            continue
        value_map: dict[str, str] = {}
        key_col_carry = ""
        for next_idx in range(start_idx + 1, len(table_rows)):
            data_row = table_rows[next_idx]
            if key_col_idx >= len(data_row) or value_col_idx >= len(data_row):
                continue
            key_text = normalize_space(data_row[key_col_idx])
            if key_text:
                key_col_carry = key_text
            else:
                key_text = key_col_carry
            value_text = normalize_space(data_row[value_col_idx])
            if not key_text and not value_text:
                continue
            if is_semantic_section_stop_row(data_row, normalize_space=normalize_space):
                break
            key = normalize_semantic_key(key_text, normalize_space=normalize_space)
            if not key:
                continue
            if not value_text:
                continue
            value_map[key] = value_text
        if value_map:
            maps.append(value_map)
    return maps


def extract_uncertainty_u_value(text: str, normalize_space: Callable[[str], str]) -> str:
    compact = normalize_space(str(text or ""))
    if not compact:
        return ""
    ohm = r"[ΩΩω]"
    patterns = (
        rf"电阻(?:校准)?[:：]?\s*U\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m?{ohm})\s*[,，]?\s*k\s*=\s*2",
        rf"扩展不确定度\s*U\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m?{ohm})\s*[,，]?\s*k\s*=\s*2",
    )
    for pattern in patterns:
        match = re.search(pattern, compact, flags=re.IGNORECASE)
        if match:
            return normalize_space(match.group(1))
    return ""


def replace_uncertainty_u_placeholder(text: str, u_value: str, normalize_space: Callable[[str], str]) -> str:
    source = normalize_space(text)
    if not source or not u_value:
        return source
    if "扩展不确定度" not in source or "U" not in source:
        return source
    pattern = re.compile(r"(扩展不确定度\s*U\s*=\s*)([^,\s，;；]*)(\s*(?:m?[ΩΩω])\s*[,，]?\s*k\s*=\s*2)", re.IGNORECASE)

    def repl(match: re.Match[str]) -> str:
        current = normalize_space(match.group(2))
        if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", current):
            return match.group(0)
        return f"{match.group(1)}{u_value}{match.group(3)}"

    return pattern.sub(repl, source)
