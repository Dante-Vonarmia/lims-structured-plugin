import json
from pathlib import Path
from typing import Any

from ...config import TEMPLATE_BUNDLE_ROOT

BUNDLE_KINDS = ("input", "output")


class BundleError(RuntimeError):
    pass


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _resolve_inside_bundle(bundle_dir: Path, relative_path: str) -> tuple[Path | None, str | None]:
    raw = _normalize_text(relative_path)
    if not raw:
        return None, "empty_path"
    candidate = Path(raw)
    if candidate.is_absolute():
        return None, "absolute_path_not_allowed"
    resolved = (bundle_dir / candidate).resolve()
    bundle_root = bundle_dir.resolve()
    if resolved != bundle_root and bundle_root not in resolved.parents:
        return None, "path_outside_bundle"
    return resolved, None


def _validate_manifest_shape(manifest: dict[str, Any], expected_kind: str) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    required = ("bundleId", "displayName", "version", "kind", "enabled")
    for key in required:
        if key not in manifest:
            errors.append({"code": "manifest_missing_required", "field": key, "message": f"missing required field: {key}"})

    kind = _normalize_text(manifest.get("kind"))
    if kind and kind not in BUNDLE_KINDS:
        errors.append({"code": "manifest_kind_invalid", "field": "kind", "message": f"invalid kind: {kind}"})
    if kind and kind != expected_kind:
        errors.append({"code": "manifest_kind_mismatch", "field": "kind", "message": f"manifest kind={kind} but directory kind={expected_kind}"})

    entries = manifest.get("entries")
    if not isinstance(entries, dict):
        errors.append({"code": "manifest_entries_missing", "field": "entries", "message": "entries must be an object"})
        return errors

    if expected_kind == "input":
        if not _normalize_text(entries.get("schema")):
            errors.append({"code": "manifest_entries_missing", "field": "entries.schema", "message": "input bundle requires entries.schema"})
        if not _normalize_text(entries.get("rules")):
            errors.append({"code": "manifest_entries_missing", "field": "entries.rules", "message": "input bundle requires entries.rules"})
    if expected_kind == "output":
        if not _normalize_text(entries.get("template")):
            errors.append({"code": "manifest_entries_missing", "field": "entries.template", "message": "output bundle requires entries.template"})
    return errors


def _load_manifest(manifest_path: Path) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    errors: list[dict[str, str]] = []
    if not manifest_path.exists() or not manifest_path.is_file():
        return None, [{"code": "manifest_missing", "field": "manifest", "message": "manifest.json not found"}]
    try:
        loaded = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return None, [{"code": "manifest_invalid_json", "field": "manifest", "message": str(exc)}]
    if not isinstance(loaded, dict):
        return None, [{"code": "manifest_invalid_type", "field": "manifest", "message": "manifest must be a JSON object"}]
    return loaded, errors


def _build_bundle_summary(record: dict[str, Any]) -> dict[str, Any]:
    manifest = record.get("manifest") if isinstance(record.get("manifest"), dict) else {}
    return {
        "id": _normalize_text(manifest.get("bundleId")),
        "displayName": _normalize_text(manifest.get("displayName")),
        "version": _normalize_text(manifest.get("version")),
        "description": _normalize_text(manifest.get("description")),
        "enabled": bool(manifest.get("enabled", False)),
        "availability": "available" if not record.get("errors") and bool(manifest.get("enabled", False)) else "unavailable",
    }


def _iter_bundle_dirs(kind_dir: Path) -> list[Path]:
    if not kind_dir.exists() or not kind_dir.is_dir():
        return []
    return sorted([x for x in kind_dir.iterdir() if x.is_dir()])


