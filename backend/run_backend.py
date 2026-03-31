import os
import sys
from pathlib import Path

import uvicorn


def _runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def _set_default_env() -> None:
    root = _runtime_root()
    uploads = root / "uploads"
    outputs = root / "outputs"
    raw_records = root / "raw-records"
    templates = root / "templates"

    uploads.mkdir(parents=True, exist_ok=True)
    outputs.mkdir(parents=True, exist_ok=True)
    raw_records.mkdir(parents=True, exist_ok=True)
    templates.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("UPLOAD_DIR", str(uploads))
    os.environ.setdefault("OUTPUT_DIR", str(outputs))
    os.environ.setdefault("RAW_RECORD_DIR", str(raw_records))
    os.environ.setdefault("TEMPLATE_DIR", str(templates))
    os.environ.setdefault("OFFLINE_MODE", "1")


def main() -> None:
    _set_default_env()
    uvicorn.run("app.main:app", host="127.0.0.1", port=18081)


if __name__ == "__main__":
    main()
