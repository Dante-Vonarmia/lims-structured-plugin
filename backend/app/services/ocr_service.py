import os
import base64
import json
import posixpath
import re
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path
import zipfile
from xml.etree import ElementTree as ET

from ..config import OUTPUT_DIR
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
OCR_PREP_MODE = str(os.getenv("OCR_PREP_MODE", "fast") or "fast").strip().lower()
OCR_ENGINE_ORDER = str(os.getenv("OCR_ENGINE_ORDER", "rapid,paddle,tesseract") or "rapid,paddle,tesseract").strip().lower()
OCR_MIN_TEXT_FOR_EARLY_RETURN = int(str(os.getenv("OCR_MIN_TEXT_FOR_EARLY_RETURN", "40") or "40").strip() or 40)
OCR_MIN_LINES_FOR_EARLY_RETURN = int(str(os.getenv("OCR_MIN_LINES_FOR_EARLY_RETURN", "4") or "4").strip() or 4)
TABLE_BODY_ROW_RE = re.compile(r"^\s*\d{1,2}\s*[./-]\s*\d{1,2}\b")
TABLE_REVIEW_THRESHOLD = 0.85
TABLE_REVIEW_THRESHOLD_CRITICAL = 0.92
TABLE_COL_KEYS = tuple([f"col_{i:02d}" for i in range(1, 38)])
TABLE_COL_LABELS = (
    "检验日期",
    "产权代码编号",
    "充装介质",
    "制造单位代码",
    "出厂编号",
    "水压试验压力MPa",
    "公称工作压力MPa",
    "公称瓶重kg",
    "公称容积L",
    "设计壁厚mm",
    "制造年月",
    "上次检验日期",
    "余气处理",
    "外观清理检查",
    "音响检查",
    "内表面检查",
    "瓶口螺纹检查",
    "实际重量kg",
    "重量损失率%",
    "实际容积L",
    "容积增大率%",
    "试验压力MPa",
    "保压时间min",
    "残余变形值mL",
    "容积全变形值mL",
    "残余变形率%",
    "内部干燥",
    "试验结论",
    "瓶阀检验",
    "试验压力MPa_2",
    "保压时间min_2",
    "试验结论_2",
    "评定结论",
    "下次检验日期",
    "检验员",
    "审核员",
    "备注",
)
TABLE_MEDIUM_DICT = ("Ar", "O2", "N2", "CO2")
TABLE_UNIT_CODE_DICT = ("GZ", "YM", "FC", "JP")
TABLE_ANCHOR_KEYWORDS = {
    0: ("检验日期",),
    2: ("充装介质",),
    3: ("制造单位代码",),
    4: ("出厂编号",),
    5: ("水压试验压力", "试验压力mpa"),
    6: ("公称工作压力",),
    8: ("公称容积",),
    17: ("实际重量",),
    19: ("实际容积",),
    22: ("保压时间",),
    25: ("残余变形率",),
    28: ("瓶阀检验",),
    32: ("评定结论",),
    33: ("下次检验日期",),
}
TABLE_DEFAULT_COL_WIDTH_RATIOS = tuple([1.0] * len(TABLE_COL_KEYS))
TABLE_CALIBRATION_FILE = OUTPUT_DIR / "cylinder_table_calibration.json"
TABLE_SECOND_PASS_ENGINES = tuple(
    [x.strip().lower() for x in str(os.getenv("TABLE_SECOND_PASS_ENGINES", "rapid,tesseract") or "rapid,tesseract").split(",") if x.strip()]
)


def _normalize_cell_text(value: str) -> str:
    text = normalize_text(value or "")
    text = re.sub(r"\s+", "", text)
    return text.strip()


def _to_table_col_key(index: int) -> str:
    if index < 0:
        return "col_00"
    return f"col_{index + 1:02d}"


def _to_table_col_label(index: int) -> str:
    if 0 <= index < len(TABLE_COL_LABELS):
        return TABLE_COL_LABELS[index]
    return _to_table_col_key(index)


def _is_table_checkbox_column(col_index: int) -> bool:
    return col_index in {12, 13, 14, 15, 16, 26, 27, 28, 31, 32}


def _is_table_critical_column(col_index: int) -> bool:
    return col_index in {0, 2, 3, 4, 5, 6, 8, 17, 19, 25, 27, 32, 33}


