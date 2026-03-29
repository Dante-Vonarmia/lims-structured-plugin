import re
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.result_check_matcher import extract_source_general_check_lines, match_best_source_line
from app.services.semantic_fill_lib import (
    extract_measured_value_items,
    extract_uncertainty_items,
    is_reliable_result_semantic_match,
)


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def evaluate_marks(detail_general_check: str, targets: list[str]) -> list[bool]:
    source_lines = extract_source_general_check_lines(detail_general_check)
    used_indexes: set[int] = set()
    marks: list[bool] = []
    for target in targets:
        idx, _ = match_best_source_line(
            target_text=target,
            source_lines=source_lines,
            used_indexes=used_indexes,
            threshold=0.30,
        )
        marked = idx >= 0 and is_reliable_result_semantic_match(target, source_lines[idx], normalize_space=normalize_space)
        marks.append(marked)
        if marked:
            used_indexes.add(idx)
    return marks


def pick_requirement_targets_from_docx_lines(lines: list[str], limit: int = 5) -> list[str]:
    targets: list[str] = []
    for raw in lines:
        line = normalize_space(raw)
        if not line:
            continue
        compact = re.sub(r"\s+", "", line)
        if compact.startswith("结果"):
            continue
        if any(k in line for k in ("实测值", "标准值", "显示值", "型号", "编号", "制造厂", "核验员", "检测员", "校准员")):
            continue
        if not re.search(r"[\u4e00-\u9fff]", line):
            continue
        if re.search(r"^[（(]?\d+[)）]", line) or re.search(r"^\d+[.)．]", line):
            targets.append(line)
            if len(targets) >= limit:
                break
    return targets


def pick_measurement_targets_from_docx_lines(lines: list[str], limit: int = 4) -> list[str]:
    targets: list[str] = []
    for raw in lines:
        line = normalize_space(raw)
        if not line:
            continue
        compact = re.sub(r"\s+", "", line)
        if compact.startswith("结果"):
            continue
        if any(k in line for k in ("实测值", "标准值", "显示值", "型号", "编号", "制造厂", "核验员", "检测员", "校准员")):
            continue
        if not re.search(r"[\u4e00-\u9fff]", line):
            continue
        if not (re.search(r"^[（(]?\d+[)）]", line) or re.search(r"^\d+[.)．]", line)):
            continue
        if not any(k in compact for k in ("应为", "校准", "扩展不确定度", "夹角", "力值", "温度", "电阻", "距离", "宽度")):
            continue
        targets.append(line)
        if len(targets) >= limit:
            break
    return targets


def _pick_unit_for_target(text: str) -> str:
    raw = str(text or "")
    if any(x in raw for x in ("℃", "°C", "°c")):
        return "℃"
    if "°" in raw:
        return "°"
    if "N" in raw or "牛" in raw:
        return "N"
    if any(x in raw for x in ("Ω", "ω", "欧姆", "ohm", "Ohm")):
        return "Ω"
    if "mm" in raw or "MM" in raw:
        return "mm"
    return ""


def build_detail_general_check_from_targets(
    targets: list[str],
    missing_indexes: set[int] | None = None,
) -> str:
    missing = missing_indexes or set()
    lines: list[str] = ["一、一般检查：", "试验仪能水平放置。"]
    for idx, target in enumerate(targets, start=1):
        if (idx - 1) in missing:
            continue
        unit = _pick_unit_for_target(target)
        lines.append(f"{target}： U={idx}{unit},k=2")
        lines.append(f"实测值： {idx}{unit}。")
    return "\n".join(lines)


def evaluate_measurement_fill_behavior(targets: list[str], missing_indexes: set[int] | None = None) -> dict:
    detail_general_check = build_detail_general_check_from_targets(targets, missing_indexes=missing_indexes)
    marks = evaluate_marks(detail_general_check, targets)
    uncertainty_items = extract_uncertainty_items(detail_general_check, normalize_space=normalize_space)
    measured_items = extract_measured_value_items(detail_general_check, normalize_space=normalize_space)
    return {
        "detail_general_check": detail_general_check,
        "marks": marks,
        "uncertainty_count": len(uncertainty_items),
        "measured_count": len(measured_items),
    }
