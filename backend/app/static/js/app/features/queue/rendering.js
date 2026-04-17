import { isBooleanTextValue, renderBooleanDisplayHtml } from "../shared/boolean-display.js";
import { getTemplateInfoValue } from "../shared/template-info-utils.js";

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
    readListColumnValue,
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
  const safeReadListColumnValue = (item, key) => {
    if (typeof readListColumnValue === "function") return readListColumnValue(item, key);
    return "";
  };

  function getSchemaColumns() {
    const schema = (state.taskContext && state.taskContext.import_template_schema && typeof state.taskContext.import_template_schema === "object")
      ? state.taskContext.import_template_schema
      : { columns: [] };
    return Array.isArray(schema.columns) ? schema.columns : [];
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
    const filterPopoverRootId = "queueFilterPopoverRoot";
    const clearFilterPopover = () => {
      const existing = document.getElementById(filterPopoverRootId);
      if (existing) existing.remove();
    };
    const renderFilterPopover = (html, left, top) => {
      let root = document.getElementById(filterPopoverRootId);
      if (!(root instanceof HTMLElement)) {
        root = document.createElement("div");
        root.id = filterPopoverRootId;
        document.body.appendChild(root);
      }
      root.className = "queue-filter-popover";
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.innerHTML = html;
    };
    wrap.classList.remove("is-empty", "has-data");
    state.selectedIds = new Set(state.queue.filter((x) => state.selectedIds.has(x.id)).map((x) => x.id));
    const idSet = new Set(state.queue.map((x) => String((x && x.id) || "")));
    if (!idSet.has(String(state.activeId || ""))) {
      state.activeId = state.queue[0] ? String(state.queue[0].id || "") : "";
    }
    if (!state.selectedIds.size && state.activeId) {
      state.selectedIds.add(state.activeId);
    }
    if (!state.queue.length) {
      clearFilterPopover();
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
      clearFilterPopover();
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
    const activeFilterAnchor = (state.listFilter.filterAnchor && typeof state.listFilter.filterAnchor === "object")
      ? state.listFilter.filterAnchor
      : null;
    const buildFilterMenuHtml = (key) => {
      const options = getColumnFilterOptionEntries(key, filterOptionItems);
      const allTokens = Array.isArray(columnFilters[key]) ? columnFilters[key] : [];
      const optionsHtml = options.length
        ? options.map((opt) => {
          const checked = allTokens.includes(opt.token);
          return `<label class="th-filter-opt"><input type="checkbox" class="th-filter-option" data-filter-key="${escapeAttr(key)}" data-filter-token="${escapeAttr(opt.token)}" ${checked ? "checked" : ""} /><span class="th-filter-label" title="${escapeAttr(opt.label)}">${escapeHtml(opt.label)}</span><span class="th-filter-count">${opt.count}</span></label>`;
        }).join("")
        : '<div class="th-filter-count">无可筛选值</div>';
      return `<div class="th-filter-menu"><div class="th-filter-actions"><button type="button" class="th-filter-act icon-only" data-filter-act="all" data-filter-key="${escapeAttr(key)}" title="全选" aria-label="全选"><i class="fa-solid fa-check-double" aria-hidden="true"></i></button><button type="button" class="th-filter-act icon-only" data-filter-act="clear" data-filter-key="${escapeAttr(key)}" title="清空" aria-label="清空"><i class="fa-solid fa-eraser" aria-hidden="true"></i></button></div><div class="th-filter-options">${optionsHtml}</div></div>`;
    };
    const buildHeadCell = (label, key) => {
      if (!key) return `<th>${escapeHtml(label)}</th>`;
      const isSortActive = state.listFilter.sortKey === key;
      const isAsc = state.listFilter.sortDir !== "desc";
      const sortIcon = isSortActive ? (isAsc ? "↑" : "↓") : "↕";
      const selectedTokens = Array.isArray(columnFilters[key]) ? columnFilters[key] : [];
      const isFilterActive = selectedTokens.length > 0;
      const triggerTitle = isFilterActive ? `筛选（已选 ${selectedTokens.length}）` : "筛选";
      return `<th><span class="th-cell"><button type="button" class="th-sort-btn ${isSortActive ? "is-active" : ""}" data-sort-key="${escapeAttr(key)}"><span>${escapeHtml(label)}</span><span class="th-sort-icon">${sortIcon}</span></button><button type="button" class="th-filter-trigger ${isFilterActive ? "is-active" : ""}" data-filter-key="${escapeAttr(key)}" title="${escapeAttr(triggerTitle)}"><i class="fa-solid fa-filter" aria-hidden="true"></i></button></span></th>`;
    };
    const rows = visibleItems.map((item, i) => `
        <tr data-id="${escapeAttr(item.id)}" class="${item.id === state.activeId ? "active" : ""} ${item.status === "generated" ? "row-generated" : ""}">
          <td><input type="checkbox" class="row-check" data-id="${escapeAttr(item.id)}" ${state.selectedIds.has(item.id) ? "checked" : ""} /></td>
          <td>${i + 1}</td>
          ${getSchemaColumns().map((field) => {
    const key = String((field && field.key) || "").trim();
    const value = getTemplateInfoValue({
      item,
      taskTemplateInfo: state.taskContext && state.taskContext.template_info,
      key,
      schemaRules: state.taskContext && state.taskContext.import_template_schema && state.taskContext.import_template_schema.rules,
    });
    const booleanHtml = isBooleanTextValue(value) ? renderBooleanDisplayHtml(value, "-") : "";
    return `<td title="${escapeAttr(value)}">${booleanHtml || escapeHtml(value || "-")}</td>`;
  }).join("")}
          <td title="${escapeAttr(safeReadListColumnValue(item, "ocr_quality") || "-")}">${escapeHtml(safeReadListColumnValue(item, "ocr_quality") || "-")}</td>
          <td><span class="status ${statusClass(item.status)}">${escapeHtml(statusLabel(item))}</span></td>
          <td title="${escapeAttr(item.message || "")}">${escapeHtml(item.message || "")}</td>
        </tr>
      `).join("");
    const popoverHtml = (() => {
      if (!activeFilterKey || !activeFilterAnchor) return "";
      const menuWidth = 220;
      const viewportWidth = typeof window !== "undefined" ? (window.innerWidth || 0) : 0;
      const left = Math.max(8, Math.min(
        Math.max(8, viewportWidth - menuWidth - 8),
        Math.round((Number(activeFilterAnchor.right) || 0) - menuWidth),
      ));
      const top = Math.round((Number(activeFilterAnchor.bottom) || 0) + 6);
      return { html: buildFilterMenuHtml(activeFilterKey), left, top };
    })();
    wrap.innerHTML = `
        <table>
          <thead>
            <tr>
              <th><input id="selectAllVisible" type="checkbox" ${allVisibleChecked ? "checked" : ""} /></th>
              <th>#</th>
              ${getSchemaColumns().map((field) => buildHeadCell(String((field && field.label) || ""), String((field && field.key) || ""))).join("")}
              ${buildHeadCell("OCR质量", "ocr_quality")}
              ${buildHeadCell("状态", "status")}
              <th>说明</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    if (popoverHtml && popoverHtml.html) renderFilterPopover(popoverHtml.html, popoverHtml.left, popoverHtml.top);
    else clearFilterPopover();
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
      const exists = (name) => !!name && (!templates.length || templates.includes(name));
      const outputBundleId = String((state.taskContext && state.taskContext.output_bundle_id) || "").trim();
      if (outputBundleId) {
        const bundleRef = `bundle:${outputBundleId}`;
        return bundleRef;
      }
      if (!templates.length) return "";
      const taskDefaultRaw = String((state.taskContext && state.taskContext.export_template_name) || "").trim();
      const taskDefaultBase = taskDefaultRaw.split(/[\\/]/).pop() || taskDefaultRaw;
      const taskDefaultName = taskDefaultBase;
      if (exists(taskDefaultName)) return taskDefaultName;
      const configuredBlueprint = String((state.runtime && state.runtime.modifyCertificateBlueprintTemplateName) || "modify-certificate-blueprint.docx").trim();
      if (exists(configuredBlueprint)) return configuredBlueprint;
      const itemTemplateRaw = String((item && item.templateName) || "").trim();
      const itemTemplateName = itemTemplateRaw;
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
    setDisabled("uploadBtn", false);
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
