import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.semantic_fill_lib import (
    extract_measured_value_items,
    extract_text_block,
    extract_uncertainty_items,
)

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}
DEFAULT_INPUT_DIR = Path("/Users/dantevonalcatraz/Documents/Job/2026/国缆检测部LIMS插件项目/原始记录2024")
DEFAULT_OUTPUT_FILE = Path("backend/tests/fixtures/raw_record_2024_baseline.json")


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def _read_docx_document_xml(path: Path) -> bytes:
    with zipfile.ZipFile(path, "r") as zf:
        return zf.read("word/document.xml")


def extract_docx_text(path: Path) -> str:
    xml = _read_docx_document_xml(path)
    root = ET.fromstring(xml)
    lines: list[str] = []
    for paragraph in root.findall(".//w:p", NS):
        text = "".join([(node.text or "") for node in paragraph.findall(".//w:t", NS)])
        text = normalize_space(text)
        if text:
            lines.append(text)
    return "\n".join(lines)


def count_docx_tables(path: Path) -> int:
    xml = _read_docx_document_xml(path)
    root = ET.fromstring(xml)
    return len(root.findall(".//w:tbl", NS))


def collect_docx_snapshot(path: Path) -> dict:
    text = extract_docx_text(path)
    general_check = extract_text_block(
        text=text,
        start_patterns=(r"(?:一[、.．)]\s*)?一般检查", r"General inspection"),
        end_patterns=(r"^\s*(?:二|2)[、.．)]", r"备注", r"结果", r"检测员", r"校准员", r"核验员"),
        normalize_space=normalize_space,
    )
    uncertainty_items = extract_uncertainty_items(general_check, normalize_space=normalize_space)
    measured_items = extract_measured_value_items(general_check, normalize_space=normalize_space)
    return {
        "file_name": path.name,
        "file_size": path.stat().st_size,
        "table_count": count_docx_tables(path),
        "text_length": len(text),
        "has_general_check_keyword": "一般检查" in text,
        "general_check_length": len(general_check),
        "uncertainty_items_count": len(uncertainty_items),
        "measured_items_count": len(measured_items),
    }


def generate_baseline(input_dir: Path) -> list[dict]:
    files = sorted([p for p in input_dir.glob("*.docx") if p.is_file()], key=lambda x: x.name)
    return [collect_docx_snapshot(path) for path in files]


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate raw_record_2024 baseline snapshot for TDD regression.")
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_FILE)
    args = parser.parse_args()

    if not args.input_dir.exists():
        raise FileNotFoundError(f"Input dir not found: {args.input_dir}")

    data = generate_baseline(args.input_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"generated {len(data)} records -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
