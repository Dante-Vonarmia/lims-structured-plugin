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
    setFullscreenButtonUi,
    resolveBlankTemplateName,
    isExcelItem,
  } = deps;

  function renderStats() {
    const total = new Set(state.queue.map((x) => x.sourceFileName || x.fileName)).size;
    const records = state.queue.reduce((acc, x) => acc + (Number(x.recordCount || 0) || 0), 0);
    const scanned = state.queue.filter((x) => x.status !== "pending").length;
    $("statTotal").textContent = String(total);
    $("statRecords").textContent = String(records);
    $("statScanned").textContent = String(scanned);
  }

  function renderQueue() {
    renderStats();
    const wrap = $("queueList");
    state.selectedIds = new Set(state.queue.filter((x) => state.selectedIds.has(x.id)).map((x) => x.id));
    if (!state.queue.length) {
      wrap.innerHTML = '<div style="padding:16px;color:#5c6f89;">暂无文件（上传可选文件；也可拖拽文件/文件夹到此处）</div>';
      $("activeFileText").textContent = "当前：未选择文件";
      updateSourceDeviceNameText(null);
      updateSelectedCountText([]);
      updateDetailPanelVisibility();
      refreshActionButtons();
      return;
    }
    const visibleItems = getFilteredSortedQueue();
    if (!visibleItems.length) {
      wrap.innerHTML = '<div style="padding:16px;color:#5c6f89;">当前筛选条件下无记录</div>';
      updateSelectedCountText([]);
      updateSourceDeviceNameText(getActiveItem());
      refreshActionButtons();
      return;
    }
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
      const triggerText = isFilterActive ? `筛(${selectedTokens.length})` : "筛";
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
      return `<th><span class="th-cell"><button type="button" class="th-sort-btn ${isSortActive ? "is-active" : ""}" data-sort-key="${escapeAttr(key)}"><span>${escapeHtml(label)}</span><span class="th-sort-icon">${sortIcon}</span></button><button type="button" class="th-filter-trigger ${isFilterActive ? "is-active" : ""}" data-filter-key="${escapeAttr(key)}">${escapeHtml(triggerText)}</button>${menuHtml}</span></th>`;
    };
    const rows = visibleItems.map((item, i) => `
        <tr data-id="${escapeAttr(item.id)}" class="${item.id === state.activeId ? "active" : ""}">
          <td><input type="checkbox" class="row-check" data-id="${escapeAttr(item.id)}" ${state.selectedIds.has(item.id) ? "checked" : ""} /></td>
          <td>${i + 1}</td>
          <td title="${escapeAttr((item.fields && item.fields.device_name) || "")}">${escapeHtml((item.fields && item.fields.device_name) || "-")}</td>
          <td title="${escapeAttr(getModelCodeDisplay(item) || "")}">${escapeHtml(getModelCodeDisplay(item) || "-")}</td>
          <td title="${escapeAttr(getDeviceCodeDisplay(item) || "")}">${escapeHtml(getDeviceCodeDisplay(item) || "-")}</td>
          <td title="${escapeAttr((item.fields && item.fields.manufacturer) || "")}">${escapeHtml((item.fields && item.fields.manufacturer) || "-")}</td>
          <td><span class="status ${statusClass(item.status)}">${escapeHtml(statusLabel(item.status))}</span></td>
          <td title="${escapeAttr(item.templateName || "")}">${escapeHtml(item.templateName || "-")}</td>
          <td title="${escapeAttr(item.message || "")}">${escapeHtml(item.message || "")}</td>
        </tr>
      `).join("");
    wrap.innerHTML = `
        <table>
          <thead>
            <tr>
              <th><input id="selectAllVisible" type="checkbox" ${allVisibleChecked ? "checked" : ""} /></th>
              <th>#</th>
              ${buildHeadCell("器具名称", "device_name")}
              ${buildHeadCell("型号规格", "model_code")}
              ${buildHeadCell("器具编号", "device_code")}
              ${buildHeadCell("生产厂商", "manufacturer")}
              ${buildHeadCell("状态", "status")}
              ${buildHeadCell("模板", "templateName")}
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
      $("activeFileText").textContent = `当前：${active.sourceFileName || active.fileName}${rec}`;
    } else $("activeFileText").textContent = "当前：未选择文件";
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
    const value = item && item.templateName && state.templates.includes(item.templateName) ? item.templateName : "";
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
    const item = getActiveItem();
    const selectedNormalItems = getSelectedNormalItems();
    const canGenerateSelected = selectedNormalItems.length > 0;
    const canExportSelected = selectedNormalItems.some((x) => !!x.reportDownloadUrl);
    $("uploadBtn").disabled = state.busy;
    $("uploadInstrumentCatalogBtn").disabled = state.busy;
    $("clearInstrumentCatalogBtn").disabled = state.busy || !state.instrumentCatalogNames.length;
    $("viewInstrumentCatalogDetailBtn").disabled = !state.instrumentCatalogNames.length;
    $("runExcelBatchBtn").disabled = state.busy || !(item && isExcelItem(item));
    $("runGenerateAllBtn").disabled = state.busy || !canGenerateSelected;
    $("runBatchBtn").disabled = state.busy || !canExportSelected;
    $("refreshAllRecognitionBtn").disabled = state.busy || !state.queue.length;
    $("clearQueueBtn").disabled = state.busy || !state.queue.length;
    $("generatePreviewBtn").disabled = state.busy || !item || isExcelItem(item);
    $("downloadCurrentBtn").disabled = state.busy || !item || !item.reportDownloadUrl;
    $("generateModeSelect").disabled = state.busy || !item || isExcelItem(item);
    $("templateName").disabled = state.busy || !item;
    $("templateSearch").disabled = state.busy || !item;
    $("togglePreviewFullscreenBtn").disabled = !item;
    $("selectVisibleBtn").disabled = state.busy || !state.queue.length;
    $("clearSelectedBtn").disabled = state.busy || !state.selectedIds.size;
    $("removeSelectedBtn").disabled = state.busy || !state.selectedIds.size;
    $("filterKeyword").disabled = state.busy && !state.queue.length;
    $("filterStatus").disabled = state.busy && !state.queue.length;
    $("sortKey").disabled = state.busy && !state.queue.length;
    $("sortDir").disabled = state.busy && !state.queue.length;
    const visible = getFilteredSortedQueue();
    const activeIndex = visible.findIndex((x) => x && x.id === state.activeId);
    const canPrev = !state.busy && visible.length > 1 && activeIndex > 0;
    const canNext = !state.busy && visible.length > 1 && activeIndex >= 0 && activeIndex < visible.length - 1;
    $("prevItemBtn").disabled = !canPrev;
    $("nextItemBtn").disabled = !canNext;
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
