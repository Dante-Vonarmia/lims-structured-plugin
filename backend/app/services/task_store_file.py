import json
import re
import threading
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from ..config import OUTPUT_DIR
_TASKS_FILE = OUTPUT_DIR / "tasks.json"
_TASKS_DIR = OUTPUT_DIR / "tasks"
_LOCK = threading.Lock()
_STANDARD_PATTERN = re.compile(r"(GB\s*/?\s*T\s*\d+(?:[-—]\d+)?)", re.IGNORECASE)
_RECORD_NO_PATTERN = re.compile(r"^(\d{8})-(\d+)$")
_ALLOWED_TASK_STATUS = {"待处理", "草稿", "已生成"}


def _now_text() -> str:
    return datetime.now().strftime("%Y/%m/%d %H:%M:%S")


def _ensure_file() -> None:
    _TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _TASKS_DIR.mkdir(parents=True, exist_ok=True)
    if not _TASKS_FILE.exists():
        _TASKS_FILE.write_text("[]", encoding="utf-8")


def _task_file_path(task_id: str) -> Path:
    return _TASKS_DIR / f"{task_id}.json"


def _build_task_index_entry(task: dict[str, Any]) -> dict[str, str]:
    task_id = str(task.get("id", "")).strip()
    return {
        "id": task_id,
        "path": str(Path("tasks") / f"{task_id}.json"),
    }


