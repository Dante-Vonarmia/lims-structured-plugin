import posixpath
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

DOC_RELS_PATH = "word/_rels/document.xml.rels"
CONTENT_TYPES_PATH = "[Content_Types].xml"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"


def _copy_docx_image_dependencies_for_table(
    template_path: Path,
    source_file_path: Path,
    table_element: ET.Element,
) -> dict[str, bytes]:
    return _copy_docx_image_dependencies_for_tables(
        template_path=template_path,
        source_file_path=source_file_path,
        table_elements=[table_element],
    )


def _copy_docx_image_dependencies_for_tables(
    template_path: Path,
    source_file_path: Path,
    table_elements: list[ET.Element],
) -> dict[str, bytes]:
    return _copy_docx_image_dependencies_for_nodes(
        template_path=template_path,
        source_file_path=source_file_path,
        nodes=table_elements,
    )


def _copy_docx_image_dependencies_for_nodes(
    template_path: Path,
    source_file_path: Path,
    nodes: list[ET.Element],
) -> dict[str, bytes]:
    updates: dict[str, bytes] = {}
    embed_ids = _collect_embed_relationship_ids_from_nodes(nodes)
    if not embed_ids:
        return updates
    try:
        with zipfile.ZipFile(template_path, "r") as zf:
            template_rels_xml = zf.read(DOC_RELS_PATH) if DOC_RELS_PATH in zf.namelist() else None
            template_ct_xml = zf.read(CONTENT_TYPES_PATH) if CONTENT_TYPES_PATH in zf.namelist() else None
            template_media_names = {name for name in zf.namelist() if name.startswith("word/media/")}
    except Exception:
        return updates
    try:
        with zipfile.ZipFile(source_file_path, "r") as zf:
            source_rels_xml = zf.read(DOC_RELS_PATH) if DOC_RELS_PATH in zf.namelist() else None
            source_names = set(zf.namelist())
            source_reader = zf
            if source_rels_xml is None:
                return updates
            source_rels_root = ET.fromstring(source_rels_xml)
            source_rel_map: dict[str, tuple[str, str, str]] = {}
            for rel in source_rels_root.findall(f".//{{{REL_NS}}}Relationship"):
                rel_id = str(rel.attrib.get("Id", "")).strip()
                if not rel_id:
                    continue
                source_rel_map[rel_id] = (
                    str(rel.attrib.get("Type", "")).strip(),
                    str(rel.attrib.get("Target", "")).strip(),
                    str(rel.attrib.get("TargetMode", "")).strip(),
                )

            if template_rels_xml:
                target_rels_root = ET.fromstring(template_rels_xml)
            else:
                target_rels_root = ET.Element(f"{{{REL_NS}}}Relationships")
            existing_rids = {str(rel.attrib.get("Id", "")).strip() for rel in target_rels_root.findall(f".//{{{REL_NS}}}Relationship")}
            existing_targets = {str(rel.attrib.get("Target", "")).strip() for rel in target_rels_root.findall(f".//{{{REL_NS}}}Relationship")}

            rid_mapping: dict[str, str] = {}
            added_exts: set[str] = set()
            copied_non_image_overrides: set[str] = set()
            copied_non_image_defaults: set[str] = set()

            for old_rid in sorted(embed_ids):
                rel_info = source_rel_map.get(old_rid)
                if not rel_info:
                    continue
                rel_type, rel_target, rel_mode = rel_info
                if rel_mode.lower() == "external":
                    continue
                source_path = _resolve_docx_rel_target_path(rel_target)
                if not source_path or source_path not in source_names:
                    continue
                try:
                    raw = source_reader.read(source_path)
                except Exception:
                    continue
                if not raw:
                    continue
                new_rid = _next_available_rid(existing_rids)
                existing_rids.add(new_rid)
                rel_target_path = ""

                if rel_type.lower().endswith("/image"):
                    ext = Path(source_path).suffix.lower() or ".png"
                    media_zip_path = _next_available_media_path(template_media_names, ext)
                    template_media_names.add(media_zip_path)
                    rel_target_path = posixpath.relpath(media_zip_path, "word")
                    updates[media_zip_path] = raw
                    if ext:
                        added_exts.add(ext.lstrip(".").lower())
                else:
                    # Keep the original target path for non-image parts (chart/embeddings/ole)
                    # so internal sidecar rel paths remain valid.
                    rel_target_path = rel_target
                    normalized_path = _resolve_docx_rel_target_path(rel_target_path)
                    if normalized_path:
                        updates[normalized_path] = raw
                        ext = Path(normalized_path).suffix.lower().lstrip(".")
                        if ext:
                            copied_non_image_defaults.add(ext)
                        if normalized_path.startswith("word/charts/") and normalized_path.endswith(".xml"):
                            copied_non_image_overrides.add("/" + normalized_path)
                            chart_rels_path = f"word/charts/_rels/{Path(normalized_path).name}.rels"
                            if chart_rels_path in source_names:
                                try:
                                    chart_rels_xml = source_reader.read(chart_rels_path)
                                    updates[chart_rels_path] = chart_rels_xml
                                    chart_rels_root = ET.fromstring(chart_rels_xml)
                                except Exception:
                                    chart_rels_root = None
                                if chart_rels_root is not None:
                                    for c_rel in chart_rels_root.findall(f".//{{{REL_NS}}}Relationship"):
                                        c_target = str(c_rel.attrib.get("Target", "")).strip()
                                        c_mode = str(c_rel.attrib.get("TargetMode", "")).strip().lower()
                                        if not c_target or c_mode == "external":
                                            continue
                                        c_abs = _resolve_docx_rel_target_path(posixpath.join("charts", c_target))
                                        if not c_abs or c_abs not in source_names:
                                            continue
                                        try:
                                            updates[c_abs] = source_reader.read(c_abs)
                                        except Exception:
                                            continue
                                        c_ext = Path(c_abs).suffix.lower().lstrip(".")
                                        if c_ext:
                                            copied_non_image_defaults.add(c_ext)

                existing_targets.add(rel_target_path)
                new_rel = ET.Element(f"{{{REL_NS}}}Relationship")
                new_rel.set("Id", new_rid)
                new_rel.set("Type", rel_type)
                new_rel.set("Target", rel_target_path)
                target_rels_root.append(new_rel)
                rid_mapping[old_rid] = new_rid

            if rid_mapping:
                _remap_embed_rids_in_nodes(nodes, rid_mapping)
                updates["__rels__"] = ET.tostring(target_rels_root, encoding="utf-8", xml_declaration=True)
                if template_ct_xml is not None:
                    updated_ct = _ensure_content_types_for_image_exts(template_ct_xml, added_exts)
                    updated_ct = _ensure_content_types_for_non_image_parts(
                        updated_ct,
                        defaults=copied_non_image_defaults,
                        chart_overrides=copied_non_image_overrides,
                    )
                    updates["__ct__"] = updated_ct
    except Exception:
        return {}
    return updates


