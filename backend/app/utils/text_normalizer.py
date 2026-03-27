import re


def normalize_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{2,}", "\n", normalized)
    return normalized.strip()


def split_lines(text: str) -> list[str]:
    normalized = normalize_text(text)
    if not normalized:
        return []
    return [line.strip() for line in normalized.split("\n") if line.strip()]
