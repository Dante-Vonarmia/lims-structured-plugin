import re

from .extract_structured_service import (
    _is_low_quality_field_value,
    _is_low_quality_pair_candidate,
    _is_placeholder_code,
    _is_placeholder_model,
    _normalize_device_code_value,
    _pick_structured_following_value,
    _resolve_structured_label_field,
    _strip_english_label_prefix,
)


def _clean_extracted_value(value: str) -> str:
    cleaned = value.strip()
    cleaned = re.sub(r"^[：:\- ]+", "", cleaned)
    return cleaned.strip()


def _strip_model_label_noise(value: str) -> str:
    text = _clean_extracted_value(value)
    if not text:
        return ""
    text = re.sub(
        r"(?i)^(?:"
        r"型号/编号|型号规格|规格型号|型号|model/specification|model|specification|"
        r"type\s*model|instrument\s*serial\s*number|serial\s*number|number"
        r")\s*[:：]?\s*",
        "",
        text,
    )
    text = _strip_english_label_prefix(text)
    text = text.strip(" /|;,")
    return text


def _apply_source_profile_context(result: dict[str, str], text: str) -> None:
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    groups = _extract_device_base_groups(lines)
    group_count = len(groups)
    result["device_group_count"] = str(group_count)
    result["device_group_summary"] = _build_device_group_summary(groups)

    if groups:
        primary = groups[0]
        for field_key in ("device_name", "device_model", "device_code"):
            current_value = _clean_extracted_value(result.get(field_key, ""))
            force_replace = False
            if field_key == "device_model" and current_value and primary.get(field_key):
                normalized_code = _normalize_device_code_value(result.get("device_code", ""))
                if normalized_code and normalized_code in current_value:
                    force_replace = True
            if current_value and not force_replace and not _is_low_quality_field_value(field_key, current_value):
                continue
            candidate = _clean_extracted_value(primary.get(field_key, ""))
            if not candidate:
                continue
            result[field_key] = candidate

    profile, profile_label = _detect_source_profile(text, groups)
    result["source_profile"] = profile
    result["source_profile_label"] = profile_label
    result["has_measurement_scope"] = "1" if _has_measurement_scope(text) else "0"


def _extract_device_base_groups(lines: list[str]) -> list[dict[str, str]]:
    groups: list[dict[str, str]] = []
    current = {"device_name": "", "device_model": "", "device_code": ""}

    for idx, line in enumerate(lines):
        match = re.match(r"^([^:：]{1,80})[:：]\s*(.*)$", line)
        if not match:
            continue
        label = _clean_extracted_value(match.group(1))
        if not label:
            continue
        field_key = _resolve_structured_label_field(label)
        if field_key not in {"device_name", "device_model", "device_code"}:
            continue

        value = _clean_extracted_value(match.group(2))
        value = _strip_english_label_prefix(value)
        if field_key == "device_name":
            if not value:
                value = _pick_structured_following_value(lines, idx + 1, field_key)
            elif _is_low_quality_pair_candidate(value):
                continue
        elif not value or _is_low_quality_pair_candidate(value):
            value = _pick_structured_following_value(lines, idx + 1, field_key)
        if not value or _is_low_quality_pair_candidate(value):
            continue

        if field_key == "device_name":
            if _looks_like_environment_context(value):
                continue
            if current["device_name"] and (current["device_model"] or current["device_code"]):
                groups.append(current)
                current = {"device_name": "", "device_model": "", "device_code": ""}
            current["device_name"] = value
            continue

        if field_key == "device_model":
            model_candidate, code_candidate = _split_combined_model_code_value(value)
            current["device_model"] = model_candidate or _strip_model_label_noise(value)
            if code_candidate and not current["device_code"]:
                current["device_code"] = code_candidate
            continue

        current["device_code"] = _normalize_device_code_value(value)

    if current["device_name"] or current["device_model"] or current["device_code"]:
        groups.append(current)

    normalized_groups: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    seen_codes: set[str] = set()
    for row in groups:
        name = _clean_extracted_value(row.get("device_name", ""))
        model = _strip_model_label_noise(row.get("device_model", ""))
        code = _normalize_device_code_value(row.get("device_code", ""))
        if not name:
            continue
        if _looks_like_environment_context(name):
            continue
        if not model and not code:
            continue
        if ":" in name and (not model or _is_placeholder_model(model)) and code and code in seen_codes:
            continue
        if _looks_like_measurement_standard_item_name(name) and (not model or _is_placeholder_model(model)) and code and code in seen_codes:
            continue
        token = (name, model, code)
        if token in seen:
            continue
        seen.add(token)
        if code:
            seen_codes.add(code)
        normalized_groups.append({"device_name": name, "device_model": model, "device_code": code})
    return normalized_groups


