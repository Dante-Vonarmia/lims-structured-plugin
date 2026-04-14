import os
from pathlib import Path


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


BASE_DIR = Path(__file__).resolve().parents[1]
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", BASE_DIR / "uploads"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", BASE_DIR / "outputs"))
TEMPLATE_DIR = Path(os.getenv("TEMPLATE_DIR", BASE_DIR / "templates"))
TEMPLATE_BUNDLE_ROOT = Path(os.getenv("TEMPLATE_BUNDLE_ROOT", BASE_DIR / "template-bundles"))
RAW_RECORD_DIR = Path(os.getenv("RAW_RECORD_DIR", BASE_DIR / "raw-records"))
INSTRUMENT_CATALOG_AUTO_DIR = Path(os.getenv("INSTRUMENT_CATALOG_AUTO_DIR", BASE_DIR / "instrument-catalog"))
INSTRUMENT_CATALOG_AUTO_KEYWORDS = tuple(
    [x.strip() for x in os.getenv("INSTRUMENT_CATALOG_AUTO_KEYWORDS", "器具目录,器具总目录,instrument_catalog,catalog").split(",") if x.strip()]
)
LOCAL_DOCUMENT_LIBRARY_FILE = Path(os.getenv("LOCAL_DOCUMENT_LIBRARY_FILE", OUTPUT_DIR / "local_document_library.json"))
DEFAULT_TEMPLATE_NAME = os.getenv("DEFAULT_TEMPLATE_NAME", "report_template.docx")
MODIFY_CERTIFICATE_BLUEPRINT_TEMPLATE_NAME = os.getenv(
    "MODIFY_CERTIFICATE_BLUEPRINT_TEMPLATE_NAME",
    "modify-certificate-blueprint.docx",
)
OFFLINE_MODE = _env_bool("OFFLINE_MODE", False)
INSTRUMENT_CATALOG_AUTO_ENABLED = _env_bool("INSTRUMENT_CATALOG_AUTO_ENABLED", True)

for _directory in (
    UPLOAD_DIR,
    OUTPUT_DIR,
    TEMPLATE_DIR,
    RAW_RECORD_DIR,
    INSTRUMENT_CATALOG_AUTO_DIR,
    TEMPLATE_BUNDLE_ROOT,
    TEMPLATE_BUNDLE_ROOT / "input",
    TEMPLATE_BUNDLE_ROOT / "output",
):
    _directory.mkdir(parents=True, exist_ok=True)
