from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.template_service import list_available_templates, match_template_name


FORMULA_CASES = [
    ("036 局放（110kV附件）.docx", "R-819B 局部放电测试系统.docx"),
    ("036 局放（220kV电缆）.docx", "R-819B 局部放电测试系统.docx"),
    ("036 局放（220kV附件）.docx", "R-819B 局部放电测试系统.docx"),
    ("036 局放（35kV电缆）.docx", "R-819B 局部放电测试系统.docx"),
    ("036 局放（500kV电缆）.docx", "R-819B 局部放电测试系统.docx"),
    ("036 局放（500kv附件）.docx", "R-819B 局部放电测试系统.docx"),
    ("037 局放（110kV电缆）.docx", "R-819B 局部放电测试系统.docx"),
    ("040 工频高电压测量系统-5.docx", "R-859B 工频高电压测量系统.docx"),
    ("47 高压漆膜连续性试验仪.docx", "R-818B 高压漆膜连续性试验仪.docx"),
    ("56 20KV击穿电压试验仪.docx", "R-816B 击穿电压试验仪.docx"),
    ("58 15KV击穿电压试验仪.docx", "R-816B 击穿电压试验仪.docx"),
    ("882B 屏蔽室 35kv（1大门）.docx", "R-882B 屏蔽室.docx"),
    ("882B 屏蔽室-（大、小门）.docx", "R-882B 屏蔽室.docx"),
    ("882B 屏蔽室（2大门1个小门）.docx", "R-882B 屏蔽室.docx"),
]


class FormulaTemplateMatchTDD(unittest.TestCase):
    def test_formula_templates_should_match_by_filename(self) -> None:
        templates = list_available_templates()
        with tempfile.TemporaryDirectory() as td:
            defaults_file = Path(td) / "template_feedback_defaults.yaml"
            defaults_file.write_text(
                "\n".join(
                    [
                        "version: 1",
                        "entries:",
                        "  - id: f1",
                        "    updated_at: '2026-03-30T15:42:00'",
                        "    template_name: R-819B 局部放电测试系统.docx",
                        "    device_name: ''",
                        "    device_code: ''",
                        "    device_name_norm: ''",
                        "    device_code_norm: ''",
                        "    source_aliases:",
                        "      - 036 局放（110kV附件）",
                        "      - 036 局放（220kV电缆）",
                        "      - 036 局放（220kV附件）",
                        "      - 036 局放（35kV电缆）",
                        "      - 036 局放（500kV电缆）",
                        "      - 036 局放（500kv附件）",
                        "      - 037 局放（110kV电缆）",
                        "  - id: f2",
                        "    updated_at: '2026-03-30T15:42:00'",
                        "    template_name: R-859B 工频高电压测量系统.docx",
                        "    device_name: ''",
                        "    device_code: ''",
                        "    device_name_norm: ''",
                        "    device_code_norm: ''",
                        "    source_aliases:",
                        "      - 040 工频高电压测量系统-5",
                        "  - id: f3",
                        "    updated_at: '2026-03-30T15:42:00'",
                        "    template_name: R-818B 高压漆膜连续性试验仪.docx",
                        "    device_name: ''",
                        "    device_code: ''",
                        "    device_name_norm: ''",
                        "    device_code_norm: ''",
                        "    source_aliases:",
                        "      - 47 高压漆膜连续性试验仪",
                        "  - id: f4",
                        "    updated_at: '2026-03-30T15:42:00'",
                        "    template_name: R-816B 击穿电压试验仪.docx",
                        "    device_name: ''",
                        "    device_code: ''",
                        "    device_name_norm: ''",
                        "    device_code_norm: ''",
                        "    source_aliases:",
                        "      - 56 20KV击穿电压试验仪",
                        "      - 58 15KV击穿电压试验仪",
                        "  - id: f5",
                        "    updated_at: '2026-03-30T15:42:00'",
                        "    template_name: R-882B 屏蔽室.docx",
                        "    device_name: ''",
                        "    device_code: ''",
                        "    device_name_norm: ''",
                        "    device_code_norm: ''",
                        "    source_aliases:",
                        "      - 882B 屏蔽室 35kv（1大门）",
                        "      - 882B 屏蔽室-（大、小门）",
                        "      - 882B 屏蔽室（2大门1个小门）",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            with patch("app.services.template_feedback_service.DEFAULTS_FILE", defaults_file):
                for file_name, expected in FORMULA_CASES:
                    matched, matched_by = match_template_name(
                        raw_text="",
                        file_name=file_name,
                        device_name="",
                        device_code="",
                        templates=templates,
                    )
                    self.assertEqual(
                        matched,
                        expected,
                        msg=f"file={file_name} should match {expected}, got={matched} by={matched_by}",
                    )

    def test_formula_templates_should_keep_matching_when_device_name_exists(self) -> None:
        templates = list_available_templates()
        device_name_hints = {
            "036": "局部放电测试系统",
            "037": "局部放电测试系统",
            "040": "工频高电压测量系统",
            "47": "高压漆膜连续性试验仪",
            "56": "击穿电压试验仪",
            "58": "击穿电压试验仪",
            "882": "屏蔽局放试验室",
        }
        for file_name, expected in FORMULA_CASES:
            key = "882" if file_name.startswith("882") else file_name.split(" ")[0]
            device_name = device_name_hints.get(key, "")
            matched, matched_by = match_template_name(
                raw_text=f"器具名称: {device_name}\n",
                file_name=file_name,
                device_name=device_name,
                device_code="",
                templates=templates,
            )
            self.assertEqual(
                matched,
                expected,
                msg=f"file={file_name} with device_name should match {expected}, got={matched} by={matched_by}",
            )


if __name__ == "__main__":
    unittest.main()
