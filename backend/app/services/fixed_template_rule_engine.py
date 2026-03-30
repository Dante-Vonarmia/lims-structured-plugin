from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import re
from typing import Any, Callable
from xml.etree import ElementTree as ET

import yaml

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}
RULES_FILE = Path(__file__).resolve().parents[1] / "rules" / "fixed_template_fill_rules.yaml"


def _normalize(value: str) -> str:
    return " ".join(str(value or "").replace("\u3000", " ").split()).strip()


def _contains_marker(text: str, marker: str) -> bool:
    source = str(text or "")
    token = _normalize(marker)
    if not source or not token:
        return False
    if token in source:
        return True
    pattern = r"\s*".join(re.escape(ch) for ch in token)
    try:
        return re.search(pattern, source, flags=re.IGNORECASE) is not None
    except re.error:
        return False


def _strip_marker(text: str, marker: str) -> str:
    source = str(text or "")
    token = _normalize(marker)
    if not source or not token:
        return source
    pattern = r"\s*".join(re.escape(ch) for ch in token)
    try:
        return re.sub(pattern, " ", source, flags=re.IGNORECASE)
    except re.error:
        return source.replace(token, " ")


def _looks_like_label_cell(value: str, markers: tuple[str, ...]) -> bool:
    text = _normalize(value)
    if not text:
        return False
    for marker in markers:
        marker_text = _normalize(marker)
        if not marker_text or not _contains_marker(text, marker_text):
            continue
        remain = _strip_marker(text, marker_text)
        # Remove common bilingual subtitle tokens that belong to label cells.
        remain = re.sub(
            r"(?i)\b("
            r"client|address|instrument\s*name|manufacturer|model\s*/?\s*specification|"
            r"instrument\s*serial\s*number|certificate\s*series\s*number|"
            r"model|specification|serial|number|issue\s*date|year|month|day|others|"
            r"ambient\s*temperature|relative\s*humidity|received\s*date|date\s*for\s*calibration"
            r")\b",
            " ",
            remain,
        )
        remain = re.sub(r"[：:、，,。.;；()（）\[\]{}<>《》“”\"'`~!@#$%^&*_+=|\\/?\-\s□■•·]+", "", remain)
        if not remain:
            return True
    return False


def _is_compatible_value_cell(value: str, markers: tuple[str, ...]) -> bool:
    text = _normalize(value)
    if not text:
        return True
    return not any(marker and _contains_marker(text, marker) for marker in markers)


@lru_cache(maxsize=1)
def load_fixed_fill_rules() -> dict[str, Any]:
    if not RULES_FILE.exists():
        return {"generic_record_table": {"threshold": 4, "score_groups": []}, "base_fields": []}
    with RULES_FILE.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        return {"generic_record_table": {"threshold": 4, "score_groups": []}, "base_fields": []}
    table_cfg = data.get("generic_record_table") if isinstance(data.get("generic_record_table"), dict) else {}
    fields_cfg = data.get("base_fields") if isinstance(data.get("base_fields"), list) else []
    return {"generic_record_table": table_cfg, "base_fields": fields_cfg}


def find_generic_record_table_by_rules(
    tables: list[ET.Element],
    get_cell_text: Callable[[ET.Element], str],
) -> ET.Element | None:
    cfg = load_fixed_fill_rules().get("generic_record_table", {}) or {}
    threshold = int(cfg.get("threshold", 4) or 4)
    groups = cfg.get("score_groups", []) or []

    best_table: ET.Element | None = None
    best_score = -1
    for tbl in tables:
        row_text = " ".join([get_cell_text(tc) for tc in tbl.findall("./w:tr/w:tc", NS)])
        if not row_text:
            continue
        score = 0
        for group in groups:
            if not isinstance(group, dict):
                continue
            markers = [str(x) for x in (group.get("markers") or []) if str(x).strip()]
            weight = int(group.get("weight", 1) or 1)
            if markers and any(marker in row_text for marker in markers):
                score += weight
        if score > best_score:
            best_score = score
            best_table = tbl
    if best_table is not None and best_score >= threshold:
        return best_table
    return None


def find_cell_index_contains_any(
    cells: list[ET.Element],
    markers: tuple[str, ...],
    get_cell_text: Callable[[ET.Element], str],
) -> int:
    for idx, cell in enumerate(cells):
        cell_text = get_cell_text(cell)
        if any(marker in cell_text for marker in markers):
            return idx
    return -1


