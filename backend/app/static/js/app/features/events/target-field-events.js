export function createTargetFieldEventBindings(deps = {}) {
  const {
    $,
    state,
    MULTI_EDIT_DISABLED_FIELD_KEYS,
    createEmptyFields,
    applyIncompleteState,
    applyTargetFieldProblemStyles,
    buildCategoryMessage,
    buildGeneralCheckWysiwygData,
    cleanBlockText,
    getActiveItem,
    getGenerateMode,
    getSelectedNormalItems,
    inferCategory,
    isTargetMultiEditMode,
    maybeCopyGeneralCheckForBlankTemplate,
    parseTableRowsFromBlock,
    refreshTargetFieldFormBySelection,
    renderQueue,
    renderSourceFieldList,
    renderTargetFieldForm,
    saveWorkspaceDraft,
    setStatus,
    updateTaskTemplateInfoApi,
    validateItemForGeneration,
    handleTargetDateInput,
    rememberFieldValueFromTarget,
    acceptSuggestionFromTarget,
    canAcceptSuggestionFromTarget,
  } = deps;

  function bindTargetFieldEvents() {
    const getFloatingHintElements = (target) => {
      if (!(target instanceof HTMLElement)) return { wrap: null, hint: null };
      const wrap = target.closest(".field-memory-inline-wrap");
      if (!(wrap instanceof HTMLElement)) return { wrap: null, hint: null };
      const hint = wrap.querySelector(".field-memory-floating-hint");
      if (!(hint instanceof HTMLElement)) return { wrap, hint: null };
      return { wrap, hint };
    };
    const measureTextWidth = (target, text) => {
      const value = String(text || "");
      if (!value) return 0;
      const style = window.getComputedStyle(target);
      const canvas = measureTextWidth.canvas || (measureTextWidth.canvas = document.createElement("canvas"));
      const context = canvas.getContext("2d");
      if (!context) return value.length * 8;
      context.font = [
        style.fontStyle,
        style.fontVariant,
        style.fontWeight,
        style.fontSize,
        style.fontFamily,
      ].filter(Boolean).join(" ");
      return context.measureText(value).width;
    };
    const syncFloatingHint = (target) => {
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (target.type === "hidden" || target.type === "checkbox") return;
      const { wrap, hint } = getFloatingHintElements(target);
      if (!(wrap instanceof HTMLElement) || !(hint instanceof HTMLElement)) return;
      const hintText = String(hint.textContent || "").trim();
      const currentValue = String(target.value || target.textContent || "").trim();
      const isActive = document.activeElement === target && !!currentValue && hintText;
      wrap.classList.toggle("is-memory-hint-active", !!isActive);
      if (!isActive) return;
      const style = window.getComputedStyle(target);
      const paddingLeft = Number.parseFloat(style.paddingLeft || "0") || 0;
      const lineHeight = Number.parseFloat(style.lineHeight || "0") || 18;
      const maxOffset = Math.max(0, target.clientWidth - 120);
      const textOffset = Math.min(maxOffset, Math.max(0, measureTextWidth(target, currentValue) + 14));
      hint.style.left = `${paddingLeft + textOffset}px`;
      hint.style.top = target instanceof HTMLTextAreaElement ? `${Math.max(8, (lineHeight - 16) / 2 + 8)}px` : "50%";
    };
    const syncRepeatableHint = () => {
      const formRoot = $("targetFieldForm");
      if (!(formRoot instanceof HTMLElement)) return;
      const wraps = Array.from(formRoot.querySelectorAll(".appendix-repeatable-wrap"));
      if (!wraps.length) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const activeKey = String(active && active.getAttribute("data-repeatable-key") || "").trim();
      const rowEl = active ? active.closest("[data-repeatable-row-index]") : null;
      const rowIndex = Number.parseInt(String(rowEl && rowEl.getAttribute("data-repeatable-row-index") || "-1"), 10);
      const shouldShow = !!activeKey && rowIndex === 0;
      wraps.forEach((wrap) => wrap.classList.toggle("is-hint-active", shouldShow));
    };
    const handleTargetFieldChange = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const persistDraftOnChange = () => {
        if (event.type === "change" && typeof saveWorkspaceDraft === "function") {
          void saveWorkspaceDraft();
        }
      };
      syncFloatingHint(target);
      const templateInfoKey = String(target.getAttribute("data-template-info") || "").trim();
      if (templateInfoKey) {
        const item = getActiveItem();
        if (!item || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
        const nextValue = String(target.value || "").trim();
        if (!state.taskContext || typeof state.taskContext !== "object") return;
        const currentTemplateInfo = (state.taskContext.template_info && typeof state.taskContext.template_info === "object")
          ? state.taskContext.template_info
          : {};
        if (currentTemplateInfo[templateInfoKey] === nextValue && event.type !== "change") return;
        currentTemplateInfo[templateInfoKey] = nextValue;
        state.taskContext.template_info = currentTemplateInfo;
        if (event.type === "change") {
          if (typeof rememberFieldValueFromTarget === "function") {
            rememberFieldValueFromTarget(target, $("targetFieldForm"));
          }
          if (typeof updateTaskTemplateInfoApi === "function" && String((state.taskContext && state.taskContext.id) || "").trim()) {
            updateTaskTemplateInfoApi(state.taskContext.id, { [templateInfoKey]: nextValue })
              .then((task) => {
                const payload = (task && task.template_info && typeof task.template_info === "object") ? task.template_info : {};
                state.taskContext.template_info = {
                  ...state.taskContext.template_info,
                  ...payload,
                };
                renderSourceFieldList(item);
                renderTargetFieldForm(item);
                applyTargetFieldProblemStyles(item);
                renderQueue();
                if (typeof saveWorkspaceDraft === "function") void saveWorkspaceDraft();
              })
              .catch((error) => {
                setStatus(`基础信息保存失败：${error && error.message ? error.message : "unknown"}`);
              });
          } else {
            renderSourceFieldList(item);
            renderQueue();
            if (typeof saveWorkspaceDraft === "function") void saveWorkspaceDraft();
          }
          const labelEl = target.closest(".source-form-item")?.querySelector(":scope > span");
          const labelText = String(labelEl && labelEl.textContent ? labelEl.textContent : "").trim();
          setStatus(`已更新：${labelText || templateInfoKey}`);
        }
        return;
      }
      if (handleTargetDateInput(target, event.type)) {
        if (event.type === "change" && typeof rememberFieldValueFromTarget === "function") {
          rememberFieldValueFromTarget(target, $("targetFieldForm"));
        }
        persistDraftOnChange();
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
        if (target instanceof HTMLInputElement) {
          if (target.type === "checkbox") {
            return target.checked ? "true" : "";
          }
          return String(target.value || "");
        }
        if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
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
        if (event.type === "change" && typeof rememberFieldValueFromTarget === "function") {
          rememberFieldValueFromTarget(target, $("targetFieldForm"));
        }
        persistDraftOnChange();
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
        if (event.type === "change" && typeof rememberFieldValueFromTarget === "function") {
          rememberFieldValueFromTarget(target, $("targetFieldForm"));
        }
        persistDraftOnChange();
        setStatus("已更新：本次校准所使用的主要计量标准气瓶");
        return;
      }
      if (key === "appendix1_cell" || key === "appendix1_cell_date_part") {
        const formRoot = $("targetFieldForm");
        if (!(formRoot instanceof HTMLElement)) return;
        const rows = Array.from(formRoot.querySelectorAll('tr[data-appendix-row]')).map((row) => {
          const serialInput = row.querySelector('input[data-field="appendix1_cell"][data-col="serial_no"]');
          const makerInput = row.querySelector('input[data-field="appendix1_cell"][data-col="maker_code"]');
          const yearInput = row.querySelector('input[data-field="appendix1_cell_date_part"][data-col="next_date"][data-part="year"]');
          const monthInput = row.querySelector('input[data-field="appendix1_cell_date_part"][data-col="next_date"][data-part="month"]');
          const dayInput = row.querySelector('input[data-field="appendix1_cell_date_part"][data-col="next_date"][data-part="day"]');
          const serialNo = String(serialInput && "value" in serialInput ? serialInput.value : "").trim();
          const makerCode = String(makerInput && "value" in makerInput ? makerInput.value : "").trim();
          const y = String(yearInput && "value" in yearInput ? yearInput.value : "").replace(/[^\d]/g, "").slice(0, 4);
          const m = String(monthInput && "value" in monthInput ? monthInput.value : "").replace(/[^\d]/g, "").slice(0, 2);
          const d = String(dayInput && "value" in dayInput ? dayInput.value : "").replace(/[^\d]/g, "").slice(0, 2);
          const nextDate = (y && m && d) ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : "";
          return { serialNo, makerCode, nextDate };
        }).filter((x) => x.serialNo || x.makerCode || x.nextDate);
        const valueText = rows.map((x) => [x.serialNo, x.makerCode, x.nextDate].join("\t")).join("\n");
        editTargets.forEach((targetItem) => {
          if (!targetItem || typeof targetItem !== "object") return;
          if (!targetItem.fields || typeof targetItem.fields !== "object") targetItem.fields = createEmptyFields();
          targetItem.fields.appendix1_rows_text = valueText;
        });
        invalidateCurrentModeReports(editTargets);
        renderQueue();
        if (event.type === "change" && typeof rememberFieldValueFromTarget === "function") {
          rememberFieldValueFromTarget(target, $("targetFieldForm"));
        }
        persistDraftOnChange();
        setStatus("已更新：附表1明细");
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
          if (event.type === "change" && typeof rememberFieldValueFromTarget === "function") {
            rememberFieldValueFromTarget(target, $("targetFieldForm"));
          }
          persistDraftOnChange();
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
        if (event.type === "change" && typeof rememberFieldValueFromTarget === "function") {
          rememberFieldValueFromTarget(target, $("targetFieldForm"));
        }
        persistDraftOnChange();
        setStatus("已更新：一般检查");
        return;
      }
      const value = readControlValue();
      if (isMultiMode && MULTI_EDIT_DISABLED_FIELD_KEYS.has(key)) return;
      const isDateKey = [
        "manufacture_date",
        "last_inspection_date",
        "next_inspection_date",
        "receive_date",
        "calibration_date",
        "release_date",
      ].includes(key);
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
        if (target instanceof HTMLInputElement && target.type === "checkbox") {
          const existing = Array.isArray(targetItem.booleanFieldKeys) ? targetItem.booleanFieldKeys : [];
          if (!existing.includes(key)) targetItem.booleanFieldKeys = existing.concat(key);
        }
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
      if (key === "record_no" && state.taskContext && typeof state.taskContext === "object") {
        const currentTemplateInfo = (state.taskContext.template_info && typeof state.taskContext.template_info === "object")
          ? state.taskContext.template_info
          : {};
        currentTemplateInfo.record_no = String(value || "").trim();
        state.taskContext.template_info = currentTemplateInfo;
        if (event.type === "change" && typeof updateTaskTemplateInfoApi === "function" && String((state.taskContext && state.taskContext.id) || "").trim()) {
          updateTaskTemplateInfoApi(state.taskContext.id, { record_no: currentTemplateInfo.record_no })
            .then((task) => {
              const payload = (task && task.template_info && typeof task.template_info === "object") ? task.template_info : {};
              state.taskContext.template_info = {
                ...state.taskContext.template_info,
                ...payload,
              };
            })
            .catch(() => {});
        }
      }
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
          syncDateFieldDom("manufacture_date", active.fields.manufacture_date);
          syncDateFieldDom("last_inspection_date", active.fields.last_inspection_date);
          syncDateFieldDom("next_inspection_date", active.fields.next_inspection_date);
          syncDateFieldDom("receive_date", active.fields.receive_date);
          syncDateFieldDom("calibration_date", active.fields.calibration_date);
          syncDateFieldDom("release_date", active.fields.release_date);
        }
      }
      applyTargetFieldProblemStyles(item);
      renderQueue();
      if (event.type === "change" && typeof rememberFieldValueFromTarget === "function") {
        rememberFieldValueFromTarget(target, $("targetFieldForm"));
      }
      if (event.type === "change") {
        persistDraftOnChange();
        const labelEl = target.closest(".source-form-item")?.querySelector(":scope > span");
        const labelText = String(labelEl && labelEl.textContent ? labelEl.textContent : "").trim();
        setStatus(`已更新：${labelText || key}`);
      }
    };
    const handleTargetFieldKeydown = (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      const repeatableKey = String(event.target.getAttribute("data-repeatable-key") || "").trim();
      if (event.key === "Enter" && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const repeatableTarget = event.target;
        if (repeatableKey && (repeatableTarget instanceof HTMLInputElement || repeatableTarget instanceof HTMLTextAreaElement || repeatableTarget instanceof HTMLSelectElement)) {
          const rowEl = repeatableTarget.closest("[data-repeatable-row-index]");
          const rowIndex = Number.parseInt(String(rowEl && rowEl.getAttribute("data-repeatable-row-index") || "-1"), 10);
          if (rowIndex === 0) {
            const tableEl = repeatableTarget.closest("[data-repeatable-table]");
            if (tableEl instanceof HTMLElement) {
              const allControls = Array.from(tableEl.querySelectorAll("[data-repeatable-key]"))
                .filter((node) => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement);
              const matchedControls = allControls
                .filter((node) => String(node.getAttribute("data-repeatable-key") || "").trim() === repeatableKey);
              const sourceValue = String(repeatableTarget.value || "");
              let changedCount = 0;
              matchedControls.forEach((node) => {
                if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement)) return;
                if (node === repeatableTarget) return;
                const nodeRow = node.closest("[data-repeatable-row-index]");
                const nodeRowIndex = Number.parseInt(String(nodeRow && nodeRow.getAttribute("data-repeatable-row-index") || "-1"), 10);
                if (nodeRowIndex <= 0) return;
                if (node.value === sourceValue) return;
                node.value = sourceValue;
                changedCount += 1;
              });
              if (changedCount > 0) {
                repeatableTarget.dispatchEvent(new Event("input", { bubbles: true }));
                repeatableTarget.dispatchEvent(new Event("change", { bubbles: true }));
                setStatus(`已应用到其余行（${changedCount}处）`);
              } else {
                setStatus("无需应用：其余行值已一致");
              }
              event.preventDefault();
              return;
            }
          }
        }
      }
      if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      if (repeatableKey) return;
      if (typeof canAcceptSuggestionFromTarget === "function") {
        const canAccept = canAcceptSuggestionFromTarget(event.target, $("targetFieldForm"));
        if (!canAccept) return;
      }
      if (typeof acceptSuggestionFromTarget !== "function") return;
      const accepted = acceptSuggestionFromTarget(event.target, $("targetFieldForm"));
      if (!accepted) return;
      event.preventDefault();
      syncFloatingHint(event.target);
      setStatus("已应用上次填写内容");
    };
    $("targetFieldForm").addEventListener("input", handleTargetFieldChange);
    $("targetFieldForm").addEventListener("change", handleTargetFieldChange);
    $("targetFieldForm").addEventListener("keydown", handleTargetFieldKeydown);
    $("targetFieldForm").addEventListener("focusin", (event) => {
      syncFloatingHint(event.target);
      syncRepeatableHint();
    });
    $("targetFieldForm").addEventListener("focusout", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      window.setTimeout(() => {
        syncFloatingHint(target);
        syncRepeatableHint();
      }, 0);
    });
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
  }

  return { bindTargetFieldEvents };
}
