import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.template_schema.detector import detect_candidate_field_keys
from app.services.template_schema.service import infer_editor_schema


class TemplateSchemaTDD(unittest.TestCase):
    def test_detector_for_high_voltage_profile(self) -> None:
        text = "工频高电压测量系统 Urel 线性度 Ux U2 Fi 相对变化量"
        keys = detect_candidate_field_keys("R-859B 工频高电压测量系统.docx", text)
        self.assertIn("linearity_fi_values", keys)
        self.assertIn("linearity_f_avg", keys)
        self.assertIn("urel_percent", keys)

    def test_detector_for_partial_discharge_profile(self) -> None:
        text = "局放 部分放电 放电量 上升沿 脉冲幅值"
        keys = detect_candidate_field_keys("036 局放（220kV电缆）.docx", text)
        self.assertIn("pd_charge_values_pc", keys)
        self.assertIn("pd_rise_time_values_ns", keys)
        self.assertIn("pd_pulse_amplitude_values_v", keys)

    def test_detector_for_shield_room_profile(self) -> None:
        text = "屏蔽室 背景噪声 无屏蔽室时测得的功率P1(dBm) 屏蔽室内测得的功率P2(dBm)"
        keys = detect_candidate_field_keys("882B 屏蔽室（2大门1个小门）.docx", text)
        self.assertIn("shield_p1_dbm_values", keys)
        self.assertIn("shield_p2_dbm_values", keys)
        self.assertIn("shield_se_avg_db", keys)

    def test_infer_schema_for_existing_template(self) -> None:
        schema = infer_editor_schema("R-859B 工频高电压测量系统.docx")
        self.assertIsNotNone(schema)
        fields = schema.get("fields", [])
        keys = [x.get("key") for x in fields]
        self.assertIn("linearity_fi_values", keys)
        self.assertIn("basis_mode", keys)


if __name__ == "__main__":
    unittest.main()
