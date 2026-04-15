import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from ..config import UPLOAD_DIR
from .task_store_file import create_task, list_tasks, upsert_task_workspace_draft

_SEED_DIR = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
_SEED_PATTERN = "benchmark_*_seed_rows.json"


def _now_compact() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def list_benchmark_seeds() -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for path in sorted(_SEED_DIR.glob(_SEED_PATTERN)):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        seed_key = str(payload.get("seed_key", "") or "").strip()
        if not seed_key:
            continue
        rows = payload.get("rows", [])
        output.append(
            {
                "seed_key": seed_key,
                "row_count": len(rows) if isinstance(rows, list) else 0,
                "source_image": str(payload.get("source_image", "") or "").strip(),
                "rotation": int(payload.get("rotation", 0) or 0),
                "path": str(path),
            }
        )
    return output


def load_benchmark_seed(seed_key: str) -> dict[str, Any]:
    target = str(seed_key or "").strip()
    if not target:
        return {}
    for path in sorted(_SEED_DIR.glob(_SEED_PATTERN)):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        if str(payload.get("seed_key", "") or "").strip() == target:
            return payload
    return {}


def _resolve_template_defaults() -> dict[str, str]:
    tasks = list_tasks()
    for row in tasks:
        import_template_type = str((row or {}).get("import_template_type", "") or "").strip()
        export_template_id = str((row or {}).get("export_template_id", "") or "").strip()
        export_template_name = str((row or {}).get("export_template_name", "") or "").strip()
        if import_template_type and export_template_id and export_template_name:
            return {
                "import_template_type": import_template_type,
                "export_template_id": export_template_id,
                "export_template_name": export_template_name,
            }
    root = Path(__file__).resolve().parents[2]
    return {
        "import_template_type": str(root / "templates" / "import-template-steel-cylinder-periodic-inspection.csv"),
        "export_template_id": "export-docx-2026030604-date",
        "export_template_name": str(root / "templates" / "modify-certificate-blueprint.docx"),
    }


def _build_queue_item(
    seed_key: str,
    row: dict[str, Any],
    row_number: int,
    source_image: str,
    source_file_id: str = "",
) -> dict[str, Any]:
    fields_src = row.get("fields")
    fields = dict(fields_src) if isinstance(fields_src, dict) else {}
    raw_record = str(row.get("raw_record", "") or "").strip()
    if raw_record:
        fields["raw_record"] = raw_record
    record_name = str(fields.get("col_05", "") or "").strip() or str(fields.get("col_01", "") or "").strip() or f"row_{row_number}"
    return {
        "id": f"seed-{seed_key}-{row_number}-{uuid4().hex[:8]}",
        "file": None,
        "fileName": source_image,
        "sourceFileName": source_image,
        "recordName": record_name,
        "rowNumber": row_number,
        "sheetName": "",
        "isRecordRow": True,
        "sourceType": "JPEG",
        "recognitionOverride": "",
        "fileId": source_file_id,
        "rawText": raw_record,
        "sourceCode": "",
        "recordCount": 1,
        "category": f"基准种子:{seed_key}",
        "fields": fields,
        "recognizedFields": dict(fields),
        "typedFields": {},
        "fieldPipeline": {},
        "groupPipeline": {},
        "templateName": "",
        "matchedBy": "benchmark_seed",
        "templateUserSelected": False,
        "status": "ready",
        "message": "基准种子行",
        "reportId": "",
        "reportDownloadUrl": "",
        "reportFileName": "",
        "reportGenerateMode": "",
        "modeReports": {},
    }


def _register_source_image_to_uploads(source_image_path: str) -> tuple[str, str]:
    path = Path(str(source_image_path or "").strip())
    if not path.exists() or not path.is_file():
        return "", ""
    suffix = str(path.suffix or "").strip().lower()
    if not suffix:
        return "", ""
    file_id = uuid4().hex
    dest = UPLOAD_DIR / f"{file_id}{suffix}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, dest)
    return file_id, path.name


def build_workspace_draft_from_seed(seed_payload: dict[str, Any], source_file_id: str = "", source_display_name: str = "") -> dict[str, Any]:
    rows = seed_payload.get("rows")
    if not isinstance(rows, list):
        rows = []
    seed_key = str(seed_payload.get("seed_key", "") or "").strip()
    source_image = str(source_display_name or "").strip() or str(seed_payload.get("source_image", "") or "").strip() or "benchmark-seed.jpeg"
    queue = []
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        queue.append(_build_queue_item(seed_key, row, idx + 1, source_image, source_file_id))
    active_id = str((queue[0] or {}).get("id", "") or "") if queue else ""
    return {
        "queue": queue,
        "active_id": active_id,
        "selected_ids": [active_id] if active_id else [],
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
        "saved_at": datetime.now().isoformat(),
    }


def create_benchmark_task(
    *,
    seed_key: str,
    task_name: str = "",
    import_template_type: str = "",
    export_template_id: str = "",
    export_template_name: str = "",
    source_image_path: str = "",
) -> dict[str, Any]:
    seed_payload = load_benchmark_seed(seed_key)
    if not seed_payload:
        raise ValueError(f"seed not found: {seed_key}")
    defaults = _resolve_template_defaults()
    resolved_import_template_type = str(import_template_type or "").strip() or defaults["import_template_type"]
    resolved_export_template_id = str(export_template_id or "").strip() or defaults["export_template_id"]
    resolved_export_template_name = str(export_template_name or "").strip() or defaults["export_template_name"]
    resolved_task_name = str(task_name or "").strip() or f"基准任务-{seed_key}-{_now_compact()}"

    task = create_task(
        task_name=resolved_task_name,
        import_template_type=resolved_import_template_type,
        export_template_id=resolved_export_template_id,
        export_template_name=resolved_export_template_name,
    )
    task_id = str(task.get("id", "") or "").strip()
    if not task_id:
        raise RuntimeError("failed to create benchmark task: empty task id")
    resolved_source_image_path = str(source_image_path or "").strip()
    if not resolved_source_image_path:
        source_name = str(seed_payload.get("source_image", "") or "").strip()
        if source_name:
            candidate = _SEED_DIR / source_name
            if candidate.exists() and candidate.is_file():
                resolved_source_image_path = str(candidate)
    source_file_id = ""
    source_display_name = str(seed_payload.get("source_image", "") or "").strip()
    if resolved_source_image_path:
        fid, fname = _register_source_image_to_uploads(resolved_source_image_path)
        source_file_id = fid
        if fname:
            source_display_name = fname

    draft = build_workspace_draft_from_seed(
        seed_payload,
        source_file_id=source_file_id,
        source_display_name=source_display_name,
    )
    updated_draft = upsert_task_workspace_draft(task_id, draft)
    return {
        "task": task,
        "draft": updated_draft if isinstance(updated_draft, dict) else draft,
        "seed_key": str(seed_payload.get("seed_key", "") or "").strip(),
        "row_count": len(draft.get("queue", [])),
        "source_file_id": source_file_id,
        "source_image": source_display_name,
    }
