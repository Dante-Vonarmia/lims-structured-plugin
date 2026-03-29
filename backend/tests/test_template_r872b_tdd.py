import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class TemplateR872BTDD(unittest.TestCase):
    def test_profile_contains_metal_twist_aliases(self) -> None:
        profile_path = BACKEND_DIR / "app" / "rules" / "template_profiles" / "r-872b.yaml"
        text = profile_path.read_text(encoding="utf-8")
        self.assertIn("金属线材扭转试验仪", text)
        self.assertIn("1 金属扭转CNAS.docx", text)
        self.assertIn("source_keywords:", text)
        self.assertIn("- \"扭转\"", text)
        self.assertIn("- \"线材\"", text)
        self.assertIn("source_keywords_any:", text)
        self.assertIn("source_aliases:", text)
        self.assertIn("1金属扭转cnas", text)

    def test_profile_contains_measurement_items_field(self) -> None:
        profile_path = BACKEND_DIR / "app" / "rules" / "template_profiles" / "r-872b.yaml"
        text = profile_path.read_text(encoding="utf-8")
        self.assertIn("key: measurement_items", text)
        self.assertIn("label: \"检测项目\"", text)


if __name__ == "__main__":
    unittest.main()
