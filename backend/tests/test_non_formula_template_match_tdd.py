from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.template_service import list_available_templates, match_template_name


NON_FORMULA_CASES = [
    ("005 自然通风热老化试验箱-1.docx", "自然通风热老化试验箱", "R-807B 自然通风热老化试验箱.docx"),
    ("019 直流电阻试验装置（电桥）.docx", "直流电阻试验装置（电桥）", "R-868B 直流电阻试验装置（电桥）.docx"),
    ("035 耐冷冻剂试验装置-31.docx", "耐冷冻剂试验装置", "R-849B 耐冷冻剂试验装置.docx"),
    ("1 金属扭转CNAS.docx", "金属扭转试验仪", "R-872B 线材扭转试验机.docx"),
    ("10 扁线弯曲CNAS.docx", "扁线弯曲试验仪", "R-822B 扁线回弹试验仪.docx"),
    ("12 延伸弹回柔软度CNAS.docx", "延伸弹回柔软度", None),
    ("13 低温箱.docx", "低温箱", "R-827B 低温试验箱.docx"),
    ("14 干燥箱。7.docx", "干燥箱", "R-808B 试验箱.docx"),
    ("15 （PDIV）局部放电CNAS.docx", "局部放电", "R-819B 局部放电测试系统.docx"),
    ("16 直流电阻试验装置（低电阻表）.docx", "直流电阻试验装置（低电阻表）", "R-867B 直流电阻试验装置（低电阻表）.docx"),
    ("2 立绕试验仪CNAS.docx", "立绕试验仪", "R-874B 绕组线卷绕试验仪.docx"),
    ("23 伸长试验仪.docx", "伸长试验仪", "R-811B 伸长试验仪.docx"),
    ("29 回弹角试验仪.docx", "回弹角试验仪", "R-812B 回弹角试验仪.docx"),
    ("32 焊锡试验仪.docx", "焊锡试验仪", "R-845B 焊锡试验仪.docx"),
    ("33 耐溶剂试验仪（温场）.docx", "耐溶剂试验仪（温场）", "R-815B 耐溶剂试验仪.docx"),
    ("34  耐溶剂试验仪（力值）.docx", "耐溶剂试验仪（力值）", "R-815B 耐溶剂试验仪.docx"),
    ("35 软化击穿试验仪 .docx", "软化击穿试验仪", "R-825B 软化击穿试验仪.docx"),
    ("36 希波火花机.docx", "希波火花机", "R-835B 火花机人工击穿装置.docx"),
    ("38 往复刮漆试验仪.docx", "往复刮漆试验仪", "R-846B 往复刮漆试验仪.docx"),
    ("39 急拉断试验仪.docx", "急拉断试验仪", "R-813B 急拉断试验仪.docx"),
    ("41 单向刮漆试验仪.docx", "单向刮漆试验仪", "R-814B 单向刮漆试验仪.docx"),
    ("43 静摩擦系数试验仪.docx", "静摩擦系数试验仪", "R-847B 静摩擦系数试验仪.docx"),
    ("44 剥离试验仪.docx", "剥离试验仪", "R-824B 剥离试验仪.docx"),
    ("45 高频脉冲耐电晕试验仪.docx", "高频脉冲耐电晕试验仪", "R-858B 高频脉冲耐电晕试验仪.docx"),
    ("54 5KV 高压台.docx", "5KV 高压台", "R-821B 电线电缆电压试验装置.docx"),
    ("59 低压漆膜连续性试验仪.docx", "低压漆膜连续性试验仪", "R-817B 低压漆膜连续性试验仪.docx"),
    ("60 热态电压试验箱 11.docx", "热态电压试验箱", "R-866B 电热强制通风试验箱、热态电压试验仪.docx"),
    ("7 介损CNAS.docx", "介损", "R-819B 局部放电测试系统.docx"),
    ("低应力拉伸仪 CNAS.docx", "低应力拉伸仪", "R-828B 低温拉伸试验机.docx"),
    ("卷绕CNAS.docx", "卷绕", "R-871B 线材卷绕试验机.docx"),
    ("延伸弹回柔软度CNAS.docx", "延伸弹回柔软度", None),
    ("弹力粘合力测试仪CNAS.docx", "弹力粘合力测试仪", None),
    ("往复弯折试验仪CNAS.docx", "往复弯折试验仪", "R-804B 曲挠试验装置.docx"),
    ("扁线回弹角试验仪 CNAS.docx", "扁线回弹角试验仪", "R-822B 扁线回弹试验仪.docx"),
    ("摩擦系数仪 CNAS.docx", "摩擦系数仪", "R-847B 静摩擦系数试验仪.docx"),
    ("热粘合试验装置 CNAS.docx", "热粘合试验装置", None),
    ("电桥夹具 CNAS.docx", "电桥夹具", "R-864B 电桥夹具.docx"),
    ("盐水针孔CNAS.docx", "盐水针孔", "R-873B 盐水针孔.docx"),
    ("立绕试验仪CNAS.docx", "立绕试验仪", "R-874B 绕组线卷绕试验仪.docx"),
    ("缠绕能力试验仪 CNAS.docx", "缠绕能力试验仪", "R-871B 线材卷绕试验机.docx"),
    ("耐氟试验仪 CNAS.docx", "耐氟试验仪", "R-815B 耐溶剂试验仪.docx"),
    ("自动回弹角试验仪（1.60以上）CNAS.docx", "自动回弹角试验仪（1.60以上）", "R-822B 扁线回弹试验仪.docx"),
]


