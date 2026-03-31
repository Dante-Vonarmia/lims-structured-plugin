import re
from functools import lru_cache


def _clean_extracted_value(value: str) -> str:
    cleaned = value.strip()
    cleaned = re.sub(r"^[：:\- ]+", "", cleaned)
    return cleaned.strip()


def _looks_like_model_code(value: str) -> bool:
    token = _clean_extracted_value(value)
    if not token:
        return False
    compact = re.sub(r"\s+", "", token)
    if not (4 <= len(compact) <= 80):
        return False
    if not re.search(r"[A-Za-z]", compact):
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9\-_./]+", compact))


def _parse_ymd_parts(date_text: str) -> tuple[int, int, int] | None:
    text = _clean_extracted_value(date_text)
    if not text:
        return None
    match = re.search(r"(\d{4})\D*(\d{1,2})\D*(\d{1,2})", text)
    if not match:
        return None
    try:
        year = int(match.group(1))
        month = int(match.group(2))
        day = int(match.group(3))
    except ValueError:
        return None
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return year, month, day


def _normalize_device_code_value(value: str) -> str:
    text = _clean_extracted_value(value or "")
    if not text:
        return ""
    text = _strip_english_label_prefix(text)
    text = re.sub(r"^(?:出厂编号|设备编号|器具编号|编号|No\.?|Serial(?:\s*No\.?)?|Number)\s*[:：]?\s*", "", text, flags=re.IGNORECASE)
    text = re.split(r"(输出容量|额定功率|Rated power)", text, maxsplit=1, flags=re.IGNORECASE)[0]
    text = text.strip(" /|;,")
    compact_candidate = re.sub(r"\s+", "", text)
    if compact_candidate and re.fullmatch(r"[A-Za-z0-9\-_./]+", compact_candidate):
        text = compact_candidate
    return text


def _strip_placeholder_values(result: dict[str, str]) -> None:
    if _is_placeholder_name(result.get("device_name", "")):
        result["device_name"] = ""
    if _is_placeholder_model(result.get("device_model", "")):
        result["device_model"] = ""
    if _is_placeholder_code(result.get("device_code", "")):
        result["device_code"] = ""


def _normalize_placeholder_token(value: str) -> str:
    return re.sub(r"[\s:：/\\\-_.|*（）()]+", "", (value or "").strip()).lower()


def _is_unit_or_client_line(value: str) -> bool:
    token = _normalize_placeholder_token(value)
    if not token:
        return False
    return token.startswith("单位名称") or token.startswith("委托单位") or token.startswith("client")


def _is_placeholder_name(value: str) -> bool:
    token = _normalize_placeholder_token(value)
    return token in {
        "instrumentname",
        "devicename",
        "equipmentname",
        "器具名称",
        "设备名称",
        "仪器名称",
    }


def _is_placeholder_model(value: str) -> bool:
    token = _normalize_placeholder_token(value)
    if not token:
        return False
    return any(
        marker in token
        for marker in (
            "modelspecification",
            "instrumentserialnumber",
            "型号编号",
            "型号规格",
        )
    )


def _is_placeholder_code(value: str) -> bool:
    token = _normalize_placeholder_token(value)
    if not token:
        return False
    return token in {"instrumentserialnumber", "serialnumber"}


def _normalize_label_token(value: str) -> str:
    text = re.sub(r"[\s\u3000]+", "", value or "")
    text = re.sub(r"[：:]", "", text)
    return text.lower()


def _looks_like_english_label(value: str) -> bool:
    text = _clean_extracted_value(value)
    if not text:
        return False
    if not re.search(r"[A-Za-z]", text):
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9\s/().,_-]{2,120}", text))


def _strip_english_label_prefix(value: str) -> str:
    text = _clean_extracted_value(value or "")
    while True:
        parts = re.split(r"[:：]", text, maxsplit=1)
        if len(parts) < 2:
            break
        left = _clean_extracted_value(parts[0])
        right = _clean_extracted_value(parts[1])
        if not right:
            break
        if _looks_like_model_code(left) and re.fullmatch(r"[A-Za-z0-9\-_./]{3,60}", right):
            break
        if _looks_like_english_label(left):
            text = right
            continue
        break
    return text


