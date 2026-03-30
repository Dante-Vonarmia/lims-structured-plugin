import sys
import unittest
from pathlib import Path
import re


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.semantic_fill_lib import (
    build_series_row_value_maps_from_general_check_text,
    build_semantic_value_maps_from_general_check_text,
    extract_measured_value_items,
    extract_uncertainty_items,
    pick_series_row_values_for_label,
    replace_measured_value_placeholder_by_items,
    replace_uncertainty_u_placeholder_by_items,
)


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


class SemanticFillLibTDD(unittest.TestCase):
    def test_extract_measured_items_skip_empty_and_keep_two_values(self) -> None:
        text = "\n".join(
            [
                "二、恒温浴槽的试验温度[应为(60±3)℃]：扩展不确定度U=    ℃,k=2。",
                "(四次) 实测值：  ℃；  ℃；  ℃；  ℃。",
                "三、铅笔与试样间夹角[应为(60±5)°]：扩展不确定度U=3°,k=2",
                "实测值：60°。",
                "四、沿铅笔方向的力值[应为(5±0.25)N]：扩展不确定度U=0.01N,k=2",
                "实测值：5.10N。",
            ]
        )
        items = extract_measured_value_items(text, normalize_space=normalize_space)
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["value"], "60")
        self.assertEqual(items[0]["unit"], "°")
        self.assertEqual(items[1]["value"], "5.10")
        self.assertEqual(items[1]["unit"], "N")

    def test_fill_measured_values_with_anchor_hint(self) -> None:
        text = "\n".join(
            [
                "三、铅笔与试样间夹角[应为(60±5)°]：扩展不确定度U=3°,k=2",
                "实测值：60°。",
                "四、沿铅笔方向的力值[应为(5±0.25)N]：扩展不确定度U=0.01N,k=2",
                "实测值：5.10N。",
            ]
        )
        items = extract_measured_value_items(text, normalize_space=normalize_space)
        row3 = replace_measured_value_placeholder_by_items(
            "实测值： °。",
            items,
            normalize_space=normalize_space,
            anchor_hint="三、铅笔与试样间夹角[应为(60±5)°]： 扩展不确定度U= °,k=2。",
        )
        row4 = replace_measured_value_placeholder_by_items(
            "实测值： N。",
            items,
            normalize_space=normalize_space,
            anchor_hint="四、沿铅笔方向的力值[应为(5±0.25)N]： 扩展不确定度U= N,k=2。",
        )
        self.assertEqual(row3, "实测值： 60°。")
        self.assertEqual(row4, "实测值： 5.10N。")

    def test_fill_measured_values_append_unit_when_placeholder_missing_unit(self) -> None:
        text = "\n".join(
            [
                "三、铅笔与试样间夹角[应为(60±5)°]：扩展不确定度U=3°,k=2",
                "实测值：60°。",
            ]
        )
        items = extract_measured_value_items(text, normalize_space=normalize_space)
        row = replace_measured_value_placeholder_by_items(
            "实测值： 。",
            items,
            normalize_space=normalize_space,
            anchor_hint="三、铅笔与试样间夹角[应为(60±5)°]： 扩展不确定度U= °,k=2。",
        )
        self.assertEqual(row, "实测值： 60°。")

    def test_do_not_fill_when_no_reliable_match(self) -> None:
        text = "\n".join(
            [
                "三、铅笔与试样间夹角[应为(60±5)°]：扩展不确定度U=3°,k=2",
                "实测值：60°。",
                "四、沿铅笔方向的力值[应为(5±0.25)N]：扩展不确定度U=0.01N,k=2",
                "实测值：5.10N。",
            ]
        )
        items = extract_measured_value_items(text, normalize_space=normalize_space)
        untouched = replace_measured_value_placeholder_by_items(
            "(四次) 实测值： ℃； ℃； ℃； ℃。",
            items,
            normalize_space=normalize_space,
            anchor_hint="二、恒温浴槽的试验温度[应为(60±3)℃]： 扩展不确定度U= ℃,k=2。",
        )
        self.assertEqual(untouched, "(四次) 实测值： ℃； ℃； ℃； ℃。")

    def test_do_not_fill_uncertainty_when_no_reliable_match(self) -> None:
        text = "\n".join(
            [
                "三、铅笔与试样间夹角[应为(60±5)°]：扩展不确定度U=3°,k=2",
                "四、沿铅笔方向的力值[应为(5±0.25)N]：扩展不确定度U=0.01N,k=2",
            ]
        )
        items = extract_uncertainty_items(text, normalize_space=normalize_space)
        untouched = replace_uncertainty_u_placeholder_by_items(
            "二、恒温浴槽的试验温度[应为(60±3)℃]： 扩展不确定度U= ℃,k=2。",
            items,
            normalize_space=normalize_space,
        )
        self.assertEqual(untouched, "二、恒温浴槽的试验温度[应为(60±3)℃]： 扩展不确定度U= ℃,k=2。")

    def test_fill_uncertainty_append_unit_when_placeholder_missing_unit(self) -> None:
        text = "三、铅笔与试样间夹角[应为(60±5)°]：扩展不确定度U=3°,k=2"
        items = extract_uncertainty_items(text, normalize_space=normalize_space)
        filled = replace_uncertainty_u_placeholder_by_items(
            "三、铅笔与试样间夹角[应为(60±5)°]： 扩展不确定度U= ,k=2。",
            items,
            normalize_space=normalize_space,
        )
        self.assertEqual(filled, "三、铅笔与试样间夹角[应为(60±5)°]： 扩展不确定度U= 3 °,k=2。")

    def test_fill_uncertainty_should_keep_placeholder_unit_token(self) -> None:
        text = "二、刮针移动距离校准： U=0.1mm,k=2"
        items = extract_uncertainty_items(text, normalize_space=normalize_space)
        filled = replace_uncertainty_u_placeholder_by_items(
            "二、刮针移动距离[应为(10~12) mm]：扩展不确定度U= mm,k=2。",
            items,
            normalize_space=normalize_space,
        )
        self.assertEqual(filled, "二、刮针移动距离[应为(10~12) mm]：扩展不确定度U= 0.1 mm,k=2。")

    def test_fill_uncertainty_with_empty_value_placeholder_and_ma_unit(self) -> None:
        text = "六、刮穿动作电流：扩展不确定度U=0.1mA,k=2"
        items = extract_uncertainty_items(text, normalize_space=normalize_space)
        filled = replace_uncertainty_u_placeholder_by_items(
            "六、刮穿动作电流：扩展不确定度U=     mA,k=2。",
            items,
            normalize_space=normalize_space,
        )
        self.assertEqual(filled, "六、刮穿动作电流：扩展不确定度U= 0.1 mA,k=2。")

    def test_extract_measured_items_support_unit_in_label_parentheses(self) -> None:
        text = "\n".join(
            [
                "五、试验电压[应为直流(6.5±0.5)V]：扩展不确定度U=0.3V,k=2。",
                "实测值(V)：6.8。",
                "六、刮穿动作电流：扩展不确定度U=0.1mA,k=2。",
                "实测值(mA)：5.0。",
            ]
        )
        items = extract_measured_value_items(text, normalize_space=normalize_space)
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["value"], "6.8")
        self.assertEqual(items[0]["unit"], "V")
        self.assertEqual(items[1]["value"], "5.0")
        self.assertEqual(items[1]["unit"], "mA")

    def test_extract_measured_items_support_spaced_chinese_label(self) -> None:
        text = "\n".join(
            [
                "六、刮穿动作电流校准： U=0.1mA,k=2",
                "实 测 值 (mA)： 5.0。",
            ]
        )
        items = extract_measured_value_items(text, normalize_space=normalize_space)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["value"], "5.0")
        self.assertEqual(items[0]["unit"], "mA")

    def test_fill_measured_values_support_spaced_chinese_label(self) -> None:
        text = "\n".join(
            [
                "六、刮穿动作电流校准： U=0.1mA,k=2",
                "实 测 值 (mA)： 5.0。",
            ]
        )
        items = extract_measured_value_items(text, normalize_space=normalize_space)
        row = replace_measured_value_placeholder_by_items(
            "实 测 值： mA。",
            items,
            normalize_space=normalize_space,
            anchor_hint="六、刮穿动作电流： 扩展不确定度U= mA,k=2。",
        )
        self.assertEqual(row, "实 测 值： 5.0mA。")

    def test_build_semantic_maps_support_calibration_value_header(self) -> None:
        text = "\n".join(
            [
                "标称值(N)\t0.05\t0.1\t0.2",
                "校准值(N)\t0.052\t0.12\t0.21",
            ]
        )
        maps = build_semantic_value_maps_from_general_check_text(text, normalize_space=normalize_space)
        self.assertEqual(len(maps), 1)
        self.assertEqual(maps[0].get("0.05"), "0.052")
        self.assertEqual(maps[0].get("0.1"), "0.12")
        self.assertEqual(maps[0].get("0.2"), "0.21")

    def test_pick_series_row_values_support_actual_to_calibration_alias(self) -> None:
        text = "\n".join(
            [
                "标称值(N)\t0.05\t0.1\t0.2\t0.5",
                "校准值(N)\t0.052\t0.12\t0.21\t0.52",
            ]
        )
        maps = build_series_row_value_maps_from_general_check_text(text, normalize_space=normalize_space)
        standard_values = pick_series_row_values_for_label(maps, "标准值(N)", normalize_space=normalize_space)
        actual_values = pick_series_row_values_for_label(maps, "实际值(N)", normalize_space=normalize_space)
        self.assertEqual(standard_values[:4], ["0.05", "0.1", "0.2", "0.5"])
        self.assertEqual(actual_values[:4], ["0.052", "0.12", "0.21", "0.52"])

    def test_pick_series_row_values_support_numeric_key_rows(self) -> None:
        text = "\n".join(
            [
                "往复刮漆次数\t时间t(s)\t刮漆速度ν(次/分)\t刮漆速度平均值ν(次/分)",
                "60\t60\t60.1\t60.0",
                "60\t60\t59.9\t60.0",
            ]
        )
        maps = build_series_row_value_maps_from_general_check_text(text, normalize_space=normalize_space)
        values = pick_series_row_values_for_label(maps, "60", normalize_space=normalize_space)
        self.assertEqual(values[:3], ["60", "60.1", "60.0"])

    def test_pick_series_row_values_support_plain_text_rows(self) -> None:
        text = "\n".join(
            [
                "标称值(N)： 0.05 0.1 0.2 0.5 1 2 5 10",
                "校准值(N)： 0.052 0.12 0.21 0.52 1.0 2.0 5.0 10.0",
            ]
        )
        maps = build_series_row_value_maps_from_general_check_text(text, normalize_space=normalize_space)
        nominal = pick_series_row_values_for_label(maps, "标准值(N)", normalize_space=normalize_space)
        actual = pick_series_row_values_for_label(maps, "实际值(N)", normalize_space=normalize_space)
        self.assertEqual(nominal[:4], ["0.05", "0.1", "0.2", "0.5"])
        self.assertEqual(actual[:4], ["0.052", "0.12", "0.21", "0.52"])

    def test_build_semantic_maps_should_not_stop_on_note_line(self) -> None:
        text = "\n".join(
            [
                "标称值(N)\t0.05\t0.1\t0.2",
                "校准值(N)\t0.052\t0.12\t0.21",
                "注：本条仅说明，不是结束标记。",
                "标称值(N)\t0.5\t1.0\t2.0",
                "校准值(N)\t0.52\t1.02\t2.01",
            ]
        )
        maps = build_semantic_value_maps_from_general_check_text(text, normalize_space=normalize_space)
        merged = {}
        for item in maps:
            merged.update(item)
        self.assertEqual(merged.get("0.2"), "0.21")
        self.assertEqual(merged.get("0.5"), "0.52")
        self.assertEqual(merged.get("1"), "1.02")
        self.assertEqual(merged.get("2"), "2.01")


if __name__ == "__main__":
    unittest.main()
