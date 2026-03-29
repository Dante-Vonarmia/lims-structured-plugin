import io
import json
import posixpath
import re
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from .fixed_template_rule_engine import (
    fill_base_fields_in_cells_by_rules,
    fill_base_fields_in_paragraphs_by_rules,
    fill_base_fields_in_tables_by_rules,
    find_cell_index_contains_any,
    find_generic_record_table_by_rules,
)
from .r872_result_rules import fill_r872_requirement_text, should_mark_r872_result
from .result_check_matcher import extract_source_general_check_lines, match_best_source_line
from .semantic_fill_lib import (
    build_semantic_value_maps_from_general_check_text,
    detect_semantic_key_value_columns,
    extract_uncertainty_u_value,
    normalize_multiline_text_preserve_tabs,
    normalize_semantic_key,
    replace_uncertainty_u_placeholder,
)

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
NS = {"w": W_NS, "r": R_NS}
DOC_XML_PATH = "word/document.xml"
DOC_RELS_PATH = "word/_rels/document.xml.rels"
CONTENT_TYPES_PATH = "[Content_Types].xml"
MAX_INSTRUMENT_ROWS = 5
_PLACEHOLDER_VALUES = {"", "-", "--", "—", "/", "／"}


def fill_r801b_docx(
    template_path: Path,
    output_path: Path,
    context: dict[str, str],
    source_file_path: Path | None,
) -> bool:
    if not template_path.exists():
        return False

    payload = build_r801b_payload(context=context, source_file_path=source_file_path)
    if not payload:
        return False

    with zipfile.ZipFile(template_path, "r") as zin:
        original_xml = zin.read(DOC_XML_PATH)
        original_namespaces = _capture_namespaces(original_xml)
        root = ET.fromstring(original_xml)

    tables = root.findall(".//w:tbl", NS)
    if not tables:
        return False

    info_table = _find_info_table(tables)
    if info_table is not None:
        _fill_info_table(info_table, payload)

    record_table = _find_record_table(tables)
    if record_table is not None:
        _fill_record_table(record_table, payload)
    _fill_page_number_placeholders_in_root(root)

    _preserve_original_namespaces(root, original_namespaces)
    updated_xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(template_path, "r") as zin, zipfile.ZipFile(output_path, "w") as zout:
        for item in zin.infolist():
            if item.filename == DOC_XML_PATH:
                zout.writestr(item, updated_xml)
            else:
                zout.writestr(item, zin.read(item.filename))
    return True


def fill_r803b_docx(
    template_path: Path,
    output_path: Path,
    context: dict[str, str],
    source_file_path: Path | None,
) -> bool:
    if not template_path.exists():
        return False

    payload = build_r803b_payload(context=context, source_file_path=source_file_path)
    if not payload:
        return False

    with zipfile.ZipFile(template_path, "r") as zin:
        original_xml = zin.read(DOC_XML_PATH)
        original_namespaces = _capture_namespaces(original_xml)
        root = ET.fromstring(original_xml)

    tables = root.findall(".//w:tbl", NS)
    if not tables:
        return False

    record_table = _find_r803b_record_table(tables)
    if record_table is None:
        return False

    _fill_r803b_record_table(record_table, payload)
    _fill_r803b_result_checks(record_table)
    _fill_page_number_placeholders_in_root(root)

    _preserve_original_namespaces(root, original_namespaces)
    updated_xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(template_path, "r") as zin, zipfile.ZipFile(output_path, "w") as zout:
        for item in zin.infolist():
            if item.filename == DOC_XML_PATH:
                zout.writestr(item, updated_xml)
            else:
                zout.writestr(item, zin.read(item.filename))
    return True


def fill_r802b_docx(
    template_path: Path,
    output_path: Path,
    context: dict[str, str],
    source_file_path: Path | None,
) -> bool:
    if not template_path.exists():
        return False

    payload = build_r802b_payload(context=context, source_file_path=source_file_path)
    if not payload:
        return False

    with zipfile.ZipFile(template_path, "r") as zin:
        original_xml = zin.read(DOC_XML_PATH)
        original_namespaces = _capture_namespaces(original_xml)
        root = ET.fromstring(original_xml)

    tables = root.findall(".//w:tbl", NS)
    if not tables:
        return False

    record_table = _find_r802b_record_table(tables)
    if record_table is not None:
        _fill_r802b_record_table(record_table, payload)
    _fill_page_number_placeholders_in_root(root)
    copied_general_check_table, copied_table = _copy_r802b_general_check_table_from_source(root, source_file_path)
    rel_updates: dict[str, bytes] = {}
    if copied_general_check_table and copied_table is not None and source_file_path is not None:
        rel_updates = _copy_docx_image_dependencies_for_table(
            template_path=template_path,
            source_file_path=source_file_path,
            table_element=copied_table,
        )
    if not copied_general_check_table:
        _append_r802b_general_check_text_only(root, payload)

    _preserve_original_namespaces(root, original_namespaces)
    updated_xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(template_path, "r") as zin, zipfile.ZipFile(output_path, "w") as zout:
        updated_rels_xml = rel_updates.get("__rels__")
        updated_ct_xml = rel_updates.get("__ct__")
        existing_names = {x.filename for x in zin.infolist()}
        for item in zin.infolist():
            if item.filename == DOC_XML_PATH:
                zout.writestr(item, updated_xml)
            elif item.filename == DOC_RELS_PATH and updated_rels_xml is not None:
                zout.writestr(item, updated_rels_xml)
            elif item.filename == CONTENT_TYPES_PATH and updated_ct_xml is not None:
                zout.writestr(item, updated_ct_xml)
            else:
                zout.writestr(item, zin.read(item.filename))
        if updated_rels_xml is not None and DOC_RELS_PATH not in existing_names:
            zout.writestr(DOC_RELS_PATH, updated_rels_xml)
        if updated_ct_xml is not None and CONTENT_TYPES_PATH not in existing_names:
            zout.writestr(CONTENT_TYPES_PATH, updated_ct_xml)
        for path, raw in rel_updates.items():
            if path.startswith("__"):
                continue
            zout.writestr(path, raw)
    return True


def fill_r825b_docx(
    template_path: Path,
    output_path: Path,
    context: dict[str, str],
    source_file_path: Path | None,
) -> bool:
    if not template_path.exists():
        return False

    payload = build_r825b_payload(context=context, source_file_path=source_file_path)
    if not payload:
        return False

    with zipfile.ZipFile(template_path, "r") as zin:
        original_xml = zin.read(DOC_XML_PATH)
        original_namespaces = _capture_namespaces(original_xml)
        root = ET.fromstring(original_xml)

    tables = root.findall(".//w:tbl", NS)
    if not tables:
        return False

    record_table = _find_r825b_record_table(tables)
    if record_table is None:
        return False

    _fill_r825b_record_table(record_table, payload)
    _fill_page_number_placeholders_in_root(root)

    _preserve_original_namespaces(root, original_namespaces)
    updated_xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(template_path, "r") as zin, zipfile.ZipFile(output_path, "w") as zout:
        for item in zin.infolist():
            if item.filename == DOC_XML_PATH:
                zout.writestr(item, updated_xml)
            else:
                zout.writestr(item, zin.read(item.filename))
    return True


def fill_generic_record_docx(
    template_path: Path,
    output_path: Path,
    context: dict[str, str],
    source_file_path: Path | None,
) -> bool:
    if not template_path.exists():
        return False

    payload = build_r825b_payload(context=context, source_file_path=source_file_path)
    if not payload:
        return False
    detail_general_check = normalize_multiline_text_preserve_tabs(context.get("general_check_full", ""), normalize_space=normalize_space) or normalize_multiline_text(
        context.get("general_check", "")
    )
    if not detail_general_check:
        raw_text = normalize_multiline_text(context.get("raw_record", ""))
        detail_general_check = _extract_text_block(
            raw_text,
            start_patterns=(r"(?:一[、.．)]\s*)?一般检查", r"General inspection"),
            end_patterns=(r"^\s*(?:二|2)[、.．)]", r"备注", r"结果", r"检测员", r"校准员", r"核验员"),
        )
    if detail_general_check:
        payload["detail_general_check"] = detail_general_check
    payload["__template_name"] = template_path.name

    with zipfile.ZipFile(template_path, "r") as zin:
        original_xml = zin.read(DOC_XML_PATH)
        original_namespaces = _capture_namespaces(original_xml)
        root = ET.fromstring(original_xml)

    tables = root.findall(".//w:tbl", NS)
    changed = False
    if tables:
        record_table = _find_generic_record_table(tables)
        if record_table is not None:
            _fill_r825b_record_table(record_table, payload)
            changed = True
        else:
            changed = _fill_generic_base_labels_in_tables(tables, payload)
        changed = _fill_generic_semantic_value_matrices_from_payload(tables, payload) or changed
        changed = _fill_generic_uncertainty_u_from_payload(root, tables, payload) or changed
    if extract_source_general_check_lines(str(payload.get("detail_general_check", ""))):
        changed = _fill_generic_result_checks_by_semantics(tables, payload) or changed
    elif _should_auto_fill_result_checks(template_path=template_path, payload=payload):
        changed = _fill_generic_result_checks_in_tables(tables) or changed
    _fill_page_number_placeholders_in_root(root)
    changed = _fill_generic_base_labels_in_paragraphs(root, payload) or changed

    _preserve_original_namespaces(root, original_namespaces)
    updated_xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(template_path, "r") as zin, zipfile.ZipFile(output_path, "w") as zout:
        for item in zin.infolist():
            if item.filename == DOC_XML_PATH:
                zout.writestr(item, updated_xml)
            else:
                zout.writestr(item, zin.read(item.filename))
    return True


