from functools import lru_cache
from pathlib import Path
from typing import Any
import re

import yaml

PROFILES_DIR = Path(__file__).resolve().parents[1] / "rules" / "template_profiles"


@lru_cache(maxsize=1)
def load_template_profiles() -> dict[str, dict[str, Any]]:
    if not PROFILES_DIR.exists() or not PROFILES_DIR.is_dir():
        return {}

    result: dict[str, dict[str, Any]] = {}
    for path in sorted(PROFILES_DIR.glob("*.yaml")):
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        if not isinstance(raw, dict):
            continue
        code = _normalize_template_code(
            str(raw.get("code", "") or "")
            or str(raw.get("template_name", "") or "")
            or path.stem
        )
        if not code:
            continue
        result[code] = raw
    return result


def _normalize_template_code(code: str) -> str:
    normalized = re.sub(r"\s+", "", str(code or "")).lower()
    match = re.search(r"r[-_ ]?(\d{3}[a-z])", normalized, flags=re.IGNORECASE)
    if not match:
        return ""
    return f"r-{match.group(1).lower()}"
