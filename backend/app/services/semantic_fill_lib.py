import re
from typing import Callable


def _normalize_unit_token(value: str) -> str:
    token = re.sub(r"\s+", "", str(value or "")).lower()
    if not token:
        return ""
    token = token.replace("Ω", "Ω").replace("ω", "Ω")
    token = token.replace("ohm", "Ω").replace("欧姆", "Ω")
    token = token.replace("°c", "℃").replace("c", "℃")
    return token


def _unit_token_in_text(unit: str, text: str) -> bool:
    u = _normalize_unit_token(unit)
    raw = str(text or "")
    if not u or not raw:
        return False
    lower = raw.lower().replace("Ω", "Ω").replace("ω", "Ω")
    if u == "℃":
        return ("℃" in raw) or ("°c" in lower)
    if u == "°":
        return "°" in raw
    if u == "n":
        return bool(re.search(r"(?<![a-z])n(?![a-z])", lower)) or ("牛" in raw)
    if u == "Ω":
        return ("Ω" in raw) or ("欧姆" in raw.lower()) or ("ohm" in lower)
    return u in _normalize_unit_token(raw)


def _should_append_source_unit(unit: str, *texts: str) -> bool:
    if not _normalize_unit_token(unit):
        return False
    return any(_unit_token_in_text(unit, text) for text in texts if text)


def _extract_unit_from_uncertainty_text(text: str) -> str:
    m = re.search(
        r"U(?:rel)?\s*=\s*(?:[+-]?\d+(?:\.\d+)?)?\s*([^\d,，;；\s]+)\s*[,，]?\s*k\s*=\s*2",
        str(text or ""),
        flags=re.IGNORECASE,
    )
    if not m:
        return ""
    return _normalize_unit_token(m.group(1))


def _extract_unit_from_measured_text(text: str) -> str:
    m = re.search(r"实\s*测\s*值\s*(?:[:：]\s*)?([^\d\s:：,，;；。．]+)", str(text or ""), flags=re.IGNORECASE)
    if not m:
        return ""
    return _normalize_unit_token(m.group(1))


def _anchor_groups() -> list[set[str]]:
    return [
        {"温度", "℃", "°c", "c"},
        {"夹角", "角度", "°"},
        {"力值", "牛", "n"},
        {"电阻", "ω", "Ω", "欧姆"},
        {"距离", "间距"},
        {"宽度", "刀口"},
        {"夹具", "夹头"},
        {"平行", "互相平行"},
    ]


def _anchor_group_hits(text: str, normalize_space: Callable[[str], str]) -> set[int]:
    normalized = normalize_space(text).lower()
    if not normalized:
        return set()
    compact = re.sub(r"\s+", "", normalized)
    hits: set[int] = set()
    for idx, group in enumerate(_anchor_groups()):
        if any(str(token).lower() in compact for token in group):
            hits.add(idx)
    return hits


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


def normalize_multiline_text(value: str, normalize_space: Callable[[str], str]) -> str:
    if not value:
        return ""
    lines: list[str] = []
    for line in str(value).splitlines():
        normalized_line = normalize_space(line)
        if normalized_line:
            lines.append(normalized_line)
    return "\n".join(lines)