def build_r801b_payload(
    context: dict[str, str],
    source_file_path: Path | None,
) -> dict[str, Any]:
    raw_text = context.get("raw_record", "") or ""
    tables: list[list[list[str]]] = []
    if source_file_path and source_file_path.exists() and source_file_path.suffix.lower() == ".docx":
        tables = read_docx_tables(source_file_path)
        if not raw_text:
            raw_text = extract_docx_text(source_file_path)

    text_block = raw_text or _tables_to_text_block(tables)
    instrument_catalog_rows = parse_instrument_catalog_rows_json(context.get("instrument_catalog_rows_json", ""))
    instrument_catalog_tokens = parse_instrument_catalog_tokens(context.get("instrument_catalog_names", ""))
    if not instrument_catalog_tokens and instrument_catalog_rows:
        instrument_catalog_tokens = {normalize_catalog_token(row.get("name", "")) for row in instrument_catalog_rows}
        instrument_catalog_tokens = {token for token in instrument_catalog_tokens if token}
    instrument_rows = extract_instrument_rows(tables, instrument_catalog_tokens)
    if instrument_rows and instrument_catalog_rows:
        instrument_rows = merge_instrument_rows_with_catalog(instrument_rows, instrument_catalog_rows)

    certificate_no = sanitize_context_value(context.get("certificate_no", "")) or extract_value_from_tables(
        tables,
        labels=("缆专检号", "Certificate series number"),
    ) or extract_value_by_regex(
        text_block,
        patterns=(
            r"缆专检号[:：]?\s*([A-Za-z0-9\-]+)",
            r"Certificate\s*series\s*number[:：]?\s*([A-Za-z0-9\-]+)",
        ),
    )
    client_name = sanitize_context_value(context.get("client_name", "")) or extract_value_from_tables(
        tables,
        labels=("委托单位", "Client"),
    ) or extract_value_by_regex(
        text_block,
        patterns=(r"委托单位[:：]?\s*([^\n|]+)",),
    )
    receive_date = sanitize_context_date(context.get("receive_date", "")) or extract_date_from_text(
        text_block,
        "收样日期",
    )
    calibration_date = sanitize_context_date(context.get("calibration_date", "")) or extract_date_from_text(
        text_block,
        "校准日期",
    )
    publish_date = sanitize_context_date(context.get("publish_date", "")) or extract_date_from_text(
        text_block,
        "发布日期",
    )
    receive_date, calibration_date, publish_date = _resolve_report_dates(
        receive_date=receive_date,
        calibration_date=calibration_date,
        publish_date=publish_date,
    )

    if not instrument_rows:
        if instrument_catalog_rows:
            fallback_token = normalize_catalog_token(context.get("device_name", ""))
            if fallback_token:
                matched = next(
                    (row for row in instrument_catalog_rows if normalize_catalog_token(row.get("name", "")) == fallback_token),
                    None,
                )
                if matched:
                    instrument_rows = [dict(matched)]
        if not instrument_rows:
            fallback_name = sanitize_instrument_cell(context.get("device_name", ""))
            fallback_model = sanitize_instrument_cell(context.get("device_model", ""))
            fallback_code = sanitize_instrument_cell(context.get("device_code", ""))
            fallback_token = normalize_catalog_token(fallback_name)
            if instrument_catalog_tokens and fallback_token and fallback_token not in instrument_catalog_tokens:
                fallback_name = ""
            if fallback_name or fallback_model or fallback_code:
                instrument_rows = [
                    {
                        "name": fallback_name,
                        "model": fallback_model,
                        "code": fallback_code,
                        "measurement_range": "",
                        "uncertainty": "",
                        "certificate_no": "",
                        "valid_date": "",
                        "traceability_institution": "",
                    }
                ]
    instrument_rows = instrument_rows[:MAX_INSTRUMENT_ROWS]

    payload = {
        "certificate_no": normalize_space(certificate_no),
        "client_name": normalize_space(client_name),
        "receive_date": receive_date,
        "calibration_date": calibration_date,
        "publish_date": publish_date,
        "manufacturer": sanitize_context_value(context.get("manufacturer", "")),
        "instrument_rows": instrument_rows,
    }
    has_value = any(
        [
            payload["certificate_no"],
            payload["client_name"],
            payload["receive_date"],
            payload["calibration_date"],
            payload["publish_date"],
            payload["manufacturer"],
            payload["instrument_rows"],
        ]
    )
    if not has_value:
        return {}
    return payload


def build_r803b_payload(
    context: dict[str, str],
    source_file_path: Path | None,
) -> dict[str, Any]:
    raw_text = context.get("raw_record", "") or ""
    tables: list[list[list[str]]] = []
    if source_file_path and source_file_path.exists() and source_file_path.suffix.lower() == ".docx":
        tables = read_docx_tables(source_file_path)
        if not raw_text:
            raw_text = extract_docx_text(source_file_path)

    text_block = raw_text or _tables_to_text_block(tables)
    instrument_rows = extract_instrument_rows(tables)
    first_instrument = instrument_rows[0] if instrument_rows else {}

    device_name = sanitize_context_value(context.get("device_name", "")) or extract_value_from_tables(
        tables,
        labels=("器具名称", "设备名称", "仪器名称", "Instrument name"),
    ) or extract_value_by_regex(
        text_block,
        patterns=(r"(?:器具名称|设备名称|仪器名称)[:：]?\s*([^\n|]+)",),
    )
    manufacturer = sanitize_context_value(context.get("manufacturer", "")) or extract_value_from_tables(
        tables,
        labels=("制造厂/商", "制造商", "生产厂商", "厂商", "Manufacturer"),
    ) or extract_value_by_regex(
        text_block,
        patterns=(r"(?:制造厂/商|制造商|生产厂商|厂商|厂家)[:：]?\s*([^\n|]+)",),
    )
    device_model = sanitize_context_value(context.get("device_model", "")) or extract_value_from_tables(
        tables,
        labels=("型号/规格", "型号规格", "型号", "规格型号", "Model/Specification"),
    ) or extract_value_by_regex(
        text_block,
        patterns=(r"(?:型号/规格|型号规格|规格型号|型号)[:：]?\s*([^\n|]+)",),
    )
    device_code = sanitize_context_value(context.get("device_code", "")) or extract_value_from_tables(
        tables,
        labels=("器具编号", "设备编号", "仪器编号", "出厂编号", "Instrument serial number"),
    ) or extract_value_by_regex(
        text_block,
        patterns=(r"(?:器具编号|设备编号|仪器编号|出厂编号)[:：]?\s*([^\n|]+)",),
    )

    model_code_combined = extract_value_from_tables(
        tables,
        labels=("型号/编号", "型号编号", "型号/器具编号", "Model/Number"),
    ) or extract_value_by_regex(
        text_block,
        patterns=(r"(?:型号/编号|型号编号|型号/器具编号|Model/Number)[:：]?\s*([^\n|]+)",),
    )
    combo_model, combo_code = _split_model_code_combined(model_code_combined)
    if not device_model:
        device_model = combo_model
    if not device_code:
        device_code = combo_code
    if (
        combo_model
        and combo_code
        and normalize_space(device_model) == normalize_space(model_code_combined)
    ):
        device_model = combo_model
        if not device_code:
            device_code = combo_code

    if device_model and not device_code:
        inferred_model, inferred_code = _split_model_code_combined(device_model)
        if inferred_code:
            device_model = inferred_model
            device_code = inferred_code

    if device_code and not device_model:
        inferred_model, inferred_code = _split_model_code_combined(device_code)
        if inferred_model:
            device_model = inferred_model
            device_code = inferred_code

    if normalize_catalog_token(device_name) in {"", "name", "instrumentname", "devicename"}:
        device_name = ""
    if normalize_catalog_token(device_model) in {"", "model", "modelspecification", "modelnumber", "number"}:
        device_model = ""
    if normalize_catalog_token(device_code) in {"", "code", "number", "serialnumber"}:
        device_code = ""
    if (not device_name or _looks_like_label(device_name)) and first_instrument.get("name"):
        device_name = first_instrument.get("name", "")
    if (not device_model or _looks_like_label(device_model)) and first_instrument.get("model"):
        device_model = first_instrument.get("model", "")
    if (not device_code or _looks_like_label(device_code)) and first_instrument.get("code"):
        device_code = first_instrument.get("code", "")
    device_name = sanitize_context_value(device_name)
    manufacturer = sanitize_context_value(manufacturer)
    device_model = sanitize_context_value(device_model)
    device_code = sanitize_context_value(device_code)

    certificate_no = sanitize_context_value(context.get("certificate_no", "")) or extract_value_from_tables(
        tables,
        labels=("缆专检号", "证书编号", "证书号", "Certificate series number"),
    ) or extract_value_by_regex(
        text_block,
        patterns=(
            r"缆专检号[:：]?\s*([A-Za-z0-9\-]+)",
            r"证书(?:编号|号)[:：]?\s*([A-Za-z0-9\-]+)",
            r"Certificate\s*series\s*number[:：]?\s*([A-Za-z0-9\-]+)",
        ),
    )

    address = sanitize_context_value(context.get("address", "")) or extract_value_by_regex(
        text_block,
        patterns=(r"地址[:：]?\s*([^\n|]+)",),
    )
    location = sanitize_context_value(context.get("location", "")) or _extract_location_from_other_calibration_info(
        text_block,
    ) or extract_value_from_tables(
        tables,
        labels=("校准地点", "检测地点", "地点", "Location"),
    ) or extract_value_by_regex(
        text_block,
        patterns=(r"(?:校准地点|检测地点|地点)[:：]?\s*([^\n|]+?)(?:Location|$)",),
    ) or address
    location = _sanitize_location_text(location)
    temperature = normalize_space(context.get("temperature", "")) or _extract_temperature_from_other_calibration_info(
        text_block,
    ) or extract_value_from_tables(
        tables,
        labels=("温度", "Temperature"),
    ) or extract_value_by_regex(
        text_block,
        patterns=(r"温度[:：]?\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*(?:℃|°C|C)?",),
    )
    humidity = normalize_space(context.get("humidity", "")) or _extract_humidity_from_other_calibration_info(
        text_block,
    ) or extract_value_from_tables(
        tables,
        labels=("湿度", "Humidity"),
    ) or extract_value_by_regex(
        text_block,
        patterns=(r"湿度[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*%?\s*(?:RH|rh)?",),
    )

    section2_u = normalize_space(context.get("section2_u_mm", "")) or _extract_section_uncertainty(
        text_block,
        "中间铁块直径",
        "mm",
    )
    section2_value = normalize_space(context.get("section2_value_mm", "")) or _extract_section_measured_value(
        text_block,
        "中间铁块直径",
        "mm",
    )
    section3_u = normalize_space(context.get("section3_u_g", "")) or _extract_section_uncertainty(
        text_block,
        "中间铁块质量",
        "g",
    )
    section3_value = normalize_space(context.get("section3_value_g", "")) or _extract_section_measured_value(
        text_block,
        "中间铁块质量",
        "g",
    )
    section4_u = normalize_space(context.get("section4_u_g", "")) or _extract_section_uncertainty(
        text_block,
        "铁锤质量",
        "g",
    )

    basis_items_from_context = _extract_standard_codes_from_context_items(context.get("basis_standard_items", ""))
    basis_standard = sanitize_context_value(context.get("basis_standard", "")) or sanitize_context_value(
        context.get("calibration_basis", ""),
    ) or extract_value_by_regex(
        text_block,
        patterns=(
            r"([A-Za-z]{1,5}\s*/\s*T\s*\d+(?:\.\d+)?-\d{4}[^\n|]*)",
            r"本次校准所依据的技术规范(?:[（(]代号、名称[）)])?[:：]?\s*([^\n|]+)",
            r"(?:检测|校准)依据[:：]?\s*([^\n|]+)",
        ),
    )
    basis_codes = basis_items_from_context or _extract_standard_codes(basis_standard)
    if basis_codes:
        basis_standard = "、".join(basis_codes)
    basis_mode = _normalize_basis_mode(context.get("basis_mode", ""))
    if not basis_mode:
        basis_mode = _infer_basis_mode(text_block)

    hammer_actual_rows = extract_hammer_actual_rows(tables)
    if not hammer_actual_rows:
        hammer_actual_rows = extract_hammer_actual_rows_from_text(text_block)
    context_hammer_rows = extract_hammer_actual_rows_from_context(context)
    if context_hammer_rows:
        hammer_actual_rows = merge_hammer_actual_rows(hammer_actual_rows, context_hammer_rows)

    payload = {
        "device_name": normalize_space(device_name),
        "manufacturer": normalize_space(manufacturer),
        "device_model": normalize_space(device_model),
        "device_code": normalize_space(device_code),
        "certificate_no": normalize_space(certificate_no),
        "basis_standard": normalize_space(basis_standard),
        "basis_mode": basis_mode,
        "location": normalize_space(location),
        "temperature": normalize_space(temperature),
        "humidity": normalize_space(humidity),
        "section2_u_mm": normalize_space(section2_u),
        "section2_value_mm": normalize_space(section2_value),
        "section3_u_g": normalize_space(section3_u),
        "section3_value_g": normalize_space(section3_value),
        "section4_u_g": normalize_space(section4_u),
        "hammer_actual_rows": hammer_actual_rows,
    }
    has_value = any(
        [
            payload["device_name"],
            payload["manufacturer"],
            payload["device_model"],
            payload["device_code"],
            payload["certificate_no"],
            payload["basis_standard"],
            payload["basis_mode"],
            payload["location"],
            payload["temperature"],
            payload["humidity"],
            payload["section2_u_mm"],
            payload["section2_value_mm"],
            payload["section3_u_g"],
            payload["section3_value_g"],
            payload["section4_u_g"],
            payload["hammer_actual_rows"],
        ]
    )
    if not has_value:
        return {}
    return payload


