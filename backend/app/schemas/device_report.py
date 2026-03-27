from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class UploadResponse(BaseModel):
    file_id: str
    file_name: str
    file_path: str


class OCRRequest(BaseModel):
    file_id: str


class OCRResponse(BaseModel):
    file_id: str
    raw_text: str
    lines: list[str]
    engine: str


class ExtractRequest(BaseModel):
    raw_text: str


class DeviceFields(BaseModel):
    model_config = ConfigDict(extra="allow")

    device_name: Optional[str] = Field(default="")
    device_model: Optional[str] = Field(default="")
    device_code: Optional[str] = Field(default="")
    manufacturer: Optional[str] = Field(default="")
    certificate_no: Optional[str] = Field(default="")
    client_name: Optional[str] = Field(default="")
    receive_date: Optional[str] = Field(default="")
    calibration_date: Optional[str] = Field(default="")
    location: Optional[str] = Field(default="")
    temperature: Optional[str] = Field(default="")
    humidity: Optional[str] = Field(default="")
    section2_u_mm: Optional[str] = Field(default="")
    section2_value_mm: Optional[str] = Field(default="")
    section3_u_g: Optional[str] = Field(default="")
    section3_value_g: Optional[str] = Field(default="")
    section4_u_g: Optional[str] = Field(default="")
    hammer_actual_row_1: Optional[str] = Field(default="")
    hammer_actual_row_2: Optional[str] = Field(default="")
    hammer_actual_row_3: Optional[str] = Field(default="")
    raw_record: Optional[str] = Field(default="")


class ReportRequest(BaseModel):
    template_name: str = "局放报告.html"
    fields: DeviceFields
    source_file_id: Optional[str] = None


class ReportValidation(BaseModel):
    ok: bool = True
    file_size_bytes: int = 0
    md5: str = ""
    sha256: str = ""
    zip_ok: Optional[bool] = None
    missing_parts: list[str] = Field(default_factory=list)


class ReportResponse(BaseModel):
    report_id: str
    download_url: str
    preview_url: Optional[str] = None
    output_format: str = "docx"
    validation: Optional[ReportValidation] = None


class ExcelBatchRequest(BaseModel):
    file_id: str
    sheet_name: Optional[str] = None
    default_template_name: Optional[str] = None


class ExcelBatchResponse(BaseModel):
    batch_id: str
    download_url: str
    total_rows: int = 0
    generated_count: int = 0
    skipped_count: int = 0
    errors: list[str] = Field(default_factory=list)


class ExcelInspectRequest(BaseModel):
    file_id: str
    sheet_name: Optional[str] = None
    default_template_name: Optional[str] = None


class ExcelInspectResponse(BaseModel):
    total_rows: int = 0
    valid_rows: int = 0
    skipped_rows: int = 0
    errors: list[str] = Field(default_factory=list)
    records: list[dict[str, object]] = Field(default_factory=list)


class ExcelPreviewRequest(BaseModel):
    file_id: str
    sheet_name: Optional[str] = None


class ExcelPreviewResponse(BaseModel):
    sheet_names: list[str] = Field(default_factory=list)
    sheet_name: str = ""
    title: str = ""
    headers: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)
    row_numbers: list[int] = Field(default_factory=list)
    total_rows: int = 0
    truncated: bool = False


class TemplateMatchRequest(BaseModel):
    raw_text: str = ""
    file_name: Optional[str] = None


class TemplateMatchResponse(BaseModel):
    matched_template: Optional[str] = None
    matched_by: Optional[str] = None


class EditorPrefillRequest(BaseModel):
    template_name: str
    fields: DeviceFields
    source_file_id: Optional[str] = None


class EditorPrefillResponse(BaseModel):
    fields: dict[str, str]


class InstrumentCatalogParseResponse(BaseModel):
    rows: list[dict[str, str]] = Field(default_factory=list)
    names: list[str] = Field(default_factory=list)
    total: int = 0
