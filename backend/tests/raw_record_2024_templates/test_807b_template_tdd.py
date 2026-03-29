import unittest

try:
    from backend.tests.raw_record_2024_templates._common import RAW_RECORD_2024_DIR, collect_docx_snapshot
except ModuleNotFoundError:
    from raw_record_2024_templates._common import RAW_RECORD_2024_DIR, collect_docx_snapshot


class Template807BTDD(unittest.TestCase):
    def test_template_snapshot_regression(self) -> None:
        path = RAW_RECORD_2024_DIR / 'R-807B 自然通风热老化试验箱.docx'
        if not path.exists():
            self.skipTest(f"template not found: {path}")
        got = collect_docx_snapshot(path)
        expected = {'file_name': 'R-807B 自然通风热老化试验箱.docx', 'file_size': 21071, 'table_count': 1, 'text_length': 819, 'has_general_check_keyword': True, 'general_check_length': 19, 'uncertainty_items_count': 0, 'measured_items_count': 0}
        self.assertEqual(got, expected)


if __name__ == "__main__":
    unittest.main()
