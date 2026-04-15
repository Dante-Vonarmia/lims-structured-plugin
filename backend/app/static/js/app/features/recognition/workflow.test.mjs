import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createRecognitionWorkflowFeature } from "./workflow.js";
import {
  mapLineToSchemaFields,
  mapLineToSchemaFieldsWithTrace,
  applySchemaRulesToMappedFields,
  buildTypedFieldsFromMapped,
} from "./pipeline/row-pipeline.js";
import { processSchemaRowInGroups } from "./pipeline/group-pipeline.js";

function buildDeps({ state, rawText }) {
  return {
    state,
    isExcelItem: () => false,
    createEmptyFields: () => ({}),
    uploadFile: async () => ({ file_id: "mock-file-id" }),
    runExcelInspect: async () => ({ records: [] }),
    buildExcelRecordItems: () => [],
    applyAutoTemplateMatch: async () => {},
    renderQueue: () => {},
    renderTemplateSelect: () => {},
    runOcr: async () => ({ raw_text: rawText, structured: {} }),
    extFromName: () => ".jpeg",
    splitRecordBlocks: () => [],
    runInstrumentTableExtract: async () => null,
    appendLog: () => {},
    runGeneralCheckStructureExtract: async () => null,
    runExtract: async () => ({}),
    applyStructuredMeasurementItems: () => {},
    inferCategory: () => "OCR",
    extractTemplateCode: () => "",
    buildCategoryMessage: () => "",
    resolveSourceCode: () => "",
    buildMultiDeviceWordItems: () => [],
  };
}

function buildStateWithSchema() {
  const columns = [
    { key: "check_date", label: "检验日期" },
    { key: "owner_code", label: "产权代码编号" },
    { key: "medium", label: "充装介质" },
    { key: "maker_code", label: "制造单位代码" },
    { key: "serial_no", label: "出厂编号" },
    { key: "hydro_pressure", label: "水压试验压力MPa" },
    { key: "work_pressure", label: "公称工作压力MPa" },
    { key: "nominal_weight", label: "公称瓶重kg" },
  ];
  const rules = {
    row_rules: { min_tokens: 6 },
    field_rules: {
      检验日期: { type: "date" },
      产权代码编号: { type: "code", max_len: 12 },
      充装介质: { type: "text", choices: [{ label: "Ar" }, { label: "O2" }, { label: "N2" }, { label: "CO2" }] },
      制造单位代码: { type: "code", max_len: 12 },
      出厂编号: { type: "code", max_len: 24 },
      水压试验压力MPa: { type: "number" },
      公称工作压力MPa: { type: "number" },
      公称瓶重kg: { type: "number" },
    },
  };
  return {
    queue: [],
    activeId: "",
    taskContext: {
      import_template_schema: { columns, rules },
    },
  };
}

function buildSourceItem() {
  return {
    id: "src-1",
    file: null,
    fileName: "sample.jpeg",
    sourceFileName: "sample.jpeg",
    sourceType: "image",
    fileId: "file-1",
    status: "pending",
    message: "",
  };
}

function buildStateForCylinderSchema() {
  const columns = [
    { key: "inspectionDate", label: "检验日期" },
    { key: "propertyCode", label: "产权代码编号" },
    { key: "fillMedium", label: "充装介质" },
    { key: "manufacturerCode", label: "制造单位代码" },
    { key: "factoryNo", label: "出厂编号" },
    { key: "hydroTestPressure", label: "水压试验压力MPa" },
    { key: "nominalWorkingPressure", label: "公称工作压力MPa" },
  ];
  const rules = {
    field_rules: {
      检验日期: { type: "date" },
      产权代码编号: { type: "code", max_len: 12 },
      充装介质: { type: "text", choices: [{ label: "AIR" }, { label: "Ar" }, { label: "O2" }, { label: "N2" }, { label: "CO2" }] },
      制造单位代码: { type: "code", max_len: 12 },
      出厂编号: { type: "code", max_len: 24 },
      水压试验压力MPa: { type: "number" },
      公称工作压力MPa: { type: "number" },
    },
  };
  return {
    queue: [],
    activeId: "",
    taskContext: {
      import_template_schema: { columns, rules },
    },
  };
}

