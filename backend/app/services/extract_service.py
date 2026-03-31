import re
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from ..utils.text_normalizer import normalize_text
from .extract_structured_service import (
    _apply_structured_pairs,
    _extract_structured_line_pairs,
    _is_low_quality_field_value,
    _is_placeholder_code,
    _is_placeholder_model,
    _is_placeholder_name,
    _is_unit_or_client_line,
    _normalize_device_code_value,
    _normalize_placeholder_token,
    _strip_english_label_prefix,
    _strip_placeholder_values,
)
from .extract_profile_service import (
    _apply_source_profile_context,
    _extract_model_token,
    _find_first,
)

RULES_FILE = Path(__file__).resolve().parents[1] / "rules" / "device_field_rules.yaml"


@lru_cache(maxsize=1)
def load_rules() -> dict[str, Any]:
    if not RULES_FILE.exists():
        return {}
    with RULES_FILE.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def extract_fields(raw_text: str) -> dict[str, str]:
    text = normalize_text(raw_text)
    rules = load_rules()
    result: dict[str, str] = {
        "device_name": "",
        "device_model": "",
        "device_code": "",
        "manufacturer": "",
        "basis_mode": "",
        "basis_standard": "",
        "basis_standard_items": [],
        "unit_name": "",
        "address": "",
        "certificate_no": "",
        "client_name": "",
        "receive_date": "",
        "calibration_date": "",
        "release_date": "",
        "location": "",
        "temperature": "",
        "humidity": "",
        "power_rating": "",
        "manufacture_date": "",
        "contact_info": "",
        "measurement_items": "",
        "measurement_item_count": "",
        "pd_charge_values_pc": "",
        "pd_charge_avg_pc": "",
        "pd_rise_time_values_ns": "",
        "pd_rise_time_avg_ns": "",
        "pd_pulse_amplitude_values_v": "",
        "pd_pulse_amplitude_avg_v": "",
        "pd_voltage_urel_percent": "",
        "pd_scan_time_urel_percent": "",
        "pd_capacitance_urel_percent": "",
        "pd_power_tolerance_urel_percent": "",
        "pd_voltage_calibration_urel_percent": "",
        "source_profile": "",
        "source_profile_label": "",
        "device_group_count": "0",
        "device_group_summary": "",
        "has_measurement_scope": "0",
        "raw_record": text,
    }

    line_pairs = _extract_structured_line_pairs(text)
    _apply_structured_pairs(result, line_pairs)

    for field_name, config in rules.items():
        patterns = config.get("patterns", [])
        for pattern in patterns:
            current_value = _clean_extracted_value(result.get(field_name, ""))
            if current_value and not _is_low_quality_field_value(field_name, current_value):
                break
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if not match:
                continue
            if match.lastindex:
                value = match.group(match.lastindex)
            else:
                value = match.group(0)
            candidate_value = _clean_extracted_value(value)
            if not candidate_value:
                continue
            if _is_low_quality_field_value(field_name, candidate_value):
                continue
            result[field_name] = candidate_value
            break

    _fill_by_fallback(result, text)
    _apply_structured_pairs(result, line_pairs)
    _normalize_report_dates(result)
    _extract_partial_discharge_fields(result, text)
    _apply_source_profile_context(result, text)
    return result


def _clean_extracted_value(value: str) -> str:
    cleaned = value.strip()
    cleaned = re.sub(r"^[：:\- ]+", "", cleaned)
    return cleaned.strip()