class NonFormulaTemplateMatchTDD(unittest.TestCase):
    def test_non_formula_catalog_strict_match_or_blank(self) -> None:
        templates = list_available_templates()
        with tempfile.TemporaryDirectory() as td:
            defaults_file = Path(td) / "template_feedback_defaults.yaml"
            defaults_file.write_text("version: 1\nentries: []\n", encoding="utf-8")
            with patch("app.services.template_feedback_service.DEFAULTS_FILE", defaults_file):
                for file_name, device_name, expected in NON_FORMULA_CASES:
                    matched, matched_by = match_template_name(
                        raw_text=f"气瓶名称: {device_name}\n",
                        file_name=file_name,
                        device_name=device_name,
                        device_code="",
                        templates=templates,
                    )
                    if expected is None:
                        self.assertIsNone(
                            matched,
                            msg=f"Expected blank fallback for case={file_name}, got={matched} by={matched_by}",
                        )
                    else:
                        self.assertEqual(
                            matched,
                            expected,
                            msg=f"Expected strict match failed for case={file_name}, by={matched_by}",
                        )

    def test_device_identity_mismatch_must_not_fall_back_to_filename(self) -> None:
        templates = list_available_templates()
        with tempfile.TemporaryDirectory() as td:
            defaults_file = Path(td) / "template_feedback_defaults.yaml"
            defaults_file.write_text("version: 1\nentries: []\n", encoding="utf-8")
            with patch("app.services.template_feedback_service.DEFAULTS_FILE", defaults_file):
                matched, matched_by = match_template_name(
                    raw_text="气瓶名称: 热延伸试验箱\n气瓶编号: 12040DA15\n",
                    file_name="005 自然通风热老化试验箱-1.docx",
                    device_name="热延伸试验箱",
                    device_code="12040DA15",
                    templates=templates,
                )
                self.assertIsNone(matched, msg=f"should be blank fallback, got={matched} by={matched_by}")

    def test_default_binding_code_hit_but_name_mismatch_must_not_match(self) -> None:
        templates = list_available_templates()
        with tempfile.TemporaryDirectory() as td:
            defaults_file = Path(td) / "template_feedback_defaults.yaml"
            defaults_file.write_text(
                "\n".join(
                    [
                        "version: 1",
                        "entries:",
                        "  - id: e1",
                        "    updated_at: '2026-03-29T13:00:00'",
                        "    template_name: R-822B 扁线回弹试验仪.docx",
                        "    device_name: 扁线回弹试验仪",
                        "    device_code: '2301021'",
                        "    device_name_norm: 扁线回弹试验仪",
                        "    device_code_norm: '2301021'",
                        "    source_aliases:",
                        "      - 扁线回弹试验仪",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            with patch("app.services.template_feedback_service.DEFAULTS_FILE", defaults_file):
                matched, matched_by = match_template_name(
                    raw_text="气瓶名称: 扁线立绕试验仪\n气瓶编号: 2301021\n",
                    file_name="2 立绕试验仪CNAS.docx",
                    device_name="扁线立绕试验仪",
                    device_code="2301021",
                    templates=templates,
                )
                self.assertIsNone(matched, msg=f"name mismatch should blank, got={matched} by={matched_by}")


if __name__ == "__main__":
    unittest.main()