def build_r825b_payload(
    context: dict[str, str],
    source_file_path: Path | None,
) -> dict[str, Any]:
    payload = build_r803b_payload(context=context, source_file_path=source_file_path)
    if not payload:
        return {}
    return {
        "device_name": normalize_space(payload.get("device_name", "")),
        "manufacturer": normalize_space(payload.get("manufacturer", "")),
        "device_model": normalize_space(payload.get("device_model", "")),
        "device_code": normalize_space(payload.get("device_code", "")),
        "certificate_no": normalize_space(payload.get("certificate_no", "")),
        "basis_standard": normalize_space(payload.get("basis_standard", "")),
        "basis_mode": normalize_space(payload.get("basis_mode", "")),
        "location": normalize_space(payload.get("location", "")),
        "temperature": normalize_space(payload.get("temperature", "")),
        "humidity": normalize_space(payload.get("humidity", "")),
    }


def build_r802b_payload(
    context: dict[str, str],
    source_file_path: Path | None,
) -> dict[str, Any]:
    base_payload = build_r825b_payload(context=context, source_file_path=source_file_path)
    raw_text = context.get("raw_record", "") or ""
    if not raw_text and source_file_path and source_file_path.exists() and source_file_path.suffix.lower() == ".docx":
        raw_text = extract_docx_text(source_file_path)

    detail_instruments = _extract_text_block(
        raw_text,
        start_patterns=(r"本次校准所使用的主要计量标准器具", r"主要计量标准器具", r"Main measurement standard instruments"),
        end_patterns=(r"本次校准所依据的技术规范", r"(?:其它|其他)校准信息", r"一般检查", r"备注"),
    )
    detail_basis = _extract_basis_detail_text(raw_text)
    detail_calibration_info = _extract_text_block(
        raw_text,
        start_patterns=(r"(?:其它|其他)校准信息", r"Calibration Information"),
        end_patterns=(r"一般检查", r"备注", r"结果", r"检测员", r"校准员", r"核验员"),
    )
    detail_general_check = normalize_multiline_text_preserve_tabs(context.get("general_check_full", ""), normalize_space=normalize_space) or normalize_multiline_text(context.get("general_check", "")) or _extract_text_block(
        raw_text,
        start_patterns=(r"(?:一[、.．)]\s*)?一般检查", r"General inspection"),
        end_patterns=(r"^\s*(?:二|2)[、.．)]", r"备注", r"结果", r"检测员", r"校准员", r"核验员"),
    )

    payload = {
        **base_payload,
        "detail_instruments": detail_instruments,
        "detail_basis": detail_basis,
        "detail_calibration_info": detail_calibration_info,
        "detail_general_check": detail_general_check,
    }
    if any(payload.values()):
        return payload
    return {}


def normalize_multiline_text(value: str) -> str:
    if not value:
        return ""
    lines: list[str] = []
    for line in str(value).splitlines():
        normalized_line = normalize_space(line)
        if normalized_line:
            lines.append(normalized_line)
    return "\n".join(lines)


