from pathlib import Path
import re
import shutil
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from typing import Callable
from typing import Iterable
from uuid import uuid4

from ..config import OUTPUT_DIR, TEMPLATE_DIR
from .fixed_template_mapping_service import (
    fill_generic_record_docx,
    fill_r802b_docx,
    build_r803b_editor_fields,
    fill_r801b_docx,
    fill_r803b_docx,
    fill_r825b_docx,
)
from .template_mapping_library_service import (
    match_mapping_code_by_keywords,
    resolve_handler_key,
)

try:
    from jinja2 import Template
except Exception:  # pragma: no cover - optional runtime dependency
    Template = None

try:
    from docxtpl import DocxTemplate
except Exception:  # pragma: no cover - optional runtime dependency
    DocxTemplate = None

ALLOWED_TEMPLATE_SUFFIXES = {".html", ".docx"}
FIXED_DOCX_HANDLERS: dict[
    str,
    Callable[[Path, Path, dict[str, str], Path | None], bool],
] = {
    "r802b": fill_r802b_docx,
    "r801b": fill_r801b_docx,
    "r803b": fill_r803b_docx,
    "r825b": fill_r825b_docx,
}


class FixedTemplateFillError(RuntimeError):
    pass


def render_report(
    template_name: str,
    context: dict[str, str],
    source_file_path: Path | None = None,
) -> tuple[str, Path]:
    context = _normalize_context_aliases(context)
    context = _normalize_report_dates(context)
    template_path = TEMPLATE_DIR / template_name
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_name}")

    report_id = uuid4().hex
    suffix = template_path.suffix.lower()
    if suffix == ".html":
        output_path = OUTPUT_DIR / _build_output_file_name(report_id, template_path.name)
        if Template is None:
            shutil.copyfile(template_path, output_path)
            return report_id, output_path
        try:
            html_template = Template(template_path.read_text(encoding="utf-8"))
            rendered_html = html_template.render(**context)
            output_path.write_text(rendered_html, encoding="utf-8")
        except Exception:
            shutil.copyfile(template_path, output_path)
        return report_id, output_path

    output_path = OUTPUT_DIR / _build_output_file_name(report_id, template_path.name)

    handler_key = resolve_handler_key(template_name) or _infer_fixed_handler_key(template_name)
    handler = FIXED_DOCX_HANDLERS.get(handler_key or "")
    if handler:
        if handler(
            template_path=template_path,
            output_path=output_path,
            context=context,
            source_file_path=source_file_path,
        ):
            return report_id, output_path
        raise FixedTemplateFillError(
            f"Mapped template fill failed: template={template_name}, handler={handler_key or 'unknown'}",
        )

    if fill_generic_record_docx(
        template_path=template_path,
        output_path=output_path,
        context=context,
        source_file_path=source_file_path,
    ):
        return report_id, output_path

    # Keep demo flow stable: if a template is not a valid docxtpl document,
    # still output a copy so the end-to-end flow can be demonstrated.
    if DocxTemplate is None:
        shutil.copyfile(template_path, output_path)
        return report_id, output_path

    try:
        doc = DocxTemplate(str(template_path))
        doc.render(context)
        doc.save(str(output_path))
    except Exception:
        shutil.copyfile(template_path, output_path)

    return report_id, output_path


def list_available_templates() -> list[str]:
    return sorted(
        [
            p.name
            for p in TEMPLATE_DIR.iterdir()
            if p.is_file() and p.suffix.lower() in ALLOWED_TEMPLATE_SUFFIXES
        ]
    )


def get_template_editor_prefill(
    template_name: str,
    context: dict[str, str],
    source_file_path: Path | None = None,
) -> dict[str, str]:
    handler_key = resolve_handler_key(template_name) or _infer_fixed_handler_key(template_name)
    if handler_key == "r803b":
        return build_r803b_editor_fields(
            context=context,
            source_file_path=source_file_path,
        )
    return {}