def extract_text_block(
    text: str,
    start_patterns: tuple[str, ...],
    end_patterns: tuple[str, ...],
    normalize_space: Callable[[str], str],
) -> str:
    if not text:
        return ""
    lines = [normalize_space(line) for line in str(text).splitlines()]
    start_idx = -1
    for idx, line in enumerate(lines):
        if not line:
            continue
        if any(re.search(pattern, line, flags=re.IGNORECASE) for pattern in start_patterns):
            start_idx = idx
            break
    if start_idx < 0:
        return ""

    end_idx = len(lines)
    for idx in range(start_idx + 1, len(lines)):
        line = lines[idx]
        if not line:
            continue
        if any(re.search(pattern, line, flags=re.IGNORECASE) for pattern in end_patterns):
            end_idx = idx
            break
    return normalize_multiline_text("\n".join(lines[start_idx:end_idx]), normalize_space=normalize_space)


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
        if value_col_idx < 0 and re.search(r"实际值|实测值|示值|读数|测量值|校准值", compact):
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
    # Support horizontal two-row style:
    # row A: 标称值/标准值/设定值 + values...
    # row B: 校准值/实际值/实测值 + values...
    def _is_key_header(cell: str) -> bool:
        compact = re.sub(r"\s+", "", str(cell or ""))
        return bool(re.search(r"标准值|标称值|设定值", compact))

    def _is_value_header(cell: str) -> bool:
        compact = re.sub(r"\s+", "", str(cell or ""))
        return bool(re.search(r"校准值|实际值|实测值|示值|读数|测量值", compact))

    for i in range(len(table_rows) - 1):
        upper = table_rows[i]
        lower = table_rows[i + 1]
        if len(upper) < 2 or len(lower) < 2:
            continue
        if _is_key_header(upper[0]) and _is_value_header(lower[0]):
            value_map: dict[str, str] = {}
            width = min(len(upper), len(lower))
            for col in range(1, width):
                key = normalize_semantic_key(upper[col], normalize_space=normalize_space)
                value = normalize_space(lower[col])
                if not key or not value:
                    continue
                value_map[key] = value
            if value_map:
                maps.append(value_map)

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


def normalize_series_row_label(text: str, normalize_space: Callable[[str], str]) -> str:
    value = normalize_space(text)
    if not value:
        return ""
    value = re.sub(r"^\s*(?:[（(]\d+[)）]|\d+[、.．)])\s*", "", value)
    value = value.lower()
    value = re.sub(r"\s+", "", value)
    value = value.replace("Ω", "Ω").replace("ω", "Ω")
    value = re.sub(r"校准值|实测值|实际值|示值|显示值|测量值|读数", "值", value)
    value = re.sub(r"标称值|标准值|设定值", "标值", value)
    value = re.sub(r"[：:;；，,。．\[\]【】（）()<>《》]", "", value)
    return value


def build_series_row_value_maps_from_general_check_text(
    text: str,
    normalize_space: Callable[[str], str],
) -> list[dict[str, list[str]]]:
    lines = [str(x or "") for x in str(text or "").splitlines()]
    if not lines:
        return []
    blocks: list[list[list[str]]] = []
    current: list[list[str]] = []
    for line in lines:
        if "\t" not in line:
            if current:
                blocks.append(current)
                current = []
            continue
        row = [normalize_space(cell) for cell in line.split("\t")]
        current.append(row)
    if current:
        blocks.append(current)

    maps: list[dict[str, list[str]]] = []
    for block in blocks:
        row_map: dict[str, list[str]] = {}
        for row in block:
            if len(row) < 2:
                continue
            label = normalize_space(row[0])
            values = [normalize_space(x) for x in row[1:]]
            if not label:
                continue
            if not any(values):
                continue
            key = normalize_series_row_label(label, normalize_space=normalize_space)
            if not key:
                continue
            if key not in row_map:
                row_map[key] = values
        if row_map:
            maps.append(row_map)

    # Fallback for plain-text rows like:
    # "标称值(N): 0.05 0.1 0.2 ..." / "校准值(N): 0.052 0.12 ..."
    plain_row_map: dict[str, list[str]] = {}
    for line in [normalize_space(x) for x in lines if normalize_space(x)]:
        if not re.search(r"(标称值|标准值|校准值|实际值|实测值|显示值|示值)", line):
            continue
        numbers = re.findall(r"[+-]?\d+(?:\.\d+)?", line)
        if len(numbers) < 2:
            continue
        label_part = re.split(r"[:：]", line, maxsplit=1)[0]
        key = normalize_series_row_label(label_part, normalize_space=normalize_space)
        if not key:
            continue
        if key not in plain_row_map:
            plain_row_map[key] = numbers
    if plain_row_map:
        maps.append(plain_row_map)
    return maps


