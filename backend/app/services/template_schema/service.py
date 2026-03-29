from functools import lru_cache
from typing import Any

from ...config import TEMPLATE_DIR
from .detector import detect_candidate_field_keys, read_docx_text
from .field_registry import to_editor_fields


@lru_cache(maxsize=512)
def infer_editor_schema(template_name: str) -> dict[str, Any] | None:
    normalized_name = str(template_name or "").strip()
    if not normalized_name:
        return None
    template_path = TEMPLATE_DIR / normalized_name
    docx_text = read_docx_text(template_path)
    keys = detect_candidate_field_keys(template_name=normalized_name, text=docx_text)
    fields = to_editor_fields(keys)
    if not fields:
        return None
    return {
        "note": "自动推断字段清单（可编辑后生成；空值会保留并高亮）",
        "fields": fields,
    }
