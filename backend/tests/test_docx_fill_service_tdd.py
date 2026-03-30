import sys
import unittest
from pathlib import Path
import types
import re
import zipfile
import xml.etree.ElementTree as ET
import tempfile


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
    _fill_modify_certificate_blueprint_sections,
    _find_modify_certificate_continued_page_table,
    fill_modify_certificate_docx,
    get_cell_text,
    set_cell_text,
    NS,
    W_NS,
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

    def test_should_fill_modify_certificate_continued_page_from_general_check_full(self) -> None:
        template_path = BACKEND_DIR / "templates" / "修改证书蓝本.docx"
        with zipfile.ZipFile(template_path, "r") as zin:
            root = ET.fromstring(zin.read("word/document.xml"))

        tables = root.findall(".//w:tbl", NS)
        context = {
            "general_check_full": "\n".join(
                [
                    "一、\t一般检查（*）：",
                    "(1)\t旋转夹头能绕试件轴线双向旋转，旋转夹头转速均匀稳定。",
                    "(2)\t定位夹头能沿轴向移动调节两夹头间的距离。",
                    "注：",
                    "(1)\t使用过程中如对校准仪器技术指标产生怀疑，请重新校准。",
                ]
            )
        }
        changed = _fill_modify_certificate_blueprint_sections(tables, payload={}, context=context)
        self.assertTrue(changed)

        target_tbl = None
        for tbl in tables:
            text = " ".join(get_cell_text(tc) for tc in tbl.findall(".//w:tc", NS))
            if re.search(r"校准结果\s*/\s*说明|Results of calibration and additional explanation", text, flags=re.IGNORECASE):
                target_tbl = tbl
                break
        self.assertIsNotNone(target_tbl)
        rows = target_tbl.findall("./w:tr", NS)
        self.assertGreaterEqual(len(rows), 2)
        row1_cells = rows[1].findall("./w:tc", NS)
        self.assertTrue(row1_cells)
        filled_text = get_cell_text(row1_cells[0])
        self.assertIn("一、 一般检查（*）：", filled_text)
        self.assertIn("旋转夹头能绕试件轴线双向旋转", filled_text)
        self.assertNotIn("注：", filled_text)

    def test_should_copy_continued_page_table_from_source_in_modify_certificate_mode(self) -> None:
        template_path = BACKEND_DIR / "templates" / "修改证书蓝本.docx"
        sentinel = "SOURCE_CONTINUED_PAGE_SENTINEL"

        with zipfile.ZipFile(template_path, "r") as zin:
            source_root = ET.fromstring(zin.read("word/document.xml"))

        target_tbl = None
        for tbl in source_root.findall(".//w:tbl", NS):
            text = " ".join(get_cell_text(tc) for tc in tbl.findall(".//w:tc", NS))
            if re.search(r"校准结果\s*/\s*说明|Results of calibration and additional explanation", text, flags=re.IGNORECASE):
                target_tbl = tbl
                break
        self.assertIsNotNone(target_tbl)
        rows = target_tbl.findall("./w:tr", NS)
        self.assertGreaterEqual(len(rows), 2)
        row1_cells = rows[1].findall("./w:tc", NS)
        self.assertTrue(row1_cells)
        set_cell_text(row1_cells[0], sentinel)
        source_xml = ET.tostring(source_root, encoding="utf-8", xml_declaration=True)

        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            source_docx = td_path / "source-with-continued-page.docx"
            output_docx = td_path / "out.docx"

            with zipfile.ZipFile(template_path, "r") as zin, zipfile.ZipFile(source_docx, "w") as zout:
                for item in zin.infolist():
                    if item.filename == "word/document.xml":
                        zout.writestr(item, source_xml)
                    else:
                        zout.writestr(item, zin.read(item.filename))

            ok = fill_modify_certificate_docx(
                template_path=template_path,
                output_path=output_docx,
                context={
                    "device_name": "X",
                    "general_check_full": "FIELD_GENERAL_CHECK_SHOULD_NOT_BE_USED_WHEN_SOURCE_TABLE_EXISTS",
                },
                source_file_path=source_docx,
            )
            self.assertTrue(ok)

            with zipfile.ZipFile(output_docx, "r") as zf:
                out_xml = zf.read("word/document.xml").decode("utf-8", errors="ignore")
            self.assertIn(sentinel, out_xml)
            self.assertNotIn("FIELD_GENERAL_CHECK_SHOULD_NOT_BE_USED_WHEN_SOURCE_TABLE_EXISTS", out_xml)

    def test_should_pick_structured_continued_page_table_when_multiple_candidates_exist(self) -> None:
        root = ET.Element(f"{{{W_NS}}}document")
        body = ET.SubElement(root, f"{{{W_NS}}}body")

        flat_tbl = ET.SubElement(body, f"{{{W_NS}}}tbl")
        flat_tr = ET.SubElement(flat_tbl, f"{{{W_NS}}}tr")
        flat_tc = ET.SubElement(flat_tr, f"{{{W_NS}}}tc")
        set_cell_text(flat_tc, "校准结果/说明（续页）： A B C")

        structured_tbl = ET.SubElement(body, f"{{{W_NS}}}tbl")
        tr0 = ET.SubElement(structured_tbl, f"{{{W_NS}}}tr")
        tc0 = ET.SubElement(tr0, f"{{{W_NS}}}tc")
        set_cell_text(tc0, "校准结果/说明（续页）：")

        tr1 = ET.SubElement(structured_tbl, f"{{{W_NS}}}tr")
        tc10 = ET.SubElement(tr1, f"{{{W_NS}}}tc")
        tc11 = ET.SubElement(tr1, f"{{{W_NS}}}tc")
        tc12 = ET.SubElement(tr1, f"{{{W_NS}}}tc")
        set_cell_text(tc10, "注：")
        set_cell_text(tc11, "(1)")
        set_cell_text(tc12, "一般检查（*）：")

        picked = _find_modify_certificate_continued_page_table(root)
        self.assertIsNotNone(picked)
        self.assertIs(picked, structured_tbl)


if __name__ == "__main__":
    unittest.main()
