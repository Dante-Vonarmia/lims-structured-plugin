from __future__ import annotations

import unittest

from app.services.extract_service import extract_fields


class BasisModeExtractTDD(unittest.TestCase):
    def test_extract_basis_mode_from_checked_calibration_marker(self) -> None:
        text = "\n".join(
            [
                "器具名称：电脑导体电阻测试仪",
                "□检测/☑校准依据：JB/T 4279.2-2008",
                "□检测/☑校准地点：浙江省湖州市南浔区练市镇万潭湾1楼试验室",
            ]
        )
        fields = extract_fields(text)
        self.assertEqual(fields.get("basis_mode"), "校准")

    def test_extract_basis_mode_from_checked_detection_marker(self) -> None:
        text = "\n".join(
            [
                "器具名称：示例设备",
                "☑检测/□校准依据：GB/T 1234-2020",
            ]
        )
        fields = extract_fields(text)
        self.assertEqual(fields.get("basis_mode"), "检测")


if __name__ == "__main__":
    unittest.main()
