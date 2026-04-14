import { applyDateLinkageRules } from "../shared/date-linkage.js";
import { createTargetDateInputHandler } from "../shared/target-date-input-handler.js";
import { createPreviewZoomBindings } from "./preview-zoom.js";
import { createUploadDropBindings } from "./upload-drop.js";

export function createBindEventsFeature(deps = {}) {
  const {
    $, state,
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
    getSelectedNormalItems,
    inferCategory,
    isSupportedFile,
    isTargetMultiEditMode,
    isTypingTarget,
    maybeCopyGeneralCheckForBlankTemplate,
    navigateActiveItem,
    parseTableRowsFromBlock,
    processAllPending,
    refreshActionButtons,
    refreshActiveRecognition,
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
    setLoading,
    setPreviewFullscreen,
    setPreviewPlaceholder,
    setRightViewMode,
    setSourceViewMode,
    setStatus,
    updateTaskStatusApi,
    saveWorkspaceDraft,
    syncGenerateModeUiText,
    shiftDateText,
    triggerDownload,
    updateSelectedCountText,
    updateSourceDeviceNameText,
    validateItemForGeneration,
    extFromName,
  } = deps;
    const { handleTargetDateInput } = createTargetDateInputHandler({
      $,
      shiftDateText,
      applyDateLinkageRules,
    });
    const { bindPreviewZoomOverlayEvents } = createPreviewZoomBindings({ $ });
    const {
      addFilesToQueue,
      bindUploadEvents,
      bindQueueLayoutAndDropEvents,
    } = createUploadDropBindings({
      $,
      state,
      isSupportedFile,
      extFromName,
      createQueueItem,
      renderQueue,
      renderTemplateSelect,
      setStatus,
      appendLog,
      updateTaskStatusApi,
      processAllPending,
    });
    let blockDownloadUntil = 0;
    let downloadPointerArmed = false;

    function bindQueueTableEvents(queueListEl) {
      queueListEl.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const sortBtn = target.closest(".th-sort-btn");
        if (sortBtn instanceof HTMLElement) {
          const key = sortBtn.getAttribute("data-sort-key") || "";
          if (!key) return;
          if (state.listFilter.sortKey === key) {
            state.listFilter.sortDir = state.listFilter.sortDir === "desc" ? "asc" : "desc";
          } else {
            state.listFilter.sortKey = key;
            state.listFilter.sortDir = "asc";
          }
          $("sortKey").value = state.listFilter.sortKey;
          $("sortDir").value = state.listFilter.sortDir;
          renderQueue();
          return;
        }
        const filterTrigger = target.closest(".th-filter-trigger");
        if (filterTrigger instanceof HTMLElement) {
          const key = filterTrigger.getAttribute("data-filter-key") || "";
          if (!key) return;
          state.listFilter.activeFilterKey = state.listFilter.activeFilterKey === key ? "" : key;
          renderQueue();
          return;
        }
        const filterActBtn = target.closest(".th-filter-act");
        if (filterActBtn instanceof HTMLElement) {
          const key = filterActBtn.getAttribute("data-filter-key") || "";
          const act = filterActBtn.getAttribute("data-filter-act") || "";
          if (!key || !act) return;
          const options = getColumnFilterOptionEntries(key);
          const allTokens = options.map((x) => x.token);
          let next = [];
          if (act === "all") next = allTokens;
          if (act === "clear") next = [];
          if (act === "only_blank") next = allTokens.includes(FILTER_BLANK_TOKEN) ? [FILTER_BLANK_TOKEN] : [];
          if (act === "only_non_blank") next = allTokens.filter((x) => x !== FILTER_BLANK_TOKEN);
          const nextFilters = { ...(state.listFilter.columnFilters || {}) };
          if (next.length) nextFilters[key] = next;
          else delete nextFilters[key];
          state.listFilter.columnFilters = nextFilters;
          state.listFilter.activeFilterKey = key;
          renderQueue();
          return;
        }
        if (target.closest(".th-filter-menu") || target.closest(".th-filter-option")) return;
        if (target.closest(".row-check") || target.closest("#selectAllVisible")) return;
        const row = target.closest("tr[data-id]");
        if (!row) return;
        const id = row.getAttribute("data-id") || "";
        if (!id) return;
        if (state.multiSelectMode) {
          if (state.selectedIds.has(id)) state.selectedIds.delete(id);
          else state.selectedIds.add(id);
        } else {
          state.selectedIds.clear();
          state.selectedIds.add(id);
        }
        updateSelectedCountText();
        refreshTargetFieldFormBySelection();
        state.listFilter.activeFilterKey = "";
        state.activeId = id;
        blockDownloadUntil = Date.now() + 450;
        renderQueue();
        renderTemplateSelect();
        await renderPreviews();
      });

      queueListEl.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.matches(".th-filter-option")) {
          const key = target.getAttribute("data-filter-key") || "";
          const token = target.getAttribute("data-filter-token") || "";
          if (!key || !token) return;
          const current = Array.isArray((state.listFilter.columnFilters || {})[key])
            ? (state.listFilter.columnFilters || {})[key].map((x) => String(x || "")).filter(Boolean)
            : [];
          const nextSet = new Set(current);
          if (target.checked) nextSet.add(token);
          else nextSet.delete(token);
          const next = Array.from(nextSet);
          const nextFilters = { ...(state.listFilter.columnFilters || {}) };
          if (next.length) nextFilters[key] = next;
          else delete nextFilters[key];
          state.listFilter.columnFilters = nextFilters;
          state.listFilter.activeFilterKey = key;
          renderQueue();
          return;
        }
        if (target.matches(".row-check")) {
          const id = target.getAttribute("data-id") || "";
          if (!id) return;
          if (state.multiSelectMode) {
            if (target.checked) state.selectedIds.add(id);
            else state.selectedIds.delete(id);
          } else if (target.checked) {
            state.selectedIds.clear();
            state.selectedIds.add(id);
          } else {
            state.selectedIds.delete(id);
          }
          if (target.checked) {
            state.activeId = id;
          } else if (state.activeId === id) {
            const nextSelected = Array.from(state.selectedIds)[0] || "";
            state.activeId = nextSelected;
          }
          updateSelectedCountText();
          refreshActionButtons();
          refreshTargetFieldFormBySelection();
          renderSourceFieldList(getActiveItem());
          renderSourcePreview(getActiveItem());
          renderTargetPreview(getActiveItem());
          updateSourceDeviceNameText(getActiveItem());
          return;
        }
        if (target.matches("#selectAllVisible")) {
          const visibleItems = getFilteredSortedQueue();
          visibleItems.forEach((item) => {
            if (target.checked) state.selectedIds.add(item.id);
            else state.selectedIds.delete(item.id);
          });
          if (target.checked) {
            const firstVisible = visibleItems[0];
            if (firstVisible && firstVisible.id) state.activeId = firstVisible.id;
          } else if (state.activeId && !state.selectedIds.has(state.activeId)) {
            state.activeId = "";
          }
          renderQueue();
          refreshTargetFieldFormBySelection();
          renderSourceFieldList(getActiveItem());
          renderSourcePreview(getActiveItem());
          renderTargetPreview(getActiveItem());
          updateSourceDeviceNameText(getActiveItem());
        }
      });

      document.addEventListener("click", (event) => {
        if (!state.listFilter.activeFilterKey) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest(".th-filter-trigger") || target.closest(".th-filter-menu")) return;
        state.listFilter.activeFilterKey = "";
        renderQueue();
      });
    }

    function bindEvents() {
      const headerExitBtn = $("headerExitBtn");
      if (headerExitBtn) {
        headerExitBtn.addEventListener("click", async () => {
          if (typeof saveWorkspaceDraft === "function") await saveWorkspaceDraft();
          window.location.assign("/tasks");
        });
      }

      bindUploadEvents();

      const queueListEl = $("queueList");
      bindQueueTableEvents(queueListEl);
      bindQueueLayoutAndDropEvents(queueListEl);

      bindViewModeEvents();
      bindPreviewZoomOverlayEvents();

      const handleTargetFieldChange = (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (handleTargetDateInput(target, event.type)) {
          return;
        }
        const key = String(target.getAttribute("data-field") || "").trim();
        if (!key) return;
        const isInputControl = (target instanceof HTMLInputElement) || (target instanceof HTMLTextAreaElement) || (target instanceof HTMLSelectElement);
        const isEditableCell = !!(target.getAttribute("contenteditable") === "true");
        if (!isInputControl && !isEditableCell) return;
        const item = getActiveItem();
        if (!item) return;
        if (!item.fields) item.fields = createEmptyFields();
        const editTargets = isTargetMultiEditMode() ? getSelectedNormalItems() : [item];
        const isMultiMode = editTargets.length > 1;
        const invalidateCurrentModeReports = (targets) => {
          const mode = getGenerateMode();
          (Array.isArray(targets) ? targets : []).forEach((targetItem) => {
            if (!targetItem || typeof targetItem !== "object") return;
            const current = targetItem.modeReports && typeof targetItem.modeReports === "object"
              ? { ...targetItem.modeReports }
              : {};
            if (current[mode]) delete current[mode];
            targetItem.modeReports = current;
            if (String(targetItem.reportGenerateMode || "") === mode) {
              targetItem.reportId = "";
              targetItem.reportDownloadUrl = "";
              targetItem.reportFileName = "";
              targetItem.reportGenerateMode = "";
            }
          });
        };
        const readControlValue = () => {
          if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
            return String(target.value || "");
          }
          return String(target.textContent || "");
        };
        const rebuildMeasurementItemsFromCells = () => {
          const tableRows = parseTableRowsFromBlock(String(item.fields.measurement_items || ""));
          if (!tableRows || tableRows.length < 2) return false;
          const [header, ...body] = tableRows;
          const rebuilt = [header, ...body].map((row) => row.map((x) => String(x || "").trim()).join("\t")).join("\n");
          item.fields.measurement_items = rebuilt;
          return true;
        };
        if (key === "basis_standard_item") {
          if (isMultiMode) return;
          const normalizeLine = (line) => String(line || "")
            .replace(/\s+/g, " ")
            .trim();
          const idx = Number.parseInt(String(target.getAttribute("data-index") || "-1"), 10);
          const current = Array.isArray(item.fields.basis_standard_items) ? [...item.fields.basis_standard_items] : [];
          while (current.length <= idx) current.push("");
          current[idx] = normalizeLine(target.value || "");
          const next = current.map((x) => normalizeLine(x)).filter(Boolean);
          item.fields.basis_standard_items = next;
          item.fields.basis_standard = next.join("\n");
          invalidateCurrentModeReports([item]);
          renderTargetFieldForm(item);
          applyTargetFieldProblemStyles(item);
          renderQueue();
          setStatus("已更新：本次校准所依据的技术规范");
          return;
        }
        if (key === "measurement_item_cell") {
          if (isMultiMode) return;
          const rowIdx = Number.parseInt(String(target.getAttribute("data-row") || "-1"), 10);
          const colIdx = Number.parseInt(String(target.getAttribute("data-col") || "-1"), 10);
          const tableRows = parseTableRowsFromBlock(String(item.fields.measurement_items || ""));
          if (!tableRows || tableRows.length < 2) return;
          const header = tableRows[0];
          const body = tableRows.slice(1).map((row) => [...row]);
          if (rowIdx < 0 || rowIdx >= body.length) return;
          if (colIdx < 0 || colIdx >= body[rowIdx].length) return;
          body[rowIdx][colIdx] = String(target.value || "").trim();
          item.fields.measurement_items = [header, ...body].map((row) => row.join("\t")).join("\n");
          if (!(item.fields.measurement_item_count || "").trim()) {
            item.fields.measurement_item_count = String(body.length);
          }
          rebuildMeasurementItemsFromCells();
          invalidateCurrentModeReports([item]);
          renderTargetFieldForm(item);
          renderQueue();
          setStatus("已更新：本次校准所使用的主要计量标准器具");
          return;
        }
        if (key === "general_check_cell") {
          if (isMultiMode) return;
          const rowIdx = Number.parseInt(String(target.getAttribute("data-row") || "-1"), 10);
          const colIdx = Number.parseInt(String(target.getAttribute("data-col") || "-1"), 10);
          const nextCellValue = readControlValue();
          const isStructCell = String(target.getAttribute("data-struct-cell") || "") === "1";
          if (isStructCell && item && item.generalCheckStruct && Array.isArray(item.generalCheckStruct.cells)) {
            const cell = item.generalCheckStruct.cells.find((x) => Number(x && x.r) === rowIdx && Number(x && x.c) === colIdx);
            if (!cell) return;
            cell.text = String(nextCellValue || "");
            const structData = buildGeneralCheckWysiwygData("", {
              tableStruct: item.generalCheckStruct,
            });
            const header = Array.isArray(structData.header) ? structData.header : [];
            const rows = Array.isArray(structData.rows) ? structData.rows : [];
            item.fields.general_check_full = [header, ...rows]
              .map((row) => (Array.isArray(row) ? row : []).map((v) => String(v || "").trim()).join("\t"))
              .join("\n");
            item.fields.general_check = item.fields.general_check_full;
            invalidateCurrentModeReports([item]);
            renderQueue();
            setStatus("已更新：一般检查");
            return;
          }
          const data = buildGeneralCheckWysiwygData(String(item.fields.general_check_full || ""), {
            tableStruct: item && item.generalCheckStruct ? item.generalCheckStruct : null,
          });
          const header = Array.isArray(data.header) && data.header.length ? data.header.map((x) => String(x || "")) : ["序号/标记", "内容"];
          const width = header.length;
          const working = Array.isArray(data.rows) && data.rows.length
            ? data.rows.map((row) => {
              const next = Array.isArray(row) ? row.map((x) => String(x || "")) : [];
              while (next.length < width) next.push("");
              return next.slice(0, width);
            })
            : [Array(width).fill("")];
          if (rowIdx < 0 || rowIdx >= working.length) return;
          if (colIdx < 0 || colIdx >= working[rowIdx].length) return;
          working[rowIdx][colIdx] = String(nextCellValue || "");
          item.fields.general_check_full = [header, ...working]
            .map((row) => row.map((cell) => String(cell || "").trim()).join("\t"))
            .join("\n");
          item.fields.general_check = item.fields.general_check_full;
          invalidateCurrentModeReports([item]);
          renderQueue();
          setStatus("已更新：一般检查");
          return;
        }
        const value = readControlValue();
        if (isMultiMode && MULTI_EDIT_DISABLED_FIELD_KEYS.has(key)) return;
        const isDateKey = ["receive_date", "calibration_date", "release_date"].includes(key);
        const parseLooseDateParts = (dateText) => {
          const text = String(dateText || "").trim();
          if (!text) return { year: "", month: "", day: "" };
          const y = text.match(/(\d{1,4})\s*年/);
          const m = text.match(/(\d{1,2})\s*月/);
          const d = text.match(/(\d{1,2})\s*日/);
          return {
            year: y ? String(y[1] || "") : "",
            month: m ? String(m[1] || "") : "",
            day: d ? String(d[1] || "") : "",
          };
        };
        const applyDateSyncRule = (targetItem, changedKey, changedValue) => {
          if (!targetItem.fields) targetItem.fields = createEmptyFields();
          targetItem.fields[changedKey] = String(changedValue || "");
        };
        editTargets.forEach((targetItem) => {
          if (!targetItem.fields) targetItem.fields = createEmptyFields();
          if (isDateKey) applyDateSyncRule(targetItem, key, value);
          else targetItem.fields[key] = value;
          if (key === "general_check_full") {
            targetItem.fields.general_check = cleanBlockText(targetItem.fields.general_check_full || "");
          }
          if (key === "raw_record") targetItem.rawText = value;
          if (key === "raw_record") maybeCopyGeneralCheckForBlankTemplate(targetItem);
          if (key === "measurement_items" && !(targetItem.fields.measurement_item_count || "").trim()) {
            const count = String(value).split("\n").map((x) => x.trim()).filter(Boolean).length;
            targetItem.fields.measurement_item_count = count > 0 ? String(count) : "";
          }
          if (["device_name", "device_model", "device_code"].includes(key)) {
            targetItem.category = inferCategory(targetItem);
          }
          if (targetItem.templateName) {
            const validation = validateItemForGeneration(targetItem, "certificate_template");
            if (!validation.ok) applyIncompleteState(targetItem, validation);
            else if (targetItem.status === "incomplete") {
              targetItem.status = "ready";
              targetItem.message = buildCategoryMessage(targetItem, "字段已补全，可生成");
            }
          }
        });
        invalidateCurrentModeReports(editTargets);
        if (isDateKey && target instanceof HTMLElement && target.hasAttribute("data-date-exact")) {
          target.removeAttribute("data-date-exact");
        }
        if (isDateKey && isMultiMode) {
          if (event.type === "change") refreshTargetFieldFormBySelection();
        } else if (isDateKey && !isMultiMode) {
          const formRoot = $("targetFieldForm");
          const syncDateFieldDom = (fieldKey, fieldValue) => {
            if (!(formRoot instanceof HTMLElement)) return;
            const hidden = formRoot.querySelector(`input[type="hidden"][data-field="${fieldKey}"]`);
            if (hidden instanceof HTMLInputElement) hidden.value = String(fieldValue || "");
            const parts = parseLooseDateParts(fieldValue);
            const y = formRoot.querySelector(`input[data-date-field="${fieldKey}"][data-date-part="year"]`);
            const m = formRoot.querySelector(`input[data-date-field="${fieldKey}"][data-date-part="month"]`);
            const d = formRoot.querySelector(`input[data-date-field="${fieldKey}"][data-date-part="day"]`);
            if (y instanceof HTMLInputElement) y.value = parts.year;
            if (m instanceof HTMLInputElement) m.value = parts.month;
            if (d instanceof HTMLInputElement) d.value = parts.day;
          };
          const active = getActiveItem();
          if (active && active.fields) {
            syncDateFieldDom("receive_date", active.fields.receive_date);
            syncDateFieldDom("calibration_date", active.fields.calibration_date);
            syncDateFieldDom("release_date", active.fields.release_date);
          }
        }
        applyTargetFieldProblemStyles(item);
        renderQueue();
        if (event.type === "change") {
          const labelEl = target.closest(".source-form-item")?.querySelector("span");
          const labelText = String(labelEl && labelEl.textContent ? labelEl.textContent : "").trim();
          setStatus(`已更新：${labelText || key}`);
        }
      };
      $("targetFieldForm").addEventListener("input", handleTargetFieldChange);
      $("targetFieldForm").addEventListener("change", handleTargetFieldChange);
      $("targetFieldForm").addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const toggleBtn = target.closest("[data-group-toggle]");
        if (toggleBtn instanceof HTMLElement) {
          const groupKey = String(toggleBtn.getAttribute("data-group-key") || "").trim();
          if (!groupKey) return;
          const item = getActiveItem();
          if (!item) return;
          state.targetFieldGroupCollapsed[groupKey] = !state.targetFieldGroupCollapsed[groupKey];
          renderTargetFieldForm(item);
          applyTargetFieldProblemStyles(item);
          return;
        }
        const action = String(target.getAttribute("data-action") || "").trim();
        if (!action) return;
        const item = getActiveItem();
        if (!item) return;
        if (!item.fields) item.fields = createEmptyFields();
        if (action === "gc-bold" || action === "gc-italic") {
          const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          const cell = active && active.matches('[data-field="general_check_cell"][contenteditable="true"]')
            ? active
            : (active ? active.closest('[data-field="general_check_cell"][contenteditable="true"]') : null);
          if (!(cell instanceof HTMLElement)) return;
          try {
            document.execCommand(action === "gc-bold" ? "bold" : "italic");
          } catch (_) {
            return;
          }
          cell.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
        if (action === "gc-add-row" || action === "gc-del-row") {
          const data = buildGeneralCheckWysiwygData(String(item.fields.general_check_full || ""), {
            tableStruct: item && item.generalCheckStruct ? item.generalCheckStruct : null,
          });
          const header = Array.isArray(data.header) && data.header.length ? data.header.map((x) => String(x || "")) : ["序号/标记", "内容"];
          const width = header.length;
          const rows = Array.isArray(data.rows) && data.rows.length
            ? data.rows.map((row) => {
              const next = Array.isArray(row) ? row.map((x) => String(x || "")) : [];
              while (next.length < width) next.push("");
              return next.slice(0, width);
            })
            : [Array(width).fill("")];
          if (action === "gc-add-row") rows.push(Array(width).fill(""));
          if (action === "gc-del-row" && rows.length > 1) rows.pop();
          item.fields.general_check_full = [header, ...rows]
            .map((row) => row.map((cell) => String(cell || "").trim()).join("\t"))
            .join("\n");
          item.fields.general_check = item.fields.general_check_full;
          renderTargetFieldForm(item);
          renderQueue();
          setStatus("已更新：一般检查");
          return;
        }
        const normalizeLine = (line) => String(line || "")
          .replace(/\s+/g, " ")
          .trim();
        const current = Array.isArray(item.fields.basis_standard_items) ? [...item.fields.basis_standard_items] : [];
        if (action === "add-basis-item") {
          current.push("");
          item.fields.basis_standard_items = current;
          item.fields.basis_standard = current.map((x) => normalizeLine(x)).filter(Boolean).join("\n");
          renderTargetFieldForm(item);
          setStatus("已更新：本次校准所依据的技术规范");
          return;
        }
        if (action === "remove-basis-item") {
          const idx = Number.parseInt(String(target.getAttribute("data-index") || "-1"), 10);
          if (idx < 0 || idx >= current.length) return;
          current.splice(idx, 1);
          const next = current.map((x) => normalizeLine(x)).filter(Boolean);
          item.fields.basis_standard_items = next;
          item.fields.basis_standard = next.join("\n");
          renderTargetFieldForm(item);
          setStatus("已更新：本次校准所依据的技术规范");
        }
      });

      bindTemplateAndNavigationEvents();

      bindBatchAndFilterEvents();
    }

    function bindTemplateAndNavigationEvents() {
      let templateApplyTimer = null;
      const applyTemplateSelection = async ({ commit = false } = {}) => {
        const item = getActiveItem();
        if (!item) return;
        const raw = ($("templateSearch").value || "").trim();
        if (!raw) {
          if (!commit) return;
          $("templateName").value = "";
          item.templateName = "";
          item.templateUserSelected = false;
          item.reportId = "";
          item.reportDownloadUrl = "";
          item.reportFileName = "";
          item.reportGenerateMode = "";
          item.modeReports = {};
          item.status = "ready";
          item.message = "未选择模板";
          renderQueue();
          renderTargetFieldForm(item);
          await renderTargetPreview(item);
          return;
        }
        const selected = state.templates.includes(raw) ? raw : "";
        if (!selected) return;
        if (item.templateName === selected) return;
        $("templateName").value = selected;
        item.templateName = selected;
        item.templateUserSelected = true;
        ensureTemplateEditorSchema(item.templateName, item.id || "");
        maybeCopyGeneralCheckForBlankTemplate(item);
        item.reportId = "";
        item.reportDownloadUrl = "";
        item.reportFileName = "";
        item.reportGenerateMode = "";
        item.modeReports = {};
        const validation = validateItemForGeneration(item, "certificate_template");
        if (!validation.ok) applyIncompleteState(item, validation);
        else {
          item.status = "ready";
          item.message = item.templateName ? "模板已手动选择" : "未选择模板";
        }
        renderQueue();
        renderTargetFieldForm(item);
        await renderTargetPreview(item);
      };
      $("templateSearch").addEventListener("change", () => { applyTemplateSelection({ commit: true }); });
      $("templateSearch").addEventListener("blur", () => { applyTemplateSelection({ commit: true }); });
      $("templateSearch").addEventListener("input", () => {
        if (templateApplyTimer) clearTimeout(templateApplyTimer);
        templateApplyTimer = setTimeout(() => {
          applyTemplateSelection();
          const item = getActiveItem();
          const blankBtn = $("useBlankTemplateBtn");
          if (blankBtn && item) {
            const raw = ($("templateSearch").value || "").trim();
            const hasExact = !!state.templates.includes(raw);
            const blankName = resolveBlankTemplateName();
            blankBtn.style.display = !hasExact && !!blankName ? "inline-block" : "none";
          }
        }, 360);
      });

      $("useBlankTemplateBtn").addEventListener("click", async () => {
        const item = getActiveItem();
        if (!item || state.busy) return;
        const blankName = resolveBlankTemplateName();
        if (!blankName) return;
        $("templateName").value = blankName;
        $("templateSearch").value = blankName;
        item.templateName = blankName;
        item.templateUserSelected = true;
        maybeCopyGeneralCheckForBlankTemplate(item);
        item.reportId = "";
        item.reportDownloadUrl = "";
        item.reportFileName = "";
        item.reportGenerateMode = "";
        item.modeReports = {};
        const validation = validateItemForGeneration(item, "certificate_template");
        if (!validation.ok) applyIncompleteState(item, validation);
        else {
          item.status = "ready";
          item.message = "已选择空白模板";
        }
        renderQueue();
        renderTemplateSelect();
        renderTargetFieldForm(item);
        await renderTargetPreview(item);
      });

      $("togglePreviewFullscreenBtn").addEventListener("click", () => {
        if (!getActiveItem()) return;
        setPreviewFullscreen(!state.previewFullscreen);
      });
      $("prevItemBtn").addEventListener("click", async () => {
        if (state.busy) return;
        await navigateActiveItem(-1);
      });
      $("nextItemBtn").addEventListener("click", async () => {
        if (state.busy) return;
        await navigateActiveItem(1);
      });
      $("detailPanelHead").addEventListener("dblclick", () => {
        if (!getActiveItem()) return;
        setPreviewFullscreen(!state.previewFullscreen);
      });

      document.addEventListener("keydown", (event) => {
        if (isTypingTarget(event.target)) return;
        if (event.key === "Escape" && state.previewFullscreen) {
          setPreviewFullscreen(false);
          return;
        }
        if (event.key === "ArrowUp" || event.key === "k" || event.key === "K") {
          event.preventDefault();
          navigateActiveItem(-1);
          return;
        }
        if (event.key === "ArrowDown" || event.key === "j" || event.key === "J") {
          event.preventDefault();
          navigateActiveItem(1);
        }
      });
    }

    function bindViewModeEvents() {
      const sourceViewPreviewBtn = $("sourceViewPreviewBtn");
      if (sourceViewPreviewBtn) {
        sourceViewPreviewBtn.addEventListener("click", () => {
          if (!getActiveItem()) return;
          setSourceViewMode("preview");
        });
      }

      const sourceViewFormBtn = $("sourceViewFormBtn");
      if (sourceViewFormBtn) {
        sourceViewFormBtn.addEventListener("click", () => {
          if (!getActiveItem()) return;
          setSourceViewMode("fields");
        });
      }

      const sourceFieldListEl = $("sourceFieldList");
      if (sourceFieldListEl) {
        sourceFieldListEl.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const toggleBtn = target.closest("[data-group-toggle]");
          if (!(toggleBtn instanceof HTMLElement)) return;
          const groupKey = String(toggleBtn.getAttribute("data-group-key") || "").trim();
          if (!groupKey) return;
          state.sourceFieldGroupCollapsed[groupKey] = !state.sourceFieldGroupCollapsed[groupKey];
          renderSourceFieldList(getActiveItem());
        });
      }

      const rightTabFieldBtn = $("rightTabFieldBtn");
      if (rightTabFieldBtn) {
        rightTabFieldBtn.addEventListener("click", () => {
          if (!getActiveItem()) return;
          setRightViewMode("field");
        });
      }

      const rightTabPreviewBtn = $("rightTabPreviewBtn");
      if (rightTabPreviewBtn) {
        rightTabPreviewBtn.addEventListener("click", () => {
          if (!getActiveItem()) return;
          setRightViewMode("preview");
        });
      }

      $("sourcePreview").addEventListener("change", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches("#excelPreviewSheetSelect")) return;
        const item = getActiveItem();
        if (!item) return;
        const sheetName = String((target instanceof HTMLSelectElement ? target.value : "") || "").trim();
        const fileKey = String(item.fileId || item.fileName || "");
        if (fileKey) state.excelPreviewSheetByFileId[fileKey] = sheetName;
        await renderSourcePreview(item);
      });
    }

    function bindBatchAndFilterEvents() {
      $("runGenerateAllBtn").addEventListener("click", async () => {
        if (state.busy) {
          const reason = "当前仍在处理中，请稍后再试";
          setStatus(reason);
          appendLog(`批量生成被阻塞：${reason}`);
          return;
        }
        const selectedItems = getSelectedNormalItems();
        if (!selectedItems.length) {
          const reason = "请先勾选要批量生成的记录";
          setStatus(reason);
          appendLog(reason);
          return;
        }
        appendLog(`开始批量生成（选中 ${selectedItems.length} 条）`);
        const selected = selectedItems.map((x) => x.id);
        try {
          await generateAllReady(selected);
          await renderPreviews();
        } catch (error) {
          const reason = error && error.message ? error.message : "批量生成发生未知错误";
          setStatus(`批量生成失败：${reason}`);
          appendLog(`批量生成失败：${reason}`);
        }
      });

      $("refreshAllRecognitionBtn").addEventListener("click", async () => {
        if (state.busy) return;
        await refreshActiveRecognition();
      });

      $("runBatchBtn").addEventListener("click", async () => {
        if (state.busy) return;
        const selected = getSelectedNormalItems().map((x) => x.id);
        await exportAll(selected);
      });

      const clearQueueBtn = $("clearQueueBtn");
      if (clearQueueBtn) {
        clearQueueBtn.addEventListener("click", () => {
          if (state.busy) return;
          state.queue = [];
          state.selectedIds.clear();
          state.activeId = "";
          setPreviewFullscreen(false);
          clearPreprocessProgress();
          state.excelPreviewSheetByFileId = {};
          renderQueue();
          renderTemplateSelect();
          setPreviewPlaceholder("sourcePreview", "来源预览未加载");
          $("sourceFieldList").innerHTML = '<div class="placeholder">识别字段未加载</div>';
          setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
          setStatus("队列已清空");
        });
      }

      $("generatePreviewBtn").addEventListener("click", async () => {
        const item = getActiveItem();
        if (!item || state.busy) return;
        const generateMode = getGenerateMode();
        const selectedItems = getSelectedNormalItems();
        const targets = selectedItems.length ? selectedItems : [item];
        if (!targets.length) return;
        try {
          if (targets.length > 1) {
            setLoading(
              true,
              generateMode === "source_file"
                ? `批量生成修改证书中：${targets.length} 条`
                : `批量生成原始记录中：${targets.length} 条`,
            );
          } else {
            setLoading(true, generateMode === "source_file" ? `生成修改证书中：${item.fileName}` : `生成原始记录中：${item.fileName}`);
          }
          let success = 0;
          let failed = 0;
          for (const targetItem of targets) {
            try {
              await generateItem(targetItem, generateMode);
              success += 1;
            } catch (error) {
              failed += 1;
              if (targetItem.status !== "incomplete") {
                targetItem.status = "error";
                targetItem.message = error && error.message ? error.message : "生成失败";
              }
              appendLog(`生成失败 ${targetItem.fileName}：${targetItem.message}`);
            }
          }
          renderQueue();
          await renderPreviews();
          setRightViewMode("preview");
          if (targets.length > 1) {
            setStatus(
              generateMode === "source_file"
                ? `批量生成修改证书完成：成功 ${success}，失败 ${failed}`
                : `批量生成原始记录完成：成功 ${success}，失败 ${failed}`,
            );
          } else if (failed === 0) {
            setStatus(generateMode === "source_file" ? `已生成修改证书：${item.fileName}` : `已生成原始记录：${item.fileName}`);
          } else {
            setStatus(`生成失败：${item.fileName}`);
          }
        } catch (error) {
          setStatus(`生成失败：${error && error.message ? error.message : "unknown"}`);
        } finally {
          setLoading(false);
        }
      });

      const downloadCurrentBtn = $("downloadCurrentBtn");
      downloadCurrentBtn.addEventListener("pointerdown", () => {
        downloadPointerArmed = true;
      });
      downloadCurrentBtn.addEventListener("pointercancel", () => {
        downloadPointerArmed = false;
      });
      downloadCurrentBtn.addEventListener("pointerleave", () => {
        downloadPointerArmed = false;
      });
      downloadCurrentBtn.addEventListener("blur", () => {
        downloadPointerArmed = false;
      });
      downloadCurrentBtn.addEventListener("click", async () => {
        const item = getActiveItem();
        if (!downloadPointerArmed) return;
        downloadPointerArmed = false;
        if (Date.now() < blockDownloadUntil) return;
        if (!item || !item.reportDownloadUrl || state.busy) return;
        try {
          setLoading(true, `导出中：${item.fileName}`);
          await triggerDownload(item.reportDownloadUrl, item.reportFileName || item.templateName || item.fileName || "report.docx");
          item.status = "generated";
          item.message = "已导出";
          const taskId = String((state.taskContext && state.taskContext.id) || "").trim();
          if (taskId && typeof updateTaskStatusApi === "function") {
            await updateTaskStatusApi(taskId, "已生成");
          }
          renderQueue();
          setStatus(`已导出：${item.fileName}`);
        } catch (error) {
          setStatus(`导出失败：${item.fileName}`);
        } finally {
          setLoading(false);
        }
      });

      const runExcelBatchBtn = $("runExcelBatchBtn");
      if (runExcelBatchBtn) {
        runExcelBatchBtn.addEventListener("click", async () => {
          const item = getActiveItem();
          if (!item || state.busy) return;
          try {
            setLoading(true, `Excel批量中：${item.fileName}`);
            await runExcelBatch(item);
            setStatus(`Excel批量完成：${item.fileName}`);
          } catch (error) {
            item.status = "error";
            item.message = error.message || "Excel 批量失败";
            renderQueue();
            setStatus(`Excel批量失败：${item.fileName}`);
          } finally {
            setLoading(false);
          }
        });
      }

      $("filterKeyword").addEventListener("input", () => {
        state.listFilter.keyword = $("filterKeyword").value || "";
        renderQueue();
      });
      $("filterStatus").addEventListener("change", () => {
        state.listFilter.status = $("filterStatus").value || "";
        renderQueue();
      });
      $("sortKey").addEventListener("change", () => {
        state.listFilter.sortKey = $("sortKey").value || "";
        renderQueue();
      });
      $("sortDir").addEventListener("change", () => {
        state.listFilter.sortDir = $("sortDir").value || "asc";
        renderQueue();
      });
      $("toggleSelectModeBtn").addEventListener("click", () => {
        if (state.busy) return;
        state.multiSelectMode = !state.multiSelectMode;
        if (!state.multiSelectMode) {
          const keepId = state.activeId || Array.from(state.selectedIds)[0] || "";
          state.selectedIds.clear();
          if (keepId) state.selectedIds.add(keepId);
        }
        renderQueue();
      });
      $("removeSelectedBtn").addEventListener("click", async () => {
        if (state.busy) return;
        if (!state.selectedIds.size) return;
        const removeSet = new Set(state.selectedIds);
        const beforeCount = state.queue.length;
        state.queue = state.queue.filter((item) => !removeSet.has(item.id));
        const removedCount = beforeCount - state.queue.length;
        state.selectedIds.clear();
        if (!state.queue.length) {
          state.activeId = "";
          setPreviewPlaceholder("sourcePreview", "来源预览未加载");
          $("sourceFieldList").innerHTML = '<div class="placeholder">识别字段未加载</div>';
          setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
        } else if (!state.queue.some((item) => item.id === state.activeId)) {
          state.activeId = state.queue[0].id;
          await renderPreviews();
        }
        renderQueue();
        renderTemplateSelect();
        setStatus(`已移除 ${removedCount} 条记录`);
        appendLog(`已移除选中记录：${removedCount} 条`);
      });
    }

  return { bindEvents };
}
