import json
import re
import threading
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from ..config import OUTPUT_DIR
from .import_template_schema_service import load_import_template_schema

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
        _write_tasks_unlocked([])


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


def _extract_semantic_fields(raw_fields: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    columns = schema.get("columns")
    if not isinstance(columns, list):
        return output
    for col in columns:
        if not isinstance(col, dict):
            continue
        label = str(col.get("label", "") or "").strip()
        key = str(col.get("key", "") or "").strip()
        if not label or not key:
            continue
        value = raw_fields.get(key, "")
        if value in (None, ""):
            index = int(col.get("index", -1) or -1)
            fallback_key = f"col_{index + 1:02d}" if index >= 0 else ""
            if fallback_key:
                value = raw_fields.get(fallback_key, "")
        output[label] = value
    return output


def _normalize_workspace_semantics(task: dict[str, Any]) -> bool:
    draft = task.get("workspace_draft")
    if not isinstance(draft, dict):
        return False
    queue = draft.get("queue")
    if not isinstance(queue, list) or not queue:
        return False
    schema = load_import_template_schema(str(task.get("import_template_type", "") or "").strip())
    changed = False
    for item in queue:
        if not isinstance(item, dict):
            continue
        fields = item.get("fields")
        if isinstance(fields, dict):
            semantic = _extract_semantic_fields(fields, schema)
            if item.get("semantic_fields") != semantic:
                item["semantic_fields"] = semantic
                changed = True
        recognized = item.get("recognizedFields")
        if isinstance(recognized, dict):
            semantic = _extract_semantic_fields(recognized, schema)
            if item.get("recognized_semantic_fields") != semantic:
                item["recognized_semantic_fields"] = semantic
                changed = True
    return changed


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
        if _normalize_workspace_semantics(task):
            task["updated_at"] = _now_text()
        _write_task_file(task)
        index_rows.append(_build_task_index_entry(task))
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
                task["info_title"] = info_title
            if file_no is not None:
                template_info["file_no"] = file_no
                task["file_no"] = file_no
            if inspect_standard is not None:
                template_info["inspect_standard"] = inspect_standard
                task["inspect_standard"] = inspect_standard
            if record_no is not None:
                template_info["record_no"] = record_no
                task["record_no"] = record_no
            if submit_org is not None:
                template_info["submit_org"] = submit_org
                task["submit_org"] = submit_org
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
