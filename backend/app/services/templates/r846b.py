import re
from typing import Callable, Iterable
from xml.etree import ElementTree as ET


def _split_section_blocks(source_text: str) -> dict[str, str]:
    section_blocks: dict[str, str] = {}
    if not source_text:
        return section_blocks
    marker_pattern = re.compile(
        r"(?:(?<=^)|(?<=\n)|(?<=[。．;；]))\s*([一二三四五六七])\s*[、.．)]",
        flags=re.IGNORECASE,
    )
    matches = list(marker_pattern.finditer(source_text))
    if not matches:
        return section_blocks
    for idx, match in enumerate(matches):
        section_key = str(match.group(1) or "").strip()
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(source_text)
        block = str(source_text[start:end] or "").strip()
        if not section_key or not block:
            continue
        if section_key not in section_blocks:
            section_blocks[section_key] = block
    return section_blocks


def _extract_section_u(section_block: str, *, extract_value_by_regex: Callable[..., str]) -> str:
    if not section_block:
        return ""
    return extract_value_by_regex(
        section_block,
        patterns=(
            r"(?:扩展不确定度\s*)?U\s*=\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
        ),
        flags=re.IGNORECASE | re.DOTALL,
    )


def _extract_section_measured(section_block: str, *, extract_value_by_regex: Callable[..., str]) -> str:
    if not section_block:
        return ""
    value = extract_value_by_regex(
        section_block,
        patterns=(
            r"实\s*测\s*值(?:\s*[（(][^)）]*[)）])?\s*[:：]?\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
        ),
        flags=re.IGNORECASE | re.DOTALL,
    )
    if value:
        return value
    # fallback: some source rows are "实 测 值 (mA)： 5.0"
    return extract_value_by_regex(
        section_block,
        patterns=(
            r"实\s*测\s*值[^\d+-]*([+-]?[0-9]+(?:\.[0-9]+)?)",
        ),
        flags=re.IGNORECASE | re.DOTALL,
    )


def _extract_section_u_by_anchor(
    source_text: str,
    section_key: str,
    anchor: str,
    *,
    extract_value_by_regex: Callable[..., str],
) -> str:
    return extract_value_by_regex(
        source_text,
        patterns=(
            rf"{re.escape(section_key)}\s*[、.．)]\s*[\s\S]{{0,180}}?{re.escape(anchor)}[\s\S]{{0,120}}?U\s*=\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
            rf"{re.escape(anchor)}[\s\S]{{0,120}}?U\s*=\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
        ),
        flags=re.IGNORECASE | re.DOTALL,
    )


def _extract_section_measured_by_anchor(
    source_text: str,
    section_key: str,
    anchor: str,
    *,
    extract_value_by_regex: Callable[..., str],
) -> str:
    return extract_value_by_regex(
        source_text,
        patterns=(
            rf"{re.escape(section_key)}\s*[、.．)]\s*[\s\S]{{0,260}}?{re.escape(anchor)}[\s\S]{{0,240}}?实\s*测\s*值(?:\s*[（(][^)）]*[)）])?\s*[:：]?\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
            rf"{re.escape(anchor)}[\s\S]{{0,240}}?实\s*测\s*值(?:\s*[（(][^)）]*[)）])?\s*[:：]?\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
        ),
        flags=re.IGNORECASE | re.DOTALL,
    )


def _extract_fixed_section_u_values(source_text: str, *, extract_value_by_regex: Callable[..., str]) -> dict[str, str]:
    return {
        "二": extract_value_by_regex(
            source_text,
            patterns=(
                r"二\s*[、.．)]\s*[\s\S]{0,260}?刮针移动距离[\s\S]{0,180}?U\s*=\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
            ),
            flags=re.IGNORECASE | re.DOTALL,
        ),
        "三": extract_value_by_regex(
            source_text,
            patterns=(
                r"三\s*[、.．)]\s*[\s\S]{0,260}?往复刮漆速度[\s\S]{0,180}?U\s*=\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
            ),
            flags=re.IGNORECASE | re.DOTALL,
        ),
        "四": extract_value_by_regex(
            source_text,
            patterns=(
                r"四\s*[、.．)]\s*[\s\S]{0,260}?刮针直径[\s\S]{0,180}?U\s*=\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
            ),
            flags=re.IGNORECASE | re.DOTALL,
        ),
        "五": extract_value_by_regex(
            source_text,
            patterns=(
                r"五\s*[、.．)]\s*[\s\S]{0,260}?试验电压[\s\S]{0,180}?U\s*=\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
            ),
            flags=re.IGNORECASE | re.DOTALL,
        ),
        "六": extract_value_by_regex(
            source_text,
            patterns=(
                r"六\s*[、.．)]\s*[\s\S]{0,260}?刮穿动作电流[\s\S]{0,180}?U\s*=\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
            ),
            flags=re.IGNORECASE | re.DOTALL,
        ),
        "七": extract_value_by_regex(
            source_text,
            patterns=(
                r"七\s*[、.．)]\s*[\s\S]{0,260}?负荷[\s\S]{0,180}?U\s*=\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
            ),
            flags=re.IGNORECASE | re.DOTALL,
        ),
    }


