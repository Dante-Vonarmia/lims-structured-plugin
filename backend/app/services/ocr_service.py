import os
import base64
import posixpath
import re
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path
import zipfile
from xml.etree import ElementTree as ET

from ..utils.text_normalizer import normalize_text, split_lines

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff", ".heic", ".heif"}
DOCX_SUFFIXES = {".docx"}
DOC_XML_PATH = "word/document.xml"
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
DRAWING_NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
VML_NS = {"v": "urn:schemas-microsoft-com:vml"}
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
DOC_XML_RELS_PATH = "word/_rels/document.xml.rels"
DOCX_INLINE_IMAGE_TOKEN_PREFIX = "[[DOCX_IMG|"
DOCX_INLINE_IMAGE_TOKEN_SUFFIX = "]]"
MAX_DOCX_INLINE_IMAGES = 256
MAX_DOCX_INLINE_IMAGE_BYTES = 50 * 1024 * 1024
DOCX_LABEL_KEYWORDS = (
    "器具名称",
    "设备名称",
    "仪器名称",
    "instrument name",
    "型号",
    "规格",
    "model",
    "器具编号",
    "设备编号",
    "编号",
    "serial",
    "manufacturer",
    "生产厂商",
    "制造厂商",
    "委托单位",
    "client",
    "单位名称",
    "地址",
    "address",
    "联系方式",
    "电话",
    "contact",
    "收样日期",
    "校准日期",
    "地点",
    "温度",
    "湿度",
)
DOCX_PLACEHOLDER_TOKENS = {
    "instrumentname",
    "devicename",
    "equipmentname",
    "modelspecification",
    "instrumentserialnumber",
    "serialnumber",
    "型号规格",
    "型号编号",
    "器具名称",
    "设备名称",
    "仪器名称",
}
ROTATION_HINT_PATTERNS = (
    r"型号",
    r"编号",
    r"输入电压",
    r"输出电压",
    r"输入电流",
    r"输出电流",
    r"频率",
    r"生产日期",
    r"使用条件",
    r"局部放电",
    r"局放仪",
    r"有限公司",
    r"Type",
    r"model",
    r"Input",
    r"Output",
    r"Rated power",
    r"Date of manufacture",
    r"PD meter",
    r"Frequency",
    r"Number",
)


def recognize_file(file_path: Path) -> tuple[str, list[str], str, dict[str, object]]:
    suffix = file_path.suffix.lower()

    if suffix in IMAGE_SUFFIXES:
        return _recognize_image(file_path)

    if suffix == ".pdf":
        return _recognize_pdf(file_path)

    if suffix in DOCX_SUFFIXES:
        return _recognize_docx(file_path)

    raise ValueError(f"Unsupported file type: {suffix}")


def _recognize_image(file_path: Path) -> tuple[str, list[str], str, dict[str, object]]:
    prepared_path, cleanup_path = _prepare_image_file(file_path)
    try:
        for engine in (_ocr_by_paddle, _ocr_by_rapid, _ocr_by_tesseract):
            try:
                text = engine(prepared_path)
                normalized = normalize_text(text)
                lines = split_lines(normalized)
                if normalized:
                    return normalized, lines, engine.__name__.replace("_ocr_by_", ""), {}
            except Exception:
                continue
        return "", [], "none", {}
    finally:
        if cleanup_path:
            cleanup_path.unlink(missing_ok=True)


