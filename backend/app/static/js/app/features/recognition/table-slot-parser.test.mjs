import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRowRecordsFromTableCells,
  mergeColumnTokens,
  parseRowFromCellsBySlots,
} from "./table-slot-parser.js";

const COLUMNS = [
  { key: "inspectionDate", label: "检验日期", index: 0 },
  { key: "propertyCode", label: "产权代码编号", index: 1 },
  { key: "fillMedium", label: "充装介质", index: 2 },
  { key: "manufacturerCode", label: "制造单位代码", index: 3 },
  { key: "factoryNo", label: "出厂编号", index: 4 },
  { key: "hydroTestPressure", label: "水压试验压力MPa", index: 5 },
  { key: "nominalWorkingPressure", label: "公称工作压力MPa", index: 6 },
  { key: "nominalWeight", label: "公称瓶重kg", index: 7 },
  { key: "nominalVolume", label: "公称容积L", index: 8 },
  { key: "designWallThickness", label: "设计壁厚mm", index: 9 },
  { key: "manufactureYearMonth", label: "制造年月", index: 10 },
];

const X_LINES = [0, 100, 200, 300, 400, 520, 620, 720, 820, 920, 1020, 1120];

function cell({ row, text, col, x0, x1 }) {
  return {
    row,
    col: col + 1,
    final_text: text,
    bbox: [x0 ?? X_LINES[col] + 10, 0, x1 ?? X_LINES[col + 1] - 10, 10],
  };
}

test("A: empty middle slot must be preserved and later fields must not shift", () => {
  const cells = [
    cell({ row: 1, col: 0, text: "2.11" }),
    cell({ row: 1, col: 2, text: "AIR" }),
    cell({ row: 1, col: 3, text: "JM" }),
    cell({ row: 1, col: 4, text: "HE147226" }),
    cell({ row: 1, col: 5, text: "22.5" }),
    cell({ row: 1, col: 6, text: "15.0" }),
    cell({ row: 1, col: 7, text: "46.6" }),
    cell({ row: 1, col: 8, text: "40.6" }),
    cell({ row: 1, col: 9, text: "5.7" }),
    cell({ row: 1, col: 10, text: "13.07" }),
  ];
  const fields = parseRowFromCellsBySlots({ cells, columns: COLUMNS, xLines: X_LINES });
  assert.deepEqual(fields, {
    inspectionDate: "2.11",
    propertyCode: "",
    fillMedium: "AIR",
    manufacturerCode: "JM",
    factoryNo: "HE147226",
    hydroTestPressure: "22.5",
    nominalWorkingPressure: "15.0",
    nominalWeight: "46.6",
    nominalVolume: "40.6",
    designWallThickness: "5.7",
    manufactureYearMonth: "13.07",
  });
});

test("B: multi-token in same column can merge, but cannot cross columns", () => {
  assert.equal(mergeColumnTokens(["HE14", "7226"]), "HE147226");
  assert.equal(mergeColumnTokens(["22", ".5"]), "22.5");
  assert.equal(mergeColumnTokens(["13.", "07"]), "13.07");

  const cells = [
    cell({ row: 1, col: 0, text: "2.11" }),
    cell({ row: 1, col: 4, text: "HE14", x0: 410, x1: 450 }),
    cell({ row: 1, col: 4, text: "7226", x0: 452, x1: 500 }),
    cell({ row: 1, col: 5, text: "22", x0: 530, x1: 550 }),
    cell({ row: 1, col: 5, text: ".5", x0: 551, x1: 560 }),
  ];
  const fields = parseRowFromCellsBySlots({ cells, columns: COLUMNS, xLines: X_LINES });
  assert.equal(fields.factoryNo, "HE147226");
  assert.equal(fields.hydroTestPressure, "22.5");
  assert.equal(fields.nominalWorkingPressure, "");
});

test("C1: middle empty column should keep placeholder", () => {
  const cells = [
    cell({ row: 1, col: 0, text: "2.11" }),
    cell({ row: 1, col: 1, text: "金码" }),
    cell({ row: 1, col: 3, text: "JM" }),
  ];
  const fields = parseRowFromCellsBySlots({ cells, columns: COLUMNS, xLines: X_LINES });
  assert.equal(Object.keys(fields).length, COLUMNS.length);
  assert.equal(fields.fillMedium, "");
  assert.equal(fields.manufacturerCode, "JM");
});

test("C2: two consecutive empty columns should keep both placeholders", () => {
  const cells = [
    cell({ row: 1, col: 0, text: "2.11" }),
    cell({ row: 1, col: 1, text: "金码" }),
    cell({ row: 1, col: 4, text: "HE147226" }),
  ];
  const fields = parseRowFromCellsBySlots({ cells, columns: COLUMNS, xLines: X_LINES });
  assert.equal(fields.fillMedium, "");
  assert.equal(fields.manufacturerCode, "");
  assert.equal(fields.factoryNo, "HE147226");
});

test("C3: first/last column empty should keep placeholders", () => {
  const cells = [
    cell({ row: 1, col: 1, text: "金码" }),
    cell({ row: 1, col: 2, text: "AIR" }),
    cell({ row: 1, col: 9, text: "5.7" }),
  ];
  const fields = parseRowFromCellsBySlots({ cells, columns: COLUMNS, xLines: X_LINES });
  assert.equal(fields.inspectionDate, "");
  assert.equal(fields.manufactureYearMonth, "");
  assert.equal(fields.propertyCode, "金码");
  assert.equal(fields.designWallThickness, "5.7");
});

test("buildRowRecordsFromTableCells groups by row and preserves fixed field slots", () => {
  const tableCells = [
    cell({ row: 1, col: 0, text: "2.11" }),
    cell({ row: 1, col: 3, text: "WL" }),
    cell({ row: 1, col: 4, text: "HE147226" }),
    cell({ row: 2, col: 0, text: "2.15" }),
    cell({ row: 2, col: 3, text: "GL" }),
    cell({ row: 2, col: 4, text: "A15016004" }),
  ];
  const rows = buildRowRecordsFromTableCells({ tableCells, columns: COLUMNS, xLines: X_LINES });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fields.propertyCode, "");
  assert.equal(rows[0].fields.manufacturerCode, "WL");
  assert.equal(rows[1].fields.propertyCode, "");
  assert.equal(rows[1].fields.manufacturerCode, "GL");
});