def scan_template_bundles() -> dict[str, Any]:
    root = TEMPLATE_BUNDLE_ROOT.resolve()
    issues: list[dict[str, str]] = []
    records: dict[str, list[dict[str, Any]]] = {"input": [], "output": []}
    bundle_id_owner: dict[str, str] = {}

    for kind in BUNDLE_KINDS:
        kind_dir = root / kind
        for bundle_dir in _iter_bundle_dirs(kind_dir):
            manifest_path = bundle_dir / "manifest.json"
            manifest, manifest_errors = _load_manifest(manifest_path)
            errors = list(manifest_errors)
            if isinstance(manifest, dict):
                errors.extend(_validate_manifest_shape(manifest, kind))
            else:
                manifest = {}

            bundle_id = _normalize_text(manifest.get("bundleId"))
            bundle_key = f"{kind}/{bundle_dir.name}"
            if bundle_id:
                owner = bundle_id_owner.get(bundle_id)
                if owner and owner != bundle_key:
                    errors.append({
                        "code": "bundle_id_conflict",
                        "field": "bundleId",
                        "message": f"bundleId conflict: {bundle_id} already used by {owner}",
                    })
                else:
                    bundle_id_owner[bundle_id] = bundle_key

            entries = manifest.get("entries") if isinstance(manifest.get("entries"), dict) else {}
            resolved_entries: dict[str, Any] = {}

            def resolve_entry(name: str) -> None:
                value = _normalize_text(entries.get(name))
                if not value:
                    return
                resolved, err = _resolve_inside_bundle(bundle_dir, value)
                if err:
                    errors.append({
                        "code": "entry_path_invalid",
                        "field": f"entries.{name}",
                        "message": f"invalid path ({err}): {value}",
                    })
                    return
                if not resolved.exists() or not resolved.is_file():
                    errors.append({
                        "code": "entry_file_missing",
                        "field": f"entries.{name}",
                        "message": f"file not found: {value}",
                    })
                resolved_entries[name] = str(resolved)

            if kind == "input":
                resolve_entry("schema")
                resolve_entry("rules")
                companion_raw = entries.get("companion", [])
                companion_files: list[str] = []
                if isinstance(companion_raw, list):
                    for idx, item in enumerate(companion_raw):
                        raw_item = _normalize_text(item)
                        if not raw_item:
                            continue
                        resolved, err = _resolve_inside_bundle(bundle_dir, raw_item)
                        if err:
                            errors.append({
                                "code": "entry_path_invalid",
                                "field": f"entries.companion[{idx}]",
                                "message": f"invalid path ({err}): {raw_item}",
                            })
                            continue
                        if not resolved.exists() or not resolved.is_file():
                            errors.append({
                                "code": "entry_file_missing",
                                "field": f"entries.companion[{idx}]",
                                "message": f"file not found: {raw_item}",
                            })
                            continue
                        companion_files.append(str(resolved))
                resolved_entries["companion"] = companion_files
            else:
                resolve_entry("template")
                assets_raw = entries.get("assets", [])
                assets_files: list[str] = []
                if isinstance(assets_raw, list):
                    for idx, item in enumerate(assets_raw):
                        raw_item = _normalize_text(item)
                        if not raw_item:
                            continue
                        resolved, err = _resolve_inside_bundle(bundle_dir, raw_item)
                        if err:
                            errors.append({
                                "code": "entry_path_invalid",
                                "field": f"entries.assets[{idx}]",
                                "message": f"invalid path ({err}): {raw_item}",
                            })
                            continue
                        if not resolved.exists() or not resolved.is_file():
                            errors.append({
                                "code": "entry_file_missing",
                                "field": f"entries.assets[{idx}]",
                                "message": f"file not found: {raw_item}",
                            })
                            continue
                        assets_files.append(str(resolved))
                resolved_entries["assets"] = assets_files

            record = {
                "kind": kind,
                "bundle_dir": str(bundle_dir.resolve()),
                "manifest_path": str(manifest_path.resolve()),
                "manifest": manifest,
                "resolved_entries": resolved_entries,
                "errors": errors,
            }
            records[kind].append(record)
            if errors:
                issues.extend(
                    [{"kind": kind, "bundle": bundle_dir.name, **err} for err in errors]
                )

    return {
        "root": str(root),
        "input": records["input"],
        "output": records["output"],
        "issues": issues,
    }


def list_bundle_options(kind: str) -> list[dict[str, Any]]:
    if kind not in BUNDLE_KINDS:
        return []
    scanned = scan_template_bundles()
    return [_build_bundle_summary(item) for item in scanned.get(kind, [])]


def list_bundle_options_payload() -> dict[str, Any]:
    scanned = scan_template_bundles()
    return {
        "root": scanned.get("root", ""),
        "input_bundles": [_build_bundle_summary(item) for item in scanned.get("input", [])],
        "output_bundles": [_build_bundle_summary(item) for item in scanned.get("output", [])],
        "issues": scanned.get("issues", []),
    }


def resolve_bundle(kind: str, bundle_id: str) -> dict[str, Any]:
    normalized_kind = _normalize_text(kind)
    normalized_id = _normalize_text(bundle_id)
    if normalized_kind not in BUNDLE_KINDS:
        raise BundleError(f"invalid bundle kind: {kind}")
    if not normalized_id:
        raise BundleError("bundle id is required")

    scanned = scan_template_bundles()
    for record in scanned.get(normalized_kind, []):
        manifest = record.get("manifest") if isinstance(record.get("manifest"), dict) else {}
        if _normalize_text(manifest.get("bundleId")) != normalized_id:
            continue
        if record.get("errors"):
            error_text = "; ".join([str(x.get("message", "")) for x in record.get("errors", []) if isinstance(x, dict)])
            raise BundleError(f"bundle unavailable: {normalized_id} ({error_text})")
        if not bool(manifest.get("enabled", False)):
            raise BundleError(f"bundle disabled: {normalized_id}")
        return {
            "kind": normalized_kind,
            "bundleId": normalized_id,
            "displayName": _normalize_text(manifest.get("displayName")),
            "version": _normalize_text(manifest.get("version")),
            "description": _normalize_text(manifest.get("description")),
            "bundleDir": record.get("bundle_dir"),
            "manifestPath": record.get("manifest_path"),
            "entries": record.get("resolved_entries", {}),
            "compatibility": manifest.get("compatibility") if isinstance(manifest.get("compatibility"), dict) else {},
            "tags": manifest.get("tags") if isinstance(manifest.get("tags"), list) else [],
            "documentType": _normalize_text(manifest.get("documentType")),
            "businessType": _normalize_text(manifest.get("businessType")),
        }

    raise BundleError(f"bundle not found: {normalized_id}")


def resolve_input_bundle(bundle_id: str) -> dict[str, Any]:
    return resolve_bundle("input", bundle_id)


def resolve_output_bundle(bundle_id: str) -> dict[str, Any]:
    return resolve_bundle("output", bundle_id)
