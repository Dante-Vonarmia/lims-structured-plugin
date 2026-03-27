from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .routers import ocr, report, upload

app = FastAPI(title="LIMS Device Report MVP", version="0.1.0")

app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(ocr.router, prefix="/api", tags=["ocr"])
app.include_router(report.router, prefix="/api", tags=["report"])

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/runtime-config")
def runtime_config() -> dict[str, bool]:
    return {"offline_mode": config.OFFLINE_MODE}
