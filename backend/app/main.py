from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .routers import ocr, report, signatures, tasks, upload
from .utils.constants_lint import lint_constants_structure

app = FastAPI(title="LIMS Device Report MVP", version="0.1.0")

app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(ocr.router, prefix="/api", tags=["ocr"])
app.include_router(report.router, prefix="/api", tags=["report"])
app.include_router(tasks.router, prefix="/api", tags=["tasks"])
app.include_router(signatures.router, prefix="/api", tags=["signatures"])

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}


@app.on_event("startup")
def validate_frontend_constants_structure() -> None:
    errors = lint_constants_structure()
    if errors:
        detail = " | ".join(errors)
        raise RuntimeError(f"constants structure lint failed: {detail}")


@app.get("/")
def index() -> RedirectResponse:
    return RedirectResponse(url="/tasks", status_code=307)


@app.get("/login")
@app.get("/tasks")
@app.get("/tasks/new")
@app.get("/signatures")
def workbench_preview() -> FileResponse:
    return FileResponse(STATIC_DIR / "workbench-preview" / "index.html", headers=NO_CACHE_HEADERS)

@app.get("/workspace/{task_id}")
def workspace(task_id: str) -> FileResponse:
    _ = task_id
    return FileResponse(STATIC_DIR / "index.html", headers=NO_CACHE_HEADERS)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/runtime-config")
def runtime_config() -> dict[str, object]:
    return {
        "offline_mode": config.OFFLINE_MODE,
        "modify_certificate_blueprint_template_name": config.MODIFY_CERTIFICATE_BLUEPRINT_TEMPLATE_NAME,
    }
