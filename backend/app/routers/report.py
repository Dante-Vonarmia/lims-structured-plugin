import csv
import io
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import hashlib
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile
from uuid import uuid4

from ..config import (
    DEFAULT_TEMPLATE_NAME,
    LOCAL_DOCUMENT_LIBRARY_FILE,
    MODIFY_CERTIFICATE_BLUEPRINT_TEMPLATE_NAME,
    OUTPUT_DIR,
    TEMPLATE_DIR,
    UPLOAD_DIR,
)
from ..schemas.device_report import (
    DeviceFields,
    EditorPrefillRequest,
    EditorPrefillResponse,
    ExcelBatchRequest,
    ExcelBatchResponse,
    ExcelInspectRequest,
    ExcelInspectResponse,
    ExcelPreviewRequest,
    ExcelPreviewResponse,
    ExtractRequest,
    ReportValidation,
    ReportRequest,
    ReportResponse,
    TemplateMatchRequest,
    TemplateMatchResponse,
    TemplateFeedbackRequest,
    TemplateFeedbackResponse,
)
from ..services.excel_batch_service import inspect_excel_records, parse_excel_rows, preview_excel_sheet
from ..services.extract_service import extract_fields
from ..services.local_document_library_service import load_local_document_library, rebuild_local_document_library
from ..services.template_mapping_library_service import get_editor_schema
from ..services.template_service import (
    FixedTemplateFillError,
    get_template_editor_prefill,
    list_available_templates,
    match_template_name,
    render_report,
)
from ..services.template_feedback_service import build_template_feedback_entry
from ..services.template_bundle import BundleError, resolve_output_bundle
from ..services.template_compat_service import normalize_legacy_template_name
from ..services.docx_structure_service import (
    _extract_general_check_structure_from_docx,
)
from ..services.instrument_catalog_service import (
    _detect_catalog_binary_format,
    _extract_measurement_rows_from_docx,
    _is_measurement_table_row_candidate,
    _normalize_catalog_value,
    _parse_catalog_csv,
    _parse_catalog_docx,
    _parse_catalog_text,
    _parse_catalog_xlsx,
)

router = APIRouter()
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
def _resolve_template_file_path(template_name: str) -> Path:
    raw = str(template_name or "").strip()
    if raw.lower().startswith("bundle:"):
        bundle_id = raw.split(":", 1)[1].strip()
        try:
            bundle = resolve_output_bundle(bundle_id)
        except BundleError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        entries = bundle.get("entries") if isinstance(bundle.get("entries"), dict) else {}
        return Path(str(entries.get("template") or ""))
    return TEMPLATE_DIR / raw

@router.post("/extract", response_model=DeviceFields)
def extract(request: ExtractRequest) -> DeviceFields:
    fields = extract_fields(request.raw_text)
    return DeviceFields(**fields)


