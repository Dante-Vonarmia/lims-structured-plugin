import unittest

try:
    from backend.tests.raw_record_2024_templates._common import RAW_RECORD_2024_DIR, extract_docx_text
except ModuleNotFoundError:
    from raw_record_2024_templates._common import RAW_RECORD_2024_DIR, extract_docx_text
try:
    from backend.tests.raw_record_2024_templates._template_scenarios import (
        R846B_EXPECTED_SERIES_ACTUAL_PREFIX,
        R846B_EXPECTED_SERIES_NOMINAL_PREFIX,
        R846B_SOURCE_TEXT,
    )
except ModuleNotFoundError:
    from raw_record_2024_templates._template_scenarios import (
        R846B_EXPECTED_SERIES_ACTUAL_PREFIX,
        R846B_EXPECTED_SERIES_NOMINAL_PREFIX,
        R846B_SOURCE_TEXT,
    )

try:
    from backend.tests.raw_record_2024_templates._behavior_common import (
        evaluate_marks,
        evaluate_measurement_fill_behavior,
        pick_measurement_targets_from_docx_lines,
        pick_requirement_targets_from_docx_lines,
    )
except ModuleNotFoundError:
    from raw_record_2024_templates._behavior_common import (
        evaluate_marks,
        evaluate_measurement_fill_behavior,
        pick_measurement_targets_from_docx_lines,
        pick_requirement_targets_from_docx_lines,
    )

try:
    from backend.app.services.ocr_service import _extract_docx_text as extract_docx_text_by_ocr
except ModuleNotFoundError:
    from app.services.ocr_service import _extract_docx_text as extract_docx_text_by_ocr

try:
    from backend.app.services.semantic_fill_lib import (
        build_series_row_value_maps_from_general_check_text,
        extract_measured_value_items,
        extract_uncertainty_items,
        pick_series_row_values_for_label,
    )
except ModuleNotFoundError:
    from app.services.semantic_fill_lib import (
        build_series_row_value_maps_from_general_check_text,
        extract_measured_value_items,
        extract_uncertainty_items,
        pick_series_row_values_for_label,
    )


def normalize_space(value: str) -> str:
    return " ".join(str(value or "").replace("\u00a0", " ").split())


class Template846BBehaviorTDD(unittest.TestCase):
    def test_should_mark_when_requirement_text_is_present(self) -> None:
        path = RAW_RECORD_2024_DIR / 'R-846B 往复刮漆试验仪.docx'
        if not path.exists():
            self.skipTest(f"template not found: {path}")
        text = extract_docx_text(path)
        lines = [x for x in text.splitlines() if x.strip()]
        targets = pick_requirement_targets_from_docx_lines(lines, limit=5)
        if not targets:
            self.skipTest('no numbered requirement targets found')

        for target in targets:
            marks = evaluate_marks('一、一般检查：\n' + target, [target])
            self.assertEqual(marks, [True], msg=f'target should mark: {target}')

    def test_should_not_mark_when_requirement_text_is_missing(self) -> None:
        path = RAW_RECORD_2024_DIR / 'R-846B 往复刮漆试验仪.docx'
        if not path.exists():
            self.skipTest(f"template not found: {path}")
        text = extract_docx_text(path)
        lines = [x for x in text.splitlines() if x.strip()]
        targets = pick_requirement_targets_from_docx_lines(lines, limit=5)
        if not targets:
            self.skipTest('no numbered requirement targets found')

        for target in targets:
            marks = evaluate_marks('一、一般检查：', [target])
            self.assertEqual(marks, [False], msg=f'target should not mark when missing: {target}')


    def test_should_fill_measurement_items_when_values_exist(self) -> None:
        path = RAW_RECORD_2024_DIR / 'R-846B 往复刮漆试验仪.docx'
        if not path.exists():
            self.skipTest(f"template not found: {path}")
        text = extract_docx_text(path)
        lines = [x for x in text.splitlines() if x.strip()]
        targets = pick_measurement_targets_from_docx_lines(lines, limit=3)
        if not targets:
            self.skipTest('no measurement targets found')

        full_case = evaluate_measurement_fill_behavior(targets)
        self.assertEqual(full_case['marks'], [True] * len(targets), msg=full_case['detail_general_check'])
        self.assertEqual(full_case['uncertainty_count'], len(targets), msg=full_case['detail_general_check'])
        self.assertEqual(full_case['measured_count'], len(targets), msg=full_case['detail_general_check'])

        missing_case = evaluate_measurement_fill_behavior(targets, missing_indexes={0})
        self.assertEqual(sum(1 for x in missing_case['marks'] if x), len(targets) - 1, msg=missing_case['detail_general_check'])
        self.assertEqual(missing_case['uncertainty_count'], len(targets) - 1, msg=missing_case['detail_general_check'])
        self.assertEqual(missing_case['measured_count'], len(targets) - 1, msg=missing_case['detail_general_check'])

    def test_should_keep_placeholder_text_when_table_values_are_blank(self) -> None:
        path = RAW_RECORD_2024_DIR / 'R-846B 往复刮漆试验仪.docx'
        if not path.exists():
            self.skipTest(f"template not found: {path}")
        text = extract_docx_text_by_ocr(path)
        self.assertIn("往复刮漆次数", text)
        self.assertIn("时间t(s)", text)
        self.assertIn("3600", text)
        self.assertIn("扩展不确定度U= 次/分,k=2。", text)
        self.assertNotIn("实测值：60次/分。", text)

    def test_should_extract_expected_846_placeholders_and_values_from_field_block(self) -> None:
        uncertainty_items = extract_uncertainty_items(R846B_SOURCE_TEXT, normalize_space=normalize_space)
        measured_items = extract_measured_value_items(R846B_SOURCE_TEXT, normalize_space=normalize_space)
        self.assertGreaterEqual(len(uncertainty_items), 6)
        self.assertGreaterEqual(len(measured_items), 5)
        self.assertTrue(any(x.get("unit") == "mA" and x.get("value") == "5.0" for x in measured_items))

        source_maps = build_series_row_value_maps_from_general_check_text(
            R846B_SOURCE_TEXT,
            normalize_space=normalize_space,
        )
        nominal = pick_series_row_values_for_label(source_maps, "标称值(N)", normalize_space=normalize_space)
        actual = pick_series_row_values_for_label(source_maps, "实际值(N)", normalize_space=normalize_space)
        self.assertEqual(nominal[:4], R846B_EXPECTED_SERIES_NOMINAL_PREFIX)
        self.assertEqual(actual[:4], R846B_EXPECTED_SERIES_ACTUAL_PREFIX)


if __name__ == '__main__':
    unittest.main()
