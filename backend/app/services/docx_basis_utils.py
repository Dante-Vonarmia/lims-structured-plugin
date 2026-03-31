import re
from typing import Any

from .docx_cell_utils import normalize_space


def extract_standard_code(value: str) -> str:
    codes = extract_standard_codes(value)
    if not codes:
        return ""
    return codes[0]


def extract_standard_codes(value: str) -> list[str]:
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


def extract_standard_codes_from_context_items(value: Any) -> list[str]:
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
        codes = extract_standard_codes(item)
        if not codes:
            continue
        for code in codes:
            if code in seen:
                continue
            seen.add(code)
            result.append(code)
    return result


def normalize_basis_mode(value: str) -> str:
    normalized_value = normalize_space(value)
    if normalized_value in {"校准", "calibration"}:
        return "校准"
    if normalized_value in {"检测", "test", "inspection"}:
        return "检测"
    return ""


def infer_basis_mode(text: str) -> str:
    normalized_text = normalize_space(text)
    if not normalized_text:
        return ""
    if re.search(r"(校准证书|本次校准|校准日期|校准依据)", normalized_text):
        return "校准"
    if re.search(r"(本次检测|检测日期|检测依据)", normalized_text):
        return "检测"
    return ""


def format_dual_mode_checkbox(mode: str) -> str:
    if mode == "检测":
        return "☑检测/□校准"
    if mode == "校准":
        return "□检测/☑校准"
    return "□检测/□校准"
