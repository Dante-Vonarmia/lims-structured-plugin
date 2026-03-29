import unittest

try:
    from backend.tests.raw_record_2024_templates._common import RAW_RECORD_2024_DIR, extract_docx_text
except ModuleNotFoundError:
    from raw_record_2024_templates._common import RAW_RECORD_2024_DIR, extract_docx_text

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


class Template850BBehaviorTDD(unittest.TestCase):
    def test_should_mark_when_requirement_text_is_present(self) -> None:
        path = RAW_RECORD_2024_DIR / 'R-850B 成束燃烧试验装置.docx'
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
        path = RAW_RECORD_2024_DIR / 'R-850B 成束燃烧试验装置.docx'
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
        path = RAW_RECORD_2024_DIR / 'R-850B 成束燃烧试验装置.docx'
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


if __name__ == '__main__':
    unittest.main()