def _recognize_cylinder_table(file_path: Path) -> dict[str, object]:
    grid_payload = _detect_table_grid(file_path)
    if not grid_payload:
        return {}

    x_lines = grid_payload.get("x_lines", [])
    y_lines = grid_payload.get("y_lines", [])
    image = grid_payload.get("image")
    if not isinstance(x_lines, list) or not isinstance(y_lines, list) or image is None:
        return {}
    if len(x_lines) < 8 or len(y_lines) < 4:
        return {}

    col_count = min(len(x_lines) - 1, len(TABLE_COL_KEYS))
    row_start = 2 if len(y_lines) > 3 else 1
    table_cells: list[dict[str, object]] = []
    row_records: list[dict[str, object]] = []
    review_queue: list[dict[str, object]] = []

    for row_index in range(row_start, len(y_lines) - 1):
        fields: dict[str, str] = {}
        row_line_texts: list[str] = []
        has_any_value = False
        for col_index in range(col_count):
            x0, x1 = int(x_lines[col_index]), int(x_lines[col_index + 1])
            y0, y1 = int(y_lines[row_index]), int(y_lines[row_index + 1])
            if x1 - x0 <= 4 or y1 - y0 <= 4:
                continue
            crop = image[y0:y1, x0:x1]
            cell_payload = _recognize_table_cell(crop, col_index)
            key = _to_table_col_key(col_index)
            label = _to_table_col_label(col_index)
            final_text = str(cell_payload.get("final_text", "")).strip()
            raw_text = str(cell_payload.get("raw_text", "")).strip()
            confidence = float(cell_payload.get("confidence", 0.0) or 0.0)
            preprocess_id = str(cell_payload.get("preprocess_id", "p0"))
            bbox = [x0, y0, x1, y1]
            table_cells.append(
                {
                    "row": row_index - row_start + 1,
                    "col": col_index + 1,
                    "column_key": key,
                    "column_label": label,
                    "raw_text": raw_text,
                    "final_text": final_text,
                    "confidence": round(confidence, 4),
                    "bbox": bbox,
                    "preprocess_id": preprocess_id,
                }
            )
            fields[key] = final_text
            fields[label] = final_text
            if final_text:
                has_any_value = True
                row_line_texts.append(final_text)
            threshold = TABLE_REVIEW_THRESHOLD_CRITICAL if _is_table_critical_column(col_index) else TABLE_REVIEW_THRESHOLD
            if confidence < threshold:
                review_queue.append(
                    {
                        "row": row_index - row_start + 1,
                        "col": col_index + 1,
                        "column_key": key,
                        "column_label": label,
                        "reason": "low_confidence",
                        "confidence": round(confidence, 4),
                    }
                )
            if not final_text and _is_table_critical_column(col_index):
                review_queue.append(
                    {
                        "row": row_index - row_start + 1,
                        "col": col_index + 1,
                        "column_key": key,
                        "column_label": label,
                        "reason": "empty_critical",
                        "confidence": round(confidence, 4),
                    }
                )
        if not has_any_value:
            continue
        raw_record = " ".join(row_line_texts).strip()
        fields["raw_record"] = raw_record
        row_records.append(
            {
                "row": row_index - row_start + 1,
                "fields": fields,
                "raw_record": raw_record,
            }
        )

    row_review = _check_table_row_consistency(row_records)
    if row_review:
        review_queue.extend(row_review)

    quality = _evaluate_table_quality(table_cells, row_records, review_queue)
    if not quality.get("ok", False):
        return {}

    return {
        "table_cells": table_cells,
        "row_records": row_records,
        "review_queue": review_queue,
        "quality": quality,
    }


def _recognize_table_cell(crop, col_index: int) -> dict[str, object]:
    if crop is None:
        return {"raw_text": "", "final_text": "", "confidence": 0.0, "preprocess_id": "p0"}
    if _is_table_checkbox_column(col_index):
        checked, score = _detect_check_mark(crop)
        return {
            "raw_text": "√" if checked else "",
            "final_text": "√" if checked else "",
            "confidence": score,
            "preprocess_id": "shape",
        }
    ocr_candidates = _read_cell_with_retries(crop, col_index)
    best = {"raw_text": "", "final_text": "", "confidence": 0.0, "preprocess_id": "p0"}
    for candidate in ocr_candidates:
        raw_text = str(candidate.get("text", "")).strip()
        score = float(candidate.get("confidence", 0.0) or 0.0)
        preprocess_id = str(candidate.get("preprocess_id", "p0"))
        fixed_text, fixed_score = _apply_column_rules(raw_text, col_index)
        final_score = max(0.0, min(0.99, score * fixed_score))
        if final_score >= float(best.get("confidence", 0.0) or 0.0):
            best = {
                "raw_text": raw_text,
                "final_text": fixed_text,
                "confidence": final_score,
                "preprocess_id": preprocess_id,
            }
    if _is_table_critical_column(col_index) and float(best.get("confidence", 0.0) or 0.0) < TABLE_REVIEW_THRESHOLD_CRITICAL:
        voted = _second_pass_critical_cell_vote(crop, col_index, best)
        if voted and float(voted.get("confidence", 0.0) or 0.0) >= float(best.get("confidence", 0.0) or 0.0):
            best = voted
    return best


def _read_cell_with_retries(crop, col_index: int) -> list[dict[str, object]]:
    from PIL import Image
    import numpy as np
    import cv2
    import pytesseract

    gray = crop if len(getattr(crop, "shape", [])) == 2 else cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    prep_variants = [
        ("p0", gray),
        ("p1", cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]),
        ("p2", cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 8)),
    ]

    whitelist = _column_whitelist(col_index)
    candidates: list[dict[str, object]] = []
    for preprocess_id, image_arr in prep_variants:
        pil_image = Image.fromarray(image_arr.astype(np.uint8))
        config = "--psm 7"
        if whitelist:
            config = f"{config} -c tessedit_char_whitelist={whitelist}"
        text = _tesseract_image_to_string(pil_image, config=config)
        conf = 0.0
        try:
            data = pytesseract.image_to_data(pil_image, output_type=pytesseract.Output.DICT, config=config)
            conf_values = [float(x) for x in data.get("conf", []) if str(x).strip() not in {"", "-1"}]
            if conf_values:
                conf = max(0.0, min(0.99, sum(conf_values) / len(conf_values) / 100.0))
        except Exception:
            conf = 0.0
        candidates.append({"text": _normalize_cell_text(text), "confidence": conf, "preprocess_id": preprocess_id})
    return candidates