STRUCTURED_FIELD_LABELS: dict[str, tuple[str, ...]] = {
    "device_name": ("器具名称", "设备名称", "仪器名称", "instrument name"),
    "device_model": ("型号/规格", "型号规格", "型号", "model/specification", "model"),
    "device_code": ("器具编号", "设备编号", "编号", "instrument serial number", "serial number"),
    "manufacturer": ("制造厂/商", "生产厂商", "制造厂商", "manufacturer"),
    "unit_name": ("委托单位", "单位名称", "client"),
    "address": ("地址", "地 址", "address"),
    "contact_info": ("联系方式", "电话", "tel", "contact"),
    "certificate_no": ("缆专检号", "certificate series number", "certificate no"),
    "receive_date": ("收样日期", "received date"),
    "calibration_date": ("校准日期",),
    "release_date": ("发布日期", "发布日期", "issue date", "date of issue", "date of publication"),
    "location": ("地点", "校准地点"),
    "basis_standard": (
        "本次校准所依据的技术规范",
        "技术规范代号",
        "检测依据",
        "校准依据",
        "检测/校准依据",
        "reference documents for the calibration",
    ),
}


def _extract_structured_line_pairs(text: str) -> dict[str, str]:
    pairs: dict[str, str] = {}
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    for idx, line in enumerate(lines):
        match = re.match(r"^([^:：]{1,80})[:：]\s*(.*)$", line)
        if not match:
            continue
        label = _clean_extracted_value(match.group(1))
        value = _clean_extracted_value(match.group(2))
        if not label:
            continue
        label_token = _resolve_structured_label_token(label)
        if not label_token:
            continue
        label_field_key = _structured_label_token_to_field().get(label_token, "")
        value = _strip_english_label_prefix(value)
        if not value or _is_low_quality_pair_candidate(value):
            value = _pick_structured_following_value(lines, idx + 1, label_field_key)
        if not value:
            continue
        if _is_low_quality_pair_candidate(value):
            continue
        current = pairs.get(label_token, "")
        if current and not _is_low_quality_pair_candidate(current):
            continue
        pairs[label_token] = value

    for idx, line in enumerate(lines):
        if ":" in line or "：" in line:
            continue
        label_token = _resolve_structured_label_token(line)
        if not label_token:
            continue
        label_field_key = _structured_label_token_to_field().get(label_token, "")
        value = _pick_structured_following_value(lines, idx + 1, label_field_key)
        if not value or _is_low_quality_pair_candidate(value):
            continue
        current = pairs.get(label_token, "")
        if current and not _is_low_quality_pair_candidate(current):
            continue
        pairs[label_token] = value
    return pairs


def _pick_structured_following_value(lines: list[str], start_index: int, expected_field_key: str = "") -> str:
    end_index = min(start_index + 4, len(lines))
    for idx in range(start_index, end_index):
        raw_line = _clean_extracted_value(lines[idx])
        if not raw_line:
            continue
        line_field_key = _resolve_structured_label_field(raw_line)
        if line_field_key:
            if expected_field_key and line_field_key == expected_field_key:
                continue
            break
        candidate = raw_line
        candidate = _strip_english_label_prefix(candidate)
        if not candidate:
            continue
        if _looks_like_structured_label_line(candidate):
            continue
        if _is_low_quality_pair_candidate(candidate):
            continue
        return candidate
    return ""


def _looks_like_structured_label_line(value: str) -> bool:
    if _resolve_structured_label_token(value):
        return True
    token = _normalize_placeholder_token(value)
    if not token:
        return False
    if token in {
        "器具名称",
        "设备名称",
        "仪器名称",
        "instrumentname",
        "型号规格",
        "型号",
        "规格",
        "modelspecification",
        "model",
        "器具编号",
        "设备编号",
        "编号",
        "instrumentserialnumber",
        "serialnumber",
        "制造厂商",
        "生产厂商",
        "manufacturer",
        "委托单位",
        "单位名称",
        "client",
        "地址",
        "address",
        "联系方式",
        "电话",
        "contact",
        "tel",
        "缆专检号",
        "certificateseriesnumber",
        "certificateno",
        "收样日期",
        "receiveddate",
        "校准日期",
        "dateforcalibration",
        "发布日期",
        "发布日期",
        "issuedate",
        "dateofissue",
        "dateofpublication",
        "地点",
        "校准地点",
    }:
        return True
    return any(
        marker in token
        for marker in (
            "instrumentname",
            "modelspecification",
            "model",
            "instrumentserialnumber",
            "serialnumber",
            "manufacturer",
            "certificateseriesnumber",
            "器具名称",
            "型号规格",
            "器具编号",
            "制造厂商",
            "生产厂商",
        )
    )