def _extract_load_values(
    section_block: str,
    label: str,
    *,
    extract_value_by_regex: Callable[..., str],
) -> list[str]:
    if not section_block:
        return []
    value = extract_value_by_regex(
        section_block,
        patterns=(
            rf"{label}\s*[(（]N[)）]?\s*[:：]?\s*([0-9.\s]+)",
        ),
        flags=re.IGNORECASE,
    )
    if not value:
        return []
    return re.findall(r"[0-9]+(?:\.[0-9]+)?", value)


def _replace_uncertainty_for_r846(text: str, value: str, unit: str) -> str:
    source = str(text or "")
    fill = str(value or "").strip()
    if not source or not fill:
        return source
    if re.search(r"U\s*=\s*[+-]?[0-9]+(?:\.[0-9]+)?", source):
        return source
    pattern = re.compile(r"(U\s*=\s*)([^,，。．]*)(\s*[,，]\s*k\s*=\s*2[。．]?)", flags=re.IGNORECASE)
    m = pattern.search(source)
    if not m:
        return source
    token = str(m.group(2) or "").strip()
    if token and not re.search(r"[0-9]", token):
        replaced = f"{fill} {token}"
    elif unit:
        replaced = f"{fill} {unit}"
    else:
        replaced = fill
    return pattern.sub(lambda m2: f"{m2.group(1)}{replaced}{m2.group(3)}", source, count=1)


def _replace_measured_for_r846(text: str, value: str, unit: str) -> str:
    source = str(text or "")
    fill = str(value or "").strip()
    if not source or not fill:
        return source
    if re.search(r"实\s*测\s*值(?:\s*[（(][^)）]*[)）])?\s*[:：]\s*[+-]?[0-9]+(?:\.[0-9]+)?", source):
        return source
    pattern = re.compile(r"(实\s*测\s*值(?:\s*[（(][^)）]*[)）])?\s*[:：]\s*)([^。．]*)([。．]?)", flags=re.IGNORECASE)
    m = pattern.search(source)
    if not m:
        return source
    body = str(m.group(2) or "").strip()
    token = ""
    if body and not re.search(r"[0-9]", body):
        token = body
    elif unit:
        token = unit
    replacement_body = f"{fill} {token}".strip()
    punctuation = m.group(3) or "。"
    return pattern.sub(lambda m2: f"{m2.group(1)}{replacement_body}{punctuation}", source, count=1)


def _fill_uncertainty_split_cells(cells: list[ET.Element], u_value: str, get_cell_text: Callable[[ET.Element], str], set_cell_text: Callable[[ET.Element, str], None]) -> bool:
    if not u_value:
        return False
    changed = False
    for idx, cell in enumerate(cells):
        original = get_cell_text(cell)
        if "U=" not in original:
            continue
        if re.search(r"U\s*=\s*[+-]?[0-9]+(?:\.[0-9]+)?", original):
            continue
        updated = re.sub(r"U\s*=\s*", f"U={u_value} ", original, count=1)
        updated = re.sub(r"\s{2,}", " ", updated)
        if updated == original:
            updated = f"U={u_value}"
        if updated != original:
            set_cell_text(cell, updated)
            changed = True
        # Most templates split as: [.. "U="] [ "mm,k=2。" ], so first hit is enough.
        if idx + 1 < len(cells):
            return True
    return changed


def _fill_measured_split_cells(cells: list[ET.Element], measured: str, unit: str, get_cell_text: Callable[[ET.Element], str], set_cell_text: Callable[[ET.Element, str], None]) -> bool:
    if not measured:
        return False
    changed = False
    for cell in cells:
        original = get_cell_text(cell)
        if not re.search(r"实\s*测\s*值", original):
            continue
        if re.search(r"实\s*测\s*值(?:\s*[（(][^)）]*[)）])?\s*[:：]\s*[+-]?[0-9]+(?:\.[0-9]+)?", original):
            continue
        updated = re.sub(
            r"(实\s*测\s*值(?:\s*[（(][^)）]*[)）])?\s*[:：]?\s*)([^。．]*)([。．]?)$",
            lambda m: (
                f"{m.group(1) or '实测值：'}"
                f"{measured}"
                f"{(' ' + re.sub(r'[^A-Za-z%°ΩΩω℃/]+', '', str(m.group(2) or '').strip())) if re.sub(r'[^A-Za-z%°ΩΩω℃/]+', '', str(m.group(2) or '').strip()) else ((' ' + unit) if unit else '')}"
                f"{m.group(3) or '。'}"
            ),
            original,
            count=1,
        )
        if updated == original:
            updated = f"实测值：{measured}。"
        if updated != original:
            set_cell_text(cell, updated)
            changed = True
        break
    return changed


