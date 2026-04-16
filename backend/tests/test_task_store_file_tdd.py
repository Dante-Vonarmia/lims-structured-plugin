import json
import sys
import tempfile
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services import task_store_file


class TaskStoreFileTDD(unittest.TestCase):
    def test_workspace_draft_should_store_only_explicit_content(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            original_output_dir = task_store_file.OUTPUT_DIR
            original_tasks_file = task_store_file._TASKS_FILE
            original_tasks_dir = task_store_file._TASKS_DIR
            try:
                task_store_file.OUTPUT_DIR = root
                task_store_file._TASKS_FILE = root / "tasks.json"
                task_store_file._TASKS_DIR = root / "tasks"

                task = task_store_file.create_task(
                    task_name="精简任务",
                    import_template_type="schema.csv",
                    export_template_id="export-1",
                    export_template_name="template.docx",
                )
                task_id = str(task.get("id") or "")

                task_store_file.update_task_template_info(
                    task_id,
                    file_no="FILE-001",
                    record_no="REC-001",
                )
                task_store_file.upsert_task_workspace_draft(
                    task_id,
                    {
                        "queue": [
                            {
                                "id": "item-1",
                                "file": None,
                                "fileName": "a.jpeg",
                                "sourceFileName": "",
                                "recordName": "R1",
                                "rowNumber": 1,
                                "sheetName": "",
                                "isRecordRow": True,
                                "sourceType": "JPEG",
                                "recognitionOverride": "",
                                "fileId": "file-1",
                                "rawText": "raw",
                                "sourceCode": "",
                                "recordCount": 1,
                                "category": "",
                                "fields": {
                                    "factory_serial_no": "A200441033",
                                    "empty_text": "",
                                    "empty_list": [],
                                },
                                "recognizedFields": {
                                    "factory_serial_no": "A200441033",
                                    "ownership_code": "金鸽",
                                    "empty_text": "",
                                },
                                "semantic_fields": {"钢瓶编号": "A200441033"},
                                "recognized_semantic_fields": {"产权单位": "金鸽"},
                                "typedFields": {"factory_serial_no": {"type": "text"}},
                                "fieldPipeline": {"factory_serial_no": {"status": "parsed"}},
                                "groupPipeline": {"钢瓶信息": {"status": "parsed"}},
                                "templateName": "",
                                "matchedBy": "ocr",
                                "templateUserSelected": False,
                                "status": "ready",
                                "message": "已识别",
                                "reportId": "",
                                "reportDownloadUrl": "",
                                "reportFileName": "",
                                "reportGenerateMode": "",
                                "modeReports": {
                                    "default": {
                                        "reportId": "report-1",
                                    }
                                },
                            }
                        ],
                        "active_id": "item-1",
                        "selected_ids": ["item-1"],
                        "list_filter": {
                            "keyword": "",
                            "status": "",
                            "sortKey": "",
                            "sortDir": "asc",
                            "columnFilters": {},
                            "activeFilterKey": "",
                        },
                        "source_view_mode": "fields",
                        "right_view_mode": "field",
                        "saved_at": "2026-04-16T00:00:00.000Z",
                    },
                )

                stored = json.loads(task_store_file._task_file_path(task_id).read_text(encoding="utf-8"))
                queue = stored["workspace_draft"]["queue"]
                item = queue[0]

                self.assertEqual(item["fields"], {"factory_serial_no": "A200441033"})
                self.assertEqual(item["recognizedFields"], {"ownership_code": "金鸽"})
                self.assertNotIn("semantic_fields", item)
                self.assertNotIn("recognized_semantic_fields", item)
                self.assertNotIn("typedFields", item)
                self.assertNotIn("fieldPipeline", item)
                self.assertNotIn("groupPipeline", item)
                self.assertNotIn("modeReports", item)
                self.assertNotIn("saved_at", stored["workspace_draft"])
                self.assertNotIn("remark", stored)
                self.assertNotIn("file_no", stored)
                self.assertNotIn("record_no", stored)
                self.assertEqual(stored["template_info"]["file_no"], "FILE-001")
                self.assertEqual(stored["template_info"]["record_no"], "REC-001")
            finally:
                task_store_file.OUTPUT_DIR = original_output_dir
                task_store_file._TASKS_FILE = original_tasks_file
                task_store_file._TASKS_DIR = original_tasks_dir


if __name__ == "__main__":
    unittest.main()