@lru_cache(maxsize=1)
def _structured_label_token_to_field() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for field_key, labels in STRUCTURED_FIELD_LABELS.items():
        for label in labels:
            token = _normalize_label_token(label)
            if not token:
                continue
            mapping[token] = field_key
    return mapping


@lru_cache(maxsize=1)
def _structured_label_tokens_by_length() -> tuple[str, ...]:
    tokens = tuple(_structured_label_token_to_field().keys())
    return tuple(sorted(tokens, key=len, reverse=True))


def _resolve_structured_label_token(value: str) -> str:
    text = _clean_extracted_value(value or "")
    if not text:
        return ""
    token = _normalize_label_token(text)
    if not token:
        return ""
    token_to_field = _structured_label_token_to_field()
    if token in token_to_field:
        return token
    for known_token in _structured_label_tokens_by_length():
        if known_token and known_token in token:
            return known_token
    return ""


def _resolve_structured_label_field(value: str) -> str:
    token = _resolve_structured_label_token(value)
    if not token:
        return ""
    return _structured_label_token_to_field().get(token, "")


def _is_low_quality_pair_candidate(value: str) -> bool:
    token = _normalize_label_token(value)
    if not token:
        return True
    if "measurementrange" in token or "测量范围" in token:
        return True
    if _looks_like_structured_label_line(value):
        return True
    if _is_placeholder_name(value) or _is_placeholder_model(value) or _is_placeholder_code(value):
        return True
    return False


def _pick_structured_value(pairs: dict[str, str], labels: tuple[str, ...]) -> str:
    for label in labels:
        token = _normalize_label_token(label)
        value = _clean_extracted_value(pairs.get(token, ""))
        value = _strip_english_label_prefix(value)
        if not value:
            continue
        if _is_low_quality_pair_candidate(value):
            continue
        return value
    return ""


def _apply_structured_pairs(result: dict[str, str], pairs: dict[str, str]) -> None:
    if not pairs:
        return
    for field_key, labels in STRUCTURED_FIELD_LABELS.items():
        value = _pick_structured_value(pairs, labels)
        if not value:
            continue
        current_value = _clean_extracted_value(result.get(field_key, ""))
        if current_value and not _is_low_quality_field_value(field_key, current_value):
            continue
        result[field_key] = value


def _is_low_quality_field_value(field_key: str, value: str) -> bool:
    text = _clean_extracted_value(value)
    if not text:
        return True
    if _is_low_quality_pair_candidate(text):
        return True
    token = _normalize_placeholder_token(text)
    if field_key == "device_name":
        return _is_placeholder_name(text)
    if field_key == "device_model":
        return _is_placeholder_model(text) or token in {"型号", "规格", "型号规格", "modelspecification"}
    if field_key == "device_code":
        if _is_placeholder_code(text) or token in {"编号", "器具编号", "设备编号", "serialnumber"}:
            return True
        compact = re.sub(r"\s+", "", text)
        if not re.search(r"\d", compact) and not re.search(r"[A-Za-z]{2,}", compact):
            return True
        return False
    if field_key == "manufacturer":
        return token in {"manufacturer", "制造厂商", "生产厂商", "厂家", "厂商"}
    if field_key == "receive_date":
        if token in {"收样日期", "receiveddate"}:
            return True
        return _parse_ymd_parts(text) is None
    if field_key == "calibration_date":
        if token in {"校准日期", "dateforcalibration"}:
            return True
        return _parse_ymd_parts(text) is None
    if field_key == "release_date":
        if token in {"发布日期", "发布日期", "issuedate", "dateofissue", "dateofpublication"}:
            return True
        return _parse_ymd_parts(text) is None
    return False