def _extract_text_block(
    text: str,
    start_patterns: tuple[str, ...],
    end_patterns: tuple[str, ...],
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
    return normalize_multiline_text("\n".join(lines[start_idx:end_idx]))


def _extract_basis_detail_text(text: str) -> str:
    basis_text = _extract_text_block(
        text,
        start_patterns=(
            r"本次校准所依据的技术规范",
            r"本次校准所依据的技术规范[（(]代号、名称[）)]",
            r"Reference documents for the calibration",
            r"(?:检测|校准)依据",
        ),
        end_patterns=(
            r"(?:其它|其他)校准信息",
            r"Calibration Information",
            r"(?:一[、.．)]\s*)?一般检查",
            r"General inspection",
            r"备注",
            r"结果",
            r"检测员",
            r"校准员",
            r"核验员",
        ),
    )
    if not basis_text:
        return ""
    basis_codes = _extract_standard_codes(basis_text)
    if basis_codes:
        return "\n".join(basis_codes)
    return basis_text


def _find_r802b_record_table(tables: list[ET.Element]) -> ET.Element | None:
    for tbl in tables:
        row_text = " ".join([get_cell_text(tc) for tc in tbl.findall("./w:tr/w:tc", NS)])
        if "原 始 记 录" in row_text and "校准依据" in row_text and "器具编号" in row_text:
            return tbl
    return None


def _fill_r802b_record_table(tbl: ET.Element, payload: dict[str, Any]) -> None:
    rows = tbl.findall("./w:tr", NS)
    if not rows:
        return

    basis_mode = _normalize_basis_mode(payload.get("basis_mode", ""))
    for tr in rows:
        cells = tr.findall("./w:tc", NS)
        if not cells:
            continue

        if payload.get("certificate_no"):
            serial_idx = _find_cell_index_contains(cells, "序")
            if serial_idx >= 0 and "号" in get_cell_text(cells[serial_idx]):
                set_cell_text(cells[serial_idx], f"序 号：{payload['certificate_no']}")

        if payload.get("basis_standard") or basis_mode:
            basis_idx = _find_cell_index_contains(cells, "校准依据")
            if basis_idx >= 0:
                current = get_cell_text(cells[basis_idx])
                basis_text = normalize_space(payload.get("basis_standard", "")) or _extract_basis_from_cell(current)
                set_cell_text(cells[basis_idx], f"{_format_dual_mode_checkbox(basis_mode)}依据：{basis_text}")

        if payload.get("device_name"):
            name_idx = _find_cell_index_contains(cells, "器具名称")
            if name_idx >= 0:
                set_cell_text(cells[name_idx], f"器具名称：{payload['device_name']}")

        if payload.get("manufacturer"):
            manufacturer_idx = _find_cell_index_contains(cells, "制造厂/商")
            if manufacturer_idx >= 0:
                set_cell_text(cells[manufacturer_idx], f"制造厂/商：{payload['manufacturer']}")

        if payload.get("device_model"):
            model_idx = _find_cell_index_contains(cells, "型号/规格")
            if model_idx >= 0:
                set_cell_text(cells[model_idx], f"型号/规格：{payload['device_model']}")

        if payload.get("device_code"):
            code_idx = _find_cell_index_contains(cells, "器具编号")
            if code_idx >= 0:
                set_cell_text(cells[code_idx], f"器具编号：{payload['device_code']}")

        location_idx = _find_cell_index_contains(cells, "校准地点")
        if location_idx >= 0 and (basis_mode or payload.get("location")):
            set_cell_text(
                cells[location_idx],
                f"{_format_dual_mode_checkbox(basis_mode)}地点：{payload.get('location', '')}",
            )

        if payload.get("temperature"):
            _fill_value_between_markers(
                cells=cells,
                start_marker="温度",
                end_marker="℃",
                value=payload["temperature"],
            )

        if payload.get("humidity"):
            _fill_value_between_markers(
                cells=cells,
                start_marker="湿度",
                end_marker="%RH",
                value=payload["humidity"],
            )


def _append_r802b_detail_blocks(
    root: ET.Element,
    payload: dict[str, Any],
    include_general_check: bool = True,
) -> None:
    body = root.find("./w:body", NS)
    if body is None:
        return

    sections: list[tuple[str, str]] = [
        ("本次校准所使用的主要计量标准器具：", normalize_multiline_text(payload.get("detail_instruments", ""))),
        ("本次校准所依据的技术规范（代号、名称）：", normalize_multiline_text(payload.get("detail_basis", ""))),
        ("其它校准信息：", normalize_multiline_text(payload.get("detail_calibration_info", ""))),
    ]
    if include_general_check:
        sections.append(("一般检查：", normalize_multiline_text(payload.get("detail_general_check", ""))))

    section_lines: list[str] = []
    for title, value in sections:
        if not value:
            continue
        if section_lines:
            section_lines.append("")
        if _has_r802b_section_heading(value, title):
            section_lines.extend(value.splitlines())
            continue
        section_lines.append(title)
        section_lines.extend(value.splitlines())
    if not section_lines:
        return

    insert_index = _find_r802b_insert_index(body)
    for line in section_lines:
        paragraph = ET.Element(f"{{{W_NS}}}p")
        if line:
            run = ET.SubElement(paragraph, f"{{{W_NS}}}r")
            text = ET.SubElement(run, f"{{{W_NS}}}t")
            text.text = line
        body.insert(insert_index, paragraph)
        insert_index += 1


def _copy_r802b_general_check_table_from_source(
    target_root: ET.Element,
    source_file_path: Path | None,
) -> tuple[bool, ET.Element | None]:
    if source_file_path is None or not source_file_path.exists() or source_file_path.suffix.lower() != ".docx":
        return False, None
    try:
        with zipfile.ZipFile(source_file_path, "r") as zf:
            source_xml = zf.read(DOC_XML_PATH)
        source_root = ET.fromstring(source_xml)
    except Exception:
        return False, None

    source_table = _find_general_check_table_element(source_root)
    if source_table is None:
        return False, None

    body = target_root.find("./w:body", NS)
    if body is None:
        return False, None

    insert_index = _find_r802b_general_check_insert_index(body)
    cloned_table = ET.fromstring(ET.tostring(source_table, encoding="utf-8"))
    _sanitize_general_check_table_rows(cloned_table)
    body.insert(insert_index, cloned_table)
    return True, cloned_table


def _copy_docx_image_dependencies_for_table(
    template_path: Path,
    source_file_path: Path,
    table_element: ET.Element,
) -> dict[str, bytes]:
    updates: dict[str, bytes] = {}
    embed_ids = _collect_embed_relationship_ids(table_element)
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

            for old_rid in sorted(embed_ids):
                rel_info = source_rel_map.get(old_rid)
                if not rel_info:
                    continue
                rel_type, rel_target, rel_mode = rel_info
                if not rel_type.lower().endswith("/image"):
                    continue
                if rel_mode.lower() == "external":
                    continue
                source_media_path = _resolve_docx_rel_target_path(rel_target)
                if not source_media_path or source_media_path not in source_names:
                    continue
                try:
                    raw = source_reader.read(source_media_path)
                except Exception:
                    continue
                if not raw:
                    continue
                ext = Path(source_media_path).suffix.lower() or ".png"
                media_zip_path = _next_available_media_path(template_media_names, ext)
                template_media_names.add(media_zip_path)
                rel_target_path = posixpath.relpath(media_zip_path, "word")

                new_rid = _next_available_rid(existing_rids)
                existing_rids.add(new_rid)
                existing_targets.add(rel_target_path)
                new_rel = ET.Element(f"{{{REL_NS}}}Relationship")
                new_rel.set("Id", new_rid)
                new_rel.set("Type", rel_type)
                new_rel.set("Target", rel_target_path)
                target_rels_root.append(new_rel)
                rid_mapping[old_rid] = new_rid
                updates[media_zip_path] = raw
                if ext:
                    added_exts.add(ext.lstrip(".").lower())

            if rid_mapping:
                _remap_table_embed_rids(table_element, rid_mapping)
                updates["__rels__"] = ET.tostring(target_rels_root, encoding="utf-8", xml_declaration=True)
                if template_ct_xml is not None:
                    updated_ct = _ensure_content_types_for_image_exts(template_ct_xml, added_exts)
                    updates["__ct__"] = updated_ct
    except Exception:
        return {}
    return updates


def _collect_embed_relationship_ids(node: ET.Element) -> set[str]:
    result: set[str] = set()
    keys = (
        f"{{{R_NS}}}embed",
        f"{{{R_NS}}}link",
        f"{{{R_NS}}}id",
    )
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
    if not mapping:
        return
    keys = (
        f"{{{R_NS}}}embed",
        f"{{{R_NS}}}link",
        f"{{{R_NS}}}id",
    )
    for elem in table_element.iter():
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


def _find_general_check_table_element(root: ET.Element) -> ET.Element | None:
    candidates: list[tuple[int, ET.Element]] = []
    for tbl in root.findall(".//w:tbl", NS):
        text = normalize_space(" ".join([(node.text or "") for node in tbl.findall(".//w:t", NS)]))
        if not text:
            continue
        if not re.search(r"一般检查|General inspection", text, flags=re.IGNORECASE):
            continue
        if not re.search(r"显示值|实测值|试验温度校准|注[:：]|\(\s*1\s*\)|（\s*1\s*）", text):
            continue

        score = 0
        if re.search(r"校准结果\s*/\s*说明|Results of calibration and additional explanation", text, flags=re.IGNORECASE):
            score -= 100
        if re.search(r"本次校准所使用的主要计量标准器具|本次校准所依据的技术规范|(?:其它|其他)校准信息", text):
            score -= 100
        score += len(tbl.findall(".//w:tr", NS))
        candidates.append((score, tbl))

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def _sanitize_general_check_table_rows(tbl: ET.Element) -> None:
    rows = list(tbl.findall("./w:tr", NS))
    if not rows:
        return

    start_index = -1
    for idx, row in enumerate(rows):
        text = normalize_space(" ".join([(node.text or "") for node in row.findall(".//w:t", NS)]))
        if re.search(r"一般检查|General inspection", text, flags=re.IGNORECASE):
            start_index = idx
            break

    keep_until = len(rows)
    for idx, row in enumerate(rows):
        text = normalize_space(" ".join([(node.text or "") for node in row.findall(".//w:t", NS)]))
        if re.search(r"(?:^|[\s：:])注(?:\s*[:：]|\b)|Remarks", text, flags=re.IGNORECASE):
            keep_until = idx
            break

    for idx, row in enumerate(rows):
        text = normalize_space(" ".join([(node.text or "") for node in row.findall(".//w:t", NS)]))
        remove = False
        if start_index >= 0 and idx < start_index:
            remove = True
        if idx >= keep_until:
            remove = True
        if re.search(r"校准结果\s*/\s*说明|Results of calibration and additional explanation", text, flags=re.IGNORECASE):
            remove = True
        if re.search(r"本次校准所使用的主要计量标准器具|本次校准所依据的技术规范|(?:其它|其他)校准信息", text):
            remove = True
        if remove:
            tbl.remove(row)


def _append_r802b_general_check_text_only(root: ET.Element, payload: dict[str, Any]) -> None:
    body = root.find("./w:body", NS)
    if body is None:
        return
    value = normalize_multiline_text(payload.get("detail_general_check", ""))
    if not value:
        return

    filtered_lines: list[str] = []
    for line in value.splitlines():
        compact = normalize_space(line)
        if not compact:
            continue
        if re.search(r"校准结果\s*/\s*说明|Results of calibration and additional explanation", compact, flags=re.IGNORECASE):
            continue
        filtered_lines.append(compact)
    if not filtered_lines:
        return

    insert_index = _find_r802b_general_check_insert_index(body)
    for line in filtered_lines:
        paragraph = ET.Element(f"{{{W_NS}}}p")
        run = ET.SubElement(paragraph, f"{{{W_NS}}}r")
        text = ET.SubElement(run, f"{{{W_NS}}}t")
        text.text = line
        body.insert(insert_index, paragraph)
        insert_index += 1


def _find_r802b_general_check_insert_index(body: ET.Element) -> int:
    children = list(body)
    for idx, child in enumerate(children):
        if child.tag != f"{{{W_NS}}}tbl":
            continue
        text = "".join([(node.text or "") for node in child.findall(".//w:t", NS)])
        if "器具编号" in text and "型号/规格" in text:
            return idx + 1
    return _find_r802b_insert_index(body)


def _find_r802b_insert_index(body: ET.Element) -> int:
    children = list(body)
    for idx, child in enumerate(children):
        if child.tag != f"{{{W_NS}}}tbl":
            continue
        text = "".join([(node.text or "") for node in child.findall(".//w:t", NS)])
        if "检测员" in text and "核验员" in text and "页/共" in text:
            return idx

    for idx, child in enumerate(children):
        if child.tag == f"{{{W_NS}}}sectPr":
            return idx
    return len(children)


def _has_r802b_section_heading(value: str, title: str) -> bool:
    text = normalize_multiline_text(value)
    if not text:
        return False
    if title in text:
        return True
    if "一般检查" in title and re.search(r"(?:^|\n)(?:一[、.．)]\s*)?一般检查[:：]?", text):
        return True
    if "其它校准信息" in title and re.search(r"(?:^|\n)(?:其它|其他)校准信息[:：]?", text):
        return True
    if "技术规范" in title and re.search(r"(?:^|\n)本次校准所依据的技术规范", text):
        return True
    if "主要计量标准器具" in title and re.search(r"(?:^|\n)本次校准所使用的主要计量标准器具", text):
        return True
    return False


def build_r803b_editor_fields(
    context: dict[str, str],
    source_file_path: Path | None,
) -> dict[str, str]:
    payload: dict[str, Any] = {}
    # Editor prefill should prefer source-doc parsing so incomplete OCR/extract
    # values (for example truncated manufacturer) do not override full values.
    if source_file_path and source_file_path.exists() and source_file_path.suffix.lower() == ".docx":
        payload = build_r803b_payload(context={}, source_file_path=source_file_path)
    if not payload:
        payload = build_r803b_payload(
            context={"raw_record": context.get("raw_record", "")},
            source_file_path=source_file_path,
        )
    if not payload:
        payload = build_r803b_payload(context=context, source_file_path=source_file_path)
    if not payload:
        return {}

    rows: list[list[str]] = payload.get("hammer_actual_rows", []) or []
    return {
        "device_name": normalize_space(payload.get("device_name", "")),
        "manufacturer": normalize_space(payload.get("manufacturer", "")),
        "device_model": normalize_space(payload.get("device_model", "")),
        "device_code": normalize_space(payload.get("device_code", "")),
        "certificate_no": normalize_space(payload.get("certificate_no", "")),
        "basis_standard": normalize_space(payload.get("basis_standard", "")),
        "basis_mode": normalize_space(payload.get("basis_mode", "")),
        "location": normalize_space(payload.get("location", "")),
        "temperature": normalize_space(payload.get("temperature", "")),
        "humidity": normalize_space(payload.get("humidity", "")),
        "section2_u_mm": normalize_space(payload.get("section2_u_mm", "")),
        "section2_value_mm": normalize_space(payload.get("section2_value_mm", "")),
        "section3_u_g": normalize_space(payload.get("section3_u_g", "")),
        "section3_value_g": normalize_space(payload.get("section3_value_g", "")),
        "section4_u_g": normalize_space(payload.get("section4_u_g", "")),
        "hammer_actual_row_1": " ".join(rows[0]) if len(rows) > 0 else "",
        "hammer_actual_row_2": " ".join(rows[1]) if len(rows) > 1 else "",
        "hammer_actual_row_3": " ".join(rows[2]) if len(rows) > 2 else "",
    }


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
            name = _pick_cell(row, name_idx)
            model = _pick_cell(row, model_idx)
            code = _pick_cell(row, code_idx)
            measurement_range = _pick_cell(row, range_idx) if range_idx >= 0 else ""
            uncertainty = _pick_cell(row, uncertainty_idx) if uncertainty_idx >= 0 else ""
            certificate_no = _pick_cell(row, cert_idx) if cert_idx >= 0 else ""
            valid_raw = _pick_cell(row, valid_idx) if valid_idx >= 0 else ""
            valid_date = extract_any_date(valid_raw)
            traceability_institution = _pick_cell(row, trace_idx) if trace_idx >= 0 else ""

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
                row_candidate = _first_meaningful_value(row[ci + 1 :])
                if row_candidate:
                    return row_candidate

                for next_idx in range(row_idx + 1, min(row_idx + 4, len(rows))):
                    next_row = rows[next_idx]
                    for col in (ci, ci + 1):
                        if col >= len(next_row):
                            continue
                        candidate_value = normalize_space(next_row[col])
                        if candidate_value and not _looks_like_label(candidate_value):
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


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\u3000", " ")).strip()


def _find_info_table(tables: list[ET.Element]) -> ET.Element | None:
    for tbl in tables:
        if _table_contains(tbl, "缆专检号") and _table_contains(tbl, "委托单位"):
            return tbl
    return None


def _find_record_table(tables: list[ET.Element]) -> ET.Element | None:
    for tbl in tables:
        row_text = " ".join([get_cell_text(tc) for tc in tbl.findall("./w:tr/w:tc", NS)])
        if "器具名称" in row_text and "型号/规格" in row_text and "编号" in row_text:
            return tbl
    return None


def _table_contains(tbl: ET.Element, keyword: str) -> bool:
    return keyword in "".join([(node.text or "") for node in tbl.findall(".//w:t", NS)])


def _fill_info_table(tbl: ET.Element, payload: dict[str, Any]) -> None:
    certificate_no = payload.get("certificate_no", "")
    client_name = payload.get("client_name", "")
    receive_date = payload.get("receive_date", "")
    calibration_date = payload.get("calibration_date", "")
    publish_date = payload.get("publish_date", "")

    for tr in tbl.findall("./w:tr", NS):
        cells = tr.findall("./w:tc", NS)
        if not cells:
            continue
        cell_texts = [get_cell_text(cell) for cell in cells]
        if certificate_no:
            for idx, text in enumerate(cell_texts):
                if "缆专检号" in text:
                    set_cell_text(cells[idx], f"缆专检号：{certificate_no}")
        if client_name:
            for idx, text in enumerate(cell_texts):
                if "委托单位" in text:
                    set_cell_text(cells[idx], f"委托单位：{client_name}")
        if any("收样日期" in text for text in cell_texts):
            _fill_split_date(cells, "收样日期", receive_date)
        if any("检测/校准日期" in text for text in cell_texts):
            _fill_split_date(cells, "检测/校准日期", calibration_date)
        if any("校准日期" in text for text in cell_texts):
            _fill_split_date(cells, "校准日期", calibration_date)
        if any("发布日期" in text for text in cell_texts):
            _fill_split_date(cells, "发布日期", publish_date)


def _fill_split_date(cells: list[ET.Element], label: str, date_text: str) -> None:
    if not date_text:
        return
    date_parts = split_date_parts(date_text)
    if not date_parts:
        return
    year, month, day = date_parts

    label_idx = -1
    for idx, cell in enumerate(cells):
        if label in get_cell_text(cell):
            label_idx = idx
            break
    if label_idx < 0:
        return

    range_indices = range(label_idx + 1, len(cells))
    year_marker = _find_cell_index_with_text(cells, range_indices, "年")
    month_marker = _find_cell_index_with_text(cells, range_indices, "月")
    day_marker = _find_cell_index_with_text(cells, range_indices, "日")
    if year_marker > 0:
        set_cell_text(cells[year_marker - 1], year)
    if month_marker > 0:
        set_cell_text(cells[month_marker - 1], month)
    if day_marker > 0:
        set_cell_text(cells[day_marker - 1], day)


def _find_cell_index_with_text(
    cells: list[ET.Element],
    indices: range,
    marker: str,
) -> int:
    for idx in indices:
        if get_cell_text(cells[idx]) == marker:
            return idx
    return -1


def split_date_parts(date_text: str) -> tuple[str, str, str] | None:
    match = re.search(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})", date_text)
    if not match:
        return None
    return match.group(1), match.group(2).zfill(2), match.group(3).zfill(2)