def pick_series_row_values_for_label(
    source_maps: list[dict[str, list[str]]],
    label: str,
    normalize_space: Callable[[str], str],
) -> list[str]:
    target_key = normalize_series_row_label(label, normalize_space=normalize_space)
    if not target_key:
        return []
    for mapping in source_maps:
        values = mapping.get(target_key)
        if values and any(normalize_space(x) for x in values):
            return values

    best_values: list[str] = []
    best_score = 0
    for mapping in source_maps:
        for key, values in mapping.items():
            if not values or not any(normalize_space(x) for x in values):
                continue
            if key in target_key or target_key in key:
                score = min(len(key), len(target_key)) + 10
            else:
                overlap = len(set(key) & set(target_key))
                score = overlap
            if score > best_score:
                best_score = score
                best_values = values
    if best_score >= 3:
        return best_values
    return []


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


def extract_uncertainty_items(text: str, normalize_space: Callable[[str], str]) -> list[dict[str, str]]:
    source = str(text or "")
    lines = [normalize_space(line) for line in source.splitlines() if normalize_space(line)]
    items: list[dict[str, str]] = []
    pattern = re.compile(
        r"^(.*?)\s*(?:[:：])?\s*U\s*=\s*([+-]?\d+(?:\.\d+)?)\s*([^\s,，;；]*)\s*[,，]?\s*k\s*=\s*2",
        re.IGNORECASE,
    )
    for line in lines:
        raw = re.sub(r"\t+", " ", line)
        raw = re.sub(r"^\s*[一二三四五六七八九十\d]+[、.．)]\s*", "", raw).strip()
        m = pattern.search(raw)
        if not m:
            continue
        anchor = normalize_space(m.group(1))
        anchor = re.sub(r"(?:扩展不确定度|校准)\s*$", "", anchor).strip()
        value = normalize_space(m.group(2))
        unit = normalize_space(m.group(3))
        if not value:
            continue
        items.append({"anchor": anchor, "value": value, "unit": unit})
    return items


def replace_uncertainty_u_placeholder(text: str, u_value: str, normalize_space: Callable[[str], str]) -> str:
    source = normalize_space(text)
    if not source or not u_value:
        return source
    if "扩展不确定度" not in source or "U" not in source:
        return source
    pattern = re.compile(r"(扩展不确定度\s*U(?:rel)?\s*=\s*)([^,\s，;；]*)(\s*(?:m?[ΩΩω%])\s*[,，]?\s*k\s*=\s*2)", re.IGNORECASE)

    def repl(match: re.Match[str]) -> str:
        current = normalize_space(match.group(2))
        if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", current):
            return match.group(0)
        return f"{match.group(1)}{u_value}{match.group(3)}"

    return pattern.sub(repl, source)


