export function createQueueRenderingFeature(deps = {}) {
  const {
    $,
    state,
    statusClass,
    statusLabel,
    escapeHtml,
    escapeAttr,
    getActiveItem,
    getSelectedNormalItems,
    getFilteredSortedQueue,
    getKeywordStatusFilteredQueue,
    getColumnFilterOptionEntries,
    getModelCodeDisplay,
    getDeviceCodeDisplay,
    updateSourceDeviceNameText,
    updateSelectedCountText,
    updateDetailPanelVisibility,
    refreshSourceViewButtons,
    refreshRightViewTabs,
    syncGenerateModeUiText,
    getGenerateMode,
    setFullscreenButtonUi,
    resolveBlankTemplateName,
    isExcelItem,
  } = deps;

  function getSchemaColumns() {
    const schema = (state.taskContext && state.taskContext.import_template_schema && typeof state.taskContext.import_template_schema === "object")
      ? state.taskContext.import_template_schema
      : { columns: [] };
    return Array.isArray(schema.columns) ? schema.columns : [];
  }

  function getTemplateInfoValue(item, key) {
    const rowFields = (item && item.fields && typeof item.fields === "object") ? item.fields : {};
    const taskTemplateInfo = (state.taskContext && state.taskContext.template_info && typeof state.taskContext.template_info === "object")
      ? state.taskContext.template_info
      : {};
    const rowValue = String(rowFields[key] || "").trim();
    if (rowValue) return rowValue;
    return String(taskTemplateInfo[key] || "").trim();
  }

  function renderStats() {
    const total = new Set(state.queue.map((x) => x.sourceFileName || x.fileName)).size;
    const records = state.queue.reduce((acc, x) => acc + (Number(x.recordCount || 0) || 0), 0);
    const scanned = state.queue.filter((x) => x.status !== "pending").length;
    const statTotal = $("statTotal");
    const statRecords = $("statRecords");
    const statScanned = $("statScanned");
    if (statTotal) statTotal.textContent = String(total);
    if (statRecords) statRecords.textContent = String(records);
    if (statScanned) statScanned.textContent = String(scanned);
  }

  function renderQueue() {
    renderStats();
    const wrap = $("queueList");
    wrap.classList.remove("is-empty", "has-data");
    state.selectedIds = new Set(state.queue.filter((x) => state.selectedIds.has(x.id)).map((x) => x.id));
    if (!state.queue.length) {
      wrap.classList.add("is-empty");
      wrap.innerHTML = '<div class="queue-empty-placeholder">上传文件（也可拖拽文件/文件夹到此处）</div>';
      const activeFileText = $("activeFileText");
      if (activeFileText) activeFileText.textContent = "当前：未选择文件";
      updateSourceDeviceNameText(null);
      updateSelectedCountText([]);
      updateDetailPanelVisibility();
      refreshActionButtons();
      return;
    }
    const visibleItems = getFilteredSortedQueue();
    if (!visibleItems.length) {
      wrap.classList.add("is-empty");
      wrap.innerHTML = '<div class="queue-empty-placeholder">当前筛选条件下无记录</div>';
      updateSelectedCountText([]);
      updateSourceDeviceNameText(getActiveItem());
      refreshActionButtons();
      return;
    }
    wrap.classList.add("has-data");
    const allVisibleChecked = visibleItems.length > 0 && visibleItems.every((x) => state.selectedIds.has(x.id));
    const filterOptionItems = getKeywordStatusFilteredQueue();
    const columnFilters = state.listFilter.columnFilters && typeof state.listFilter.columnFilters === "object"
      ? state.listFilter.columnFilters
      : {};
    const activeFilterKey = String(state.listFilter.activeFilterKey || "").trim();
    const buildHeadCell = (label, key) => {
      if (!key) return `<th>${escapeHtml(label)}</th>`;
      const isSortActive = state.listFilter.sortKey === key;
      const isAsc = state.listFilter.sortDir !== "desc";
      const sortIcon = isSortActive ? (isAsc ? "↑" : "↓") : "↕";
      const selectedTokens = Array.isArray(columnFilters[key]) ? columnFilters[key] : [];
      const isFilterActive = selectedTokens.length > 0;
      const triggerTitle = isFilterActive ? `筛选（已选 ${selectedTokens.length}）` : "筛选";
      const options = getColumnFilterOptionEntries(key, filterOptionItems);
      const optionsHtml = options.length
        ? options.map((opt) => {
          const checked = selectedTokens.includes(opt.token);
          return `<label class="th-filter-opt"><input type="checkbox" class="th-filter-option" data-filter-key="${escapeAttr(key)}" data-filter-token="${escapeAttr(opt.token)}" ${checked ? "checked" : ""} /><span class="th-filter-label" title="${escapeAttr(opt.label)}">${escapeHtml(opt.label)}</span><span class="th-filter-count">${opt.count}</span></label>`;
        }).join("")
        : '<div class="th-filter-count">无可筛选值</div>';
      const menuHtml = activeFilterKey === key
        ? `<div class="th-filter-menu"><div class="th-filter-actions"><button type="button" class="th-filter-act" data-filter-act="all" data-filter-key="${escapeAttr(key)}">全选</button><button type="button" class="th-filter-act" data-filter-act="clear" data-filter-key="${escapeAttr(key)}">清空</button><button type="button" class="th-filter-act" data-filter-act="only_blank" data-filter-key="${escapeAttr(key)}">仅空</button><button type="button" class="th-filter-act" data-filter-act="only_non_blank" data-filter-key="${escapeAttr(key)}">仅非空</button></div><div class="th-filter-options">${optionsHtml}</div></div>`
        : "";
      return `<th><span class="th-cell"><button type="button" class="th-sort-btn ${isSortActive ? "is-active" : ""}" data-sort-key="${escapeAttr(key)}"><span>${escapeHtml(label)}</span><span class="th-sort-icon">${sortIcon}</span></button><button type="button" class="th-filter-trigger ${isFilterActive ? "is-active" : ""}" data-filter-key="${escapeAttr(key)}" title="${escapeAttr(triggerTitle)}"><i class="fa-solid fa-filter" aria-hidden="true"></i></button>${menuHtml}</span></th>`;
    };
    const rows = visibleItems.map((item, i) => `
        <tr data-id="${escapeAttr(item.id)}" class="${item.id === state.activeId ? "active" : ""} ${item.status === "generated" ? "row-generated" : ""}">
          <td><input type="checkbox" class="row-check" data-id="${escapeAttr(item.id)}" ${state.selectedIds.has(item.id) ? "checked" : ""} /></td>
          <td>${i + 1}</td>
          ${getSchemaColumns().map((field) => {
    const key = String((field && field.key) || "").trim();
    const value = getTemplateInfoValue(item, key);
    return `<td title="${escapeAttr(value)}">${escapeHtml(value || "-")}</td>`;
  }).join("")}
          <td><span class="status ${statusClass(item.status)}">${escapeHtml(statusLabel(item))}</span></td>
          <td title="${escapeAttr(item.message || "")}">${escapeHtml(item.message || "")}</td>
        </tr>
      `).join("");
    wrap.innerHTML = `
        <table>
          <thead>
            <tr>
              <th><input id="selectAllVisible" type="checkbox" ${allVisibleChecked ? "checked" : ""} /></th>
              <th>#</th>
              ${getSchemaColumns().map((field) => buildHeadCell(String((field && field.label) || ""), String((field && field.key) || ""))).join("")}
              ${buildHeadCell("状态", "status")}
              <th>说明</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    updateSelectedCountText(visibleItems);
    const active = getActiveItem();
    if (active) {
      const rec = active.recordName ? ` / ${active.recordName}` : "";
      const activeFileText = $("activeFileText");
      if (activeFileText) activeFileText.textContent = `当前：${active.sourceFileName || active.fileName}${rec}`;
    } else {
      const activeFileText = $("activeFileText");
      if (activeFileText) activeFileText.textContent = "当前：未选择文件";
    }
    updateSourceDeviceNameText(active);
    updateDetailPanelVisibility();
    refreshActionButtons();
  }

  function renderTemplateSelect() {
    const item = getActiveItem();
    const select = $("templateName");
    const datalist = $("templateOptions");
    const search = $("templateSearch");
    const blankBtn = $("useBlankTemplateBtn");
    const sourceTemplates = state.templates;
    const generateMode = typeof getGenerateMode === "function" ? getGenerateMode() : "";
    const isModifyCertificate = generateMode === "source_file";
    const resolveModifyTemplateName = () => {
      const templates = Array.isArray(state.templates) ? state.templates.map((x) => String(x || "").trim()).filter(Boolean) : [];
      if (!templates.length) return "";
      const exists = (name) => !!name && templates.includes(name);
      const legacyNameMap = {
        "2026030604-大特.docx": "modify-certificate-blueprint.docx",
        "修改证书蓝本.docx": "modify-certificate-blueprint.docx",
      };
      const taskDefaultRaw = String((state.taskContext && state.taskContext.export_template_name) || "").trim();
      const taskDefaultBase = taskDefaultRaw.split(/[\\/]/).pop() || taskDefaultRaw;
      const taskDefaultName = legacyNameMap[taskDefaultBase] || taskDefaultBase;
      if (exists(taskDefaultName)) return taskDefaultName;
      const configuredRaw = String((state.runtime && state.runtime.modifyCertificateBlueprintTemplateName) || "modify-certificate-blueprint.docx").trim();
      const configuredBlueprint = legacyNameMap[configuredRaw] || configuredRaw;
      if (exists(configuredBlueprint)) return configuredBlueprint;
      const itemTemplateRaw = String((item && item.templateName) || "").trim();
      const itemTemplateName = legacyNameMap[itemTemplateRaw] || itemTemplateRaw;
      if (exists(itemTemplateName)) return itemTemplateName;
      const firstDocx = templates.find((x) => /\.docx$/i.test(x));
      if (firstDocx) return firstDocx;
      return templates[0] || "";
    };
    select.innerHTML = '<option value="">请选择模板</option>';
    if (datalist) datalist.innerHTML = "";
    sourceTemplates.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
      if (datalist) {
        const itemOpt = document.createElement("option");
        itemOpt.value = name;
        datalist.appendChild(itemOpt);
      }
    });
    const value = isModifyCertificate
      ? resolveModifyTemplateName()
      : (item && item.templateName && state.templates.includes(item.templateName) ? item.templateName : "");
    select.value = value;
    if (search) search.value = value;
    if (blankBtn) {
      const blankName = resolveBlankTemplateName();
      const shouldShow = !!item && !value && !!blankName;
      blankBtn.style.display = shouldShow ? "inline-block" : "none";
      blankBtn.disabled = state.busy || !item || !blankName;
    }
  }

  function refreshActionButtons() {
    const setDisabled = (id, disabled) => {
      const el = $(id);
      if (el) el.disabled = !!disabled;
    };
    const item = getActiveItem();
    const selectedNormalItems = getSelectedNormalItems();
    const canGenerateSelected = selectedNormalItems.length > 0;
    const canExportSelected = selectedNormalItems.some((x) => !!x.reportDownloadUrl);
    setDisabled("uploadBtn", state.busy);
    const runExcelBatchBtn = $("runExcelBatchBtn");
    if (runExcelBatchBtn) runExcelBatchBtn.disabled = state.busy || !(item && isExcelItem(item));
    setDisabled("runGenerateAllBtn", state.busy || !canGenerateSelected);
    setDisabled("runBatchBtn", state.busy || !canExportSelected);
    setDisabled("refreshAllRecognitionBtn", state.busy || !state.queue.length);
    setDisabled("clearQueueBtn", state.busy || !state.queue.length);
    setDisabled("generatePreviewBtn", state.busy || !item || isExcelItem(item));
    setDisabled("downloadCurrentBtn", state.busy || !item || !item.reportDownloadUrl);
    setDisabled("generateModeSelect", state.busy || !item || isExcelItem(item));
    setDisabled("templateName", state.busy || !item);
    setDisabled("templateSearch", state.busy || !item);
    setDisabled("togglePreviewFullscreenBtn", !item);
    setDisabled("removeSelectedBtn", state.busy || !state.selectedIds.size);
    setDisabled("filterKeyword", state.busy && !state.queue.length);
    setDisabled("filterStatus", state.busy && !state.queue.length);
    setDisabled("sortKey", state.busy && !state.queue.length);
    setDisabled("sortDir", state.busy && !state.queue.length);
    const toggleSelectModeBtn = $("toggleSelectModeBtn");
    if (toggleSelectModeBtn) {
      toggleSelectModeBtn.disabled = state.busy || !state.queue.length;
      const iconEl = toggleSelectModeBtn.querySelector(".btn-icon");
      if (iconEl) {
        iconEl.classList.remove("fa-list-check", "fa-check");
        iconEl.classList.add(state.multiSelectMode ? "fa-check" : "fa-list-check");
      }
      toggleSelectModeBtn.classList.toggle("is-active", !!state.multiSelectMode);
      const modeTitle = state.multiSelectMode ? "当前：复选模式（点击切换单选）" : "当前：单选模式（点击切换复选）";
      toggleSelectModeBtn.title = modeTitle;
      toggleSelectModeBtn.setAttribute("aria-label", modeTitle);
    }
    const visible = getFilteredSortedQueue();
    const activeIndex = visible.findIndex((x) => x && x.id === state.activeId);
    const canPrev = !state.busy && visible.length > 1 && activeIndex > 0;
    const canNext = !state.busy && visible.length > 1 && activeIndex >= 0 && activeIndex < visible.length - 1;
    setDisabled("prevItemBtn", !canPrev);
    setDisabled("nextItemBtn", !canNext);
    setFullscreenButtonUi(state.previewFullscreen);
    refreshSourceViewButtons();
    refreshRightViewTabs();
    syncGenerateModeUiText();
  }

  return {
    renderStats,
    renderQueue,
    renderTemplateSelect,
    refreshActionButtons,
  };
}
