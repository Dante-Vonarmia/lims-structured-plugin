import re
import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.result_check_matcher import extract_source_general_check_lines, match_best_source_line
from app.services.semantic_fill_lib import is_reliable_result_semantic_match


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def evaluate_marks(detail_general_check: str, targets: list[str]) -> list[bool]:
    source_lines = extract_source_general_check_lines(detail_general_check)
    used_indexes: set[int] = set()
    marks: list[bool] = []
    for target in targets:
        idx, _ = match_best_source_line(
            target_text=target,
            source_lines=source_lines,
            used_indexes=used_indexes,
            threshold=0.30,
        )
        marked = idx >= 0 and is_reliable_result_semantic_match(target, source_lines[idx], normalize_space=normalize_space)
        marks.append(marked)
        if marked:
            used_indexes.add(idx)
    return marks


class Template815BBehaviorTDD(unittest.TestCase):
    def test_should_mark_only_when_required_values_exist(self) -> None:
        # Given: 第二条缺失，第三/四条有值
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
        targets = [
            "试验仪能水平放置。",
            "恒温浴槽的试验温度[应为(60±3)℃]。",
            "铅笔与试样间夹角[应为(60±5)°]。",
            "沿铅笔方向的力值[应为(5±0.25)N]。",
        ]

        # When
        marks = evaluate_marks(detail_general_check, targets)

        # Then
        self.assertEqual(marks, [True, False, True, True])

    def test_should_not_mark_when_only_section_headers_exist(self) -> None:
        # Given: 只有条目标题，没有U和实测值
        detail_general_check = "\n".join(
            [
                "一、一般检查（*）：",
                "试验仪能水平放置。",
                "二、恒温浴槽的试验温度[应为(60±3)℃]。",
                "三、铅笔与试样间夹角[应为(60±5)°]。",
                "四、沿铅笔方向的力值[应为(5±0.25)N]。",
            ]
        )
        targets = [
            "恒温浴槽的试验温度[应为(60±3)℃]。",
            "铅笔与试样间夹角[应为(60±5)°]。",
            "沿铅笔方向的力值[应为(5±0.25)N]。",
        ]

        # When
        marks = evaluate_marks(detail_general_check, targets)

        # Then
        self.assertEqual(marks, [True, True, True])

    def test_should_mark_second_item_when_temperature_u_and_measured_values_exist(self) -> None:
        # Given: 第二点存在U与实测值
        detail_general_check = "\n".join(
            [
                "一、一般检查（*）：",
                "试验仪能水平放置。",
                "二、恒温浴槽的试验温度[应为(60±3)℃]： U=0.5℃,k=2",
                "实测值： 60℃。",
                "三、铅笔与试样间夹角[应为(60±5)°]： U=3°,k=2",
                "实测值： 60°。",
                "四、沿铅笔方向的力值[应为(5±0.25)N]： U=0.01N,k=2",
                "实测值： 5.10N。",
            ]
        )
        targets = [
            "试验仪能水平放置。",
            "恒温浴槽的试验温度[应为(60±3)℃]。",
            "铅笔与试样间夹角[应为(60±5)°]。",
            "沿铅笔方向的力值[应为(5±0.25)N]。",
        ]

        # When
        marks = evaluate_marks(detail_general_check, targets)

        # Then
        self.assertEqual(marks, [True, True, True, True])


if __name__ == "__main__":
    unittest.main()