def _fill_record_table(tbl: ET.Element, payload: dict[str, Any]) -> None:
    rows = tbl.findall("./w:tr", NS)
    if len(rows) < 2:
        return

    data_rows: list[tuple[ET.Element, list[ET.Element]]] = []
    for tr in rows[1:]:
        cells = tr.findall("./w:tc", NS)
        if len(cells) < 7:
            break
        first_text = get_cell_text(cells[0])
        if first_text.startswith("注："):
            break
        data_rows.append((tr, cells))

    if not data_rows:
        return

    instrument_rows = payload.get("instrument_rows", []) or []
    normalized_instrument_rows = [
        {
            "name": sanitize_instrument_cell(item.get("name", "")),
            "model": sanitize_instrument_cell(item.get("model", "")),
            "code": sanitize_instrument_cell(item.get("code", "")),
            "measurement_range": sanitize_instrument_cell(item.get("measurement_range", "")),
            "uncertainty": sanitize_instrument_cell(item.get("uncertainty", "")),
            "certificate_no": sanitize_instrument_cell(item.get("certificate_no", "")),
            "valid_date": sanitize_instrument_cell(item.get("valid_date", "")),
            "traceability_institution": sanitize_instrument_cell(item.get("traceability_institution", "")),
        }
        for item in instrument_rows
    ]
    normalized_instrument_rows = [item for item in normalized_instrument_rows if item["name"]][:MAX_INSTRUMENT_ROWS]

    header_cells = rows[0].findall("./w:tc", NS)
    index_name = _find_cell_index_contains_any(header_cells, ("器具名称", "Instrument name"))
    index_model = _find_cell_index_contains_any(header_cells, ("型号/规格", "Model/Specification"))
    index_code = _find_cell_index_contains_any(header_cells, ("编号", "Number"))
    index_range = _find_cell_index_contains_any(header_cells, ("测量范围", "Measurement range"))
    index_uncertainty = _find_cell_index_contains_any(header_cells, ("不确定度", "最大允许误差", "Uncertainty"))
    index_cert_valid = _find_cell_index_contains_any(header_cells, ("证书编号", "有效期限", "Certificate number", "Valid date"))
    index_trace = _find_cell_index_contains_any(header_cells, ("溯源机构", "traceability institution"))
    if index_name < 0:
        index_name = 0
    if index_model < 0:
        index_model = 1
    if index_code < 0:
        index_code = 2

    for idx, (tr, cells) in enumerate(data_rows):
        if idx >= len(normalized_instrument_rows):
            tbl.remove(tr)
            continue
        item = normalized_instrument_rows[idx]
        for cell in cells:
            set_cell_text(cell, "")
        if index_name < len(cells):
            set_cell_text(cells[index_name], f"□{item['name']}")
        if index_model < len(cells):
            set_cell_text(cells[index_model], item["model"])
        if index_code < len(cells):
            set_cell_text(cells[index_code], item["code"])
        if index_range >= 0 and index_range < len(cells):
            set_cell_text(cells[index_range], item["measurement_range"])
        if index_uncertainty >= 0 and index_uncertainty < len(cells):
            set_cell_text(cells[index_uncertainty], item["uncertainty"])
        if index_cert_valid >= 0 and index_cert_valid < len(cells):
            cert_parts = [part for part in (item["certificate_no"], item["valid_date"]) if part]
            set_cell_text(cells[index_cert_valid], "\n".join(cert_parts))
        elif len(cells) > 3:
            set_cell_text(cells[3], item["valid_date"])
        if index_trace >= 0 and index_trace < len(cells):
            set_cell_text(cells[index_trace], item["traceability_institution"])

    manufacturer = normalize_space(payload.get("manufacturer", ""))
    if manufacturer and data_rows and len(normalized_instrument_rows) > 0:
        target_cells = data_rows[0][1]
        if index_trace >= 0 and index_trace < len(target_cells) and not get_cell_text(target_cells[index_trace]):
            set_cell_text(target_cells[index_trace], manufacturer)
        elif len(target_cells) > 6:
            set_cell_text(target_cells[6], manufacturer)


def _find_r803b_record_table(tables: list[ET.Element]) -> ET.Element | None:
    for tbl in tables:
        row_text = " ".join([get_cell_text(tc) for tc in tbl.findall("./w:tr/w:tc", NS)])
        if "低温冲击试验装置原始记录" in row_text and "环境条件" in row_text and "铁锤质量" in row_text:
            return tbl
    return None


def _find_r825b_record_table(tables: list[ET.Element]) -> ET.Element | None:
    for tbl in tables:
        row_text = " ".join([get_cell_text(tc) for tc in tbl.findall("./w:tr/w:tc", NS)])
        if "软化击穿试验仪原始记录" in row_text and "环境条件" in row_text and "试样间短路电流" in row_text:
            return tbl
    return None


def _find_generic_record_table(tables: list[ET.Element]) -> ET.Element | None:
    return find_generic_record_table_by_rules(tables=tables, get_cell_text=get_cell_text)


def _fill_r803b_record_table(tbl: ET.Element, payload: dict[str, Any]) -> None:
    rows = tbl.findall("./w:tr", NS)
    if not rows:
        return

    basis_mode = _normalize_basis_mode(payload.get("basis_mode", ""))

    for tr in rows:
        cells = tr.findall("./w:tc", NS)
        if not cells:
            continue
        cell_texts = [get_cell_text(cell) for cell in cells]

        if payload.get("certificate_no"):
            serial_idx = _find_cell_index_contains(cells, "序")
            if serial_idx >= 0 and "号" in get_cell_text(cells[serial_idx]):
                set_cell_text(cells[serial_idx], f"序 号：{payload['certificate_no']}")

        if payload.get("basis_standard") or basis_mode:
            basis_idx = _find_cell_index_contains(cells, "校准依据")
            if basis_idx >= 0:
                current = get_cell_text(cells[basis_idx])
                basis_text = normalize_space(payload.get("basis_standard", "")) or _extract_basis_from_cell(current)
                set_cell_text(cells[basis_idx], f"{_format_dual_mode_checkbox(basis_mode)}依据：{basis_text}")

        if payload.get("device_name"):
            name_idx = _find_cell_index_contains(cells, "器具名称")
            if name_idx >= 0:
                set_cell_text(cells[name_idx], f"器具名称：{payload['device_name']}")

        if payload.get("manufacturer"):
            manufacturer_idx = _find_cell_index_contains(cells, "制造厂/商")
            if manufacturer_idx >= 0:
                set_cell_text(cells[manufacturer_idx], f"制造厂/商：{payload['manufacturer']}")

        if payload.get("device_model"):
            model_idx = _find_cell_index_contains(cells, "型号/规格")
            if model_idx >= 0:
                set_cell_text(cells[model_idx], f"型号/规格：{payload['device_model']}")

        if payload.get("device_code"):
            code_idx = _find_cell_index_contains(cells, "器具编号")
            if code_idx >= 0:
                set_cell_text(cells[code_idx], f"器具编号：{payload['device_code']}")

        location_idx = _find_cell_index_contains(cells, "校准地点")
        if location_idx >= 0 and (basis_mode or payload.get("location")):
            set_cell_text(
                cells[location_idx],
                f"{_format_dual_mode_checkbox(basis_mode)}地点：{payload.get('location', '')}",
            )

        if payload.get("temperature"):
            _fill_value_between_markers(
                cells=cells,
                start_marker="温度",
                end_marker="℃",
                value=payload["temperature"],
            )

        if payload.get("humidity"):
            _fill_value_between_markers(
                cells=cells,
                start_marker="湿度",
                end_marker="%RH",
                value=payload["humidity"],
            )

        if payload.get("section2_u_mm"):
            idx = _find_cell_index_contains(cells, "二、中间铁块直径")
            if idx >= 0:
                source = get_cell_text(cells[idx])
                set_cell_text(cells[idx], _replace_uncertainty_value(source, payload["section2_u_mm"], "mm"))

        if payload.get("section2_value_mm"):
            idx = _find_cell_index_contains(cells, "实测值")
            if idx >= 0 and "mm" in get_cell_text(cells[idx]):
                source = get_cell_text(cells[idx])
                set_cell_text(cells[idx], _replace_measured_value(source, payload["section2_value_mm"], "mm"))

        if payload.get("section3_u_g"):
            idx = _find_cell_index_contains(cells, "三、中间铁块质量")
            if idx >= 0:
                source = get_cell_text(cells[idx])
                set_cell_text(cells[idx], _replace_uncertainty_value(source, payload["section3_u_g"], "g"))

        if payload.get("section3_value_g"):
            idx = _find_cell_index_contains(cells, "实测值")
            if idx >= 0 and "g" in get_cell_text(cells[idx]):
                source = get_cell_text(cells[idx])
                set_cell_text(cells[idx], _replace_measured_value(source, payload["section3_value_g"], "g"))

        if payload.get("section4_u_g"):
            idx = _find_cell_index_contains(cells, "四、铁锤质量")
            if idx >= 0:
                source = get_cell_text(cells[idx])
                set_cell_text(cells[idx], _replace_uncertainty_value(source, payload["section4_u_g"], "g"))

    _fill_r803b_hammer_actual_rows(tbl, payload.get("hammer_actual_rows", []))


