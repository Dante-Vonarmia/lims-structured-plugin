import { getTemplateInfoValue } from "../shared/template-info-utils.js";

export function createRuntimeListUiFeature(deps = {}) {
  const {
    $,
    state,
    FILTER_BLANK_TOKEN,
    toDateOnlyDisplay,
    getModelCodeDisplay,
    getDeviceCodeDisplay,
    isExcelItem,
    escapeAttr,
    setPreviewPlaceholder,
    getRefreshActionButtons,
    getRenderQueue,
    getRenderTemplateSelect,
    getRenderPreviews,
    getRenderTargetFieldForm,
    getApplyTargetFieldProblemStyles,
    getRenderSourceFieldList,
    getRenderSourcePreview,
    refreshActionButtonsFallback,
    setButtonText,
  } = deps;

  function getActiveItem() {
    return state.queue.find((x) => x.id === state.activeId) || null;
  }

  function getSchemaColumns() {
    const schema = (state.taskContext && state.taskContext.import_template_schema && typeof state.taskContext.import_template_schema === "object")
      ? state.taskContext.import_template_schema
      : { columns: [] };
    return Array.isArray(schema.columns) ? schema.columns : [];
  }

  function isTypingTarget(target) {
    if (!target || !(target instanceof HTMLElement)) return false;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
    return !!target.closest("input, textarea, select, [contenteditable='true']");
  }

  async function navigateActiveItem(step) {
    const list = getFilteredSortedQueue();
    if (!Array.isArray(list) || !list.length) return;
    const currentIndex = list.findIndex((x) => x && x.id === state.activeId);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(list.length - 1, safeIndex + step));
    const nextItem = list[nextIndex];
    if (!nextItem || nextItem.id === state.activeId) return;
    state.activeId = nextItem.id;
    state.selectedIds.clear();
    state.selectedIds.add(nextItem.id);
    state.listFilter.activeFilterKey = "";
    const renderQueue = typeof getRenderQueue === "function" ? getRenderQueue() : null;
    const renderTemplateSelect = typeof getRenderTemplateSelect === "function" ? getRenderTemplateSelect() : null;
    const renderPreviews = typeof getRenderPreviews === "function" ? getRenderPreviews() : null;
    if (typeof renderQueue === "function") renderQueue();
    if (typeof renderTemplateSelect === "function") renderTemplateSelect();
    if (typeof renderPreviews === "function") await renderPreviews();
  }

  function getGenerateMode() {
    return "source_file";
  }

  function setFullscreenButtonUi(isFullscreen) {
    const btn = $("togglePreviewFullscreenBtn");
    if (!btn) return;
    setButtonText(btn, isFullscreen ? "退出全屏" : "预览全屏");
    const icon = btn.querySelector(".btn-icon");
    if (!icon) return;
    icon.classList.remove("fa-expand", "fa-compress");
    icon.classList.add(isFullscreen ? "fa-compress" : "fa-expand");
  }

  function syncGenerateModeUiText() {
    const isModifyCertificate = getGenerateMode() === "source_file";
    const previewTabBtn = $("rightTabPreviewBtn");
    if (previewTabBtn) {
      setButtonText(previewTabBtn, isModifyCertificate ? "导出预览" : "原始记录预览");
    }
    const generatePreviewBtn = $("generatePreviewBtn");
    if (generatePreviewBtn) {
      setButtonText(generatePreviewBtn, "开始生成");
    }
    const targetPaneTitle = $("targetPaneTitle");
    if (targetPaneTitle) {
      targetPaneTitle.textContent = isModifyCertificate ? "导出模版" : "原始记录模板";
    }
    const templateSearch = $("templateSearch");
    if (templateSearch) {
      templateSearch.placeholder = isModifyCertificate ? "导出模版（当前固定）" : "搜索并选择模板";
      templateSearch.readOnly = isModifyCertificate;
    }
    const useBlankTemplateBtn = $("useBlankTemplateBtn");
    if (useBlankTemplateBtn) {
      useBlankTemplateBtn.style.display = isModifyCertificate ? "none" : "";
    }
    const templateFeedbackBtn = $("templateFeedbackBtn");
    if (templateFeedbackBtn) {
      templateFeedbackBtn.style.display = isModifyCertificate ? "none" : "";
    }
  }

  function readListColumnValue(item, key) {
    const f = item.fields || {};
    const taskTemplateInfo = (state.taskContext && state.taskContext.template_info && typeof state.taskContext.template_info === "object")
      ? state.taskContext.template_info
      : {};
    const schemaRules = (state.taskContext && state.taskContext.import_template_schema && state.taskContext.import_template_schema.rules
      && typeof state.taskContext.import_template_schema.rules === "object")
      ? state.taskContext.import_template_schema.rules
      : {};
    if (getSchemaColumns().some((field) => String((field && field.key) || "").trim() === key)) {
      return getTemplateInfoValue({
        item,
        taskTemplateInfo,
        key,
        schemaRules,
      });
    }
    if (key === "recordName") return String(item.recordName || "");
    if (key === "device_name") return String(f.device_name || "");
    if (key === "model_code") return String(getModelCodeDisplay(item) || "");
    if (key === "device_code") return String(getDeviceCodeDisplay(item) || "");
    if (key === "power_rating") return String(f.power_rating || "");
    if (key === "manufacture_date") return String(toDateOnlyDisplay(f.manufacture_date || ""));
    if (key === "contact_info") return String(f.contact_info || "");
    if (key === "measurement_item_count") return String(f.measurement_item_count || "");
    if (key === "ocr_quality") {
      const quality = item && item.ocrStructured && item.ocrStructured.image_quality;
      const score = Number(quality && quality.score);
      if (!Number.isFinite(score)) return "";
      const safe = Math.max(0, Math.min(100, Math.round(score)));
      return `${safe}/100`;
    }
    if (key === "manufacturer") return String(f.manufacturer || "");
    if (key === "use_department") return String(f.use_department || "");
    if (key === "unit_name") return String(f.unit_name || "");
    if (key === "address") return String(f.address || "");
    if (key === "status") return String(item.status || "");
    if (key === "templateName") return String(item.templateName || "");
    return "";
  }

  function isListBlankField(value) {
    const text = String(value || "").trim();
    if (!text) return true;
    return /^[\s\/-]+$/.test(text);
  }

  function normalizeListFilterToken(value) {
    const text = String(value || "").trim();
    if (isListBlankField(text)) return FILTER_BLANK_TOKEN;
    return text;
  }

  function formatListFilterLabel(token) {
    return token === FILTER_BLANK_TOKEN ? "(空)" : token;
  }

  function getKeywordStatusFilteredQueue() {
    const keyword = String(state.listFilter.keyword || "").trim().toLowerCase();
    const status = String(state.listFilter.status || "").trim();
    return state.queue.filter((item) => {
      if (status && item.status !== status) return false;
      if (!keyword) return true;
      const f = item.fields || {};
      const text = [
        item.recordName || "",
        ...(getSchemaColumns().map((field) => readListColumnValue(item, String((field && field.key) || "").trim()))),
        f.device_name || "",
        f.device_model || "",
        f.device_code || "",
        f.manufacturer || "",
        f.use_department || "",
        f.unit_name || "",
        f.address || "",
        item.templateName || "",
        item.category || "",
        item.message || "",
      ].join(" ").toLowerCase();
      return text.includes(keyword);
    });
  }

  function getColumnFilterOptionEntries(key, sourceItems = null) {
    const counts = new Map();
    const baseItems = Array.isArray(sourceItems) ? sourceItems : getKeywordStatusFilteredQueue();
    baseItems.forEach((item) => {
      const token = normalizeListFilterToken(readListColumnValue(item, key));
      counts.set(token, (counts.get(token) || 0) + 1);
    });
    const sortedTokens = Array.from(counts.keys()).sort((a, b) => {
      if (a === FILTER_BLANK_TOKEN) return -1;
      if (b === FILTER_BLANK_TOKEN) return 1;
      return String(a).localeCompare(String(b), "zh-CN");
    });
    return sortedTokens.map((token) => ({
      token,
      label: formatListFilterLabel(token),
      count: counts.get(token) || 0,
    }));
  }

  function getFilteredSortedQueue() {
    const sortKey = String(state.listFilter.sortKey || "").trim();
    const sortDir = state.listFilter.sortDir === "desc" ? -1 : 1;
    const columnFilters = state.listFilter.columnFilters && typeof state.listFilter.columnFilters === "object"
      ? state.listFilter.columnFilters
      : {};
    const activeFilters = Object.entries(columnFilters)
      .map(([key, values]) => [String(key || "").trim(), Array.isArray(values) ? values.map((x) => String(x || "")).filter(Boolean) : []])
      .filter(([key, values]) => !!key && values.length > 0);

    let items = getKeywordStatusFilteredQueue().map((item, idx) => ({ item, idx }));

    if (activeFilters.length) {
      items = items.filter(({ item }) => activeFilters.every(([key, values]) => {
        const token = normalizeListFilterToken(readListColumnValue(item, key));
        return values.includes(token);
      }));
    }

    if (sortKey) {
      items.sort((a, b) => {
        const av = readListColumnValue(a.item, sortKey).toLowerCase();
        const bv = readListColumnValue(b.item, sortKey).toLowerCase();
        if (av === bv) return a.idx - b.idx;
        return av > bv ? sortDir : -sortDir;
      });
    }
    return items.map((x) => x.item);
  }

  function getSelectedItems() {
    return state.queue.filter((x) => state.selectedIds.has(x.id));
  }

  function getSelectedNormalItems() {
    return getSelectedItems().filter((x) => !isExcelItem(x));
  }

  function isTargetMultiEditMode() {
    return getSelectedNormalItems().length > 1;
  }

  function getSharedFieldValue(items, key) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return "";
    const firstItem = list[0] || {};
    const firstValue = String(((firstItem.fields || {})[key] || ""));
    for (let i = 1; i < list.length; i += 1) {
      const cur = list[i] || {};
      const curValue = String(((cur.fields || {})[key] || ""));
      if (curValue !== firstValue) return null;
    }
    return firstValue;
  }

  function refreshTargetFieldFormBySelection() {
    const active = getActiveItem();
    if (!active) return;
    const renderTargetFieldForm = typeof getRenderTargetFieldForm === "function" ? getRenderTargetFieldForm() : null;
    const applyTargetFieldProblemStyles = typeof getApplyTargetFieldProblemStyles === "function" ? getApplyTargetFieldProblemStyles() : null;
    if (typeof renderTargetFieldForm === "function") renderTargetFieldForm(active);
    if (typeof applyTargetFieldProblemStyles === "function") applyTargetFieldProblemStyles(active);
  }

  function updateSelectedCountText(visibleItems = null) {
    const selected = getSelectedItems().length;
    const visible = Array.isArray(visibleItems) ? visibleItems.length : getFilteredSortedQueue().length;
    $("selectedCountText").textContent = `已选：${selected} / 当前筛选：${visible}`;
  }

  function updateDetailPanelVisibility() {
    const panel = $("detailPanel");
    const splitter = $("listDetailSplitter");
    if (!panel) return;
    const hasActive = !!getActiveItem();
    panel.classList.toggle("show", hasActive);
    if (splitter) splitter.classList.toggle("hidden", !hasActive);
    if (!hasActive) {
      if (state.previewFullscreen) {
        panel.classList.remove("preview-fullscreen-mode");
        document.body.classList.remove("preview-fullscreen");
        state.previewFullscreen = false;
      }
      setPreviewPlaceholder("sourcePreview", "来源预览未加载");
      $("sourceFieldList").innerHTML = '<div class="placeholder">识别字段未加载</div>';
      $("targetFieldForm").innerHTML = '<div class="placeholder">字段表单未加载</div>';
      setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
    }
    refreshSourceViewButtons();
  }

  function refreshSourceViewButtons() {
    const hasActive = !!getActiveItem();
    const previewBtn = $("sourceViewPreviewBtn");
    const formBtn = $("sourceViewFormBtn");
    const mode = state.sourceViewMode === "fields" ? "fields" : "preview";
    const previewPanel = $("sourcePreviewPanel");
    const fieldsPanel = $("sourceFieldsPanel");
    if (previewBtn) {
      previewBtn.classList.toggle("is-active", mode === "preview");
      previewBtn.disabled = !hasActive || state.busy;
    }
    if (formBtn) {
      formBtn.classList.toggle("is-active", mode === "fields");
      formBtn.disabled = !hasActive || state.busy;
    }
    if (previewPanel) previewPanel.classList.toggle("is-active", mode === "preview");
    if (fieldsPanel) fieldsPanel.classList.toggle("is-active", mode === "fields");
  }

  function setSourceViewMode(mode) {
    state.sourceViewMode = mode === "fields" || mode === "form" ? "fields" : "preview";
    refreshSourceViewButtons();
    const active = getActiveItem();
    if (state.sourceViewMode === "fields") {
      const renderSourceFieldList = typeof getRenderSourceFieldList === "function" ? getRenderSourceFieldList() : null;
      if (typeof renderSourceFieldList === "function") renderSourceFieldList(active);
    } else {
      const renderSourcePreview = typeof getRenderSourcePreview === "function" ? getRenderSourcePreview() : null;
      if (typeof renderSourcePreview === "function") renderSourcePreview(active);
    }
  }

  function refreshRightViewTabs() {
    const hasActive = !!getActiveItem();
    const mode = state.rightViewMode === "preview" ? "preview" : "field";
    const fieldBtn = $("rightTabFieldBtn");
    const previewBtn = $("rightTabPreviewBtn");
    const fieldPanel = $("rightFieldPanel");
    const previewPanel = $("rightPreviewPanel");
    if (fieldBtn) {
      fieldBtn.classList.toggle("is-active", mode === "field");
      fieldBtn.disabled = !hasActive || state.busy;
    }
    if (previewBtn) {
      previewBtn.classList.toggle("is-active", mode === "preview");
      previewBtn.disabled = !hasActive || state.busy;
    }
    if (fieldPanel) fieldPanel.classList.toggle("is-active", mode === "field");
    if (previewPanel) previewPanel.classList.toggle("is-active", mode === "preview");
  }

  function setRightViewMode(mode) {
    state.rightViewMode = mode === "preview" ? "preview" : "field";
    refreshRightViewTabs();
  }

  function updateSourceDeviceNameText(item) {
    const el = $("sourceDeviceNameText");
    if (!el) return;
    const selectedNormalItems = getSelectedNormalItems();
    const sourceName = String((item && (item.sourceFileName || item.fileName)) || "").trim();
    const shortName = sourceName.length > 26
      ? `${sourceName.slice(0, 12)}...${sourceName.slice(-10)}`
      : sourceName;
    const selectedSuffix = selectedNormalItems.length > 1 ? `（已选 ${selectedNormalItems.length} 条）` : "";
    el.textContent = `来源：${shortName || "-"}${selectedSuffix}`;
    el.title = `${sourceName || ""}${selectedNormalItems.length > 1 ? ` | 已选 ${selectedNormalItems.length} 条记录` : ""}`;
  }

  function setPreviewFullscreen(on) {
    const panel = $("detailPanel");
    state.previewFullscreen = !!on;
    panel.classList.toggle("preview-fullscreen-mode", state.previewFullscreen);
    document.body.classList.toggle("preview-fullscreen", state.previewFullscreen);
    const refreshActionButtons = typeof getRefreshActionButtons === "function" ? getRefreshActionButtons() : null;
    if (typeof refreshActionButtons === "function") refreshActionButtons();
    else if (typeof refreshActionButtonsFallback === "function") refreshActionButtonsFallback();
  }

  return {
    getActiveItem,
    isTypingTarget,
    navigateActiveItem,
    getGenerateMode,
    setFullscreenButtonUi,
    syncGenerateModeUiText,
    readListColumnValue,
    isListBlankField,
    normalizeListFilterToken,
    formatListFilterLabel,
    getKeywordStatusFilteredQueue,
    getColumnFilterOptionEntries,
    getFilteredSortedQueue,
    getSelectedItems,
    getSelectedNormalItems,
    isTargetMultiEditMode,
    getSharedFieldValue,
    refreshTargetFieldFormBySelection,
    updateSelectedCountText,
    updateDetailPanelVisibility,
    refreshSourceViewButtons,
    setSourceViewMode,
    refreshRightViewTabs,
    setRightViewMode,
    updateSourceDeviceNameText,
    setPreviewFullscreen,
  };
}
