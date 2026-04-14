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
