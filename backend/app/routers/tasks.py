from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

from ..services.import_template_schema_service import load_import_template_schema
from ..services.template_bundle import (
    BundleError,
    list_bundle_options_payload,
    resolve_input_bundle,
    resolve_output_bundle,
)
from ..services.task_store_file import archive_task as archive_task_file
from ..services.task_store_file import create_task as create_task_file
from ..services.task_store_file import get_task as get_task_file
from ..services.task_store_file import get_task_workspace_draft as get_task_workspace_draft_file
from ..services.task_store_file import list_tasks as list_tasks_file
from ..services.task_store_file import mark_task_complete
from ..services.task_store_file import update_task_status as update_task_status_file
from ..services.task_store_file import upsert_task_workspace_draft as upsert_task_workspace_draft_file
from ..services.task_store_file import update_task_template_info as update_task_template_info_file

router = APIRouter()


class TaskCreateRequest(BaseModel):
    task_name: str
    import_template_type: str = ""
    export_template_id: str = ""
    export_template_name: str = ""
    input_bundle_id: str | None = None
    output_bundle_id: str | None = None


class TaskTemplateInfoUpdateRequest(BaseModel):
    info_title: str | None = None
    file_no: str | None = None
    inspect_standard: str | None = None
    record_no: str | None = None
    submit_org: str | None = None


class TaskWorkspaceDraftUpsertRequest(BaseModel):
    draft: dict[str, object]


class TaskStatusUpdateRequest(BaseModel):
    status: str


@router.get("/tasks")
def list_tasks() -> dict[str, list[dict[str, object]]]:
    return {"tasks": list_tasks_file()}


@router.get("/tasks/{task_id}")
def get_task(task_id: str) -> dict[str, object]:
    task = get_task_file(task_id.strip())
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@router.get("/tasks/{task_id}/import-template-schema")
def get_task_import_template_schema(task_id: str) -> dict[str, object]:
    task = get_task_file(task_id.strip())
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    input_bundle_id = str((task or {}).get("input_bundle_id", "") or "").strip()
    import_template_path = str((task or {}).get("import_template_type", "")).strip()
    if input_bundle_id:
        try:
            bundle = resolve_input_bundle(input_bundle_id)
            import_template_path = str(((bundle.get("entries") or {}).get("schema")) or "").strip()
        except BundleError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    schema = load_import_template_schema(import_template_path)
    return {"task_id": str(task.get("id") or ""), "schema": schema}


@router.get("/template-bundles")
def list_template_bundles() -> dict[str, object]:
    return list_bundle_options_payload()


@router.post("/tasks")
def create_task(request: TaskCreateRequest) -> dict[str, object]:
    task_name = request.task_name.strip()
    import_template_type = request.import_template_type.strip()
    export_template_id = request.export_template_id.strip()
    export_template_name = request.export_template_name.strip()
    input_bundle_id = str(request.input_bundle_id or "").strip()
    output_bundle_id = str(request.output_bundle_id or "").strip()

    if not task_name:
        raise HTTPException(status_code=422, detail="task_name is required")

    input_bundle_display_name = ""
    output_bundle_display_name = ""

    if input_bundle_id or output_bundle_id:
        if not input_bundle_id:
            raise HTTPException(status_code=422, detail="input_bundle_id is required")
        if not output_bundle_id:
            raise HTTPException(status_code=422, detail="output_bundle_id is required")
        try:
            input_bundle = resolve_input_bundle(input_bundle_id)
            output_bundle = resolve_output_bundle(output_bundle_id)
        except BundleError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        import_template_type = str(((input_bundle.get("entries") or {}).get("schema")) or "").strip()
        export_template_name = f"bundle:{output_bundle_id}"
        export_template_id = output_bundle_id
        input_bundle_display_name = str(input_bundle.get("displayName") or "").strip()
        output_bundle_display_name = str(output_bundle.get("displayName") or "").strip()
    else:
        if not import_template_type:
            raise HTTPException(status_code=422, detail="import_template_type is required")
        if not export_template_id:
            raise HTTPException(status_code=422, detail="export_template_id is required")
        if not export_template_name:
            raise HTTPException(status_code=422, detail="export_template_name is required")

    return create_task_file(
        task_name=task_name,
        import_template_type=import_template_type,
        export_template_id=export_template_id,
        export_template_name=export_template_name,
        input_bundle_id=input_bundle_id,
        output_bundle_id=output_bundle_id,
        input_bundle_display_name=input_bundle_display_name,
        output_bundle_display_name=output_bundle_display_name,
    )


@router.patch("/tasks/{task_id}/complete")
def complete_task(task_id: str) -> dict[str, object]:
    task = mark_task_complete(task_id.strip())
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@router.patch("/tasks/{task_id}/archive")
def archive_task(task_id: str) -> dict[str, object]:
    task = archive_task_file(task_id.strip())
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@router.patch("/tasks/{task_id}/status")
def update_task_status(task_id: str, request: TaskStatusUpdateRequest) -> dict[str, object]:
    status = request.status.strip()
    if not status:
        raise HTTPException(status_code=422, detail="status is required")
    task = update_task_status_file(task_id.strip(), status)
    if not task:
        raise HTTPException(status_code=422, detail="invalid status or task not found")
    return task


@router.patch("/tasks/{task_id}/template-info")
def update_task_template_info(task_id: str, request: TaskTemplateInfoUpdateRequest) -> dict[str, object]:
    task = update_task_template_info_file(
        task_id.strip(),
        info_title=request.info_title.strip() if request.info_title is not None else None,
        file_no=request.file_no.strip() if request.file_no is not None else None,
        inspect_standard=request.inspect_standard.strip() if request.inspect_standard is not None else None,
        record_no=request.record_no.strip() if request.record_no is not None else None,
        submit_org=request.submit_org.strip() if request.submit_org is not None else None,
    )
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@router.get("/tasks/{task_id}/workspace-draft")
def get_task_workspace_draft(task_id: str) -> dict[str, object]:
    draft = get_task_workspace_draft_file(task_id.strip())
    if draft is None:
        raise HTTPException(status_code=404, detail="task not found")
    return {"draft": draft}


@router.put("/tasks/{task_id}/workspace-draft")
def upsert_task_workspace_draft(task_id: str, request: TaskWorkspaceDraftUpsertRequest) -> dict[str, object]:
    draft = upsert_task_workspace_draft_file(task_id.strip(), request.draft)
    if draft is None:
        raise HTTPException(status_code=404, detail="task not found")
    return {"draft": draft}
