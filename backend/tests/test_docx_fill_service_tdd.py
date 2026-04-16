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
    _copy_r802b_general_check_table_from_source,
    _copy_modify_certificate_continued_page_table_from_source,
    _extract_r882_background_noise_values,
    _extract_r882_series_rows_from_text,
    _fill_modify_certificate_blueprint_sections,
    _fill_modify_certificate_measurement_rows,
    _find_modify_certificate_continued_page_table,
    build_r825b_payload,
    fill_modify_certificate_docx,
    get_cell_text,
    set_cell_text,
    NS,
    W_NS,
    _resolve_detail_general_check_for_generic_fill,
    _sanitize_general_check_table_rows,
    _strip_general_check_required_marker,
    _trim_general_check_note_block_for_record_fill,
)


class DocxFillServiceTDD(unittest.TestCase):
    def test_should_strip_general_check_required_marker(self) -> None:
        tbl = ET.Element(f"{{{W_NS}}}tbl")
        row = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        cell = ET.SubElement(row, f"{{{W_NS}}}tc")
        set_cell_text(cell, "一般检查（*）：")

        changed = _strip_general_check_required_marker(tbl)

        self.assertTrue(changed)
        self.assertEqual(get_cell_text(cell), "一般检查：")

    def test_should_strip_split_required_marker_nodes(self) -> None:
        p = ET.Element(f"{{{W_NS}}}p")
        r1 = ET.SubElement(p, f"{{{W_NS}}}r")
        t1 = ET.SubElement(r1, f"{{{W_NS}}}t")
        t1.text = "一般检查"
        r2 = ET.SubElement(p, f"{{{W_NS}}}r")
        t2 = ET.SubElement(r2, f"{{{W_NS}}}t")
        t2.text = "（*）："

        changed = _strip_general_check_required_marker(p)

        self.assertTrue(changed)
        self.assertEqual(t1.text, "一般检查")
        self.assertEqual(t2.text, "：")

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
        template_path = BACKEND_DIR / "templates" / "modify-certificate-blueprint.docx"
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

    def test_should_trim_note_block_for_generic_record_fill(self) -> None:
        source = "\n".join(
            [
                "一、\t一般检查：",
                "(1)\t旋转夹头能绕试件轴线双向旋转。",
                "注：",
                "(1)\t使用过程中如对校准仪器技术指标产生怀疑，请重新校准。",
            ]
        )
        got = _trim_general_check_note_block_for_record_fill(source)
        self.assertIn("一、\t一般检查：", got)
        self.assertIn("(1)\t旋转夹头能绕试件轴线双向旋转。", got)
        self.assertNotIn("注：", got)
        self.assertNotIn("请重新校准", got)

    def test_should_remove_note_rows_when_sanitizing_r802_general_check_table(self) -> None:
        tbl = ET.Element(f"{{{W_NS}}}tbl")

        row1 = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        cell11 = ET.SubElement(row1, f"{{{W_NS}}}tc")
        set_cell_text(cell11, "一般检查：")

        row2 = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        cell21 = ET.SubElement(row2, f"{{{W_NS}}}tc")
        set_cell_text(cell21, "(1) 旋转夹头能绕试件轴线双向旋转。")

        row3 = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        cell31 = ET.SubElement(row3, f"{{{W_NS}}}tc")
        set_cell_text(cell31, "注：")

        row4 = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        cell41 = ET.SubElement(row4, f"{{{W_NS}}}tc")
        set_cell_text(cell41, "(1) 使用过程中如对校准仪器技术指标产生怀疑，请重新校准。")

        _sanitize_general_check_table_rows(tbl)

        text = " ".join([(node.text or "") for node in tbl.findall(".//w:t", NS)])
        self.assertIn("一般检查", text)
        self.assertIn("旋转夹头能绕试件轴线双向旋转", text)
        self.assertNotIn("注：", text)
        self.assertNotIn("请重新校准", text)

    def test_should_fill_modify_certificate_continued_page_certificate_no(self) -> None:
        tbl = ET.Element(f"{{{W_NS}}}tbl")

        cert_row = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        cert_label = ET.SubElement(cert_row, f"{{{W_NS}}}tc")
        cert_value = ET.SubElement(cert_row, f"{{{W_NS}}}tc")
        set_cell_text(cert_label, "缆专检号：")
        set_cell_text(cert_value, "")

        marker_row = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        marker_cell = ET.SubElement(marker_row, f"{{{W_NS}}}tc")
        set_cell_text(marker_cell, "Main measurement standard instruments Calibration Information Received date")
        for _ in range(2):
            extra_row = ET.SubElement(tbl, f"{{{W_NS}}}tr")
            extra_cell = ET.SubElement(extra_row, f"{{{W_NS}}}tc")
            set_cell_text(extra_cell, "")

        changed = _fill_modify_certificate_blueprint_sections(
            [tbl],
            payload={"certificate_no": "CC26-0202C-10"},
            context={},
        )
        self.assertTrue(changed)

        rows = tbl.findall("./w:tr", NS)
        filled_cells = rows[0].findall("./w:tc", NS)
        self.assertEqual(get_cell_text(filled_cells[1]), "CC26-0202C-10")

    def test_should_fill_modify_certificate_top_header_certificate_no(self) -> None:
        tbl = ET.Element(f"{{{W_NS}}}tbl")
        row = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        label_cell = ET.SubElement(row, f"{{{W_NS}}}tc")
        value_cell = ET.SubElement(row, f"{{{W_NS}}}tc")
        set_cell_text(label_cell, "缆专检号：")
        set_cell_text(value_cell, "")

        changed = _fill_modify_certificate_blueprint_sections(
            [tbl],
            payload={"certificate_no": "CC25-0202C-14"},
            context={},
        )
        self.assertTrue(changed)

        cells = row.findall("./w:tc", NS)
        self.assertEqual(get_cell_text(cells[1]), "CC25-0202C-14")

    def test_should_build_modify_certificate_payload_from_raw_record_fallback(self) -> None:
        payload = build_r825b_payload(
            {
                "raw_record": "2.11 金鸽 Ar G工 A200441033 22.5 15.0 43.4 40.0 5.0 20.06 / √ √ √ √ √ 43.4 0 40.0 0 22.5 2 4.2 144 2.91 √ √ 校阀 15.0 2 √ √ 31.2 梁光志",
            },
            None,
        )

        self.assertEqual(payload.get("device_model"), "A200441033")
        self.assertTrue(payload.get("device_name"))

    def test_should_copy_continued_page_table_from_source_in_modify_certificate_mode(self) -> None:
        template_path = BACKEND_DIR / "templates" / "modify-certificate-blueprint.docx"
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

    def test_should_copy_all_modify_certificate_continued_page_tables_from_source(self) -> None:
        def build_continued_tbl(head: str, row_text: str) -> ET.Element:
            tbl = ET.Element(f"{{{W_NS}}}tbl")
            tr0 = ET.SubElement(tbl, f"{{{W_NS}}}tr")
            tc0 = ET.SubElement(tr0, f"{{{W_NS}}}tc")
            set_cell_text(tc0, f"校准结果/说明（续页）：{head}")
            tr1 = ET.SubElement(tbl, f"{{{W_NS}}}tr")
            tc1 = ET.SubElement(tr1, f"{{{W_NS}}}tc")
            set_cell_text(tc1, f"(1) {row_text}")
            return tbl

        source_root = ET.Element(f"{{{W_NS}}}document")
        source_body = ET.SubElement(source_root, f"{{{W_NS}}}body")
        source_tbl_1 = build_continued_tbl("A", "SOURCE_ROW_1")
        source_tbl_2 = build_continued_tbl("B", "SOURCE_ROW_2")
        source_tbl_3 = build_continued_tbl("C", "SOURCE_ROW_3")
        source_body.append(source_tbl_1)
        source_body.append(source_tbl_2)
        source_body.append(source_tbl_3)
        source_body.append(ET.Element(f"{{{W_NS}}}sectPr"))

        target_root = ET.Element(f"{{{W_NS}}}document")
        target_body = ET.SubElement(target_root, f"{{{W_NS}}}body")
        target_tbl_1 = build_continued_tbl("A", "TARGET_ROW_1")
        target_tbl_2 = build_continued_tbl("B", "TARGET_ROW_2")
        target_body.append(target_tbl_1)
        target_body.append(target_tbl_2)
        target_body.append(ET.Element(f"{{{W_NS}}}sectPr"))

        source_xml = ET.tostring(source_root, encoding="utf-8", xml_declaration=True)
        with tempfile.TemporaryDirectory() as td:
            source_docx = Path(td) / "source.docx"
            with zipfile.ZipFile(source_docx, "w") as zf:
                zf.writestr("word/document.xml", source_xml)

            copied, copied_tables = _copy_modify_certificate_continued_page_table_from_source(
                target_root=target_root,
                source_file_path=source_docx,
            )
            self.assertTrue(copied)
            self.assertEqual(len(copied_tables), 3)

        target_text = ET.tostring(target_root, encoding="unicode")
        self.assertIn("SOURCE_ROW_1", target_text)
        self.assertIn("SOURCE_ROW_2", target_text)
        self.assertIn("SOURCE_ROW_3", target_text)
        self.assertNotIn("TARGET_ROW_1", target_text)
        self.assertNotIn("TARGET_ROW_2", target_text)

    def test_should_fill_measurement_header_code_when_no_rows(self) -> None:
        tbl = ET.Element(f"{{{W_NS}}}tbl")

        title_row = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        title_cell = ET.SubElement(title_row, f"{{{W_NS}}}tc")
        set_cell_text(title_cell, "本次校准所使用的主要计量标准器具：")

        header_row = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        for text in ("器具名称\nInstrument name", "型号/规格\nModel/Specification", "", "测量范围\nMeasurement range"):
            cell = ET.SubElement(header_row, f"{{{W_NS}}}tc")
            set_cell_text(cell, text)

        data_row = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        for text in ("钢直尺", "300m", "JL0A107-3", "(0-300)mm"):
            cell = ET.SubElement(data_row, f"{{{W_NS}}}tc")
            set_cell_text(cell, text)

        summary_row = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        summary_cell = ET.SubElement(summary_row, f"{{{W_NS}}}tc")
        set_cell_text(summary_cell, "以上计量标准器具的量值溯源至国家基准/测量标准。")

        changed = _fill_modify_certificate_measurement_rows(tbl, [])
        self.assertTrue(changed)

        rows = tbl.findall("./w:tr", NS)
        header_cells = rows[1].findall("./w:tc", NS)
        header_code_text = get_cell_text(header_cells[2])
        self.assertIn("编号", header_code_text)
        self.assertIn("Number", header_code_text)

    def test_should_replace_entire_continued_range_not_only_tables(self) -> None:
        source_root = ET.Element(f"{{{W_NS}}}document")
        source_body = ET.SubElement(source_root, f"{{{W_NS}}}body")
        source_tbl = ET.SubElement(source_body, f"{{{W_NS}}}tbl")
        source_tr = ET.SubElement(source_tbl, f"{{{W_NS}}}tr")
        source_tc = ET.SubElement(source_tr, f"{{{W_NS}}}tc")
        set_cell_text(source_tc, "校准结果/说明（续页）：")
        source_p = ET.SubElement(source_body, f"{{{W_NS}}}p")
        source_r = ET.SubElement(source_p, f"{{{W_NS}}}r")
        source_t = ET.SubElement(source_r, f"{{{W_NS}}}t")
        source_t.text = "SOURCE_PARAGRAPH_IN_CONTINUED_RANGE"
        source_body.append(ET.Element(f"{{{W_NS}}}sectPr"))

        target_root = ET.Element(f"{{{W_NS}}}document")
        target_body = ET.SubElement(target_root, f"{{{W_NS}}}body")
        target_tbl = ET.SubElement(target_body, f"{{{W_NS}}}tbl")
        target_tr = ET.SubElement(target_tbl, f"{{{W_NS}}}tr")
        target_tc = ET.SubElement(target_tr, f"{{{W_NS}}}tc")
        set_cell_text(target_tc, "校准结果/说明（续页）：")
        target_p = ET.SubElement(target_body, f"{{{W_NS}}}p")
        target_r = ET.SubElement(target_p, f"{{{W_NS}}}r")
        target_t = ET.SubElement(target_r, f"{{{W_NS}}}t")
        target_t.text = "TARGET_PARAGRAPH_IN_CONTINUED_RANGE"
        target_body.append(ET.Element(f"{{{W_NS}}}sectPr"))

        source_xml = ET.tostring(source_root, encoding="utf-8", xml_declaration=True)
        with tempfile.TemporaryDirectory() as td:
            source_docx = Path(td) / "source-range.docx"
            with zipfile.ZipFile(source_docx, "w") as zf:
                zf.writestr("word/document.xml", source_xml)
            copied, copied_tables = _copy_modify_certificate_continued_page_table_from_source(
                target_root=target_root,
                source_file_path=source_docx,
            )
            self.assertTrue(copied)
            self.assertTrue(copied_tables)

        target_text = ET.tostring(target_root, encoding="unicode")
        self.assertIn("SOURCE_PARAGRAPH_IN_CONTINUED_RANGE", target_text)
        self.assertNotIn("TARGET_PARAGRAPH_IN_CONTINUED_RANGE", target_text)

    def test_should_copy_all_r802b_continued_pages_from_source_range(self) -> None:
        source_root = ET.Element(f"{{{W_NS}}}document")
        source_body = ET.SubElement(source_root, f"{{{W_NS}}}body")
        source_intro_tbl = ET.SubElement(source_body, f"{{{W_NS}}}tbl")
        intro_tr = ET.SubElement(source_intro_tbl, f"{{{W_NS}}}tr")
        intro_tc = ET.SubElement(intro_tr, f"{{{W_NS}}}tc")
        set_cell_text(intro_tc, "器具编号：R802B")

        source_header_tbl = ET.SubElement(source_body, f"{{{W_NS}}}tbl")
        source_header_tr = ET.SubElement(source_header_tbl, f"{{{W_NS}}}tr")
        source_header_tc = ET.SubElement(source_header_tr, f"{{{W_NS}}}tc")
        set_cell_text(source_header_tc, "校准证书续页专用")

        source_title_tbl = ET.SubElement(source_body, f"{{{W_NS}}}tbl")
        source_title_tr = ET.SubElement(source_title_tbl, f"{{{W_NS}}}tr")
        source_title_tc = ET.SubElement(source_title_tr, f"{{{W_NS}}}tc")
        set_cell_text(source_title_tc, "校准结果/说明（续页）：")

        source_continued_tbl_1 = ET.SubElement(source_body, f"{{{W_NS}}}tbl")
        src_1_tr = ET.SubElement(source_continued_tbl_1, f"{{{W_NS}}}tr")
        src_1_tc = ET.SubElement(src_1_tr, f"{{{W_NS}}}tc")
        set_cell_text(src_1_tc, "一、一般检查：SOURCE_PAGE_1")
        source_continued_tbl_2 = ET.SubElement(source_body, f"{{{W_NS}}}tbl")
        src_2_tr = ET.SubElement(source_continued_tbl_2, f"{{{W_NS}}}tr")
        src_2_tc = ET.SubElement(src_2_tr, f"{{{W_NS}}}tc")
        set_cell_text(src_2_tc, "二、SOURCE_PAGE_2")
        source_body.append(ET.Element(f"{{{W_NS}}}sectPr"))

        target_root = ET.Element(f"{{{W_NS}}}document")
        target_body = ET.SubElement(target_root, f"{{{W_NS}}}body")
        target_anchor_tbl = ET.SubElement(target_body, f"{{{W_NS}}}tbl")
        target_anchor_tr = ET.SubElement(target_anchor_tbl, f"{{{W_NS}}}tr")
        target_anchor_tc = ET.SubElement(target_anchor_tr, f"{{{W_NS}}}tc")
        set_cell_text(target_anchor_tc, "器具编号 型号/规格")
        target_body.append(ET.Element(f"{{{W_NS}}}sectPr"))

        source_xml = ET.tostring(source_root, encoding="utf-8", xml_declaration=True)
        with tempfile.TemporaryDirectory() as td:
            source_docx = Path(td) / "source-r802b.docx"
            with zipfile.ZipFile(source_docx, "w") as zf:
                zf.writestr("word/document.xml", source_xml)
            copied, copied_tables = _copy_r802b_general_check_table_from_source(
                target_root=target_root,
                source_file_path=source_docx,
            )
            self.assertTrue(copied)
            self.assertEqual(len(copied_tables), 2)

        target_text = ET.tostring(target_root, encoding="unicode")
        self.assertIn("SOURCE_PAGE_1", target_text)
        self.assertIn("SOURCE_PAGE_2", target_text)
        self.assertNotIn("校准证书续页专用", target_text)
        self.assertNotIn("校准结果/说明（续页）", target_text)


if __name__ == "__main__":
    unittest.main()