test("schema mapping should keep middle blank column without shifting following fields", async () => {
  const state = buildStateWithSchema();
  const source = buildSourceItem();
  state.queue.push(source);
  const rawText = "2.11 Ar GZ A200441033 22.5 15.0 43.4";

  const feature = createRecognitionWorkflowFeature(buildDeps({ state, rawText }));
  await feature.processItem(source);

  assert.equal(state.queue.length, 1);
  const row = state.queue[0];
  assert.equal(row.isRecordRow, true);
  assert.equal(row.fields.check_date, "2.11");
  assert.equal(row.fields.owner_code, "");
  assert.equal(row.fields.medium, "Ar");
  assert.equal(row.fields.maker_code, "GZ");
  assert.equal(row.fields.serial_no, "A200441033");
  assert.equal(row.fields.hydro_pressure, "22.5");
  assert.equal(row.fields.work_pressure, "15.0");
  assert.equal(row.fields.nominal_weight, "43.4");
});

test("schema mapping should keep aligned when middle column has value", async () => {
  const state = buildStateWithSchema();
  const source = buildSourceItem();
  state.queue.push(source);
  const rawText = "2.11 金码 Ar GZ A200441033 22.5 15.0 43.4";

  const feature = createRecognitionWorkflowFeature(buildDeps({ state, rawText }));
  await feature.processItem(source);

  const row = state.queue[0];
  assert.equal(row.fields.owner_code, "金码");
  assert.equal(row.fields.medium, "Ar");
  assert.equal(row.fields.maker_code, "GZ");
  assert.equal(row.fields.serial_no, "A200441033");
});

test("owner blank + non-medium token should stay in place and fall to maker code", async () => {
  const state = buildStateWithSchema();
  const source = buildSourceItem();
  state.queue.push(source);
  const rawText = "2.11 WL HE147226 22.5 15.0 46.6";

  const feature = createRecognitionWorkflowFeature(buildDeps({ state, rawText }));
  await feature.processItem(source);

  const row = state.queue[0];
  assert.equal(row.fields.check_date, "2.11");
  assert.equal(row.fields.owner_code, "");
  assert.equal(row.fields.medium, "");
  assert.equal(row.fields.maker_code, "WL");
  assert.equal(row.fields.serial_no, "HE147226");
  assert.equal(row.fields.hydro_pressure, "22.5");
  assert.equal(row.fields.work_pressure, "15.0");
  assert.equal(row.fields.nominal_weight, "46.6");
});

test("owner blank + OCR medium alias should not auto-fill previous owner slot", async () => {
  const state = buildStateWithSchema();
  const source = buildSourceItem();
  state.queue.push(source);
  const rawText = "2.11 AI 1m HE147226 22.5 15.0 46.6";

  const feature = createRecognitionWorkflowFeature(buildDeps({ state, rawText }));
  await feature.processItem(source);

  const row = state.queue[0];
  assert.equal(row.fields.check_date, "2.11");
  assert.equal(row.fields.owner_code, "");
  assert.equal(row.fields.medium, "Ar");
  assert.equal(row.fields.maker_code, "1m");
  assert.equal(row.fields.serial_no, "HE147226");
  assert.equal(row.fields.hydro_pressure, "22.5");
  assert.equal(row.fields.work_pressure, "15.0");
  assert.equal(row.fields.nominal_weight, "46.6");
});

