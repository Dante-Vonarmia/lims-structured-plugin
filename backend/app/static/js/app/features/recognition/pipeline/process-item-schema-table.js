import {
  buildWaitingFieldPipeline,
  buildWaitingGroupPipeline,
} from "./schema-utils.js";
import { handleStructuredRowsPath } from "./process-item-schema-structured-rows.js";
import { handleDataLinesPath } from "./process-item-schema-data-lines.js";

export async function handleSchemaTableBranch(deps = {}) {
  const {
    item,
    state,
    schemaColumns,
    schemaRules,
    schemaGroups,
    createEmptyFields,
    renderQueue,
    renderTemplateSelect,
    reviewQueue,
    tableCells,
    resolveSourceCode,
    inferCategory,
    replaceSourceWithRowsProgressively,
    appendLog,
    structuredRowsRaw,
    ocrEngine,
  } = deps;

  if (!schemaColumns.length) return false;

  item.fieldPipeline = buildWaitingFieldPipeline(schemaColumns, schemaRules);
  item.groupPipeline = buildWaitingGroupPipeline(schemaGroups);
  item.message = `模板骨架已加载，待识别板块 0/${Math.max(1, schemaGroups.length)}`;
  renderQueue();

  const structuredRowsHandled = await handleStructuredRowsPath({
    item,
    schemaColumns,
    schemaRules,
    schemaGroups,
    createEmptyFields,
    reviewQueue,
    tableCells,
    resolveSourceCode,
    inferCategory,
    replaceSourceWithRowsProgressively,
    appendLog,
    renderQueue,
  });
  if (structuredRowsHandled) return true;
  const structuredRowsCount = Array.isArray(structuredRowsRaw) ? structuredRowsRaw.length : 0;
  const tableCellsCount = Array.isArray(tableCells) ? tableCells.length : 0;
  const reviewQueueCount = Array.isArray(reviewQueue) ? reviewQueue.length : 0;
  const isDenseFixedTemplate = schemaColumns.length >= 30;
  const shouldWarnTextFallback = isDenseFixedTemplate && structuredRowsCount <= 0 && tableCellsCount <= 0;
  item.ocrDebug = {
    engine: String(ocrEngine || ""),
    schemaColumns: schemaColumns.length,
    structuredRowsCount,
    tableCellsCount,
    reviewQueueCount,
    textFallbackBlocked: false,
    textFallbackWarning: shouldWarnTextFallback,
    reason: shouldWarnTextFallback ? "structured_table_not_hit_for_dense_template" : "",
  };
  if (shouldWarnTextFallback) {
    appendLog(`结构化表格未命中，降级至文本行回退：${item.fileName}`);
  }
  const dataLinesHandled = await handleDataLinesPath({
    item,
    schemaColumns,
    schemaRules,
    schemaGroups,
    createEmptyFields,
    resolveSourceCode,
    inferCategory,
    replaceSourceWithRowsProgressively,
    appendLog,
  });
  if (dataLinesHandled) return true;
  item.fields = { ...createEmptyFields(), raw_record: item.rawText || "" };
  item.recognizedFields = { ...item.fields };
  item.fieldPipeline = buildWaitingFieldPipeline(schemaColumns, schemaRules);
  item.groupPipeline = buildWaitingGroupPipeline(schemaGroups);
  item.status = "ready";
  item.message = "未识别到表格数据行";
  renderQueue();
  renderTemplateSelect();
  return true;
}
