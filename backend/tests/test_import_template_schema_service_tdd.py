import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.import_template_schema_service import load_import_template_schema


class ImportTemplateSchemaServiceTDD(unittest.TestCase):
    def test_should_merge_steel_cylinder_value_library_into_field_rules(self) -> None:
        template_path = str(BACKEND_DIR / "template-bundles" / "input" / "steel-cylinder-v1" / "schema.csv")
        schema = load_import_template_schema(template_path)
        rules = schema.get("rules", {})
        field_rules = rules.get("field_rules", {})

        medium_rule = field_rules.get("充装介质", {})
        maker_rule = field_rules.get("制造单位代码", {})

        self.assertEqual(medium_rule.get("options_source"), "steel_cylinder_value_library")
        self.assertEqual(maker_rule.get("options_source"), "steel_cylinder_value_library")

        medium_labels = [str((x or {}).get("label", "")).strip() for x in (medium_rule.get("choices") or [])]
        maker_labels = [str((x or {}).get("label", "")).strip() for x in (maker_rule.get("choices") or [])]

        self.assertIn("Ar", medium_labels)
        self.assertIn("O2", medium_labels)
        self.assertIn("GL", maker_labels)
        self.assertIn("JP", maker_labels)


if __name__ == "__main__":
    unittest.main()
