from datetime import datetime, timedelta
import re


def normalize_date_text(value: str) -> str:
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


def add_days(date_text: str, days: int) -> str:
    normalized = normalize_date_text(date_text)
    if not normalized:
        return ""
    match = re.search(r"(\d{4})年(\d{2})月(\d{2})日", normalized)
    if not match:
        return ""
    dt = datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    target = dt + timedelta(days=days)
    return f"{target.year:04d}年{target.month:02d}月{target.day:02d}日"
