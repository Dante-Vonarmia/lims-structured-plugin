export function createCatalogWorkflowFeature(deps = {}) {
  const {
    $,
    state,
    setButtonText,
    isPlaceholderValue,
    normalizeCatalogToken,
    renderCatalogReadyHint,
    renderMeasurementCatalogNameOptions,
    getActiveItem,
    getRenderTargetFieldForm,
    getApplyTargetFieldProblemStyles,
    getRenderQueue,
    renderTemplateSelect,
    appendLog,
    loadRuntimeConfigApi,
    listTemplatesApi,
    uploadFileApi,
    parseInstrumentCatalogApi,
    autoLoadInstrumentCatalogApi,
  } = deps;

  async function loadRuntimeConfig() {
    try {
      const data = await loadRuntimeConfigApi();
      state.runtime.offlineMode = !!data.offline_mode;
    } catch (error) {
      // noop
    }
  }

  async function loadTemplates() {
    const data = await listTemplatesApi();
    state.templates = data.templates || [];
    renderTemplateSelect();
    appendLog(`模板加载完成，共 ${state.templates.length} 个`);
  }

  async function uploadFile(file) {
    const data = await uploadFileApi(file);
    appendLog(`上传成功：${data.file_name || file.name} -> ${data.file_id}`);
    return data;
  }

  function setInstrumentCatalog(names, fileName = "", rows = []) {
    const normalizedRows = Array.isArray(rows)
      ? rows.map((row) => ({
        name: String((row && row.name) || "").trim(),
        model: String((row && row.model) || "").trim(),
        code: String((row && row.code) || "").trim(),
        measurement_range: String((row && row.measurement_range) || "").trim(),
        uncertainty: String((row && row.uncertainty) || "").trim(),
        certificate_no: String((row && row.certificate_no) || "").trim(),
        valid_date: String((row && row.valid_date) || "").trim(),
        traceability_institution: String((row && row.traceability_institution) || "").trim(),
      }))
      : [];
    const normalizedNames = Array.isArray(names)
      ? names.map((x) => String(x || "").trim()).filter((x) => !!x && !isPlaceholderValue(x))
      : [];
    const deduped = [];
    const dedupedRows = [];
    const tokenSet = new Set();
    const rowByToken = new Map();
    normalizedRows.forEach((row) => {
      const token = normalizeCatalogToken(row.name);
      if (!token || tokenSet.has(token)) return;
      tokenSet.add(token);
      deduped.push(row.name);
      dedupedRows.push(row);
      rowByToken.set(token, row);
    });
    normalizedNames.forEach((name) => {
      const token = normalizeCatalogToken(name);
      if (!token || tokenSet.has(token)) return;
      tokenSet.add(token);
      deduped.push(name);
      const row = {
        name,
        model: "",
        code: "",
        measurement_range: "",
        uncertainty: "",
        certificate_no: "",
        valid_date: "",
        traceability_institution: "",
      };
      dedupedRows.push(row);
      rowByToken.set(token, row);
    });
    state.instrumentCatalogNames = deduped;
    state.instrumentCatalogRows = dedupedRows;
    state.instrumentCatalogRowByToken = rowByToken;
    state.instrumentCatalogTokenSet = tokenSet;
    state.instrumentCatalogFileName = String(fileName || "").trim();
    const uploadBtn = $("uploadInstrumentCatalogBtn");
    if (uploadBtn) setButtonText(uploadBtn, deduped.length ? "重装计量标准器具目录" : "装填计量标准器具目录");
    renderCatalogReadyHint();
    renderMeasurementCatalogNameOptions();
    const active = getActiveItem();
    if (active) {
      const renderTargetFieldForm = typeof getRenderTargetFieldForm === "function" ? getRenderTargetFieldForm() : null;
      const applyTargetFieldProblemStyles = typeof getApplyTargetFieldProblemStyles === "function" ? getApplyTargetFieldProblemStyles() : null;
      if (typeof renderTargetFieldForm === "function") renderTargetFieldForm(active);
      if (typeof applyTargetFieldProblemStyles === "function") applyTargetFieldProblemStyles(active);
    }
    const renderQueue = typeof getRenderQueue === "function" ? getRenderQueue() : null;
    if (typeof renderQueue === "function") renderQueue();
  }

  async function parseInstrumentCatalog(file) {
    return parseInstrumentCatalogApi(file);
  }

  async function autoLoadInstrumentCatalog() {
    try {
      const data = await autoLoadInstrumentCatalogApi();
      if (!data || !data.loaded) return;
      setInstrumentCatalog((data.names || []), (data.file_name || ""), (data.rows || []));
      appendLog(`自动装填计量标准器具目录：${data.file_name || "未命名文件"}（${data.total || 0} 项）`);
    } catch (error) {
      appendLog(`自动装填目录失败：${error.message || "unknown"}`);
    }
  }

  return {
    loadRuntimeConfig,
    loadTemplates,
    uploadFile,
    setInstrumentCatalog,
    parseInstrumentCatalog,
    autoLoadInstrumentCatalog,
  };
}
