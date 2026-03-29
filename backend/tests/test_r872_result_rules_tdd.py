import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.r872_result_rules import (
    extract_r872_max_distance_mm,
    fill_r872_requirement_text,
    should_mark_r872_result,
)


class R872ResultRulesTDD(unittest.TestCase):
    def test_r872_result_rules_follow_expected_pattern(self) -> None:
        source_lines = [
            "旋转夹头能绕试件轴线双向旋转，旋转夹头转速均匀稳定。",
            "定位夹头能沿轴向移动调节两夹头间的距离，定位夹头上能施加一定负荷，使扭转的试件处于平直状态。",
            "夹具能夹紧试样，两夹头间最大起始距离：500mm。",
            "扭光绕棒有足够的刚度。",
            "负荷，齐全，能满足试验要求。",
        ]
        # 用户确认的样例预期：
        # 1不勾,2勾,3勾,4不勾,5勾,第二板块不勾
        self.assertFalse(should_mark_r872_result("夹具能夹紧试样。", source_lines))
        self.assertTrue(should_mark_r872_result("两夹具间距离可以调整。其最大距离为 mm，由标度尺指示。", source_lines))
        self.assertTrue(should_mark_r872_result("定位夹具施加负荷后，可使试样始终处于平直状态。", source_lines))
        self.assertFalse(should_mark_r872_result("试样正反向扭转次数可设定，由计数器指示。", source_lines))
        self.assertTrue(should_mark_r872_result("负荷齐全，能满足试验要求。", source_lines))
        self.assertFalse(should_mark_r872_result("扭转速度应为(30±3)r/min和(60±6)r/min", source_lines))

    def test_empty_row_requirement_must_not_be_marked(self) -> None:
        source_lines = [
            "旋转夹头能绕试件轴线双向旋转，旋转夹头转速均匀稳定。",
            "定位夹头能沿轴向移动调节两夹头间的距离，定位夹头上能施加一定负荷，使扭转的试件处于平直状态。",
            "夹具能夹紧试样，两夹头间最大起始距离：500mm。",
            "负荷，齐全，能满足试验要求。",
        ]
        self.assertFalse(should_mark_r872_result("", source_lines))

    def test_extract_max_distance_mm_from_source(self) -> None:
        source_lines = [
            "夹具能夹紧试样，两夹头间最大起始距离：500mm。",
        ]
        self.assertEqual(extract_r872_max_distance_mm(source_lines), "500")

    def test_fill_requirement_text_with_max_distance(self) -> None:
        source_lines = [
            "夹具能夹紧试样，两夹头间最大起始距离：500mm。",
        ]
        target = "两夹具间距离可以调整。其最大距离为 mm，由标度尺指示。"
        self.assertEqual(
            fill_r872_requirement_text(target, source_lines),
            "两夹具间距离可以调整。其最大距离为 500mm，由标度尺指示。",
        )


if __name__ == "__main__":
    unittest.main()
