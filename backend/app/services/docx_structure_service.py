import base64
import io
from pathlib import Path
import posixpath
import re
from typing import Any
import zipfile
import xml.etree.ElementTree as ET

DOC_XML_RELS_PATH = "word/_rels/document.xml.rels"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
DRAWING_NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
VML_NS = {"v": "urn:schemas-microsoft-com:vml"}
_PLACEHOLDER_VALUES = {"", "-", "--", "—", "/", "／"}


def _normalize_catalog_value(value: Any) -> str:
    text = str(value or "")
    text = text.replace("\u3000", " ")
    text = re.sub(r"\s+", " ", text).strip()
    if text in _PLACEHOLDER_VALUES:
        return ""
    return text


def _extract_docx_table_rows(root: ET.Element, preserve_paragraphs: bool = False) -> list[list[list[str]]]:
    tables: list[list[list[str]]] = []
    for tbl in root.findall(".//{*}tbl"):
        active_vmerge: dict[int, str] = {}
        rows: list[list[str]] = []
        for tr in tbl.findall("./{*}tr"):
            row: list[str] = []
            occupied: set[int] = set()
            col_idx = _get_docx_row_grid_before(tr)
            for tc in tr.findall("./{*}tc"):
                span = _get_docx_cell_grid_span(tc)
                text = _extract_docx_cell_text(tc, preserve_paragraphs=preserve_paragraphs)
                vmerge = _get_docx_cell_vmerge(tc)

                while col_idx in occupied:
                    col_idx += 1
                if col_idx < 0:
                    col_idx = 0
                if col_idx + span > len(row):
                    row.extend([""] * (col_idx + span - len(row)))

                if vmerge == "continue" and not text:
                    text = active_vmerge.get(col_idx, "")

                row[col_idx] = text
                for offset in range(span):
                    pos = col_idx + offset
                    occupied.add(pos)
                    if vmerge == "restart":
                        active_vmerge[pos] = text
                    elif vmerge != "continue":
                        active_vmerge.pop(pos, None)
                col_idx += span

            if row:
                rows.append(row)

        if rows:
            max_width = max(len(row) for row in rows)
            for row in rows:
                if len(row) < max_width:
                    row.extend([""] * (max_width - len(row)))
            tables.append(rows)

    return tables


def _extract_general_check_structure_from_docx(raw_bytes: bytes) -> dict[str, Any] | None:
    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
            xml_bytes = zf.read("word/document.xml")
            image_tokens = _load_docx_inline_image_tokens_from_zip(zf)
            embedded_tables = _extract_non_chart_linked_embedded_xlsx_table_models(zf)
    except Exception:
        return None
    try:
        root = ET.fromstring(xml_bytes)
    except Exception:
        return None

    models_with_text: list[tuple[dict[str, Any], str, int]] = []
    for tbl in root.findall(".//{*}tbl"):
        model = _build_docx_table_model(tbl, image_tokens)
        if not model:
            continue
        cells = model.get("cells", []) if isinstance(model, dict) else []
        text = " ".join([str((cell or {}).get("text", "")) for cell in cells]).strip()
        score = _score_general_check_table(model)
        models_with_text.append((model, text, score))
    if not models_with_text:
        return None

    anchor_idx = -1
    for idx, (_, text, _) in enumerate(models_with_text):
        if ("校准结果" in text) or ("Results of calibration" in text) or ("一般检查" in text):
            anchor_idx = idx
            break

    if anchor_idx >= 0:
        candidates = [model for model, _, _ in models_with_text[anchor_idx:]]
    else:
        candidates = [model for model, _, score in models_with_text if score > 0]

    if not candidates:
        return None
    if len(candidates) == 1:
        result = dict(candidates[0])
        result["embedded_tables"] = embedded_tables
        return result
    merged = _merge_docx_table_models(candidates)
    if merged:
        merged["embedded_tables"] = embedded_tables
        return merged
    return {"tables": candidates, "embedded_tables": embedded_tables}