def _second_pass_critical_cell_vote(crop, col_index: int, fallback: dict[str, object]) -> dict[str, object]:
    variants = _build_superres_variants(crop)
    if not variants:
        return fallback
    engines = [x for x in TABLE_SECOND_PASS_ENGINES if x in {"rapid", "paddle", "tesseract"}]
    if not engines:
        engines = ["rapid", "tesseract"]
    votes: dict[str, dict[str, object]] = {}
    for preprocess_id, variant in variants:
        for engine_name in engines:
            candidate = _ocr_cell_by_engine(variant, col_index, engine_name, preprocess_id)
            raw_text = str(candidate.get("raw_text", "")).strip()
            if not raw_text:
                continue
            fixed_text, fixed_score = _apply_column_rules(raw_text, col_index)
            if not fixed_text:
                continue
            confidence = float(candidate.get("confidence", 0.0) or 0.0)
            voted_score = max(0.0, min(0.99, confidence * fixed_score))
            key = _normalize_cell_text(fixed_text)
            if not key:
                continue
            row = votes.get(key) or {
                "raw_text": raw_text,
                "final_text": fixed_text,
                "confidence": 0.0,
                "preprocess_id": f"{engine_name}:{preprocess_id}",
                "_best_single": 0.0,
            }
            row["confidence"] = float(row["confidence"]) + voted_score
            if voted_score > float(row["_best_single"]):
                row["_best_single"] = voted_score
                row["raw_text"] = raw_text
                row["final_text"] = fixed_text
                row["preprocess_id"] = f"{engine_name}:{preprocess_id}"
            votes[key] = row
    if not votes:
        return fallback
    best = max(votes.values(), key=lambda x: (float(x.get("confidence", 0.0)), float(x.get("_best_single", 0.0))))
    final_conf = max(float(best.get("_best_single", 0.0)), min(0.99, float(best.get("confidence", 0.0)) / 2.4))
    return {
        "raw_text": str(best.get("raw_text", "")),
        "final_text": str(best.get("final_text", "")),
        "confidence": final_conf,
        "preprocess_id": str(best.get("preprocess_id", "vote")),
    }


def _build_superres_variants(crop) -> list[tuple[str, object]]:
    import cv2
    import numpy as np

    if crop is None:
        return []
    gray = crop if len(getattr(crop, "shape", [])) == 2 else cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    variants: list[tuple[str, object]] = [("sr1x", gray)]
    for scale in (2, 3):
        up = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        sharp = cv2.GaussianBlur(up, (0, 0), 1.1)
        sharp = cv2.addWeighted(up, 1.35, sharp, -0.35, 0)
        otsu = cv2.threshold(sharp, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        adap = cv2.adaptiveThreshold(sharp, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 35, 7)
        variants.append((f"sr{scale}x_o", otsu.astype(np.uint8)))
        variants.append((f"sr{scale}x_a", adap.astype(np.uint8)))
    return variants


def _ocr_cell_by_engine(crop, col_index: int, engine_name: str, preprocess_id: str) -> dict[str, object]:
    import cv2
    import numpy as np

    text_value = ""
    confidence = 0.0
    try:
        if engine_name == "tesseract":
            from PIL import Image
            import pytesseract

            img = Image.fromarray(crop.astype(np.uint8))
            config = "--psm 7"
            whitelist = _column_whitelist(col_index)
            if whitelist:
                config = f"{config} -c tessedit_char_whitelist={whitelist}"
            text_value = _normalize_cell_text(_tesseract_image_to_string(img, config=config))
            data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT, config=config)
            conf_values = [float(x) for x in data.get("conf", []) if str(x).strip() not in {"", "-1"}]
            if conf_values:
                confidence = max(0.0, min(0.99, sum(conf_values) / len(conf_values) / 100.0))
        elif engine_name == "rapid":
            rapid = _build_rapid_ocr()
            rgb = cv2.cvtColor(crop, cv2.COLOR_GRAY2RGB) if len(getattr(crop, "shape", [])) == 2 else crop
            result, _ = rapid(rgb)
            best_score = -1.0
            best_text = ""
            for item in result or []:
                if not item or len(item) < 2:
                    continue
                text = item[1]
                score = item[2] if len(item) > 2 else None
                text_value_candidate = text[0] if isinstance(text, (list, tuple)) and text else text
                text_value_candidate = _normalize_cell_text(str(text_value_candidate or ""))
                if not text_value_candidate:
                    continue
                score_value = 0.5
                try:
                    score_value = float(score)
                except Exception:
                    score_value = 0.5
                if score_value > best_score:
                    best_score = score_value
                    best_text = text_value_candidate
            text_value = best_text
            confidence = max(0.0, min(0.99, best_score if best_score >= 0 else 0.0))
        elif engine_name == "paddle":
            paddle = _build_paddle_ocr()
            rgb = cv2.cvtColor(crop, cv2.COLOR_GRAY2RGB) if len(getattr(crop, "shape", [])) == 2 else crop
            result = paddle.ocr(rgb, cls=False)
            best_score = -1.0
            best_text = ""
            for block in result or []:
                for item in block or []:
                    if len(item) < 2:
                        continue
                    text = str((item[1] or ("", 0.0))[0] or "")
                    score = float((item[1] or ("", 0.0))[1] or 0.0)
                    text = _normalize_cell_text(text)
                    if not text:
                        continue
                    if score > best_score:
                        best_score = score
                        best_text = text
            text_value = best_text
            confidence = max(0.0, min(0.99, best_score if best_score >= 0 else 0.0))
    except Exception:
        text_value = ""
        confidence = 0.0

    return {
        "raw_text": text_value,
        "final_text": text_value,
        "confidence": confidence,
        "preprocess_id": f"{engine_name}:{preprocess_id}",
    }


