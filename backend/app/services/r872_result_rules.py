import re


def should_mark_r872_result(target_requirement: str, source_lines: list[str]) -> bool:
    target = normalize_space(target_requirement)
    if not target:
        return False
    lines = [normalize_space(x) for x in source_lines if normalize_space(x)]
    if not lines:
        return False
    source_text = "\n".join(lines)
    compact_target = _compact(target)
    compact_source = _compact(source_text)

    # 一般检查第(1)条：旋转夹头/双向旋转/转速稳定
    if _contains_any(compact_target, ("双向旋转", "旋转夹头", "转速均匀", "转速稳定")):
        return _contains_any(compact_source, ("双向旋转", "旋转夹头", "转速均匀", "转速稳定"))

    # 一般检查第(2)条：两夹具间距可调 + 最大距离(500mm)
    if _contains_any(compact_target, ("最大距离", "两夹具间距离", "标度尺")):
        has_distance = _contains_any(compact_source, ("两夹头间", "两夹具间", "距离"))
        has_500mm = bool(re.search(r"500\s*mm|500mm", source_text, flags=re.IGNORECASE))
        return has_distance and has_500mm

    # 一般检查第(3)条：施加负荷后试样平直
    if _contains_any(compact_target, ("施加负荷", "平直状态", "试样始终处于平直")):
        return _contains_any(compact_source, ("施加负荷", "平直状态", "试件处于平直", "试件始终处于平直"))

    # 一般检查第(4)条：扭转次数可设定 + 计数器指示
    if _contains_any(compact_target, ("扭转次数", "计数器")):
        return _contains_any(compact_source, ("扭转次数", "计数器", "次数记录装置"))

    # 一般检查第(5)条：负荷齐全/满足试验要求
    if _contains_any(compact_target, ("负荷齐全", "满足试验要求")):
        return _contains_any(compact_source, ("负荷齐全", "满足试验要求"))

    # 第二板块等其它条目：默认不勾（除非后续补规则）
    return False


def fill_r872_requirement_text(target_text: str, source_lines: list[str]) -> str:
    text = str(target_text or "")
    if not text:
        return text
    distance_mm = extract_r872_max_distance_mm(source_lines)
    if not distance_mm:
        return text
    compact = _compact(text)
    if "最大距离" not in compact:
        return text
    if re.search(r"最大(?:起始)?距离[:：]?\s*\d+(?:\.\d+)?\s*mm", text, flags=re.IGNORECASE):
        return text
    updated = re.sub(
        r"(最大(?:起始)?距离(?:为)?\s*)(?:[_＿\s]*)(mm)",
        rf"\g<1>{distance_mm}\g<2>",
        text,
        count=1,
        flags=re.IGNORECASE,
    )
    if updated != text:
        return updated
    return re.sub(
        r"(为\s*)(?:[_＿\s]*)(mm)",
        rf"\g<1>{distance_mm}\g<2>",
        text,
        count=1,
        flags=re.IGNORECASE,
    )


def extract_r872_max_distance_mm(source_lines: list[str]) -> str:
    text = "\n".join([normalize_space(x) for x in source_lines if normalize_space(x)])
    if not text:
        return ""
    match = re.search(
        r"最大(?:起始)?距离[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*mm",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return ""
    return normalize_space(match.group(1))


def _contains_any(text: str, words: tuple[str, ...]) -> bool:
    return any(word in text for word in words)


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value or "")


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u3000", " ")).strip()
