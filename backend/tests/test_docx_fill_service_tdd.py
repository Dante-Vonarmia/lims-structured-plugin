import sys
import unittest
from pathlib import Path
import types


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

if "yaml" not in sys.modules:
    yaml_stub = types.ModuleType("yaml")
    yaml_stub.safe_load = lambda *_args, **_kwargs: {}
    sys.modules["yaml"] = yaml_stub

from app.services.docx_fill_service import (
    _extract_r882_background_noise_values,
    _extract_r882_series_rows_from_text,
    _resolve_detail_general_check_for_generic_fill,
)


class DocxFillServiceTDD(unittest.TestCase):
    def test_should_prefer_raw_record_when_field_block_is_sparse(self) -> None:
        sparse_field_block = "\n".join(
            [
                "序号/标记\t内容\t1\t2\t3",
                "三、\t往复刮漆速度[应为(60±2)次/分]：扩展不确定度U=\t\t\t",
                "\t往复刮漆次数\t时间t(s)\t刮漆速度ν(次/分)\t刮漆速度平均值ν(次/分)",
                "\t60\t\t\t",
            ]
        )
        rich_raw_record = "\n".join(
            [
                "一、一般检查：",
                "二、刮针移动距离[应为(10~12) mm]：扩展不确定度U=0.1mm,k=2。",
                "实测值：10mm。",
                "五、试验电压[应为直流(6.5±0.5) V]：扩展不确定度U=0.3V,k=2。",
                "实测值(V)：6.8。",
                "六、刮穿动作电流：扩展不确定度U=0.1mA,k=2。",
                "实测值(mA)：5.0。",
                "七、负荷：",
                "标称值(N)\t0.05\t0.1\t0.2",
                "校准值(N)\t0.052\t0.12\t0.21",
            ]
        )
        context = {
            "general_check_full": sparse_field_block,
            "raw_record": rich_raw_record,
        }
        resolved = _resolve_detail_general_check_for_generic_fill(context)
        self.assertIn("扩展不确定度U=0.3V,k=2。", resolved)
        self.assertIn("实测值(V)：6.8。", resolved)
        self.assertIn("校准值(N) 0.052 0.12 0.21", resolved)
        self.assertNotIn("往复刮漆速度[应为(60±2)次/分]：扩展不确定度U=\t\t\t", resolved)

    def test_should_keep_field_block_when_it_is_richer(self) -> None:
        rich_field_block = "\n".join(
            [
                "一、一般检查：",
                "二、刮针移动距离[应为(10~12) mm]：扩展不确定度U=0.1mm,k=2。",
                "实测值：10mm。",
                "五、试验电压[应为直流(6.5±0.5) V]：扩展不确定度U=0.3V,k=2。",
                "实测值(V)：6.8。",
            ]
        )
        sparse_raw_record = "\n".join(
            [
                "一、一般检查：",
                "二、刮针移动距离[应为(10~12) mm]：扩展不确定度U= mm,k=2。",
                "实测值： mm。",
            ]
        )
        context = {
            "general_check_full": rich_field_block,
            "raw_record": sparse_raw_record,
        }
        resolved = _resolve_detail_general_check_for_generic_fill(context)
        self.assertIn("扩展不确定度U=0.3V,k=2。", resolved)
        self.assertIn("实测值(V)：6.8。", resolved)
        self.assertNotIn("扩展不确定度U= mm,k=2。", resolved)

    def test_should_extract_r882_background_noise_values(self) -> None:
        text = "\n".join(
            [
                "(1)在空载、0kV情况下，屏蔽局放试验室的背景噪声为0.2pC。",
                "(2)在空载情况下，屏蔽局放试验室在160kV电压时的背景噪声：0.3pC。",
                "(3)在空载情况下，屏蔽局放试验室在220kV电压时的背景噪声：0.4pC。",
            ]
        )
        got = _extract_r882_background_noise_values(text)
        self.assertEqual(got, ["0.2", "0.3", "0.4"])

    def test_should_extract_r882_p_series_rows_from_tabular_text(self) -> None:
        text = "\n".join(
            [
                "位置\t频率\t无屏蔽室时测得的功率P1(dBm)\t屏蔽室内测得的功率P2(dBm)\t屏蔽效能SE(dB)",
                "1\t14kHz\t-27.2\t-33.2\t6.0",
                "2\t14kHz\t-27.2\t-33.3\t6.1",
            ]
        )
        got = _extract_r882_series_rows_from_text(text)
        self.assertEqual(got, [("-27.2", "-33.2", "6.0"), ("-27.2", "-33.3", "6.1")])


if __name__ == "__main__":
    unittest.main()
