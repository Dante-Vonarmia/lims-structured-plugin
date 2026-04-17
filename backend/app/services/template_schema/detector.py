from pathlib import Path
import re
import zipfile
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}
DOC_XML_PATH = "word/document.xml"


def read_docx_text(path: Path) -> str:
    if not path.exists() or path.suffix.lower() != ".docx":
        return ""
    try:
        with zipfile.ZipFile(path, "r") as zin:
            if DOC_XML_PATH not in zin.namelist():
                return ""
            xml_data = zin.read(DOC_XML_PATH)
    except Exception:
        return ""
    try:
        root = ET.fromstring(xml_data)
    except Exception:
        return ""
    chunks: list[str] = []
    for paragraph in root.findall(".//w:p", NS):
        line = "".join((node.text or "") for node in paragraph.findall(".//w:t", NS))
        line = normalize_text(line)
        if line:
            chunks.append(line)
    return "\n".join(chunks)


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u3000", " ")).strip()


def contains_any(text: str, markers: tuple[str, ...]) -> bool:
    normalized = normalize_text(text)
    return any(marker in normalized for marker in markers)


def detect_candidate_field_keys(template_name: str, text: str) -> list[str]:
    keys: list[str] = []

    def push(key: str) -> None:
        if key not in keys:
            keys.append(key)

    normalized_name = normalize_text(template_name)
    normalized_text = normalize_text(text)
    source = f"{normalized_name}\n{normalized_text}"

    # Core fields
    for key in ("certificate_no", "device_name", "manufacturer", "device_model", "device_code"):
        push(key)

    if contains_any(source, ("检测/校准依据", "检测依据", "校准依据", "依据")):
        push("basis_mode")
        push("basis_standard")
    if contains_any(source, ("检测/校准地点", "检测地点", "校准地点", "地点")):
        push("location")
    if contains_any(source, ("温度",)):
        push("temperature")
    if contains_any(source, ("湿度", "%RH", "RH")):
        push("humidity")
    if contains_any(source, ("一般检查", "校准结果", "结果：")):
        push("general_check_full")
    if contains_any(source, ("检测项目", "测量项目", "主要计量标准气瓶")):
        push("measurement_items")

    # High-voltage measurement profile
    if contains_any(source, ("高电压测量系统", "分压器测量系统", "Urel", "线性度", "Ux", "U2", "Fi")):
        for key in (
            "urel_percent",
            "voltage_range_1",
            "voltage_indicated_values_1",
            "voltage_actual_values_1",
            "voltage_range_2",
            "voltage_indicated_values_2",
            "voltage_actual_values_2",
            "voltage_range_3",
            "voltage_indicated_values_3",
            "voltage_actual_values_3",
            "linearity_ux_values",
            "linearity_u2_values",
            "linearity_fi_values",
            "linearity_f_avg",
            "linearity_fi_delta_percent",
        ):
            push(key)

    # Partial discharge profile
    if contains_any(source, ("局放", "部分放电", "PDIV", "PDEV", "放电量", "脉冲幅值", "上升沿")):
        for key in (
            "pd_charge_values_pc",
            "pd_charge_avg_pc",
            "pd_rise_time_values_ns",
            "pd_rise_time_avg_ns",
            "pd_pulse_amplitude_values_v",
            "pd_pulse_amplitude_avg_v",
            "pd_voltage_urel_percent",
            "pd_scan_time_urel_percent",
            "pd_capacitance_urel_percent",
            "pd_power_tolerance_urel_percent",
            "pd_voltage_calibration_urel_percent",
        ):
            push(key)

    # Shield room profile
    if contains_any(source, ("屏蔽室", "屏蔽效能", "背景噪声", "P1(dBm)", "P2(dBm)")):
        for key in (
            "shield_background_noise_0kv_pc",
            "shield_background_noise_working_kv_pc",
            "shield_p1_dbm_values",
            "shield_p2_dbm_values",
            "shield_se_db_values",
            "shield_se_avg_db",
        ):
            push(key)

    # Breakdown voltage profile
    if contains_any(source, ("击穿电压", "耐压", "标准偏差")):
        for key in (
            "breakdown_voltage_values_kv",
            "breakdown_voltage_avg_kv",
            "breakdown_voltage_stddev_kv",
        ):
            push(key)

    return keys