def _merge_docx_table_models(models: list[dict[str, Any]]) -> dict[str, Any] | None:
    valid_models = [m for m in models if isinstance(m, dict) and isinstance(m.get("cells"), list)]
    if not valid_models:
        return None

    merged_cells: list[dict[str, Any]] = []
    row_offset = 0
    max_cols = 0
    for model in valid_models:
        rows = int(model.get("rows", 0) or 0)
        cols = int(model.get("cols", 0) or 0)
        cells = model.get("cells", []) if isinstance(model.get("cells", []), list) else []
        max_cols = max(max_cols, cols)
        for raw_cell in cells:
            if not isinstance(raw_cell, dict):
                continue
            cell = dict(raw_cell)
            cell["r"] = int(cell.get("r", 0) or 0) + row_offset
            merged_cells.append(cell)
        row_offset += rows

    if not merged_cells or row_offset <= 0 or max_cols <= 0:
        return None
    return {"rows": row_offset, "cols": max_cols, "cells": merged_cells}


def _build_docx_table_model(tbl: ET.Element, image_tokens: dict[str, str] | None = None) -> dict[str, Any] | None:
    cells: list[dict[str, Any]] = []
    active_vmerge: dict[int, dict[str, Any]] = {}
    occupied: dict[tuple[int, int], bool] = {}
    max_col = 0
    row_count = 0

    for row_idx, tr in enumerate(tbl.findall("./{*}tr")):
        row_count = max(row_count, row_idx + 1)
        col_idx = _get_docx_row_grid_before(tr)
        for tc in tr.findall("./{*}tc"):
            while occupied.get((row_idx, col_idx), False):
                col_idx += 1

            colspan = _get_docx_cell_grid_span(tc)
            text = _extract_docx_cell_text(tc, preserve_paragraphs=True, image_tokens=image_tokens)
            align = _get_docx_cell_align(tc)
            valign = _get_docx_cell_valign(tc)
            vmerge = _get_docx_cell_vmerge(tc)

            if vmerge == "continue":
                for offset in range(colspan):
                    slot = col_idx + offset
                    ref = active_vmerge.get(slot)
                    if ref:
                        ref["rowspan"] = int(ref.get("rowspan", 1)) + 1
                    occupied[(row_idx, slot)] = True
                col_idx += colspan
                max_col = max(max_col, col_idx)
                continue

            cell = {
                "r": row_idx,
                "c": col_idx,
                "rowspan": 1,
                "colspan": colspan,
                "text": str(text or ""),
                "align": align,
                "valign": valign,
            }
            cells.append(cell)
            for offset in range(colspan):
                slot = col_idx + offset
                occupied[(row_idx, slot)] = True
                if vmerge == "restart":
                    active_vmerge[slot] = cell
                else:
                    active_vmerge.pop(slot, None)
            col_idx += colspan
            max_col = max(max_col, col_idx)

    if not cells or row_count <= 0 or max_col <= 0:
        return None
    return {"rows": row_count, "cols": max_col, "cells": cells}


def _score_general_check_table(model: dict[str, Any]) -> int:
    cells = model.get("cells", []) if isinstance(model, dict) else []
    if not isinstance(cells, list) or not cells:
        return -1
    text = " ".join([str((cell or {}).get("text", "")) for cell in cells]).strip()
    if not text:
        return -1
    score = 0
    if "一般检查" in text:
        score += 5
    if "校准结果" in text or "Results of calibration" in text:
        score += 4
    if "标准值" in text and "实际值" in text:
        score += 4
    if "全检量程" in text or "非全检量程" in text:
        score += 3
    if "测温点" in text:
        score += 3
    if "注：" in text:
        score += 1
    return score


def _get_docx_cell_align(tc: ET.Element) -> str:
    jc = tc.find("./{*}p/{*}pPr/{*}jc")
    if jc is None:
        jc = tc.find("./{*}p[1]/{*}pPr/{*}jc")
    if jc is None:
        return "left"
    value = str(jc.attrib.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "")).strip().lower()
    if value in {"center", "both", "distribute"}:
        return "center"
    if value in {"right", "end"}:
        return "right"
    return "left"


