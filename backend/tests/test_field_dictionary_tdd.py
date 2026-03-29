import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.field_dictionary.formulas import apply_formulas


class FieldDictionaryFormulaTDD(unittest.TestCase):
    def test_linearity_metrics_compute_fi_f_and_delta(self) -> None:
        context = {
            "linearity_ux_values": "50 100 150",
            "linearity_u2_values": "5 10 15",
        }
        formulas = [
            {
                "type": "linearity_metrics",
                "ux_key": "linearity_ux_values",
                "u2_key": "linearity_u2_values",
                "fi_key": "linearity_fi_values",
                "f_avg_key": "linearity_f_avg",
                "delta_key": "linearity_fi_delta_percent",
                "precision": 6,
                "delta_precision": 4,
            }
        ]
        out = apply_formulas(context, formulas)
        self.assertEqual(out["linearity_fi_values"], "10 10 10")
        self.assertEqual(out["linearity_f_avg"], "10")
        self.assertEqual(out["linearity_fi_delta_percent"], "0 0 0")

    def test_linearity_metrics_keep_existing_output(self) -> None:
        context = {
            "linearity_ux_values": "100 200",
            "linearity_u2_values": "10 20",
            "linearity_f_avg": "99.9",
        }
        out = apply_formulas(context, [{"type": "linearity_metrics"}])
        self.assertEqual(out["linearity_f_avg"], "99.9")

    def test_shielding_effectiveness_pipeline(self) -> None:
        context = {
            "shield_p1_dbm_values": "-20 -18 -19",
            "shield_p2_dbm_values": "-70 -66 -68",
        }
        out = apply_formulas(
            context,
            [
                {
                    "type": "list_subtract",
                    "left_key": "shield_p1_dbm_values",
                    "right_key": "shield_p2_dbm_values",
                    "target_key": "shield_se_db_values",
                    "precision": 3,
                },
                {
                    "type": "list_mean",
                    "source_key": "shield_se_db_values",
                    "target_key": "shield_se_avg_db",
                    "precision": 3,
                },
            ],
        )
        self.assertEqual(out["shield_se_db_values"], "50 48 49")
        self.assertEqual(out["shield_se_avg_db"], "49")

    def test_breakdown_voltage_mean_and_stddev(self) -> None:
        context = {"breakdown_voltage_values_kv": "15 15.5 16"}
        out = apply_formulas(
            context,
            [
                {
                    "type": "list_mean",
                    "source_key": "breakdown_voltage_values_kv",
                    "target_key": "breakdown_voltage_avg_kv",
                    "precision": 4,
                },
                {
                    "type": "list_stddev",
                    "source_key": "breakdown_voltage_values_kv",
                    "target_key": "breakdown_voltage_stddev_kv",
                    "precision": 4,
                },
            ],
        )
        self.assertEqual(out["breakdown_voltage_avg_kv"], "15.5")
        self.assertEqual(out["breakdown_voltage_stddev_kv"], "0.4082")


if __name__ == "__main__":
    unittest.main()