def _recognize_pdf(file_path: Path) -> tuple[str, list[str], str, dict[str, object]]:
    # First try extracting embedded text from digital PDF.
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(file_path))
        text_parts = []
        for page in reader.pages:
            text_parts.append(page.extract_text() or "")
        text = normalize_text("\n".join(text_parts))
        lines = split_lines(text)
        if text:
            return text, lines, "pypdf", {}
    except Exception:
        pass

    # Fallback to OCRmyPDF sidecar text if available.
    sidecar_fd, sidecar_path = tempfile.mkstemp(suffix=".txt")
    output_fd, output_path = tempfile.mkstemp(suffix=".pdf")
    os.close(sidecar_fd)
    os.close(output_fd)
    Path(sidecar_path).unlink(missing_ok=True)
    Path(output_path).unlink(missing_ok=True)

    try:
        cmd = [
            "ocrmypdf",
            "--force-ocr",
            "--skip-text",
            "--sidecar",
            sidecar_path,
            str(file_path),
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode == 0 and Path(sidecar_path).exists():
            text = normalize_text(Path(sidecar_path).read_text(encoding="utf-8", errors="ignore"))
            lines = split_lines(text)
            if text:
                return text, lines, "ocrmypdf", {}
    except Exception:
        pass
    finally:
        Path(sidecar_path).unlink(missing_ok=True)
        Path(output_path).unlink(missing_ok=True)

    return "", [], "none", {}


def _recognize_docx(file_path: Path) -> tuple[str, list[str], str, dict[str, object]]:
    text = _extract_docx_text(file_path)
    normalized = normalize_text(text)
    lines = split_lines(normalized)
    return normalized, lines, "docx", {}


def _extract_docx_text(file_path: Path) -> str:
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            xml_data = zf.read(DOC_XML_PATH)
            image_tokens = _load_docx_inline_image_tokens(zf)
    except Exception:
        return ""

    try:
        root = ET.fromstring(xml_data)
    except Exception:
        return ""

    lines: list[str] = []

    for tbl in root.findall(".//w:tbl", NS):
        for tr in tbl.findall("./w:tr", NS):
            cells = [_extract_docx_cell_content(tc, image_tokens) for tc in tr.findall("./w:tc", NS)]
            cells = [cell for cell in cells if cell]
            if len(cells) < 2:
                continue
            pair = _extract_docx_key_value(cells)
            if pair:
                lines.append(f"{pair[0]}: {pair[1]}")

    for paragraph in root.findall(".//w:p", NS):
        line = _extract_docx_paragraph_content(paragraph, image_tokens)
        if line and not _is_docx_placeholder_text(line):
            lines.append(line)

    return "\n".join([line for line in lines if _normalize_docx_token(line)])


def _normalize_docx_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\u3000", " ")).strip()


def _build_docx_inline_image_token(data_url: str) -> str:
    return f"{DOCX_INLINE_IMAGE_TOKEN_PREFIX}{data_url}{DOCX_INLINE_IMAGE_TOKEN_SUFFIX}"


def _guess_image_mime_by_path(path: str) -> str:
    suffix = Path(path).suffix.lower()
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
    if suffix == ".gif":
        return "image/gif"
    if suffix == ".svg":
        return "image/svg+xml"
    return "image/png"


def _resolve_docx_rel_target(target: str) -> str:
    text = str(target or "").strip()
    if not text:
        return ""
    if text.startswith("/"):
        return text.lstrip("/")
    return posixpath.normpath(posixpath.join("word", text))


def _load_docx_inline_image_tokens(zf: zipfile.ZipFile) -> dict[str, str]:
    try:
        rel_xml = zf.read(DOC_XML_RELS_PATH)
    except Exception:
        return {}
    try:
        rel_root = ET.fromstring(rel_xml)
    except Exception:
        return {}

    tokens: dict[str, str] = {}
    count = 0
    for rel in rel_root.findall(f".//{{{REL_NS}}}Relationship"):
        rel_type = str(rel.attrib.get("Type", "")).strip().lower()
        if not rel_type.endswith("/image"):
            continue
        rel_id = str(rel.attrib.get("Id", "")).strip()
        target = _resolve_docx_rel_target(str(rel.attrib.get("Target", "")))
        if not rel_id or not target:
            continue
        try:
            raw = zf.read(target)
        except Exception:
            continue
        if not raw:
            continue
        if len(raw) > MAX_DOCX_INLINE_IMAGE_BYTES:
            tokens[rel_id] = "[图片]"
            continue
        if count >= MAX_DOCX_INLINE_IMAGES:
            tokens[rel_id] = "[图片]"
            continue
        mime = _guess_image_mime_by_path(target)
        encoded = base64.b64encode(raw).decode("ascii")
        tokens[rel_id] = _build_docx_inline_image_token(f"data:{mime};base64,{encoded}")
        count += 1
    return tokens


def _extract_docx_drawing_tokens(node: ET.Element, image_tokens: dict[str, str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for blip in node.findall(".//a:blip", DRAWING_NS):
        embed = str(blip.attrib.get(f"{{{R_NS}}}embed", "")).strip()
        if not embed or embed in seen:
            continue
        seen.add(embed)
        result.append(image_tokens.get(embed, "[图片]"))
    for imagedata in node.findall(".//v:imagedata", VML_NS):
        rel_id = str(imagedata.attrib.get(f"{{{R_NS}}}id", "")).strip()
        if not rel_id or rel_id in seen:
            continue
        seen.add(rel_id)
        result.append(image_tokens.get(rel_id, "[图片]"))
    return result


def _extract_docx_cell_content(tc: ET.Element, image_tokens: dict[str, str]) -> str:
    text = _normalize_docx_space("".join([(node.text or "") for node in tc.findall(".//{*}t")]))
    image_parts = _extract_docx_drawing_tokens(tc, image_tokens)
    if text and image_parts:
        return f"{text} {' '.join(image_parts)}".strip()
    if image_parts:
        return " ".join(image_parts).strip()
    return text


def _extract_docx_paragraph_content(paragraph: ET.Element, image_tokens: dict[str, str]) -> str:
    text = _normalize_docx_space("".join([(node.text or "") for node in paragraph.findall(".//{*}t")]))
    image_parts = _extract_docx_drawing_tokens(paragraph, image_tokens)
    if text and image_parts:
        return f"{text} {' '.join(image_parts)}".strip()
    if image_parts:
        return " ".join(image_parts).strip()
    return text


def _normalize_docx_token(value: str) -> str:
    return re.sub(r"[\s:：/\\\-_.|*（）()]+", "", (value or "").strip()).lower()


def _is_docx_placeholder_text(value: str) -> bool:
    token = _normalize_docx_token(value)
    if not token:
        return False
    if token in DOCX_PLACEHOLDER_TOKENS:
        return True
    return any(marker in token for marker in ("instrumentname", "modelspecification", "instrumentserialnumber"))


def _looks_like_docx_label(value: str) -> bool:
    text = _normalize_docx_space(value)
    if not text:
        return False
    token = _normalize_docx_token(text)
    if not token:
        return False
    if token in DOCX_PLACEHOLDER_TOKENS:
        return True
    lower_text = text.lower()
    if any(keyword in lower_text for keyword in DOCX_LABEL_KEYWORDS):
        return True
    return False


def _normalize_docx_label(value: str) -> str:
    text = _normalize_docx_space(value)
    text = re.sub(r"[：:]\s*$", "", text)
    parts = [part.strip() for part in re.split(r"[:：]+", text) if part.strip()]
    if len(parts) >= 2 and _looks_like_chinese_label(parts[0]) and _looks_like_english_label(parts[1]):
        text = parts[0]
    else:
        mixed = re.match(r"^([\u4e00-\u9fff\s/（）()]+?)([A-Za-z][A-Za-z0-9\s/()._-]*)$", text)
        if mixed and _looks_like_chinese_label(mixed.group(1)) and _looks_like_english_label(mixed.group(2)):
            text = mixed.group(1).strip()
    text = re.sub(r"[：:]\s*$", "", text)
    return text


def _extract_docx_key_value(cells: list[str]) -> tuple[str, str] | None:
    for idx, cell in enumerate(cells[:-1]):
        if not _looks_like_docx_label(cell):
            continue
        for candidate in cells[idx + 1 :]:
            value = _normalize_docx_space(candidate)
            if not value:
                continue
            if _looks_like_docx_label(value) or _is_docx_placeholder_text(value):
                continue
            return _normalize_docx_label(cell), value
    return None


def _looks_like_chinese_label(value: str) -> bool:
    text = _normalize_docx_space(value)
    if not text:
        return False
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def _looks_like_english_label(value: str) -> bool:
    text = _normalize_docx_space(value)
    if not text:
        return False
    if not re.search(r"[A-Za-z]", text):
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9\s/().,_-]{2,80}", text))


@lru_cache(maxsize=1)
def _build_paddle_ocr():
    from paddleocr import PaddleOCR

    return PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)


def _ocr_by_paddle(file_path: Path) -> str:
    ocr = _build_paddle_ocr()
    result = ocr.ocr(str(file_path), cls=True)
    boxes: list[dict[str, float | str]] = []
    for block in result or []:
        for item in block or []:
            if len(item) < 2 or not item[1]:
                continue
            text = item[1][0]
            if not text:
                continue
            metrics = _extract_box_metrics(item[0], str(text).strip())
            if metrics:
                boxes.append(metrics)
    if not boxes:
        return ""
    boxes.sort(key=lambda x: (float(x["cy"]), float(x["cx"])))
    lines: list[str] = []
    line_buffer: list[dict[str, float | str]] = []
    baseline = 0.0
    threshold = 12.0
    for box in boxes:
        cy = float(box["cy"])
        height = float(box["h"])
        dynamic_threshold = max(10.0, min(28.0, height * 0.9))
        if not line_buffer:
            line_buffer = [box]
            baseline = cy
            threshold = dynamic_threshold
            continue
        if abs(cy - baseline) <= max(threshold, dynamic_threshold):
            line_buffer.append(box)
            baseline = (baseline * (len(line_buffer) - 1) + cy) / len(line_buffer)
            threshold = max(threshold, dynamic_threshold)
            continue
        lines.append(_join_paddle_line(line_buffer))
        line_buffer = [box]
        baseline = cy
        threshold = dynamic_threshold
    if line_buffer:
        lines.append(_join_paddle_line(line_buffer))
    return "\n".join(lines)


def _ocr_by_tesseract(file_path: Path) -> str:
    from PIL import Image

    _enable_heif_support()
    image = Image.open(file_path).convert("RGB")
    text_psm6 = _tesseract_image_to_string(image, config="--psm 6")
    text_psm11 = _tesseract_image_to_string(image, config="--psm 11")
    candidates = [text for text in (text_psm6, text_psm11) if text and text.strip()]
    if not candidates:
        return ""
    return max(candidates, key=_score_ocr_text)


@lru_cache(maxsize=1)
def _build_rapid_ocr():
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR()


def _ocr_by_rapid(file_path: Path) -> str:
    ocr = _build_rapid_ocr()
    result, _ = ocr(str(file_path))
    if not result:
        return ""
    boxes: list[dict[str, float | str]] = []
    for item in result:
        if not item or len(item) < 2:
            continue
        points = item[0]
        text = item[1]
        text_value = text[0] if isinstance(text, (list, tuple)) and text else text
        text_value = str(text_value or "").strip()
        if not text_value:
            continue
        metrics = _extract_box_metrics(points, text_value)
        if metrics:
            boxes.append(metrics)
    if not boxes:
        return ""
    boxes.sort(key=lambda x: (float(x["cy"]), float(x["cx"])))
    lines: list[str] = []
    line_buffer: list[dict[str, float | str]] = []
    baseline = 0.0
    threshold = 12.0
    for box in boxes:
        cy = float(box["cy"])
        height = float(box["h"])
        dynamic_threshold = max(10.0, min(28.0, height * 0.9))
        if not line_buffer:
            line_buffer = [box]
            baseline = cy
            threshold = dynamic_threshold
            continue
        if abs(cy - baseline) <= max(threshold, dynamic_threshold):
            line_buffer.append(box)
            baseline = (baseline * (len(line_buffer) - 1) + cy) / len(line_buffer)
            threshold = max(threshold, dynamic_threshold)
            continue
        lines.append(_join_paddle_line(line_buffer))
        line_buffer = [box]
        baseline = cy
        threshold = dynamic_threshold
    if line_buffer:
        lines.append(_join_paddle_line(line_buffer))
    return "\n".join(lines)


def _prepare_image_file(file_path: Path) -> tuple[Path, Path | None]:
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps

    _enable_heif_support()
    try:
        with Image.open(file_path) as raw_image:
            image = ImageOps.exif_transpose(raw_image).convert("RGB")
    except Exception:
        return file_path, None

    image = _try_perspective_correction(image)
    image = _enhance_for_ocr(image, ImageEnhance, ImageFilter, ImageOps)
    rotation = _detect_best_rotation(image)
    if rotation:
        image = image.rotate(rotation, expand=True, fillcolor="white")

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
        prepared_path = Path(temp_file.name)
    image.save(prepared_path, format="PNG")
    return prepared_path, prepared_path


def _detect_best_rotation(image) -> int:
    best_angle = 0
    best_score = -1
    for angle in (0, 90, 180, 270):
        rotated = image if angle == 0 else image.rotate(angle, expand=True, fillcolor="white")
        try:
            text = _tesseract_image_to_string(rotated, config="--psm 6")
        except Exception:
            continue
        score = _score_ocr_text(text)
        if score > best_score:
            best_score = score
            best_angle = angle
    return best_angle


def _score_ocr_text(text: str) -> int:
    normalized = normalize_text(text)
    score = 0
    lower = normalized.lower()
    for char in normalized:
        if "\u4e00" <= char <= "\u9fff":
            score += 3
        elif char.isdigit() or ("a" <= char.lower() <= "z"):
            score += 2
        elif char in "/-_.:()":
            score += 1
    for pattern in ROTATION_HINT_PATTERNS:
        if re.search(pattern, normalized, flags=re.IGNORECASE):
            score += 24
    line_count = len([x for x in normalized.split("\n") if x.strip()])
    score += min(line_count, 30) * 3
    if " kV" in normalized or "kVA" in normalized or " hz" in lower:
        score += 30
    gibberish = re.findall(r"[A-Za-z]{5,}", normalized)
    if gibberish and line_count <= 2:
        score -= 20
    return score


@lru_cache(maxsize=1)
def _tesseract_lang_candidates() -> tuple[str, ...]:
    import pytesseract

    try:
        available = set(pytesseract.get_languages(config=""))
    except Exception:
        return ("chi_sim+eng", "eng")
    candidates: list[str] = []
    if "chi_sim" in available and "eng" in available:
        candidates.append("chi_sim+eng")
    if "chi_sim" in available:
        candidates.append("chi_sim")
    if "eng" in available:
        candidates.append("eng")
    if not candidates:
        candidates.append("eng")
    return tuple(dict.fromkeys(candidates))


def _tesseract_image_to_string(image, config: str = "--psm 6") -> str:
    import pytesseract

    texts: list[str] = []
    for lang in _tesseract_lang_candidates():
        try:
            text = pytesseract.image_to_string(image, lang=lang, config=config)
        except Exception:
            continue
        if text and text.strip():
            texts.append(text)
    if not texts:
        return ""
    if len(texts) == 1:
        return texts[0]
    best = max(texts, key=_score_ocr_text)
    return best


def _enhance_for_ocr(image, image_enhance, image_filter, image_ops):
    gray = image_ops.grayscale(image)
    gray = image_ops.autocontrast(gray, cutoff=1)
    gray = image_enhance.Contrast(gray).enhance(1.35)
    gray = gray.filter(image_filter.MedianFilter(size=3))
    return gray.convert("RGB")


def _extract_box_metrics(points, text: str) -> dict[str, float | str] | None:
    try:
        xs = [float(pt[0]) for pt in points]
        ys = [float(pt[1]) for pt in points]
    except Exception:
        return None
    if not xs or not ys:
        return None
    x_min = min(xs)
    x_max = max(xs)
    y_min = min(ys)
    y_max = max(ys)
    return {
        "text": text,
        "cx": (x_min + x_max) / 2.0,
        "cy": (y_min + y_max) / 2.0,
        "h": max(8.0, y_max - y_min),
        "x": x_min,
    }


def _join_paddle_line(buffer: list[dict[str, float | str]]) -> str:
    sorted_items = sorted(buffer, key=lambda x: float(x["x"]))
    return " ".join([str(item["text"]).strip() for item in sorted_items if str(item["text"]).strip()]).strip()


def _try_perspective_correction(image):
    try:
        import cv2
        import numpy as np
        from PIL import Image
    except Exception:
        return image

    rgb = np.array(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    kernel = np.ones((5, 5), np.uint8)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours_info = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = contours_info[0] if len(contours_info) == 2 else contours_info[1]
    image_area = gray.shape[0] * gray.shape[1]
    best_quad = None
    best_area = 0.0

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < image_area * 0.12 or area > image_area * 0.98:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) != 4:
            continue
        if area > best_area:
            best_area = area
            best_quad = approx.reshape(4, 2).astype("float32")

    if best_quad is None:
        return image

    quad = _order_quad_points(best_quad)
    top_left, top_right, bottom_right, bottom_left = quad
    target_width = int(max(np.linalg.norm(bottom_right - bottom_left), np.linalg.norm(top_right - top_left)))
    target_height = int(max(np.linalg.norm(top_right - bottom_right), np.linalg.norm(top_left - bottom_left)))

    if target_width < 50 or target_height < 50:
        return image

    destination = np.array(
        [
            [0, 0],
            [target_width - 1, 0],
            [target_width - 1, target_height - 1],
            [0, target_height - 1],
        ],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(quad, destination)
    warped = cv2.warpPerspective(rgb, matrix, (target_width, target_height))
    return Image.fromarray(warped)


def _order_quad_points(points):
    import numpy as np

    ordered = np.zeros((4, 2), dtype="float32")
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1)

    ordered[0] = points[np.argmin(sums)]
    ordered[2] = points[np.argmax(sums)]
    ordered[1] = points[np.argmin(diffs)]
    ordered[3] = points[np.argmax(diffs)]
    return ordered


def _enable_heif_support() -> None:
    try:
        import pillow_heif

        pillow_heif.register_heif_opener()
    except Exception:
        pass
