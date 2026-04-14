from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..services.signature_store_file import (
    create_signature as create_signature_file,
    delete_signature as delete_signature_file,
    get_signature_file_path,
    list_signatures as list_signatures_file,
    update_signature as update_signature_file,
)

router = APIRouter()


@router.get("/signatures")
def list_signatures() -> dict[str, list[dict[str, object]]]:
    return {"signatures": list_signatures_file()}


@router.post("/signatures")
async def create_signature(
    name: str = Form(...),
    role: str = Form(""),
    file: UploadFile = File(...),
) -> dict[str, object]:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="signature file is empty")
    suffix = Path(str(file.filename or "")).suffix.lower()
    return create_signature_file(name=name, role=role, content=content, suffix=suffix)


@router.patch("/signatures/{signature_id}")
async def update_signature(
    signature_id: str,
    name: str | None = Form(None),
    role: str | None = Form(None),
    file: UploadFile | None = File(None),
) -> dict[str, object]:
    content: bytes | None = None
    suffix = ""
    if file is not None:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=422, detail="signature file is empty")
        suffix = Path(str(file.filename or "")).suffix.lower()
    row = update_signature_file(
        signature_id.strip(),
        name=name,
        role=role,
        content=content,
        suffix=suffix,
    )
    if not row:
        raise HTTPException(status_code=404, detail="signature not found")
    return row


@router.delete("/signatures/{signature_id}")
def delete_signature(signature_id: str) -> dict[str, bool]:
    ok = delete_signature_file(signature_id.strip())
    if not ok:
        raise HTTPException(status_code=404, detail="signature not found")
    return {"ok": True}


@router.get("/signatures/{signature_id}/image")
def signature_image(signature_id: str) -> FileResponse:
    file_path = get_signature_file_path(signature_id.strip())
    if not file_path:
        raise HTTPException(status_code=404, detail="signature image not found")
    media_map = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
    }
    media_type = media_map.get(file_path.suffix.lower(), "application/octet-stream")
    return FileResponse(path=str(file_path), media_type=media_type, filename=file_path.name)