def replace_uncertainty_u_placeholder_by_items(
    text: str,
    items: list[dict[str, str]],
    normalize_space: Callable[[str], str],
) -> str:
    source = normalize_space(text)
    if not source or not items:
        return source
    if "扩展不确定度" not in source or "U" not in source:
        return source
    # Keep target unit format and only inject numeric value.
    pattern = re.compile(r"(扩展不确定度\s*U(?:rel)?\s*=\s*)([^,，;；\s]*)(\s*[^,，;；\s]*\s*[,，]?\s*k\s*=\s*2)", re.IGNORECASE)
    anchor_text = normalize_space(source.split("扩展不确定度", 1)[0])
    target_unit = _extract_unit_from_uncertainty_text(source)

    target_hits = _anchor_group_hits(anchor_text, normalize_space=normalize_space)

    def score(item: dict[str, str]) -> int:
        anchor = normalize_space(str((item or {}).get("anchor", "")))
        item_unit = _normalize_unit_token(str((item or {}).get("unit", "")))
        if target_unit and item_unit and target_unit != item_unit:
            return 0
        if not anchor:
            return 0
        source_hits = _anchor_group_hits(anchor, normalize_space=normalize_space)
        if target_hits and source_hits:
            if not (target_hits & source_hits):
                return 0
            return 100 + len(target_hits & source_hits) * 10
        if target_hits and not source_hits:
            return 0
        a = re.sub(r"[^\w\u4e00-\u9fff]+", "", anchor).lower()
        b = re.sub(r"[^\w\u4e00-\u9fff]+", "", anchor_text).lower()
        if not a or not b:
            return 0
        if a in b or b in a:
            return 3
        overlap = len(set(a) & set(b))
        return 2 if overlap >= 3 else (1 if overlap >= 2 else 0)

    best = None
    best_score = -1
    for item in items:
        s = score(item)
        if s > best_score:
            best = item
            best_score = s
    if best_score <= 0 and len(items) > 1:
        return source
    if not best or not normalize_space(str(best.get("value", ""))):
        if len(items) == 1:
            best = items[0]
        else:
            return source
    fill_value = normalize_space(str(best.get("value", "")))
    fill_unit = normalize_space(str(best.get("unit", "")))
    if not fill_value:
        return source

    def repl(match: re.Match[str]) -> str:
        current = normalize_space(match.group(2))
        if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", current):
            return match.group(0)
        suffix = match.group(3)
        # Placeholder often stores unit in `current` (e.g. "mm"), keep it.
        if current and re.fullmatch(r"[^\d\s]+", current):
            suffix = f" {current}{suffix}"
        if not target_unit and _should_append_source_unit(fill_unit, source, anchor_text):
            suffix = f" {fill_unit}{suffix}"
        return f"{match.group(1)}{fill_value}{suffix}"

    return pattern.sub(repl, source)


def extract_measured_value_items(text: str, normalize_space: Callable[[str], str]) -> list[dict[str, str]]:
    source = str(text or "")
    lines = [normalize_space(line) for line in source.splitlines() if normalize_space(line)]
    items: list[dict[str, str]] = []
    current_anchor = ""

    measured_pattern = re.compile(
        r"实\s*测\s*值(?:\s*[（(]\s*([^)）]+)\s*[)）])?\s*[:：]\s*([+-]?\d+(?:\.\d+)?)\s*([^\s,，;；。．]*)",
        re.IGNORECASE,
    )
    for line in lines:
        raw = re.sub(r"\t+", " ", line)
        raw = re.sub(r"^\s*[一二三四五六七八九十\d]+[、.．)]\s*", "", raw).strip()
        match = measured_pattern.search(raw)
        if match:
            unit_from_label = normalize_space(match.group(1))
            value = normalize_space(match.group(2))
            unit = normalize_space(match.group(3)) or unit_from_label
            if value:
                items.append(
                    {
                        "anchor": normalize_space(current_anchor),
                        "value": value,
                        "unit": unit,
                    }
                )
            continue

        # Fallback for split/irregular labels, e.g. "实 测 值 5.0" + "(mA):"
        if re.search(r"实\s*测\s*值", raw):
            value_match = re.search(r"实\s*测\s*值[^\d+-]*([+-]?\d+(?:\.\d+)?)", raw, flags=re.IGNORECASE)
            if value_match:
                value = normalize_space(value_match.group(1))
                unit = ""
                unit_in_line = re.search(r"[（(]\s*([^)）]+)\s*[)）]\s*[:：]?\s*$", raw)
                if unit_in_line:
                    unit = normalize_space(unit_in_line.group(1))
                if not unit:
                    # try trailing unit after value in same line
                    tail = raw[value_match.end() :]
                    tail_unit = re.search(r"([A-Za-z%°ΩΩω℃/]+)\s*[。．]?\s*$", tail)
                    if tail_unit:
                        unit = normalize_space(tail_unit.group(1))
                if value:
                    items.append(
                        {
                            "anchor": normalize_space(current_anchor),
                            "value": value,
                            "unit": unit,
                        }
                    )
                    continue
        current_anchor = re.sub(r"(?:扩展不确定度\s*)?U\s*=\s*.*$", "", raw, flags=re.IGNORECASE).strip()
    return items