def _column_whitelist(col_index: int) -> str:
    if col_index in {0, 10, 11, 33}:
        return "0123456789.-:/lIZz"
    if col_index in {2}:
        return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    if col_index in {3, 4}:
        return "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789IlO"
    if col_index in {5, 6, 7, 8, 9, 17, 18, 19, 20, 21, 22, 23, 24, 25, 29, 30}:
        return "0123456789."
    return ""


def _apply_column_rules(raw_text: str, col_index: int) -> tuple[str, float]:
    text = _normalize_cell_text(raw_text)
    if not text:
        return "", 0.6

    if col_index in {0}:
        fixed = text.replace("-", ".").replace(":", ".").replace("l", "1").replace("I", "1")
        fixed = re.sub(r"^[zZ]", "2", fixed)
        if re.fullmatch(r"\d{1,2}\.\d{1,2}", fixed):
            return fixed, 1.0
        return fixed, 0.82

    if col_index in {2}:
        upper = text.upper().replace(" ", "")
        medium_map = {"CO2": "CO2", "COZ": "CO2", "C02": "CO2", "02": "O2", "AR": "Ar", "N2": "N2", "O2": "O2"}
        fixed = medium_map.get(upper, upper)
        if fixed in TABLE_MEDIUM_DICT:
            return fixed, 1.0
        return fixed, 0.8

    if col_index in {3}:
        fixed = re.sub(r"[^A-Z0-9]", "", text.upper())
        if fixed in TABLE_UNIT_CODE_DICT:
            return fixed, 1.0
        if re.fullmatch(r"[A-Z0-9]{1,4}", fixed):
            return fixed, 0.95
        return fixed[:4], 0.75

    if col_index in {4}:
        fixed = text.upper().replace("I", "1").replace("L", "1").replace("O", "0")
        fixed = re.sub(r"[^A-Z0-9]", "", fixed)
        if re.fullmatch(r"[A-Z0-9]{5,}", fixed):
            return fixed, 0.95
        return fixed, 0.75

    if col_index in {5, 21, 29}:
        fixed = text.replace(":", ".")
        if re.fullmatch(r"\d{1,2}\.\d", fixed):
            return fixed, 1.0 if fixed in {"22.5", "15.0"} else 0.95
        return fixed, 0.8

    if col_index in {6}:
        fixed = text.replace(":", ".")
        if re.fullmatch(r"\d{1,2}\.\d", fixed):
            return fixed, 1.0 if fixed == "15.0" else 0.95
        return fixed, 0.8

    if col_index in {7, 8, 17, 19}:
        fixed = text.replace(":", ".")
        if re.fullmatch(r"\d{1,2}\.\d", fixed) or re.fullmatch(r"\d{1,3}", fixed):
            return fixed, 0.95
        return fixed, 0.8

    if col_index in {18, 20, 25}:
        fixed = text.replace(":", ".")
        if re.fullmatch(r"\d(?:\.\d{1,2})?", fixed):
            return fixed, 0.95
        return fixed, 0.8

    if col_index in {22, 30}:
        fixed = re.sub(r"[^\d]", "", text)
        if re.fullmatch(r"\d+", fixed):
            return fixed, 1.0 if fixed == "2" else 0.95
        return fixed, 0.8

    if col_index in {33}:
        fixed = text.replace("-", ".").replace(":", ".")
        if re.fullmatch(r"\d{1,2}\.\d", fixed):
            return fixed, 0.95
        return fixed, 0.8

    return text, 0.9


def _check_table_row_consistency(row_records: list[dict[str, object]]) -> list[dict[str, object]]:
    review: list[dict[str, object]] = []
    for row_entry in row_records:
        row_id = int(row_entry.get("row", 0) or 0)
        fields = row_entry.get("fields", {})
        if not isinstance(fields, dict):
            continue
        nominal_volume = _safe_parse_float(fields.get("col_09", ""))
        actual_volume = _safe_parse_float(fields.get("col_20", ""))
        if nominal_volume is not None and actual_volume is not None and abs(actual_volume - nominal_volume) > 3.0:
            review.append({"row": row_id, "column_key": "col_20", "reason": "volume_deviation"})

        nominal_weight = _safe_parse_float(fields.get("col_08", ""))
        actual_weight = _safe_parse_float(fields.get("col_18", ""))
        loss_rate = _safe_parse_float(fields.get("col_19", ""))
        if nominal_weight is not None and actual_weight is not None and loss_rate is not None:
            if abs(nominal_weight - actual_weight) < 0.05 and abs(loss_rate) > 0.2:
                review.append({"row": row_id, "column_key": "col_19", "reason": "weight_loss_inconsistent"})

        valve_mark = str(fields.get("col_29", "")).strip()
        eval_result = str(fields.get("col_33", "")).strip()
        if valve_mark and not eval_result:
            review.append({"row": row_id, "column_key": "col_33", "reason": "conclusion_missing"})
    return review


def _safe_parse_float(value: object) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except Exception:
        return None


def _detect_check_mark(crop) -> tuple[bool, float]:
    import cv2
    import numpy as np

    gray = crop if len(getattr(crop, "shape", [])) == 2 else cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    binary = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 21, 7)
    area = binary.shape[0] * binary.shape[1]
    if area <= 0:
        return False, 0.0
    ink_ratio = float(binary.sum()) / 255.0 / float(area)
    lines = cv2.HoughLinesP(binary, 1, np.pi / 180, threshold=12, minLineLength=max(6, int(min(binary.shape[:2]) * 0.2)), maxLineGap=3)
    diagonal_count = 0
    if lines is not None:
        for line in lines[:24]:
            x1, y1, x2, y2 = line[0]
            dx = x2 - x1
            dy = y2 - y1
            if dx == 0:
                continue
            slope = abs(float(dy) / float(dx))
            if 0.3 <= slope <= 4.5:
                diagonal_count += 1
    checked = diagonal_count >= 2 and ink_ratio >= 0.02
    score = 0.95 if checked else max(0.65, min(0.9, ink_ratio * 10.0))
    return checked, score