test("owner code should stay blank while OCR medium aliases and short maker codes remain aligned", () => {
  const columns = [
    { key: "check_date", label: "检验日期" },
    { key: "owner_code", label: "产权代码编号" },
    { key: "medium", label: "充装介质" },
    { key: "maker_code", label: "制造单位代码" },
    { key: "serial_no", label: "出厂编号" },
    { key: "hydro_pressure", label: "水压试验压力MPa" },
    { key: "work_pressure", label: "公称工作压力MPa" },
  ];
  const rules = {
    field_rules: {
      检验日期: { type: "date" },
      产权代码编号: { type: "code", max_len: 12 },
      充装介质: { type: "text", choices: [{ label: "Ar" }, { label: "O2" }, { label: "N2" }, { label: "CO2" }] },
      制造单位代码: { type: "code", max_len: 12 },
      出厂编号: { type: "code", max_len: 24 },
      水压试验压力MPa: { type: "number" },
      公称工作压力MPa: { type: "number" },
    },
  };

  const rowAy = mapLineToSchemaFields("2.11 AY G工 A200441033 22.5 15.0", columns, rules);
  assert.equal(rowAy.owner_code, "");
  assert.equal(rowAy.medium, "AY");
  assert.equal(rowAy.maker_code, "G工");
  assert.equal(rowAy.serial_no, "A200441033");

  const rowAl = mapLineToSchemaFields("2.11 AL 1m HE147034 22.5 15.0", columns, rules);
  assert.equal(rowAl.owner_code, "");
  assert.equal(rowAl.medium, "AL");
  assert.equal(rowAl.maker_code, "1m");
  assert.equal(rowAl.serial_no, "HE147034");

  const rowCo2 = mapLineToSchemaFields("2.11 CO2 W RE020070 22.5 15.0", columns, rules);
  assert.equal(rowCo2.owner_code, "");
  assert.equal(rowCo2.medium, "CO2");
  assert.equal(rowCo2.maker_code, "W");
  assert.equal(rowCo2.serial_no, "RE020070");

  const rowOwnerPresent = mapLineToSchemaFields("2.11 341 CO2 G工 A220033187 22.5 15.0", columns, rules);
  assert.equal(rowOwnerPresent.owner_code, "341");
  assert.equal(rowOwnerPresent.medium, "CO2");
  assert.equal(rowOwnerPresent.maker_code, "G工");
  assert.equal(rowOwnerPresent.serial_no, "A220033187");
});

