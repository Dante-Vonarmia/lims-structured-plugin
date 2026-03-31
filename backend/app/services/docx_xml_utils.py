import io
import re
from xml.etree import ElementTree as ET

from .docx_cell_utils import find_cell_index_contains, get_cell_text, normalize_space, set_cell_text

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"w": W_NS, "r": R_NS}


def _is_page_placeholder_text(value: str) -> bool:
    compact = re.sub(r"\s+", "", value or "")
    if "第页/共页" in compact:
        return True
    if "第" in compact and "共" in compact and "页" in compact:
        return True
    return False


def _append_text_run(paragraph: ET.Element, value: str) -> None:
    run = ET.SubElement(paragraph, f"{{{W_NS}}}r")
    text = ET.SubElement(run, f"{{{W_NS}}}t")
    if value.startswith(" ") or value.endswith(" "):
        text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    text.text = value


def _clear_paragraph_runs(paragraph: ET.Element) -> None:
    for child in list(paragraph):
        if child.tag == f"{{{W_NS}}}pPr":
            continue
        paragraph.remove(child)


def _set_paragraph_text(paragraph: ET.Element, value: str) -> None:
    _clear_paragraph_runs(paragraph)
    _append_text_run(paragraph, value)


def set_cell_page_fields(tc: ET.Element, current: int = 1, total: int = 1) -> None:
    paragraphs = tc.findall("./w:p", NS)
    if paragraphs:
        paragraph = paragraphs[0]
    else:
        paragraph = ET.SubElement(tc, f"{{{W_NS}}}p")

    _set_paragraph_text(paragraph, f"第 {current} 页/共 {total} 页")

    for extra in paragraphs[1:]:
        tc.remove(extra)


def _fill_value_between_markers(
    cells: list[ET.Element],
    start_marker: str,
    end_marker: str,
    value: str,
) -> None:
    if not value:
        return
    start_idx = find_cell_index_contains(cells, start_marker)
    if start_idx < 0:
        return

    end_idx = find_cell_index_contains(cells, end_marker)
    if end_idx <= start_idx:
        end_idx = len(cells)

    for idx in range(start_idx + 1, end_idx):
        current = get_cell_text(cells[idx])
        if current:
            continue
        set_cell_text(cells[idx], value)
        return


def _capture_namespaces(xml_data: bytes) -> list[tuple[str, str]]:
    namespaces: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for _, (prefix, uri) in ET.iterparse(io.BytesIO(xml_data), events=("start-ns",)):
        normalized_prefix = prefix or ""
        normalized_uri = uri or ""
        key = (normalized_prefix, normalized_uri)
        if key in seen:
            continue
        seen.add(key)
        namespaces.append(key)
    return namespaces


def _preserve_original_namespaces(root: ET.Element, namespaces: list[tuple[str, str]]) -> None:
    used_namespace_uris: set[str] = set()
    for element in root.iter():
        if isinstance(element.tag, str) and element.tag.startswith("{"):
            used_namespace_uris.add(element.tag[1:].split("}", 1)[0])
        for attr_key in element.attrib.keys():
            if isinstance(attr_key, str) and attr_key.startswith("{"):
                used_namespace_uris.add(attr_key[1:].split("}", 1)[0])

    for prefix, uri in namespaces:
        if not uri or prefix == "xml":
            continue
        try:
            ET.register_namespace(prefix, uri)
        except Exception:
            pass
        if uri in used_namespace_uris:
            continue
        if prefix:
            key = f"xmlns:{prefix}"
            if key not in root.attrib:
                root.set(key, uri)
        else:
            if "xmlns" not in root.attrib:
                root.set("xmlns", uri)


def _fill_page_number_placeholders_in_root(root: ET.Element) -> None:
    targets: list[tuple[str, ET.Element]] = []
    body = root.find("./w:body", NS)
    if body is None:
        return

    def walk(node: ET.Element, inside_tc: bool = False) -> None:
        tag = node.tag
        if tag == f"{{{W_NS}}}tc":
            text = normalize_space(get_cell_text(node))
            if _is_page_placeholder_text(text):
                targets.append(("tc", node))
            return
        if tag == f"{{{W_NS}}}p" and not inside_tc:
            text = normalize_space("".join([(t.text or "") for t in node.findall(".//w:t", NS)]))
            if _is_page_placeholder_text(text):
                targets.append(("p", node))
        for child in list(node):
            walk(child, inside_tc or tag == f"{{{W_NS}}}tc")

    walk(body, inside_tc=False)
    if not targets:
        return

    total = len(targets)
    for idx, (kind, node) in enumerate(targets, start=1):
        if kind == "tc":
            set_cell_page_fields(node, idx, total)
        else:
            _set_paragraph_text(node, f"第 {idx} 页/共 {total} 页")
