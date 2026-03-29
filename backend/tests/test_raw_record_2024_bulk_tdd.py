import json
import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts.generate_raw_record_2024_baseline import (  # noqa: E402
    DEFAULT_INPUT_DIR,
    collect_docx_snapshot,
)


BASELINE_PATH = Path(__file__).resolve().parent / "fixtures" / "raw_record_2024_baseline.json"


class RawRecord2024BulkTDD(unittest.TestCase):
    def test_bulk_docx_snapshot_matches_baseline(self) -> None:
        if not DEFAULT_INPUT_DIR.exists():
            self.skipTest(f"raw record dir not found: {DEFAULT_INPUT_DIR}")
        if not BASELINE_PATH.exists():
            self.fail(f"baseline file missing: {BASELINE_PATH}")

        baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
        expected = {item["file_name"]: item for item in baseline}
        actual_files = sorted([p for p in DEFAULT_INPUT_DIR.glob("*.docx") if p.is_file()], key=lambda x: x.name)

        self.assertEqual(len(expected), len(actual_files), "docx count changed; regenerate baseline")
        self.assertEqual(set(expected.keys()), {p.name for p in actual_files}, "docx file set changed; regenerate baseline")

        mismatches: list[str] = []
        for path in actual_files:
            got = collect_docx_snapshot(path)
            want = expected[path.name]
            if got != want:
                mismatches.append(path.name)
        if mismatches:
            sample = ", ".join(mismatches[:8])
            self.fail(f"{len(mismatches)} template snapshots changed: {sample}. regenerate baseline after review")


if __name__ == "__main__":
    unittest.main()

