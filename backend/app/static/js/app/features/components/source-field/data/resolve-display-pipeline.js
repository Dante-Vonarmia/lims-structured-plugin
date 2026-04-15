import { processSchemaRowInGroups } from "../../../recognition/pipeline/group-pipeline.js";

function hasRenderableFieldPipeline(fieldPipeline = {}) {
  const pipeline = (fieldPipeline && typeof fieldPipeline === "object") ? fieldPipeline : {};
  return Object.values(pipeline).some((cell) => {
    if (!cell || typeof cell !== "object") return false;
    const status = String(cell.status || "").trim();
    const rawValue = String(cell.rawValue || "").trim();
    const normalizedValue = String(cell.normalizedValue || "").trim();
    const displayValue = String(cell.displayValue || "").trim();
    return !!(rawValue || normalizedValue || displayValue || (status && status !== "waiting"));
  });
}

function hasRenderableGroupPipeline(groupPipeline = {}) {
  const pipeline = (groupPipeline && typeof groupPipeline === "object") ? groupPipeline : {};
  return Object.values(pipeline).some((group) => {
    if (!group || typeof group !== "object") return false;
    return Number(group.parsed || 0) > 0
      || Number(group.warning || 0) > 0
      || Number(group.failed || 0) > 0
      || String(group.status || "").trim() !== "waiting";
  });
}

export function resolveDisplayFieldState({
  item,
  schemaColumns = [],
  schemaGroups = [],
  schemaRules = {},
} = {}) {
  const currentItem = (item && typeof item === "object") ? item : {};
  const itemFields = (currentItem.fields && typeof currentItem.fields === "object") ? currentItem.fields : {};
  const itemRecognizedFields = (currentItem.recognizedFields && typeof currentItem.recognizedFields === "object")
    ? currentItem.recognizedFields
    : {};
  const itemTypedFields = (currentItem.typedFields && typeof currentItem.typedFields === "object") ? currentItem.typedFields : {};
  const fieldPipeline = (currentItem.fieldPipeline && typeof currentItem.fieldPipeline === "object") ? currentItem.fieldPipeline : {};
  const groupPipeline = (currentItem.groupPipeline && typeof currentItem.groupPipeline === "object") ? currentItem.groupPipeline : {};

  if (hasRenderableFieldPipeline(fieldPipeline) || hasRenderableGroupPipeline(groupPipeline)) {
    return {
      itemFields,
      itemTypedFields,
      fieldPipeline,
      groupPipeline,
    };
  }

  const rawMapped = Object.keys(itemRecognizedFields).length ? itemRecognizedFields : itemFields;
  const rebuilt = processSchemaRowInGroups({
    rowFields: {},
    rawMapped,
    schemaColumns,
    schemaGroups,
    schemaRules,
  });

  return {
    itemFields,
    itemTypedFields: Object.keys(itemTypedFields).length ? itemTypedFields : rebuilt.typedFields,
    fieldPipeline: rebuilt.fieldPipeline,
    groupPipeline: rebuilt.groupPipeline,
  };
}
