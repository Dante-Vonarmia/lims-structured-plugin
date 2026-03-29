import re
import sys
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.semantic_fill_lib import (  # noqa: E402
    replace_measured_value_placeholder_by_items,
    replace_uncertainty_u_placeholder_by_items,
)


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}
RAW_RECORD_2024_DIR = Path("/Users/dantevonalcatraz/Documents/Job/2026/国缆检测部LIMS插件项目/原始记录2024")


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def extract_docx_lines(path: Path) -> list[str]:
    with zipfile.ZipFile(path, "r") as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    lines: list[str] = []
    for paragraph in root.findall(".//w:p", NS):
        text = "".join([(node.text or "") for node in paragraph.findall(".//w:t", NS)])
        text = normalize_space(text)
        if text:
            lines.append(text)
    return lines


def _extract_u_token(line: str) -> str:
    match = re.search(r"U\s*=\s*([^\s,，;；]*)", line, flags=re.IGNORECASE)
    return normalize_space(match.group(1)) if match else ""


def _extract_u_unit(line: str) -> str:
    match = re.search(r"U\s*=\s*[^,，;；\s]*\s*([^,，;；\s]+)\s*[,，]?\s*k\s*=\s*2", line, flags=re.IGNORECASE)
    return normalize_space(match.group(1)) if match else ""


def _extract_anchor(line: str, keyword: str) -> str:
    if keyword in line:
        return normalize_space(line.split(keyword, 1)[0])
    return normalize_space(line)


class RawRecord2024PlaceholderBDDTDD(unittest.TestCase):
    def test_bulk_templates_placeholder_fillability(self) -> None:
        if not RAW_RECORD_2024_DIR.exists():
            self.skipTest(f"raw record dir not found: {RAW_RECORD_2024_DIR}")

        files = sorted([p for p in RAW_RECORD_2024_DIR.glob("*.docx") if p.is_file()], key=lambda x: x.name)
        self.assertGreaterEqual(len(files), 70)

        failures: list[str] = []
        total_u_checked = 0
        total_measured_checked = 0

        for path in files:
            lines = extract_docx_lines(path)
            if not lines:
                failures.append(f"{path.name}: empty text")
                continue

            file_u_candidates = 0
            file_u_checked = 0
            file_measured_candidates = 0
            file_measured_checked = 0

            last_anchor = ""
            for line in lines:
                normalized = normalize_space(line)
                if not normalized:
                    continue

                if "扩展不确定度" in normalized and "U" in normalized:
                    last_anchor = _extract_anchor(normalized, "扩展不确定度")
                    token = _extract_u_token(normalized)
                    if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", token):
                        continue
                    file_u_candidates += 1
                    unit = _extract_u_unit(normalized)
                    fake_item = [{"anchor": last_anchor, "value": "7.77", "unit": unit}]
                    updated = replace_uncertainty_u_placeholder_by_items(
                        normalized,
                        fake_item,
                        normalize_space=normalize_space,
                    )
                    if "7.77" in updated:
                        file_u_checked += 1
                    else:
                        failures.append(f"{path.name}: U placeholder not fillable -> {normalized}")
                    continue

                if "实测值" in normalized:
                    if re.fullmatch(r"实测值\s*[\(（][^)）]+[\)）]", normalized):
                        continue
                    if re.fullmatch(r"实测值\s*[A-Za-z%°ΩΩω℃]+", normalized):
                        continue
                    tail = normalize_space(normalized.split("实测值", 1)[1])
                    if re.search(r"\d", tail):
                        continue
                    file_measured_candidates += 1
                    unit_match = re.search(r"[:：]\s*([^\d\s,，;；。．]+)", normalized)
                    unit = normalize_space(unit_match.group(1)) if unit_match else ""
                    fake_item = [{"anchor": last_anchor, "value": "8.88", "unit": unit}]
                    updated = replace_measured_value_placeholder_by_items(
                        normalized,
                        fake_item,
                        normalize_space=normalize_space,
                        anchor_hint=last_anchor,
                    )
                    if "8.88" in updated:
                        file_measured_checked += 1
                    else:
                        failures.append(f"{path.name}: measured placeholder not fillable -> {normalized}")
                    continue

                if "、" in normalized or "扩展不确定度" in normalized:
                    last_anchor = normalized

            total_u_checked += file_u_checked
            total_measured_checked += file_measured_checked

            if file_u_candidates > 0 and file_u_checked == 0:
                failures.append(f"{path.name}: U candidates={file_u_candidates}, checked=0")
            if file_measured_candidates > 0 and file_measured_checked == 0:
                failures.append(f"{path.name}: measured candidates={file_measured_candidates}, checked=0")

        self.assertGreater(total_u_checked, 0, "no U placeholders were validated")
        self.assertGreater(total_measured_checked, 0, "no measured placeholders were validated")
        if failures:
            sample = "\n".join(failures[:15])
            self.fail(f"placeholder fillability failures: {len(failures)}\n{sample}")


if __name__ == "__main__":
    unittest.main()
