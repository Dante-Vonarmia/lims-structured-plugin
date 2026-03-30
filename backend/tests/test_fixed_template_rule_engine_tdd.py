import sys
import unittest
from pathlib import Path
import types
from unittest.mock import patch
from xml.etree import ElementTree as ET


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

if "yaml" not in sys.modules:
    yaml_stub = types.ModuleType("yaml")
    yaml_stub.safe_load = lambda *_args, **_kwargs: {}
    sys.modules["yaml"] = yaml_stub

from app.services.fixed_template_rule_engine import (
    fill_base_fields_in_cells_by_rules,
    fill_base_fields_in_paragraphs_by_rules,
)

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _tc(text: str) -> ET.Element:
    tc = ET.Element(f"{{{W_NS}}}tc")
    p = ET.SubElement(tc, f"{{{W_NS}}}p")
    r = ET.SubElement(p, f"{{{W_NS}}}r")
    t = ET.SubElement(r, f"{{{W_NS}}}t")
    t.text = text
    return tc


def _get_cell_text(tc: ET.Element) -> str:
    return "".join((node.text or "") for node in tc.findall(f".//{{{W_NS}}}t"))


def _set_cell_text(tc: ET.Element, value: str) -> None:
    for node in tc.findall(f".//{{{W_NS}}}t"):
        node.text = ""
    text_nodes = tc.findall(f".//{{{W_NS}}}t")
    if text_nodes:
        text_nodes[0].text = value


class FixedTemplateRuleEngineTDD(unittest.TestCase):
    def test_should_fill_next_value_cell_when_marker_cell_is_label_only(self) -> None:
        cells = [_tc("器具名称：\nInstrument name"), _tc("")]
        payload = {"device_name": "介质损耗试验仪"}
        rules = {
            "base_fields": [
                {
                    "key": "device_name",
                    "markers": ["器具名称", "设备名称", "仪器名称"],
                    "format": "器具名称：{value}",
                }
            ]
        }
        with patch("app.services.fixed_template_rule_engine.load_fixed_fill_rules", return_value=rules):
            changed = fill_base_fields_in_cells_by_rules(
                cells=cells,
                payload=payload,
                basis_mode="",
                get_cell_text=_get_cell_text,
                set_cell_text=_set_cell_text,
                extract_basis_from_text=lambda _text: "",
                format_mode_prefix=lambda _mode: "",
            )
        self.assertTrue(changed)
        self.assertEqual(_get_cell_text(cells[0]), "器具名称：\nInstrument name")
        self.assertEqual(_get_cell_text(cells[1]), "介质损耗试验仪")

    def test_should_fallback_to_same_cell_when_no_value_cell_available(self) -> None:
        cells = [_tc("器具名称：")]
        payload = {"device_name": "介质损耗试验仪"}
        rules = {
            "base_fields": [
                {
                    "key": "device_name",
                    "markers": ["器具名称", "设备名称", "仪器名称"],
                    "format": "器具名称：{value}",
                }
            ]
        }
        with patch("app.services.fixed_template_rule_engine.load_fixed_fill_rules", return_value=rules):
            changed = fill_base_fields_in_cells_by_rules(
                cells=cells,
                payload=payload,
                basis_mode="",
                get_cell_text=_get_cell_text,
                set_cell_text=_set_cell_text,
                extract_basis_from_text=lambda _text: "",
                format_mode_prefix=lambda _mode: "",
            )
        self.assertTrue(changed)
        self.assertEqual(_get_cell_text(cells[0]), "器具名称：介质损耗试验仪")

    def test_should_not_apply_paragraph_rule_inside_table_cells(self) -> None:
        root = ET.Element(f"{{{W_NS}}}document")
        body = ET.SubElement(root, f"{{{W_NS}}}body")
        tbl = ET.SubElement(body, f"{{{W_NS}}}tbl")
        tr = ET.SubElement(tbl, f"{{{W_NS}}}tr")
        tc = ET.SubElement(tr, f"{{{W_NS}}}tc")
        p_in_table = ET.SubElement(tc, f"{{{W_NS}}}p")
        r_in_table = ET.SubElement(p_in_table, f"{{{W_NS}}}r")
        t_in_table = ET.SubElement(r_in_table, f"{{{W_NS}}}t")
        t_in_table.text = "器具名称："

        p_outside = ET.SubElement(body, f"{{{W_NS}}}p")
        r_outside = ET.SubElement(p_outside, f"{{{W_NS}}}r")
        t_outside = ET.SubElement(r_outside, f"{{{W_NS}}}t")
        t_outside.text = "器具名称："

        payload = {"device_name": "介质损耗试验仪"}
        rules = {
            "base_fields": [
                {
                    "key": "device_name",
                    "markers": ["器具名称", "设备名称", "仪器名称"],
                    "format": "器具名称：{value}",
                }
            ]
        }
        with patch("app.services.fixed_template_rule_engine.load_fixed_fill_rules", return_value=rules):
            changed = fill_base_fields_in_paragraphs_by_rules(
                root=root,
                payload=payload,
                basis_mode="",
                extract_basis_from_text=lambda _text: "",
                format_mode_prefix=lambda _mode: "",
            )
        self.assertTrue(changed)
        self.assertEqual("".join((n.text or "") for n in p_in_table.findall(f".//{{{W_NS}}}t")), "器具名称：")
        self.assertEqual("".join((n.text or "") for n in p_outside.findall(f".//{{{W_NS}}}t")), "器具名称：介质损耗试验仪")


if __name__ == "__main__":
    unittest.main()
