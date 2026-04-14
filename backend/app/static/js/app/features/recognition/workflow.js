import { waitMs } from "./pipeline/group-pipeline.js";
import { createReplaceSourceWithRowsProgressively } from "./pipeline/progressive-rows.js";
import { handleForcedExcelSingleBranch } from "./pipeline/process-item-forced-excel.js";
import { handleExcelSingleBranch } from "./pipeline/process-item-excel.js";
import { handleRecordRowBranch } from "./pipeline/process-item-record-row.js";
import { handleGeneralBranch } from "./pipeline/process-item-general.js";

export function createRecognitionWorkflowFeature(deps = {}) {
  const {
    state,
    isExcelItem,
    createEmptyFields,
    uploadFile,
    runExcelInspect,
    buildExcelRecordItems,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    runOcr,
    extFromName,
    splitRecordBlocks,
    runInstrumentTableExtract,
    appendLog,
    runGeneralCheckStructureExtract,
    runExtract,
    applyStructuredMeasurementItems,
    inferCategory,
    extractTemplateCode,
    buildCategoryMessage,
    resolveSourceCode,
    buildMultiDeviceWordItems,
  } = deps;

  const replaceSourceWithRowsProgressively = createReplaceSourceWithRowsProgressively({
    state,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    waitMs,
  });

  async function processItem(item) {
    const forcedMode = String(item && item.recognitionOverride ? item.recognitionOverride : "").trim().toLowerCase();
    const forceAsExcel = forcedMode === "excel";
    const forceAsWord = forcedMode === "word";
    const recordRowHandled = await handleRecordRowBranch({
      item,
      applyAutoTemplateMatch,
      renderQueue,
      renderTemplateSelect,
    });
    if (recordRowHandled) return;
    const forcedExcelHandled = await handleForcedExcelSingleBranch({
      item,
      forceAsExcel,
      isExcelItem,
      renderQueue,
      uploadFile,
      runOcr,
      runExtract,
      createEmptyFields,
      buildExcelRecordItems,
      applyAutoTemplateMatch,
      state,
      appendLog,
      renderTemplateSelect,
    });
    if (forcedExcelHandled) return;
    const excelHandled = await handleExcelSingleBranch({
      item,
      forceAsExcel,
      isExcelItem,
      renderQueue,
      uploadFile,
      runExcelInspect,
      buildExcelRecordItems,
      applyAutoTemplateMatch,
      state,
      renderTemplateSelect,
    });
    if (excelHandled) return;
    await handleGeneralBranch({
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
    });
  }

  return { processItem };
}
