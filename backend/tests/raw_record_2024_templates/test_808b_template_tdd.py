import unittest

try:
    from backend.tests.raw_record_2024_templates._common import RAW_RECORD_2024_DIR, collect_docx_snapshot
except ModuleNotFoundError:
    from raw_record_2024_templates._common import RAW_RECORD_2024_DIR, collect_docx_snapshot


class Template808BTDD(unittest.TestCase):
    def test_template_snapshot_regression(self) -> None:
        path = RAW_RECORD_2024_DIR / 'R-808B 试验箱.docx'
        if not path.exists():
            self.skipTest(f"template not found: {path}")
        got = collect_docx_snapshot(path)
        expected = {'file_name': 'R-808B 试验箱.docx', 'file_size': 19880, 'table_count': 2, 'text_length': 612, 'has_general_check_keyword': True, 'general_check_length': 18, 'uncertainty_items_count': 0, 'measured_items_count': 0}
        self.assertEqual(got, expected)


if __name__ == "__main__":
    unittest.main()