def _fill_r825b_record_table(tbl: ET.Element, payload: dict[str, Any]) -> None:
    rows = tbl.findall("./w:tr", NS)
    if not rows:
        return

    basis_mode = _normalize_basis_mode(payload.get("basis_mode", ""))

    for tr in rows:
        cells = tr.findall("./w:tc", NS)
        if not cells:
            continue

        if payload.get("certificate_no"):
            serial_idx = _find_cell_index_contains(cells, "序")
            if serial_idx >= 0 and "号" in get_cell_text(cells[serial_idx]):
                set_cell_text(cells[serial_idx], f"序 号：{payload['certificate_no']}")

        fill_base_fields_in_cells_by_rules(
            cells=cells,
            payload=payload,
            basis_mode=basis_mode,
            get_cell_text=get_cell_text,
            set_cell_text=set_cell_text,
            extract_basis_from_text=_extract_basis_from_cell,
            format_mode_prefix=_format_dual_mode_checkbox,
        )

        if payload.get("temperature"):
            _fill_value_between_markers(
                cells=cells,
                start_marker="温度",
                end_marker="℃",
                value=payload["temperature"],
            )

        if payload.get("humidity"):
            _fill_value_between_markers(
                cells=cells,
                start_marker="湿度",
                end_marker="%RH",
                value=payload["humidity"],
            )


def _fill_generic_base_labels_in_tables(tables: list[ET.Element], payload: dict[str, Any]) -> bool:
    basis_mode = _normalize_basis_mode(payload.get("basis_mode", ""))
    return fill_base_fields_in_tables_by_rules(
        tables=tables,
        payload=payload,
        basis_mode=basis_mode,
        get_cell_text=get_cell_text,
        set_cell_text=set_cell_text,
        extract_basis_from_text=_extract_basis_from_cell,
        format_mode_prefix=_format_dual_mode_checkbox,
    )


def _fill_generic_base_labels_in_paragraphs(root: ET.Element, payload: dict[str, Any]) -> bool:
    basis_mode = _normalize_basis_mode(payload.get("basis_mode", ""))
    return fill_base_fields_in_paragraphs_by_rules(
        root=root,
        payload=payload,
        basis_mode=basis_mode,
        extract_basis_from_text=_extract_basis_from_cell,
        format_mode_prefix=_format_dual_mode_checkbox,
    )


def _fill_r803b_hammer_actual_rows(tbl: ET.Element, rows_data: list[list[str]]) -> None:
    rows = tbl.findall("./w:tr", NS)
    actual_rows: list[list[ET.Element]] = []
    for tr in rows:
        cells = tr.findall("./w:tc", NS)
        if not cells:
            continue
        first_text = get_cell_text(cells[0])
        if "实际值(g)" in first_text:
            actual_rows.append(cells)

    if not actual_rows:
        return

    for cells in actual_rows:
        for idx in range(1, len(cells)):
            set_cell_text(cells[idx], "")

    for row_idx, values in enumerate(rows_data):
        if row_idx >= len(actual_rows):
            break
        cells = actual_rows[row_idx]
        for idx, value in enumerate(values, start=1):
            if idx >= len(cells):
                break
            set_cell_text(cells[idx], normalize_space(value))


def _fill_r803b_result_checks(tbl: ET.Element) -> None:
    for tr in tbl.findall("./w:tr", NS):
        cells = tr.findall("./w:tc", NS)
        if not cells:
            continue
        for cell in cells:
            compact = re.sub(r"\s+", "", get_cell_text(cell))
            if not compact.startswith("结果"):
                continue
            set_cell_text(cell, "结果：√")


def _fill_generic_result_checks_in_tables(tables: list[ET.Element]) -> bool:
    changed = False
    for tbl in tables:
        for tr in tbl.findall("./w:tr", NS):
            cells = tr.findall("./w:tc", NS)
            if not cells:
                continue
            for cell in cells:
                compact = re.sub(r"\s+", "", get_cell_text(cell))
                if not compact.startswith("结果"):
                    continue
                if any(mark in compact for mark in ("■", "☑", "√")):
                    continue
                set_cell_text(cell, "结果：√")
                changed = True
    return changed


def _fill_generic_semantic_value_matrices_from_payload(tables: list[ET.Element], payload: dict[str, Any]) -> bool:
    detail_text = str(payload.get("detail_general_check", "") or "")
    source_maps = build_semantic_value_maps_from_general_check_text(detail_text, normalize_space=normalize_space)
    if not source_maps:
        return False

    changed = False
    for tbl in tables:
        rows = tbl.findall("./w:tr", NS)
        if not rows:
            continue
        header_row_idx = -1
        key_col_idx = -1
        value_col_idx = -1
        for ri, tr in enumerate(rows):
            cells = tr.findall("./w:tc", NS)
            if not cells:
                continue
            texts = [normalize_space(get_cell_text(cell)) for cell in cells]
            key_col_idx, value_col_idx = detect_semantic_key_value_columns(texts)
            if key_col_idx >= 0 and value_col_idx >= 0:
                header_row_idx = ri
                break
        if header_row_idx < 0 or key_col_idx < 0 or value_col_idx < 0:
            continue

        key_col_carry = ""
        for ri in range(header_row_idx + 1, len(rows)):
            cells = rows[ri].findall("./w:tc", NS)
            if not cells:
                continue
            if key_col_idx >= len(cells) or value_col_idx >= len(cells):
                continue
            key_text = normalize_space(get_cell_text(cells[key_col_idx]))
            if key_text:
                key_col_carry = key_text
            else:
                key_text = key_col_carry
            if not key_text:
                continue
            key = normalize_semantic_key(key_text, normalize_space=normalize_space)
            if not key:
                continue
            fill_value = _pick_semantic_value_for_key(source_maps, key)
            if not fill_value:
                continue
            current_value = normalize_space(get_cell_text(cells[value_col_idx]))
            if current_value == fill_value:
                continue
            set_cell_text(cells[value_col_idx], fill_value)
            changed = True
    return changed


def _fill_generic_uncertainty_u_from_payload(root: ET.Element, tables: list[ET.Element], payload: dict[str, Any]) -> bool:
    detail_text = str(payload.get("detail_general_check", "") or "")
    u_value = extract_uncertainty_u_value(detail_text, normalize_space=normalize_space)
    if not u_value:
        return False
    changed = False
    for paragraph in root.findall(".//w:p", NS):
        current = normalize_space("".join([(node.text or "") for node in paragraph.findall(".//w:t", NS)]))
        if not current:
            continue
        updated = replace_uncertainty_u_placeholder(current, u_value, normalize_space=normalize_space)
        if updated != current:
            _set_paragraph_text(paragraph, updated)
            changed = True
    for tbl in tables:
        for tr in tbl.findall("./w:tr", NS):
            for tc in tr.findall("./w:tc", NS):
                current = get_cell_text(tc)
                if not current:
                    continue
                updated = replace_uncertainty_u_placeholder(current, u_value, normalize_space=normalize_space)
                if updated != current:
                    set_cell_text(tc, updated)
                    changed = True
    return changed


def _pick_semantic_value_for_key(source_maps: list[dict[str, str]], key: str) -> str:
    for mapping in source_maps:
        if key in mapping and normalize_space(mapping.get(key, "")):
            return normalize_space(mapping[key])
    return ""


def _fill_generic_result_checks_by_semantics(tables: list[ET.Element], payload: dict[str, Any]) -> bool:
    source_lines = extract_source_general_check_lines(str(payload.get("detail_general_check", "")))
    if not source_lines:
        return False
    if _is_r872_profile(payload):
        return _fill_r872_result_checks_by_rules(tables, source_lines)

    changed = False
    used_source_indexes: set[int] = set()
    for tbl in tables:
        rows = tbl.findall("./w:tr", NS)
        previous_requirement = ""
        for tr in rows:
            cells = tr.findall("./w:tc", NS)
            if not cells:
                continue
            result_cells = [cell for cell in cells if re.sub(r"\s+", "", get_cell_text(cell)).startswith("结果")]
            row_requirement = _extract_requirement_text_from_cells(cells)
            if not result_cells:
                if row_requirement:
                    previous_requirement = row_requirement
                continue

            target_requirement = row_requirement or previous_requirement
            matched_index, _ = match_best_source_line(
                target_text=target_requirement,
                source_lines=source_lines,
                used_indexes=used_source_indexes,
                threshold=0.30,
            )
            if matched_index >= 0:
                source_line = source_lines[matched_index]
                if not _is_reliable_result_semantic_match(target_requirement, source_line):
                    matched_index = -1
            for result_cell in result_cells:
                if matched_index >= 0:
                    set_cell_text(result_cell, "结果：√")
                    changed = True
                else:
                    set_cell_text(result_cell, "结果：")
                    changed = True
            if matched_index >= 0:
                used_source_indexes.add(matched_index)
    return changed


