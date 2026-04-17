from __future__ import annotations

import unittest

from app.services.extract_service import extract_fields


class BasisModeExtractTDD(unittest.TestCase):
    def test_extract_basis_mode_from_checked_calibration_marker(self) -> None:
        text = "\n".join(
            [
                "气瓶名称：电脑导体电阻测试仪",
                "□检测/☑校准依据：JB/T 4279.2-2008",
                "□检测/☑校准地点：浙江省湖州市南浔区练市镇万潭湾1楼试验室",
            ]
        )
        fields = extract_fields(text)
        self.assertEqual(fields.get("basis_mode"), "校准")

    def test_extract_basis_mode_from_checked_detection_marker(self) -> None:
        text = "\n".join(
            [
                "气瓶名称：示例设备",
                "☑检测/□校准依据：GB/T 1234-2020",
            ]
        )
        fields = extract_fields(text)
        self.assertEqual(fields.get("basis_mode"), "检测")

    def test_extract_partial_discharge_fields(self) -> None:
        text = "\n".join(
            [
                "气瓶名称：局部放电检测系统",
                "五、校准脉冲发生器校准：电荷量Urel=0.1%,k=2；上升沿Urel=0.3%,k=2",
                "实测值 0.49 4.99 49.8 101",
                "上升沿 9.9 12.8 16.8 22.8",
                "波形峰值 452 879 452 879",
                "三、试验电流容差：Urel=1.2%,k=2",
                "四、试验电压校准：Urel=1.2%,k=2",
            ]
        )
        fields = extract_fields(text)
        self.assertEqual(fields.get("pd_charge_values_pc"), "0.49 4.99 49.8 101")
        self.assertEqual(fields.get("pd_rise_time_values_ns"), "9.9 12.8 16.8 22.8")
        self.assertEqual(fields.get("pd_pulse_amplitude_values_v"), "452 879 452 879")
        self.assertEqual(fields.get("pd_power_tolerance_urel_percent"), "1.2")
        self.assertEqual(fields.get("pd_voltage_calibration_urel_percent"), "1.2")

    def test_device_name_should_not_be_misread_from_name_in_reference_title(self) -> None:
        text = "\n".join(
            [
                "本次校准所依据的技术规范（代号、名称）：Reference documents for the calibration(code、name)",
                "气瓶名称：往复刮漆试验仪",
            ]
        )
        fields = extract_fields(text)
        self.assertEqual(fields.get("device_name"), "往复刮漆试验仪")


if __name__ == "__main__":
    unittest.main()
