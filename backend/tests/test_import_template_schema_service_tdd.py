import sys
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.import_template_schema_service import load_import_template_schema


class ImportTemplateSchemaServiceTDD(unittest.TestCase):
    def test_should_build_semantic_keys_and_standardized_rule_views(self) -> None:
        template_path = str(BACKEND_DIR / "template-bundles" / "input" / "steel-cylinder-v1" / "schema.csv")
        schema = load_import_template_schema(template_path)

        columns = schema.get("columns", [])
        by_label = {}
        for col in columns:
            by_label.setdefault(str(col.get("label", "")).strip(), []).append(str(col.get("key", "")).strip())

        ownership_keys = by_label.get("产权代码编号", [])
        self.assertIn("ownership_code", ownership_keys)

        pressure_keys = by_label.get("试验压力MPa", [])
        self.assertIn("hydro_holding_test_pressure_mpa", pressure_keys)
        self.assertIn("air_tightness_test_pressure_mpa", pressure_keys)

        rules = schema.get("rules", {})
        fields = rules.get("fields", {})
        self.assertIsInstance(fields, dict)
        ownership = fields.get("ownership_code", {})
        self.assertEqual(str(ownership.get("label", "")).strip(), "产权代码编号")
        self.assertEqual(str(ownership.get("type", "")).strip(), "code")

    def test_should_merge_steel_cylinder_value_library_into_field_rules(self) -> None:
        template_path = str(BACKEND_DIR / "template-bundles" / "input" / "steel-cylinder-v1" / "schema.csv")
        schema = load_import_template_schema(template_path)
        rules = schema.get("rules", {})
        fields = rules.get("fields", {})

        medium_rule = fields.get("filling_medium", {})
        maker_rule = fields.get("manufacturer_code", {})

        self.assertEqual(medium_rule.get("options_source"), "steel_cylinder_value_library")
        self.assertEqual(maker_rule.get("options_source"), "steel_cylinder_value_library")

        medium_labels = [str((x or {}).get("label", "")).strip() for x in (medium_rule.get("choices") or [])]
        maker_labels = [str((x or {}).get("label", "")).strip() for x in (maker_rule.get("choices") or [])]

        self.assertIn("Ar", medium_labels)
        self.assertIn("O2", medium_labels)
        self.assertIn("GL", maker_labels)
        self.assertIn("JP", maker_labels)

    def test_should_fallback_to_legacy_field_rules_when_field_rules_by_key_missing(self) -> None:
        template_path = str(BACKEND_DIR / "template-bundles" / "input" / "steel-cylinder-v1" / "schema.csv")
        mocked_rules = {
            "info_fields": [{"key": "file_no", "label": "文件编号"}],
            "field_keys": [
                "inspect_date",
                "ownership_code",
                "filling_medium",
                "manufacturer_code",
                "factory_serial_no",
                "hydro_test_pressure_mpa",
                "nominal_work_pressure_mpa",
                "nominal_weight_kg",
                "nominal_volume_l",
                "design_wall_thickness_mm",
                "manufacture_date",
                "last_inspection_date",
                "residual_gas_treatment",
                "appearance_cleaning_check",
                "acoustic_check",
                "inner_surface_check",
                "neck_thread_check",
                "actual_weight_kg",
                "weight_loss_ratio_pct",
                "actual_volume_l",
                "volume_increase_ratio_pct",
                "hydro_holding_test_pressure_mpa",
                "hydro_holding_time_min",
                "residual_deformation_ml",
                "total_deformation_ml",
                "residual_deformation_ratio_pct",
                "internal_drying",
                "hydro_test_conclusion",
                "valve_inspection",
                "air_tightness_test_pressure_mpa",
                "air_tightness_holding_time_min",
                "air_tightness_test_conclusion",
                "assessment_conclusion",
                "next_inspection_date",
                "inspector",
                "reviewer",
                "remark",
            ],
            "field_rules": {
                "产权代码编号": {"type": "code", "max_len": 12},
                "试验压力MPa": {"type": "number"},
            },
        }
        with patch("app.services.import_template_schema_service._load_companion_rules", return_value=mocked_rules):
            schema = load_import_template_schema(template_path)

        rules = schema.get("rules", {})
        fields = rules.get("fields", {})
        self.assertEqual((fields.get("ownership_code") or {}).get("type"), "code")
        self.assertEqual((fields.get("hydro_holding_test_pressure_mpa") or {}).get("type"), "number")
        self.assertEqual((fields.get("air_tightness_test_pressure_mpa") or {}).get("type"), "number")


if __name__ == "__main__":
    unittest.main()