def _is_reliable_result_semantic_match(target_text: str, source_line: str) -> bool:
    target = normalize_space(target_text)
    source = normalize_space(source_line)
    if not target or not source:
        return False
    anchor_groups = [
        {"电阻", "Ω", "欧姆"},
        {"夹具", "夹头"},
        {"距离", "间距"},
        {"宽度", "刀口"},
        {"平行", "互相平行"},
    ]
    target_hits: set[int] = set()
    source_hits: set[int] = set()
    for idx, group in enumerate(anchor_groups):
        if any(token in target for token in group):
            target_hits.add(idx)
        if any(token in source for token in group):
            source_hits.add(idx)
    if target_hits:
        return bool(target_hits & source_hits)
    return True


def _fill_r872_result_checks_by_rules(tables: list[ET.Element], source_lines: list[str]) -> bool:
    changed = False
    for tbl in tables:
        rows = tbl.findall("./w:tr", NS)
        for tr in rows:
            cells = tr.findall("./w:tc", NS)
            if not cells:
                continue
            result_cells = [cell for cell in cells if re.sub(r"\s+", "", get_cell_text(cell)).startswith("结果")]
            non_result_cells = [cell for cell in cells if cell not in result_cells]
            for cell in non_result_cells:
                original_text = get_cell_text(cell)
                updated_text = fill_r872_requirement_text(original_text, source_lines)
                if updated_text != original_text:
                    set_cell_text(cell, updated_text)
                    changed = True
            row_requirement = _extract_requirement_text_from_cells(cells)
            if not result_cells:
                continue
            # R872按“当前结果行的要求文本”判定，不跨行继承，避免错位误勾。
            mark = should_mark_r872_result(target_requirement=row_requirement, source_lines=source_lines)
            for result_cell in result_cells:
                set_cell_text(result_cell, "结果：√" if mark else "结果：")
                changed = True
    return changed


def _is_r872_profile(payload: dict[str, Any]) -> bool:
    template_name = normalize_space(str(payload.get("__template_name", ""))).lower()
    if re.search(r"r[-_ ]?872b", template_name, flags=re.IGNORECASE):
        return True
    device_name = normalize_space(str(payload.get("device_name", "")))
    return bool(re.search(r"扭转", device_name))


def _extract_requirement_text_from_cells(cells: list[ET.Element]) -> str:
    parts: list[str] = []
    for cell in cells:
        text = normalize_space(get_cell_text(cell))
        if not text:
            continue
        compact = re.sub(r"\s+", "", text)
        if compact.startswith("结果"):
            continue
        if re.search(r"^(?:[一二三四五六七八九十]+[、.．)]|一般检查[:：]?)$", text):
            continue
        parts.append(text)
    return normalize_space(" ".join(parts))


def _should_auto_fill_result_checks(template_path: Path, payload: dict[str, Any]) -> bool:
    text = normalize_space(str(payload.get("auto_check_results", "")))
    if text in {"0", "false", "no", "off"}:
        return False
    name = normalize_space(template_path.name).lower()
    return bool(re.search(r"r[-_ ]?859b", name, flags=re.IGNORECASE))


def _should_semantic_fill_result_checks(template_path: Path) -> bool:
    name = normalize_space(template_path.name).lower()
    return bool(re.search(r"r[-_ ]?872b|扭转", name, flags=re.IGNORECASE))


def _fill_page_number_placeholder(tables: list[ET.Element]) -> None:
    # Kept for backward compatibility, unified flow uses _fill_page_number_placeholders_in_root.
    for tbl in tables:
        for tr in tbl.findall("./w:tr", NS):
            cells = tr.findall("./w:tc", NS)
            for cell in cells:
                text = normalize_space(get_cell_text(cell))
                if not _is_page_placeholder_text(text):
                    continue
                set_cell_page_fields(cell, 1, 1)


def _fill_page_number_placeholder_in_paragraphs(root: ET.Element) -> None:
    # Kept for backward compatibility, unified flow uses _fill_page_number_placeholders_in_root.
    for paragraph in root.findall(".//w:p", NS):
        text = normalize_space("".join([(node.text or "") for node in paragraph.findall(".//w:t", NS)]))
        if not _is_page_placeholder_text(text):
            continue
        _set_paragraph_text(paragraph, "第 1 页/共 1 页")


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


def _is_page_placeholder_text(value: str) -> bool:
    compact = re.sub(r"\s+", "", value or "")
    if "第页/共页" in compact:
        return True
    if "第" in compact and "共" in compact and "页" in compact:
        return True
    return False


def set_cell_page_fields(tc: ET.Element, current: int = 1, total: int = 1) -> None:
    paragraphs = tc.findall("./w:p", NS)
    if paragraphs:
        paragraph = paragraphs[0]
    else:
        paragraph = ET.SubElement(tc, f"{{{W_NS}}}p")

    _set_paragraph_text(paragraph, f"第 {current} 页/共 {total} 页")

    for extra in paragraphs[1:]:
        tc.remove(extra)


def _append_text_run(paragraph: ET.Element, value: str) -> None:
    run = ET.SubElement(paragraph, f"{{{W_NS}}}r")
    text = ET.SubElement(run, f"{{{W_NS}}}t")
    if value.startswith(" ") or value.endswith(" "):
        text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    text.text = value


def _set_paragraph_text(paragraph: ET.Element, value: str) -> None:
    _clear_paragraph_runs(paragraph)
    _append_text_run(paragraph, value)


def _append_simple_field(paragraph: ET.Element, instr_name: str) -> None:
    field = ET.SubElement(paragraph, f"{{{W_NS}}}fldSimple")
    field.set(f"{{{W_NS}}}instr", f"{instr_name} \\* MERGEFORMAT")
    run = ET.SubElement(field, f"{{{W_NS}}}r")
    run_props = ET.SubElement(run, f"{{{W_NS}}}rPr")
    ET.SubElement(run_props, f"{{{W_NS}}}noProof")
    text = ET.SubElement(run, f"{{{W_NS}}}t")
    text.text = "1"


def _clear_paragraph_runs(paragraph: ET.Element) -> None:
    for child in list(paragraph):
        if child.tag == f"{{{W_NS}}}pPr":
            continue
        paragraph.remove(child)


def _set_paragraph_text(paragraph: ET.Element, value: str) -> None:
    _clear_paragraph_runs(paragraph)
    _append_text_run(paragraph, value)


def _resolve_report_dates(
    receive_date: str,
    calibration_date: str,
    publish_date: str,
) -> tuple[str, str, str]:
    receive = sanitize_context_date(receive_date)
    calibration = sanitize_context_date(calibration_date)
    publish = sanitize_context_date(publish_date)

    base_date = calibration or receive
    if not base_date:
        return receive, calibration, publish

    receive = base_date
    calibration = base_date
    next_day = _add_days(base_date, 1)
    publish = next_day or publish
    return receive, calibration, publish


def _add_days(date_text: str, days: int) -> str:
    parts = split_date_parts(date_text)
    if not parts:
        return ""
    year, month, day = parts
    try:
        dt = datetime(int(year), int(month), int(day))
    except ValueError:
        return ""
    target = dt + timedelta(days=days)
    return f"{target.year:04d}年{target.month:02d}月{target.day:02d}日"


def _extract_location_from_other_calibration_info(text: str) -> str:
    value = extract_value_by_regex(
        text,
        patterns=(
            r"(?:其他|其它)校准信息[\s\S]{0,240}?地点[:：]?\s*([^\n|；;]+)",
            r"(?:Calibration\s*Information|其他校准信息|其它校准信息)[\s\S]{0,240}?Location[:：]?\s*([^\n|；;]+)",
        ),
        flags=re.IGNORECASE | re.DOTALL,
    )
    return _sanitize_location_text(value)


def _extract_temperature_from_other_calibration_info(text: str) -> str:
    return extract_value_by_regex(
        text,
        patterns=(
            r"(?:其他|其它)校准信息[\s\S]{0,240}?温度[:：]?\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
            r"(?:Calibration\s*Information|其他校准信息|其它校准信息)[\s\S]{0,240}?Temperature[:：]?\s*([+-]?[0-9]+(?:\.[0-9]+)?)",
        ),
        flags=re.IGNORECASE | re.DOTALL,
    )


def _extract_humidity_from_other_calibration_info(text: str) -> str:
    return extract_value_by_regex(
        text,
        patterns=(
            r"(?:其他|其它)校准信息[\s\S]{0,240}?湿度[:：]?\s*([0-9]+(?:\.[0-9]+)?)",
            r"(?:Calibration\s*Information|其他校准信息|其它校准信息)[\s\S]{0,240}?Humidity[:：]?\s*([0-9]+(?:\.[0-9]+)?)",
        ),
        flags=re.IGNORECASE | re.DOTALL,
    )


def _sanitize_location_text(value: str) -> str:
    text = normalize_space(value)
    if not text:
        return ""
    text = re.split(r"(?:温度|湿度|Temperature|Humidity)[:：]?", text, maxsplit=1)[0]
    text = re.sub(r"[，,;；\s]+$", "", text)
    return normalize_space(text)


def _replace_uncertainty_value(text: str, value: str, unit: str) -> str:
    normalized_value = normalize_space(value)
    if not normalized_value:
        return text
    return re.sub(
        rf"U=\s*.*?{re.escape(unit)},k=2。",
        f"U={normalized_value} {unit},k=2。",
        text,
        count=1,
    )


def _replace_measured_value(text: str, value: str, unit: str) -> str:
    normalized_value = normalize_space(value)
    if not normalized_value:
        return text
    return re.sub(
        rf"实测值[:：]\s*.*?{re.escape(unit)}。",
        f"实测值：{normalized_value} {unit}。",
        text,
        count=1,
    )


def _fill_value_between_markers(
    cells: list[ET.Element],
    start_marker: str,
    end_marker: str,
    value: str,
) -> None:
    if not value:
        return
    start_idx = _find_cell_index_contains(cells, start_marker)
    if start_idx < 0:
        return

    end_idx = _find_cell_index_contains(cells, end_marker)
    if end_idx <= start_idx:
        end_idx = len(cells)

    for idx in range(start_idx + 1, end_idx):
        current = get_cell_text(cells[idx])
        if current:
            continue
        set_cell_text(cells[idx], value)
        return


def _find_cell_index_contains(cells: list[ET.Element], marker: str) -> int:
    for idx, cell in enumerate(cells):
        if marker in get_cell_text(cell):
            return idx
    return -1


def _find_cell_index_contains_any(cells: list[ET.Element], markers: tuple[str, ...]) -> int:
    return find_cell_index_contains_any(cells=cells, markers=markers, get_cell_text=get_cell_text)


def _extract_section_uncertainty(text: str, section_title: str, unit: str) -> str:
    return extract_value_by_regex(
        text,
        patterns=(
            rf"{re.escape(section_title)}[\s\S]{{0,240}}?扩展不确定度U\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*{re.escape(unit)}",
        ),
        flags=re.IGNORECASE | re.DOTALL,
    )