def _fill_by_fallback(result: dict[str, str], text: str) -> None:
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    if not lines:
        return

    calibration_info_block = _extract_calibration_info_block(text)

    if not result["device_model"]:
        model_code = _extract_model_code_value(lines)
        if model_code:
            result["device_model"] = model_code

    if not result["unit_name"]:
        result["unit_name"] = _extract_by_pattern(
            text,
            (
                r"单位名称[:：]?\s*([^\n]+)",
                r"委托单位[:：]?\s*([^\n]+)",
            ),
        )

    if not result["address"]:
        result["address"] = _extract_by_pattern(
            text,
            (
                r"地址[:：]?\s*([^\n]+)",
                r"地点[:：]?\s*([^\n]+)",
            ),
        )

    if not result["location"]:
        result["location"] = _extract_location_value(text, calibration_info_block)

    if not result["temperature"]:
        result["temperature"] = _extract_temperature_value(text, calibration_info_block)

    if not result["humidity"]:
        result["humidity"] = _extract_humidity_value(text, calibration_info_block)

    if not result["device_name"]:
        result["device_name"] = _extract_by_pattern(
            text,
            (
                r"(?:设备名称|器具名称|仪器名称)[:：]?\s*([^\n]+)",
                r"(局放仪|局部放电[^\n]{0,20}(?:系统|仪|装置))",
            ),
        )

    if not result["device_model"]:
        result["device_model"] = _extract_by_pattern(
            text,
            (
                r"(?:型号/编号|型号规格|型号)[:：]?\s*([A-Za-z0-9\-_./ ]+)",
                r"(?:Type\s*model|Type)[:：]?\s*([A-Za-z0-9\-_./ ]{3,50})",
            ),
        )
    if not result["device_model"]:
        result["device_model"] = _extract_neighbor_value(
            lines,
            (r"型号", r"Type"),
            r"([A-Za-z][A-Za-z0-9\-_/\. ]{2,40})",
        )

    if not result["device_code"]:
        result["device_code"] = _extract_by_pattern(
            text,
            (
                r"(?:型号/编号)[:：]?\s*[A-Za-z0-9\-_./ ]*[:：]?\s*([A-Za-z0-9\-_./]+)",
                r"(?:设备编号|器具编号|编号)[:：]?\s*([A-Za-z0-9\-_./]+)",
                r"(?:Number|Serial No\.?)[:：]?\s*([A-Za-z0-9\-_./]+)",
            ),
        )
    if not result["device_code"]:
        result["device_code"] = _extract_neighbor_value(
            lines,
            (r"编号", r"Number", r"Serial"),
            r"([A-Za-z0-9\-_./]{4,})",
        )

    if not result["power_rating"]:
        result["power_rating"] = _extract_by_pattern(
            text,
            (
                r"电源/功率[:：]?\s*([^\n]+)",
                r"电源功率[:：]?\s*([^\n]+)",
                r"(?:输出容量|额定功率|Rated power)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:kVA|KVA|kW|KW|W)?)",
            ),
        )
    if not result["power_rating"]:
        result["power_rating"] = _extract_neighbor_value(
            lines,
            (r"输出容量", r"额定功率", r"Rated power"),
            r"([0-9]+(?:\.[0-9]+)?\s*(?:kVA|KVA|kW|KW|W))",
        )

    if not result["manufacture_date"]:
        for label in ("制造日期", "生产日期", "制造年月", "Date of manufacture"):
            value = _extract_date_by_label(text, label)
            if value:
                result["manufacture_date"] = value
                break

    if not result["contact_info"]:
        result["contact_info"] = _extract_by_pattern(
            text,
            (
                r"联系方式[:：]?\s*([^\n]+)",
                r"(电话[:：]?\s*[0-9\- ]{7,})",
            ),
        )

    if not result["manufacturer"]:
        result["manufacturer"] = _extract_by_pattern(
            text,
            (
                r"(?:生产厂商|制造厂商|厂家|厂商)[:：]?\s*([^\n]+)",
            ),
        )

    if not result["device_name"]:
        name_line = _find_first(
            lines,
            r"(系统|设备|试验|检测|装置|平台|仪器|System|Equipment)",
        )
        if not name_line:
            name_line = lines[0]
        result["device_name"] = _clean_extracted_value(name_line)

    if not result["device_model"]:
        for line in lines:
            token = _extract_model_token(line)
            if token:
                result["device_model"] = token
                break

    if not result["device_code"]:
        code_line = _find_first(lines, r"(设备编号|编号|出厂编号|Serial|No\.?)")
        if code_line:
            result["device_code"] = _clean_extracted_value(code_line)
        elif result["device_model"]:
            result["device_code"] = result["device_model"]

    if not result["manufacturer"]:
        manufacturer_line = _find_first(
            lines,
            r"(公司|有限|厂商|厂家|Manufacturer)",
        )
        if manufacturer_line and not _is_unit_or_client_line(manufacturer_line):
            result["manufacturer"] = _clean_manufacturer_line(manufacturer_line)
    if not result["manufacturer"]:
        for line in lines:
            if _is_unit_or_client_line(line):
                continue
            if re.search(r"(有限公司|有限责任公司|ELECTRIX|TECHNOLOGY\s*CO\.?\.?\s*LTD)", line, flags=re.IGNORECASE):
                result["manufacturer"] = _clean_manufacturer_line(line)
                if result["manufacturer"]:
                    break

    if not result["certificate_no"]:
        result["certificate_no"] = _extract_by_pattern(
            text,
            (
                r"缆专检号[:：]?\s*([A-Za-z0-9\-]+)",
                r"Certificate\s*series\s*number[:：]?\s*([A-Za-z0-9\-]+)",
            ),
        )

    if not result["client_name"]:
        result["client_name"] = _extract_by_pattern(
            text,
            (
                r"委托单位[:：]?\s*([^\n]+)",
                r"Client[:：]?\s*([^\n]+)",
            ),
        )

    if _is_low_quality_field_value("receive_date", result.get("receive_date", "")):
        result["receive_date"] = _extract_date_by_label(text, "收样日期")

    if _is_low_quality_field_value("calibration_date", result.get("calibration_date", "")):
        result["calibration_date"] = _extract_date_by_label(text, "校准日期")
    if _is_low_quality_field_value("release_date", result.get("release_date", "")):
        result["release_date"] = _extract_date_by_label(text, "发布日期")
    if _is_low_quality_field_value("release_date", result.get("release_date", "")):
        result["release_date"] = _extract_date_by_label(text, "Issue date")

    if not result["basis_standard"]:
        result["basis_standard"] = _extract_basis_standard_value(text)
    if not result.get("basis_standard_items"):
        result["basis_standard_items"] = _extract_basis_standard_items(text)
    if not result.get("basis_mode"):
        result["basis_mode"] = _extract_basis_mode(text)

    items = _extract_measurement_items(text)
    if items:
        if not result["measurement_items"]:
            result["measurement_items"] = "\n".join(items)
        if not result["measurement_item_count"]:
            result["measurement_item_count"] = str(len(items))

    _strip_placeholder_values(result)
    _normalize_report_dates(result)
    _normalize_model_code(result)




