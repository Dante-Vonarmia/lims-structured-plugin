import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from .docx_cell_utils import get_cell_text, normalize_space
from .docx_instrument_text_utils import (
    clean_item_name,
    first_meaningful_value,
    looks_like_label,
    normalize_catalog_token,
    pick_cell,
    sanitize_instrument_cell,
)

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"w": W_NS, "r": R_NS}
DOC_XML_PATH = "word/document.xml"
MAX_INSTRUMENT_ROWS = 5


def extract_docx_text(path: Path) -> str:
    tables = read_docx_tables(path)
    lines: list[str] = []
    for row in [row for table in tables for row in table]:
        joined = " | ".join([cell for cell in row if cell])
        if joined:
            lines.append(joined)
    return "\n".join(lines)


def read_docx_tables(path: Path) -> list[list[list[str]]]:
    with zipfile.ZipFile(path, "r") as zf:
        xml_data = zf.read(DOC_XML_PATH)
    root = ET.fromstring(xml_data)
    tables: list[list[list[str]]] = []
    for tbl in root.findall(".//w:tbl", NS):
        rows: list[list[str]] = []
        for tr in tbl.findall("./w:tr", NS):
            cells = tr.findall("./w:tc", NS)
            rows.append([get_cell_text(tc) for tc in cells])
        tables.append(rows)
    return tables


def extract_instrument_rows(
    tables: list[list[list[str]]],
    catalog_tokens: set[str] | None = None,
) -> list[dict[str, str]]:
    for rows in tables:
        header_idx = -1
        name_idx = -1
        model_idx = -1
        code_idx = -1
        range_idx = -1
        uncertainty_idx = -1
        cert_idx = -1
        valid_idx = -1
        trace_idx = -1
        for ri, row in enumerate(rows):
            for ci, cell in enumerate(row):
                if "器具名称" in cell:
                    name_idx = ci
                if "型号/规格" in cell:
                    model_idx = ci
                if cell.strip() == "编号" or "编号Number" in cell:
                    code_idx = ci
                if "测量范围" in cell or "Measurement range" in cell:
                    range_idx = ci
                if "不确定度" in cell or "最大允许误差" in cell or "Uncertainty" in cell:
                    uncertainty_idx = ci
                if "证书编号" in cell or "Certificate number" in cell:
                    cert_idx = ci
                if "有效期限" in cell:
                    valid_idx = ci
                if "溯源机构" in cell or "traceability institution" in cell:
                    trace_idx = ci
            if name_idx >= 0 and model_idx >= 0 and code_idx >= 0:
                header_idx = ri
                break
        if header_idx < 0:
            continue

        result: list[dict[str, str]] = []
        for row in rows[header_idx + 1 :]:
            name = pick_cell(row, name_idx)
            model = pick_cell(row, model_idx)
            code = pick_cell(row, code_idx)
            measurement_range = pick_cell(row, range_idx) if range_idx >= 0 else ""
            uncertainty = pick_cell(row, uncertainty_idx) if uncertainty_idx >= 0 else ""
            certificate_no = pick_cell(row, cert_idx) if cert_idx >= 0 else ""
            valid_raw = pick_cell(row, valid_idx) if valid_idx >= 0 else ""
            valid_date = extract_any_date(valid_raw)
            traceability_institution = pick_cell(row, trace_idx) if trace_idx >= 0 else ""

            if (
                not normalize_space(name)
                and not normalize_space(model)
                and not normalize_space(code)
            ):
                continue
            if normalize_space(name) in {"/", "／"} and normalize_space(model) in {"/", "／", ""}:
                continue
            if "以上计量标准器具" in name or "其它校准信息" in name:
                break
            cleaned_name = clean_item_name(name)
            cleaned_name = sanitize_instrument_cell(cleaned_name)
            cleaned_model = sanitize_instrument_cell(model)
            cleaned_code = sanitize_instrument_cell(code)
            if not cleaned_name:
                continue
            if catalog_tokens and normalize_catalog_token(cleaned_name) not in catalog_tokens:
                continue
            result.append(
                {
                    "name": cleaned_name,
                    "model": cleaned_model,
                    "code": cleaned_code,
                    "measurement_range": sanitize_instrument_cell(measurement_range),
                    "uncertainty": sanitize_instrument_cell(uncertainty),
                    "certificate_no": sanitize_instrument_cell(certificate_no),
                    "valid_date": sanitize_instrument_cell(valid_date),
                    "traceability_institution": sanitize_instrument_cell(traceability_institution),
                }
            )
        if result:
            return result[:MAX_INSTRUMENT_ROWS]
    return []


def extract_value_from_tables(
    tables: list[list[list[str]]],
    labels: tuple[str, ...],
) -> str:
    for rows in tables:
        for row_idx, row in enumerate(rows):
            for ci, cell in enumerate(row):
                if not any(label in cell for label in labels):
                    continue
                row_candidate = first_meaningful_value(row[ci + 1 :])
                if row_candidate:
                    return row_candidate

                for next_idx in range(row_idx + 1, min(row_idx + 4, len(rows))):
                    next_row = rows[next_idx]
                    for col in (ci, ci + 1):
                        if col >= len(next_row):
                            continue
                        candidate_value = normalize_space(next_row[col])
                        if candidate_value and not looks_like_label(candidate_value):
                            return candidate_value
    return ""


def extract_value_by_regex(
    text: str,
    patterns: tuple[str, ...],
    flags: int = re.IGNORECASE,
) -> str:
    if not text:
        return ""
    for pattern in patterns:
        match = re.search(pattern, text, flags=flags)
        if not match:
            continue
        value = normalize_space(match.group(1))
        if value:
            return value
    return ""


def extract_date_from_text(text: str, label: str) -> str:
    if not text:
        return ""
    pattern = rf"{re.escape(label)}[^0-9]*(\d{{4}})\D+(\d{{1,2}})\D+(\d{{1,2}})"
    match = re.search(pattern, text)
    if not match:
        return ""
    year = match.group(1)
    month = match.group(2).zfill(2)
    day = match.group(3).zfill(2)
    return f"{year}年{month}月{day}日"


def extract_any_date(text: str) -> str:
    text = normalize_space(text)
    if not text:
        return ""
    patterns = (
        r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日",
        r"(\d{4})[./-](\d{1,2})[./-](\d{1,2})",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        year = match.group(1)
        month = match.group(2).zfill(2)
        day = match.group(3).zfill(2)
        return f"{year}年{month}月{day}日"
    return ""
