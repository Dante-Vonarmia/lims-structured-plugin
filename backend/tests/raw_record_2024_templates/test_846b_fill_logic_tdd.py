import unittest
import sys
from pathlib import Path
import types
from xml.etree import ElementTree as ET

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

if "yaml" not in sys.modules:
    yaml_stub = types.ModuleType("yaml")
    yaml_stub.safe_load = lambda *_args, **_kwargs: {}
    sys.modules["yaml"] = yaml_stub
try:
    from backend.tests.raw_record_2024_templates._template_scenarios import (
        R846B_EXPECTED_SERIES_ACTUAL_PREFIX,
        R846B_EXPECTED_SERIES_NOMINAL_PREFIX,
        R846B_SOURCE_TEXT,
    )
except ModuleNotFoundError:
    from raw_record_2024_templates._template_scenarios import (
        R846B_EXPECTED_SERIES_ACTUAL_PREFIX,
        R846B_EXPECTED_SERIES_NOMINAL_PREFIX,
        R846B_SOURCE_TEXT,
    )

try:
    from backend.app.services.templates.r846b import fill_r846b_specific_sections
    from backend.app.services.docx_fill_service import (
        NS,
        _PLACEHOLDER_VALUES,
        _replace_uncertainty_value,
        extract_value_by_regex,
        get_cell_text,
        normalize_space,
        set_cell_text,
    )
except ModuleNotFoundError:
    from app.services.templates.r846b import fill_r846b_specific_sections
    from app.services.docx_fill_service import (
        NS,
        _PLACEHOLDER_VALUES,
        _replace_uncertainty_value,
        extract_value_by_regex,
        get_cell_text,
        normalize_space,
        set_cell_text,
    )


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _build_row(cells: list[str]) -> str:
    return "".join(
        [f"<w:tc><w:p><w:r><w:t>{value}</w:t></w:r></w:p></w:tc>" for value in cells]
    )


class Template846BFillLogicTDD(unittest.TestCase):
    def test_should_fill_by_section_presence(self) -> None:
        xml = (
            f'<w:root xmlns:w="{W_NS}">'
            "<w:tbl>"
            f"<w:tr>{_build_row(['二、刮针移动距离[应为(10~12) mm]：扩展不确定度U= mm,k=2。'])}</w:tr>"
            f"<w:tr>{_build_row(['实测值： mm。'])}</w:tr>"
            f"<w:tr>{_build_row(['三、往复刮漆速度[应为(60±2)次/分]：扩展不确定度U= 次/分,k=2。'])}</w:tr>"
            f"<w:tr>{_build_row(['四、刮针直径[应为(0.45±0.01) mm]：扩展不确定度U= mm,k=2。'])}</w:tr>"
            f"<w:tr>{_build_row(['实测值： mm。'])}</w:tr>"
            f"<w:tr>{_build_row(['六、刮穿动作电流：扩展不确定度U= mA,k=2。'])}</w:tr>"
            f"<w:tr>{_build_row(['实测值： mA。'])}</w:tr>"
            f"<w:tr>{_build_row(['七、负荷：扩展不确定度U= N,k=2。'])}</w:tr>"
            f"<w:tr>{_build_row(['标称值(N)', '', '', '', '', '', '', '', ''])}</w:tr>"
            f"<w:tr>{_build_row(['实际值(N)', '', '', '', '', '', '', '', ''])}</w:tr>"
            "</w:tbl>"
            "</w:root>"
        )
        root = ET.fromstring(xml)
        table = root.find(".//w:tbl", NS)
        self.assertIsNotNone(table)
        changed = fill_r846b_specific_sections(
            [table],  # type: ignore[arg-type]
            R846B_SOURCE_TEXT,
            ns=NS,
            placeholder_values=_PLACEHOLDER_VALUES,
            normalize_space=normalize_space,
            get_cell_text=get_cell_text,
            set_cell_text=set_cell_text,
            extract_value_by_regex=extract_value_by_regex,
            replace_uncertainty_value=_replace_uncertainty_value,
        )
        self.assertTrue(changed)

        rows = table.findall("./w:tr", NS)
        row_texts = [normalize_space(" ".join(get_cell_text(tc) for tc in row.findall("./w:tc", NS))) for row in rows]

        self.assertRegex(row_texts[0], r"二、刮针移动距离.*U=\s*0.1 mm,k=2。")
        self.assertRegex(row_texts[1], r"实测值：\s*10 mm。")
        self.assertRegex(row_texts[2], r"三、往复刮漆速度.*U=\s*2 次/分,k=2。")
        self.assertRegex(row_texts[3], r"四、刮针直径.*U=\s*0.1 mm,k=2。")
        self.assertRegex(row_texts[4], r"实测值：\s*0.45 mm。")
        self.assertRegex(row_texts[5], r"六、刮穿动作电流.*U=\s*0.1 mA,k=2。")
        self.assertRegex(row_texts[6], r"实测值：\s*5.0 mA。")
        self.assertRegex(row_texts[7], r"七、负荷.*U=\s*0.01 N,k=2。")
        self.assertEqual(row_texts[8].split()[1:5], R846B_EXPECTED_SERIES_NOMINAL_PREFIX)
        self.assertEqual(row_texts[9].split()[1:5], R846B_EXPECTED_SERIES_ACTUAL_PREFIX)


if __name__ == "__main__":
    unittest.main()
