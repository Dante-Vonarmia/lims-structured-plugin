import { applySchemaRulesToMappedFields, buildTypedFieldsFromMapped } from "./row-pipeline.js";
import {
  buildWaitingFieldPipeline,
  buildWaitingGroupPipeline,
  validateFieldStage,
} from "./schema-utils.js";

export function processSchemaRowInGroups({
  rowFields = {},
  rawMapped = {},
  schemaColumns = [],
  schemaGroups = [],
  schemaRules = {},
  progressCallback = null,
}) {
  const cols = Array.isArray(schemaColumns) ? schemaColumns : [];
  const groups = Array.isArray(schemaGroups) ? schemaGroups : [];
  const inputRowFields = (rowFields && typeof rowFields === "object") ? rowFields : {};
  const inputRawMapped = (rawMapped && typeof rawMapped === "object") ? rawMapped : {};
  const fieldPipeline = buildWaitingFieldPipeline(cols, schemaRules);
  const groupPipeline = buildWaitingGroupPipeline(groups);
  const normalizedMapped = {};
  const typedFields = {};

  for (let g = 0; g < groups.length; g += 1) {
    const group = groups[g] || {};
    const groupName = String(group.name || "").trim();
    const groupCols = Array.isArray(group.columns) ? group.columns : [];
    if (!groupName || !groupCols.length) continue;
    if (groupPipeline[groupName]) groupPipeline[groupName].status = "processing";
    if (typeof progressCallback === "function") progressCallback({
      phase: "group_start",
      groupName,
      groupIndex: g,
      groupTotal: groups.length,
    });

    const groupRaw = {};
    for (let i = 0; i < groupCols.length; i += 1) {
      const col = groupCols[i] || {};
      const key = String(col.key || "").trim();
      if (!key) continue;
      const colIdx = Number((col && col.index) || 0);
      const colKey = `col_${String(colIdx + 1).padStart(2, "0")}`;
      const label = String(col.label || "").trim();
      const rawValue = String(
        (Object.prototype.hasOwnProperty.call(inputRawMapped, key)
          ? inputRawMapped[key]
          : (inputRowFields[colKey] ?? inputRowFields[label] ?? ""))
          || ""
      ).trim();
      groupRaw[key] = rawValue;
      if (fieldPipeline[key]) fieldPipeline[key].rawValue = rawValue;
    }

    const groupNormalized = applySchemaRulesToMappedFields(groupRaw, groupCols, schemaRules);
    const groupTyped = buildTypedFieldsFromMapped(groupNormalized, groupCols, schemaRules);

    let parsedCount = 0;
    let warningCount = 0;
    let failedCount = 0;
    for (let i = 0; i < groupCols.length; i += 1) {
      const col = groupCols[i] || {};
      const key = String(col.key || "").trim();
      if (!key || !fieldPipeline[key]) continue;
      const normalizedValue = String(groupNormalized[key] || "").trim();
      const typedValue = groupTyped[key] && typeof groupTyped[key] === "object" ? groupTyped[key] : null;
      fieldPipeline[key].typedValue = typedValue;
      fieldPipeline[key].normalizedValue = normalizedValue;
      fieldPipeline[key].displayValue = typedValue
        ? String((typedValue.display || typedValue.isoDate || normalizedValue || fieldPipeline[key].rawValue || "")).trim()
        : normalizedValue;
      const validated = validateFieldStage(fieldPipeline[key]);
      fieldPipeline[key] = validated;
      normalizedMapped[key] = validated.normalizedValue;
      if (typedValue) typedFields[key] = typedValue;
      if (validated.status === "failed") failedCount += 1;
      else if (validated.status === "warning") warningCount += 1;
      else if (validated.status === "parsed") parsedCount += 1;
    }
    if (groupPipeline[groupName]) {
      groupPipeline[groupName].parsed = parsedCount;
      groupPipeline[groupName].warning = warningCount;
      groupPipeline[groupName].failed = failedCount;
      if (failedCount > 0) groupPipeline[groupName].status = "failed";
      else if (warningCount > 0) groupPipeline[groupName].status = "warning";
      else if (parsedCount > 0) groupPipeline[groupName].status = "parsed";
      else groupPipeline[groupName].status = "waiting";
    }
    if (typeof progressCallback === "function") progressCallback({
      phase: "group_done",
      groupName,
      groupIndex: g,
      groupTotal: groups.length,
      groupStatus: groupPipeline[groupName] ? groupPipeline[groupName].status : "waiting",
    });
  }
  return { normalizedMapped, typedFields, fieldPipeline, groupPipeline };
}

export function waitMs(ms) {
  const n = Number(ms);
  return new Promise((resolve) => setTimeout(resolve, Number.isFinite(n) ? Math.max(0, n) : 0));
}
