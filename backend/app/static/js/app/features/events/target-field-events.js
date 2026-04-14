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
    renderTargetFieldForm,
    setStatus,
    validateItemForGeneration,
    handleTargetDateInput,
  } = deps;

  function bindTargetFieldEvents() {
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
  }

  return { bindTargetFieldEvents };
}
