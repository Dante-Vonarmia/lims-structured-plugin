export function createRuntimeApisFeature(deps = {}) {
  const {
    runOcrApi,
    runExtractApi,
    runInstrumentTableExtractApi,
    runGeneralCheckStructureExtractApi,
    runDocxEmbeddedInspectApi,
    runTemplateMatchApi,
    runTemplateFeedbackApi,
    runExcelInspectApi,
    runExcelPreviewApi,
    runTemplateTextPreviewApi,
    runTemplateEditorSchemaApi,
    parseTableRowsFromBlock,
  } = deps;

  async function runOcr(fileId) {
    return runOcrApi(fileId);
  }

  async function runExtract(rawText) {
    return runExtractApi(rawText);
  }

  async function runInstrumentTableExtract(fileId) {
    return runInstrumentTableExtractApi(fileId);
  }

  async function runGeneralCheckStructureExtract(fileId) {
    return runGeneralCheckStructureExtractApi(fileId);
  }

  async function runDocxEmbeddedInspect(fileId) {
    return runDocxEmbeddedInspectApi(fileId);
  }

  function applyStructuredMeasurementItems(fields, extractData) {
    if (!fields || typeof fields !== "object") return false;
    const tsv = String((extractData && extractData.tsv) || "").trim();
    if (!tsv) return false;
    const tableRows = parseTableRowsFromBlock(tsv);
    if (!tableRows || tableRows.length < 2) return false;
    fields.measurement_items = tableRows.map((row) => row.join("\t")).join("\n");
    fields.measurement_item_count = String(Math.max(0, tableRows.length - 1));
    fields.measurement_items_source = "structured";
    return true;
  }

  async function runTemplateMatch(rawText, fileName, extra = {}) {
    return runTemplateMatchApi(rawText, fileName, extra);
  }

  async function runTemplateFeedback(payload) {
    return runTemplateFeedbackApi(payload);
  }

  async function runExcelInspect(fileId, defaultTemplateName) {
    return runExcelInspectApi(fileId, defaultTemplateName);
  }

  async function runExcelPreview(fileId, sheetName = "") {
    return runExcelPreviewApi(fileId, sheetName);
  }

  async function runTemplateTextPreview(templateName) {
    return runTemplateTextPreviewApi(templateName);
  }

  async function runTemplateEditorSchema(templateName) {
    return runTemplateEditorSchemaApi(templateName);
  }

  return {
    runOcr,
    runExtract,
    runInstrumentTableExtract,
    runGeneralCheckStructureExtract,
    runDocxEmbeddedInspect,
    applyStructuredMeasurementItems,
    runTemplateMatch,
    runTemplateFeedback,
    runExcelInspect,
    runExcelPreview,
    runTemplateTextPreview,
    runTemplateEditorSchema,
  };
}