def _extract_section_measured_value(text: str, section_title: str, unit: str) -> str:
    return extract_value_by_regex(
        text,
        patterns=(
            rf"{re.escape(section_title)}[\s\S]{{0,280}}?实测值[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*{re.escape(unit)}",
        ),
        flags=re.IGNORECASE | re.DOTALL,
    )


def extract_hammer_actual_rows(tables: list[list[list[str]]]) -> list[list[str]]:
    result: list[list[str]] = []
    for rows in tables:
        for row in rows:
            label_idx = -1
            for idx, cell in enumerate(row):
                if "实际值(g)" in normalize_space(cell):
                    label_idx = idx
                    break
            if label_idx < 0:
                continue

            values = [normalize_space(cell) for cell in row[label_idx + 1 :] if normalize_space(cell)]
            if values:
                result.append(values[:10])
    return result[:3]


def extract_hammer_actual_rows_from_text(text: str) -> list[list[str]]:
    if not text:
        return []
    result: list[list[str]] = []
    for line in text.splitlines():
        if "实际值(g)" not in line:
            continue
        values = re.findall(r"\d+(?:\.\d+)?", line)
        if len(values) >= 10:
            result.append(values[-10:])
    return result[:3]


def extract_hammer_actual_rows_from_context(context: dict[str, str]) -> dict[int, list[str]]:
    result: dict[int, list[str]] = {}
    for idx in range(1, 4):
        raw_value = normalize_space(context.get(f"hammer_actual_row_{idx}", ""))
        if not raw_value:
            continue
        values = re.findall(r"\d+(?:\.\d+)?", raw_value)
        if not values:
            continue
        result[idx - 1] = values[:10]
    return result


def merge_hammer_actual_rows(
    source_rows: list[list[str]],
    context_rows: dict[int, list[str]],
) -> list[list[str]]:
    merged = [list(row) for row in source_rows[:3]]
    if len(merged) < 3:
        merged.extend([[] for _ in range(3 - len(merged))])

    for row_idx, values in context_rows.items():
        if row_idx < 0 or row_idx > 2:
            continue
        merged[row_idx] = values
    return merged


def clean_item_name(name: str) -> str:
    value = normalize_space(name)
    value = re.sub(r"^[□■☑▣√]+", "", value)
    return normalize_space(value)


def sanitize_instrument_cell(value: str) -> str:
    text = normalize_space(value)
    if text in _PLACEHOLDER_VALUES:
        return ""
    return text


def normalize_catalog_token(value: str) -> str:
    text = re.sub(r"[\s:：/\\\-_.|*（）()]+", "", str(value or "").lower())
    if text in _PLACEHOLDER_VALUES:
        return ""
    return text


def parse_instrument_catalog_tokens(raw_text: str) -> set[str]:
    tokens: set[str] = set()
    for line in str(raw_text or "").splitlines():
        text = sanitize_instrument_cell(line)
        if not text:
            continue
        token = normalize_catalog_token(text)
        if token:
            tokens.add(token)
    return tokens


def parse_instrument_catalog_rows_json(raw_text: str) -> list[dict[str, str]]:
    text = str(raw_text or "").strip()
    if not text:
        return []
    try:
        payload = json.loads(text)
    except Exception:
        return []
    if not isinstance(payload, list):
        return []

    rows: list[dict[str, str]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        row = {
            "name": sanitize_instrument_cell(item.get("name", "")),
            "model": sanitize_instrument_cell(item.get("model", "")),
            "code": sanitize_instrument_cell(item.get("code", "")),
            "measurement_range": sanitize_instrument_cell(item.get("measurement_range", "")),
            "uncertainty": sanitize_instrument_cell(item.get("uncertainty", "")),
            "certificate_no": sanitize_instrument_cell(item.get("certificate_no", "")),
            "valid_date": sanitize_instrument_cell(item.get("valid_date", "")),
            "traceability_institution": sanitize_instrument_cell(item.get("traceability_institution", "")),
        }
        if not row["name"]:
            continue
        rows.append(row)
    return rows[:2000]


def merge_instrument_rows_with_catalog(
    instrument_rows: list[dict[str, str]],
    catalog_rows: list[dict[str, str]],
) -> list[dict[str, str]]:
    catalog_by_token: dict[str, dict[str, str]] = {}
    for row in catalog_rows:
        token = normalize_catalog_token(row.get("name", ""))
        if token and token not in catalog_by_token:
            catalog_by_token[token] = row

    merged: list[dict[str, str]] = []
    for item in instrument_rows:
        token = normalize_catalog_token(item.get("name", ""))
        catalog = catalog_by_token.get(token) if token else None
        if not catalog:
            merged.append(item)
            continue

        cert_value = sanitize_instrument_cell(catalog.get("certificate_no", ""))
        valid_value = sanitize_instrument_cell(catalog.get("valid_date", ""))
        merged.append(
            {
                "name": sanitize_instrument_cell(catalog.get("name", "")) or sanitize_instrument_cell(item.get("name", "")),
                "model": sanitize_instrument_cell(catalog.get("model", "")) or sanitize_instrument_cell(item.get("model", "")),
                "code": sanitize_instrument_cell(catalog.get("code", "")) or sanitize_instrument_cell(item.get("code", "")),
                "measurement_range": sanitize_instrument_cell(catalog.get("measurement_range", "")) or sanitize_instrument_cell(item.get("measurement_range", "")),
                "uncertainty": sanitize_instrument_cell(catalog.get("uncertainty", "")) or sanitize_instrument_cell(item.get("uncertainty", "")),
                "certificate_no": cert_value or sanitize_instrument_cell(item.get("certificate_no", "")),
                "valid_date": valid_value or sanitize_instrument_cell(item.get("valid_date", "")),
                "traceability_institution": sanitize_instrument_cell(catalog.get("traceability_institution", "")) or sanitize_instrument_cell(item.get("traceability_institution", "")),
            }
        )
    return merged


def _pick_cell(row: list[str], index: int) -> str:
    if index < 0 or index >= len(row):
        return ""
    return row[index]


def _first_meaningful_value(values: list[str]) -> str:
    for candidate in values:
        candidate_value = normalize_space(candidate)
        if candidate_value and not _looks_like_label(candidate_value):
            return candidate_value
    return ""


def _split_model_code_combined(value: str) -> tuple[str, str]:
    text = normalize_space(value)
    if not text:
        return "", ""
    parts = [normalize_space(part) for part in re.split(r"[:：/|]", text) if normalize_space(part)]
    if len(parts) >= 2:
        left = sanitize_context_value(parts[0])
        right = sanitize_context_value(parts[1])
        if left and right:
            return left, right
    return sanitize_context_value(text), ""


def _looks_like_label(value: str) -> bool:
    normalized_value = normalize_space(value)
    if normalized_value.endswith(":") or normalized_value.endswith("："):
        return True
    if "溯源机构名称" in normalized_value:
        return True
    if normalized_value.lower() in {"client", "manufacturer", "instrument name"}:
        return True
    ascii_compact = re.sub(r"[^a-z]", "", normalized_value.lower())
    if ascii_compact in {
        "client",
        "manufacturer",
        "instrumentname",
        "devicename",
        "equipmentname",
        "instrumentserialnumber",
        "modelspecification",
        "modelnumber",
        "measurementrange",
        "certificateseriesnumber",
        "certificate",
        "number",
        "serialnumber",
        "code",
        "receiveddate",
        "dateforcalibration",
        "year",
        "month",
        "day",
    }:
        return True
    if re.search(r"(?:model|specification|serial|number|manufacturer|measurement|range|traceability|institution)", ascii_compact):
        if not re.search(r"\d", normalized_value):
            return True
    return False


def _extract_standard_code(value: str) -> str:
    codes = _extract_standard_codes(value)
    if not codes:
        return ""
    return codes[0]


def _extract_standard_codes(value: str) -> list[str]:
    normalized_value = normalize_space(value)
    if not normalized_value:
        return []
    matches = re.findall(
        r"([A-Za-z]{1,5}\s*/\s*T\s*\d+(?:\.\d+)?-\d{4})",
        normalized_value,
        flags=re.IGNORECASE,
    )
    result: list[str] = []
    seen: set[str] = set()
    for raw_code in matches:
        code = re.sub(r"\s+", " ", raw_code).strip()
        code = re.sub(r"\s*/\s*", "/", code)
        code = re.sub(r"/\s*T\s*", "/T ", code, flags=re.IGNORECASE)
        if code in seen:
            continue
        seen.add(code)
        result.append(code)
    return result


def _extract_standard_codes_from_context_items(value: Any) -> list[str]:
    raw_items: list[str] = []
    if isinstance(value, list):
        raw_items = [str(item or "") for item in value]
    elif isinstance(value, tuple):
        raw_items = [str(item or "") for item in value]
    elif isinstance(value, str):
        text = normalize_space(value)
        if not text:
            raw_items = []
        else:
            raw_items = [part for part in re.split(r"[\n,，;；]+", text) if normalize_space(part)]
    else:
        raw_items = []

    result: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        codes = _extract_standard_codes(item)
        if not codes:
            continue
        for code in codes:
            if code in seen:
                continue
            seen.add(code)
            result.append(code)
    return result


def _normalize_basis_mode(value: str) -> str:
    normalized_value = normalize_space(value)
    if normalized_value in {"校准", "calibration"}:
        return "校准"
    if normalized_value in {"检测", "test", "inspection"}:
        return "检测"
    return ""


def _infer_basis_mode(text: str) -> str:
    normalized_text = normalize_space(text)
    if not normalized_text:
        return ""
    if re.search(r"(校准证书|本次校准|校准日期|校准依据)", normalized_text):
        return "校准"
    if re.search(r"(本次检测|检测日期|检测依据)", normalized_text):
        return "检测"
    return ""


def _format_dual_mode_checkbox(mode: str) -> str:
    if mode == "检测":
        return "☑检测/□校准"
    if mode == "校准":
        return "□检测/☑校准"
    return "□检测/□校准"


def _extract_basis_from_cell(text: str) -> str:
    match = re.search(r"依据[:：]\s*(.*)$", normalize_space(text))
    if not match:
        return ""
    basis_text = normalize_space(match.group(1))
    basis_codes = _extract_standard_codes(basis_text)
    if basis_codes:
        return "、".join(basis_codes)
    return basis_text


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


def _tables_to_text_block(tables: list[list[list[str]]]) -> str:
    lines: list[str] = []
    for table in tables:
        for row in table:
            text = " | ".join([cell for cell in row if cell])
            if text:
                lines.append(text)
    return "\n".join(lines)


def sanitize_context_value(value: str) -> str:
    normalized = normalize_space(value)
    if not normalized:
        return ""
    if _looks_like_label(normalized):
        return ""
    return normalized


def sanitize_context_date(value: str) -> str:
    normalized = normalize_space(value)
    if not normalized:
        return ""
    parts = split_date_parts(normalized)
    if not parts:
        return ""
    year, month, day = parts
    return f"{year}年{month}月{day}日"
