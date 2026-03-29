from difflib import SequenceMatcher
import re


def extract_source_general_check_lines(text: str) -> list[str]:
    normalized_block = _normalize_space(text)
    if not normalized_block:
        return []
    candidate_lines = str(text or "").splitlines()
    # Some OCR/table exports collapse rows into one line; split by numbered items.
    if len(candidate_lines) <= 2:
        exploded = re.split(r"(?=\(\d+\))", str(text or ""))
        if len(exploded) > len(candidate_lines):
            candidate_lines = exploded

    result: list[str] = []
    for raw in candidate_lines:
        line = _normalize_space(raw)
        if not line:
            continue
        if re.search(r"^(?:[一二三四五六七八九十]+[、.．)]\s*)?一般检查[:：]?$", line):
            continue
        line = re.sub(r"^\(?\d+\)?[、.．)]?\s*", "", line).strip()
        if len(line) < 4:
            continue
        result.append(line)
    return result


def match_best_source_line(
    target_text: str,
    source_lines: list[str],
    used_indexes: set[int] | None = None,
    threshold: float = 0.42,
) -> tuple[int, float]:
    used = used_indexes or set()
    target = _normalize_for_similarity(target_text)
    if not target:
        return -1, 0.0

    best_idx = -1
    best_score = 0.0
    for idx, source in enumerate(source_lines):
        if idx in used:
            continue
        candidate = _normalize_for_similarity(source)
        if not candidate:
            continue
        score = _similarity(target, candidate)
        if score > best_score:
            best_score = score
            best_idx = idx
    if best_score < threshold:
        return -1, best_score
    return best_idx, best_score


def _similarity(a: str, b: str) -> float:
    ratio = SequenceMatcher(None, a, b).ratio()
    aset = set(a)
    bset = set(b)
    overlap = len(aset & bset) / max(1, len(aset | bset))
    return max(ratio, overlap)


def _normalize_for_similarity(text: str) -> str:
    value = _normalize_space(text).lower()
    value = re.sub(r"^\(?\d+\)?[、.．)]?\s*", "", value)
    value = re.sub(r"[（）()【】\[\]{}《》“”\"'、,，.:：;；/\\|_+\-\s]", "", value)
    value = value.replace("旋转夹头", "夹头").replace("定位夹头", "夹头")
    value = value.replace("两夹头", "两夹具").replace("夹头间", "夹具间")
    value = value.replace("最大起始距离", "最大距离")
    value = re.sub(r"(结果|一般检查|应为|为|可以|能够|能|可|进行|满足|要求)$", "", value)
    return value


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u3000", " ")).strip()