@router.post("/report", response_model=ReportResponse)
def create_report(request: ReportRequest) -> ReportResponse:
    template_name = normalize_legacy_template_name(request.template_name or DEFAULT_TEMPLATE_NAME)
    context = request.fields.model_dump()
    source_file_path = _find_uploaded_file(request.source_file_id) if request.source_file_id else None
    source_file_as_template = bool(request.source_file_as_template)
    if source_file_as_template:
        blueprint_name = str(MODIFY_CERTIFICATE_BLUEPRINT_TEMPLATE_NAME or "").strip()
        blueprint_path = TEMPLATE_DIR / blueprint_name
        if not blueprint_name or not blueprint_path.exists() or not blueprint_path.is_file():
            raise HTTPException(status_code=422, detail=f"修改证书蓝本不存在：{blueprint_name or '未配置'}")
        template_name = blueprint_name
        source_file_as_template = False
    try:
        report_id, output_path = render_report(
            template_name=template_name,
            context=context,
            source_file_path=source_file_path,
            source_file_as_template=source_file_as_template,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FixedTemplateFillError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    output_format = output_path.suffix.lower().lstrip(".")
    preview_url = f"/api/report/{report_id}/view" if output_format == "html" else None

    return ReportResponse(
        report_id=report_id,
        download_url=f"/api/report/{report_id}/download",
        preview_url=preview_url,
        output_format=output_format,
        validation=_build_report_validation(output_path),
    )


@router.post("/report/batch-from-excel", response_model=ExcelBatchResponse)
def create_report_batch_from_excel(request: ExcelBatchRequest) -> ExcelBatchResponse:
    file_path = _find_uploaded_file(request.file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")
    if file_path.suffix.lower() not in {".xlsx", ".xls"}:
        raise HTTPException(status_code=400, detail="Only .xlsx/.xls are supported for batch mode")

    rows, errors = parse_excel_rows(
        file_path=file_path,
        sheet_name=request.sheet_name,
        default_template_name=request.default_template_name or "",
    )
    if not rows:
        raise HTTPException(status_code=422, detail="Excel has no valid rows for generation")

    batch_id = uuid4().hex
    zip_path = OUTPUT_DIR / f"{batch_id}__excel_batch.zip"
    total_rows = len(rows) + len(errors)
    generated_count = 0
    skipped_count = len(errors)

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for row in rows:
            try:
                _, output_path = render_report(
                    template_name=row["template_name"],
                    context=row["fields"],
                    source_file_path=file_path,
                )
                arc_name = f"{row['row_number']:04d}_{row['row_name']}__{_get_report_download_name(output_path)}"
                zf.write(output_path, arcname=arc_name)
                generated_count += 1
            except Exception as exc:
                skipped_count += 1
                errors.append(f"第 {row['row_number']} 行生成失败：{str(exc)}")

    if generated_count == 0:
        raise HTTPException(status_code=422, detail="Excel rows could not be generated")

    return ExcelBatchResponse(
        batch_id=batch_id,
        download_url=f"/api/report/batch/{batch_id}/download",
        total_rows=total_rows,
        generated_count=generated_count,
        skipped_count=skipped_count,
        errors=errors[:200],
    )


@router.post("/report/inspect-from-excel", response_model=ExcelInspectResponse)
def inspect_report_batch_from_excel(request: ExcelInspectRequest) -> ExcelInspectResponse:
    file_path = _find_uploaded_file(request.file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")
    if file_path.suffix.lower() not in {".xlsx", ".xls"}:
        raise HTTPException(status_code=400, detail="Only .xlsx/.xls are supported for batch mode")

    rows, errors = inspect_excel_records(
        file_path=file_path,
        sheet_name=request.sheet_name,
        default_template_name=request.default_template_name or "",
    )
    total_rows = len(rows)
    valid_rows = len([row for row in rows if not row.get("error")])
    skipped_rows = len(rows) - valid_rows
    records = [
        {
            "sheet_name": row.get("sheet_name", ""),
            "row_number": row.get("row_number", 0),
            "row_name": row.get("row_name", ""),
            "template_name": row.get("template_name", ""),
            "fields": row.get("fields", {}),
            "error": row.get("error", ""),
        }
        for row in rows
    ]
    return ExcelInspectResponse(
        total_rows=total_rows,
        valid_rows=valid_rows,
        skipped_rows=skipped_rows,
        errors=errors[:200],
        records=records,
    )


@router.post("/report/preview-from-excel", response_model=ExcelPreviewResponse)
def preview_report_batch_from_excel(request: ExcelPreviewRequest) -> ExcelPreviewResponse:
    file_path = _find_uploaded_file(request.file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")
    if file_path.suffix.lower() not in {".xlsx", ".xls"}:
        raise HTTPException(status_code=400, detail="Only .xlsx/.xls are supported for preview mode")

    payload = preview_excel_sheet(file_path=file_path, sheet_name=request.sheet_name)
    return ExcelPreviewResponse(
        sheet_names=payload.get("sheet_names", []),
        sheet_name=str(payload.get("sheet_name", "") or ""),
        title=str(payload.get("title", "") or ""),
        headers=payload.get("headers", []),
        rows=payload.get("rows", []),
        row_numbers=payload.get("row_numbers", []),
        total_rows=payload.get("total_rows", 0),
        truncated=bool(payload.get("truncated", False)),
    )


@router.get("/report/{report_id}/download")
def download_report(report_id: str) -> FileResponse:
    file_path = _find_report_file(report_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Report not found")
    return FileResponse(
        path=str(file_path),
        media_type=_guess_media_type(file_path),
        filename=_get_report_download_name(file_path),
    )


@router.get("/report/batch/{batch_id}/download")
def download_report_batch(batch_id: str) -> FileResponse:
    file_path = _find_report_batch_zip(batch_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Batch report not found")
    return FileResponse(
        path=str(file_path),
        media_type="application/zip",
        filename=_get_report_download_name(file_path),
    )


@router.get("/report/{report_id}/view")
def view_report(report_id: str) -> FileResponse:
    file_path = _find_report_file(report_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Report not found")
    if file_path.suffix.lower() != ".html":
        raise HTTPException(status_code=400, detail="Preview only supports html report")
    return FileResponse(path=str(file_path), media_type="text/html")


@router.get("/templates")
def list_templates() -> dict[str, list[str]]:
    return {"templates": list_available_templates()}


@router.get("/templates/download")
def download_template(template_name: str) -> FileResponse:
    template_name = normalize_legacy_template_name(template_name)
    available = set(list_available_templates())
    if template_name not in available:
        raise HTTPException(status_code=404, detail="Template not found")
    file_path = _resolve_template_file_path(template_name)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Template not found")
    return FileResponse(
        path=str(file_path),
        media_type=_guess_media_type(file_path),
        filename=file_path.name,
    )


@router.get("/templates/view")
def view_template(template_name: str) -> FileResponse:
    template_name = normalize_legacy_template_name(template_name)
    available = set(list_available_templates())
    if template_name not in available:
        raise HTTPException(status_code=404, detail="Template not found")
    file_path = _resolve_template_file_path(template_name)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Template not found")
    # Preview should not be served from the download endpoint; avoid attachment-style semantics.
    return FileResponse(
        path=str(file_path),
        media_type=_guess_media_type(file_path),
    )


@router.get("/templates/text-preview")
def preview_template_text(template_name: str) -> dict[str, object]:
    template_name = normalize_legacy_template_name(template_name)
    available = set(list_available_templates())
    if template_name not in available:
        raise HTTPException(status_code=404, detail="Template not found")
    file_path = _resolve_template_file_path(template_name)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Template not found")
    if file_path.suffix.lower() != ".docx":
        return {"template_name": template_name, "text": "", "truncated": False}

    text = _extract_docx_text(file_path)
    max_chars = 20000
    truncated = len(text) > max_chars
    if truncated:
        text = text[:max_chars]
    return {
        "template_name": template_name,
        "text": text,
        "truncated": truncated,
    }


@router.post("/templates/match", response_model=TemplateMatchResponse)
def match_templates(request: TemplateMatchRequest) -> TemplateMatchResponse:
    templates = list_available_templates()
    matched_template, matched_by = match_template_name(
        raw_text=request.raw_text,
        file_name=request.file_name,
        device_name=request.device_name or "",
        device_code=request.device_code or "",
        templates=templates,
    )
    return TemplateMatchResponse(matched_template=matched_template, matched_by=matched_by)


@router.post("/templates/feedback/correct", response_model=TemplateFeedbackResponse)
def submit_template_feedback(request: TemplateFeedbackRequest) -> TemplateFeedbackResponse:
    try:
        payload = build_template_feedback_entry(
            template_name=request.template_name,
            raw_text=request.raw_text,
            file_name=request.file_name or "",
            device_name=request.device_name or "",
            device_model=request.device_model or "",
            device_code=request.device_code or "",
            manufacturer=request.manufacturer or "",
            save_pending=bool(request.save_pending),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return TemplateFeedbackResponse(**payload)


@router.get("/templates/editor-schema")
def get_template_editor_schema(template_name: str) -> dict[str, object]:
    return {
        "template_name": template_name,
        "editor_schema": get_editor_schema(template_name),
    }


@router.get("/library")
def get_local_document_library(force_rebuild: bool = False) -> dict[str, object]:
    data = load_local_document_library(force_rebuild=force_rebuild)
    return {
        "library_file": str(LOCAL_DOCUMENT_LIBRARY_FILE),
        "data": data,
    }


@router.post("/library/rebuild")
def rebuild_document_library() -> dict[str, object]:
    data = rebuild_local_document_library()
    return {
        "library_file": str(LOCAL_DOCUMENT_LIBRARY_FILE),
        "data": data,
    }


@router.post("/templates/editor-prefill", response_model=EditorPrefillResponse)
def get_template_editor_prefill_data(request: EditorPrefillRequest) -> EditorPrefillResponse:
    source_file_path = _find_uploaded_file(request.source_file_id) if request.source_file_id else None
    fields = get_template_editor_prefill(
        template_name=request.template_name,
        context=request.fields.model_dump(),
        source_file_path=source_file_path,
    )
    return EditorPrefillResponse(fields=fields)


@router.get("/instrument-table/extract")
def extract_instrument_table(file_id: str) -> dict[str, object]:
    file_path = _find_uploaded_file(file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")
    raw_bytes = file_path.read_bytes()
    if not raw_bytes:
        return {"rows": [], "tsv": "", "total": 0}

    suffix = file_path.suffix.lower()
    effective_format = _detect_catalog_binary_format(raw_bytes) or suffix
    if effective_format == ".xlsx":
        parsed_rows = _parse_catalog_xlsx(raw_bytes)
    elif effective_format == ".csv":
        parsed_rows = _parse_catalog_csv(raw_bytes)
    elif effective_format == ".txt":
        parsed_rows = _parse_catalog_text(raw_bytes)
    elif effective_format == ".docx":
        parsed_rows = _extract_measurement_rows_from_docx(raw_bytes) or _parse_catalog_docx(raw_bytes)
    else:
        return {"rows": [], "tsv": "", "total": 0}

    rows: list[list[str]] = []
    for item in parsed_rows:
        if not isinstance(item, dict):
            continue
        name = _normalize_catalog_value(item.get("name", ""))
        model = _normalize_catalog_value(item.get("model", ""))
        code = _normalize_catalog_value(item.get("code", ""))
        measurement_range = _normalize_catalog_value(item.get("measurement_range", ""))
        uncertainty = _normalize_catalog_value(item.get("uncertainty", ""))
        cert_no = _normalize_catalog_value(item.get("certificate_no", ""))
        valid_date = _normalize_catalog_value(item.get("valid_date", ""))
        traceability = _normalize_catalog_value(item.get("traceability_institution", ""))
        cert_and_valid = " ".join([x for x in [cert_no, valid_date] if x]).strip()
        if not any([name, model, code, measurement_range, uncertainty, cert_and_valid, traceability]):
            continue
        if not _is_measurement_table_row_candidate(name, model, code, measurement_range, uncertainty, cert_and_valid, traceability):
            continue
        rows.append([name, model, code, measurement_range, uncertainty, cert_and_valid, traceability])

    if not rows:
        return {"rows": [], "tsv": "", "total": 0}
    header = ["计量标准器具名称", "型号/规格", "编号", "测量范围", "准确度/不确定度", "证书编号/有效期", "溯源机构"]
    table = [header, *rows]
    tsv = "\n".join(["\t".join(row) for row in table])
    return {"rows": rows, "tsv": tsv, "total": len(rows)}


@router.get("/report/general-check-structure")
def extract_general_check_structure(file_id: str) -> dict[str, object]:
    file_path = _find_uploaded_file(file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")
    if file_path.suffix.lower() != ".docx":
        return {"table": None}
    raw_bytes = file_path.read_bytes()
    if not raw_bytes:
        return {"table": None}
    table = _extract_general_check_structure_from_docx(raw_bytes)
    return {"table": table}


@router.get("/report/docx-embedded-inspect")
def inspect_docx_embedded_objects(file_id: str) -> dict[str, object]:
    file_path = _find_uploaded_file(file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")
    if file_path.suffix.lower() != ".docx":
        return {
            "embedded_excel_count": 0,
            "chart_count": 0,
            "chart_linked_excel_count": 0,
            "has_embedded_excel": False,
            "has_chart": False,
            "has_chart_linked_excel": False,
            "has_embedded_objects": False,
        }
    return _inspect_docx_embedded_objects(file_path)


def _find_report_file(report_id: str):
    matches = sorted(OUTPUT_DIR.glob(f"{report_id}__*"))
    if not matches:
        matches = sorted(OUTPUT_DIR.glob(f"{report_id}.*"))
    if not matches:
        return None
    return matches[0]


def _get_report_download_name(file_path: Path) -> str:
    name = file_path.name
    if "__" in name:
        _, tail = name.split("__", 1)
        if tail:
            return tail
    return name


def _find_uploaded_file(file_id: str | None) -> Path | None:
    if not file_id:
        return None
    matches = sorted(UPLOAD_DIR.glob(f"{file_id}.*"))
    return matches[0] if matches else None


def _find_report_batch_zip(batch_id: str) -> Path | None:
    matches = sorted(OUTPUT_DIR.glob(f"{batch_id}__excel_batch.zip"))
    return matches[0] if matches else None


def _guess_media_type(file_path):
    suffix = file_path.suffix.lower()
    if suffix == ".docx":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if suffix == ".html":
        return "text/html"
    if suffix == ".zip":
        return "application/zip"
    return "application/octet-stream"


def _inspect_docx_embedded_objects(file_path: Path) -> dict[str, object]:
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            names = [str(name or "") for name in zf.namelist()]
            rel_paths = [x for x in names if re.match(r"^word/charts/_rels/chart[0-9]+\.xml\.rels$", x)]
            chart_linked_excel_count = 0
            for rel_path in rel_paths:
                try:
                    rel_xml = zf.read(rel_path)
                except Exception:
                    continue
                try:
                    rel_root = ET.fromstring(rel_xml)
                except Exception:
                    continue
                for rel_node in rel_root.findall(f".//{{{REL_NS}}}Relationship"):
                    target = str(rel_node.attrib.get("Target", "") or "").strip()
                    if re.search(r"(\.\./)?embeddings/.*\.xlsx$", target, flags=re.IGNORECASE):
                        chart_linked_excel_count += 1
    except Exception:
        return {
            "embedded_excel_count": 0,
            "chart_count": 0,
            "chart_linked_excel_count": 0,
            "has_embedded_excel": False,
            "has_chart": False,
            "has_chart_linked_excel": False,
            "has_embedded_objects": False,
        }

    embedded_excel_count = len([x for x in names if re.match(r"^word/embeddings/.*\.xlsx$", x)])
    chart_count = len([x for x in names if re.match(r"^word/charts/chart[0-9]+\.xml$", x)])

    return {
        "embedded_excel_count": embedded_excel_count,
        "chart_count": chart_count,
        "chart_linked_excel_count": chart_linked_excel_count,
        "has_embedded_excel": embedded_excel_count > 0,
        "has_chart": chart_count > 0,
        "has_chart_linked_excel": chart_linked_excel_count > 0,
        "has_embedded_objects": embedded_excel_count > 0 or chart_count > 0 or chart_linked_excel_count > 0,
    }

def _build_report_validation(file_path: Path) -> ReportValidation:
    if not file_path.exists():
        return ReportValidation(ok=False)

    file_size_bytes = file_path.stat().st_size
    md5, sha256 = _calc_file_hashes(file_path)
    zip_ok = None
    missing_parts: list[str] = []

    if file_path.suffix.lower() == ".docx":
        zip_ok, missing_parts = _check_docx_package(file_path)
        ok = file_size_bytes > 0 and bool(zip_ok) and not missing_parts
    else:
        ok = file_size_bytes > 0

    return ReportValidation(
        ok=ok,
        file_size_bytes=file_size_bytes,
        md5=md5,
        sha256=sha256,
        zip_ok=zip_ok,
        missing_parts=missing_parts,
    )


def _extract_docx_text(file_path: Path) -> str:
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            xml_bytes = zf.read("word/document.xml")
    except Exception:
        return ""
    try:
        root = ET.fromstring(xml_bytes)
    except Exception:
        return ""

    paragraphs: list[str] = []
    for p in root.findall(".//{*}p"):
        chunks: list[str] = []
        for t in p.findall(".//{*}t"):
            if t.text:
                chunks.append(t.text)
        line = "".join(chunks).strip()
        if line:
            paragraphs.append(line)
    return "\n".join(paragraphs)


def _calc_file_hashes(file_path: Path) -> tuple[str, str]:
    md5 = hashlib.md5()
    sha256 = hashlib.sha256()
    with file_path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            md5.update(chunk)
            sha256.update(chunk)
    return md5.hexdigest(), sha256.hexdigest()


def _check_docx_package(file_path: Path) -> tuple[bool, list[str]]:
    required_parts = [
        "[Content_Types].xml",
        "_rels/.rels",
        "word/document.xml",
        "docProps/core.xml",
    ]
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            bad_entry = zf.testzip()
            if bad_entry:
                return False, required_parts
            names = set(zf.namelist())
    except Exception:
        return False, required_parts

    missing_parts = [part for part in required_parts if part not in names]
    return True, missing_parts