test("D: integration regression with sample image fixture should keep row slots stable", async () => {
  const fixturePath = path.resolve("backend/tests/fixtures/ocr_sample_da_te.jpeg");
  assert.equal(fs.existsSync(fixturePath), true);

  const state = buildStateForCylinderSchema();
  const source = buildSourceItem();
  source.fileName = "大特测试.jpeg";
  source.sourceFileName = "大特测试.jpeg";
  state.queue.push(source);

  const tableCells = [
    { row: 1, col: 1, column_key: "col_01", final_text: "2.11", bbox: [0, 0, 100, 10] },
    { row: 1, col: 2, column_key: "col_02", final_text: "金的", bbox: [101, 0, 200, 10] },
    { row: 1, col: 3, column_key: "col_03", final_text: "hr", bbox: [201, 0, 300, 10] },
    { row: 1, col: 4, column_key: "col_04", final_text: "15", bbox: [301, 0, 400, 10] },
    { row: 1, col: 5, column_key: "col_05", final_text: "A200441033", bbox: [401, 0, 520, 10] },
    { row: 1, col: 6, column_key: "col_06", final_text: "22.5", bbox: [521, 0, 620, 10] },
    { row: 1, col: 7, column_key: "col_07", final_text: "15.0", bbox: [621, 0, 720, 10] },

    { row: 2, col: 1, column_key: "col_01", final_text: "2.11", bbox: [0, 11, 100, 21] },
    { row: 2, col: 4, column_key: "col_04", final_text: "WL", bbox: [301, 11, 400, 21] },
    { row: 2, col: 5, column_key: "col_05", final_text: "HE147226", bbox: [401, 11, 520, 21] },
    { row: 2, col: 6, column_key: "col_06", final_text: "22.5", bbox: [521, 11, 620, 21] },
    { row: 2, col: 7, column_key: "col_07", final_text: "15.0", bbox: [621, 11, 720, 21] },

    { row: 3, col: 1, column_key: "col_01", final_text: "21.5", bbox: [0, 22, 100, 32] },
    { row: 3, col: 4, column_key: "col_04", final_text: "GL", bbox: [301, 22, 400, 32] },
    { row: 3, col: 5, column_key: "col_05", final_text: "A15016004", bbox: [401, 22, 520, 32] },
    { row: 3, col: 6, column_key: "col_06", final_text: "21.5", bbox: [521, 22, 620, 32] },
    { row: 3, col: 7, column_key: "col_07", final_text: "15", bbox: [621, 22, 720, 32] },
  ];

  // override runOcr for this test to mimic image fixture OCR structured payload
  const runOcrPayload = { raw_text: "", structured: { table_cells: tableCells, row_records: [] } };
  const featureWithFixture = createRecognitionWorkflowFeature({
    ...buildDeps({ state, rawText: "" }),
    runOcr: async () => runOcrPayload,
  });
  await featureWithFixture.processItem(source);

  assert.equal(state.queue.length, 3);
  const row2 = state.queue[1];
  const row3 = state.queue[2];
  assert.equal(row2.fields.propertyCode, "");
  assert.equal(row3.fields.propertyCode, "");
  assert.equal(row2.fields.fillMedium, "");
  assert.equal(row3.fields.fillMedium, "");
  assert.equal(row2.fields.manufacturerCode, "WL");
  assert.equal(row3.fields.manufacturerCode, "GL");
  assert.equal(row2.fields.factoryNo, "HE147226");
  assert.equal(row3.fields.factoryNo, "A15016004");
  assert.equal(row2.fields.hydroTestPressure, "22.5");
  assert.equal(row3.fields.hydroTestPressure, "21.5");
  assert.deepEqual(row2.recognizedFields, row2.fields);
  assert.deepEqual(row3.recognizedFields, row3.fields);
});

test("schema table branch should warn but keep text fallback when dense template has no structured result", async () => {
  const columns = Array.from({ length: 37 }, (_, i) => ({
    key: `col_${String(i + 1).padStart(2, "0")}`,
    label: `列${i + 1}`,
    index: i,
  }));
  const state = {
    queue: [],
    activeId: "",
    taskContext: {
      import_template_schema: {
        columns,
        groups: [{ name: "全表", columns }],
        rules: { row_rules: { min_tokens: 6 }, field_rules: {} },
      },
    },
  };
  const source = buildSourceItem();
  source.fileName = "大特测试.jpeg";
  source.sourceFileName = "大特测试.jpeg";
  state.queue.push(source);

  const rawText = [
    "2.11 金的 hr 15 A200441033 lu.5 15.0 49.0 5.0 20. 45.4 D 40.0 21.5 Zh hh 2.91 √ 口换阀 15.0 2 3 1.z",
    "2.11 A WL HE147226 221.5 15.. 46.61 40.6 5.7 13.0 46.6 40. .$ h 148 3.04 口换阀 校阀 15.0 31.z",
    "z-11 A GL A15016004 21.5 15-0147.9140.31 5.7 15 47.9 0 40.5 0 22.5 力h 14l 3.。 口换博 15.0 Z 31,2",
  ].join("\n");
  const feature = createRecognitionWorkflowFeature({
    ...buildDeps({ state, rawText }),
    runOcr: async () => ({ raw_text: rawText, engine: "rapid", structured: {} }),
  });

  await feature.processItem(source);

  assert.equal(state.queue.length >= 1, true);
  const row = state.queue[0];
  assert.equal((row.ocrDebug && row.ocrDebug.mode) || "", "data_lines");
  assert.equal(String((row.fields && row.fields.raw_record) || "").length > 0, true);
  assert.equal(String((row.fields && row.fields.col_01) || "").length > 0, true);
});