def _read_task_file(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _write_task_file(task: dict[str, Any]) -> None:
    task_id = str(task.get("id", "")).strip()
    if not task_id:
        return
    path = _task_file_path(task_id)
    tmp_path = Path(f"{path}.tmp")
    tmp_path.write_text(
        json.dumps(task, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp_path.replace(path)


def _read_task_index_unlocked() -> list[dict[str, Any]]:
    _ensure_file()
    try:
        payload = json.loads(_TASKS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(payload, list):
        return []
    return [x for x in payload if isinstance(x, dict)]


def _load_tasks_from_index_unlocked(index_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    for row in index_rows:
        task_id = str(row.get("id", "") or "").strip()
        rel_path = str(row.get("path", "") or "").strip()
        if rel_path:
            candidate = OUTPUT_DIR / rel_path
        elif task_id:
            candidate = _task_file_path(task_id)
        else:
            continue
        task = _read_task_file(candidate)
        if isinstance(task, dict):
            tasks.append(task)
    return tasks


def _has_explicit_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict, tuple, set)):
        return len(value) > 0
    return True


def _sanitize_fields_map(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    output: dict[str, Any] = {}
    for key, value in raw.items():
        clean_key = str(key or "").strip()
        if not clean_key or not _has_explicit_value(value):
            continue
        output[clean_key] = list(value) if isinstance(value, list) else value
    return output


def _sanitize_recognized_fields(fields: dict[str, Any], recognized: Any) -> dict[str, Any]:
    clean_recognized = _sanitize_fields_map(recognized)
    output: dict[str, Any] = {}
    for key, value in clean_recognized.items():
        if key in fields and fields.get(key) == value:
            continue
        output[key] = value
    return output


def _sanitize_queue_item(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    item_id = str(raw.get("id", "") or "").strip()
    if not item_id:
        return None

    fields = _sanitize_fields_map(raw.get("fields"))
    recognized_fields = _sanitize_recognized_fields(fields, raw.get("recognizedFields"))

    item: dict[str, Any] = {"id": item_id, "fields": fields}

    string_keys = (
        "fileName",
        "sourceFileName",
        "recordName",
        "sheetName",
        "sourceType",
        "recognitionOverride",
        "fileId",
        "rawText",
        "sourceCode",
        "category",
        "templateName",
        "matchedBy",
        "status",
        "message",
        "reportId",
        "reportDownloadUrl",
        "reportFileName",
        "reportGenerateMode",
    )
    for key in string_keys:
        value = str(raw.get(key, "") or "").strip()
        if value:
            item[key] = value

    if recognized_fields:
        item["recognizedFields"] = recognized_fields

    row_number = raw.get("rowNumber")
    if isinstance(row_number, (int, float)) and int(row_number) > 0:
        item["rowNumber"] = int(row_number)

    record_count = raw.get("recordCount")
    if isinstance(record_count, (int, float)) and int(record_count) > 0:
        item["recordCount"] = int(record_count)

    if bool(raw.get("isRecordRow")):
        item["isRecordRow"] = True
    if bool(raw.get("templateUserSelected")):
        item["templateUserSelected"] = True

    return item


def _sanitize_list_filter(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    output: dict[str, Any] = {}
    keyword = str(raw.get("keyword", "") or "").strip()
    status = str(raw.get("status", "") or "").strip()
    sort_key = str(raw.get("sortKey", "") or "").strip()
    sort_dir = str(raw.get("sortDir", "") or "").strip()
    active_filter_key = str(raw.get("activeFilterKey", "") or "").strip()
    column_filters = raw.get("columnFilters")
    if keyword:
        output["keyword"] = keyword
    if status:
        output["status"] = status
    if sort_key:
        output["sortKey"] = sort_key
    if sort_dir in {"asc", "desc"} and sort_dir != "asc":
        output["sortDir"] = sort_dir
    if isinstance(column_filters, dict) and column_filters:
        output["columnFilters"] = column_filters
    if active_filter_key:
        output["activeFilterKey"] = active_filter_key
    return output


def _sanitize_workspace_draft(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    raw_queue = raw.get("queue")
    queue: list[dict[str, Any]] = []
    if isinstance(raw_queue, list):
        for item in raw_queue:
            clean_item = _sanitize_queue_item(item)
            if clean_item:
                queue.append(clean_item)

    valid_ids = {str(item.get("id", "") or "") for item in queue}
    active_id = str(raw.get("active_id", "") or "").strip()
    selected_ids_raw = raw.get("selected_ids")
    selected_ids: list[str] = []
    if isinstance(selected_ids_raw, list):
        for value in selected_ids_raw:
            item_id = str(value or "").strip()
            if item_id and item_id in valid_ids and item_id not in selected_ids:
                selected_ids.append(item_id)

    output: dict[str, Any] = {"queue": queue}
    if active_id and active_id in valid_ids:
        output["active_id"] = active_id
    if selected_ids:
        output["selected_ids"] = selected_ids

    list_filter = _sanitize_list_filter(raw.get("list_filter"))
    if list_filter:
        output["list_filter"] = list_filter

    source_view_mode = str(raw.get("source_view_mode", "") or "").strip()
    if source_view_mode == "fields":
        output["source_view_mode"] = source_view_mode

    right_view_mode = str(raw.get("right_view_mode", "") or "").strip()
    if right_view_mode == "field":
        output["right_view_mode"] = right_view_mode

    return output


def _sanitize_task_for_storage(task: dict[str, Any]) -> dict[str, Any]:
    clean_task = deepcopy(task)
    clean_task["workspace_draft"] = _sanitize_workspace_draft(clean_task.get("workspace_draft"))
    for legacy_key in ("info_title", "file_no", "inspect_standard", "record_no", "submit_org"):
        clean_task.pop(legacy_key, None)
    if not str(clean_task.get("remark", "") or "").strip():
        clean_task.pop("remark", None)
    return clean_task


def _read_tasks_unlocked() -> list[dict[str, Any]]:
    index_rows = _read_task_index_unlocked()
    if not index_rows:
        return []
    if any("path" not in row for row in index_rows):
        tasks = [deepcopy(row) for row in index_rows if isinstance(row, dict)]
        _write_tasks_unlocked(tasks)
        return tasks
    return _load_tasks_from_index_unlocked(index_rows)


def _write_tasks_unlocked(tasks: list[dict[str, Any]]) -> None:
    _ensure_file()
    normalized_tasks = [deepcopy(task) for task in tasks if isinstance(task, dict)]
    index_rows: list[dict[str, str]] = []
    for task in normalized_tasks:
        if _normalize_bundle_refs(task):
            task["updated_at"] = _now_text()
        if _normalize_template_info(task):
            task["updated_at"] = _now_text()
        sanitized_task = _sanitize_task_for_storage(task)
        _write_task_file(sanitized_task)
        index_rows.append(_build_task_index_entry(sanitized_task))
    tmp_path = Path(f"{_TASKS_FILE}.tmp")
    tmp_path.write_text(
        json.dumps(index_rows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp_path.replace(_TASKS_FILE)


def _derive_import_template_title(import_template_type: str) -> str:
    raw = str(import_template_type or "").strip()
    if not raw:
        return ""
    name = Path(raw).stem if ("/" in raw or "\\" in raw or "." in raw) else raw
    name = re.sub(r"^\s*导入模板[-_ ]*", "", name, flags=re.IGNORECASE).strip()
    return name


def _derive_import_template_standard(import_template_type: str) -> str:
    raw = str(import_template_type or "").strip()
    if not raw:
        return ""
    candidate = Path(raw)
    if not candidate.exists() or not candidate.is_file():
        return ""
    try:
        text = candidate.read_text(encoding="utf-8")
    except Exception:
        try:
            text = candidate.read_text(encoding="gbk")
        except Exception:
            return ""
    match = _STANDARD_PATTERN.search(text)
    if not match:
        return ""
    value = str(match.group(1) or "").upper().replace(" ", "")
    return value.replace("GB/T", "GB/T ")


def _build_default_record_no(tasks: list[dict[str, Any]], now: datetime | None = None) -> str:
    current = now or datetime.now()
    date_key = current.strftime("%Y%m%d")
    max_seq = 0
    for row in tasks:
        template_info = row.get("template_info")
        if not isinstance(template_info, dict):
            continue
        candidate = str(template_info.get("record_no", "") or "").strip()
        if not candidate:
            continue
        matched = _RECORD_NO_PATTERN.match(candidate)
        if not matched:
            continue
        if matched.group(1) != date_key:
            continue
        try:
            seq = int(matched.group(2))
        except Exception:
            continue
        if seq > max_seq:
            max_seq = seq
    return f"{date_key}-{max_seq + 1:03d}"


def _normalize_template_info(task: dict[str, Any]) -> bool:
    changed = False
    import_template_type = str(task.get("import_template_type", "") or "").strip()
    export_template_name = str(task.get("export_template_name", "") or "").strip()

    if not isinstance(task.get("template_info"), dict):
        task["template_info"] = {}
        changed = True
    template_info = task["template_info"]

    def ensure_key(key: str) -> None:
        nonlocal changed
        if key not in template_info:
            template_info[key] = ""
            changed = True

    for key in ("info_title", "file_no", "inspect_standard", "record_no", "submit_org"):
        ensure_key(key)

    legacy_template_values = {
        "info_title": str(task.get("info_title", "") or "").strip(),
        "file_no": str(task.get("file_no", "") or "").strip(),
        "inspect_standard": str(task.get("inspect_standard", "") or "").strip(),
        "record_no": str(task.get("record_no", "") or "").strip(),
        "submit_org": str(task.get("submit_org", "") or "").strip(),
    }
    for key, legacy_value in legacy_template_values.items():
        if not str(template_info.get(key, "") or "").strip() and legacy_value:
            template_info[key] = legacy_value
            changed = True

    derived_title = _derive_import_template_title(import_template_type)
    if not str(template_info.get("info_title", "") or "").strip() and derived_title:
        template_info["info_title"] = derived_title
        changed = True
    elif not str(template_info.get("info_title", "") or "").strip() and export_template_name:
        template_info["info_title"] = export_template_name
        changed = True

    derived_standard = _derive_import_template_standard(import_template_type)
    if not str(template_info.get("inspect_standard", "") or "").strip() and derived_standard:
        template_info["inspect_standard"] = derived_standard
        changed = True

    return changed


def _normalize_bundle_refs(task: dict[str, Any]) -> bool:
    changed = False
    if "input_bundle_id" not in task:
        task["input_bundle_id"] = ""
        changed = True
    if "output_bundle_id" not in task:
        task["output_bundle_id"] = ""
        changed = True
    export_template_name = str(task.get("export_template_name", "") or "").strip()
    if not str(task.get("output_bundle_id", "") or "").strip() and export_template_name.startswith("bundle:"):
        task["output_bundle_id"] = export_template_name.split(":", 1)[1].strip()
        changed = True
    return changed


def list_tasks() -> list[dict[str, Any]]:
    with _LOCK:
        tasks = _read_tasks_unlocked()
        changed = False
        for task in tasks:
            if "archived" not in task:
                task["archived"] = False
                changed = True
            if "workspace_draft" not in task or not isinstance(task.get("workspace_draft"), dict):
                task["workspace_draft"] = {}
                changed = True
            if _normalize_bundle_refs(task):
                changed = True
            if _normalize_template_info(task):
                changed = True
        if changed:
            _write_tasks_unlocked(tasks)
    return [task for task in tasks if not bool(task.get("archived"))]


def create_task(
    *,
    task_name: str,
    import_template_type: str,
    export_template_id: str,
    export_template_name: str,
    input_bundle_id: str = "",
    output_bundle_id: str = "",
    input_bundle_display_name: str = "",
    output_bundle_display_name: str = "",
) -> dict[str, Any]:
    now_dt = datetime.now()
    now = now_dt.strftime("%Y/%m/%d %H:%M:%S")
    with _LOCK:
        tasks = _read_tasks_unlocked()
        last_file_no = ""
        for row in tasks:
            template_info = row.get("template_info")
            if not isinstance(template_info, dict):
                continue
            candidate = str(template_info.get("file_no", "")).strip()
            if candidate:
                last_file_no = candidate
                break
        default_record_no = _build_default_record_no(tasks, now=now_dt)
    import_template_title = _derive_import_template_title(import_template_type)
    import_template_standard = _derive_import_template_standard(import_template_type)
    task = {
        "id": f"task-{uuid4().hex}",
        "task_name": task_name,
        "import_file_name": import_template_type,
        "import_template_type": import_template_type,
        "export_template_id": export_template_id,
        "export_template_name": export_template_name,
        "input_bundle_id": str(input_bundle_id or "").strip(),
        "output_bundle_id": str(output_bundle_id or "").strip(),
        "status": "待处理",
        "archived": False,
        "created_at": now,
        "updated_at": now,
        "remark": "",
        "workspace_draft": {},
        "template_info": {
            "info_title": str(input_bundle_display_name or "").strip() or import_template_title or str(output_bundle_display_name or "").strip() or export_template_name,
            "file_no": last_file_no,
            "inspect_standard": import_template_standard,
            "record_no": default_record_no,
            "submit_org": "",
        },
    }
    with _LOCK:
        tasks = _read_tasks_unlocked()
        tasks.insert(0, task)
        _write_tasks_unlocked(tasks)
    return task


def mark_task_complete(task_id: str) -> dict[str, Any] | None:
    with _LOCK:
        tasks = _read_tasks_unlocked()
        for task in tasks:
            if str(task.get("id", "")).strip() != task_id:
                continue
            if task.get("status") != "已完成":
                task["status"] = "已完成"
                task["updated_at"] = _now_text()
                _write_tasks_unlocked(tasks)
            return task
    return None


def get_task(task_id: str) -> dict[str, Any] | None:
    with _LOCK:
        tasks = _read_tasks_unlocked()
        for task in tasks:
            if str(task.get("id", "")).strip() == task_id:
                changed = False
                if "archived" not in task:
                    task["archived"] = False
                    changed = True
                if "workspace_draft" not in task or not isinstance(task.get("workspace_draft"), dict):
                    task["workspace_draft"] = {}
                    changed = True
                if _normalize_bundle_refs(task):
                    changed = True
                if _normalize_template_info(task):
                    changed = True
                if changed:
                    _write_tasks_unlocked(tasks)
                return task
    return None


def update_task_template_info(
    task_id: str,
    *,
    info_title: str | None = None,
    file_no: str | None = None,
    inspect_standard: str | None = None,
    record_no: str | None = None,
    submit_org: str | None = None,
) -> dict[str, Any] | None:
    with _LOCK:
        tasks = _read_tasks_unlocked()
        for task in tasks:
            if str(task.get("id", "")).strip() != task_id:
                continue
            if not isinstance(task.get("template_info"), dict):
                task["template_info"] = {}
            template_info = task["template_info"]
            if info_title is not None:
                template_info["info_title"] = info_title
            if file_no is not None:
                template_info["file_no"] = file_no
            if inspect_standard is not None:
                template_info["inspect_standard"] = inspect_standard
            if record_no is not None:
                template_info["record_no"] = record_no
            if submit_org is not None:
                template_info["submit_org"] = submit_org
            task["updated_at"] = _now_text()
            _write_tasks_unlocked(tasks)
            return task
    return None


def archive_task(task_id: str) -> dict[str, Any] | None:
    with _LOCK:
        tasks = _read_tasks_unlocked()
        for task in tasks:
            if str(task.get("id", "")).strip() != task_id:
                continue
            if not bool(task.get("archived")):
                task["archived"] = True
                task["updated_at"] = _now_text()
                _write_tasks_unlocked(tasks)
            return task
    return None


def update_task_status(task_id: str, status: str) -> dict[str, Any] | None:
    next_status = str(status or "").strip()
    if next_status not in _ALLOWED_TASK_STATUS:
        return None
    with _LOCK:
        tasks = _read_tasks_unlocked()
        for task in tasks:
            if str(task.get("id", "")).strip() != task_id:
                continue
            if str(task.get("status", "")).strip() != next_status:
                task["status"] = next_status
                task["updated_at"] = _now_text()
                _write_tasks_unlocked(tasks)
            return task
    return None


def get_task_workspace_draft(task_id: str) -> dict[str, Any] | None:
    with _LOCK:
        tasks = _read_tasks_unlocked()
        for task in tasks:
            if str(task.get("id", "")).strip() != task_id:
                continue
            draft = task.get("workspace_draft")
            if isinstance(draft, dict):
                return draft
            return {}
    return None


def upsert_task_workspace_draft(task_id: str, draft: dict[str, Any]) -> dict[str, Any] | None:
    with _LOCK:
        tasks = _read_tasks_unlocked()
        for task in tasks:
            if str(task.get("id", "")).strip() != task_id:
                continue
            task["workspace_draft"] = draft if isinstance(draft, dict) else {}
            task["updated_at"] = _now_text()
            _write_tasks_unlocked(tasks)
            return task["workspace_draft"]
    return None