def _set_result_mark_in_row(cells: list[ET.Element], get_cell_text: Callable[[ET.Element], str], set_cell_text: Callable[[ET.Element, str], None]) -> bool:
    for cell in cells:
        text = get_cell_text(cell)
        if "结果" not in text:
            continue
        if "√" in text:
            return False
        updated = re.sub(r"结果\s*[:：]?\s*$", "结果： √", text)
        if updated == text:
            updated = "结果： √"
        set_cell_text(cell, updated)
        return True
    return False


def _clear_section_three_table_defaults(
    rows: list[list[ET.Element]],
    ns: dict[str, str],
    get_cell_text: Callable[[ET.Element], str],
    set_cell_text: Callable[[ET.Element, str], None],
    source_text: str,
) -> bool:
    # If source has no structured detail rows for section 三, clear template default rows (e.g., hardcoded 60/60/60).
    if "\t" in str(source_text or ""):
        return False
    changed = False
    start_idx = -1
    for idx, cells in enumerate(rows):
        row_text = normalize_space(" ".join(get_cell_text(c) for c in cells))
        if ("往复刮漆次数" in row_text) and ("时间t(s)" in row_text):
            start_idx = idx
            break
    if start_idx < 0:
        return False
    for idx in range(start_idx + 1, min(start_idx + 8, len(rows))):
        cells = rows[idx]
        if not cells:
            continue
        # stop when entering next section
        row_text = normalize_space(" ".join(get_cell_text(c) for c in cells))
        if row_text.startswith("四、"):
            break
        for cidx, cell in enumerate(cells):
            current = normalize_space(get_cell_text(cell))
            if not current:
                continue
            # preserve first-column repeated count only if source has explicit table values (it does not here)
            if cidx == 0 and re.fullmatch(r"[0-9]+", current):
                set_cell_text(cell, "")
                changed = True
                continue
            if cidx > 0 and re.search(r"[0-9]", current):
                set_cell_text(cell, "")
                changed = True
    return changed