def fill_base_fields_in_cells_by_rules(
    cells: list[ET.Element],
    payload: dict[str, Any],
    basis_mode: str,
    get_cell_text: Callable[[ET.Element], str],
    set_cell_text: Callable[[ET.Element, str], None],
    extract_basis_from_text: Callable[[str], str],
    format_mode_prefix: Callable[[str], str],
) -> bool:
    changed = False
    rules = load_fixed_fill_rules().get("base_fields", []) or []
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        key = str(rule.get("key", "")).strip()
        if not key:
            continue
        markers = tuple(str(x) for x in (rule.get("markers") or []) if str(x).strip())
        if not markers:
            continue
        format_text = str(rule.get("format", "{value}") or "{value}")
        mode_aware = bool(rule.get("mode_aware", False))
        infer_from_existing = bool(rule.get("infer_from_existing", False))

        idx = find_cell_index_contains_any(cells, markers, get_cell_text)
        if idx < 0:
            continue

        current = get_cell_text(cells[idx])
        value = _normalize(payload.get(key, ""))
        if infer_from_existing and not value:
            value = _normalize(extract_basis_from_text(current))

        if not value and not (mode_aware and basis_mode):
            continue

        if value and idx + 1 < len(cells) and _looks_like_label_cell(current, markers):
            next_cell_text = _normalize(get_cell_text(cells[idx + 1]))
            if _is_compatible_value_cell(next_cell_text, markers):
                set_cell_text(cells[idx + 1], value)
                changed = True
                continue

        mode_prefix = format_mode_prefix(basis_mode) if mode_aware else ""
        rendered = format_text.format(value=value, mode_prefix=mode_prefix)
        set_cell_text(cells[idx], rendered)
        changed = True
    return changed


def fill_base_fields_in_tables_by_rules(
    tables: list[ET.Element],
    payload: dict[str, Any],
    basis_mode: str,
    get_cell_text: Callable[[ET.Element], str],
    set_cell_text: Callable[[ET.Element, str], None],
    extract_basis_from_text: Callable[[str], str],
    format_mode_prefix: Callable[[str], str],
) -> bool:
    changed = False
    for tbl in tables:
        for tr in tbl.findall("./w:tr", NS):
            cells = tr.findall("./w:tc", NS)
            if not cells:
                continue
            if fill_base_fields_in_cells_by_rules(
                cells=cells,
                payload=payload,
                basis_mode=basis_mode,
                get_cell_text=get_cell_text,
                set_cell_text=set_cell_text,
                extract_basis_from_text=extract_basis_from_text,
                format_mode_prefix=format_mode_prefix,
            ):
                changed = True
    return changed


def _set_paragraph_text(paragraph: ET.Element, value: str) -> None:
    for child in list(paragraph):
        if child.tag == f"{{{W_NS}}}pPr":
            continue
        paragraph.remove(child)
    run = ET.SubElement(paragraph, f"{{{W_NS}}}r")
    text = ET.SubElement(run, f"{{{W_NS}}}t")
    text.text = value


def fill_base_fields_in_paragraphs_by_rules(
    root: ET.Element,
    payload: dict[str, Any],
    basis_mode: str,
    extract_basis_from_text: Callable[[str], str],
    format_mode_prefix: Callable[[str], str],
) -> bool:
    changed = False
    rules = load_fixed_fill_rules().get("base_fields", []) or []
    table_paragraph_ids = {id(p) for p in root.findall(".//w:tbl//w:p", NS)}
    paragraphs = root.findall(".//w:p", NS)
    for paragraph in paragraphs:
        if id(paragraph) in table_paragraph_ids:
            continue
        paragraph_text = _normalize("".join((node.text or "") for node in paragraph.findall(".//w:t", NS)))
        if not paragraph_text:
            continue
        for rule in rules:
            if not isinstance(rule, dict):
                continue
            markers = tuple(str(x) for x in (rule.get("markers") or []) if str(x).strip())
            if not markers or not any(marker in paragraph_text for marker in markers):
                continue
            key = str(rule.get("key", "")).strip()
            if not key:
                continue
            format_text = str(rule.get("format", "{value}") or "{value}")
            mode_aware = bool(rule.get("mode_aware", False))
            infer_from_existing = bool(rule.get("infer_from_existing", False))

            value = _normalize(payload.get(key, ""))
            if infer_from_existing and not value:
                value = _normalize(extract_basis_from_text(paragraph_text))
            if not value and not (mode_aware and basis_mode):
                continue

            mode_prefix = format_mode_prefix(basis_mode) if mode_aware else ""
            rendered = format_text.format(value=value, mode_prefix=mode_prefix)
            _set_paragraph_text(paragraph, rendered)
            changed = True
            break
    return changed
