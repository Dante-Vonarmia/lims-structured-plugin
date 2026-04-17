export function createRuntimeCommonFeature(deps = {}) {
  const {
    state,
    SUPPORTED_EXTS,
  } = deps;

  function normalizeForCodeMatch(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, "");
  }

  function extractTemplateCode(value) {
    const normalized = normalizeForCodeMatch(value);
    const match = normalized.match(/(?:r[-_ ]?)?(\d{3}[a-z])/i);
    return match && match[1] ? `r-${String(match[1]).toLowerCase()}` : "";
  }

  function resolveSourceCode(item) {
    if (!item) return "";
    return extractTemplateCode(`${item.fileName || ""}\n${item.rawText || ""}`);
  }

  function resolveTemplateCode(templateName) {
    return extractTemplateCode(templateName || "");
  }

  function isExcelExt(ext) { return ext === ".xlsx" || ext === ".xls"; }
  function extFromName(name) {
    const idx = (name || "").lastIndexOf(".");
    return idx < 0 ? "" : name.slice(idx).toLowerCase();
  }
  function isExcelItem(item) { return !!(item && !item.isRecordRow && isExcelExt(extFromName(item.fileName))); }
  function isSupportedFile(file) { return !!(file && SUPPORTED_EXTS.has(extFromName(file.name || ""))); }

  function shouldUseBlankFallback() { return true; }

  function resolveBlankTemplateName() {
    const exact = state.templates.find((n) => n === "R-802B 空白.docx");
    if (exact) return exact;
    return state.templates.find((n) => normalizeForCodeMatch(n).includes("r802b")) || "";
  }

  function getModelCodeDisplay(item) {
    const fields = (item && item.fields) || {};
    const clean = (v) => String(v || "")
      .replace(/^(?:型号\/编号|型号规格|型号|编号)\s*[:：]?\s*/g, "")
      .trim();
    let model = clean(fields.device_model || "");
    if (/^\/?\s*编号\s*[:：]?\s*$/.test(model) || model === "/") model = "";
    return model || "";
  }

  function getDeviceCodeDisplay(item) {
    const fields = (item && item.fields) || {};
    const value = String(fields.device_code || "")
      .replace(/^(?:气瓶编号|设备编号|编号)\s*[:：]?\s*/g, "")
      .trim();
    if (/^\/?\s*编号\s*[:：]?\s*$/.test(value) || value === "/") return "";
    return value;
  }

  return {
    normalizeForCodeMatch,
    extractTemplateCode,
    resolveSourceCode,
    resolveTemplateCode,
    isExcelExt,
    extFromName,
    isExcelItem,
    isSupportedFile,
    shouldUseBlankFallback,
    resolveBlankTemplateName,
    getModelCodeDisplay,
    getDeviceCodeDisplay,
  };
}
