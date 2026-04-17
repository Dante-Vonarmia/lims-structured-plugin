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
    progressCallback,
  } = deps;
  const reportProgress = (phase, progress, message = "") => {
    if (typeof progressCallback !== "function") return;
    progressCallback(phase, progress, message);
  };

  reportProgress("upload", 30, "上传文件中");
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
  reportProgress("ocr", 55, "OCR识别中");
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
  const hasRawText = !!String(item.rawText || "").trim();
  const hasStructuredRows = structuredRowsRaw.length > 0;
  const hasStructuredCells = tableCells.some((cell) => {
    const finalText = String((cell && cell.final_text) || "").trim();
    const rawCellText = String((cell && cell.raw_text) || "").trim();
    return !!(finalText || rawCellText);
  });
  if (!hasRawText && !hasStructuredRows && !hasStructuredCells) {
    const quality = item && item.ocrStructured && item.ocrStructured.image_quality;
    const qualitySummary = String((quality && quality.summary) || "").trim();
    const baseMessage = item.ocrEngine && item.ocrEngine !== "none"
      ? `OCR未提取到有效内容（引擎：${item.ocrEngine}）`
      : "OCR未提取到有效内容（引擎不可用或结果为空）";
    item.status = "error";
    item.message = qualitySummary ? `${baseMessage}；${qualitySummary}` : baseMessage;
    renderQueue();
    renderTemplateSelect();
    throw new Error(item.message);
  }
  reportProgress("parse", 75, schemaColumns.length ? "结构化解析中" : "文本解析中");
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
  if (schemaHandled) {
    reportProgress("match", 92, "模板匹配中");
    return;
  }
  reportProgress("match", 92, "模板匹配中");
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