def fill_r846b_specific_sections(
    tables: list[ET.Element],
    source_text: str,
    *,
    ns: dict[str, str],
    placeholder_values: Iterable[str],
    normalize_space: Callable[[str], str],
    get_cell_text: Callable[[ET.Element], str],
    set_cell_text: Callable[[ET.Element, str], None],
    extract_value_by_regex: Callable[..., str],
    replace_uncertainty_value: Callable[[str, str, str], str],
) -> bool:
    if not source_text:
        return False
    changed = False
    placeholder_set = set(placeholder_values)
    section_blocks = _split_section_blocks(source_text)
    fixed_u_values = _extract_fixed_section_u_values(source_text, extract_value_by_regex=extract_value_by_regex)
    section_map = {
        "二": {"unit": "mm", "anchor": "刮针移动距离"},
        "三": {"unit": "次/分", "anchor": "往复刮漆速度"},
        "四": {"unit": "mm", "anchor": "刮针直径"},
        "五": {"unit": "V", "anchor": "试验电压"},
        "六": {"unit": "mA", "anchor": "刮穿动作电流"},
        "七": {"unit": "N", "anchor": "负荷"},
    }
    section_values: dict[str, dict[str, str]] = {}
    for key, config in section_map.items():
        block = section_blocks.get(key, "")
        unit = str(config["unit"])
        anchor = str(config["anchor"])
        u_value = _extract_section_u(block, extract_value_by_regex=extract_value_by_regex)
        measured_value = _extract_section_measured(block, extract_value_by_regex=extract_value_by_regex)
        if not u_value and not block:
            u_value = _extract_section_u_by_anchor(
                source_text,
                section_key=key,
                anchor=anchor,
                extract_value_by_regex=extract_value_by_regex,
            )
        if not measured_value and not block:
            measured_value = _extract_section_measured_by_anchor(
                source_text,
                section_key=key,
                anchor=anchor,
                extract_value_by_regex=extract_value_by_regex,
            )
        if not u_value and not block:
            u_value = str(fixed_u_values.get(key, "") or "")
        section_values[key] = {
            "u": u_value,
            "m": measured_value,
            "unit": unit,
        }
    source_compact = re.sub(r"\s+", "", str(source_text or ""))
    section_mark_ready = {
        "二": bool(section_values["二"].get("u")) or bool(section_values["二"].get("m")),
        "三": bool(section_values["三"].get("u")) or bool(section_values["三"].get("m")),
        "四": bool(section_values["四"].get("u")) or bool(section_values["四"].get("m")),
        "五": bool(section_values["五"].get("u")) or bool(section_values["五"].get("m")),
        "六": bool(section_values["六"].get("u")) or bool(section_values["六"].get("m")),
        "七": bool(section_values["七"].get("u")),
    }

    section_seven_block = section_blocks.get("七", "")
    nominal_values = _extract_load_values(source_text, "标称值", extract_value_by_regex=extract_value_by_regex) or _extract_load_values(
        section_seven_block,
        "标称值",
        extract_value_by_regex=extract_value_by_regex,
    )
    actual_values = _extract_load_values(source_text, "校准值", extract_value_by_regex=extract_value_by_regex) or _extract_load_values(
        source_text,
        "实际值",
        extract_value_by_regex=extract_value_by_regex,
    ) or _extract_load_values(
        section_seven_block,
        "校准值",
        extract_value_by_regex=extract_value_by_regex,
    ) or _extract_load_values(
        section_seven_block,
        "实际值",
        extract_value_by_regex=extract_value_by_regex,
    )

    for tbl in tables:
        current_section = ""
        row_cells = [tr.findall("./w:tc", ns) for tr in tbl.findall("./w:tr", ns)]
        if _clear_section_three_table_defaults(row_cells, ns, get_cell_text, set_cell_text, source_text):
            changed = True
        for cells in row_cells:
            if not cells:
                continue
            row_text = normalize_space(" ".join([get_cell_text(cell) for cell in cells]))
            compact = re.sub(r"\s+", "", row_text)
            for section_key, config in section_map.items():
                if section_key in compact and "扩展不确定度" in row_text and "U=" in row_text:
                    current_section = section_key
                    break

            if current_section in section_values and "扩展不确定度" in row_text and "U=" in row_text:
                u_value = section_values[current_section].get("u", "")
                unit = section_values[current_section].get("unit", "")
                if u_value:
                    split_filled = _fill_uncertainty_split_cells(cells, u_value, get_cell_text, set_cell_text)
                    changed = split_filled or changed
                    for cell in cells:
                        original = get_cell_text(cell)
                        updated = _replace_uncertainty_for_r846(original, u_value, unit)
                        if updated == original:
                            updated = replace_uncertainty_value(original, u_value, unit)
                        if updated != original:
                            set_cell_text(cell, updated)
                            changed = True

            if current_section in section_values and re.search(r"实\s*测\s*值", row_text):
                measured = section_values[current_section].get("m", "")
                unit = section_values[current_section].get("unit", "")
                if measured:
                    split_filled = _fill_measured_split_cells(cells, measured, unit, get_cell_text, set_cell_text)
                    changed = split_filled or changed
                    for cell in cells:
                        original = get_cell_text(cell)
                        updated = _replace_measured_for_r846(original, measured, unit)
                        if updated != original:
                            set_cell_text(cell, updated)
                            changed = True

            if "标称值(N)" in row_text and nominal_values:
                for idx, value in enumerate(nominal_values, start=1):
                    if idx >= len(cells):
                        break
                    current = normalize_space(get_cell_text(cells[idx]))
                    if current and current not in placeholder_set:
                        continue
                    set_cell_text(cells[idx], value)
                    changed = True

            if "实际值(N)" in row_text and actual_values:
                for idx, value in enumerate(actual_values, start=1):
                    if idx >= len(cells):
                        break
                    current = normalize_space(get_cell_text(cells[idx]))
                    if current and current not in placeholder_set:
                        continue
                    set_cell_text(cells[idx], value)
                    changed = True

            if "结果" in row_text:
                should_mark = False
                if "(1)" in row_text:
                    should_mark = "水平位置" in source_compact
                elif "(2)" in row_text:
                    should_mark = ("拉紧校直" in source_compact) or ("紧密接触" in source_compact)
                elif "(3)" in row_text:
                    should_mark = "自动停机" in source_compact
                elif current_section in section_mark_ready:
                    if current_section == "七":
                        should_mark = section_mark_ready["七"] and bool(nominal_values) and bool(actual_values)
                    else:
                        should_mark = section_mark_ready[current_section]
                if should_mark:
                    marked = _set_result_mark_in_row(cells, get_cell_text, set_cell_text)
                    changed = marked or changed
    return changed