def _get_docx_cell_valign(tc: ET.Element) -> str:
    v_align = tc.find("./{*}tcPr/{*}vAlign")
    if v_align is None:
        return "top"
    value = str(v_align.attrib.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "")).strip().lower()
    if value in {"center"}:
        return "middle"
    if value in {"bottom"}:
        return "bottom"
    return "top"


def _guess_docx_image_mime(path: str) -> str:
    suffix = Path(path).suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".bmp":
        return "image/bmp"
    if suffix == ".webp":
        return "image/webp"
    if suffix in {".tif", ".tiff"}:
        return "image/tiff"
    if suffix == ".gif":
        return "image/gif"
    if suffix == ".svg":
        return "image/svg+xml"
    return "image/png"


def _resolve_docx_rel_target(target: str) -> str:
    text = str(target or "").strip()
    if not text:
        return ""
    if text.startswith("/"):
        return text.lstrip("/")
    return posixpath.normpath(posixpath.join("word", text))


def _load_docx_inline_image_tokens_from_zip(zf: zipfile.ZipFile) -> dict[str, str]:
    try:
        rel_xml = zf.read(DOC_XML_RELS_PATH)
    except Exception:
        return {}
    try:
        rel_root = ET.fromstring(rel_xml)
    except Exception:
        return {}

    tokens: dict[str, str] = {}
    for rel in rel_root.findall(f".//{{{REL_NS}}}Relationship"):
        rel_type = str(rel.attrib.get("Type", "")).strip().lower()
        if not rel_type.endswith("/image"):
            continue
        rel_id = str(rel.attrib.get("Id", "")).strip()
        target = _resolve_docx_rel_target(str(rel.attrib.get("Target", "")))
        if not rel_id or not target:
            continue
        try:
            raw = zf.read(target)
        except Exception:
            continue
        if not raw:
            continue
        mime = _guess_docx_image_mime(target)
        encoded = base64.b64encode(raw).decode("ascii")
        tokens[rel_id] = f"[[DOCX_IMG|data:{mime};base64,{encoded}]]"
    return tokens


def _extract_docx_drawing_tokens(node: ET.Element, image_tokens: dict[str, str] | None = None) -> list[str]:
    token_map = image_tokens or {}
    result: list[str] = []
    seen: set[str] = set()
    for blip in node.findall(".//a:blip", DRAWING_NS):
        rel_id = str(blip.attrib.get(f"{{{R_NS}}}embed", "")).strip()
        if not rel_id or rel_id in seen:
            continue
        seen.add(rel_id)
        result.append(token_map.get(rel_id, "[图片]"))
    for imagedata in node.findall(".//v:imagedata", VML_NS):
        rel_id = str(imagedata.attrib.get(f"{{{R_NS}}}id", "")).strip()
        if not rel_id or rel_id in seen:
            continue
        seen.add(rel_id)
        result.append(token_map.get(rel_id, "[图片]"))
    return result


def _extract_docx_cell_text(
    tc: ET.Element,
    preserve_paragraphs: bool = False,
    image_tokens: dict[str, str] | None = None,
) -> str:
    drawings = _extract_docx_drawing_tokens(tc, image_tokens)
    if preserve_paragraphs:
        paragraphs: list[str] = []
        for p in tc.findall("./{*}p"):
            chunks = [(node.text or "") for node in p.findall(".//{*}t")]
            line = "".join(chunks).strip()
            if not line:
                p_drawings = _extract_docx_drawing_tokens(p, image_tokens)
                if p_drawings:
                    line = " ".join(p_drawings).strip()
            if line:
                paragraphs.append(line)
        if drawings:
            exists = set(paragraphs)
            for token in drawings:
                if token not in exists:
                    paragraphs.append(token)
        return "\n".join(paragraphs).strip()
    text = "".join([(node.text or "") for node in tc.findall(".//{*}t")])
    if drawings:
        text = " ".join([text, *drawings]).strip()
    return _normalize_catalog_value(text)