def _split_combined_model_code_value(value: str) -> tuple[str, str]:
    text = _clean_extracted_value(value or "")
    if not text:
        return "", ""
    parts = [part.strip() for part in re.split(r"[:：]", text) if part.strip()]
    if len(parts) < 2:
        return "", ""
    model = _strip_model_label_noise(parts[0])
    code = _normalize_device_code_value(parts[-1])
    if not model or not code:
        return "", ""
    if _is_placeholder_model(model) or _is_placeholder_code(code):
        return "", ""
    return model, code


def _build_device_group_summary(groups: list[dict[str, str]]) -> str:
    if not groups:
        return ""
    rows: list[str] = []
    for idx, item in enumerate(groups, 1):
        name = _clean_extracted_value(item.get("device_name", "")) or "-"
        model = _clean_extracted_value(item.get("device_model", "")) or "-"
        code = _clean_extracted_value(item.get("device_code", "")) or "-"
        rows.append(f"{idx}. {name} | {model} | {code}")
    return "\n".join(rows)


def _has_measurement_scope(text: str) -> bool:
    return bool(
        re.search(
            r"(测量范围|检测范围|温度范围|measurement\s*range|range\s*/\s*accuracy)",
            text,
            flags=re.IGNORECASE,
        )
    )


def _looks_like_environment_context(value: str) -> bool:
    text = _clean_extracted_value(value or "")
    if not text:
        return False
    return bool(re.search(r"(温度[:：]|湿度[:：]|ambient\s*temperature|others|%RH|环境)", text, flags=re.IGNORECASE))


def _looks_like_measurement_standard_item_name(value: str) -> bool:
    text = _clean_extracted_value(value or "")
    if not text:
        return False
    return bool(
        re.search(
            r"(数字温度表|热电偶|铜卷尺|测量范围|溯源机构|证书编号|有效期限|measurement\s*range|traceability|certificate\s*number)",
            text,
            flags=re.IGNORECASE,
        )
    )


def _detect_source_profile(text: str, groups: list[dict[str, str]]) -> tuple[str, str]:
    if len(groups) >= 2:
        return "multi_device_baseinfo_word", "多基础信息Word"

    marker_patterns = (
        r"原始记录",
        r"缆专检号",
        r"委托单位|单位名称",
        r"收样日期|校准日期",
        r"扩展不确定度|不确定度",
        r"测量范围|检测范围|measurement\s*range",
    )
    hit_count = 0
    for pattern in marker_patterns:
        if re.search(pattern, text, flags=re.IGNORECASE):
            hit_count += 1

    if hit_count >= 3:
        return "template_form_word", "模板单记录Word"

    if _has_measurement_scope(text):
        return "single_device_with_scope", "单设备含范围"

    return "single_device_general", "单设备通用"


def _find_first(lines: list[str], pattern: str) -> str:
    for line in lines:
        if re.search(pattern, line, flags=re.IGNORECASE):
            return line
    return ""


def _extract_model_token(line: str) -> str:
    candidates = re.findall(r"[A-Za-z0-9][A-Za-z0-9\-_/]{3,}", line)
    for item in candidates:
        if re.search(r"[A-Za-z]", item) and re.search(r"\d", item):
            return item
    return ""

