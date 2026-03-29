from pathlib import Path
import re
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.template_schema.detector import detect_candidate_field_keys, read_docx_text
from app.services.template_schema.field_registry import to_editor_fields

TEMPLATES_DIR = BACKEND_DIR / "templates"
PROFILES_DIR = BACKEND_DIR / "app" / "rules" / "template_profiles"


def _extract_code(file_name: str) -> str:
    match = re.search(r"(?:r[-_ ]?)?(\d{3}[a-z])", file_name, flags=re.IGNORECASE)
    if not match:
        return ""
    return f"r-{match.group(1).lower()}"


def build_profile(template_path: Path) -> dict:
    template_name = template_path.name
    code = _extract_code(template_name)
    text = read_docx_text(template_path)
    keys = detect_candidate_field_keys(template_name=template_name, text=text)
    fields = to_editor_fields(keys)
    return {
        "code": code,
        "template_name": template_name,
        "template_aliases": [
            template_name,
            code.upper(),
            code.replace("-", "_").upper(),
        ],
        "editor": {
            "note": "模板专属字段配置（自动生成，可人工调整）",
            "fields": fields,
        },
    }


def main() -> None:
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    count = 0
    for path in sorted(TEMPLATES_DIR.glob("*.docx")):
        code = _extract_code(path.name)
        if not code:
            continue
        profile = build_profile(path)
        out_path = PROFILES_DIR / f"{code}.yaml"
        out_path.write_text(_to_yaml_text(profile), encoding="utf-8")
        count += 1
    print(f"generated={count} dir={PROFILES_DIR}")


def _yaml_escape(value: str) -> str:
    text = str(value or "")
    text = text.replace("\\", "\\\\").replace("\"", "\\\"")
    return f"\"{text}\""


def _to_yaml_text(profile: dict) -> str:
    lines: list[str] = []
    lines.append(f"code: {profile.get('code', '')}")
    lines.append(f"template_name: {_yaml_escape(profile.get('template_name', ''))}")
    lines.append("template_aliases:")
    for alias in profile.get("template_aliases", []):
        lines.append(f"  - {_yaml_escape(alias)}")
    lines.append("editor:")
    lines.append(f"  note: {_yaml_escape(profile.get('editor', {}).get('note', ''))}")
    lines.append("  fields:")
    for field in profile.get("editor", {}).get("fields", []):
        lines.append(f"    - key: {field.get('key', '')}")
        lines.append(f"      label: {_yaml_escape(field.get('label', ''))}")
        lines.append(f"      wide: {'true' if field.get('wide') else 'false'}")
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    main()
