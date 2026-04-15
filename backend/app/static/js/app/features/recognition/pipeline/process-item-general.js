import {
  getSchemaColumnsFromState,
  getSchemaGroupsFromState,
  getSchemaRulesFromState,
} from "./schema-utils.js";
import { handleSchemaTableBranch } from "./process-item-schema-table.js";
import { handleNonSchemaBranch } from "./process-item-non-schema.js";

export async function handleGeneralBranch(deps = {}) {
  const {
    item,
    state,
    forceAsWord,
    createEmptyFields,
    uploadFile,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    runOcr,
    runInstrumentTableExtract,
    runGeneralCheckStructureExtract,
    extFromName,
    splitRecordBlocks,
    runExtract,
    applyStructuredMeasurementItems,
    inferCategory,
    extractTemplateCode,
    buildCategoryMessage,
    resolveSourceCode,
    buildMultiDeviceWordItems,
    appendLog,
    replaceSourceWithRowsProgressively,
  } = deps;

  item.status = "processing";
  item.message = "上传中";
  item.reportId = "";
  item.reportDownloadUrl = "";
  item.reportFileName = "";
  item.reportGenerateMode = "";
  item.modeReports = {};
  renderQueue();

  if (!item.fileId) {
    const up = await uploadFile(item.file);
    item.fileId = up.file_id;
  }

  const schemaColumns = getSchemaColumnsFromState(state);
  const schemaRules = getSchemaRulesFromState(state);
  const schemaGroups = getSchemaGroupsFromState(state, schemaColumns);
  item.message = "识别中";
  renderQueue();
  const ocr = await runOcr(item.fileId);
  item.rawText = ocr.raw_text || "";
  item.ocrEngine = String((ocr && ocr.engine) || "").trim();
  item.ocrStructured = (ocr && ocr.structured) || {};
  const structuredRowsRaw = Array.isArray(item.ocrStructured && item.ocrStructured.row_records)
    ? item.ocrStructured.row_records
    : [];
  const tableCells = Array.isArray(item.ocrStructured && item.ocrStructured.table_cells)
    ? item.ocrStructured.table_cells
    : [];
  const reviewQueue = Array.isArray(item.ocrStructured && item.ocrStructured.review_queue)
    ? item.ocrStructured.review_queue
    : [];
  const schemaHandled = await handleSchemaTableBranch({
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
    ocrEngine: item.ocrEngine,
  });
  if (schemaHandled) return;
  await handleNonSchemaBranch({
    item,
    state,
    forceAsWord,
    createEmptyFields,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    runInstrumentTableExtract,
    runGeneralCheckStructureExtract,
    extFromName,
    splitRecordBlocks,
    runExtract,
    applyStructuredMeasurementItems,
    inferCategory,
    extractTemplateCode,
    buildCategoryMessage,
    resolveSourceCode,
    buildMultiDeviceWordItems,
    appendLog,
  });
}
