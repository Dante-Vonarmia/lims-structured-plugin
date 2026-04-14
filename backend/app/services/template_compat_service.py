from pathlib import Path

_LEGACY_TEMPLATE_ALIAS = {
    "2026030604-大特.docx": "modify-certificate-blueprint.docx",
    "修改证书蓝本.docx": "modify-certificate-blueprint.docx",
}


def normalize_legacy_template_name(template_name: str) -> str:
    raw = str(template_name or "").strip()
    if not raw:
        return raw
    base = Path(raw).name
    return _LEGACY_TEMPLATE_ALIAS.get(raw, _LEGACY_TEMPLATE_ALIAS.get(base, raw))