def match_template_name(
    raw_text: str,
    file_name: str | None,
    templates: Iterable[str],
) -> tuple[str | None, str | None]:
    template_list = list(templates)
    if not template_list:
        return None, None

    normalized_source = _normalize_source_for_match(f"{file_name or ''}\n{raw_text or ''}")
    if not normalized_source:
        return None, None

    name_hints = _build_name_hints(raw_text=raw_text, file_name=file_name)
    template_code = _extract_template_code(normalized_source)
    if template_code:
        candidates = _match_by_code(template_code, template_list)
        if len(candidates) == 1:
            return candidates[0], f"code:{template_code}"
        if candidates:
            matched_by_name = _match_by_name_hints(name_hints, candidates)
            if matched_by_name:
                return matched_by_name, f"code+name:{template_code}"

    library_code = match_mapping_code_by_keywords(normalized_source)
    if library_code:
        candidates = _match_by_code(library_code, template_list)
        if candidates:
            matched_by_name = _match_by_name_hints(name_hints, candidates)
            if matched_by_name:
                return matched_by_name, f"library+name:{library_code}"
            return _prefer_docx(candidates), f"library:{library_code}"

    matched_by_name = _match_by_name_hints(name_hints, template_list)
    if matched_by_name:
        return matched_by_name, "name:fuzzy"

    return None, None


def _normalize_for_match(value: str) -> str:
    return re.sub(r"\s+", "", value).lower()


def _normalize_source_for_match(value: str) -> str:
    normalized = _normalize_for_match(value)
    # 同义词归一：客户输入“软击穿”时，映射到模板库关键词“软化击穿”
    return normalized.replace("软击穿", "软化击穿")


def _extract_template_code(text: str) -> str | None:
    match = re.search(r"(?:r[-_ ]?)?(\d{3}[a-z])", text, flags=re.IGNORECASE)
    if not match:
        return None
    return f"r-{match.group(1).lower()}"


def _match_by_code(code: str, templates: list[str]) -> list[str]:
    result: list[str] = []
    for name in templates:
        normalized_name = _normalize_for_match(name)
        if code in normalized_name.replace("_", "-"):
            result.append(name)
    return result


def _prefer_docx(templates: list[str]) -> str:
    docx_templates = sorted([name for name in templates if name.lower().endswith(".docx")])
    if docx_templates:
        return docx_templates[0]
    return sorted(templates)[0]


def _infer_fixed_handler_key(template_name: str) -> str | None:
    normalized = _normalize_for_match(template_name)
    if re.search(r"r[-_ ]?802b", normalized, flags=re.IGNORECASE):
        return "r802b"
    if re.search(r"r[-_ ]?825b", normalized, flags=re.IGNORECASE):
        return "r825b"
    if re.search(r"r[-_ ]?803b", normalized, flags=re.IGNORECASE):
        return "r803b"
    if re.search(r"r[-_ ]?801b", normalized, flags=re.IGNORECASE):
        return "r801b"
    return None


def _build_output_file_name(report_id: str, template_file_name: str) -> str:
    safe_name = Path(template_file_name or "").name
    if not safe_name:
        safe_name = "report.docx"
    return f"{report_id}__{safe_name}"


def _normalize_report_dates(context: dict[str, str]) -> dict[str, str]:
    normalized = dict(context or {})
    receive_date = _normalize_date_text(normalized.get("receive_date", ""))
    calibration_date = _normalize_date_text(normalized.get("calibration_date", ""))
    base_date = calibration_date or receive_date
    if not base_date:
        return normalized

    normalized["receive_date"] = base_date
    normalized["calibration_date"] = base_date
    publish_date = _add_days(base_date, 1)
    if publish_date:
        normalized["publish_date"] = publish_date
    return normalized


