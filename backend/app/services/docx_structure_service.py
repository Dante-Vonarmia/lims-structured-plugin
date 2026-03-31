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
    except Exception:
        return None
    try:
        root = ET.fromstring(xml_bytes)
    except Exception:
        return None

    candidates: list[dict[str, Any]] = []
    for tbl in root.findall(".//{*}tbl"):
        model = _build_docx_table_model(tbl, image_tokens)
        if not model:
            continue
        score = _score_general_check_table(model)
        if score <= 0:
            continue
        candidates.append(model)
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    return _merge_docx_table_models(candidates)


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