def _get_docx_cell_grid_span(tc: ET.Element) -> int:
    grid_span = tc.find("./{*}tcPr/{*}gridSpan")
    if grid_span is None:
        return 1
    try:
        span = int(grid_span.attrib.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "1"))
    except Exception:
        return 1
    return span if span > 0 else 1


def _get_docx_cell_vmerge(tc: ET.Element) -> str:
    vmerge = tc.find("./{*}tcPr/{*}vMerge")
    if vmerge is None:
        return ""
    return vmerge.attrib.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "continue") or "continue"


def _get_docx_row_grid_before(tr: ET.Element) -> int:
    grid_before = tr.find("./{*}trPr/{*}gridBefore")
    if grid_before is None:
        return 0
    try:
        value = int(grid_before.attrib.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "0"))
    except Exception:
        return 0
    return value if value > 0 else 0


def _extract_non_chart_linked_embedded_xlsx_table_models(zf: zipfile.ZipFile) -> list[dict[str, Any]]:
    try:
        names = [str(x or "") for x in zf.namelist()]
    except Exception:
        return []
    xlsx_paths = sorted([p for p in names if re.match(r"^word/embeddings/.*\.xlsx$", p, flags=re.IGNORECASE)])
    if not xlsx_paths:
        return []

    chart_linked: set[str] = set()
    rel_paths = [x for x in names if re.match(r"^word/charts/_rels/chart[0-9]+\.xml\.rels$", x)]
    for rel_path in rel_paths:
        try:
            rel_xml = zf.read(rel_path)
            rel_root = ET.fromstring(rel_xml)
        except Exception:
            continue
        for rel_node in rel_root.findall(f".//{{{REL_NS}}}Relationship"):
            target = str(rel_node.attrib.get("Target", "") or "").strip()
            if not target:
                continue
            if not re.search(r"embeddings/.*\.xlsx$", target, flags=re.IGNORECASE):
                continue
            if target.startswith("/"):
                resolved = target.lstrip("/")
            else:
                resolved = posixpath.normpath(posixpath.join("word/charts", target))
            chart_linked.add(resolved)

    non_chart_paths = [p for p in xlsx_paths if p not in chart_linked]
    if not non_chart_paths:
        return []

    models: list[dict[str, Any]] = []
    for path in non_chart_paths:
        try:
            raw = zf.read(path)
        except Exception:
            continue
        model = _parse_embedded_xlsx_model(raw)
        if model:
            models.append(model)
    return models


