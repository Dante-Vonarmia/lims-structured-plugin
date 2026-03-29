import unittest
import re
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

try:
    from backend.tests.raw_record_2024_templates._common import RAW_RECORD_2024_DIR, collect_docx_snapshot
except ModuleNotFoundError:
    from raw_record_2024_templates._common import RAW_RECORD_2024_DIR, collect_docx_snapshot

from app.services.result_check_matcher import extract_source_general_check_lines, match_best_source_line
from app.services.semantic_fill_lib import (
    extract_measured_value_items,
    extract_uncertainty_items,
    is_reliable_result_semantic_match,
)


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


class Template815BTDD(unittest.TestCase):
    def test_template_snapshot_regression(self) -> None:
        path = RAW_RECORD_2024_DIR / 'R-815B 耐溶剂试验仪.docx'
        if not path.exists():
            self.skipTest(f"template not found: {path}")
        got = collect_docx_snapshot(path)
        expected = {'file_name': 'R-815B 耐溶剂试验仪.docx', 'file_size': 18231, 'table_count': 2, 'text_length': 409, 'has_general_check_keyword': True, 'general_check_length': 17, 'uncertainty_items_count': 0, 'measured_items_count': 0}
        self.assertEqual(got, expected)

    def test_field_semantics_should_mark_only_rows_with_values(self) -> None:
        detail_general_check = "\n".join(
            [
                "一、一般检查（*）：",
                "试验仪能水平放置。",
                "二、",
                "铅笔与试样间夹角： U=3°,k=2",
                "实测值： 60°。",
                "沿铅笔方向的力值校准： U=0.01N,k=2",
                "实测值： 5.10N。",
            ]
        )
        source_lines = extract_source_general_check_lines(detail_general_check)
        targets = [
            ("试验仪能水平放置。", True),
            ("恒温浴槽的试验温度[应为(60±3)℃]。", False),
            ("铅笔与试样间夹角[应为(60±5)°]。", True),
            ("沿铅笔方向的力值[应为(5±0.25)N]。", True),
        ]
        used_indexes: set[int] = set()
        for target, expected_mark in targets:
            idx, _ = match_best_source_line(
                target_text=target,
                source_lines=source_lines,
                used_indexes=used_indexes,
                threshold=0.30,
            )
            marked = idx >= 0 and is_reliable_result_semantic_match(target, source_lines[idx], normalize_space=normalize_space)
            self.assertEqual(marked, expected_mark, msg=f"target={target} idx={idx} source={source_lines[idx] if idx >= 0 else ''}")
            if marked:
                used_indexes.add(idx)

    def test_field_semantics_should_extract_only_present_items(self) -> None:
        detail_general_check = "\n".join(
            [
                "一、一般检查（*）：",
                "试验仪能水平放置。",
                "二、",
                "铅笔与试样间夹角： U=3°,k=2",
                "实测值： 60°。",
                "沿铅笔方向的力值校准： U=0.01N,k=2",
                "实测值： 5.10N。",
            ]
        )
        uncertainty_items = extract_uncertainty_items(detail_general_check, normalize_space=normalize_space)
        measured_items = extract_measured_value_items(detail_general_check, normalize_space=normalize_space)
        self.assertEqual(len(uncertainty_items), 2)
        self.assertEqual(len(measured_items), 2)
        anchors = [normalize_space(x.get("anchor", "")) for x in uncertainty_items]
        self.assertTrue(any("夹角" in a for a in anchors))
        self.assertTrue(any("力值" in a for a in anchors))
        self.assertFalse(any("温度" in a for a in anchors))


if __name__ == "__main__":
    unittest.main()