def _normalize_date_text(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})", text)
    if not match:
        return ""
    year = int(match.group(1))
    month = int(match.group(2))
    day = int(match.group(3))
    try:
        dt = datetime(year, month, day)
    except ValueError:
        return ""
    return f"{dt.year:04d}年{dt.month:02d}月{dt.day:02d}日"


def _normalize_context_aliases(context: dict[str, str] | None) -> dict[str, str]:
    normalized = dict(context or {})
    alias_map = {
        "device_name": (
            "deviceName",
            "器具名称",
            "设备名称",
            "仪器名称",
            "name",
        ),
        "device_model": (
            "deviceModel",
            "型号",
            "型号规格",
            "型号/规格",
            "规格型号",
            "model",
        ),
        "device_code": (
            "deviceCode",
            "器具编号",
            "设备编号",
            "仪器编号",
            "资产编号",
            "编号",
            "serial",
            "code",
        ),
        "manufacturer": (
            "manufacturerName",
            "生产厂商",
            "制造厂商",
            "制造厂/商",
            "制造商",
            "厂家",
            "厂商",
        ),
        "basis_standard": (
            "calibration_basis",
            "basis",
            "检测依据",
            "校准依据",
            "检测/校准依据",
            "技术规范代号",
        ),
        "location": (
            "校准地点",
            "检测地点",
            "地点",
        ),
        "temperature": (
            "温度",
        ),
        "humidity": (
            "湿度",
        ),
        "certificate_no": (
            "证书编号",
            "证书号",
            "缆专检号",
        ),
        "client_name": (
            "委托单位",
            "客户名称",
            "客户",
        ),
        "receive_date": (
            "收样日期",
            "收样时间",
        ),
        "calibration_date": (
            "校准日期",
            "检定日期",
            "检测日期",
        ),
    }
    for canonical_key, aliases in alias_map.items():
        current = str(normalized.get(canonical_key, "") or "").strip()
        if current:
            continue
        for alias in aliases:
            candidate = str(normalized.get(alias, "") or "").strip()
            if not candidate:
                continue
            normalized[canonical_key] = candidate
            break
    return normalized


def _add_days(date_text: str, days: int) -> str:
    normalized = _normalize_date_text(date_text)
    if not normalized:
        return ""
    match = re.search(r"(\d{4})年(\d{2})月(\d{2})日", normalized)
    if not match:
        return ""
    dt = datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    target = dt + timedelta(days=days)
    return f"{target.year:04d}年{target.month:02d}月{target.day:02d}日"


