import json
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from ..config import OUTPUT_DIR

_TASKS_FILE = OUTPUT_DIR / "tasks.json"
_LOCK = threading.Lock()
_STANDARD_PATTERN = re.compile(r"(GB\s*/?\s*T\s*\d+(?:[-—]\d+)?)", re.IGNORECASE)
_ALLOWED_TASK_STATUS = {"待处理", "草稿", "已生成"}


def _now_text() -> str:
    return datetime.now().strftime("%Y/%m/%d %H:%M:%S")


def _ensure_file() -> None:
    _TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not _TASKS_FILE.exists():
        _write_tasks_unlocked([])


def _read_tasks_unlocked() -> list[dict[str, Any]]:
    _ensure_file()
    try:
        payload = json.loads(_TASKS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(payload, list):
        return []
    return [x for x in payload if isinstance(x, dict)]


def _write_tasks_unlocked(tasks: list[dict[str, Any]]) -> None:
    tmp_path = Path(f"{_TASKS_FILE}.tmp")
    tmp_path.write_text(
        json.dumps(tasks, ensure_ascii=False, indent=2),
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
    now = _now_text()
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
            "record_no": "",
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
