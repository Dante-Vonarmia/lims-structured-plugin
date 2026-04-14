from pathlib import Path
import re
import shutil
from datetime import datetime, timedelta
from typing import Callable
from typing import Iterable
from uuid import uuid4

from ..config import OUTPUT_DIR, TEMPLATE_DIR
from .field_dictionary import apply_field_dictionary
from .docx_fill_service import (
    fill_generic_record_docx,
    fill_modify_certificate_docx,
    fill_r846b_docx,
    fill_r802b_docx,
    build_r803b_editor_fields,
    fill_r801b_docx,
    fill_r803b_docx,
    fill_r825b_docx,
)
from .template_mapping_library_service import (
    resolve_handler_key,
)
from .template_feedback_service import match_template_name_by_feedback_defaults

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
    "r846b": fill_r846b_docx,
    "modify_certificate_blueprint": fill_modify_certificate_docx,
}


class FixedTemplateFillError(RuntimeError):
    pass


def render_report(
    template_name: str,
    context: dict[str, str],
    source_file_path: Path | None = None,
    source_file_as_template: bool = False,
) -> tuple[str, Path]:
    effective_template_name = template_name
    template_path: Path
    if source_file_as_template and source_file_path is not None:
        template_path = source_file_path
        effective_template_name = source_file_path.name
    else:
        template_path = TEMPLATE_DIR / template_name

    context = apply_field_dictionary(context, template_name=effective_template_name)
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {effective_template_name}")

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

    inferred_handler_key = _infer_fixed_handler_key(template_name)
    handler_key = inferred_handler_key or resolve_handler_key(template_name)
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
    context = _normalize_context_aliases(context)
    handler_key = resolve_handler_key(template_name) or _infer_fixed_handler_key(template_name)
    if handler_key == "r803b":
        fields = build_r803b_editor_fields(
            context=context,
            source_file_path=source_file_path,
        )
        return fields
    return {}


