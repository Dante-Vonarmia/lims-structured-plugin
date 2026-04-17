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

  async function processItem(item, options = {}) {
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const reportProgress = (phase, progress, message = "") => {
      if (!onProgress) return;
      onProgress({
        phase: String(phase || "").trim(),
        progress: Number(progress) || 0,
        message: String(message || "").trim(),
      });
    };

    const forcedMode = String(item && item.recognitionOverride ? item.recognitionOverride : "").trim().toLowerCase();
    const forceAsExcel = forcedMode === "excel";
    const forceAsWord = forcedMode === "word";
    reportProgress("init", 5, "准备识别");
    const recordRowHandled = await handleRecordRowBranch({
      item,
      applyAutoTemplateMatch,
      renderQueue,
      renderTemplateSelect,
    });
    if (recordRowHandled) {
      reportProgress("done", 100, "识别完成");
      return;
    }
    reportProgress("route", 12, "识别分支判断中");
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
    if (forcedExcelHandled) {
      reportProgress("done", 100, "识别完成");
      return;
    }
    reportProgress("excel", 20, "Excel识别中");
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
      progressCallback: reportProgress,
    });
    if (excelHandled) {
      reportProgress("done", 100, "识别完成");
      return;
    }
    reportProgress("ocr", 25, "OCR识别中");
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
      progressCallback: reportProgress,
    });
    reportProgress("done", 100, "识别完成");
  }

  return { processItem };
}