test("checkmark-like columns should map marker tokens to checked symbol", () => {
  const columns = [
    { key: "col_a", label: "余气处理" },
    { key: "col_b", label: "外观清理检查" },
    { key: "col_c", label: "音响检查" },
    { key: "col_d", label: "内表面检查" },
    { key: "col_e", label: "瓶口螺纹检查" },
    { key: "col_f", label: "内部干燥" },
    { key: "col_g", label: "试验结论" },
    { key: "col_h", label: "评定结论" },
  ];
  const mapped = mapLineToSchemaFields("V V V V V V V V", columns, { field_rules: {} });
  assert.equal(mapped.col_a, "√");
  assert.equal(mapped.col_b, "√");
  assert.equal(mapped.col_c, "√");
  assert.equal(mapped.col_d, "√");
  assert.equal(mapped.col_e, "√");
  assert.equal(mapped.col_f, "√");
  assert.equal(mapped.col_g, "√");
  assert.equal(mapped.col_h, "√");
});

test("check type should normalize checkmarks to true and non-true to empty", () => {
  const columns = [
    { key: "check_a", label: "余气处理" },
    { key: "check_b", label: "外观清理检查" },
    { key: "check_c", label: "试验结论" },
  ];
  const rules = {
    field_rules: {
      余气处理: { type: "check" },
      外观清理检查: { type: "check" },
      试验结论: { type: "check" },
    },
  };

  const normalized = applySchemaRulesToMappedFields({
    check_a: "√",
    check_b: "V",
    check_c: "x",
  }, columns, rules);
  assert.equal(normalized.check_a, "true");
  assert.equal(normalized.check_b, "true");
  assert.equal(normalized.check_c, "");

  const typed = buildTypedFieldsFromMapped(normalized, columns, rules);
  assert.equal(typed.check_a.type, "check");
  assert.equal(typed.check_a.value, true);
  assert.equal(typed.check_b.value, true);
  assert.equal(Boolean(typed.check_c), false);
});

test("valve inspection should pick checked option when unchecked marker appears on the other option", () => {
  const columns = [{ key: "valveCheck", label: "瓶阀检验", group: "气密性试验", index: 0 }];
  const rules = {
    field_rules: {
      瓶阀检验: {
        type: "checkbox_choice",
        choices: [
          { label: "校阀", tokens: ["校阀"] },
          { label: "换阀", tokens: ["换阀"] },
        ],
      },
    },
  };
  const mappedWithTrace = mapLineToSchemaFieldsWithTrace("口换阀 校阀", columns, rules);
  assert.equal(mappedWithTrace.mapped.valveCheck, "校阀");
  const conflictTrace = (mappedWithTrace.trace || []).find((x) => String((x && x.columnKey) || "") === "valveCheck");
  assert.equal(String((conflictTrace && conflictTrace.warning) || "").length, 0);
});

test("valve inspection must be mutually exclusive: real double-check conflict clears value and emits warning", () => {
  const columns = [{ key: "valveCheck", label: "瓶阀检验", group: "气密性试验", index: 0 }];
  const rules = {
    field_rules: {
      瓶阀检验: {
        type: "checkbox_choice",
        choices: [
          { label: "校阀", tokens: ["校阀"] },
          { label: "换阀", tokens: ["换阀"] },
        ],
      },
    },
  };
  const mappedWithTrace = mapLineToSchemaFieldsWithTrace("√校阀 √换阀", columns, rules);
  assert.equal(mappedWithTrace.mapped.valveCheck, "");
  const conflictTrace = (mappedWithTrace.trace || []).find((x) => String((x && x.columnKey) || "") === "valveCheck");
  assert.equal(String((conflictTrace && conflictTrace.warning) || "").length > 0, true);

  const fieldWarnings = { valveCheck: String((conflictTrace && conflictTrace.warning) || "") };
  const grouped = processSchemaRowInGroups({
    rowFields: {},
    rawMapped: mappedWithTrace.mapped,
    fieldWarnings,
    schemaColumns: columns,
    schemaGroups: [{ key: "g1", name: "气密性试验", columns }],
    schemaRules: rules,
  });
  assert.equal(grouped.normalizedMapped.valveCheck, "");
  assert.equal((grouped.fieldPipeline.valveCheck && grouped.fieldPipeline.valveCheck.status) || "", "warning");
});