def _parse_embedded_xlsx_model(raw: bytes) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        with zipfile.ZipFile(io.BytesIO(raw), "r") as xz:
            names = [str(x or "") for x in xz.namelist()]
            shared_strings = _parse_xlsx_shared_strings(xz)
            sheet_path = ""
            for candidate in names:
                if re.match(r"^xl/worksheets/sheet1\.xml$", candidate, flags=re.IGNORECASE):
                    sheet_path = candidate
                    break
            if not sheet_path:
                for candidate in names:
                    if re.match(r"^xl/worksheets/sheet[0-9]+\.xml$", candidate, flags=re.IGNORECASE):
                        sheet_path = candidate
                        break
            if not sheet_path:
                return None
            sheet_root = ET.fromstring(xz.read(sheet_path))
    except Exception:
        return None

    cell_map: dict[tuple[int, int], str] = {}
    max_r = 0
    max_c = 0
    for c_node in sheet_root.findall(".//{*}c"):
        ref = str(c_node.attrib.get("r", "") or "").strip()
        parsed = _parse_xlsx_cell_ref(ref)
        if not parsed:
            continue
        r_idx, c_idx = parsed
        value = _read_xlsx_cell_value(c_node, shared_strings)
        cell_map[(r_idx, c_idx)] = value
        max_r = max(max_r, r_idx)
        max_c = max(max_c, c_idx)
    for row_node in sheet_root.findall(".//{*}row"):
        r_attr = int(str(row_node.attrib.get("r", "0") or "0") or 0)
        max_r = max(max_r, r_attr)

    if max_r <= 0 or max_c <= 0:
        return None
    max_r = min(max_r, 200)
    max_c = min(max_c, 20)

    merge_master: dict[tuple[int, int], tuple[int, int]] = {}
    merge_covered: set[tuple[int, int]] = set()
    for m_node in sheet_root.findall(".//{*}mergeCell"):
        ref = str(m_node.attrib.get("ref", "") or "").strip()
        parsed = _parse_xlsx_merge_ref(ref)
        if not parsed:
            continue
        r1, c1, r2, c2 = parsed
        if r1 > max_r or c1 > max_c:
            continue
        rr2 = min(r2, max_r)
        cc2 = min(c2, max_c)
        rowspan = max(1, rr2 - r1 + 1)
        colspan = max(1, cc2 - c1 + 1)
        merge_master[(r1, c1)] = (rowspan, colspan)
        for rr in range(r1, rr2 + 1):
            for cc in range(c1, cc2 + 1):
                if rr == r1 and cc == c1:
                    continue
                merge_covered.add((rr, cc))

    cells: list[dict[str, Any]] = []
    for rr in range(1, max_r + 1):
        for cc in range(1, max_c + 1):
            if (rr, cc) in merge_covered:
                continue
            text = str(cell_map.get((rr, cc), "") or "")
            span = merge_master.get((rr, cc), (1, 1))
            if not text and span == (1, 1):
                continue
            cells.append(
                {
                    "r": rr - 1,
                    "c": cc - 1,
                    "rowspan": int(span[0]),
                    "colspan": int(span[1]),
                    "text": text,
                    "align": "left",
                    "valign": "top",
                }
            )

    if not cells:
        return None
    return {"rows": max_r, "cols": max_c, "cells": cells}


def _parse_xlsx_shared_strings(xz: zipfile.ZipFile) -> list[str]:
    path = ""
    for candidate in xz.namelist():
        if re.match(r"^xl/sharedStrings\.xml$", str(candidate or ""), flags=re.IGNORECASE):
            path = str(candidate)
            break
    if not path:
        return []
    try:
        root = ET.fromstring(xz.read(path))
    except Exception:
        return []
    values: list[str] = []
    for si in root.findall(".//{*}si"):
        t_nodes = si.findall(".//{*}t")
        values.append("".join([(node.text or "") for node in t_nodes]).strip())
    return values


def _parse_xlsx_cell_ref(ref: str) -> tuple[int, int] | None:
    m = re.match(r"^([A-Za-z]+)(\d+)$", str(ref or "").strip())
    if not m:
        return None
    col_letters = m.group(1).upper()
    row_no = int(m.group(2) or 0)
    col_no = 0
    for ch in col_letters:
        col_no = col_no * 26 + (ord(ch) - 64)
    if row_no <= 0 or col_no <= 0:
        return None
    return (row_no, col_no)


def _parse_xlsx_merge_ref(ref: str) -> tuple[int, int, int, int] | None:
    parts = str(ref or "").split(":")
    if len(parts) != 2:
        return None
    a = _parse_xlsx_cell_ref(parts[0])
    b = _parse_xlsx_cell_ref(parts[1])
    if not a or not b:
        return None
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))


def _read_xlsx_cell_value(c_node: ET.Element, shared_strings: list[str]) -> str:
    cell_type = str(c_node.attrib.get("t", "") or "").strip().lower()
    if cell_type == "inlinestr":
        t_node = c_node.find(".//{*}t")
        return str((t_node.text if t_node is not None else "") or "").strip()
    v_node = c_node.find(".//{*}v")
    v_text = str((v_node.text if v_node is not None else "") or "").strip()
    if not v_text:
        return ""
    if cell_type == "s":
        try:
            idx = int(v_text)
        except Exception:
            return v_text
        if 0 <= idx < len(shared_strings):
            return str(shared_strings[idx] or "")
        return v_text
    return v_text
