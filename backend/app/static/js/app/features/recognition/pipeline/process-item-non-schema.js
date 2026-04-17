import { handleMultiBlocksPath } from "./process-item-multi-blocks.js";
import { handleSingleRecordPath } from "./process-item-single-record.js";

export async function handleNonSchemaBranch(deps = {}) {
  const {
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
  } = deps;

  const ext = extFromName(item.fileName || "");

  if (ext === ".docx") {
    const docxStruct = (item.ocrStructured && item.ocrStructured.docx) || {};
    const embeddedExcelCount = Number(docxStruct.embedded_excel_count || 0);
    const chartCount = Number(docxStruct.chart_count || 0);
    if (embeddedExcelCount > 0 || chartCount > 0) {
      appendLog(`DOCX内嵌对象检测 ${item.fileName}：Excel=${embeddedExcelCount} 图表=${chartCount}`);
    }
  }
  const blocks = (ext === ".docx" || forceAsWord) ? [item.rawText] : splitRecordBlocks(item.rawText);
  item.recordCount = Math.max(blocks.length, 1);
  let structuredInstrumentData = null;
  let generalCheckStructureData = null;
  if (ext === ".docx" && item.fileId) {
    try {
      const extracted = await runInstrumentTableExtract(item.fileId);
      if (extracted && Number(extracted.total || 0) > 0 && String(extracted.tsv || "").trim()) {
        structuredInstrumentData = extracted;
      }
    } catch (error) {
      appendLog(`结构化气瓶表提取失败 ${item.fileName}：${error.message || "unknown"}`);
    }
    try {
      const structRes = await runGeneralCheckStructureExtract(item.fileId);
      const tableModel = structRes && structRes.table && typeof structRes.table === "object" ? structRes.table : null;
      const hasSingle = !!(tableModel && Array.isArray(tableModel.cells) && tableModel.cells.length);
      const hasMulti = !!(tableModel && Array.isArray(tableModel.tables) && tableModel.tables.length);
      if (hasSingle || hasMulti) {
        generalCheckStructureData = structRes.table;
      }
    } catch (error) {
      appendLog(`续页结构提取失败 ${item.fileName}：${error.message || "unknown"}`);
    }
  }
  item.generalCheckStruct = generalCheckStructureData;

  const multiBlocksHandled = await handleMultiBlocksPath({
    blocks,
    item,
    state,
    createEmptyFields,
    runExtract,
    applyStructuredMeasurementItems,
    structuredInstrumentData,
    extractTemplateCode,
    inferCategory,
    buildCategoryMessage,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    generalCheckStructureData,
  });
  if (multiBlocksHandled) {
    return;
  }

  await handleSingleRecordPath({
    item,
    state,
    ext,
    createEmptyFields,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    runExtract,
    applyStructuredMeasurementItems,
    resolveSourceCode,
    inferCategory,
    buildMultiDeviceWordItems,
    appendLog,
    structuredInstrumentData,
    generalCheckStructureData,
  });
}
