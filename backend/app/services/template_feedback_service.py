from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml

PENDING_FILE = Path(__file__).resolve().parents[1] / "rules" / "template_feedback_pending.yaml"

_GENERIC_KEYWORDS = {
    "校准",
    "校准结果",
    "说明",
    "续页",
    "结果",
    "证书",
    "原始记录",
    "检测",
    "试验",
    "系统",
    "设备",
    "仪器",
    "有限公司",
    "上海国缆检测股份有限公司",
    "第页",
    "共页",
}

_NOISE_LINE_PATTERNS = [
    re.compile(r"^第\s*\d+\s*页\s*[\/／]\s*共\s*\d+\s*页$", re.IGNORECASE),
    re.compile(r"^page\s+\d+\s+of\s+\d+$", re.IGNORECASE),
    re.compile(r"^page\s+of\s+total\s+pages$", re.IGNORECASE),
    re.compile(r"^校准证书续页专用$", re.IGNORECASE),
    re.compile(r"^continued\s+page\s+of\s+calibration\s+certificate$", re.IGNORECASE),
]


def build_template_feedback_entry(
    *,
    template_name: str,
    raw_text: str,
    file_name: str = "",
    device_name: str = "",
    device_model: str = "",
    device_code: str = "",
    manufacturer: str = "",
) -> dict[str, Any]:
    normalized_template_name = str(template_name or "").strip()
    if not normalized_template_name:
        raise ValueError("template_name is required")

    aliases = _build_alias_candidates(
        template_name=normalized_template_name,
        device_name=device_name,
    )
    keywords = _build_keyword_candidates(raw_text)

    now = datetime.now().isoformat(timespec="seconds")
    entry = {
        "id": uuid4().hex[:12],
        "created_at": now,
        "status": "pending",
        "template_name": normalized_template_name,
        "template_code": _extract_template_code(normalized_template_name),
        "source": {
            "file_name": str(file_name or "").strip(),
            "device_name": str(device_name or "").strip(),
            "device_model": str(device_model or "").strip(),
            "device_code": str(device_code or "").strip(),
            "manufacturer": str(manufacturer or "").strip(),
        },
        "suggestions": {
            "template_aliases": aliases,
            "source_keywords": keywords,
        },
    }
    _append_pending_entry(entry)
    return {
        "saved": True,
        "pending_file": str(PENDING_FILE),
        "entry": entry,
    }


def _append_pending_entry(entry: dict[str, Any]) -> None:
    data = _load_pending()
    entries = data.get("entries", [])
    if not isinstance(entries, list):
        entries = []
    entries.append(entry)
    data["entries"] = entries
    PENDING_FILE.parent.mkdir(parents=True, exist_ok=True)
    with PENDING_FILE.open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)


def _load_pending() -> dict[str, Any]:
    if not PENDING_FILE.exists():
        return {"version": 1, "entries": []}
    try:
        with PENDING_FILE.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except Exception:
        return {"version": 1, "entries": []}
    if not isinstance(data, dict):
        return {"version": 1, "entries": []}
    if not isinstance(data.get("entries"), list):
        data["entries"] = []
    if "version" not in data:
        data["version"] = 1
    return data


def _extract_template_code(template_name: str) -> str:
    normalized = re.sub(r"\s+", "", str(template_name or "")).lower()
    match = re.search(r"(?:r[-_ ]?)?(\d{3}[a-z])", normalized, flags=re.IGNORECASE)
    if not match:
        return ""
    return f"r-{match.group(1).lower()}"


def _build_alias_candidates(*, template_name: str, device_name: str) -> list[str]:
    candidates: list[str] = []
    dn = str(device_name or "").strip()
    if len(dn) >= 2:
        candidates.append(dn)

    base = Path(template_name).stem.strip()
    base = re.sub(r"^(?:r[-_ ]?\d{3}[a-z])\s*", "", base, flags=re.IGNORECASE).strip()
    if len(base) >= 2:
        candidates.append(base)

    out: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        key = re.sub(r"\s+", "", item).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out[:12]


def _build_keyword_candidates(raw_text: str) -> list[str]:
    lines = [ln.strip() for ln in str(raw_text or "").replace("\r", "").split("\n")]
    filtered_lines = []
    for line in lines:
        if not line:
            continue
        if any(p.search(line) for p in _NOISE_LINE_PATTERNS):
            continue
        filtered_lines.append(line)

    score: dict[str, int] = {}
    for line in filtered_lines:
        if len(line) > 120:
            continue
        for token in re.findall(r"[\u4e00-\u9fffA-Za-z0-9%℃Ωμ~./-]{2,30}", line):
            t = str(token).strip()
            if len(t) < 2:
                continue
            normalized = re.sub(r"\s+", "", t)
            if not normalized:
                continue
            if re.fullmatch(r"[\d.%-]+", normalized):
                continue
            if normalized.lower().startswith("data:image"):
                continue
            lower = normalized.lower()
            if lower in _GENERIC_KEYWORDS:
                continue
            score[normalized] = score.get(normalized, 0) + 1

    # Prefer domain terms that are often useful for template matching.
    boost_patterns = [
        re.compile(r"局放|局部放电"),
        re.compile(r"(?:\d{2,4}k?v|kV|kv)", re.IGNORECASE),
        re.compile(r"电缆|附件|耐压|脉冲|灵敏度|衰减"),
    ]
    ranked = sorted(
        score.items(),
        key=lambda kv: (
            -_keyword_boost(kv[0], boost_patterns),
            -kv[1],
            -len(kv[0]),
            kv[0],
        ),
    )
    return [k for k, _ in ranked[:20]]


def _keyword_boost(keyword: str, patterns: list[re.Pattern[str]]) -> int:
    boost = 0
    for p in patterns:
        if p.search(keyword):
            boost += 1
    return boost
