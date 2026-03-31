from .docx_cell_utils import normalize_space
from .semantic_fill_lib import (
    extract_humidity_from_other_calibration_info,
    extract_location_from_other_calibration_info,
    extract_section_measured_value,
    extract_section_uncertainty,
    extract_temperature_from_other_calibration_info,
    replace_measured_value,
    replace_uncertainty_value,
    sanitize_location_text,
)


def _extract_location_from_other_calibration_info(text: str, extract_value_by_regex_fn):
    return extract_location_from_other_calibration_info(
        text,
        extract_value_by_regex=extract_value_by_regex_fn,
        normalize_space=normalize_space,
    )


def _extract_temperature_from_other_calibration_info(text: str, extract_value_by_regex_fn):
    return extract_temperature_from_other_calibration_info(
        text,
        extract_value_by_regex=extract_value_by_regex_fn,
    )


def _extract_humidity_from_other_calibration_info(text: str, extract_value_by_regex_fn):
    return extract_humidity_from_other_calibration_info(
        text,
        extract_value_by_regex=extract_value_by_regex_fn,
    )


def _sanitize_location_text(value: str) -> str:
    return sanitize_location_text(value, normalize_space=normalize_space)


def _replace_uncertainty_value(text: str, value: str, unit: str) -> str:
    return replace_uncertainty_value(
        text,
        value,
        unit,
        normalize_space=normalize_space,
    )


def _replace_measured_value(text: str, value: str, unit: str) -> str:
    return replace_measured_value(
        text,
        value,
        unit,
        normalize_space=normalize_space,
    )


def _extract_section_uncertainty(text: str, section_title: str, unit: str, extract_value_by_regex_fn):
    return extract_section_uncertainty(
        text,
        section_title,
        unit,
        extract_value_by_regex=extract_value_by_regex_fn,
    )


def _extract_section_measured_value(text: str, section_title: str, unit: str, extract_value_by_regex_fn):
    return extract_section_measured_value(
        text,
        section_title,
        unit,
        extract_value_by_regex=extract_value_by_regex_fn,
    )
