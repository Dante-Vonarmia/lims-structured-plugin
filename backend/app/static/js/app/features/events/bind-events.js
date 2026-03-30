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
  } = deps;
    async function readDirectoryEntries(reader) {
      const all = [];
      while (true) {
        const chunk = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!chunk || !chunk.length) break;
        all.push(...chunk);
      }
      return all;
    }

    async function filesFromEntry(entry) {
      if (!entry) return [];
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        return file ? [file] : [];
      }
      if (entry.isDirectory) {
        const entries = await readDirectoryEntries(entry.createReader());
        const nested = await Promise.all(entries.map((x) => filesFromEntry(x)));
        return nested.flat();
      }
      return [];
    }

    async function filesFromDataTransfer(dt) {
      if (!dt) return [];
      const items = Array.from(dt.items || []);
      if (items.length && items.some((x) => typeof x.webkitGetAsEntry === "function")) {
        const entries = items
          .map((x) => (typeof x.webkitGetAsEntry === "function" ? x.webkitGetAsEntry() : null))
          .filter(Boolean);
        if (entries.length) {
          const groups = await Promise.all(entries.map((entry) => filesFromEntry(entry)));
          return groups.flat();
        }
      }
      return Array.from(dt.files || []);
    }

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
        state.listFilter.activeFilterKey = "";
        state.activeId = id;
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
          if (target.checked) state.selectedIds.add(id);
          else state.selectedIds.delete(id);
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

    function bindQueueLayoutAndDropEvents(queueListEl, addFilesToQueue) {
      const splitterEl = $("listDetailSplitter");
      let splitterDragging = false;
      let splitterStartY = 0;
      let splitterStartHeight = 0;

      const setQueueListHeight = (height) => {
        const minHeight = 140;
        const maxHeight = Math.max(minHeight, Math.floor(window.innerHeight * 0.72));
        const nextHeight = Math.max(minHeight, Math.min(maxHeight, Math.round(height)));
        queueListEl.style.height = `${nextHeight}px`;
      };

      if (splitterEl) {
        splitterEl.addEventListener("mousedown", (event) => {
          if (event.button !== 0) return;
          splitterDragging = true;
          splitterStartY = event.clientY;
          splitterStartHeight = queueListEl.getBoundingClientRect().height;
          document.body.style.cursor = "ns-resize";
          document.body.style.userSelect = "none";
          event.preventDefault();
        });
      }

      document.addEventListener("mousemove", (event) => {
        if (!splitterDragging) return;
        const delta = event.clientY - splitterStartY;
        setQueueListHeight(splitterStartHeight + delta);
      });

      document.addEventListener("mouseup", () => {
        if (!splitterDragging) return;
        splitterDragging = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      });

      let dragDepth = 0;
      const showDropState = () => queueListEl.classList.add("drop-active");
      const hideDropState = () => queueListEl.classList.remove("drop-active");

      queueListEl.addEventListener("dragenter", (event) => {
        event.preventDefault();
        dragDepth += 1;
        showDropState();
      });

      queueListEl.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        showDropState();
      });

      queueListEl.addEventListener("dragleave", (event) => {
        event.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) hideDropState();
      });

      queueListEl.addEventListener("drop", async (event) => {
        event.preventDefault();
        dragDepth = 0;
        hideDropState();
        if (state.busy) return;
        try {
          const files = await filesFromDataTransfer(event.dataTransfer);
          addFilesToQueue(files);
          if (!state.busy) await processAllPending();
        } catch (error) {
          setStatus(`拖拽失败：${error.message || "unknown"}`);
          appendLog(`拖拽失败：${error.message || "unknown"}`);
        }
      });
    }

    function bindEvents() {
      const addFilesToQueue = (files) => {
        if (!files.length) return;
        const supported = files.filter((f) => isSupportedFile(f));
        const skipped = files.length - supported.length;
        const extSet = new Set(supported.map((f) => extFromName((f && f.name) || "")));
        if (!supported.length) {
          setStatus("未发现可识别文件");
          if (skipped > 0) appendLog(`拖拽/上传中有 ${skipped} 个不支持文件已忽略`);
          return;
        }
        supported.forEach((f) => state.queue.push(createQueueItem(f)));
        renderQueue();
        renderTemplateSelect();
        setStatus(`已加入队列：${supported.length} 个`);
        appendLog(`新增 ${supported.length} 个文件到队列`);
        if (extSet.size > 1) appendLog("提示：本次上传包含多种来源类型，建议按同类型分批上传。");
        if (skipped > 0) appendLog(`已忽略 ${skipped} 个不支持文件`);
      };

      bindUploadCatalogEvents(addFilesToQueue);

      const queueListEl = $("queueList");
      bindQueueTableEvents(queueListEl);
      bindQueueLayoutAndDropEvents(queueListEl, addFilesToQueue);

      bindViewModeEvents();

      const handleTargetFieldChange = (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const datePart = String(target.getAttribute("data-date-part") || "").trim();
        const dateField = String(target.getAttribute("data-date-field") || "").trim();
        if (datePart && dateField && target instanceof HTMLInputElement) {
          const grid = target.closest(".target-date-grid");
          if (!(grid instanceof HTMLElement)) return;
          const yearInput = grid.querySelector('input[data-date-field][data-date-part="year"]');
          const monthInput = grid.querySelector('input[data-date-field][data-date-part="month"]');
          const dayInput = grid.querySelector('input[data-date-field][data-date-part="day"]');
          const hiddenInput = grid.parentElement ? grid.parentElement.querySelector(`input[type="hidden"][data-field="${dateField}"]`) : null;
          if (!(yearInput instanceof HTMLInputElement) || !(monthInput instanceof HTMLInputElement) || !(dayInput instanceof HTMLInputElement)) return;
          if (!(hiddenInput instanceof HTMLInputElement)) return;
          const normalizeDigits = (raw, maxLen) => String(raw || "").replace(/\D+/g, "").slice(0, maxLen);
          const year = normalizeDigits(yearInput.value, 4);
          const month = normalizeDigits(monthInput.value, 2);
          const day = normalizeDigits(dayInput.value, 2);
          if (yearInput.value !== year) yearInput.value = year;
          if (monthInput.value !== month) monthInput.value = month;
          if (dayInput.value !== day) dayInput.value = day;
          let composed = "";
          if (year || month || day) {
            composed = `${year}${year ? "年" : ""}${month ? `${month.padStart(2, "0")}月` : ""}${day ? `${day.padStart(2, "0")}日` : ""}`;
          }
          if (hiddenInput.value !== composed) {
            hiddenInput.value = composed;
          }
          hiddenInput.dispatchEvent(new Event(event.type === "change" ? "change" : "input", { bubbles: true }));
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
          const normalizeCode = (code) => String(code || "")
            .replace(/\s+/g, " ")
            .replace(/\s*\/\s*/g, "/")
            .replace(/\/\s*T\s*/ig, "/T ")
            .trim();
          const idx = Number.parseInt(String(target.getAttribute("data-index") || "-1"), 10);
          const current = Array.isArray(item.fields.basis_standard_items) ? [...item.fields.basis_standard_items] : [];
          while (current.length <= idx) current.push("");
          current[idx] = normalizeCode(target.value || "");
          const next = current.map((x) => normalizeCode(x)).filter(Boolean);
          item.fields.basis_standard_items = next;
          item.fields.basis_standard = next.join("\n");
          renderTargetFieldForm(item);
          applyTargetFieldProblemStyles(item);
          renderQueue();
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
          if (String(target.getAttribute("data-role") || "") === "measurement-item-name") {
            const token = normalizeCatalogToken(body[rowIdx][colIdx]);
            const catalogRow = token ? state.instrumentCatalogRowByToken.get(token) : null;
            if (catalogRow) {
              const idx = getMeasurementHeaderIndexes(header);
              if (idx.modelIdx >= 0 && idx.modelIdx < body[rowIdx].length && catalogRow.model) body[rowIdx][idx.modelIdx] = String(catalogRow.model || "").trim();
              if (idx.codeIdx >= 0 && idx.codeIdx < body[rowIdx].length && catalogRow.code) body[rowIdx][idx.codeIdx] = String(catalogRow.code || "").trim();
            }
          }
          item.fields.measurement_items = [header, ...body].map((row) => row.join("\t")).join("\n");
          if (!(item.fields.measurement_item_count || "").trim()) {
            item.fields.measurement_item_count = String(body.length);
          }
          rebuildMeasurementItemsFromCells();
          renderTargetFieldForm(item);
          renderQueue();
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
            renderQueue();
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
          renderQueue();
          return;
        }
        const value = readControlValue();
        if (isMultiMode && MULTI_EDIT_DISABLED_FIELD_KEYS.has(key)) return;
        editTargets.forEach((targetItem) => {
          if (!targetItem.fields) targetItem.fields = createEmptyFields();
          targetItem.fields[key] = value;
          if (key === "receive_date") {
            targetItem.fields.calibration_date = value;
          } else if (key === "calibration_date") {
            targetItem.fields.receive_date = value;
          }
          if (["receive_date", "calibration_date", "release_date"].includes(key)) {
            const inferred = inferDateTriplet({
              receiveDate: String(targetItem.fields.receive_date || ""),
              calibrationDate: String(targetItem.fields.calibration_date || ""),
              releaseDate: String(targetItem.fields.release_date || ""),
            });
            if (!isCompleteDateText(targetItem.fields.receive_date || "") && inferred.receiveDate) {
              targetItem.fields.receive_date = inferred.receiveDate;
            }
            if (!isCompleteDateText(targetItem.fields.calibration_date || "") && inferred.calibrationDate) {
              targetItem.fields.calibration_date = inferred.calibrationDate;
            }
            const strictRelease = inferDateTriplet({
              receiveDate: String(targetItem.fields.receive_date || ""),
              calibrationDate: String(targetItem.fields.calibration_date || ""),
              releaseDate: "",
            }).releaseDate;
            const hasCompleteUpperDate = isCompleteDateText(targetItem.fields.receive_date || "")
              || isCompleteDateText(targetItem.fields.calibration_date || "");
            if (hasCompleteUpperDate && strictRelease) {
              targetItem.fields.release_date = strictRelease;
            } else if (!isCompleteDateText(targetItem.fields.release_date || "") && inferred.releaseDate) {
              targetItem.fields.release_date = inferred.releaseDate;
            }
          }
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
        applyTargetFieldProblemStyles(item);
        renderQueue();
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
          return;
        }
        if (action === "match-measurement-items") {
          const tableRows = parseTableRowsFromBlock(String(item.fields.measurement_items || ""));
          if (!tableRows || tableRows.length < 2) return;
          if (!state.instrumentCatalogRows || !state.instrumentCatalogRows.length) {
            appendLog("目录未就绪：请先装填计量标准器具目录");
            return;
          }
          const [header, ...body] = tableRows;
          const { nameIdx, modelIdx, codeIdx } = getMeasurementHeaderIndexes(header);
          const nextBody = body.map((row) => [...row]);
          let changed = 0;
          for (let i = 0; i < nextBody.length; i += 1) {
            const row = nextBody[i];
            const token = normalizeCatalogToken(String(row[nameIdx] || ""));
            const catalogRow = token ? state.instrumentCatalogRowByToken.get(token) : null;
            if (!catalogRow) continue;
            const before = `${row[nameIdx] || ""}|${row[modelIdx] || ""}|${row[codeIdx] || ""}`;
            if (nameIdx >= 0 && catalogRow.name) row[nameIdx] = String(catalogRow.name || "").trim();
            if (modelIdx >= 0 && catalogRow.model) row[modelIdx] = String(catalogRow.model || "").trim();
            if (codeIdx >= 0 && catalogRow.code) row[codeIdx] = String(catalogRow.code || "").trim();
            const after = `${row[nameIdx] || ""}|${row[modelIdx] || ""}|${row[codeIdx] || ""}`;
            if (before !== after) changed += 1;
          }
          item.fields.measurement_items = [header, ...nextBody].map((row) => row.join("\t")).join("\n");
          renderTargetFieldForm(item);
          applyTargetFieldProblemStyles(item);
          renderQueue();
          appendLog(changed > 0 ? `器具目录一键配对完成：更新 ${changed} 行` : "器具目录一键配对完成：无可更新项");
          return;
        }
        const normalizeCode = (code) => String(code || "")
          .replace(/\s+/g, " ")
          .replace(/\s*\/\s*/g, "/")
          .replace(/\/\s*T\s*/ig, "/T ")
          .trim();
        const current = Array.isArray(item.fields.basis_standard_items) ? [...item.fields.basis_standard_items] : [];
        if (action === "add-basis-item") {
          current.push("");
          item.fields.basis_standard_items = current;
          item.fields.basis_standard = current.map((x) => normalizeCode(x)).filter(Boolean).join("\n");
          renderTargetFieldForm(item);
          return;
        }
        if (action === "remove-basis-item") {
          const idx = Number.parseInt(String(target.getAttribute("data-index") || "-1"), 10);
          if (idx < 0 || idx >= current.length) return;
          current.splice(idx, 1);
          const next = current.map((x) => normalizeCode(x)).filter(Boolean);
          item.fields.basis_standard_items = next;
          item.fields.basis_standard = next.join("\n");
          renderTargetFieldForm(item);
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
        if (event.key === "Escape") setCatalogDetailVisible(false);
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

    function bindUploadCatalogEvents(addFilesToQueue) {
      $("uploadBtn").addEventListener("click", (event) => {
        if (state.busy) return;
        event.preventDefault();
        $("sourceFiles").click();
      });

      $("uploadInstrumentCatalogBtn").addEventListener("click", (event) => {
        if (state.busy) return;
        event.preventDefault();
        $("instrumentCatalogFile").click();
      });

      $("viewInstrumentCatalogDetailBtn").addEventListener("click", () => {
        if (!state.instrumentCatalogRows.length) return;
        setCatalogDetailVisible(true);
      });

      $("closeCatalogDetailBtn").addEventListener("click", () => {
        setCatalogDetailVisible(false);
      });

      $("catalogDetailMask").addEventListener("click", (event) => {
        if (event.target === $("catalogDetailMask")) setCatalogDetailVisible(false);
      });

      $("sourceFiles").addEventListener("change", async () => {
        const files = Array.from($("sourceFiles").files || []);
        addFilesToQueue(files);
        $("sourceFiles").value = "";
        if (!state.busy) await processAllPending();
      });

      $("instrumentCatalogFile").addEventListener("change", async () => {
        const file = ($("instrumentCatalogFile").files || [])[0];
        $("instrumentCatalogFile").value = "";
        if (!file || state.busy) return;
        try {
          setLoading(true, `解析计量标准器具目录：${file.name}`);
          const data = await parseInstrumentCatalog(file);
          setInstrumentCatalog((data && data.names) || [], file.name || "", (data && data.rows) || []);
          setStatus(`计量标准器具目录已装填：${((data && data.total) || 0)} 项`);
          appendLog(`计量标准器具目录装填完成 ${file.name}：${((data && data.total) || 0)} 项`);
        } catch (error) {
          setStatus(`计量标准器具目录解析失败：${error.message || "unknown"}`);
          appendLog(`计量标准器具目录解析失败 ${file.name}：${error.message || "unknown"}`);
        } finally {
          setLoading(false);
        }
      });

      $("clearInstrumentCatalogBtn").addEventListener("click", () => {
        if (state.busy) return;
        setInstrumentCatalog([], "");
        setStatus("计量标准器具目录已清除");
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
        await refreshAllRecognition();
      });

      $("runBatchBtn").addEventListener("click", async () => {
        if (state.busy) return;
        const selected = getSelectedNormalItems().map((x) => x.id);
        await exportAll(selected);
      });

      $("clearQueueBtn").addEventListener("click", () => {
        if (state.busy) return;
        state.queue = [];
        state.selectedIds.clear();
        state.activeId = "";
        setPreviewFullscreen(false);
        clearPreprocessProgress();
        state.excelPreviewSheetByFileId = {};
        renderQueue();
        renderTemplateSelect();
        setPreviewPlaceholder("sourcePreview", "证书模板预览未加载");
        $("sourceFieldList").innerHTML = '<div class="placeholder">识别字段未加载</div>';
        setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
        setStatus("队列已清空");
      });

      $("generatePreviewBtn").addEventListener("click", async () => {
        const item = getActiveItem();
        if (!item || state.busy) return;
        const generateMode = getGenerateMode();
        try {
          setLoading(true, generateMode === "source_file" ? `导出证书模板来源文件：${item.fileName}` : `生成原始记录中：${item.fileName}`);
          await generateItem(item, generateMode);
          await renderPreviews();
          setRightViewMode("preview");
          setStatus(generateMode === "source_file" ? `已导出证书模板来源文件：${item.fileName}` : `已生成原始记录：${item.fileName}`);
        } catch (error) {
          if (item.status !== "incomplete") {
            item.status = "error";
            item.message = error.message || "生成失败";
          }
          renderQueue();
          appendLog(`生成失败 ${item.fileName}：${item.message}`);
          setStatus(`生成失败：${item.fileName}`);
        } finally {
          setLoading(false);
        }
      });

      $("downloadCurrentBtn").addEventListener("click", async () => {
        const item = getActiveItem();
        if (!item || !item.reportDownloadUrl || state.busy) return;
        try {
          setLoading(true, `导出中：${item.fileName}`);
          await triggerDownload(item.reportDownloadUrl, item.reportFileName || item.templateName || item.fileName || "report.docx");
          item.status = "generated";
          item.message = "已导出";
          renderQueue();
          setStatus(`已导出：${item.fileName}`);
        } catch (error) {
          setStatus(`导出失败：${item.fileName}`);
        } finally {
          setLoading(false);
        }
      });

      $("runExcelBatchBtn").addEventListener("click", async () => {
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

      $("generateModeSelect").addEventListener("change", async () => {
        syncGenerateModeUiText();
        await renderTargetPreview(getActiveItem());
      });

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
      $("selectVisibleBtn").addEventListener("click", () => {
        if (state.busy) return;
        getFilteredSortedQueue().forEach((item) => state.selectedIds.add(item.id));
        renderQueue();
        refreshTargetFieldFormBySelection();
        renderSourceFieldList(getActiveItem());
        renderSourcePreview(getActiveItem());
        renderTargetPreview(getActiveItem());
        updateSourceDeviceNameText(getActiveItem());
      });
      $("clearSelectedBtn").addEventListener("click", () => {
        if (state.busy) return;
        state.selectedIds.clear();
        renderQueue();
        refreshTargetFieldFormBySelection();
        renderSourceFieldList(getActiveItem());
        renderSourcePreview(getActiveItem());
        renderTargetPreview(getActiveItem());
        updateSourceDeviceNameText(getActiveItem());
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
          setPreviewPlaceholder("sourcePreview", "证书模板预览未加载");
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