def match_template_name(
    raw_text: str,
    file_name: str | None,
    templates: Iterable[str],
    device_name: str = "",
    device_code: str = "",
) -> tuple[str | None, str | None]:
    template_list = list(templates)
    if not template_list:
        return None, None

    normalized_source = _normalize_source_for_match(f"{file_name or ''}\n{raw_text or ''}")
    if not normalized_source:
        return None, None

    matched_by_feedback = match_template_name_by_feedback_defaults(
        normalized_source=normalized_source,
        device_name=device_name,
        device_code=device_code,
        templates=template_list,
    )
    if matched_by_feedback:
        return matched_by_feedback, "feedback:default"

    name_hints = _build_name_hints(
        raw_text=raw_text,
        file_name=file_name,
        device_name=device_name,
    )
    matched_by_name = _match_by_name_hints(name_hints, template_list)
    if matched_by_name:
        return matched_by_name, "name:strict"

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
    if "修改证书蓝本" in template_name or "modify-certificate-blueprint" in normalized or "modify_certificate_blueprint" in normalized:
        return "modify_certificate_blueprint"
    if re.search(r"r[-_ ]?802b", normalized, flags=re.IGNORECASE):
        return "r802b"
    if re.search(r"r[-_ ]?825b", normalized, flags=re.IGNORECASE):
        return "r825b"
    if re.search(r"r[-_ ]?803b", normalized, flags=re.IGNORECASE):
        return "r803b"
    if re.search(r"r[-_ ]?801b", normalized, flags=re.IGNORECASE):
        return "r801b"
    if re.search(r"r[-_ ]?846b", normalized, flags=re.IGNORECASE):
        return "r846b"
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
        "basis_mode": (
            "calibration_mode",
            "检测/校准类型",
            "依据类型（检测/校准）",
            "依据类型",
            "检测校准类型",
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


def _build_name_hints(raw_text: str, file_name: str | None, device_name: str = "") -> list[str]:
    hints: list[str] = []
    seen: set[str] = set()

    def _push(value: str) -> None:
        cleaned = _clean_name_hint(value)
        if not cleaned:
            return
        normalized = _normalize_name_for_fuzzy(cleaned)
        if not normalized or normalized in seen:
            return
        seen.add(normalized)
        hints.append(cleaned)

    _push(device_name)

    for pattern in (
        r"(?mi)^\s*(?:器具名称|设备名称|仪器名称)[:：]?\s*([^\n|]+)",
        r"(?mi)^\s*(?:device|instrument)\s*name[:：]?\s*([^\n|]+)",
    ):
        for match in re.finditer(pattern, raw_text or "", flags=re.IGNORECASE):
            value = match.group(1)
            if "计量标准器具名称" in value:
                continue
            _push(value)

    if file_name and not str(device_name or "").strip():
        stem = Path(file_name).stem
        stem = re.sub(r"(?i)^r[-_ ]?\d{3}[a-z]\s*", "", stem).strip()
        _push(stem)
    return hints


def _extract_primary_device_name(raw_text: str) -> str:
    for pattern in (
        r"(?mi)^\s*器具名称[:：]?\s*([^\n|]+)",
        r"(?mi)^\s*设备名称[:：]?\s*([^\n|]+)",
        r"(?mi)^\s*仪器名称[:：]?\s*([^\n|]+)",
        r"(?mi)^\s*(?:device|instrument)\s*name[:：]?\s*([^\n|]+)",
    ):
        match = re.search(pattern, raw_text or "", flags=re.IGNORECASE)
        if not match:
            continue
        value = _clean_name_hint(match.group(1))
        if value and "计量标准器具名称" not in value:
            return value
    return ""


def _clean_name_hint(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r"^\d{2,}\s*", "", text)
    text = re.sub(r"(?i)\bcnas\b", "", text)
    text = re.sub(r"[-_ ]*\d+$", "", text)
    if "|" in text:
        text = text.split("|", 1)[0].strip()
    text = re.sub(r"^(?:器具名称|设备名称|仪器名称|instrument\s*name|device\s*name)[:：]?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) < 2:
        return ""
    return text


def _normalize_name_for_fuzzy(value: str) -> str:
    text = _normalize_for_match(value)
    text = re.sub(r"(?i)^r[-_ ]?\d{3}[a-z]", "", text)
    text = re.sub(r"\.docx$|\.html$", "", text)
    text = text.replace("cnas", "")
    text = (
        text.replace("软击穿", "软化击穿")
        .replace("伸长率试验仪", "伸长试验仪")
        .replace("伸长率", "伸长")
        .replace("高温试验箱", "高温箱")
        .replace("金属扭转", "线材扭转")
        .replace("扁线弯曲", "扁线回弹")
        .replace("扁线回弹角", "扁线回弹")
        .replace("缠绕能力试验仪", "线材卷绕试验机")
        .replace("低温箱", "低温试验箱")
        .replace("干燥箱", "试验箱")
        .replace("希波火花机", "火花机人工击穿装置")
        .replace("介损", "局部放电")
        .replace("5kv高压台", "电线电缆电压试验装置")
        .replace("热态电压试验箱", "电热强制通风试验箱热态电压试验仪")
        .replace("低应力拉伸仪", "低温拉伸试验机")
        .replace("摩擦系数仪", "静摩擦系数试验仪")
        .replace("往复弯折试验仪", "曲挠试验装置")
        .replace("耐氟试验仪", "耐溶剂试验仪")
        .replace("自动回弹角试验仪（1.60以上）", "扁线回弹试验仪")
        .replace("自动回弹角试验仪(1.60以上)", "扁线回弹试验仪")
        .replace("自动回弹角试验仪（160以上）", "扁线回弹试验仪")
        .replace("自动回弹角试验仪(160以上)", "扁线回弹试验仪")
        .replace("自动回弹角试验仪160以上", "扁线回弹试验仪")
        .replace("耐溶剂试验仪（温场）", "耐溶剂试验仪")
        .replace("耐溶剂试验仪(温场)", "耐溶剂试验仪")
        .replace("耐溶剂试验仪（力值）", "耐溶剂试验仪")
        .replace("耐溶剂试验仪(力值)", "耐溶剂试验仪")
        .replace("耐溶剂试验仪温场", "耐溶剂试验仪")
        .replace("耐溶剂试验仪力值", "耐溶剂试验仪")
    )
    if text in {"卷绕", "卷绕试验仪"}:
        text = "线材卷绕试验机"
    if text in {"立绕试验仪", "立绕"}:
        text = "绕组线卷绕试验仪"
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
        "测试",
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

    exact_hits: list[str] = []
    for template_name, (_, template_core) in template_pairs.items():
        for hint_full, hint_core in hint_pairs:
            if not hint_core or not template_core:
                continue
            if hint_core == template_core or hint_full == template_core:
                exact_hits.append(template_name)
                break
    exact_hits = sorted(set(exact_hits))
    if len(exact_hits) == 1:
        return exact_hits[0]
    if len(exact_hits) > 1:
        non_check = [name for name in exact_hits if "核查记录" not in str(name)]
        if len(non_check) == 1:
            return non_check[0]
    return None
