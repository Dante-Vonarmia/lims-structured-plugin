from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..config import UPLOAD_DIR
from ..schemas.device_report import OCRRequest, OCRResponse
from ..services.ocr_service import recognize_file

router = APIRouter()


@router.post("/ocr", response_model=OCRResponse)
def run_ocr(request: OCRRequest) -> OCRResponse:
    file_path = _find_uploaded_file(request.file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")

    raw_text, lines, engine = recognize_file(file_path)
    return OCRResponse(
        file_id=request.file_id,
        raw_text=raw_text,
        lines=lines,
        engine=engine,
    )


def _find_uploaded_file(file_id: str) -> Path | None:
    matches = sorted(UPLOAD_DIR.glob(f"{file_id}.*"))
    return matches[0] if matches else None
