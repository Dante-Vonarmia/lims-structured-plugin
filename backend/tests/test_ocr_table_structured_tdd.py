import unittest
from pathlib import Path
from unittest.mock import patch

from app.services import ocr_service


class OcrTableStructuredTdd(unittest.TestCase):
    def test_should_apply_date_and_medium_rules(self) -> None:
        date_text, date_score = ocr_service._apply_column_rules("2-l1", 0)
        self.assertEqual(date_text, "2.11")
        self.assertGreaterEqual(date_score, 0.9)

        medium_text, medium_score = ocr_service._apply_column_rules("C02", 2)
        self.assertEqual(medium_text, "CO2")
        self.assertGreaterEqual(medium_score, 0.9)

    def test_should_apply_unit_and_serial_rules(self) -> None:
        unit_text, unit_score = ocr_service._apply_column_rules("g z", 3)
        self.assertEqual(unit_text, "GZ")
        self.assertGreaterEqual(unit_score, 0.9)

        serial_text, serial_score = ocr_service._apply_column_rules("I0O12l", 4)
        self.assertEqual(serial_text, "100121")
        self.assertGreaterEqual(serial_score, 0.9)

    def test_should_penalize_short_noise_on_owner_code_column(self) -> None:
        one_char_text, one_char_score = ocr_service._apply_column_rules("A", 1)
        self.assertEqual(one_char_text, "A")
        self.assertLess(one_char_score, 0.5)

        zh_short_text, zh_short_score = ocr_service._apply_column_rules("金", 1)
        self.assertEqual(zh_short_text, "金")
        self.assertLess(zh_short_score, 0.5)

    def test_should_blank_unknown_medium_value(self) -> None:
        medium_text, medium_score = ocr_service._apply_column_rules("hr", 2)
        self.assertEqual(medium_text, "")
        self.assertLess(medium_score, 0.5)

    def test_should_force_blank_for_single_owner_code_noise(self) -> None:
        self.assertTrue(ocr_service._should_force_blank_by_column("A", 0.95, 1))

    def test_should_flag_row_consistency_issues(self) -> None:
        row_records = [
            {
                "row": 1,
                "fields": {
                    "col_08": "50.0",
                    "col_09": "40.0",
                    "col_18": "50.0",
                    "col_19": "1.8",
                    "col_20": "45.0",
                    "col_29": "√",
                    "col_33": "",
                },
            }
        ]
        review = ocr_service._check_table_row_consistency(row_records)
        reasons = {str(x.get("reason", "")) for x in review}
        self.assertIn("volume_deviation", reasons)
        self.assertIn("weight_loss_inconsistent", reasons)
        self.assertIn("conclusion_missing", reasons)

    def test_should_prefer_structured_table_payload_in_image_recognition(self) -> None:
        table_payload = {
            "table_cells": [
                {
                    "row": 1,
                    "col": 1,
                    "column_key": "col_01",
                    "raw_text": "2.11",
                    "final_text": "2.11",
                    "confidence": 0.97,
                    "bbox": [0, 0, 10, 10],
                    "preprocess_id": "p0",
                }
            ],
            "row_records": [
                {
                    "row": 1,
                    "fields": {"col_01": "2.11"},
                    "raw_record": "2.11",
                }
            ],
            "review_queue": [],
        }

        with patch.object(ocr_service, "_prepare_image_file", return_value=(Path("/tmp/mock.png"), None)), \
            patch.object(ocr_service, "_recognize_cylinder_table", return_value=table_payload):
            raw_text, lines, engine, structured = ocr_service._recognize_image(Path("/tmp/mock.png"))

        self.assertEqual(raw_text, "2.11")
        self.assertEqual(lines, ["2.11"])
        self.assertEqual(engine, "table_cells")
        self.assertIn("table_cells", structured)
        self.assertIn("row_records", structured)
        self.assertIn("review_queue", structured)

    def test_should_reject_low_quality_structured_table(self) -> None:
        cells = []
        for idx in range(1, 38):
            cells.append(
                {
                    "row": 1,
                    "col": idx,
                    "column_key": f"col_{idx:02d}",
                    "final_text": "",
                    "confidence": 0.0,
                }
            )
        quality = ocr_service._evaluate_table_quality(
            table_cells=cells,
            row_records=[{"row": 1, "fields": {}, "raw_record": ""}],
            review_queue=[{"row": 1, "reason": "low_confidence"}] * 20,
        )
        self.assertFalse(bool(quality.get("ok")))

    def test_should_align_ratio_lines_with_anchor_positions(self) -> None:
        lines = [0, 100, 200, 300, 400]
        anchors = {1: 170.0, 2: 270.0}
        aligned = ocr_service._align_ratio_lines_with_anchors(lines, anchors)
        self.assertEqual(len(aligned), len(lines))
        self.assertTrue(all(aligned[i] < aligned[i + 1] for i in range(len(aligned) - 1)))
        self.assertGreater(aligned[2], lines[2])

    def test_should_generate_ratio_based_lines_by_calibration(self) -> None:
        with patch.object(ocr_service, "_load_table_ratio_calibration", return_value=tuple([1.0] * len(ocr_service.TABLE_COL_KEYS))):
            lines = ocr_service._build_ratio_based_x_lines(10, 3810)
        self.assertEqual(len(lines), len(ocr_service.TABLE_COL_KEYS) + 1)
        self.assertEqual(lines[0], 10)
        self.assertEqual(lines[-1], 3810)

    def test_should_keep_ratio_line_count_when_fusing_grid(self) -> None:
        ratio_lines = [0, 100, 200, 300, 400]
        grid_lines = [0, 98, 101, 198, 202, 299, 401]
        fused = ocr_service._fuse_grid_with_ratio_lines(grid_lines, ratio_lines)
        self.assertEqual(len(fused), len(ratio_lines))
        self.assertTrue(all(fused[i] < fused[i + 1] for i in range(len(fused) - 1)))

    def test_should_return_blank_when_blank_gate_hit(self) -> None:
        with patch.object(ocr_service, "_is_blank_table_cell", return_value=True):
            payload = ocr_service._recognize_table_cell(object(), 1)
        self.assertEqual(payload.get("final_text"), "")
        self.assertEqual(float(payload.get("confidence", 0.0) or 0.0), 0.0)
        self.assertEqual(payload.get("preprocess_id"), "blank_gate")

    def test_should_suppress_low_confidence_noise_on_non_critical_column(self) -> None:
        crop = object()
        with patch.object(ocr_service, "_is_blank_table_cell", return_value=False), \
            patch.object(ocr_service, "_read_cell_with_retries", return_value=[{"text": "eer", "confidence": 0.2, "preprocess_id": "p0"}]):
            payload = ocr_service._recognize_table_cell(crop, 1)
        self.assertEqual(payload.get("final_text"), "")
        self.assertEqual(float(payload.get("confidence", 0.0) or 0.0), 0.0)

    def test_should_blank_critical_cell_when_confidence_still_low_after_second_pass(self) -> None:
        crop = object()
        with patch.object(ocr_service, "_is_blank_table_cell", return_value=False), \
            patch.object(ocr_service, "_read_cell_with_retries", return_value=[{"text": "2.11", "confidence": 0.5, "preprocess_id": "p0"}]), \
            patch.object(ocr_service, "_second_pass_critical_cell_vote", side_effect=lambda _crop, _col, fallback: fallback):
            payload = ocr_service._recognize_table_cell(crop, 0)
        self.assertEqual(payload.get("final_text"), "")
        self.assertEqual(float(payload.get("confidence", 0.0) or 0.0), 0.0)


if __name__ == "__main__":
    unittest.main()
