import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.result_check_matcher import (
    extract_source_general_check_lines,
    match_best_source_line,
)


class ResultCheckMatcherTDD(unittest.TestCase):
    def test_extract_source_general_check_lines(self) -> None:
        text = "一、一般检查：\n(1)夹具能夹紧试样。\n(2)两夹具间距可以调整。\n"
        lines = extract_source_general_check_lines(text)
        self.assertEqual(lines, ["夹具能夹紧试样。", "两夹具间距可以调整。"])

    def test_match_not_by_same_index_but_semantics(self) -> None:
        source = [
            "旋转夹头能绕试件轴线双向旋转，旋转夹头转速均匀稳定",
            "定位夹头能沿轴向移动调节两夹头间的距离，定位夹头上能施加一定负荷",
            "夹具能夹紧试样，两夹头间最大起始距离：500mm。",
            "扭光绕棒有足够的刚度。",
            "负荷，齐全，能满足试验要求。",
        ]
        target = "两夹具间距离可以调整。其最大距离为 mm，由标度尺指示。"
        idx, score = match_best_source_line(target, source, threshold=0.30)
        self.assertGreaterEqual(score, 0.30)
        self.assertEqual(idx, 2)

    def test_match_should_fail_when_content_mismatch(self) -> None:
        source = [
            "夹具能夹紧试样。",
            "两夹具间距可以调整。",
        ]
        target = "试样正反向扭转次数可设定，由计数器指示。"
        idx, score = match_best_source_line(target, source, threshold=0.50)
        self.assertEqual(idx, -1)
        self.assertLess(score, 0.50)

    def test_extract_from_single_line_collapsed_text(self) -> None:
        text = "一般检查：(1)夹具能夹紧试样。(2)两夹具间距可以调整。(3)定位夹具施加负荷后可平直。"
        lines = extract_source_general_check_lines(text)
        self.assertTrue(any("夹具能夹紧试样" in x for x in lines))
        self.assertTrue(any("两夹具间距可以调整" in x for x in lines))
        self.assertTrue(any("施加负荷" in x for x in lines))

    def test_match_distance_row_to_source_third_item(self) -> None:
        source = [
            "旋转夹头能绕试件轴线双向旋转，旋转夹头转速均匀稳定",
            "定位夹头能沿轴向移动调节两夹头间的距离，定位夹头上能施加一定负荷",
            "夹具能夹紧试样，两夹头间最大起始距离：500mm。",
            "扭光绕棒有足够的刚度。",
            "负荷，齐全，能满足试验要求。",
        ]
        target = "两夹具间距离可以调整。其最大距离为 mm，由标度尺指示。"
        idx, score = match_best_source_line(target, source, threshold=0.30)
        self.assertEqual(idx, 2)
        self.assertGreaterEqual(score, 0.30)


if __name__ == "__main__":
    unittest.main()