def _extract_by_pattern(text: str, patterns: tuple[str, ...]) -> str:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if not match:
            continue
        value = _clean_extracted_value(match.group(1))
        if value:
            return value
    return ""


def _extract_calibration_info_block(text: str) -> str:
    if not text:
        return ""
    match = re.search(
        r"(?:其它|其他)校准信息[:：]?([\s\S]{0,1200})(?:备注[:：]|$)",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return ""
    return _clean_extracted_value(match.group(1))


def _extract_basis_block(text: str) -> str:
    if not text:
        return ""
    lines = [line.strip() for line in str(text).split("\n")]
    lines = [line for line in lines if line]
    if not lines:
        return ""
    start_patterns = (
        r"本次校准所依据的技术规范",
        r"Reference\s*documents\s*for\s*the\s*calibration",
        r"(?:检测|校准)\s*/?\s*依据",
    )
    end_patterns = (
        r"本次校准所使用的主要计量标准器具",
        r"Main measurement standard instruments",
        r"(?:其它|其他)校准信息",
        r"Calibration Information",
        r"(?:一[、.．)]\s*)?一般检查",
        r"General inspection",
        r"备注",
        r"结果",
        r"检测员",
        r"校准员",
        r"核验员",
    )
    start_idx = -1
    for idx, line in enumerate(lines):
        if any(re.search(pattern, line, flags=re.IGNORECASE) for pattern in start_patterns):
            start_idx = idx
            break
    if start_idx < 0:
        return ""
    end_idx = len(lines)
    for idx in range(start_idx + 1, len(lines)):
        if any(re.search(pattern, lines[idx], flags=re.IGNORECASE) for pattern in end_patterns):
            end_idx = idx
            break
    return "\n".join(lines[start_idx:end_idx]).strip()


def _extract_standard_codes(value: str) -> list[str]:
    text = _clean_extracted_value(value or "")
    if not text:
        return []
    matches = re.findall(
        r"([A-Za-z]{1,5}\s*/\s*T\s*\d+(?:\.\d+)?-\d{4})",
        text,
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


def _extract_basis_standard_items(text: str) -> list[str]:
    basis_block = _extract_basis_block(text)
    source = basis_block or text
    if not source:
        return []
    lines = [line.strip() for line in str(source).split("\n")]
    result: list[str] = []
    seen: set[str] = set()
    for raw_line in lines:
        line = _clean_extracted_value(raw_line)
        if not line:
            continue
        if re.search(
            r"(?:本次校准所依据的技术规范|Reference\s*documents\s*for\s*the\s*calibration|(?:检测|校准)\s*/?\s*依据)",
            line,
            flags=re.IGNORECASE,
        ):
            continue
        if re.search(
            r"(?:本次校准所使用的主要计量标准器具|Main measurement standard instruments|(?:其它|其他)校准信息|Calibration Information|(?:一[、.．)]\s*)?一般检查|General inspection|备注|结果|检测员|校准员|核验员)",
            line,
            flags=re.IGNORECASE,
        ):
            continue
        normalized_line = re.sub(r"^\(?\d+\)?[、.．]?\s*", "", line)
        normalized_line = _clean_extracted_value(normalized_line)
        if not normalized_line or normalized_line in seen:
            continue
        seen.add(normalized_line)
        result.append(normalized_line)
    if result:
        return result
    return _extract_standard_codes(source)


def _extract_basis_standard_value(text: str) -> str:
    items = _extract_basis_standard_items(text)
    if not items:
        return ""
    return "\n".join(items)


def _extract_basis_mode(text: str) -> str:
    source = str(text or "")
    if not source:
        return ""
    compact = re.sub(r"\s+", "", source)

    if re.search(r"(?:☑|√|✔|■)校准|校准(?:☑|√|✔|■)", compact):
        return "校准"
    if re.search(r"(?:☑|√|✔|■)检测|检测(?:☑|√|✔|■)", compact):
        return "检测"

    has_calibration = ("校准依据" in compact) or ("校准地点" in compact)
    has_detection = ("检测依据" in compact) or ("检测地点" in compact)
    if has_calibration and not has_detection:
        return "校准"
    if has_detection and not has_calibration:
        return "检测"
    if "校准结果" in compact:
        return "校准"
    if "检测结果" in compact:
        return "检测"
    return ""


def _extract_location_value(text: str, calibration_info_block: str) -> str:
    for source in (calibration_info_block, text):
        if not source:
            continue
        value = _extract_by_pattern(
            source,
            (
                r"(?:地点|Location)[:：]?\s*([^\n|；;]+)",
            ),
        )
        value = _sanitize_location_value(value)
        if value:
            return value
    return ""


def _extract_temperature_value(text: str, calibration_info_block: str) -> str:
    for source in (calibration_info_block, text):
        if not source:
            continue
        value = _extract_by_pattern(
            source,
            (
                r"(?:温度|Ambient\s*temperature)[:：]?\s*([+-]?\d+(?:\.\d+)?)\s*(?:℃|°C|C)?",
            ),
        )
        if value:
            return value
    return ""


def _extract_humidity_value(text: str, calibration_info_block: str) -> str:
    for source in (calibration_info_block, text):
        if not source:
            continue
        value = _extract_by_pattern(
            source,
            (
                r"(?:湿度|Relative\s*humidity)[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*%?\s*(?:RH|rh)?",
            ),
        )
        if value:
            return value
    return ""


def _sanitize_location_value(value: str) -> str:
    text = _clean_extracted_value(value or "")
    if not text:
        return ""
    text = re.split(r"(?:温度|湿度|Ambient\s*temperature|Relative\s*humidity)[:：]?", text, maxsplit=1)[0]
    text = re.sub(r"[，,;；\s]+$", "", text)
    return _clean_extracted_value(text)


def _extract_neighbor_value(lines: list[str], label_patterns: tuple[str, ...], value_pattern: str) -> str:
    if not lines:
        return ""
    label_regex = re.compile("|".join([f"(?:{p})" for p in label_patterns]), flags=re.IGNORECASE)
    value_regex = re.compile(value_pattern, flags=re.IGNORECASE)
    for idx, line in enumerate(lines):
        if not label_regex.search(line):
            continue
        same_line = value_regex.search(line)
        if same_line:
            value = _clean_extracted_value(same_line.group(1))
            if value:
                return value
        for offset in (1, 2):
            next_index = idx + offset
            if next_index >= len(lines):
                break
            next_line = lines[next_index]
            next_match = value_regex.search(next_line)
            if not next_match:
                continue
            value = _clean_extracted_value(next_match.group(1))
            if value:
                return value
    return ""


def _clean_manufacturer_line(value: str) -> str:
    text = _clean_extracted_value(value)
    if _is_unit_or_client_line(text):
        return ""
    text = re.sub(r"^(?:生产厂商|制造厂/商|制造厂商|厂家|厂商|Manufacturer)\s*[:：]?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"https?://\S+", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"(电话|Tel)[:：]?\s*[0-9\- ]{6,}$", "", text, flags=re.IGNORECASE).strip()
    return text


def _extract_date_by_label(text: str, label: str) -> str:
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    for line in lines:
        if label not in line:
            continue
        normalized_line = _clean_extracted_value(line)
        parsed = _parse_date_from_fragment(normalized_line)
        if parsed:
            return parsed

    # Fallback for table-like text where date cells are split by separators.
    escaped_label = re.escape(label)
    compact_label = r"\s*".join([re.escape(ch) for ch in label])
    for label_pattern in (escaped_label, compact_label):
        # Case 1: explicit yyyy-mm-dd style close to label.
        match = re.search(
            rf"{label_pattern}[\s\S]{{0,180}}?(\d{{4}})[./-](\d{{1,2}})[./-](\d{{1,2}})",
            text,
            flags=re.IGNORECASE,
        )
        if match:
            parsed = _format_ymd(match.group(1), match.group(2), match.group(3))
            if parsed:
                return parsed

        # Case 2: split table cells with Year/Month/Day markers.
        match = re.search(
            rf"{label_pattern}[\s\S]{{0,260}}?(\d{{4}})\D{{0,20}}(?:年|Year)\D{{0,20}}(\d{{1,2}})\D{{0,20}}(?:月|Month)\D{{0,20}}(\d{{1,2}})\D{{0,20}}(?:日|Day)",
            text,
            flags=re.IGNORECASE,
        )
        if match:
            parsed = _format_ymd(match.group(1), match.group(2), match.group(3))
            if parsed:
                return parsed

        # Case 3: generic 3-number date, but only when fragment contains date units.
        match = re.search(
            rf"{label_pattern}[\s\S]{{0,180}}?(\d{{4}})\D+(\d{{1,2}})\D+(\d{{1,2}})",
            text,
            flags=re.IGNORECASE,
        )
        if not match:
            continue
        fragment = _clean_extracted_value(match.group(0))
        if not re.search(r"(年|月|日|year|month|day)", fragment, flags=re.IGNORECASE):
            continue
        parsed = _format_ymd(match.group(1), match.group(2), match.group(3))
        if parsed:
            return parsed
    return ""


def _parse_date_from_fragment(value: str) -> str:
    match = re.search(r"(\d{4}|\d{2})\D+(\d{1,2})\D+(\d{1,2})", value or "")
    if not match:
        return ""
    return _format_ymd(match.group(1), match.group(2), match.group(3))


def _format_ymd(year_text: str, month_text: str, day_text: str) -> str:
    year = (year_text or "").strip()
    if len(year) == 2:
        year = f"20{year}"
    try:
        month_num = int(month_text)
        day_num = int(day_text)
    except Exception:
        return ""
    if month_num < 1 or month_num > 12 or day_num < 1 or day_num > 31:
        return ""
    month = str(month_num).zfill(2)
    day = str(day_num).zfill(2)
    return f"{year}年{month}月{day}日"


def _parse_ymd_parts(date_text: str) -> tuple[int, int, int] | None:
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", _clean_extracted_value(date_text or ""))
    if not m:
        return None
    try:
        y = int(m.group(1))
        mm = int(m.group(2))
        dd = int(m.group(3))
        datetime(y, mm, dd)
    except Exception:
        return None
    return y, mm, dd


def _shift_date_text(date_text: str, days: int) -> str:
    parts = _parse_ymd_parts(date_text)
    if not parts:
        return ""
    y, mm, dd = parts
    dt = datetime(y, mm, dd) + timedelta(days=days)
    return f"{dt.year:04d}年{dt.month:02d}月{dt.day:02d}日"


def _normalize_report_dates(result: dict[str, str]) -> None:
    receive = _clean_extracted_value(result.get("receive_date", ""))
    calibration = _clean_extracted_value(result.get("calibration_date", ""))
    release = _clean_extracted_value(result.get("release_date", ""))

    if not _parse_ymd_parts(receive):
        receive = ""
    if not _parse_ymd_parts(calibration):
        calibration = ""
    if not _parse_ymd_parts(release):
        release = ""

    if not receive and calibration:
        receive = calibration
    if not calibration and receive:
        calibration = receive

    base = calibration or receive
    if not release and base:
        release = _shift_date_text(base, 1)
    if not receive and not calibration and release:
        prev = _shift_date_text(release, -1)
        if prev:
            receive = prev
            calibration = prev

    result["receive_date"] = receive
    result["calibration_date"] = calibration
    result["release_date"] = release


def _normalize_model_code(result: dict[str, str]) -> None:
    model = _clean_extracted_value(result.get("device_model", ""))
    code = _clean_extracted_value(result.get("device_code", ""))
    text = result.get("raw_record", "")

    model = _strip_model_label_noise(model)
    code = _strip_model_label_noise(code)
    model = _strip_model_tail_noise(model)
    code = _normalize_device_code_value(code)

    if re.search(r"型号\s*/\s*编号", text):
        combined_model, combined_code = _extract_combined_model_code(text)
        if combined_model and (not model or model == combined_code or model == code):
            model = combined_model
        if combined_code and (not code or code == model or ":" in code or "：" in code):
            code = combined_code

    if model and (model.startswith("/编号") or model.startswith("编号")) and code:
        result["device_model"] = code
        result["device_code"] = ""
        return

    if model and code and model == code:
        result["device_model"] = model
        result["device_code"] = ""
        return

    result["device_model"] = model
    result["device_code"] = code


def _extract_combined_model_code(text: str) -> tuple[str, str]:
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    for line in lines:
        if not re.search(r"型号\s*/\s*编号", line):
            continue
        candidate = re.sub(r".*?型号\s*/\s*编号\s*[:：]?\s*", "", line).strip()
        if not candidate:
            continue
        parts = [part.strip() for part in re.split(r"[:：]", candidate) if part.strip()]
        if len(parts) < 2:
            continue
        model = _strip_model_label_noise(parts[0])
        code = _normalize_device_code_value(parts[-1])
        if model and code:
            return model, code
    return "", ""


def _extract_model_code_value(lines: list[str]) -> str:
    for idx, line in enumerate(lines):
        if not re.search(r"型号\s*/\s*编号|型号规格|型号", line):
            continue
        same_line = re.split(r"[:：]", line, maxsplit=1)
        if len(same_line) == 2:
            value = _strip_model_label_noise(_clean_extracted_value(same_line[1]))
            if _looks_like_model_code(value):
                return value
        for j in range(idx + 1, min(idx + 4, len(lines))):
            candidate = _strip_model_label_noise(_clean_extracted_value(lines[j]))
            if _looks_like_model_code(candidate):
                return candidate
    token = _extract_model_code_token("\n".join(lines))
    if token:
        return token
    return ""


def _strip_model_label_noise(value: str) -> str:
    text = _clean_extracted_value(value or "")
    text = re.sub(r"^(?:型号\s*/\s*编号|型号规格|型号|编号)\s*[:：]?\s*", "", text)
    text = text.strip()
    if re.fullmatch(r"[/:：\- ]*", text):
        return ""
    if re.fullmatch(r"/?\s*编号\s*[:：]?\s*", text):
        return ""
    return text


def _looks_like_model_code(value: str) -> bool:
    if not value:
        return False
    if len(value) < 3:
        return False
    return bool(re.search(r"[A-Za-z0-9]", value))


def _extract_model_code_token(text: str) -> str:
    # Typical plate value like WRH-I:26030901F / DHG-N 300℃:26031201E
    matches = re.findall(r"([A-Za-z][A-Za-z0-9\- ℃]{1,30}:[A-Za-z0-9\-]{4,})", text)
    for token in matches:
        t = _clean_extracted_value(token)
        if re.search(r"(电话|温度|湿度|电源|功率)", t):
            continue
        return t
    return ""


def _extract_measurement_items(text: str) -> list[str]:
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    items: list[str] = []
    for line in lines:
        m = re.match(r"^\s*([一二三四五六七八九十百千万\d]{1,4})[、.．)]\s*(.+)$", line)
        if not m:
            continue
        prefix = _clean_extracted_value(m.group(1))
        # Avoid treating decimal values like "100.14" as list indices.
        if prefix.isdigit():
            try:
                idx = int(prefix)
            except Exception:
                idx = 0
            if idx <= 0 or idx >= 100:
                continue
        content = _clean_extracted_value(m.group(2))
        if not content:
            continue
        items.append(content)
    return items


def _extract_partial_discharge_fields(result: dict[str, str], text: str) -> None:
    source = str(text or "")
    if not source:
        return

    lines = [line.strip() for line in source.split("\n") if line.strip()]
    _fill_pd_series_if_empty(result, "pd_charge_values_pc", lines, ("电荷量", "放电量"))
    _fill_pd_series_if_empty(result, "pd_rise_time_values_ns", lines, ("上升沿",))
    _fill_pd_series_if_empty(result, "pd_pulse_amplitude_values_v", lines, ("脉冲幅值", "波形峰值"))

    if not _clean_extracted_value(result.get("pd_voltage_urel_percent", "")):
        result["pd_voltage_urel_percent"] = _extract_urel_percent_by_keywords(
            source,
            ("试验电压", "电压"),
        )
    if not _clean_extracted_value(result.get("pd_scan_time_urel_percent", "")):
        result["pd_scan_time_urel_percent"] = _extract_urel_percent_by_keywords(
            source,
            ("扫描时间", "扫描"),
        )
    if not _clean_extracted_value(result.get("pd_capacitance_urel_percent", "")):
        result["pd_capacitance_urel_percent"] = _extract_urel_percent_by_keywords(
            source,
            ("电容",),
        )
    if not _clean_extracted_value(result.get("pd_power_tolerance_urel_percent", "")):
        result["pd_power_tolerance_urel_percent"] = _extract_urel_percent_by_keywords(
            source,
            ("电流容差", "电源容差", "容差"),
        )
    if not _clean_extracted_value(result.get("pd_voltage_calibration_urel_percent", "")):
        result["pd_voltage_calibration_urel_percent"] = _extract_urel_percent_by_keywords(
            source,
            ("电压校准", "校准脉冲", "校准"),
        )


def _fill_pd_series_if_empty(
    result: dict[str, str],
    key: str,
    lines: list[str],
    keywords: tuple[str, ...],
) -> None:
    if _clean_extracted_value(result.get(key, "")):
        return

    preferred = ""
    fallback = ""
    for line in lines:
        if not any(keyword in line for keyword in keywords):
            continue
        values = _extract_numeric_values_from_line(line)
        if not values:
            continue
        joined = " ".join(values)
        if "实测" in line and not preferred:
            preferred = joined
        if not fallback:
            fallback = joined
    result[key] = preferred or fallback


def _extract_numeric_values_from_line(line: str) -> list[str]:
    values = re.findall(r"[+-]?\d+(?:\.\d+)?", line or "")
    return [str(value).strip() for value in values if str(value).strip()]


def _extract_urel_percent_by_keywords(text: str, keywords: tuple[str, ...]) -> str:
    source = str(text or "")
    if not source:
        return ""

    urel_pattern = re.compile(r"Urel\s*=\s*([+-]?\d+(?:\.\d+)?)\s*%?", flags=re.IGNORECASE)
    for line in source.split("\n"):
        normalized = line.strip()
        if not normalized:
            continue
        if not any(keyword in normalized for keyword in keywords):
            continue
        match = urel_pattern.search(normalized)
        if match:
            return _clean_extracted_value(match.group(1))

    for match in re.finditer(r"Urel\s*=\s*([+-]?\d+(?:\.\d+)?)\s*%?", source, flags=re.IGNORECASE):
        window_start = max(0, match.start() - 40)
        window_end = min(len(source), match.end() + 40)
        window = source[window_start:window_end]
        if any(keyword in window for keyword in keywords):
            return _clean_extracted_value(match.group(1))
    return ""


def _strip_model_tail_noise(value: str) -> str:
    text = _clean_extracted_value(value or "")
    if not text:
        return ""
    text = re.split(r"(输出容量|额定功率|Rated power|出厂编号|编号|Number|Serial)", text, maxsplit=1, flags=re.IGNORECASE)[0]
    text = text.strip(" /|;,")
    return text
