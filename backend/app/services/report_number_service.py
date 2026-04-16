import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from ..config import OUTPUT_DIR

_LOCK = threading.Lock()
_COUNTER_FILE = OUTPUT_DIR / "report-number-sequence.json"


def _today_text(now: datetime | None = None) -> str:
    current = now if isinstance(now, datetime) else datetime.now()
    return current.strftime("%Y%m%d")


def _read_counter_unlocked() -> dict[str, Any]:
    if not _COUNTER_FILE.exists() or not _COUNTER_FILE.is_file():
        return {"date": "", "seq": 0}
    try:
        payload = json.loads(_COUNTER_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"date": "", "seq": 0}
    if not isinstance(payload, dict):
        return {"date": "", "seq": 0}
    return payload


def _write_counter_unlocked(date_text: str, seq: int) -> None:
    _COUNTER_FILE.parent.mkdir(parents=True, exist_ok=True)
    _COUNTER_FILE.write_text(
        json.dumps({"date": str(date_text or ""), "seq": int(max(seq, 0))}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def next_daily_report_no(now: datetime | None = None) -> str:
    with _LOCK:
        today = _today_text(now)
        payload = _read_counter_unlocked()
        date_text = str(payload.get("date", "") or "").strip()
        seq = int(payload.get("seq", 0) or 0)
        if date_text != today:
            seq = 0
        seq += 1
        _write_counter_unlocked(today, seq)
        return f"{today}{str(seq).zfill(2)}"


def ensure_report_no(context: dict[str, Any] | None = None) -> str:
    data = context if isinstance(context, dict) else {}
    explicit = str(data.get("report_no") or data.get("report_number") or "").strip()
    if explicit:
        return explicit
    generated = next_daily_report_no()
    data["report_no"] = generated
    data["report_number"] = generated
    return generated