def _build_name_hints(raw_text: str, file_name: str | None) -> list[str]:
    hints: list[str] = []
    seen: set[str] = set()
    explicit_name_hints: list[str] = []

    def _push(value: str) -> None:
        cleaned = _clean_name_hint(value)
        if not cleaned:
            return
        normalized = _normalize_name_for_fuzzy(cleaned)
        if not normalized or normalized in seen:
            return
        seen.add(normalized)
        hints.append(cleaned)

    for pattern in (
        r"(?:器具名称|设备名称|仪器名称)[:：]?\s*([^\n|]+)",
        r"(?:device|instrument)\s*name[:：]?\s*([^\n|]+)",
    ):
        for match in re.finditer(pattern, raw_text or "", flags=re.IGNORECASE):
            value = match.group(1)
            _push(value)
            cleaned = _clean_name_hint(value)
            if cleaned:
                explicit_name_hints.append(cleaned)

    # If explicit device-name fields exist, trust them and avoid noisy line hints.
    if explicit_name_hints:
        return hints

    for line in (raw_text or "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        # Exclude basis/reference lines to avoid matching templates by
        # standard titles (e.g., "...第14部分：焊锡试验仪") instead of device name.
        if re.search(r"(?:JB/T|GB/T|IEC|ISO)\s*\d", stripped, flags=re.IGNORECASE):
            continue
        if re.search(r"(检定方法|校准规范|技术规范|reference documents|第\s*\d+\s*部分)", stripped, flags=re.IGNORECASE):
            continue
        if not re.search(r"(试验|老化|冲击|击穿|燃烧|卷绕|扭转|火花|局放|耐压|绝缘|电桥|测量)", stripped):
            continue
        _push(stripped)

    if file_name:
        stem = Path(file_name).stem
        stem = re.sub(r"(?i)^r[-_ ]?\d{3}[a-z]\s*", "", stem).strip()
        _push(stem)
    return hints


def _clean_name_hint(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if "|" in text:
        text = text.split("|", 1)[0].strip()
    text = re.sub(r"^(?:器具名称|设备名称|仪器名称|instrument\s*name|device\s*name)[:：]?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[（(][^）)]{0,16}[）)]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) < 2:
        return ""
    return text


def _normalize_name_for_fuzzy(value: str) -> str:
    text = _normalize_for_match(value)
    text = re.sub(r"(?i)^r[-_ ]?\d{3}[a-z]", "", text)
    text = re.sub(r"\.docx$|\.html$", "", text)
    text = (
        text.replace("软击穿", "软化击穿")
        .replace("伸长率试验仪", "伸长试验仪")
        .replace("伸长率", "伸长")
        .replace("高温试验箱", "高温箱")
    )
    text = re.sub(r"[（）()【】\[\]{}《》“”\"'、,，.:：;；/\\|_+-]", "", text)
    return text


def _normalize_name_core(value: str) -> str:
    text = _normalize_name_for_fuzzy(value)
    for token in (
        "原始记录",
        "核查记录",
        "记录",
        "模板",
        "试验仪",
        "试验机",
        "试验装置",
        "试验系统",
        "试验箱",
        "系统",
        "设备",
        "仪器",
        "装置",
    ):
        text = text.replace(token, "")
    return text


def _match_by_name_hints(hints: list[str], templates: list[str]) -> str | None:
    if not hints:
        return None

    hint_pairs: list[tuple[str, str]] = []
    for hint in hints:
        full = _normalize_name_for_fuzzy(hint)
        core = _normalize_name_core(hint)
        if full:
            hint_pairs.append((full, core or full))
    if not hint_pairs:
        return None

    template_pairs: dict[str, tuple[str, str]] = {}
    for name in templates:
        full = _normalize_name_for_fuzzy(name)
        core = _normalize_name_core(name)
        if not full:
            continue
        template_pairs[name] = (full, core or full)
    if not template_pairs:
        return None

    contains_scores: dict[str, int] = {}
    for template_name, (_, template_core) in template_pairs.items():
        for hint_full, hint_core in hint_pairs:
            for left, right in ((hint_core, template_core), (hint_full, template_core)):
                if not left or not right:
                    continue
                if left in right or right in left:
                    contains_scores[template_name] = max(
                        contains_scores.get(template_name, 0),
                        min(len(left), len(right)),
                    )
    if contains_scores:
        ranked_contains = sorted(contains_scores.items(), key=lambda item: (-item[1], item[0]))
        if len(ranked_contains) == 1:
            return ranked_contains[0][0]
        if ranked_contains[0][1] > ranked_contains[1][1]:
            return ranked_contains[0][0]

    fuzzy_scores: list[tuple[float, str]] = []
    for template_name, (_, template_core) in template_pairs.items():
        best = 0.0
        for hint_full, hint_core in hint_pairs:
            best = max(
                best,
                SequenceMatcher(None, hint_core, template_core).ratio(),
                SequenceMatcher(None, hint_full, template_core).ratio(),
            )
        fuzzy_scores.append((best, template_name))
    fuzzy_scores.sort(key=lambda item: (-item[0], item[1]))
    if not fuzzy_scores:
        return None

    top_score, top_name = fuzzy_scores[0]
    second_score = fuzzy_scores[1][0] if len(fuzzy_scores) > 1 else 0.0
    if top_score >= 0.60 and (top_score - second_score >= 0.06 or len(fuzzy_scores) == 1):
        return top_name
    return None