def _detect_table_grid(file_path: Path) -> dict[str, object]:
    import cv2
    import numpy as np

    image = cv2.imread(str(file_path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        return {}
    image = _remove_shadow(image)
    _, binary = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if float(np.mean(binary)) < 127:
        binary = cv2.bitwise_not(binary)

    table_roi = _locate_table_roi(binary)
    x0, y0, x1, y1 = table_roi
    roi = binary[y0:y1, x0:x1]
    if roi.size == 0:
        return {}

    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(30, roi.shape[1] // 24), 1))
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(28, roi.shape[0] // 22)))
    horizontal = cv2.morphologyEx(roi, cv2.MORPH_OPEN, h_kernel, iterations=1)
    vertical = cv2.morphologyEx(roi, cv2.MORPH_OPEN, v_kernel, iterations=1)
    grid = cv2.bitwise_or(horizontal, vertical)
    grid = cv2.dilate(grid, np.ones((3, 3), np.uint8), iterations=1)

    x_lines = _project_line_positions(vertical, axis=0)
    y_lines = _project_line_positions(horizontal, axis=1)
    if len(x_lines) < 20 or len(y_lines) < 6:
        return {}

    x_lines = _fill_table_lines(x_lines, roi.shape[1], target=min(len(TABLE_COL_KEYS) + 1, len(x_lines) + 4))
    y_lines = _fill_table_lines(y_lines, roi.shape[0], target=min(64, len(y_lines) + 4))
    x_lines = [x + x0 for x in x_lines]
    y_lines = [y + y0 for y in y_lines]
    if len(x_lines) < 20 or len(y_lines) < 6:
        return {}

    ratio_lines = _build_ratio_based_x_lines(x0, x1)
    anchor_positions = _detect_header_anchor_positions(image, x0, y0, x1, y1)
    ratio_lines = _align_ratio_lines_with_anchors(ratio_lines, anchor_positions)
    x_lines = _fuse_grid_with_ratio_lines(x_lines, ratio_lines)

    calibrated_ratios = _calibrate_ratios_from_detected_lines(x_lines)
    if calibrated_ratios:
        _save_table_ratio_calibration(calibrated_ratios)

    return {
        "image": image,
        "binary": binary,
        "grid": grid,
        "x_lines": x_lines,
        "y_lines": y_lines,
        "roi": [x0, y0, x1, y1],
    }


@lru_cache(maxsize=1)
def _load_table_ratio_calibration() -> tuple[float, ...]:
    if not TABLE_CALIBRATION_FILE.exists():
        return TABLE_DEFAULT_COL_WIDTH_RATIOS
    try:
        payload = json.loads(TABLE_CALIBRATION_FILE.read_text(encoding="utf-8"))
    except Exception:
        return TABLE_DEFAULT_COL_WIDTH_RATIOS
    ratios = payload.get("col_width_ratios", []) if isinstance(payload, dict) else []
    if not isinstance(ratios, list):
        return TABLE_DEFAULT_COL_WIDTH_RATIOS
    numeric = []
    for value in ratios[: len(TABLE_COL_KEYS)]:
        try:
            numeric.append(max(0.0001, float(value)))
        except Exception:
            continue
    if len(numeric) != len(TABLE_COL_KEYS):
        return TABLE_DEFAULT_COL_WIDTH_RATIOS
    return tuple(numeric)


def _save_table_ratio_calibration(ratios: tuple[float, ...]) -> None:
    if len(ratios) != len(TABLE_COL_KEYS):
        return
    try:
        TABLE_CALIBRATION_FILE.parent.mkdir(parents=True, exist_ok=True)
        payload = {"col_width_ratios": [round(float(x), 8) for x in ratios]}
        TABLE_CALIBRATION_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        _load_table_ratio_calibration.cache_clear()
    except Exception:
        return


def _build_ratio_based_x_lines(x0: int, x1: int) -> list[int]:
    ratios = _load_table_ratio_calibration()
    width = max(1, int(x1 - x0))
    total = sum(ratios)
    if total <= 0:
        ratios = TABLE_DEFAULT_COL_WIDTH_RATIOS
        total = sum(ratios)
    lines = [int(x0)]
    acc = 0.0
    for ratio in ratios:
        acc += float(ratio) / float(total)
        lines.append(int(round(x0 + width * acc)))
    lines[0] = int(x0)
    lines[-1] = int(x1)
    return lines


def _detect_header_anchor_positions(image, x0: int, y0: int, x1: int, y1: int) -> dict[int, float]:
    import cv2

    table_h = max(1, y1 - y0)
    header_h = max(60, int(table_h * 0.18))
    hy0 = max(0, y0)
    hy1 = min(image.shape[0], y0 + header_h)
    if hy1 - hy0 < 20:
        return {}
    header = image[hy0:hy1, x0:x1]
    if header.size == 0:
        return {}
    if len(getattr(header, "shape", [])) == 2:
        header_rgb = cv2.cvtColor(header, cv2.COLOR_GRAY2RGB)
    else:
        header_rgb = header

    anchors: dict[int, float] = {}
    tokens: list[tuple[str, float]] = []
    try:
        rapid = _build_rapid_ocr()
        result, _ = rapid(header_rgb)
        for item in result or []:
            if not item or len(item) < 2:
                continue
            points = item[0]
            text = item[1]
            text_value = text[0] if isinstance(text, (list, tuple)) and text else text
            text_value = str(text_value or "").strip()
            if not text_value:
                continue
            metrics = _extract_box_metrics(points, text_value)
            if not metrics:
                continue
            tokens.append((_normalize_anchor_token(text_value), float(metrics["cx"]) + float(x0)))
    except Exception:
        return {}

    for col_index, keywords in TABLE_ANCHOR_KEYWORDS.items():
        best = None
        for token, cx in tokens:
            for keyword in keywords:
                kw = _normalize_anchor_token(keyword)
                if kw and kw in token:
                    best = cx if best is None else (best + cx) / 2.0
                    break
        if best is not None:
            anchors[col_index] = best
    return anchors


def _normalize_anchor_token(value: str) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", text)
    return text.strip()


def _align_ratio_lines_with_anchors(lines: list[int], anchors: dict[int, float]) -> list[int]:
    if len(lines) < 2 or not anchors:
        return lines
    pairs: list[tuple[float, float]] = []
    for col_index, actual_cx in anchors.items():
        if col_index < 0 or col_index + 1 >= len(lines):
            continue
        expected_cx = (float(lines[col_index]) + float(lines[col_index + 1])) / 2.0
        pairs.append((expected_cx, float(actual_cx)))
    if not pairs:
        return lines
    if len(pairs) == 1:
        shift = pairs[0][1] - pairs[0][0]
        aligned = [int(round(x + shift)) for x in lines]
    else:
        xs = [p[0] for p in pairs]
        ys = [p[1] for p in pairs]
        x_mean = sum(xs) / len(xs)
        y_mean = sum(ys) / len(ys)
        num = sum((x - x_mean) * (y - y_mean) for x, y in pairs)
        den = sum((x - x_mean) ** 2 for x in xs)
        a = 1.0 if den <= 1e-6 else num / den
        b = y_mean - a * x_mean
        aligned = [int(round(a * float(x) + b)) for x in lines]
    # Ensure monotonically increasing boundaries.
    fixed = [aligned[0]]
    for value in aligned[1:]:
        fixed.append(max(fixed[-1] + 2, value))
    return fixed


def _fuse_grid_with_ratio_lines(grid_lines: list[int], ratio_lines: list[int]) -> list[int]:
    if len(ratio_lines) < 2:
        return grid_lines
    if not grid_lines:
        return ratio_lines
    fused = []
    for ref in ratio_lines:
        nearest = min(grid_lines, key=lambda x: abs(int(x) - int(ref)))
        if abs(int(nearest) - int(ref)) <= 26:
            fused.append(int(round((int(nearest) * 0.6) + (int(ref) * 0.4))))
        else:
            fused.append(int(ref))
    return _merge_near_positions(fused, min_gap=2)


def _calibrate_ratios_from_detected_lines(lines: list[int]) -> tuple[float, ...] | None:
    if len(lines) < len(TABLE_COL_KEYS) + 1:
        return None
    ordered = sorted([int(x) for x in lines])
    if len(ordered) == len(TABLE_COL_KEYS) + 1:
        sampled = ordered
    else:
        sampled = []
        for i in range(len(TABLE_COL_KEYS) + 1):
            idx = int(round(i * (len(ordered) - 1) / len(TABLE_COL_KEYS)))
            sampled.append(ordered[idx])
    widths = [max(1.0, float(sampled[i + 1] - sampled[i])) for i in range(len(TABLE_COL_KEYS))]
    total = sum(widths)
    if total <= 0:
        return None
    return tuple([w / total for w in widths])


def _project_line_positions(mask, axis: int) -> list[int]:
    import numpy as np

    if axis == 0:
        projection = mask.sum(axis=0)
    else:
        projection = mask.sum(axis=1)
    if projection.size <= 0:
        return []
    threshold = max(1.0, float(np.max(projection)) * 0.2)
    indexes = [int(i) for i, v in enumerate(projection) if float(v) >= threshold]
    return _merge_near_positions(indexes, min_gap=6)


def _merge_near_positions(values: list[int], min_gap: int = 6) -> list[int]:
    if not values:
        return []
    ordered = sorted([int(v) for v in values])
    merged: list[list[int]] = [[ordered[0]]]
    for value in ordered[1:]:
        if value - merged[-1][-1] <= min_gap:
            merged[-1].append(value)
        else:
            merged.append([value])
    return [int(round(sum(chunk) / len(chunk))) for chunk in merged if chunk]


def _fill_table_lines(lines: list[int], limit: int, target: int) -> list[int]:
    if not lines:
        return []
    fixed = sorted(set([max(0, min(limit - 1, int(x))) for x in lines]))
    if fixed[0] > 2:
        fixed = [0] + fixed
    if fixed[-1] < limit - 3:
        fixed = fixed + [limit - 1]
    if len(fixed) >= target:
        return fixed
    if len(fixed) < 2:
        return fixed
    # Conservative补线：仅填补异常大间距，不做全局等距重建，避免错切格。
    gaps = [fixed[i + 1] - fixed[i] for i in range(len(fixed) - 1)]
    median_gap = sorted(gaps)[len(gaps) // 2] if gaps else 0
    if median_gap <= 0:
        return fixed
    completed = [fixed[0]]
    for i in range(len(fixed) - 1):
        left = fixed[i]
        right = fixed[i + 1]
        completed.append(right)
        gap = right - left
        if gap > median_gap * 1.9 and len(completed) < target:
            mid = int(round((left + right) / 2.0))
            if left + 4 < mid < right - 4:
                completed.append(mid)
    return sorted(set(completed))


def _locate_table_roi(binary):
    import cv2
    import numpy as np

    contours_info = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = contours_info[0] if len(contours_info) == 2 else contours_info[1]
    h, w = binary.shape[:2]
    image_area = float(h * w)
    best = None
    best_score = 0.0
    for contour in contours:
        x, y, cw, ch = cv2.boundingRect(contour)
        area = float(cw * ch)
        if area < image_area * 0.12:
            continue
        ratio = float(cw) / max(1.0, float(ch))
        if ratio < 1.1:
            continue
        score = area
        if score > best_score:
            best_score = score
            best = (x, y, x + cw, y + ch)
    if best is None:
        return (0, 0, w, h)
    x0, y0, x1, y1 = best
    pad_x = max(8, int((x1 - x0) * 0.01))
    pad_y = max(8, int((y1 - y0) * 0.01))
    return (
        max(0, x0 - pad_x),
        max(0, y0 - pad_y),
        min(w, x1 + pad_x),
        min(h, y1 + pad_y),
    )


def _evaluate_table_quality(table_cells: list[dict[str, object]], row_records: list[dict[str, object]], review_queue: list[dict[str, object]]) -> dict[str, object]:
    if not table_cells or not row_records:
        return {"ok": False, "reason": "empty_table"}
    total_cells = len(table_cells)
    non_empty = len([x for x in table_cells if str(x.get("final_text", "")).strip()])
    non_empty_ratio = float(non_empty) / float(total_cells)
    critical_cells = [x for x in table_cells if _is_table_critical_column(int(x.get("col", 0) or 0) - 1)]
    critical_non_empty = len([x for x in critical_cells if str(x.get("final_text", "")).strip()])
    critical_ratio = float(critical_non_empty) / float(max(1, len(critical_cells)))
    review_ratio = float(len(review_queue)) / float(total_cells)
    ok = non_empty_ratio >= 0.18 and critical_ratio >= 0.12 and review_ratio <= 0.88
    return {
        "ok": ok,
        "non_empty_ratio": round(non_empty_ratio, 4),
        "critical_non_empty_ratio": round(critical_ratio, 4),
        "review_ratio": round(review_ratio, 4),
        "row_count": len(row_records),
    }


def _remove_shadow(gray_image):
    import cv2
    import numpy as np

    dilated = cv2.dilate(gray_image, np.ones((7, 7), np.uint8))
    background = cv2.medianBlur(dilated, 21)
    diff = 255 - cv2.absdiff(gray_image, background)
    normalized = cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX)
    return normalized


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
        table_payload = _recognize_cylinder_table(prepared_path)
        if table_payload and isinstance(table_payload, dict):
            row_records = table_payload.get("row_records", [])
            if isinstance(row_records, list) and row_records:
                lines = [str(x.get("raw_record", "")).strip() for x in row_records if str(x.get("raw_record", "")).strip()]
                raw_text = "\n".join(lines).strip()
                if raw_text:
                    return raw_text, split_lines(raw_text), "table_cells", table_payload

        engine_map = _ocr_engine_map()
        engine_order = _resolve_engine_order(engine_map)
        best_text = ""
        best_lines: list[str] = []
        best_engine = "none"
        best_score = -1
        for index, engine_name in enumerate(engine_order):
            engine = engine_map.get(engine_name)
            if engine is None:
                continue
            try:
                text = engine(prepared_path)
                normalized = normalize_text(text)
                lines = split_lines(normalized)
                if not normalized:
                    continue
                score = _score_ocr_text(normalized)
                if score > best_score:
                    best_score = score
                    best_text = normalized
                    best_lines = lines
                    best_engine = engine_name
                # Keep latency bounded when a candidate is clearly strong.
                if len(normalized) >= (OCR_MIN_TEXT_FOR_EARLY_RETURN * 10) and len(lines) >= (OCR_MIN_LINES_FOR_EARLY_RETURN * 4):
                    break
            except Exception:
                continue
        if best_text:
            body_lines = _trim_table_header_lines(best_lines)
            if body_lines:
                best_lines = body_lines
                best_text = "\n".join(body_lines)
            return best_text, best_lines, best_engine, {}
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
    structured = {"docx": _inspect_docx_embedded_objects(file_path)}
    return normalized, lines, "docx", structured


def _inspect_docx_embedded_objects(file_path: Path) -> dict[str, object]:
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            names = [str(info.filename or "") for info in zf.infolist()]
    except Exception:
        return {
            "embedded_excel_count": 0,
            "chart_count": 0,
            "embedded_ole_bin_count": 0,
            "active_x_count": 0,
            "ole_object_count": 0,
            "has_embedded_excel": False,
            "has_chart": False,
            "has_embedded_objects": False,
        }

    embedded_excel_paths = sorted([x for x in names if re.match(r"^word/embeddings/.*\.xlsx$", x)])
    chart_paths = sorted([x for x in names if re.match(r"^word/charts/chart[0-9]+\.xml$", x)])
    embedded_ole_bin_paths = sorted([x for x in names if re.match(r"^word/embeddings/.*\.bin$", x)])
    active_x_paths = sorted([x for x in names if re.match(r"^word/activeX/", x)])
    ole_object_paths = sorted([x for x in names if re.match(r"^word/oleObject", x)])

    embedded_excel_count = len(embedded_excel_paths)
    chart_count = len(chart_paths)
    embedded_ole_bin_count = len(embedded_ole_bin_paths)
    active_x_count = len(active_x_paths)
    ole_object_count = len(ole_object_paths)

    return {
        "embedded_excel_count": embedded_excel_count,
        "chart_count": chart_count,
        "embedded_ole_bin_count": embedded_ole_bin_count,
        "active_x_count": active_x_count,
        "ole_object_count": ole_object_count,
        "has_embedded_excel": embedded_excel_count > 0,
        "has_chart": chart_count > 0,
        "has_embedded_objects": (
            embedded_excel_count > 0
            or chart_count > 0
            or embedded_ole_bin_count > 0
            or active_x_count > 0
            or ole_object_count > 0
        ),
    }


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
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps

    _enable_heif_support()
    image = Image.open(file_path).convert("RGB")
    text_psm6 = _tesseract_image_to_string(image, config="--psm 6")
    text_psm11 = _tesseract_image_to_string(image, config="--psm 11")
    text_rowwise = _tesseract_rowwise_table_read(image, ImageEnhance, ImageFilter, ImageOps)
    candidates = [text for text in (text_psm6, text_psm11, text_rowwise) if text and text.strip()]
    if not candidates:
        return ""
    return max(candidates, key=_score_ocr_text)


def _tesseract_rowwise_table_read(image, image_enhance, image_filter, image_ops) -> str:
    import numpy as np
    from PIL import Image as PILImage

    # Upscale first to improve dense handwriting/table OCR.
    w, h = image.size
    scale = 1
    if w < 2800:
        scale = 2
    if scale > 1:
        image = image.resize((w * scale, h * scale), resample=getattr(PILImage, "Resampling", PILImage).LANCZOS)

    enhanced = _enhance_for_table_ocr(image, image_enhance, image_filter, image_ops)
    gray = image_ops.grayscale(enhanced)
    arr = np.array(gray)
    if arr.size == 0:
        return ""

    # Simple binarization + horizontal projection for row segmentation.
    threshold = int(np.clip(np.percentile(arr, 35), 90, 190))
    binary = (arr < threshold).astype(np.uint8)
    ink_by_row = binary.sum(axis=1)
    width = int(arr.shape[1])
    min_ink = max(12, int(width * 0.01))

    bands: list[tuple[int, int]] = []
    start = -1
    for y, v in enumerate(ink_by_row):
        if v >= min_ink and start < 0:
            start = y
        elif v < min_ink and start >= 0:
            if y - start >= 10:
                bands.append((start, y))
            start = -1
    if start >= 0:
        bands.append((start, int(arr.shape[0])))

    # Merge near-by splits caused by table borders.
    merged: list[tuple[int, int]] = []
    for s, e in bands:
        if not merged:
            merged.append((s, e))
            continue
        ps, pe = merged[-1]
        if s - pe <= 8:
            merged[-1] = (ps, e)
        else:
            merged.append((s, e))

    lines: list[str] = []
    img_w, img_h = enhanced.size
    for s, e in merged:
        if e - s < 12:
            continue
        top = max(0, s - 4)
        bottom = min(img_h, e + 4)
        band = enhanced.crop((0, top, img_w, bottom))
        text = _tesseract_image_to_string(band, config="--psm 7")
        line = normalize_text(text).strip()
        if line:
            lines.append(line)

    return "\n".join(lines).strip()


def _trim_table_header_lines(lines: list[str]) -> list[str]:
    if not lines:
        return []
    # Keep only lines under the table header: start from first obvious data row (e.g. "2.11", "2-11", "2/11").
    first_data_idx = -1
    for idx, raw in enumerate(lines):
        line = str(raw or "").strip()
        if not line:
            continue
        if TABLE_BODY_ROW_RE.search(line):
            first_data_idx = idx
            break
    if first_data_idx < 0:
        return lines
    return [str(x or "").strip() for x in lines[first_data_idx:] if str(x or "").strip()]


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
    if OCR_PREP_MODE == "quality":
        rotation = _detect_best_rotation(image)
        candidates = [
            image,
            _enhance_for_ocr(image, ImageEnhance, ImageFilter, ImageOps),
            _enhance_for_table_ocr(image, ImageEnhance, ImageFilter, ImageOps),
        ]
        best_image = None
        best_score = -1
        for candidate in candidates:
            rotated = candidate if rotation == 0 else candidate.rotate(rotation, expand=True, fillcolor="white")
            score = _score_prepared_image(rotated)
            if best_image is None or score > best_score:
                best_image = rotated
                best_score = score
        image = best_image if best_image is not None else candidates[0]
    else:
        image = _enhance_for_table_ocr(image, ImageEnhance, ImageFilter, ImageOps)

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


def _enhance_for_table_ocr(image, image_enhance, image_filter, image_ops):
    gray = image_ops.grayscale(image)
    gray = image_ops.equalize(gray)
    gray = image_ops.autocontrast(gray, cutoff=0)
    gray = image_enhance.Contrast(gray).enhance(1.15)
    gray = image_enhance.Sharpness(gray).enhance(1.2)
    gray = gray.filter(image_filter.MedianFilter(size=3))
    return gray.convert("RGB")


def _score_prepared_image(image) -> int:
    try:
        text = _tesseract_image_to_string(image, config="--psm 6")
    except Exception:
        return -1
    return _score_ocr_text(text)


def _ocr_engine_map() -> dict[str, object]:
    return {
        "paddle": _ocr_by_paddle,
        "rapid": _ocr_by_rapid,
        "tesseract": _ocr_by_tesseract,
    }


def _resolve_engine_order(engine_map: dict[str, object]) -> list[str]:
    parts = [x.strip().lower() for x in OCR_ENGINE_ORDER.split(",") if x.strip()]
    ordered = [x for x in parts if x in engine_map]
    if not ordered:
        return ["rapid", "paddle", "tesseract"]
    return ordered


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