def replace_measured_value_placeholder_by_items(
    text: str,
    items: list[dict[str, str]],
    normalize_space: Callable[[str], str],
    anchor_hint: str = "",
) -> str:
    source = normalize_space(text)
    if not source or not items:
        return source
    if not re.search(r"实\s*测\s*值", source):
        return source
    pattern = re.compile(r"((?:实\s*测\s*值)(?:\s*[（(][^)）]*[)）])?\s*(?:[:：])\s*)([^,，;；。\s]*)(\s*[^,，;；。\s]*\s*[。．]?)", re.IGNORECASE)
    anchor_parts = re.split(r"实\s*测\s*值", source, maxsplit=1)
    anchor_text = normalize_space(anchor_parts[0] if anchor_parts else "") or normalize_space(anchor_hint)
    target_unit = _extract_unit_from_measured_text(source)
    target_hits = _anchor_group_hits(anchor_text, normalize_space=normalize_space)

    def score(item: dict[str, str]) -> int:
        anchor = normalize_space(str((item or {}).get("anchor", "")))
        item_unit = _normalize_unit_token(str((item or {}).get("unit", "")))
        if target_unit and item_unit and target_unit != item_unit:
            return 0
        if not anchor:
            return 0
        source_hits = _anchor_group_hits(anchor, normalize_space=normalize_space)
        if target_hits and source_hits:
            if not (target_hits & source_hits):
                return 0
            return 100 + len(target_hits & source_hits) * 10
        if target_hits and not source_hits:
            return 0
        a = re.sub(r"[^\w\u4e00-\u9fff]+", "", anchor).lower()
        b = re.sub(r"[^\w\u4e00-\u9fff]+", "", anchor_text).lower()
        if not a or not b:
            return 0
        if a in b or b in a:
            return 3
        overlap = len(set(a) & set(b))
        return 2 if overlap >= 3 else (1 if overlap >= 2 else 0)

    best = None
    best_score = -1
    for item in items:
        s = score(item)
        if s > best_score:
            best = item
            best_score = s
    if best_score <= 0 and len(items) > 1:
        return source
    if not best or not normalize_space(str(best.get("value", ""))):
        if len(items) == 1:
            best = items[0]
        else:
            return source

    fill_value = normalize_space(str(best.get("value", "")))
    fill_unit = normalize_space(str(best.get("unit", "")))
    if not fill_value:
        return source

    def repl(match: re.Match[str]) -> str:
        current = normalize_space(match.group(2))
        if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", current):
            return match.group(0)
        suffix = match.group(3)
        if current and re.fullmatch(r"[^\d\s]+", current):
            suffix = f"{current}{suffix}"
        elif not target_unit and _should_append_source_unit(fill_unit, source, anchor_text, anchor_hint):
            suffix = f"{fill_unit}{suffix}"
        return f"{match.group(1)}{fill_value}{suffix}"

    return pattern.sub(repl, source)


def is_reliable_result_semantic_match(
    target_text: str,
    source_line: str,
    normalize_space: Callable[[str], str],
) -> bool:
    target = normalize_space(target_text)
    source = normalize_space(source_line)
    if not target or not source:
        return False
    target_hits = _anchor_group_hits(target, normalize_space=normalize_space)
    source_hits = _anchor_group_hits(source, normalize_space=normalize_space)
    if target_hits:
        return bool(target_hits & source_hits)
    return True


def pick_semantic_value_for_key(source_maps: list[dict[str, str]], key: str, normalize_space: Callable[[str], str]) -> str:
    for mapping in source_maps:
        if key in mapping and normalize_space(mapping.get(key, "")):
            return normalize_space(mapping[key])
    return ""
