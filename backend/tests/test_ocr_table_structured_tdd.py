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


if __name__ == "__main__":
    unittest.main()
