from __future__ import annotations

from pathlib import Path


def _resolve_paths() -> tuple[Path, Path]:
    root = Path(__file__).resolve().parents[2]
    config_dir = root / "app" / "static" / "js" / "core" / "config"
    return config_dir / "constants.js", config_dir / "constants"


def lint_constants_structure() -> list[str]:
    constants_entry, constants_dir = _resolve_paths()
    errors: list[str] = []

    if not constants_dir.exists():
        errors.append(f"Missing directory: {constants_dir}")
        return errors
    if not constants_entry.exists():
        errors.append(f"Missing file: {constants_entry}")
        return errors

    allowed_root_files = {"README.md"}
    for entry in constants_dir.iterdir():
        if entry.is_file() and entry.name not in allowed_root_files:
            errors.append(f"Flat constants file is not allowed in constants/: {entry.name}")

    export_lines = [
        line.strip()
        for line in constants_entry.read_text(encoding="utf-8").splitlines()
        if line.strip().startswith("export * from ")
    ]
    if not export_lines:
        errors.append("No re-export lines found in constants.js")
        return errors

    for line in export_lines:
        if not (line.startswith('export * from "') or line.startswith("export * from '")):
            errors.append(f"Invalid re-export line in constants.js: {line}")
            continue
        quote = '"' if '"' in line else "'"
        parts = line.split(quote)
        if len(parts) < 3:
            errors.append(f"Invalid re-export line in constants.js: {line}")
            continue
        import_path = parts[1]
        if not import_path.startswith("./constants/"):
            errors.append(f"Re-export must stay under ./constants/: {line}")
            continue
        resolved = (constants_entry.parent / import_path).resolve()
        if not resolved.exists():
            errors.append(f"Re-export target does not exist: {import_path}")

    return errors
