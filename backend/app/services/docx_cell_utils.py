import re
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"w": W_NS, "r": R_NS}


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\u3000", " ")).strip()


def get_cell_text(tc: ET.Element) -> str:
    texts = [(node.text or "") for node in tc.findall(".//w:t", NS)]
    return normalize_space("".join(texts))


def set_cell_text(tc: ET.Element, value: str) -> None:
    text_nodes = tc.findall(".//w:t", NS)
    if text_nodes:
        text_nodes[0].text = value
        for node in text_nodes[1:]:
            node.text = ""
        return

    paragraph = tc.find("./w:p", NS)
    if paragraph is None:
        paragraph = ET.SubElement(tc, f"{{{W_NS}}}p")
    run = paragraph.find("./w:r", NS)
    if run is None:
        run = ET.SubElement(paragraph, f"{{{W_NS}}}r")
    text = run.find("./w:t", NS)
    if text is None:
        text = ET.SubElement(run, f"{{{W_NS}}}t")
    text.text = value


def split_date_parts(date_text: str) -> tuple[str, str, str] | None:
    digits = re.findall(r"\d+", str(date_text or ""))
    if len(digits) < 3:
        return None
    year = str(digits[0] or "").strip()
    month = str(digits[1] or "").strip().zfill(2)
    day = str(digits[2] or "").strip().zfill(2)
    if not year or not month or not day:
        return None
    return year, month, day


def find_cell_index_with_text(cells: list[ET.Element], indices: range, marker: str) -> int:
    compact_marker = re.sub(r"\s+", "", str(marker or ""))
    for idx in indices:
        compact_text = re.sub(r"\s+", "", str(get_cell_text(cells[idx]) or ""))
        if compact_marker and compact_marker in compact_text:
            return idx
    return -1


def contains_compact_label(text: str, label: str) -> bool:
    compact_text = re.sub(r"\s+", "", str(text or ""))
    compact_label = re.sub(r"\s+", "", str(label or ""))
    return bool(compact_label and compact_label in compact_text)


def find_cell_index_contains(cells: list[ET.Element], marker: str) -> int:
    for idx, cell in enumerate(cells):
        if marker in get_cell_text(cell):
            return idx
    return -1
