import unittest

try:
    from backend.tests.raw_record_2024_templates._common import RAW_RECORD_2024_DIR, collect_docx_snapshot
except ModuleNotFoundError:
    from raw_record_2024_templates._common import RAW_RECORD_2024_DIR, collect_docx_snapshot


class Template881BTDD(unittest.TestCase):
    def test_template_snapshot_regression(self) -> None:
        path = RAW_RECORD_2024_DIR / 'R-881B 盐雾试验箱.docx'
        if not path.exists():
            self.skipTest(f"template not found: {path}")
        got = collect_docx_snapshot(path)
        expected = {'file_name': 'R-881B 盐雾试验箱.docx', 'file_size': 74611, 'table_count': 2, 'text_length': 713, 'has_general_check_keyword': True, 'general_check_length': 53, 'uncertainty_items_count': 0, 'measured_items_count': 0}
        self.assertEqual(got, expected)


if __name__ == "__main__":
    unittest.main()
