import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..config import UPLOAD_DIR
from ..schemas.device_report import UploadResponse

router = APIRouter()

ALLOWED_SUFFIXES = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".webp",
    ".tif",
    ".tiff",
    ".pdf",
    ".docx",
    ".xls",
    ".xlsx",
}
HEIC_SUFFIXES = {".heic", ".heif"}
CONTENT_TYPE_TO_SUFFIX = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/bmp": ".bmp",
    "image/webp": ".webp",
    "image/tiff": ".tiff",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel": ".xls",
}
ALLOWED_SUFFIXES = ALLOWED_SUFFIXES | HEIC_SUFFIXES


@router.post("/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)) -> UploadResponse:
    suffix = _resolve_suffix(file)

    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: suffix={suffix or 'none'}, content_type={(file.content_type or 'none')}",
        )

    file_id = uuid4().hex
    output_path = UPLOAD_DIR / f"{file_id}{suffix}"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    return UploadResponse(
        file_id=file_id,
        file_name=file.filename or output_path.name,
        file_path=str(output_path),
    )


@router.get("/upload/{file_id}/download")
def download_uploaded_file(file_id: str) -> FileResponse:
    file_path = _find_uploaded_file(file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path=str(file_path),
        media_type=_guess_media_type(file_path),
        filename=file_path.name,
    )


@router.get("/upload/{file_id}/view")
def view_uploaded_file(file_id: str) -> FileResponse:
    file_path = _find_uploaded_file(file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path=str(file_path),
        media_type=_guess_media_type(file_path),
    )


def _resolve_suffix(file: UploadFile) -> str:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix == ".pic":
        detected = _detect_suffix_from_content(file)
        if detected:
            return detected
        return ".jpg"
    if suffix:
        return suffix
    by_content_type = CONTENT_TYPE_TO_SUFFIX.get((file.content_type or "").lower(), "")
    if by_content_type:
        return by_content_type
    return _detect_suffix_from_content(file)


def _find_uploaded_file(file_id: str) -> Path | None:
    matches = sorted(UPLOAD_DIR.glob(f"{file_id}.*"))
    return matches[0] if matches else None


def _guess_media_type(file_path: Path) -> str:
    suffix = file_path.suffix.lower()
    if suffix == ".docx":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if suffix == ".pdf":
        return "application/pdf"
    if suffix == ".xlsx":
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    if suffix == ".xls":
        return "application/vnd.ms-excel"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".bmp":
        return "image/bmp"
    if suffix == ".webp":
        return "image/webp"
    if suffix in {".tif", ".tiff"}:
        return "image/tiff"
    return "application/octet-stream"


def _detect_suffix_from_content(file: UploadFile) -> str:
    header = _peek_file_header(file, size=32)
    if not header:
        return ""
    if header.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if header.startswith((b"II*\x00", b"MM\x00*")):
        return ".tiff"
    if header.startswith(b"BM"):
        return ".bmp"
    if header.startswith(b"RIFF") and len(header) >= 12 and header[8:12] == b"WEBP":
        return ".webp"
    if header.startswith(b"%PDF-"):
        return ".pdf"
    return ""


def _peek_file_header(file: UploadFile, size: int = 32) -> bytes:
    stream = file.file
    try:
        pos = stream.tell()
    except Exception:
        pos = None
    try:
        data = stream.read(size) or b""
        return data
    finally:
        if pos is not None:
            try:
                stream.seek(pos)
            except Exception:
                pass