def _collect_embed_relationship_ids(node: ET.Element) -> set[str]:
    return _collect_embed_relationship_ids_from_nodes([node])


def _collect_embed_relationship_ids_from_nodes(nodes: list[ET.Element]) -> set[str]:
    result: set[str] = set()
    keys = (
        f"{{{R_NS}}}embed",
        f"{{{R_NS}}}link",
        f"{{{R_NS}}}id",
    )
    for node in nodes:
        for elem in node.iter():
            for key in keys:
                value = str(elem.attrib.get(key, "")).strip()
                if value:
                    result.add(value)
    return result


def _resolve_docx_rel_target_path(target: str) -> str:
    value = str(target or "").strip()
    if not value:
        return ""
    if value.startswith("/"):
        return value.lstrip("/")
    return posixpath.normpath(posixpath.join("word", value))


def _next_available_rid(existing: set[str]) -> str:
    idx = 1
    while True:
        rid = f"rId{idx}"
        if rid not in existing:
            return rid
        idx += 1


def _next_available_media_path(existing_media_paths: set[str], ext: str) -> str:
    idx = 1
    while True:
        path = f"word/media/copied-general-check-{idx}{ext}"
        if path not in existing_media_paths:
            return path
        idx += 1


def _remap_table_embed_rids(table_element: ET.Element, mapping: dict[str, str]) -> None:
    _remap_embed_rids_in_nodes([table_element], mapping)


def _remap_embed_rids_in_nodes(nodes: list[ET.Element], mapping: dict[str, str]) -> None:
    if not mapping:
        return
    keys = (
        f"{{{R_NS}}}embed",
        f"{{{R_NS}}}link",
        f"{{{R_NS}}}id",
    )
    for node in nodes:
        for elem in node.iter():
            for key in keys:
                old = str(elem.attrib.get(key, "")).strip()
                if old and old in mapping:
                    elem.set(key, mapping[old])


def _ensure_content_types_for_image_exts(content_types_xml: bytes, exts: set[str]) -> bytes:
    if not exts:
        return content_types_xml
    try:
        root = ET.fromstring(content_types_xml)
    except Exception:
        return content_types_xml
    defaults = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "bmp": "image/bmp",
        "gif": "image/gif",
        "tif": "image/tiff",
        "tiff": "image/tiff",
        "webp": "image/webp",
        "svg": "image/svg+xml",
    }
    existing = {str(x.attrib.get("Extension", "")).strip().lower() for x in root.findall(f".//{{{CT_NS}}}Default")}
    for ext in sorted(exts):
        if not ext or ext in existing:
            continue
        content_type = defaults.get(ext)
        if not content_type:
            continue
        node = ET.Element(f"{{{CT_NS}}}Default")
        node.set("Extension", ext)
        node.set("ContentType", content_type)
        root.append(node)
        existing.add(ext)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _ensure_content_types_for_non_image_parts(
    content_types_xml: bytes,
    defaults: set[str],
    chart_overrides: set[str],
) -> bytes:
    if not defaults and not chart_overrides:
        return content_types_xml
    try:
        root = ET.fromstring(content_types_xml)
    except Exception:
        return content_types_xml

    default_types = {
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "bin": "application/vnd.openxmlformats-officedocument.oleObject",
        "rels": "application/vnd.openxmlformats-package.relationships+xml",
        "xml": "application/xml",
    }
    existing_defaults = {str(x.attrib.get("Extension", "")).strip().lower() for x in root.findall(f".//{{{CT_NS}}}Default")}
    for ext in sorted(defaults):
        if not ext or ext in existing_defaults:
            continue
        ctype = default_types.get(ext)
        if not ctype:
            continue
        node = ET.Element(f"{{{CT_NS}}}Default")
        node.set("Extension", ext)
        node.set("ContentType", ctype)
        root.append(node)
        existing_defaults.add(ext)

    existing_overrides = {str(x.attrib.get("PartName", "")).strip() for x in root.findall(f".//{{{CT_NS}}}Override")}
    for part_name in sorted(chart_overrides):
        if not part_name or part_name in existing_overrides:
            continue
        node = ET.Element(f"{{{CT_NS}}}Override")
        node.set("PartName", part_name)
        node.set("ContentType", "application/vnd.openxmlformats-officedocument.drawingml.chart+xml")
        root.append(node)
        existing_overrides.add(part_name)

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)
