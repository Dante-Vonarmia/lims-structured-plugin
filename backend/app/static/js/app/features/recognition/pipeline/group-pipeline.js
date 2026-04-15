import { applySchemaRulesToMappedFields, buildTypedFieldsFromMapped } from "./row-pipeline.js";
import {
  buildWaitingFieldPipeline,
  buildWaitingGroupPipeline,
  validateFieldStage,
} from "./schema-utils.js";

export function processSchemaRowInGroups({
  rowFields = {},
  rawMapped = {},
  fieldWarnings = {},
  schemaColumns = [],
  schemaGroups = [],
  schemaRules = {},
  progressCallback = null,
}) {
  const hasValveConflictFromRaw = (rawValue) => {
    const text = String(rawValue || "").trim();
    if (!text) return false;
    const hasCal = /(校阀|校调|校調|收阀|收调|政调|农调|回校)/i.test(text);
    const hasSwap = /(换阀|換阀|换间|换询|换具|换惘|換間|换网)/i.test(text);
    if (!(hasCal && hasSwap)) return false;
    const calChecked = /(?:☑|√|✓|V|v)\s*(?:校阀|校调|校調|收阀|收调|政调|农调|回校)/i.test(text);
    const swapChecked = /(?:☑|√|✓|V|v)\s*(?:换阀|換阀|换间|换询|换具|换惘|換間|换网)/i.test(text);
    if (calChecked !== swapChecked) return false;
    const calUnchecked = /(?:□|口|☐|◻)\s*(?:校阀|校调|校調|收阀|收调|政调|农调|回校)/i.test(text);
    const swapUnchecked = /(?:□|口|☐|◻)\s*(?:换阀|換阀|换间|换询|换具|换惘|換間|换网)/i.test(text);
    if (calUnchecked !== swapUnchecked) return false;
    return true;
  };
  const cols = Array.isArray(schemaColumns) ? schemaColumns : [];
  const groups = Array.isArray(schemaGroups) ? schemaGroups : [];
  const inputRowFields = (rowFields && typeof rowFields === "object") ? rowFields : {};
  const inputRawMapped = (rawMapped && typeof rawMapped === "object") ? rawMapped : {};
  const inputFieldWarnings = (fieldWarnings && typeof fieldWarnings === "object") ? fieldWarnings : {};
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
    const groupWarningMap = {};
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
      groupWarningMap[key] = String(inputFieldWarnings[key] || "").trim();
      if (!groupWarningMap[key] && String((fieldPipeline[key] && fieldPipeline[key].type) || "").trim() === "checkbox_choice") {
        if (hasValveConflictFromRaw(rawValue)) {
          groupWarningMap[key] = "瓶阀检验冲突：同一行同时命中“校阀”和“换阀”，已置空";
        }
      }
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
      const warningText = String(groupWarningMap[key] || "").trim();
      fieldPipeline[key].typedValue = typedValue;
      fieldPipeline[key].normalizedValue = normalizedValue;
      fieldPipeline[key].displayValue = typedValue
        ? String((typedValue.display || typedValue.isoDate || normalizedValue || fieldPipeline[key].rawValue || "")).trim()
        : normalizedValue;
      if (warningText) {
        fieldPipeline[key].rawValue = "";
        fieldPipeline[key].normalizedValue = "";
        fieldPipeline[key].displayValue = "";
        fieldPipeline[key].warnings = Array.isArray(fieldPipeline[key].warnings) ? fieldPipeline[key].warnings : [];
        fieldPipeline[key].warnings.push(warningText);
      }
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
