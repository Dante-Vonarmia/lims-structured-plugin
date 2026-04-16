import test from "node:test";
import assert from "node:assert/strict";

import { resolveDisplayFieldState } from "./data/resolve-display-pipeline.js";
import { createSourceFieldComponents } from "./index.js";
import { buildTypedFieldsFromMapped } from "../../recognition/pipeline/row-pipeline.js";

test("display field state should rebuild pairing pipeline from recognized fields when item pipeline is empty", () => {
  const schemaColumns = [
    { key: "check_date", label: "检验日期", group: "检验日期", index: 0 },
    { key: "owner_code", label: "产权代码编号", group: "钢印标记检查及余气处理", index: 1 },
  ];
  const schemaGroups = [
    { key: "group_1", name: "检验日期", columns: [schemaColumns[0]] },
    { key: "group_2", name: "钢印标记检查及余气处理", columns: [schemaColumns[1]] },
  ];
  const schemaRules = {
    field_rules: {
      检验日期: { type: "date", std_type: "date" },
      产权代码编号: { type: "code", std_type: "string" },
    },
  };
  const item = {
    fields: { check_date: "2.11", owner_code: "707" },
    recognizedFields: { check_date: "2.11", owner_code: "707" },
    fieldPipeline: {
      check_date: { status: "waiting", rawValue: "", normalizedValue: "", displayValue: "" },
      owner_code: { status: "waiting", rawValue: "", normalizedValue: "", displayValue: "" },
    },
    groupPipeline: {
      检验日期: { status: "waiting", parsed: 0, warning: 0, failed: 0 },
      钢印标记检查及余气处理: { status: "waiting", parsed: 0, warning: 0, failed: 0 },
    },
  };

  const resolved = resolveDisplayFieldState({
    item,
    schemaColumns,
    schemaGroups,
    schemaRules,
  });

  assert.equal(resolved.fieldPipeline.check_date.normalizedValue, "2.11");
  assert.equal(resolved.fieldPipeline.check_date.status, "parsed");
  assert.equal(resolved.groupPipeline.检验日期.status, "parsed");
  assert.equal(resolved.itemTypedFields.check_date.type, "date");
});

test("display field state should merge fields and recognizedFields when recognizedFields only stores diffs", () => {
  const schemaColumns = [
    { key: "owner_code", label: "产权代码编号", group: "钢印标记检查及余气处理", index: 0 },
    { key: "medium", label: "充装介质", group: "钢印标记检查及余气处理", index: 1 },
  ];
  const schemaGroups = [
    { key: "group_1", name: "钢印标记检查及余气处理", columns: schemaColumns },
  ];
  const schemaRules = {
    field_rules: {
      产权代码编号: { type: "string", std_type: "string" },
      充装介质: { type: "string", std_type: "string" },
    },
  };

  const resolved = resolveDisplayFieldState({
    item: {
      fields: { owner_code: "金鸽气体（测试）", medium: "Ar" },
      recognizedFields: { owner_code: "金鸽" },
      fieldPipeline: {},
      groupPipeline: {},
      typedFields: {},
    },
    schemaColumns,
    schemaGroups,
    schemaRules,
  });

  assert.equal(resolved.fieldPipeline.owner_code.normalizedValue, "金鸽");
  assert.equal(resolved.fieldPipeline.medium.normalizedValue, "Ar");
  assert.equal(resolved.groupPipeline["钢印标记检查及余气处理"].status, "parsed");
});

test("display field state should keep existing pairing pipeline when it already contains rendered values", () => {
  const existing = {
    check_date: { status: "parsed", rawValue: "2.11", normalizedValue: "2.11", displayValue: "2026年02月11日" },
  };
  const resolved = resolveDisplayFieldState({
    item: {
      fields: { check_date: "2.11" },
      recognizedFields: { check_date: "2.11" },
      fieldPipeline: existing,
      groupPipeline: { 检验日期: { status: "parsed", parsed: 1, warning: 0, failed: 0 } },
      typedFields: { check_date: { type: "date", display: "2026年02月11日" } },
    },
    schemaColumns: [{ key: "check_date", label: "检验日期", group: "检验日期", index: 0 }],
    schemaGroups: [{ key: "group_1", name: "检验日期", columns: [{ key: "check_date", label: "检验日期", group: "检验日期", index: 0 }] }],
    schemaRules: { field_rules: { 检验日期: { type: "date", std_type: "date" } } },
  });

  assert.equal(resolved.fieldPipeline, existing);
  assert.equal(resolved.groupPipeline.检验日期.status, "parsed");
  assert.equal(resolved.itemTypedFields.check_date.display, "2026年02月11日");
});

test("typed fields should follow std_type for signature and full date values", () => {
  const columns = [
    { key: "inspector", label: "检验员" },
    { key: "check_date", label: "检验日期" },
  ];
  const rules = {
    field_rules: {
      检验员: { type: "optional_blank", std_type: "signature" },
      检验日期: { type: "date", std_type: "date" },
    },
  };

  const typed = buildTypedFieldsFromMapped({
    inspector: "张三",
    check_date: "2026-04-15",
  }, columns, rules);

  assert.equal(typed.inspector.type, "signature");
  assert.equal(typed.inspector.display, "张三");
  assert.equal(typed.check_date.type, "date");
  assert.equal(typed.check_date.isoDate, "2026-04-15");
  assert.equal(typed.check_date.display, "2026年04月15日");
});

test("source field row should render signature, check and checkbox choice widgets from rules", () => {
  const { renderSourceFieldRow } = createSourceFieldComponents({
    escapeHtml: (value) => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;"),
    escapeAttr: (value) => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;"),
    parseDateParts: () => null,
    getSignatureImageUrl: (name) => (name === "张三" ? "/signatures/zhangsan.jpg" : ""),
  });
  const schemaRules = {
    field_rules: {
      检验员: { type: "optional_blank", std_type: "signature" },
      余气处理: { type: "check", std_type: "check" },
      瓶阀检验: { type: "checkbox_choice", std_type: "check" },
    },
  };
  const itemFields = {
    inspector: "张三",
    residue_check: "true",
    valve_check: "校阀",
  };
  const itemTypedFields = {
    inspector: { type: "signature", display: "张三" },
    residue_check: { type: "check", value: true, display: "true" },
    valve_check: { type: "checkbox_choice", display: "校阀" },
  };

  const signatureHtml = renderSourceFieldRow({
    col: { key: "inspector", label: "检验员" },
    itemFields,
    itemTypedFields,
    fieldPipeline: {},
    schemaRules,
  });
  const checkHtml = renderSourceFieldRow({
    col: { key: "residue_check", label: "余气处理" },
    itemFields,
    itemTypedFields,
    fieldPipeline: {},
    schemaRules,
  });
  const choiceHtml = renderSourceFieldRow({
    col: { key: "valve_check", label: "瓶阀检验" },
    itemFields,
    itemTypedFields,
    fieldPipeline: {},
    schemaRules,
  });

  assert.match(signatureHtml, /source-signature-thumb/);
  assert.match(signatureHtml, /\/signatures\/zhangsan\.jpg/);
  assert.match(checkHtml, /<span class="source-field-value">✓<\/span>/);
  assert.doesNotMatch(choiceHtml, /source-choice-chip/);
  assert.match(choiceHtml, /校阀/);
});
