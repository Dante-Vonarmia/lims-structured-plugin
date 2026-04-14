import json
import sys
import tempfile
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.template_bundle import registry


class TemplateBundleRegistryTDD(unittest.TestCase):
    def _write_json(self, path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _write_text(self, path: Path, text: str = "x") -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def _scan_with_root(self, root: Path) -> dict:
        original_root = registry.TEMPLATE_BUNDLE_ROOT
        try:
            registry.TEMPLATE_BUNDLE_ROOT = root
            return registry.scan_template_bundles()
        finally:
            registry.TEMPLATE_BUNDLE_ROOT = original_root

    def test_manifest_missing_should_emit_manifest_missing(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "input" / "missing-manifest").mkdir(parents=True, exist_ok=True)
            scanned = self._scan_with_root(root)
            codes = {str(x.get("code")) for x in scanned.get("issues", [])}
            self.assertIn("manifest_missing", codes)

    def test_manifest_kind_mismatch_should_emit_manifest_kind_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            bundle_dir = root / "input" / "bundle-a"
            self._write_json(
                bundle_dir / "manifest.json",
                {
                    "bundleId": "bundle-a",
                    "displayName": "Bundle A",
                    "version": "1.0.0",
                    "kind": "output",
                    "enabled": True,
                    "entries": {"schema": "schema.csv", "rules": "rules.json"},
                },
            )
            self._write_text(bundle_dir / "schema.csv", "g1\na1\n")
            self._write_text(bundle_dir / "rules.json", "{}")
            scanned = self._scan_with_root(root)
            codes = {str(x.get("code")) for x in scanned.get("issues", [])}
            self.assertIn("manifest_kind_mismatch", codes)

    def test_entry_file_missing_should_emit_entry_file_missing(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            bundle_dir = root / "output" / "bundle-o"
            self._write_json(
                bundle_dir / "manifest.json",
                {
                    "bundleId": "bundle-o",
                    "displayName": "Bundle O",
                    "version": "1.0.0",
                    "kind": "output",
                    "enabled": True,
                    "entries": {"template": "missing.docx"},
                },
            )
            scanned = self._scan_with_root(root)
            codes = {str(x.get("code")) for x in scanned.get("issues", [])}
            self.assertIn("entry_file_missing", codes)

    def test_bundle_id_conflict_should_emit_bundle_id_conflict(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            bundle_input = root / "input" / "bundle-1"
            bundle_output = root / "output" / "bundle-2"
            self._write_json(
                bundle_input / "manifest.json",
                {
                    "bundleId": "same-id",
                    "displayName": "Input",
                    "version": "1.0.0",
                    "kind": "input",
                    "enabled": True,
                    "entries": {"schema": "schema.csv", "rules": "rules.json"},
                },
            )
            self._write_text(bundle_input / "schema.csv", "g1\na1\n")
            self._write_text(bundle_input / "rules.json", "{}")
            self._write_json(
                bundle_output / "manifest.json",
                {
                    "bundleId": "same-id",
                    "displayName": "Output",
                    "version": "1.0.0",
                    "kind": "output",
                    "enabled": True,
                    "entries": {"template": "template.docx"},
                },
            )
            self._write_text(bundle_output / "template.docx", "docx")
            scanned = self._scan_with_root(root)
            codes = {str(x.get("code")) for x in scanned.get("issues", [])}
            self.assertIn("bundle_id_conflict", codes)

    def test_path_outside_bundle_should_emit_entry_path_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            bundle_dir = root / "input" / "bundle-path"
            self._write_json(
                bundle_dir / "manifest.json",
                {
                    "bundleId": "bundle-path",
                    "displayName": "Bundle Path",
                    "version": "1.0.0",
                    "kind": "input",
                    "enabled": True,
                    "entries": {"schema": "../escape.csv", "rules": "rules.json"},
                },
            )
            self._write_text(bundle_dir / "rules.json", "{}")
            scanned = self._scan_with_root(root)
            invalid_issues = [
                x for x in scanned.get("issues", [])
                if str(x.get("code")) == "entry_path_invalid"
            ]
            self.assertTrue(invalid_issues)
            message_text = "\n".join(str(x.get("message") or "") for x in invalid_issues)
            self.assertIn("path_outside_bundle", message_text)

    def test_resolve_bundle_should_raise_when_bundle_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            bundle_dir = root / "input" / "bundle-invalid"
            self._write_json(
                bundle_dir / "manifest.json",
                {
                    "bundleId": "bundle-invalid",
                    "displayName": "Bundle Invalid",
                    "version": "1.0.0",
                    "kind": "input",
                    "enabled": True,
                    "entries": {"schema": "schema.csv", "rules": "missing-rules.json"},
                },
            )
            self._write_text(bundle_dir / "schema.csv", "g1\na1\n")
            original_root = registry.TEMPLATE_BUNDLE_ROOT
            try:
                registry.TEMPLATE_BUNDLE_ROOT = root
                with self.assertRaises(registry.BundleError) as err:
                    registry.resolve_input_bundle("bundle-invalid")
                self.assertIn("bundle unavailable", str(err.exception))
            finally:
                registry.TEMPLATE_BUNDLE_ROOT = original_root


if __name__ == "__main__":
    unittest.main()
