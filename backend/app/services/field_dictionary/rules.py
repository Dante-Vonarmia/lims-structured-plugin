from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

RULES_FILE = Path(__file__).resolve().parents[2] / "rules" / "field_dictionary.yaml"


@lru_cache(maxsize=1)
def load_field_dictionary_rules() -> dict[str, Any]:
    if not RULES_FILE.exists():
        return {"aliases": {}, "formulas": []}
    with RULES_FILE.open("r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    aliases = raw.get("aliases", {})
    if not isinstance(aliases, dict):
        aliases = {}

    formulas = raw.get("formulas", [])
    if not isinstance(formulas, list):
        formulas = []

    return {"aliases": aliases, "formulas": formulas}