test("next inspection date should keep date value and drop non-date token", () => {
  const columns = [{ key: "next_inspection_date", label: "下次检验日期", group: "结果评定", index: 0 }];
  const rules = {
    field_rules: {
      下次检验日期: { type: "date_or_dash", dash_tokens: ["/", "／", "\\", "＼"] },
    },
  };
  const groups = [{ key: "g1", name: "结果评定", columns }];

  const dashGrouped = processSchemaRowInGroups({
    rowFields: {},
    rawMapped: { next_inspection_date: "-" },
    fieldWarnings: {},
    schemaColumns: columns,
    schemaGroups: groups,
    schemaRules: rules,
  });
  assert.equal(Boolean(dashGrouped.typedFields.next_inspection_date), false);

  const dateGrouped = processSchemaRowInGroups({
    rowFields: {},
    rawMapped: { next_inspection_date: "2.11" },
    fieldWarnings: {},
    schemaColumns: columns,
    schemaGroups: groups,
    schemaRules: rules,
  });
  assert.equal(dateGrouped.typedFields.next_inspection_date.type, "date_or_dash");
  assert.equal(dateGrouped.typedFields.next_inspection_date.dash, false);
});

test("row mapping should normalize z-prefixed date and keep medium/factory alignment on noisy maker token", () => {
  const columns = [
    { key: "check_date", label: "检验日期" },
    { key: "owner_code", label: "产权代码编号" },
    { key: "medium", label: "充装介质" },
    { key: "maker_code", label: "制造单位代码" },
    { key: "serial_no", label: "出厂编号" },
    { key: "hydro_pressure", label: "水压试验压力MPa" },
    { key: "work_pressure", label: "公称工作压力MPa" },
  ];
  const rules = {
    field_rules: {
      检验日期: { type: "date" },
      产权代码编号: { type: "code", max_len: 12 },
      充装介质: { type: "text", choices: [{ label: "Ar" }, { label: "O2" }, { label: "N2" }, { label: "CO2" }] },
      制造单位代码: { type: "code", max_len: 12 },
      出厂编号: { type: "code", max_len: 24 },
      水压试验压力MPa: { type: "number" },
      公称工作压力MPa: { type: "number" },
    },
  };

  const row1 = mapLineToSchemaFields("2.11 金的 hr 15 A200441033 lu.5 15.0", columns, rules);
  assert.equal(row1.check_date, "2.11");
  assert.equal(row1.medium, "Ar");
  assert.equal(row1.maker_code, "");
  assert.equal(row1.serial_no, "A200441033");

  const row3 = mapLineToSchemaFields("z-11 A GL A15016004 21.5 15.0", columns, rules);
  assert.equal(row3.check_date, "2.11");
  assert.equal(row3.medium, "Ar");
  assert.equal(row3.maker_code, "GL");
  assert.equal(row3.serial_no, "A15016004");

  const row4 = mapLineToSchemaFields("2.11 AI 1m HE147226 22.5 15.0", columns, rules);
  assert.equal(row4.owner_code, "");
  assert.equal(row4.medium, "Ar");
  assert.equal(row4.maker_code, "1m");
  assert.equal(row4.serial_no, "HE147226");
});
