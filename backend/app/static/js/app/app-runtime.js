import {
  autoLoadInstrumentCatalogApi,
  fetchBlob,
  fetchJson,
  listTemplatesApi,
  loadRuntimeConfigApi,
  parseInstrumentCatalogApi,
  runEditorPrefillApi,
  runExcelInspectApi,
  runExcelPreviewApi,
  runExtractApi,
  runGeneralCheckStructureExtractApi,
  runInstrumentTableExtractApi,
  runOcrApi,
  runTemplateEditorSchemaApi,
  runTemplateFeedbackApi,
  runTemplateMatchApi,
  runTemplateTextPreviewApi,
  uploadFileApi,
} from "../infra/api/client.js";
import {
  EXTERNAL_DOCX_PREVIEW_CSS_URLS,
  EXTERNAL_DOCX_PREVIEW_URLS,
  EXTERNAL_JSZIP_URLS,
  FILTER_BLANK_TOKEN,
  LOCAL_DOCX_PREVIEW_CSS_URLS,
  LOCAL_DOCX_PREVIEW_URLS,
  LOCAL_JSZIP_URLS,
  SOURCE_FIELD_LABELS,
  SOURCE_FORM_FIELDS,
  SOURCE_HIDDEN_SYSTEM_KEYS,
  SOURCE_RECOGNITION_CORE_KEYS,
  SUPPORTED_EXTS,
  TARGET_BASIC_FORM_FIELDS,
  TARGET_EDIT_GROUPS,
  TEMPLATE_GENERATION_RULES,
  TEMPLATE_REQUIRED_FIELDS,
} from "../core/config/constants.js";
import { createEmptyFields, createInitialState } from "../core/state/factory.js";
import { createMeasurementTableFeature } from "./features/measurement-table.js";
import { createGeneralCheckFeature } from "./features/general-check.js";
import { createBindEventsFeature } from "./features/events/bind-events.js";
import {
  cleanBlockText,
  collectDocxImageTokens,
  enrichGeneralCheckWithDocxImages,
  escapeAttr,
  escapeHtml,
  extractAllBlocksByLine,
  extractBlockByLine,
  hasDocxImageToken,
  inferDateTriplet,
  isCompleteDateText,
  normalizeCatalogToken,
  normalizeOptionalBlank,
  normalizeValidationToken,
  parseDateFromLabelText,
  parseDateParts,
  renderRichCellHtml,
  toDateOnlyDisplay,
} from "./features/shared/text-date-utils.js";

    const state = createInitialState();

    const $ = (id) => document.getElementById(id);

    function createQueueItem(file) {
      const ext = extFromName(file && file.name ? file.name : "");
      return {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
        fileName: file.name || "",
        sourceFileName: file.name || "",
        recordName: "",
        rowNumber: 0,
        sheetName: "",
        isRecordRow: false,
        sourceType: (ext || "").replace(".", "").toUpperCase() || "UNKNOWN",
        fileId: "",
        rawText: "",
        sourceCode: "",
        recordCount: 0,
        category: "",
        fields: createEmptyFields(),
        recognizedFields: createEmptyFields(),
        templateName: "",
        matchedBy: "",
        templateUserSelected: false,
        status: "pending",
        message: "待处理",
        reportId: "",
        reportDownloadUrl: "",
        reportFileName: "",
      };
    }


    function appendLog(text) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      const line = `[${hh}:${mm}:${ss}] ${text}`;
      $("batchLog").textContent += `\n${line}`;
      $("batchLog").scrollTop = $("batchLog").scrollHeight;
    }

    function setStatus(text) {
      const raw = String(text || "").trim();
      const loadedMatch = raw.match(/计量标准器具目录已装填[:：]?\s*(\d+)\s*项/);
      if (loadedMatch) { $("globalStatus").textContent = "就绪"; return; }
      if (/计量标准器具目录已清除/.test(raw)) {
        $("globalStatus").textContent = "就绪";
        return;
      }
      $("globalStatus").textContent = raw || "";
    }

    function setPreprocessProgress(current, total, fileName, label = "预处理") {
      const row = $("preprocessProgressRow");
      const bar = $("preprocessProgressBar");
      const text = $("preprocessProgressText");
      if (!row || !bar || !text) return;
      const safeTotal = total > 0 ? total : 1;
      const percent = Math.max(0, Math.min(100, Math.round((current / safeTotal) * 100)));
      row.classList.add("show");
      bar.value = percent;
      text.textContent = `${label}：${current}/${total}${fileName ? `（${fileName}）` : ""}`;
    }

    function clearPreprocessProgress(label = "预处理") {
      const row = $("preprocessProgressRow");
      const bar = $("preprocessProgressBar");
      const text = $("preprocessProgressText");
      if (!row || !bar || !text) return;
      bar.value = 0;
      text.textContent = `${label}：0/0`;
      row.classList.remove("show");
    }

    function setLoading(show, text) {
      state.busy = !!show;
      $("loadingMask").classList.toggle("show", !!show);
      $("loadingText").textContent = text || "处理中...";
      refreshActionButtons();
    }

    function statusLabel(s) {
      return {
        pending: "待处理",
        processing: "处理中",
        ready: "可生成",
        incomplete: "待补全",
        generated: "已生成",
        confirmed: "已确认",
        error: "失败",
      }[s] || s;
    }

    function statusClass(s) {
      if (s === "generated" || s === "confirmed" || s === "ready") return "ok";
      if (s === "error") return "err";
      if (s === "processing" || s === "incomplete") return "warn";
      return "";
    }

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

    function isExcelExt(ext) { return ext === ".xlsx"; }
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

    function getActiveItem() {
      return state.queue.find((x) => x.id === state.activeId) || null;
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
      state.listFilter.activeFilterKey = "";
      renderQueue();
      renderTemplateSelect();
      await renderPreviews();
    }

    function getGenerateMode() {
      const select = $("generateModeSelect");
      const mode = String((select && select.value) || "certificate_template");
      return mode === "source_file" ? "source_file" : "certificate_template";
    }

    function setButtonText(btn, text) {
      if (!btn) return;
      const textEl = btn.querySelector(".btn-text");
      if (textEl) {
        textEl.textContent = text;
        return;
      }
      btn.textContent = text;
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
        setButtonText(previewTabBtn, isModifyCertificate ? "证书预览" : "原始记录预览");
      }
      const targetPaneTitle = $("targetPaneTitle");
      if (targetPaneTitle) {
        targetPaneTitle.textContent = isModifyCertificate ? "证书模板（来源）" : "原始记录模板";
      }
      const templateSearch = $("templateSearch");
      if (templateSearch) {
        templateSearch.placeholder = isModifyCertificate ? "浏览并选择证书模板" : "搜索并选择模板";
      }
    }

    function readListColumnValue(item, key) {
      const f = item.fields || {};
      if (key === "recordName") return String(item.recordName || "");
      if (key === "device_name") return String(f.device_name || "");
      if (key === "model_code") return String(getModelCodeDisplay(item) || "");
      if (key === "device_code") return String(getDeviceCodeDisplay(item) || "");
      if (key === "power_rating") return String(f.power_rating || "");
      if (key === "manufacture_date") return String(toDateOnlyDisplay(f.manufacture_date || ""));
      if (key === "contact_info") return String(f.contact_info || "");
      if (key === "measurement_item_count") return String(f.measurement_item_count || "");
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

    const MULTI_EDIT_MIXED_PLACEHOLDER = "（多值）";
    const MULTI_EDIT_DISABLED_FIELD_KEYS = new Set(["measurement_items", "general_check_full"]);

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
      renderTargetFieldForm(active);
      applyTargetFieldProblemStyles(active);
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
        setPreviewPlaceholder("sourcePreview", "证书模板预览未加载");
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
      if (state.sourceViewMode === "fields") renderSourceFieldList(active);
      else renderSourcePreview(active);
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

    function renderStats() {
      const total = new Set(state.queue.map((x) => x.sourceFileName || x.fileName)).size;
      const records = state.queue.reduce((acc, x) => acc + (Number(x.recordCount || 0) || 0), 0);
      const scanned = state.queue.filter((x) => x.status !== "pending").length;
      $("statTotal").textContent = String(total);
      $("statRecords").textContent = String(records);
      $("statScanned").textContent = String(scanned);
    }

    function updateSourceDeviceNameText(item) {
      const el = $("sourceDeviceNameText");
      if (!el) return;
      const selectedNormalItems = getSelectedNormalItems();
      if (selectedNormalItems.length > 1) {
        el.textContent = `器具名称：已选 ${selectedNormalItems.length} 条`;
        el.title = `已选 ${selectedNormalItems.length} 条记录`;
        return;
      }
      const fields = (item && item.fields) || {};
      const name = String(fields.device_name || "").trim();
      el.textContent = `器具名称：${name || "-"}`;
      el.title = name || "";
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
      }
      else $("activeFileText").textContent = "当前：未选择文件";
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

    function renderCatalogReadyHint() {
      const hint = $("catalogReadyHint");
      if (!hint) return;
      const total = Array.isArray(state.instrumentCatalogRows) ? state.instrumentCatalogRows.length : 0;
      const ready = total > 0;
      if (!ready) {
        hint.innerHTML = "○ 待装填";
        return;
      }
      const html = `<span class="catalog-ready-dot"></span>已就绪 ${total}`;
      hint.innerHTML = html;
    }

    function renderInstrumentCatalogDetailContent() {
      const root = $("catalogDetailContent");
      if (!root) return;
      const rows = Array.isArray(state.instrumentCatalogRows) ? state.instrumentCatalogRows : [];
      const titleEl = $("catalogDetailTitle");
      if (!rows.length) {
        if (titleEl) titleEl.textContent = "计量标准器具目录识别明细";
        root.innerHTML = '<div class="placeholder">暂无识别数据</div>';
        return;
      }
      if (titleEl) {
        const suffix = state.instrumentCatalogFileName ? `（${state.instrumentCatalogFileName}）` : "";
        titleEl.textContent = `计量标准器具目录识别明细：${rows.length} 项${suffix}`;
      }
      const body = rows.map((row, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td title="${escapeAttr(String((row && row.name) || ""))}">${escapeHtml(String((row && row.name) || ""))}</td>
          <td title="${escapeAttr(String((row && row.model) || ""))}">${escapeHtml(String((row && row.model) || ""))}</td>
          <td title="${escapeAttr(String((row && row.code) || ""))}">${escapeHtml(String((row && row.code) || ""))}</td>
          <td title="${escapeAttr(String((row && row.measurement_range) || ""))}">${escapeHtml(String((row && row.measurement_range) || ""))}</td>
          <td title="${escapeAttr(String((row && row.uncertainty) || ""))}">${escapeHtml(String((row && row.uncertainty) || ""))}</td>
          <td title="${escapeAttr(String((row && row.certificate_no) || ""))}">${escapeHtml(String((row && row.certificate_no) || ""))}</td>
          <td title="${escapeAttr(String((row && row.valid_date) || ""))}">${escapeHtml(String((row && row.valid_date) || ""))}</td>
          <td title="${escapeAttr(String((row && row.traceability_institution) || ""))}">${escapeHtml(String((row && row.traceability_institution) || ""))}</td>
        </tr>
      `).join("");
      root.innerHTML = `
        <table class="catalog-detail-table">
          <thead>
            <tr>
              <th>#</th>
              <th>计量标准器具名称</th>
              <th>型号规格</th>
              <th>器具编号</th>
              <th>测量范围</th>
              <th>不确定度</th>
              <th>证书编号</th>
              <th>有效期</th>
              <th>溯源机构</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      `;
    }

    function setCatalogDetailVisible(show) {
      const mask = $("catalogDetailMask");
      if (!mask) return;
      if (show) renderInstrumentCatalogDetailContent();
      mask.classList.toggle("show", !!show);
    }

    function setPreviewFullscreen(on) {
      const panel = $("detailPanel");
      state.previewFullscreen = !!on;
      panel.classList.toggle("preview-fullscreen-mode", state.previewFullscreen);
      document.body.classList.toggle("preview-fullscreen", state.previewFullscreen);
      refreshActionButtons();
    }

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
        renderTargetFieldForm(active);
        applyTargetFieldProblemStyles(active);
      }
      renderQueue();
    }

    function renderMeasurementCatalogNameOptions() {
      const datalist = $("measurementCatalogNameOptions");
      if (!datalist) return;
      const rows = Array.isArray(state.instrumentCatalogRows) ? state.instrumentCatalogRows : [];
      if (!rows.length) {
        datalist.innerHTML = "";
        return;
      }
      datalist.innerHTML = rows
        .map((row) => `<option value="${escapeAttr(String((row && row.name) || "").trim())}"></option>`)
        .join("");
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

    function inferCategory(item) {
      const ext = extFromName(item && item.fileName ? item.fileName : "");
      if (isExcelExt(ext)) return "Excel批量";
      const fields = (item && item.fields) || {};
      const name = (fields.device_name || "").trim();
      if (name) return name;
      const code = item && item.sourceCode ? item.sourceCode.toUpperCase() : "";
      if (code) return `代号:${code}`;
      return "未分类";
    }

    function resolveSourceProfileLabel(item) {
      const fields = (item && item.fields) || {};
      const explicit = String(fields.source_profile_label || "").trim();
      if (explicit) return explicit;
      const profile = String(fields.source_profile || "").trim();
      if (!profile) return "";
      if (profile === "excel_row") return "Excel行";
      if (profile === "multi_device_baseinfo_word") return "多基础信息Word";
      if (profile === "template_form_word") return "模板单记录Word";
      if (profile === "single_device_with_scope") return "单设备含范围";
      if (profile === "single_device_general") return "单设备通用";
      if (profile === "multi_device_baseinfo_word_split") return "多基础信息Word-拆分";
      return profile;
    }

    function buildCategoryMessage(item, suffix) {
      const category = (item && item.category) || "未分类";
      const profile = resolveSourceProfileLabel(item);
      const profileText = profile ? `；形态:${profile}` : "";
      return `分类:${category}${profileText}；${suffix}`;
    }

    function isPlaceholderValue(value) {
      const text = String(value || "").trim();
      if (!text) return true;
      return /^[-/—–_]+$/.test(text);
    }

    function isDeviceNameAllowedByCatalog(value) {
      const token = normalizeCatalogToken(value);
      if (!token) return false;
      if (!state.instrumentCatalogTokenSet || !state.instrumentCatalogTokenSet.size) return true;
      return state.instrumentCatalogTokenSet.has(token);
    }

    function hasMeaningfulValue(value) {
      const text = String(value || "").trim();
      if (!text) return false;
      if (isPlaceholderValue(text)) return false;
      const token = normalizeValidationToken(text);
      if (!token) return false;
      return !new Set([
        "instrumentname", "devicename", "equipmentname", "modelspecification", "instrumentserialnumber",
        "serialnumber", "manufacturer", "client", "器具名称", "设备名称", "仪器名称",
        "型号规格", "型号", "编号", "器具编号", "设备编号", "生产厂商", "制造厂商", "厂家", "厂商",
      ]).has(token);
    }

    function countMeasurementItems(fields) {
      const countText = String((fields && fields.measurement_item_count) || "").trim();
      const parsed = Number.parseInt(countText, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
      const raw = String((fields && fields.measurement_items) || "");
      return raw.split("\n").map((x) => x.trim()).filter(Boolean).length;
    }

    function resolveTemplateGenerationRule(templateName) {
      const name = String(templateName || "");
      return TEMPLATE_GENERATION_RULES.find((rule) => rule.pattern.test(name)) || TEMPLATE_GENERATION_RULES[TEMPLATE_GENERATION_RULES.length - 1];
    }

    function resolveTemplateRequiredFields(item) {
      if (!item || !item.templateName) return [];
      const rule = resolveTemplateGenerationRule(item.templateName);
      const id = String((rule && rule.id) || "default").trim();
      const fields = TEMPLATE_REQUIRED_FIELDS[id];
      return Array.isArray(fields) ? fields : [];
    }

    function validateItemForGeneration(item, generateMode = "certificate_template") {
      if (!item || generateMode === "source_file") return { ok: true, summary: "", issues: [] };
      const fields = item.fields || {};
      const issues = [];

      if (!item.templateName) issues.push("模板");
      if (!hasMeaningfulValue(fields.device_name)) issues.push("器具名称");
      if (!(hasMeaningfulValue(fields.device_model) || hasMeaningfulValue(fields.device_code))) issues.push("型号规格或器具编号");
      if (!hasMeaningfulValue(fields.manufacturer)) issues.push("生产厂商");

      const groupCount = Number.parseInt(String(fields.device_group_count || "0"), 10) || 0;
      if (groupCount > 1) issues.push(`来源文件包含${groupCount}组器具信息（需拆分后再生成）`);

      return {
        ok: issues.length === 0,
        issues,
        summary: issues.join("、"),
      };
    }

    function applyIncompleteState(item, validation) {
      if (!item || !validation || validation.ok) return;
      item.reportId = "";
      item.reportDownloadUrl = "";
      item.reportFileName = "";
      item.status = "incomplete";
      item.message = buildCategoryMessage(item, `待补全：${validation.summary}`);
    }

    function getTemplateMatchRawText(item) {
      if (!item) return "";
      const fields = item.fields || {};
      const hasBaseDeviceName = !!String(fields.device_name || "").trim();
      if (hasBaseDeviceName) {
        return [
          fields.device_name || "",
          fields.device_model || "",
          fields.device_code || "",
          item.fileName || "",
          item.sourceCode || "",
        ].filter(Boolean).join("\n");
      }
      return [
        item.rawText || "",
        fields.raw_record || "",
        fields.device_name || "",
        fields.device_model || "",
        fields.device_code || "",
        item.sourceCode || "",
      ].filter(Boolean).join("\n");
    }

    async function persistTemplateDefaultMapping(item, templateName) {
      if (!item) return;
      const normalizedTemplate = String(templateName || "").trim();
      if (!normalizedTemplate) return;
      const fields = item.fields || {};
      try {
        await runTemplateFeedback({
          template_name: normalizedTemplate,
          raw_text: getTemplateMatchRawText(item),
          file_name: String(item.fileName || ""),
          device_name: String(fields.device_name || ""),
          device_model: String(fields.device_model || ""),
          device_code: String(fields.device_code || ""),
          manufacturer: String(fields.manufacturer || ""),
          save_pending: false,
        });
      } catch (error) {
        appendLog(`默认模板保存失败：${error.message || "unknown"}`);
      }
    }

    async function applyAutoTemplateMatch(item, { force = false } = {}) {
      if (!item || isExcelItem(item)) return false;
      if (!force && item.templateName) return true;

      let matchedTemplate = "";
      let matchedBy = "";
      const rawText = getTemplateMatchRawText(item);
      const matchFileNameHint = (item && item.isRecordRow && item.fields && item.fields.device_name)
        ? String(item.fields.device_name || "").trim()
        : (item.fileName || "");
      try {
        const fields = (item && item.fields) || {};
        const data = await runTemplateMatch(rawText, matchFileNameHint, {
          device_name: String(fields.device_name || ""),
          device_code: String(fields.device_code || ""),
        });
        if (data && data.matched_template && state.templates.includes(data.matched_template)) {
          matchedTemplate = data.matched_template;
          matchedBy = data.matched_by || "";
        }
      } catch (error) {
        appendLog(`模板匹配失败 ${item.fileName}：${error.message || "unknown"}`);
      }

      if (!matchedTemplate) {
        const blankName = resolveBlankTemplateName();
        if (blankName) {
          matchedTemplate = blankName;
          matchedBy = "fallback:blank";
        }
      }

      item.templateName = matchedTemplate || "";
      item.matchedBy = matchedBy || "";
      item.templateUserSelected = false;
      item.status = "ready";
      if (matchedTemplate) {
        const validation = validateItemForGeneration(item, "certificate_template");
        if (!validation.ok) {
          applyIncompleteState(item, validation);
          if (item.matchedBy) item.message += `（${item.matchedBy}）`;
          return false;
        }
        item.message = buildCategoryMessage(item, "模板已自动命中");
        if (item.matchedBy) item.message += `（${item.matchedBy}）`;
        return true;
      }
      item.message = buildCategoryMessage(item, "识别完成，待匹配模板");
      return false;
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
        .replace(/^(?:器具编号|设备编号|编号)\s*[:：]?\s*/g, "")
        .trim();
      if (/^\/?\s*编号\s*[:：]?\s*$/.test(value) || value === "/") return "";
      return value;
    }

    function normalizeExtraKey(key) {
      return String(key || "").toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
    }

    const EXTRA_HIDDEN_KEYS = new Set([
      "devicename", "device_model", "devicemodel", "devicecode", "manufacturer", "unitname", "address",
      "powerrating", "manufacturedate", "contactinfo", "measurementitems", "measurementitemcount", "rawrecord",
      "器具名称", "设备名称", "仪器名称", "型号规格", "型号", "编号", "器具编号", "设备编号",
      "生产厂商", "制造厂商", "厂家", "厂商", "使用部门", "单位名称", "地址", "电源功率", "制造日期", "生产日期",
      "联系方式", "检测项数",
    ]);

    function parseSupplementalPairs(item) {
      const raw = String((item && item.fields && item.fields.raw_record) || (item && item.rawText) || "");
      if (!raw) return [];
      const pairs = [];
      const seen = new Set();
      raw.split("\n").map((x) => x.trim()).filter(Boolean).forEach((line) => {
        const match = line.match(/^([^:：]{1,80})[:：]\s*(.+)$/);
        if (!match) return;
        const key = match[1].trim();
        const value = match[2].trim();
        if (!key || !value) return;
        const normalizedKey = normalizeExtraKey(key);
        if (!normalizedKey || EXTRA_HIDDEN_KEYS.has(normalizedKey)) return;
        const dedupeKey = `${normalizedKey}::${value}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        pairs.push([key, value]);
      });
      return pairs;
    }

    function splitRecordBlocks(rawText) {
      const text = String(rawText || "").replace(/\r/g, "");
      if (!text.trim()) return [];
      const marker = /(设备名称|器具名称|仪器名称|设备名)\s*[:：]?/g;
      const starts = [];
      let match;
      while ((match = marker.exec(text)) !== null) {
        starts.push(match.index);
      }
      if (starts.length <= 1) {
        const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
        const softStarts = [];
        const deviceNameLike = /(试验仪|高温箱|电桥|局放仪|击穿|伸长|冲击|老化|温度|耐压|绝缘)/;
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          if (line.length < 3 || line.length > 40) continue;
          if (!deviceNameLike.test(line)) continue;
          const prev = i > 0 ? lines[i - 1] : "";
          if (/(单位名称|地址|联系方式|电话)/.test(prev)) continue;
          softStarts.push(i);
        }
        if (softStarts.length <= 1) return [text];
        const blocks = [];
        for (let i = 0; i < softStarts.length; i += 1) {
          const from = softStarts[i];
          const to = i + 1 < softStarts.length ? softStarts[i + 1] : lines.length;
          const chunk = lines.slice(from, to).join("\n").trim();
          if (chunk) blocks.push(chunk);
        }
        return blocks.length ? blocks : [text];
      }
      const blocks = [];
      for (let i = 0; i < starts.length; i += 1) {
        let from = starts[i];
        const to = i + 1 < starts.length ? starts[i + 1] : text.length;
        const lookback = text.slice(Math.max(0, from - 220), from);
        const lbLines = lookback.split("\n");
        let offset = 0;
        for (let j = lbLines.length - 1; j >= 0; j -= 1) {
          const raw = lbLines[j] || "";
          const line = raw.trim();
          offset += raw.length + 1;
          if (!line) continue;
          if (/^(?:\d+|[一二三四五六七八九十]+)[、.．)]/.test(line)) break;
          if (/(有限公司|厂商|厂家|制造|联系方式|电话|单位名称|地址)/.test(line)) {
            from = Math.max(0, from - offset);
            break;
          }
          if (offset > 120) break;
        }
        const chunk = text.slice(from, to).trim();
        if (chunk) blocks.push(chunk);
      }
      return blocks;
    }

    function parseDeviceGroupSummary(summaryText) {
      const lines = String(summaryText || "").split("\n").map((x) => x.trim()).filter(Boolean);
      const rows = [];
      lines.forEach((line) => {
        const match = line.match(/^\s*\d+\.\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/);
        if (!match) return;
        const normalize = (value) => {
          const text = String(value || "").trim();
          if (!text || text === "-" || text === "—") return "";
          return text;
        };
        const name = normalize(match[1]);
        const model = normalize(match[2]);
        const code = normalize(match[3]);
        if (!name) return;
        rows.push({ name, model, code });
      });
      return rows;
    }

    function looksLikeMeasurementStandardGroup(group, allGroups = []) {
      const name = String((group && group.name) || "").trim();
      const model = String((group && group.model) || "").trim();
      const code = String((group && group.code) || "").trim();
      if (!name) return true;

      const standardNameLike = /(数字温度表|热电偶|铜卷尺|标准器具|测量范围|溯源机构|证书编号|有效期限|measurement\s*range|traceability|certificate\s*number)/i;
      const hasColon = /[:：]/.test(name);
      const noModel = !model || model === "-" || model === "—";

      let duplicateCode = false;
      if (code) {
        const count = allGroups.filter((x) => String((x && x.code) || "").trim() === code).length;
        duplicateCode = count >= 2;
      }

      if (hasColon && noModel && duplicateCode) return true;
      if (standardNameLike.test(name) && noModel && (duplicateCode || !code)) return true;
      return false;
    }

    function buildMultiDeviceWordItems(sourceItem, baseFields) {
      const groups = parseDeviceGroupSummary(baseFields && baseFields.device_group_summary);
      if (groups.length < 2) return [];
      const filteredGroups = groups.filter((g) => !looksLikeMeasurementStandardGroup(g, groups));
      if (filteredGroups.length < 2) return [];
      const sharedFields = {};
      ["manufacturer", "unit_name", "address", "client_name", "certificate_no", "receive_date", "calibration_date", "release_date"].forEach((key) => {
        const value = String((baseFields && baseFields[key]) || "").trim();
        if (value) sharedFields[key] = value;
      });
      return filteredGroups.map((group, idx) => {
        const rowNumber = idx + 1;
        const rowRawRecord = [
          `器具名称: ${group.name || (baseFields && baseFields.device_name) || ""}`,
          `型号规格: ${group.model || ""}`,
          `器具编号: ${group.code || ""}`,
        ].join("\n");
        const fields = {
          ...createEmptyFields(),
          ...sharedFields,
          device_name: group.name || (baseFields && baseFields.device_name) || "",
          device_model: group.model || "",
          device_code: group.code || "",
          source_profile: "multi_device_baseinfo_word_split",
          source_profile_label: "多基础信息Word-拆分",
          device_group_count: "1",
          device_group_summary: "",
          raw_record: rowRawRecord,
        };
        const category = fields.device_name || `第${rowNumber}组`;
        const recordName = fields.device_name || fields.device_code || `group_${rowNumber}`;
        return {
          id: `${sourceItem.id}-g${rowNumber}-${Math.random().toString(16).slice(2, 8)}`,
          file: sourceItem.file,
          fileName: sourceItem.fileName,
          sourceFileName: sourceItem.sourceFileName || sourceItem.fileName,
          recordName,
          rowNumber,
          sheetName: "",
          isRecordRow: true,
          sourceType: sourceItem.sourceType,
          fileId: sourceItem.fileId,
          rawText: rowRawRecord,
          sourceCode: extractTemplateCode(`${sourceItem.fileName || ""}\n${fields.device_name || ""}\n${fields.device_model || ""}\n${fields.device_code || ""}`),
          recordCount: 1,
          category,
          fields,
          recognizedFields: { ...fields },
          templateName: "",
          matchedBy: "",
          templateUserSelected: false,
          status: "ready",
          message: buildCategoryMessage({ category, fields }, "已按多器具分组拆分，待匹配模板"),
          reportId: "",
          reportDownloadUrl: "",
          reportFileName: "",
          generalCheckStruct: sourceItem.generalCheckStruct || null,
        };
      });
    }

    function buildExcelRecordItems(sourceItem, inspect) {
      const records = Array.isArray(inspect && inspect.records) ? inspect.records : [];
      return records.map((rec, idx) => {
        const fields = { ...createEmptyFields(), ...(rec.fields || {}) };
        const templateName = String(rec.template_name || "").trim();
        const rowNumber = Number(rec.row_number || 0) || (idx + 1);
        const sheetName = String(rec.sheet_name || "").trim();
        const rowName = String(rec.row_name || "").trim();
        const recordName = rowName || fields.device_name || fields.device_code || `第${rowNumber}条`;
        return {
          id: `${sourceItem.id}-r${rowNumber}-${Math.random().toString(16).slice(2, 8)}`,
          file: sourceItem.file,
          fileName: sourceItem.fileName,
          sourceFileName: sourceItem.sourceFileName || sourceItem.fileName,
          recordName,
          rowNumber,
          sheetName,
          isRecordRow: true,
          sourceType: sourceItem.sourceType,
          fileId: sourceItem.fileId,
          rawText: fields.raw_record || "",
          sourceCode: "",
          recordCount: 1,
          category: fields.device_name || "Excel记录",
          fields,
          recognizedFields: { ...fields },
          templateName,
          matchedBy: templateName ? "excel:auto" : "",
          templateUserSelected: false,
          status: "ready",
          message: templateName
            ? `记录${rowNumber} 识别完成（形态:${resolveSourceProfileLabel({ fields }) || "Excel行"}），模板已匹配`
            : `记录${rowNumber} 识别完成（形态:${resolveSourceProfileLabel({ fields }) || "Excel行"}），待匹配模板`,
          reportId: "",
          reportDownloadUrl: "",
          reportFileName: "",
        };
      });
    }

    async function runEditorPrefill(templateName, item) {
      return runEditorPrefillApi(templateName, item);
    }

    async function generateItem(item, generateMode = "certificate_template") {
      if (isExcelItem(item)) throw new Error("Excel 文件请用 Excel 批量生成");
      if (!item.isRecordRow && (!item.fileId || item.status === "pending")) await processItem(item);
      if (item.isRecordRow && !item.fileId) await ensureSourceFileId(item);
      if (generateMode === "source_file") {
        if (!item.fileId) {
          const up = await uploadFile(item.file);
          item.fileId = up.file_id;
        }
        if (!item.fileId) throw new Error("证书模板来源文件未上传，无法生成");
        item.reportId = `source_${item.fileId}`;
        item.reportDownloadUrl = `/api/upload/${item.fileId}/download`;
        item.reportFileName = item.fileName || "source_file";
        item.status = "generated";
        item.message = "已导出证书模板来源文件（未套模板）";
        renderQueue();
        return { report_id: item.reportId, download_url: item.reportDownloadUrl };
      }
      if (!item.templateName) throw new Error("未选择模板");
      const validation = validateItemForGeneration(item, generateMode);
      const incompleteSummary = validation.ok ? "" : String(validation.summary || "");
      if (!validation.ok) {
        item.status = "incomplete";
        item.message = buildCategoryMessage(item, `字段不全：${incompleteSummary}（可继续生成）`);
        renderQueue();
      }
      const fieldsForGenerate = {
        ...(item.fields || {}),
      };
      if (item && item.generalCheckStruct) {
        const gcData = buildGeneralCheckWysiwygData(String(fieldsForGenerate.general_check_full || ""), {
          tableStruct: item.generalCheckStruct,
        });
        const gcHeader = Array.isArray(gcData && gcData.header) ? gcData.header : [];
        const gcRows = Array.isArray(gcData && gcData.rows) ? gcData.rows : [];
        if (gcHeader.length && gcRows.length) {
          const gcTsv = [gcHeader, ...gcRows]
            .map((row) => (Array.isArray(row) ? row : []).map((cell) => String(cell || "").trim()).join("\t"))
            .join("\n");
          if (String(gcTsv || "").trim()) {
            fieldsForGenerate.general_check_full = gcTsv;
            if (!String(fieldsForGenerate.general_check || "").trim()) {
              fieldsForGenerate.general_check = gcTsv;
            }
          }
        }
      }
      const payload = {
        template_name: item.templateName,
        source_file_id: item.fileId || null,
        fields: {
          ...fieldsForGenerate,
          instrument_catalog_names: state.instrumentCatalogNames.join("\n"),
          instrument_catalog_rows_json: JSON.stringify(state.instrumentCatalogRows || []),
          raw_record: item.rawText || fieldsForGenerate.raw_record || "",
        },
      };
      const data = await fetchJson("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      item.reportId = data.report_id;
      item.reportDownloadUrl = data.download_url;
      item.reportFileName = item.templateName || "report.docx";
      if (item.templateUserSelected) {
        await persistTemplateDefaultMapping(item, item.templateName);
      }
      if (incompleteSummary) {
        item.status = "incomplete";
        item.message = buildCategoryMessage(item, `已生成（字段不全：${incompleteSummary}）`);
      } else {
        item.status = "generated";
        item.message = "已生成";
      }
      renderQueue();
      return data;
    }

    async function processItem(item) {
      if (item.isRecordRow) {
        if (!item.recognizedFields || typeof item.recognizedFields !== "object") {
          item.recognizedFields = { ...(item.fields || {}) };
        }
        item.status = "ready";
        if (!item.templateName) await applyAutoTemplateMatch(item, { force: true });
        else item.message = "记录已就绪，可生成";
        renderQueue();
        renderTemplateSelect();
        return;
      }
      if (isExcelItem(item)) {
        item.status = "processing";
        item.message = "记录计数中";
        renderQueue();
        if (!item.fileId) {
          const up = await uploadFile(item.file);
          item.fileId = up.file_id;
        }
        const inspect = await runExcelInspect(item.fileId, item.templateName || "");
        const recordRows = buildExcelRecordItems(item, inspect);
        if (!recordRows.length) {
          item.recordCount = inspect.total_rows || 0;
          item.category = "Excel批量";
          item.status = "error";
          item.message = (inspect.errors && inspect.errors[0]) || "Excel 未识别到有效记录";
          renderQueue();
          return;
        }
        for (const recordItem of recordRows) {
          if (!recordItem.templateName) await applyAutoTemplateMatch(recordItem, { force: true });
        }
        const index = state.queue.findIndex((x) => x.id === item.id);
        if (index >= 0) {
          state.queue.splice(index, 1, ...recordRows);
          state.activeId = recordRows[0].id;
        }
        renderQueue();
        renderTemplateSelect();
        return;
      }
      item.status = "processing";
      item.message = "上传中";
      item.reportId = "";
      item.reportDownloadUrl = "";
      item.reportFileName = "";
      renderQueue();

      if (!item.fileId) {
        const up = await uploadFile(item.file);
        item.fileId = up.file_id;
      }

      item.message = "识别中";
      renderQueue();
      const ocr = await runOcr(item.fileId);
      item.rawText = ocr.raw_text || "";
      const ext = extFromName(item.fileName || "");
      const blocks = ext === ".docx" ? [item.rawText] : splitRecordBlocks(item.rawText);
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
          appendLog(`结构化器具表提取失败 ${item.fileName}：${error.message || "unknown"}`);
        }
        try {
          const structRes = await runGeneralCheckStructureExtract(item.fileId);
          if (structRes && structRes.table && Array.isArray(structRes.table.cells) && structRes.table.cells.length) {
            generalCheckStructureData = structRes.table;
          }
        } catch (error) {
          appendLog(`续页结构提取失败 ${item.fileName}：${error.message || "unknown"}`);
        }
      }
      item.generalCheckStruct = generalCheckStructureData;

      if (blocks.length > 1) {
        item.message = "多记录拆分中";
        renderQueue();
        const sharedFields = await runExtract(item.rawText);
        applyStructuredMeasurementItems(sharedFields, structuredInstrumentData);
        const recordRows = [];
        for (let i = 0; i < blocks.length; i += 1) {
          const block = blocks[i];
          const rowNumber = i + 1;
          const fields = await runExtract(block);
          const mergedFields = { ...createEmptyFields(), ...sharedFields, ...fields, raw_record: block };
          applyStructuredMeasurementItems(mergedFields, structuredInstrumentData);
          const tmpItem = {
            ...item,
            rawText: block,
            fields: mergedFields,
            sourceCode: extractTemplateCode(`${item.fileName || ""}\n${block}`),
          };
          const category = inferCategory(tmpItem);

          const recordName = mergedFields.device_name || mergedFields.device_code || `record_${rowNumber}`;
          const recordItem = {
            id: `${item.id}-m${rowNumber}-${Math.random().toString(16).slice(2, 8)}`,
            file: item.file,
            fileName: item.fileName,
            sourceFileName: item.sourceFileName || item.fileName,
            recordName,
            rowNumber,
            sheetName: "",
            isRecordRow: true,
            sourceType: item.sourceType,
            fileId: item.fileId,
            rawText: block,
            sourceCode: tmpItem.sourceCode || "",
            recordCount: 1,
            category,
            fields: mergedFields,
            recognizedFields: { ...mergedFields },
            templateName: "",
            matchedBy: "",
            templateUserSelected: false,
            status: "ready",
            message: buildCategoryMessage({ category, fields: mergedFields }, "识别完成，待匹配模板"),
            reportId: "",
            reportDownloadUrl: "",
            reportFileName: "",
            generalCheckStruct: generalCheckStructureData,
          };
          await applyAutoTemplateMatch(recordItem, { force: true });
          recordRows.push(recordItem);
        }

        const index = state.queue.findIndex((x) => x.id === item.id);
        if (index >= 0) {
          state.queue.splice(index, 1, ...recordRows);
          state.activeId = recordRows[0].id;
        }
        renderQueue();
        renderTemplateSelect();
        return;
      }

      item.message = "分类中";
      renderQueue();
      const fields = await runExtract(item.rawText);
      item.fields = { ...createEmptyFields(), ...fields, raw_record: item.rawText };
      applyStructuredMeasurementItems(item.fields, structuredInstrumentData);
      item.recognizedFields = { ...item.fields };
      item.sourceCode = resolveSourceCode(item);
      item.category = inferCategory(item);
      item.generalCheckStruct = generalCheckStructureData;

      if (ext === ".docx") {
        const groupItems = buildMultiDeviceWordItems(item, item.fields || {});
        if (groupItems.length > 1) {
          item.recordCount = groupItems.length;
          for (const row of groupItems) {
            await applyAutoTemplateMatch(row, { force: true });
          }
          const index = state.queue.findIndex((x) => x.id === item.id);
          if (index >= 0) {
            state.queue.splice(index, 1, ...groupItems);
            state.activeId = groupItems[0].id;
          }
          renderQueue();
          renderTemplateSelect();
          appendLog(`多器具拆分完成 ${item.fileName}：${groupItems.length} 条`);
          return;
        }
      }

      item.message = "识别结果整理中";
      renderQueue();
      item.templateName = "";
      item.matchedBy = "";
      item.templateUserSelected = false;
      await applyAutoTemplateMatch(item, { force: true });
      renderQueue();
      renderTemplateSelect();
    }

    async function processAllPending() {
      const targets = state.queue.filter((x) => x.status === "pending");
      if (!targets.length) {
        setStatus("没有待识别项");
        return;
      }
      setLoading(true, "预处理中...");
      setPreprocessProgress(0, targets.length, "");
      let done = 0;
      for (const item of targets) {
        state.activeId = item.id;
        renderQueue();
        renderTemplateSelect();
        try {
          setPreprocessProgress(done, targets.length, item.fileName);
          await processItem(item);
        } catch (error) {
          item.status = "error";
          item.message = error.message || "处理失败";
          renderQueue();
          appendLog(`处理失败 ${item.fileName}：${item.message}`);
        }
        done += 1;
        setPreprocessProgress(done, targets.length, item.fileName);
      }
      clearPreprocessProgress();
      setLoading(false);
      setStatus("识别完成");
    }

    async function refreshAllRecognition() {
      const groupedExcelRecordRows = new Map();
      const normalTargets = [];
      for (const item of state.queue) {
        if (!item) continue;
        if (item.status === "generated" || item.status === "confirmed") continue;
        const isExcelRecordRow = !!(item.isRecordRow && isExcelExt(extFromName(item.fileName)) && item.fileId);
        if (isExcelRecordRow) {
          const key = item.fileId || item.sourceFileName || item.fileName || item.id;
          const group = groupedExcelRecordRows.get(key) || [];
          group.push(item);
          groupedExcelRecordRows.set(key, group);
          continue;
        }
        if (!isExcelItem(item)) normalTargets.push(item);
      }

      const excelGroups = Array.from(groupedExcelRecordRows.values());
      const totalTargets = excelGroups.length + normalTargets.length;
      if (!totalTargets) {
        setStatus("没有可刷新的识别项");
        return;
      }
      setLoading(true, "刷新识别中...");
      setPreprocessProgress(0, totalTargets, "", "刷新识别");
      let done = 0;

      for (const group of excelGroups) {
        const sample = group[0];
        if (!sample) continue;
        state.activeId = sample.id;
        renderQueue();
        renderTemplateSelect();
        try {
          setPreprocessProgress(done, totalTargets, sample.fileName, "刷新识别");
          const inspect = await runExcelInspect(sample.fileId, "");
          const sourceItem = {
            ...sample,
            id: `${sample.id}-refresh-${Math.random().toString(16).slice(2, 8)}`,
            isRecordRow: false,
          };
          const refreshedRows = buildExcelRecordItems(sourceItem, inspect);
          for (const row of refreshedRows) {
            if (!row.templateName) await applyAutoTemplateMatch(row, { force: true });
          }
          const oldIds = new Set(group.map((x) => x.id));
          const indexes = [];
          state.queue.forEach((x, idx) => {
            if (oldIds.has(x.id)) indexes.push(idx);
          });
          if (indexes.length) {
            const start = indexes[0];
            for (let i = indexes.length - 1; i >= 0; i -= 1) {
              state.queue.splice(indexes[i], 1);
            }
            state.queue.splice(start, 0, ...refreshedRows);
            if (refreshedRows.length) state.activeId = refreshedRows[0].id;
          }
          appendLog(`Excel记录刷新完成 ${sample.fileName}：${refreshedRows.length} 条`);
          renderQueue();
          renderTemplateSelect();
        } catch (error) {
          for (const row of group) {
            row.status = "error";
            row.message = error.message || "刷新失败";
          }
          renderQueue();
          appendLog(`刷新失败 ${sample.fileName}：${error.message || "unknown"}`);
        }
        done += 1;
        setPreprocessProgress(done, totalTargets, sample.fileName, "刷新识别");
      }

      for (const item of normalTargets) {
        state.activeId = item.id;
        renderQueue();
        renderTemplateSelect();
        try {
          setPreprocessProgress(done, totalTargets, item.fileName, "刷新识别");
          if (item.status === "pending") {
            await processItem(item);
          } else {
            item.status = "processing";
            item.message = "字段重识别中";
            item.reportId = "";
            item.reportDownloadUrl = "";
            item.reportFileName = "";
            renderQueue();

            const rawText = String(item.rawText || (item.fields && item.fields.raw_record) || "");
            if (rawText) {
              item.rawText = rawText;
              const fields = await runExtract(rawText);
              item.fields = { ...createEmptyFields(), ...(item.fields || {}), ...fields, raw_record: rawText };
              item.recognizedFields = { ...item.fields };
            } else {
              item.fields = { ...createEmptyFields(), ...(item.fields || {}) };
              item.recognizedFields = { ...item.fields };
            }
            item.sourceCode = resolveSourceCode(item);
            item.category = inferCategory(item);
            item.templateName = "";
            item.matchedBy = "";
            item.templateUserSelected = false;
            await applyAutoTemplateMatch(item, { force: true });
          }
        } catch (error) {
          item.status = "error";
          item.message = error.message || "刷新失败";
          renderQueue();
          appendLog(`刷新失败 ${item.fileName}：${item.message}`);
        }
        done += 1;
        setPreprocessProgress(done, totalTargets, item.fileName, "刷新识别");
      }
      clearPreprocessProgress();
      setLoading(false);
      setStatus(`刷新识别完成（${done}/${totalTargets}）`);
      appendLog(`刷新识别完成：${done}/${totalTargets}`);
      renderQueue();
      renderTemplateSelect();
    }

    async function generateAllReady(targetIds = null) {
      const hasExplicitSelection = Array.isArray(targetIds);
      const selectedSet = hasExplicitSelection ? new Set(targetIds.filter(Boolean)) : null;
      if (hasExplicitSelection && !selectedSet.size) {
        const reason = "请先勾选要批量生成的记录";
        setStatus(reason);
        appendLog(reason);
        return { generated: 0, skipped: 0, failed: 0, total: 0 };
      }
      const targets = state.queue.filter((x) => {
        if (isExcelItem(x)) return false;
        if (selectedSet && !selectedSet.has(x.id)) return false;
        return true;
      });
      if (!targets.length) {
        const reason = hasExplicitSelection ? "所选记录均不可批量生成（可能全是 Excel 记录）" : "没有可生成项";
        setStatus(reason);
        appendLog(reason);
        return { generated: 0, skipped: 0, failed: 0, total: 0 };
      }
      let generated = 0;
      let skipped = 0;
      let failed = 0;
      for (const item of targets) {
        state.activeId = item.id;
        renderQueue();
        renderTemplateSelect();
        try {
          // Batch mode should be tolerant: try to prepare each item instead of
          // silently skipping when status is not already ready.
          if (item.status === "pending") {
            setLoading(true, `预处理中：${item.fileName}`);
            await processItem(item);
            setLoading(false);
          }
          if (!item.templateName) {
            await applyAutoTemplateMatch(item, { force: true });
          }
          const validation = validateItemForGeneration(item, "certificate_template");
          if (!validation.ok) {
            applyIncompleteState(item, validation);
            appendLog(`跳过（待补全） ${item.fileName}：${item.message || "字段未满足生成条件"}`);
            skipped += 1;
            continue;
          }
          setLoading(true, `生成中：${item.fileName}`);
          await generateItem(item);
          appendLog(`生成完成：${item.fileName}`);
          generated += 1;
        } catch (error) {
          item.status = "error";
          item.message = error.message || "生成失败";
          renderQueue();
          appendLog(`生成失败 ${item.fileName}：${item.message}`);
          failed += 1;
        } finally {
          setLoading(false);
        }
      }
      const targetIdSet = new Set(targets.map((x) => x.id));
      for (const id of Array.from(state.selectedIds)) {
        if (!targetIdSet.has(id)) continue;
        const current = state.queue.find((x) => x.id === id);
        if (!current || current.status !== "generated") state.selectedIds.delete(id);
      }
      renderQueue();
      const summary = `批量生成完成：成功${generated}，跳过${skipped}，失败${failed}`;
      setStatus(summary);
      appendLog(summary);
      return { generated, skipped, failed, total: targets.length };
    }

    async function triggerDownload(url, name) {
      const res = await fetch(url);
      if (!res.ok) throw new Error("下载失败");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = name || "report.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    }

    async function exportAll(targetIds = null) {
      const selectedSet = targetIds && targetIds.length ? new Set(targetIds) : null;
      const targets = state.queue.filter((x) => {
        if (isExcelItem(x)) return false;
        if (selectedSet && !selectedSet.has(x.id)) return false;
        return !!x.reportDownloadUrl;
      });
      if (!targets.length) {
        setStatus("没有可导出项");
        return;
      }
      for (const item of targets) {
        try {
          setLoading(true, `导出中：${item.fileName}`);
          await triggerDownload(item.reportDownloadUrl, item.reportFileName || item.templateName || item.fileName || "report.docx");
          item.status = "generated";
          item.message = "已导出";
          renderQueue();
        } catch (error) {
          appendLog(`导出失败 ${item.fileName}：${error.message || "unknown"}`);
        } finally {
          setLoading(false);
        }
      }
      setStatus("批量导出完成");
    }

    async function runExcelBatch(item) {
      if (!item || !isExcelItem(item)) throw new Error("请先选择 Excel 文件");
      if (!item.fileId) {
        const up = await uploadFile(item.file);
        item.fileId = up.file_id;
      }
      const data = await fetchJson("/api/report/batch-from-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: item.fileId,
          sheet_name: null,
          default_template_name: item.templateName || null,
        }),
      });
      await triggerDownload(data.download_url, `${item.fileName.replace(/\.xlsx$/i, "") || "excel_batch"}.zip`);
      item.status = "generated";
      item.message = `Excel批量：生成${data.generated_count} 跳过${data.skipped_count}`;
      renderQueue();
      appendLog(`Excel批量完成 ${item.fileName}：生成${data.generated_count} 跳过${data.skipped_count}`);
    }

    function revokeBlobUrl(kind) {
      const url = state.blobUrls[kind];
      if (url) {
        URL.revokeObjectURL(url);
        state.blobUrls[kind] = "";
      }
    }

    function setPreviewPlaceholder(elId, text) {
      $(elId).innerHTML = `<div class="placeholder">${escapeHtml(text)}</div>`;
    }

    function getJszipUrls() {
      return state.runtime.offlineMode ? [...LOCAL_JSZIP_URLS] : [...LOCAL_JSZIP_URLS, ...EXTERNAL_JSZIP_URLS];
    }

    function getDocxPreviewUrls() {
      return state.runtime.offlineMode ? [...LOCAL_DOCX_PREVIEW_URLS] : [...LOCAL_DOCX_PREVIEW_URLS, ...EXTERNAL_DOCX_PREVIEW_URLS];
    }

    function getDocxPreviewCssUrls() {
      return state.runtime.offlineMode ? [...LOCAL_DOCX_PREVIEW_CSS_URLS] : [...LOCAL_DOCX_PREVIEW_CSS_URLS, ...EXTERNAL_DOCX_PREVIEW_CSS_URLS];
    }

    function loadStyleOnce(url) {
      return new Promise((resolve) => {
        const exists = document.querySelector(`link[data-src="${url}"]`);
        if (exists) {
          if (exists.dataset.loaded === "1") return resolve(true);
          exists.addEventListener("load", () => resolve(true), { once: true });
          exists.addEventListener("error", () => resolve(false), { once: true });
          return;
        }
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = url;
        link.dataset.src = url;
        link.addEventListener("load", () => { link.dataset.loaded = "1"; resolve(true); }, { once: true });
        link.addEventListener("error", () => resolve(false), { once: true });
        document.head.appendChild(link);
      });
    }

    function loadScriptOnce(url) {
      return new Promise((resolve) => {
        const exists = document.querySelector(`script[data-src="${url}"]`);
        if (exists) {
          if (exists.dataset.loaded === "1") return resolve(true);
          exists.addEventListener("load", () => resolve(true), { once: true });
          exists.addEventListener("error", () => resolve(false), { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = url;
        script.async = true;
        script.dataset.src = url;
        script.addEventListener("load", () => { script.dataset.loaded = "1"; resolve(true); }, { once: true });
        script.addEventListener("error", () => resolve(false), { once: true });
        document.head.appendChild(script);
      });
    }

    async function loadCssFromCandidates(urls) {
      for (const url of urls) {
        const ok = await loadStyleOnce(url);
        if (ok) return true;
      }
      return false;
    }

    async function loadFromCandidates(urls, readyCheck) {
      for (const url of urls) {
        const ok = await loadScriptOnce(url);
        if (ok && readyCheck()) return true;
      }
      return readyCheck();
    }

    function hasDocxLibReady() {
      return !!(window.JSZip && window.docx && typeof window.docx.renderAsync === "function");
    }

    async function ensureDocxLib() {
      if (state.docxReady && hasDocxLibReady()) return true;
      if (state.docxLoadingPromise) return state.docxLoadingPromise;
      state.docxLoadingPromise = new Promise((resolve) => {
        (async () => {
          await loadCssFromCandidates(getDocxPreviewCssUrls());
          const jszipReady = await loadFromCandidates(getJszipUrls(), () => !!window.JSZip);
          if (!jszipReady) return resolve(false);
          const docxReady = await loadFromCandidates(getDocxPreviewUrls(), () => !!(window.docx && typeof window.docx.renderAsync === "function"));
          state.docxReady = jszipReady && docxReady && hasDocxLibReady();
          resolve(state.docxReady);
        })();
      });
      return state.docxLoadingPromise;
    }

    async function renderDocx(elId, arrayBuffer) {
      const el = $(elId);
      el.innerHTML = '<div class="placeholder">Word 渲染中...</div>';
      const ok = await ensureDocxLib();
      if (!ok) {
        const msg = state.runtime.offlineMode
          ? "离线模式缺少 Word 预览组件：请补齐 /static/vendor/jszip.min.js、docx-preview.min.js、docx-preview.css"
          : "Word 预览组件加载失败";
        setPreviewPlaceholder(elId, msg);
        appendLog(msg);
        return;
      }
      el.innerHTML = '<div id="docx_mount" style="padding:8px;"></div>';
      try {
        await window.docx.renderAsync(arrayBuffer, el.firstElementChild, undefined, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
        });
      } catch (error) {
        setPreviewPlaceholder(elId, `Word 渲染失败：${error.message || "unknown"}`);
      }
    }

    async function ensureSourceFileId(item) {
      if (!item) return "";
      if (item.fileId) return item.fileId;
      if (!item.file) return "";
      const up = await uploadFile(item.file);
      item.fileId = up.file_id;
      return item.fileId;
    }

    function getFieldLabel(key) {
      const normalized = String(key || "").trim();
      if (!normalized) return "";
      return SOURCE_FIELD_LABELS[normalized] || normalized;
    }

    function ensureTemplateEditorSchema(templateName, expectedItemId = "") {
      const normalized = String(templateName || "").trim();
      if (!normalized) return;
      if (Object.prototype.hasOwnProperty.call(state.editorSchemaByTemplate, normalized)) return;
      state.editorSchemaByTemplate[normalized] = { loading: true, editor_schema: null };
      runTemplateEditorSchema(normalized).then((data) => {
        state.editorSchemaByTemplate[normalized] = {
          loading: false,
          editor_schema: (data && data.editor_schema) || null,
        };
      }).catch(() => {
        state.editorSchemaByTemplate[normalized] = { loading: false, editor_schema: null };
      }).finally(() => {
        const active = getActiveItem();
        if (!active) return;
        if (expectedItemId && active.id !== expectedItemId) return;
        renderTargetFieldForm(active);
      });
    }

    function resolveTargetFormFields(item, fields) {
      if (item && item.templateName) {
        ensureTemplateEditorSchema(item.templateName, item.id || "");
        const schemaState = state.editorSchemaByTemplate[String(item.templateName || "").trim()];
        if (schemaState && !schemaState.loading && schemaState.editor_schema && Array.isArray(schemaState.editor_schema.fields)) {
          const schemaFields = schemaState.editor_schema.fields.map((x) => ({
            key: x.key,
            label: x.label,
            wide: !!x.wide,
          }));
          if (schemaFields.length) {
            return {
              fields: schemaFields,
              note: String(schemaState.editor_schema.note || "").trim(),
              loading: false,
            };
          }
        }
        if (schemaState && schemaState.loading) {
          return {
            fields: TARGET_BASIC_FORM_FIELDS,
            note: "",
            loading: true,
          };
        }
      }
      return {
        fields: TARGET_BASIC_FORM_FIELDS,
        note: "",
        loading: false,
      };
    }

    function getProblemFieldKeys(item, formFields = []) {
      const problemKeys = new Set();
      if (!item || !item.fields) return problemKeys;
      const fields = item.fields || {};

      if (!hasMeaningfulValue(fields.device_name)) problemKeys.add("device_name");

      const hasModel = hasMeaningfulValue(fields.device_model);
      const hasCode = hasMeaningfulValue(fields.device_code);
      if (!hasModel && !hasCode) {
        problemKeys.add("device_model");
        problemKeys.add("device_code");
      }

      if (!hasMeaningfulValue(fields.manufacturer)) problemKeys.add("manufacturer");

      const templateRequired = resolveTemplateRequiredFields(item);
      templateRequired.forEach((key) => {
        if (!hasMeaningfulValue(fields[key])) problemKeys.add(key);
      });

      return problemKeys;
    }

    function extractCalibrationInfoFields(raw, src = {}) {
      const normalizedSrc = (src && typeof src === "object") ? src : {};
      const block = extractBlockByLine(
        raw,
        [/(?:其它|其他)校准信息|Calibration Information/i],
        [/(?:一般检查|General inspection)/i, /^备注[:：]?/i, /^结果[:：]?/i, /(?:检测员|校准员|核验员)/],
      );
      const source = block || String(raw || "");
      const fullSource = String(raw || "");
      const pick = (...values) => {
        for (const v of values) {
          const t = normalizeOptionalBlank(v);
          if (t) return t;
        }
        return "";
      };
      const fromPattern = (pattern) => {
        const m = String(source || "").match(pattern);
        if (!m || !m[1]) return "";
        return normalizeOptionalBlank(String(m[1] || "").trim());
      };
      const location = pick(
        normalizedSrc.location,
        fromPattern(/(?:地点|Location)[:：]?\s*([^\n|；;]+)/i),
      );
      const temperature = pick(
        normalizedSrc.temperature ? `${String(normalizedSrc.temperature).trim()}℃` : "",
        fromPattern(/(?:温度|Ambient\s*temperature)[:：]?\s*([^\n|；;]+)/i),
      );
      const humidity = pick(
        normalizedSrc.humidity ? `${String(normalizedSrc.humidity).trim()}%RH` : "",
        fromPattern(/(?:湿度|Relative\s*humidity)[:：]?\s*([^\n|；;]+)/i),
      );
      const other = pick(
        normalizedSrc.calibration_other,
        fromPattern(/(?:^|\n)\s*(?:其它|其他|Others)\s*[:：]\s*([^\n|；;]+)/i),
      );
      const receiveDateFromBlock = parseDateFromLabelText(source, "(?:收\\s*样\\s*日\\s*期|Received\\s*date)");
      const receiveDateFromRaw = parseDateFromLabelText(fullSource, "(?:收\\s*样\\s*日\\s*期|Received\\s*date)");
      const receiveDate = pick(
        isCompleteDateText(normalizedSrc.receive_date) ? normalizedSrc.receive_date : "",
        receiveDateFromBlock,
        receiveDateFromRaw,
        normalizedSrc.receive_date,
      );
      const calibrationDateFromBlock = parseDateFromLabelText(source, "(?:校\\s*准\\s*日\\s*期|Date\\s*for\\s*calibration)");
      const calibrationDateFromRaw = parseDateFromLabelText(fullSource, "(?:校\\s*准\\s*日\\s*期|Date\\s*for\\s*calibration)");
      const calibrationDate = pick(
        isCompleteDateText(normalizedSrc.calibration_date) ? normalizedSrc.calibration_date : "",
        calibrationDateFromBlock,
        calibrationDateFromRaw,
        normalizedSrc.calibration_date,
      );
      const releaseDateFromRaw = parseDateFromLabelText(fullSource, "(?:发\\s*布\\s*日\\s*期|发布日期|Issue\\s*date|Date\\s*of\\s*issue|Date\\s*of\\s*publication)");
      const releaseDate = pick(
        isCompleteDateText(normalizedSrc.release_date) ? normalizedSrc.release_date : "",
        releaseDateFromRaw,
        normalizedSrc.release_date,
      );
      const inferred = inferDateTriplet({ receiveDate, calibrationDate, releaseDate });
      return {
        location,
        temperature: temperature.replace(/\s+/g, ""),
        humidity: humidity.replace(/\s+/g, ""),
        other,
        receiveDate: inferred.receiveDate || "",
        calibrationDate: inferred.calibrationDate || "",
        releaseDate: inferred.releaseDate || "",
      };
    }

    function extractBasisSummary(raw, src = {}) {
      const normalizeCode = (code) => String(code || "")
        .replace(/\s+/g, " ")
        .replace(/\s*\/\s*/g, "/")
        .replace(/\/\s*T\s*/ig, "/T ")
        .trim();
      const collectCodes = (text) => {
        const source = String(text || "");
        if (!source.trim()) return [];
        const list = [];
        const seen = new Set();
        const regex = /([A-Za-z]{1,5}\s*\/\s*T\s*\d+(?:\.\d+)?-\d{4})/ig;
        let m;
        while ((m = regex.exec(source)) !== null) {
          const code = normalizeCode(m[1] || "");
          if (!code || seen.has(code)) continue;
          seen.add(code);
          list.push(code);
        }
        return list;
      };
      const fromArray = Array.isArray(src && src.basis_standard_items) ? src.basis_standard_items : [];
      if (fromArray.length) {
        const arrCodes = collectCodes(fromArray.join("\n"));
        if (arrCodes.length) return arrCodes.join("\n");
      }
      const direct = String((src && (src.basis_standard || src.calibration_basis)) || "").trim();
      if (direct) {
        const directCodes = collectCodes(direct);
        return directCodes.length ? directCodes.join("\n") : direct;
      }
      const text = cleanBlockText(raw);
      if (!text) return "";
      const block = extractBlockByLine(
        text,
        [/(?:本次校准所依据的技术规范|Reference documents for the calibration|检测\/?校准依据|校准依据)/i],
        [/(?:本次校准所使用的主要计量标准器具|Main measurement standard instruments)/i, /(?:其它|其他)校准信息|Calibration Information/i, /(?:一般检查|General inspection)/i, /^备注[:：]?/i, /^结果[:：]?/i, /(?:检测员|校准员|核验员)/],
      );
      const codes = collectCodes(block || text);
      return codes.join("\n");
    }

    function buildFocusSections(item, src, problemKeys, includeExtraRows = true) {
      const normalizedSrc = (src && typeof src === "object") ? src : {};
      const raw = String(
        normalizedSrc.raw_record
        || (item && item.fields && item.fields.raw_record)
        || (item && item.rawText)
        || "",
      );
      const sections = [];
      const mainRows = [
        { key: "certificate_no", label: "缆专检号:", value: String(normalizedSrc.certificate_no || "").trim() },
        { key: "client_name", label: "委托单位:", value: String(normalizedSrc.client_name || normalizedSrc.unit_name || "").trim() },
        { key: "address", label: "地址:", value: String(normalizedSrc.address || "").trim() },
        { key: "device_name", label: "器具名称:", value: String(normalizedSrc.device_name || "").trim() },
        { key: "manufacturer", label: "制造厂/商:", value: String(normalizedSrc.manufacturer || "").trim() },
        { key: "device_model", label: "型号/规格:", value: String(normalizedSrc.device_model || "").trim() },
        { key: "device_code", label: "器具编号:", value: String(normalizedSrc.device_code || "").trim() },
      ].filter((row) => !!normalizeOptionalBlank(row.value));
      if (mainRows.length) sections.push({ title: "主要信息", rows: mainRows });

      const calibrationInfo = extractCalibrationInfoFields(raw, normalizedSrc);
      normalizedSrc.receive_date = calibrationInfo.receiveDate || normalizedSrc.receive_date || "";
      normalizedSrc.calibration_date = calibrationInfo.calibrationDate || normalizedSrc.calibration_date || "";
      normalizedSrc.release_date = calibrationInfo.releaseDate || normalizedSrc.release_date || "";
      normalizedSrc.calibration_other = calibrationInfo.other || normalizedSrc.calibration_other || "";

      const basisText = extractBasisSummary(raw, normalizedSrc);
      const basisRows = [
        { key: "release_date", label: "发布日期", value: normalizedSrc.release_date || "", optional: true },
      ].filter((row) => !!normalizeOptionalBlank(row.value));
      if (basisText || basisRows.length) {
        sections.push({
          title: "本次校准所依据的技术规范（代号、名称）",
          rows: basisRows,
          block: basisText,
        });
      }

      const instrumentBlock = extractBlockByLine(
        raw,
        [/(?:本次校准所使用的主要计量标准器具|主要计量标准器具|Main measurement standard instruments)/i],
        [/(?:本次校准所依据的技术规范|检测\/校准依据|校准依据)/i, /(?:其它|其他)校准信息|Calibration Information/i, /(?:一般检查|General inspection)/i, /^备注[:：]?/i],
      );
      const normalizedInstrument = safeNormalizeMeasurementItemsText(
        { recognizedFields: normalizedSrc, rawText: raw, fields: normalizedSrc },
        normalizedSrc,
      );
      const measurementItemsRaw = String(normalizedSrc.measurement_items || "").trim();
      const measurementItemsRows = measurementItemsRaw ? parseTableRowsFromBlock(measurementItemsRaw) : null;
      const safeMeasurementItems = (measurementItemsRows && measurementItemsRows.length >= 2) ? measurementItemsRaw : "";
      const instrumentText = String(
        normalizedInstrument
        || instrumentBlock
        || safeMeasurementItems
        || "",
      ).trim();
      if (instrumentText) {
        sections.push({
          title: "本次校准所使用的主要计量标准器具",
          block: instrumentText,
        });
      }

      const calibrationRows = [
        { key: "location", label: "地点", value: calibrationInfo.location, optional: true },
        { key: "temperature", label: "温度", value: calibrationInfo.temperature, optional: true },
        { key: "humidity", label: "湿度", value: calibrationInfo.humidity, optional: true },
        { key: "calibration_other", label: "其它", value: calibrationInfo.other, optional: true },
        { key: "receive_date", label: "收样日期", value: calibrationInfo.receiveDate, optional: true },
        { key: "calibration_date", label: "校准日期", value: calibrationInfo.calibrationDate, optional: true },
      ].filter((row) => !!normalizeOptionalBlank(row.value));
      if (calibrationRows.length) {
        sections.push({
          title: "其它校准信息",
          rows: calibrationRows,
        });
      }

      const generalCheckFull = extractGeneralCheckFullBlock(raw, normalizedSrc);
      if (generalCheckFull) {
        normalizedSrc.general_check_full = generalCheckFull || normalizedSrc.general_check_full || "";
        normalizedSrc.general_check = normalizedSrc.general_check || generalCheckFull;
        sections.push({
          title: "校准结果/说明（续页）",
          block: normalizedSrc.general_check_full || "",
          rawText: raw,
          tableStruct: item && item.generalCheckStruct ? item.generalCheckStruct : null,
          forceGeneralCheckTable: true,
        });
      }

      if (includeExtraRows) {
        const groupedKeys = new Set([
          "raw_record",
          "device_name",
          "device_model",
          "device_code",
          "manufacturer",
          "client_name",
          "unit_name",
          "address",
          "certificate_no",
          "basis_standard",
          "calibration_basis",
          "location",
          "temperature",
          "humidity",
          "calibration_other",
          "receive_date",
          "calibration_date",
          "release_date",
          "general_check_full",
          "general_check",
          "general_check_part1",
          "general_check_part2",
          "measurement_items",
        ]);
        const extraRows = Object.keys(normalizedSrc)
          .map((x) => String(x || "").trim())
          .filter((key) => !!key && !groupedKeys.has(key) && !SOURCE_HIDDEN_SYSTEM_KEYS.has(key))
          .sort((a, b) => a.localeCompare(b, "zh-CN"))
          .map((key) => ({
            key,
            label: getFieldLabel(key),
            value: String(normalizedSrc[key] || "").trim(),
          }))
          .filter((row) => !!row.value);
        if (extraRows.length) {
          sections.push({
            title: "其它识别信息",
            rows: extraRows,
          });
        }
      }
      return sections;
    }

    function renderFocusSectionsHtml(sections, problemKeys = new Set(), options = {}) {
      if (!Array.isArray(sections) || !sections.length) return "";
      const collapsible = !!options.collapsible;
      const collapseState = (options && options.collapseState && typeof options.collapseState === "object")
        ? options.collapseState
        : null;
      const scope = String((options && options.scope) || "group");
      return sections.map((section, index) => {
        const groupTitle = String(section.title || "");
        const groupKey = `${scope}:${index}:${groupTitle}`;
        const collapsed = !!(collapsible && collapseState && collapseState[groupKey]);
        const rows = Array.isArray(section.rows) ? section.rows : [];
        const rowHtml = rows.map((row) => {
          const value = String(row.value || "").trim();
          const isMissing = !value;
          const isProblem = (!row.optional && isMissing) || (row.key && problemKeys.has(row.key));
          let display = '<span class="source-recog-empty">（空）</span>';
          const isDateLikeKey = ["receive_date", "calibration_date", "release_date"].includes(String(row.key || ""));
          if (isDateLikeKey) {
            const parts = parseDateParts(value);
            if (parts) {
              display = `<span class="calib-date-grid"><span class="calib-date-part">${escapeHtml(parts.year)}</span><span class="calib-date-unit">年</span><span class="calib-date-part">${escapeHtml(parts.month)}</span><span class="calib-date-unit">月</span><span class="calib-date-part">${escapeHtml(parts.day)}</span><span class="calib-date-unit">日</span></span>`;
            } else if (value) {
              display = escapeHtml(value);
            }
          } else if (value) {
            display = escapeHtml(value);
          }
          return `<div class="source-recog-item ${isProblem ? "is-problem" : ""}"><span class="source-recog-key">${escapeHtml(row.label || row.key || "")}</span><span class="source-recog-val ${isProblem ? "is-problem" : ""}">${display}</span></div>`;
        }).join("");
        const buildCalibInfoLayout = () => {
          const rowByKey = new Map(rows.map((r) => [String(r.key || ""), r]));
          const cell = (key, label) => {
            const row = rowByKey.get(key) || { key, label, value: "" };
            const value = String(row.value || "").trim();
            const isMissing = !value;
            const isProblem = (!row.optional && isMissing) || (row.key && problemKeys.has(row.key));
            const display = value ? escapeHtml(value) : '<span class="source-recog-empty">（空）</span>';
            return `<div class="source-recog-item ${isProblem ? "is-problem" : ""}"><span class="source-recog-key">${escapeHtml(label)}</span><span class="source-recog-val ${isProblem ? "is-problem" : ""}">${display}</span></div>`;
          };
          const dateCell = (key, label) => {
            const row = rowByKey.get(key) || { key, label, value: "" };
            const value = String(row.value || "").trim();
            const isMissing = !value;
            const isProblem = (!row.optional && isMissing) || (row.key && problemKeys.has(row.key));
            const parts = parseDateParts(value);
            let display = '<span class="source-recog-empty">（空）</span>';
            if (parts) {
              display = `<span class="calib-date-grid"><span class="calib-date-part">${escapeHtml(parts.year)}</span><span class="calib-date-unit">年</span><span class="calib-date-part">${escapeHtml(parts.month)}</span><span class="calib-date-unit">月</span><span class="calib-date-part">${escapeHtml(parts.day)}</span><span class="calib-date-unit">日</span></span>`;
            } else if (value) {
              display = escapeHtml(value);
            }
            return `<div class="source-recog-item ${isProblem ? "is-problem" : ""}"><span class="source-recog-key">${escapeHtml(label)}</span><span class="source-recog-val ${isProblem ? "is-problem" : ""}">${display}</span></div>`;
          };
          return `
            <div class="calib-info-layout">
              <div class="calib-info-row one">
                ${cell("location", "地点")}
              </div>
              <div class="calib-info-row three">
                ${cell("temperature", "温度")}
                ${cell("humidity", "湿度")}
                ${cell("calibration_other", "其它")}
              </div>
              <div class="calib-info-row two">
                ${dateCell("receive_date", "收样日期")}
                ${dateCell("calibration_date", "校准日期")}
              </div>
            </div>
          `;
        };
        const renderedRowsHtml = groupTitle === "其它校准信息" ? buildCalibInfoLayout() : rowHtml;
        const blockText = cleanBlockText(section.block || "");
        const isGeneralCheckGroup = groupTitle === "校准结果/说明（续页）";
        const blockHtml = blockText
          ? (isGeneralCheckGroup
            ? renderGeneralCheckWysiwygBlock(blockText, {
              readOnly: true,
              rawText: String(section.rawText || ""),
              tableStruct: section && section.tableStruct ? section.tableStruct : null,
            })
            : renderStructuredBlockHtml(blockText, {
              forceGeneralCheckTable: !!section.forceGeneralCheckTable,
            }))
          : "";
        const toggleHtml = collapsible
          ? `<button type="button" class="source-recog-group-toggle" data-group-toggle="1" data-group-key="${escapeAttr(groupKey)}" aria-expanded="${collapsed ? "false" : "true"}" title="${collapsed ? "展开" : "收起"}">${collapsed ? "▶" : "▼"}</button>`
          : "";
        let contentHtml = "";
        if (!collapsed) {
          const hasRows = !!String(renderedRowsHtml || "").trim();
          const hasBlock = !!String(blockHtml || "").trim();
          if (hasRows) contentHtml += renderedRowsHtml;
          if (hasBlock) contentHtml += blockHtml;
          if (!hasRows && !hasBlock) contentHtml = '<div class="source-recog-block">（空）</div>';
        }
        return `<div class="source-recog-group ${collapsed ? "is-collapsed" : ""}"><div class="source-recog-group-title">${toggleHtml}<span class="source-recog-group-title-text">${escapeHtml(groupTitle)}</span></div>${contentHtml}</div>`;
      }).join("");
    }

    const {
      extractMeasurementItemsBlockText,
      normalizeMeasurementItemsText,
      shouldRebuildMeasurementItemsFromRaw,
      parseTableRowsFromBlock,
      renderStructuredTableHtml,
      buildFallbackMeasurementRows,
      getMeasurementHeaderIndexes,
      buildMeasurementCatalogMatchInfo,
      parseKeyValueRowsFromBlock,
      parseListLinesFromBlock,
    } = createMeasurementTableFeature({
      state,
      extractBlockByLine,
      normalizeCatalogToken,
      normalizeValidationToken,
      renderRichCellHtml,
    });

    const safeNormalizeMeasurementItemsText = typeof normalizeMeasurementItemsText === "function"
      ? normalizeMeasurementItemsText
      : ((item, fields) => {
        const block = typeof extractMeasurementItemsBlockText === "function"
          ? extractMeasurementItemsBlockText(item, fields)
          : String((fields && fields.measurement_items) || "");
        if (!block) return "";
        const tableRows = parseTableRowsFromBlock(String(block || ""));
        if (tableRows && tableRows.length >= 2) return tableRows.map((row) => row.join("\t")).join("\n");
        return String(block || "");
      });

    const safeShouldRebuildMeasurementItemsFromRaw = typeof shouldRebuildMeasurementItemsFromRaw === "function"
      ? shouldRebuildMeasurementItemsFromRaw
      : (() => true);

    const {
      parseGeneralCheckRowsFromBlock,
      buildGeneralCheckWysiwygData,
      renderGeneralCheckWysiwygBlock,
      renderStructuredBlockHtml,
      extractGeneralCheckBlockFromItem,
      extractGeneralCheckFullBlock,
      maybeCopyGeneralCheckForBlankTemplate,
    } = createGeneralCheckFeature({
      createEmptyFields,
      cleanBlockText,
      renderRichCellHtml,
      escapeHtml,
      hasDocxImageToken,
      collectDocxImageTokens,
      parseTableRowsFromBlock,
      renderStructuredTableHtml,
      parseKeyValueRowsFromBlock,
      parseListLinesFromBlock,
      extractAllBlocksByLine,
      extractBlockByLine,
      enrichGeneralCheckWithDocxImages,
    });

    function renderSourceFieldList(item) {
      const el = $("sourceFieldList");
      if (!el) return;
      if (!item) {
        el.innerHTML = '<div class="placeholder">识别字段未加载</div>';
        return;
      }
      const selectedNormalItems = getSelectedNormalItems();
      const isMultiMode = selectedNormalItems.length > 1;
      const mergedSections = () => {
        const allSections = selectedNormalItems.map((selectedItem) => {
          const src = (selectedItem.recognizedFields && typeof selectedItem.recognizedFields === "object")
            ? selectedItem.recognizedFields
            : (selectedItem.fields || {});
          const problemKeys = getProblemFieldKeys(selectedItem);
          return buildFocusSections(selectedItem, src, problemKeys, false);
        });
        const base = Array.isArray(allSections[0]) ? allSections[0] : [];
        return base.map((section, sectionIndex) => {
          const rows = Array.isArray(section.rows) ? section.rows.map((row, rowIndex) => {
            const values = allSections.map((sections) => String((((sections[sectionIndex] || {}).rows || [])[rowIndex] || {}).value || ""));
            const same = values.every((v) => v === values[0]);
            return { ...row, value: same ? values[0] : MULTI_EDIT_MIXED_PLACEHOLDER };
          }) : [];
          const sectionBlock = String(section.block || "");
          let block = sectionBlock;
          if (sectionBlock.trim()) {
            const blocks = allSections.map((sections) => String((sections[sectionIndex] && sections[sectionIndex].block) || ""));
            const sameBlock = blocks.every((v) => v === blocks[0]);
            block = sameBlock ? blocks[0] : MULTI_EDIT_MIXED_PLACEHOLDER;
          }
          return { ...section, rows, block };
        });
      };
      const src = (item.recognizedFields && typeof item.recognizedFields === "object")
        ? item.recognizedFields
        : (item.fields || {});
      const problemKeys = isMultiMode ? new Set() : getProblemFieldKeys(item);
      const sections = isMultiMode ? mergedSections() : buildFocusSections(item, src, problemKeys, false);
      if (!sections.length) {
        el.innerHTML = '<div class="placeholder">识别字段为空</div>';
        return;
      }
      el.innerHTML = renderFocusSectionsHtml(sections, problemKeys, {
        collapsible: true,
        collapseState: state.sourceFieldGroupCollapsed,
        scope: isMultiMode ? `source:multi:${selectedNormalItems.length}` : `source:${item.id || item.fileName || ""}`,
      });
    }

    function renderTargetFieldForm(item) {
      if (!item) {
        $("targetFieldForm").innerHTML = '<div class="placeholder">字段表单未加载</div>';
        return;
      }
      const selectedNormalItems = getSelectedNormalItems();
      const isMultiMode = selectedNormalItems.length > 1;
      const multiItems = isMultiMode ? selectedNormalItems : [item];
      if (!item.fields) item.fields = createEmptyFields();
      const f = item.fields || {};
      if (!isMultiMode) {
        const rawForDate = String(f.raw_record || item.rawText || "");
        const dateInfo = extractCalibrationInfoFields(rawForDate, f);
        if (dateInfo.receiveDate && (!isCompleteDateText(f.receive_date) || !String(f.receive_date || "").trim())) {
          f.receive_date = dateInfo.receiveDate;
        }
        if (dateInfo.calibrationDate && (!isCompleteDateText(f.calibration_date) || !String(f.calibration_date || "").trim())) {
          f.calibration_date = dateInfo.calibrationDate;
        }
        if (dateInfo.releaseDate && (!isCompleteDateText(f.release_date) || !String(f.release_date || "").trim())) {
          f.release_date = dateInfo.releaseDate;
        }
        if (String(rawForDate || "").trim() && !String(f.general_check_full || "").trim()) {
          const full = extractGeneralCheckFullBlock(rawForDate, f);
          if (full) f.general_check_full = full;
        }
        if (!String(f.general_check || "").trim() && String(f.general_check_full || "").trim()) {
          f.general_check = String(f.general_check_full || "").trim();
        }
        if (!String(f.measurement_items || "").trim() || safeShouldRebuildMeasurementItemsFromRaw(f.measurement_items, item)) {
          const normalized = safeNormalizeMeasurementItemsText(item, f);
          if (normalized) f.measurement_items = normalized;
        }
      }
      const resolved = resolveTargetFormFields(item, f);
      const note = resolved && resolved.note ? resolved.note : "";
      const loading = !!(resolved && resolved.loading);
      const problemKeys = isMultiMode ? new Set() : getProblemFieldKeys(item);
      const rowInfo = isMultiMode
        ? `多选编辑（已选 ${multiItems.length} 条记录）`
        : (item.recordName || item.fileName || "未命名记录");
      const noteTextBase = isMultiMode ? "相同值直接显示，不同值显示“（多值）”；修改将应用到所有已选记录。" : "";
      const getFieldView = (fieldKey) => {
        if (isMultiMode) {
          const merged = getSharedFieldValue(multiItems, fieldKey);
          if (merged === null) return { value: "", mixed: true };
          return { value: String(merged || ""), mixed: false };
        }
        return { value: String(f[fieldKey] || ""), mixed: false };
      };
      const renderFieldControl = (field) => {
        const fieldView = getFieldView(field.key);
        const value = String(fieldView.value || "");
        const isMixed = !!fieldView.mixed;
        const isProblem = problemKeys.has(field.key);
        const isMultiDisabled = isMultiMode && MULTI_EDIT_DISABLED_FIELD_KEYS.has(field.key);
        if (isMultiDisabled) {
          return `
            <label class="source-form-item slot-field wide multi-edit-disabled-field">
              <span>${escapeHtml(field.label)}</span>
              <div class="source-recog-block multi-edit-disabled-note">多选模式下不可编辑</div>
            </label>
          `;
        }
        if (field.key === "basis_standard") {
          if (isMultiMode) {
            return `
              <label class="source-form-item slot-field wide ${isProblem ? "is-problem" : ""}">
                <span>${escapeHtml(field.label)}</span>
                <input type="text" class="${isProblem ? "is-problem" : ""}" data-field="${escapeAttr(field.key)}" value="${escapeAttr(value)}" placeholder="${isMixed ? MULTI_EDIT_MIXED_PLACEHOLDER : ""}" />
              </label>
            `;
          }
          const codeRegex = /([A-Za-z]{1,5}\s*\/\s*T\s*\d+(?:\.\d+)?-\d{4})/ig;
          const normalizeCode = (code) => String(code || "")
            .replace(/\s+/g, " ")
            .replace(/\s*\/\s*/g, "/")
            .replace(/\/\s*T\s*/ig, "/T ")
            .trim();
          const fromArray = Array.isArray(f.basis_standard_items) ? f.basis_standard_items : [];
          const source = fromArray.length ? fromArray.join("\n") : String(f.basis_standard || "");
          const items = [];
          const seen = new Set();
          let m;
          while ((m = codeRegex.exec(source)) !== null) {
            const code = normalizeCode(m[1] || "");
            if (!code || seen.has(code)) continue;
            seen.add(code);
            items.push(code);
          }
          if (!items.length && String(source || "").trim()) items.push(String(source).trim());
          const rows = (items.length ? items : [""]).map((itemValue, idx) => `
            <div class="basis-item-row">
              <span class="basis-item-no">${idx + 1}</span>
              <input type="text" data-field="basis_standard_item" data-index="${idx}" value="${escapeAttr(itemValue)}" />
              <button type="button" class="btn ghost" data-action="remove-basis-item" data-index="${idx}">删</button>
            </div>
          `).join("");
          return `
            <label class="source-form-item slot-field wide ${isProblem ? "is-problem" : ""}">
              <span>${escapeHtml(field.label)}</span>
              <div class="basis-items-wrap">
                ${rows}
                <button type="button" class="btn ghost" data-action="add-basis-item">+ 添加一条</button>
              </div>
            </label>
          `;
        }
        if (field.key === "measurement_items") {
          if (isMultiMode) {
            return `
              <label class="source-form-item slot-field wide multi-edit-disabled-field">
                <span>${escapeHtml(field.label)}</span>
                <div class="source-recog-block multi-edit-disabled-note">多选模式下不可编辑</div>
              </label>
            `;
          }
          let tableRows = parseTableRowsFromBlock(String(f.measurement_items || ""));
          if (!tableRows || tableRows.length < 2) {
            const normalized = safeNormalizeMeasurementItemsText(item, f);
            if (normalized) {
              f.measurement_items = normalized;
              tableRows = parseTableRowsFromBlock(normalized);
            }
          }
          if (!tableRows || tableRows.length < 2) {
            tableRows = buildFallbackMeasurementRows(String(f.measurement_items || ""));
            f.measurement_items = tableRows.map((row) => row.join("\t")).join("\n");
          }
          const [header, ...body] = tableRows;
          const matchInfo = buildMeasurementCatalogMatchInfo(tableRows);
          const hasCatalog = !!(state.instrumentCatalogRows && state.instrumentCatalogRows.length);
          const headHtml = `
            <tr>
              <th style="width:40px;">#</th>
              ${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}
            </tr>
          `;
          const bodyHtml = body.map((row, rowIdx) => `
            <tr class="${matchInfo[rowIdx] && matchInfo[rowIdx].mismatch ? "measurement-row-mismatch" : ""}">
              <td class="row-no">${rowIdx + 1}${matchInfo[rowIdx] && matchInfo[rowIdx].mismatch ? `<span class="measurement-row-mark" title="${escapeAttr(matchInfo[rowIdx].reason || "")}">异常</span>` : ""}</td>
              ${row.map((cell, colIdx) => {
                const colAttrs = [];
                colAttrs.push(`data-field="measurement_item_cell"`);
                colAttrs.push(`data-row="${rowIdx}"`);
                colAttrs.push(`data-col="${colIdx}"`);
                if (colIdx === getMeasurementHeaderIndexes(header).nameIdx) {
                  colAttrs.push(`data-role="measurement-item-name"`);
                  colAttrs.push(`list="measurementCatalogNameOptions"`);
                }
                return `<td><input type="text" ${colAttrs.join(" ")} value="${escapeAttr(cell)}" /></td>`;
              }).join("")}
            </tr>
          `).join("");
          return `
            <label class="source-form-item slot-field wide ${isProblem ? "is-problem" : ""}">
              <span>${escapeHtml(field.label)}</span>
              <div class="measurement-toolbar">
                <button type="button" class="btn ghost" data-action="match-measurement-items" ${hasCatalog ? "" : "disabled"}>一键目录配对</button>
                <span class="measurement-toolbar-hint">已识别信息已自动带入；红色表示与目录不匹配</span>
              </div>
              <div class="measurement-table-wrap">
                <table class="measurement-table">
                  <thead>${headHtml}</thead>
                  <tbody>${bodyHtml}</tbody>
                </table>
              </div>
            </label>
          `;
        }
        if (field.key === "general_check_full") {
          if (isMultiMode) {
            return `
              <label class="source-form-item slot-field wide multi-edit-disabled-field">
                <span>${escapeHtml(field.label)}</span>
                <div class="source-recog-block multi-edit-disabled-note">多选模式下不可编辑</div>
              </label>
            `;
          }
          const rawForDate = String(f.raw_record || item.rawText || "");
          return `
            <label class="source-form-item slot-field wide ${isProblem ? "is-problem" : ""}">
              ${renderGeneralCheckWysiwygBlock(String(f.general_check_full || ""), {
                readOnly: false,
                rawText: rawForDate,
                tableStruct: item && item.generalCheckStruct ? item.generalCheckStruct : null,
              })}
            </label>
          `;
        }
        if (field.multiline) {
          const rows = Number(field.rows || 3);
          return `
            <label class="source-form-item slot-field wide ${isProblem ? "is-problem" : ""}">
              <span>${escapeHtml(field.label)}</span>
              <textarea class="${isProblem ? "is-problem" : ""}" data-field="${escapeAttr(field.key)}" rows="${rows}" placeholder="${isMixed ? MULTI_EDIT_MIXED_PLACEHOLDER : ""}">${escapeHtml(value)}</textarea>
            </label>
          `;
        }
        return `
          <label class="source-form-item slot-field ${isProblem ? "is-problem" : ""}">
            <span>${escapeHtml(field.label)}</span>
            <input type="text" class="${isProblem ? "is-problem" : ""}" data-field="${escapeAttr(field.key)}" value="${escapeAttr(value)}" placeholder="${isMixed ? MULTI_EDIT_MIXED_PLACEHOLDER : ""}" />
          </label>
        `;
      };

      const targetGroupScope = `target:${item.id || item.fileName || ""}`;
      const groupedHtml = TARGET_EDIT_GROUPS.map((group, index) => {
        const fieldsInGroup = Array.isArray(group.fields) ? group.fields : [];
        const controlsHtml = fieldsInGroup.map((field) => renderFieldControl(field)).join("");
        if (!controlsHtml) return "";
        const groupTitle = String(group.title || "");
        const groupKey = `${targetGroupScope}:${index}:${groupTitle}`;
        const collapsed = !!state.targetFieldGroupCollapsed[groupKey];
        const toggleHtml = `<button type="button" class="source-recog-group-toggle" data-group-toggle="1" data-group-key="${escapeAttr(groupKey)}" aria-expanded="${collapsed ? "false" : "true"}" title="${collapsed ? "展开" : "收起"}">${collapsed ? "▶" : "▼"}</button>`;
        return `
          <div class="source-recog-group ${collapsed ? "is-collapsed" : ""}">
            <div class="source-recog-group-title">
              ${toggleHtml}
              <span class="source-recog-group-title-text">${escapeHtml(groupTitle)}</span>
            </div>
            ${collapsed ? "" : `<div class="source-form-grid">${controlsHtml}</div>`}
          </div>
        `;
      }).join("");

      const noteParts = [];
      if (noteTextBase) noteParts.push(noteTextBase);
      if (loading) noteParts.push("模板字段加载中...");
      if (note) noteParts.push(note);
      const noteText = noteParts.join(" ");
      $("targetFieldForm").innerHTML = `
        <div class="source-form">
          <div class="source-form-head">
            <span>${escapeHtml(rowInfo)}</span>
            <span>${escapeHtml(noteText)}</span>
          </div>
          ${groupedHtml}
        </div>
      `;
    }

    function applyTargetFieldProblemStyles(item) {
      const root = $("targetFieldForm");
      if (!root || !item || !item.fields) return;
      if (isTargetMultiEditMode()) return;
      const resolved = resolveTargetFormFields(item, item.fields || {});
      const formFields = (resolved && Array.isArray(resolved.fields)) ? resolved.fields : [];
      const problemKeys = getProblemFieldKeys(item, formFields);
      const controls = root.querySelectorAll("[data-field]");
      controls.forEach((control) => {
        const key = String(control.getAttribute("data-field") || "").trim();
        if (!key) return;
        const isProblem = problemKeys.has(key);
        control.classList.toggle("is-problem", isProblem);
        const wrapper = control.closest(".source-form-item");
        if (wrapper) {
          wrapper.classList.add("slot-field");
          wrapper.classList.toggle("is-problem", isProblem);
        }
      });
    }

    async function renderSourcePreview(item) {
      if (!item) {
        setPreviewPlaceholder("sourcePreview", "证书模板预览未加载");
        return;
      }
      const selectedNormalItems = getSelectedNormalItems();
      if (selectedNormalItems.length > 1) {
        setPreviewPlaceholder("sourcePreview", `证书模板预览：已选 ${selectedNormalItems.length} 条记录`);
        return;
      }
      try {
        revokeBlobUrl("source");
        const ext = extFromName(item.fileName);
        if (item.isRecordRow) await ensureSourceFileId(item);
        if (ext === ".xlsx") {
          await ensureSourceFileId(item);
          const fileKey = String(item.fileId || item.fileName || "");
          const preferSheet = String(item.sheetName || state.excelPreviewSheetByFileId[fileKey] || "").trim();
          const preview = await runExcelPreview(item.fileId, preferSheet);
          const sheetNames = Array.isArray(preview.sheet_names) ? preview.sheet_names.map((x) => String(x || "").trim()).filter(Boolean) : [];
          const currentSheetName = String(preview.sheet_name || "").trim();
          if (fileKey && currentSheetName) state.excelPreviewSheetByFileId[fileKey] = currentSheetName;
          const title = String(preview.title || "").trim();
          const headers = Array.isArray(preview.headers) ? preview.headers : [];
          const rows = Array.isArray(preview.rows) ? preview.rows : [];
          const rowNumbers = Array.isArray(preview.row_numbers) ? preview.row_numbers.map((x) => Number(x || 0) || 0) : [];
          if (!headers.length) {
            setPreviewPlaceholder("sourcePreview", "Excel 无可预览内容");
            return;
          }
          const targetRowNumber = Number(item.rowNumber || 0) || 0;
          const matchSheet = !item.sheetName || !currentSheetName || String(item.sheetName) === currentSheetName;
          const rowIsTarget = (rowNo) => !!(targetRowNumber > 0 && matchSheet && rowNo === targetRowNumber);
          const thead = `<tr><th>行号</th>${headers.map((h) => `<th>${escapeHtml(String(h || ""))}</th>`).join("")}</tr>`;
          const tbody = rows.map((r, idx) => {
            const rowNo = rowNumbers[idx] || 0;
            const located = rowIsTarget(rowNo);
            return `<tr data-row-number="${rowNo}" class="${located ? "located" : ""}"><td>${rowNo > 0 ? rowNo : "-"}</td>${r.map((c) => `<td>${escapeHtml(toDateOnlyDisplay(c))}</td>`).join("")}</tr>`;
          }).join("");
          const headTitle = escapeHtml(title || currentSheetName || "Excel预览");
          const sheetSelectHtml = sheetNames.length > 1
            ? `<label>Sheet：<select id="excelPreviewSheetSelect">${sheetNames.map((name) => `<option value="${escapeAttr(name)}" ${name === currentSheetName ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>`
            : "";
          const tailText = preview.truncated
            ? `仅预览前 ${rows.length} 行，实际共 ${preview.total_rows} 行`
            : "";
          const locateMiss = targetRowNumber > 0 && !rows.some((_, idx) => rowIsTarget(rowNumbers[idx] || 0))
            ? `，当前记录行 ${targetRowNumber} 未在预览范围内`
            : "";
          const tail = (tailText || locateMiss)
            ? `<div class="placeholder" style="padding:6px;">${escapeHtml(`${tailText}${locateMiss}`.replace(/^，/, ""))}</div>`
            : "";
          $("sourcePreview").innerHTML = `<div class="excel-preview-wrap"><div class="excel-preview-head"><span>${headTitle}</span><span class="excel-meta">${sheetSelectHtml || ""}</span></div><table class="excel-preview-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>${tail}</div>`;
          const locatedRow = $("sourcePreview").querySelector("tr.located");
          if (locatedRow && typeof locatedRow.scrollIntoView === "function") {
            locatedRow.scrollIntoView({ block: "center", behavior: "smooth" });
          }
          return;
        }
        const sourceBlob = item.fileId ? await fetchBlob(`/api/upload/${item.fileId}/download`) : item.file;
        if (ext === ".docx") {
          await renderDocx("sourcePreview", await sourceBlob.arrayBuffer());
        } else if ([".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff", ".heic", ".heif", ".pic"].includes(ext)) {
          const url = URL.createObjectURL(sourceBlob);
          state.blobUrls.source = url;
          $("sourcePreview").innerHTML = `<img alt="source" src="${url}" />`;
        } else if (ext === ".pdf") {
          const url = URL.createObjectURL(sourceBlob);
          state.blobUrls.source = url;
          $("sourcePreview").innerHTML = `<iframe src="${url}"></iframe>`;
        } else {
          setPreviewPlaceholder("sourcePreview", "该类型不支持证书模板预览");
        }
      } catch (error) {
        setPreviewPlaceholder("sourcePreview", `证书模板预览失败：${error.message || "unknown"}`);
      }
    }

    async function renderTargetPreview(item) {
      if (!item) {
        setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
        return;
      }
      const generateMode = getGenerateMode();
      const isModifyCertificate = generateMode === "source_file";
      const selectedNormalItems = getSelectedNormalItems();
      if (selectedNormalItems.length > 1) {
        setPreviewPlaceholder("targetPreview", `${isModifyCertificate ? "证书预览" : "原始记录预览"}：已选 ${selectedNormalItems.length} 条记录`);
        return;
      }
      try {
        if (isModifyCertificate) {
          revokeBlobUrl("target");
          const sourceBlob = item.fileId ? await fetchBlob(`/api/upload/${item.fileId}/download`) : item.file;
          const sourceExt = extFromName(item.fileName || item.sourceFileName);
          if (sourceExt === ".docx") {
            await renderDocx("targetPreview", await sourceBlob.arrayBuffer());
          } else if ([".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff", ".heic", ".heif", ".pic"].includes(sourceExt)) {
            const url = URL.createObjectURL(sourceBlob);
            state.blobUrls.target = url;
            $("targetPreview").innerHTML = `<img alt="target" src="${url}" />`;
          } else if (sourceExt === ".pdf") {
            const url = URL.createObjectURL(sourceBlob);
            state.blobUrls.target = url;
            $("targetPreview").innerHTML = `<iframe src="${url}"></iframe>`;
          } else {
            setPreviewPlaceholder("targetPreview", "该类型不支持证书预览");
          }
          return;
        }
        if (!item.reportDownloadUrl) {
          if (!item.templateName) {
            setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
            return;
          }
          revokeBlobUrl("target");
          const tplBlob = await fetchBlob(`/api/templates/download?template_name=${encodeURIComponent(item.templateName)}`);
          const tplExt = extFromName(item.templateName);
          if (tplExt === ".docx") {
            const docxReady = await ensureDocxLib();
            if (docxReady) {
              await renderDocx("targetPreview", await tplBlob.arrayBuffer());
            } else {
              const data = await runTemplateTextPreview(item.templateName);
              const text = String((data && data.text) || "").trim();
              const truncated = !!(data && data.truncated);
              const tail = truncated ? "\n\n[文本过长，已截断]" : "";
              $("targetPreview").innerHTML = `<div style="padding:10px;white-space:pre-wrap;line-height:1.5;font-size:12px;">${escapeHtml(text || "模板文本预览为空")}${escapeHtml(tail)}</div>`;
            }
          } else {
            const url = URL.createObjectURL(tplBlob);
            state.blobUrls.target = url;
            $("targetPreview").innerHTML = `<iframe src="${url}"></iframe>`;
          }
          return;
        }
        revokeBlobUrl("target");
        const blob = await fetchBlob(item.reportDownloadUrl);
        const ext = extFromName(item.reportFileName || item.templateName || item.fileName);
        if (ext === ".docx") {
          await renderDocx("targetPreview", await blob.arrayBuffer());
          applyTargetPreviewSlotHighlights(item);
        } else {
          const url = URL.createObjectURL(blob);
          state.blobUrls.target = url;
          $("targetPreview").innerHTML = `<iframe src="${url}"></iframe>`;
        }
      } catch (error) {
        setPreviewPlaceholder("targetPreview", `${isModifyCertificate ? "证书预览" : "原始记录预览"}失败：${error.message || "unknown"}`);
      }
    }

    function normalizePreviewText(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    function classifyPreviewSlotText(text) {
      const t = normalizePreviewText(text);
      if (!t) return "";
      if (/^(温度|湿度|器具名称|制造厂\/商|型号\/规格|器具编号|序号|检测\/校准依据|检测\/校准地点)[:：]?$/.test(t)) {
        return "";
      }

      if (/结果[:：]/.test(t)) {
        return /结果[:：]\s*[√☑■]/.test(t) ? "filled" : "missing";
      }
      if (/最大(?:起始)?距离/.test(t) && /mm/i.test(t)) {
        return /最大(?:起始)?距离(?:为)?\s*\d+(?:\.\d+)?\s*mm/i.test(t) ? "filled" : "missing";
      }
      if (/检测.*校准.*依据/.test(t)) {
        const basisTailMatch = t.match(/依据[:：]?\s*(.*)$/);
        const basisTail = normalizePreviewText((basisTailMatch && basisTailMatch[1]) || "");
        if (basisTail) return "filled";
        return /(☑|√|■)/.test(t) ? "filled" : "missing";
      }
      if (/检测.*校准.*地点/.test(t)) {
        const locationTailMatch = t.match(/地点[:：]?\s*(.*)$/);
        const locationTail = normalizePreviewText((locationTailMatch && locationTailMatch[1]) || "");
        if (locationTail) return "filled";
        return /(☑|√|■)/.test(t) ? "filled" : "missing";
      }
      const labelMatch = t.match(/(序号|器具名称|制造厂\/商|型号\/规格|器具编号|检测\/校准地点|温度|湿度)\s*[:：]\s*(.*)$/);
      if (labelMatch) {
        const tail = normalizePreviewText(labelMatch[2] || "");
        if (!tail) return "missing";
        if (/^(?:[-—_/\\.%℃:：]+)$/.test(tail)) return "missing";
        if (/^(?:℃|%RH|mm)$/i.test(tail)) return "missing";
        return "filled";
      }
      if (/序号/.test(t) && /[:：]/.test(t)) {
        return /[:：]\s*.+$/.test(t) ? "filled" : "missing";
      }
      if (/检测\/校准地点/.test(t)) {
        return /[:：]\s*.+$/.test(t) ? "filled" : "missing";
      }
      if (/温度/.test(t) || /湿度/.test(t)) {
        const hasTemp = /温度\s*\d+(?:\.\d+)?\s*℃/.test(t);
        const hasHumidity = /湿度\s*\d+(?:\.\d+)?\s*%RH/i.test(t);
        if (hasTemp || hasHumidity) return "filled";
        if (/^(温度|湿度)$/.test(t)) return "";
        if (/温度|湿度/.test(t)) return "missing";
      }
      return "";
    }

    function applyTargetPreviewSlotHighlights(item) {
      if (!item || !item.reportDownloadUrl) return;
      const root = $("targetPreview");
      if (!root) return;
      const docRoot = root.querySelector(".docx") || root;
      docRoot.querySelectorAll(".preview-slot-filled,.preview-slot-missing,.preview-slot-cell").forEach((el) => {
        el.classList.remove("preview-slot-filled", "preview-slot-missing", "preview-slot-cell");
      });
      const candidates = docRoot.querySelectorAll("p, td, th");
      candidates.forEach((el) => {
        if (el.closest(".preview-slot-filled, .preview-slot-missing")) return;
        const text = normalizePreviewText(el.textContent);
        if (!text || text.length > 160) return;
        const cls = classifyPreviewSlotText(text);
        if (cls === "filled") el.classList.add("preview-slot-filled");
        if (cls === "missing") el.classList.add("preview-slot-missing");
      });
      // For structured result tables, blank value cells have no text and need row-level inference.
      const tables = Array.from(docRoot.querySelectorAll("table"));
      tables.forEach((table) => {
        const rows = Array.from(table.querySelectorAll("tr"));
        if (!rows.length) return;
        const headerText = rows.slice(0, 3).map((row) => normalizePreviewText(row.textContent)).join(" ");
        const isTargetValueTable = /(倍率|标准值|实际值|不确定度)/.test(headerText);
        if (!isTargetValueTable) return;
        rows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll("th, td"));
          if (cells.length < 2) return;
          const valueCell = cells[cells.length - 1];
          if (!valueCell || valueCell.classList.contains("preview-slot-filled") || valueCell.classList.contains("preview-slot-missing")) return;
          const leftText = cells.slice(0, -1).map((cell) => normalizePreviewText(cell.textContent)).join(" ");
          if (!leftText) return;
          if (/^(?:倍率|标准值|实际值|单位|序号)$/i.test(normalizePreviewText(valueCell.textContent))) return;
          const valueText = normalizePreviewText(valueCell.textContent);
          if (!valueText) {
            valueCell.classList.add("preview-slot-missing");
            return;
          }
          if (!/^(?:倍率|标准值|实际值)$/i.test(valueText)) {
            valueCell.classList.add("preview-slot-filled");
          }
        });
      });
      // Remove nested double highlights; keep only the outermost block.
      docRoot.querySelectorAll(".preview-slot-filled .preview-slot-filled, .preview-slot-missing .preview-slot-missing, .preview-slot-filled .preview-slot-missing, .preview-slot-missing .preview-slot-filled").forEach((el) => {
        el.classList.remove("preview-slot-filled", "preview-slot-missing");
      });
    }

    async function renderPreviews() {
      const item = getActiveItem();
      if (!item) {
        setPreviewPlaceholder("sourcePreview", "证书模板预览未加载");
        $("sourceFieldList").innerHTML = '<div class="placeholder">识别字段未加载</div>';
        $("targetFieldForm").innerHTML = '<div class="placeholder">字段表单未加载</div>';
        setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
        return;
      }
      updateSourceDeviceNameText(item);
      renderSourceFieldList(item);
      renderTargetFieldForm(item);
      await renderSourcePreview(item);
      await renderTargetPreview(item);
    }

    const { bindEvents } = createBindEventsFeature({
      $,
      state,
      FILTER_BLANK_TOKEN,
      MULTI_EDIT_DISABLED_FIELD_KEYS,
      createEmptyFields,
      appendLog,
      applyIncompleteState,
      applyTargetFieldProblemStyles,
      buildCategoryMessage,
      buildGeneralCheckWysiwygData,
      clearPreprocessProgress,
      cleanBlockText,
      createQueueItem,
      ensureTemplateEditorSchema,
      exportAll,
      generateAllReady,
      generateItem,
      getActiveItem,
      getColumnFilterOptionEntries,
      getFilteredSortedQueue,
      getGenerateMode,
      getMeasurementHeaderIndexes,
      getSelectedNormalItems,
      inferCategory,
      inferDateTriplet,
      isCompleteDateText,
      isSupportedFile,
      isTargetMultiEditMode,
      isTypingTarget,
      maybeCopyGeneralCheckForBlankTemplate,
      navigateActiveItem,
      normalizeCatalogToken,
      parseInstrumentCatalog,
      parseTableRowsFromBlock,
      processAllPending,
      refreshActionButtons,
      refreshAllRecognition,
      refreshTargetFieldFormBySelection,
      renderPreviews,
      renderQueue,
      renderSourceFieldList,
      renderSourcePreview,
      renderTargetFieldForm,
      renderTargetPreview,
      renderTemplateSelect,
      resolveBlankTemplateName,
      runExcelBatch,
      setCatalogDetailVisible,
      setInstrumentCatalog,
      setLoading,
      setPreviewFullscreen,
      setPreviewPlaceholder,
      setRightViewMode,
      setSourceViewMode,
      setStatus,
      syncGenerateModeUiText,
      triggerDownload,
      updateSelectedCountText,
      updateSourceDeviceNameText,
      validateItemForGeneration,
      extFromName,
    });

    (async function init() {
      setLoading(true, "初始化...");
      try {
        await loadRuntimeConfig();
        await loadTemplates();
        try {
          bindEvents();
        } catch (bindError) {
          appendLog(`事件绑定异常：${bindError.message || "unknown"}`);
        }
        await autoLoadInstrumentCatalog();
        renderQueue();
        setPreviewPlaceholder("sourcePreview", "证书模板预览未加载");
        $("sourceFieldList").innerHTML = '<div class="placeholder">识别字段未加载</div>';
        setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
        setStatus("就绪");
      } catch (error) {
        setStatus(`初始化失败：${error.message || "unknown"}`);
      } finally {
        setLoading(false);
      }
    })();
