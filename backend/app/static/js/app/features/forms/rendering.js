export function createFormRenderingFeature(deps = {}) {
  const {
    $,
    state,
    TARGET_EDIT_GROUPS,
    MULTI_EDIT_DISABLED_FIELD_KEYS,
    MULTI_EDIT_MIXED_PLACEHOLDER,
    createEmptyFields,
    getSelectedNormalItems,
    getProblemFieldKeys,
    buildFocusSections,
    renderFocusSectionsHtml,
    extractCalibrationInfoFields,
    isCompleteDateText,
    extractGeneralCheckFullBlock,
    safeShouldRebuildMeasurementItemsFromRaw,
    safeNormalizeMeasurementItemsText,
    resolveTargetFormFields,
    getSharedFieldValue,
    parseTableRowsFromBlock,
    buildFallbackMeasurementRows,
    buildMeasurementCatalogMatchInfo,
    getMeasurementHeaderIndexes,
    renderGeneralCheckWysiwygBlock,
    isTargetMultiEditMode,
    parseDateParts,
    escapeHtml,
    escapeAttr,
  } = deps;

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
    const rowInfo = isMultiMode ? "" : (item.recordName || item.fileName || "未命名记录");
    const noteTextBase = "";
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
      if (isMultiDisabled && field.key !== "measurement_items") {
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
              <label class="source-form-item slot-field wide multi-edit-disabled-field ${isProblem ? "is-problem" : ""}">
                <span>${escapeHtml(field.label)}</span>
                <div class="source-recog-block multi-edit-disabled-note">多选模式下不可编辑</div>
              </label>
            `;
        }
        const normalizeLine = (line) => String(line || "")
          .replace(/\s+/g, " ")
          .trim();
        const fromArray = Array.isArray(f.basis_standard_items) ? f.basis_standard_items : [];
        const source = fromArray.length ? fromArray.join("\n") : String(f.basis_standard || "");
        const items = [];
        const seen = new Set();
        const lines = source.split(/\r?\n/).map((x) => normalizeLine(x)).filter(Boolean);
        for (const line of lines) {
          if (seen.has(line)) continue;
          seen.add(line);
          items.push(line);
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
          const hasCatalog = !!(state.instrumentCatalogRows && state.instrumentCatalogRows.length);
          const scope = selectedNormalItems.map((x) => String(x && x.id || "")).filter(Boolean).sort().join(",");
          const notice = (state.measurementMultiSyncNotice && state.measurementMultiSyncNotice.scope === scope)
            ? String(state.measurementMultiSyncNotice.text || "")
            : "";
          const hintText = hasCatalog
            ? "多选模式仅按各记录自身内容与目录对齐，不会在记录间互相覆盖"
            : "目录未就绪：请先加载“本次校准所使用的主要计量标准器具”目录";
          return `
              <label class="source-form-item slot-field wide">
                <div class="measurement-toolbar">
                  <button type="button" class="btn ghost" data-action="match-measurement-items-multi">一键目录配对</button>
                  <span class="measurement-toolbar-hint">${escapeHtml(hintText)}</span>
                  ${notice ? `<span class="measurement-toolbar-status">${escapeHtml(notice)}</span>` : ""}
                </div>
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
                <button type="button" class="btn ghost" data-action="match-measurement-items">一键目录配对</button>
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
      const fieldKey = String(field.key || "").trim();
      const fieldLabel = String(field.label || "").trim();
      const isDateField = ["receive_date", "calibration_date", "release_date"].includes(fieldKey)
        || ["收样日期", "校准日期", "发布日期"].includes(fieldLabel);
      if (isDateField) {
        const parsed = parseDateParts(value);
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
        const normalizedDateParts = parsed || parseLooseDateParts(value);
        const year = String((normalizedDateParts && normalizedDateParts.year) || "");
        const month = String((normalizedDateParts && normalizedDateParts.month) || "");
        const day = String((normalizedDateParts && normalizedDateParts.day) || "");
        return `
            <label class="source-form-item slot-field ${isProblem ? "is-problem" : ""}">
              <span>${escapeHtml(field.label)}</span>
              <input type="hidden" data-field="${escapeAttr(fieldKey)}" value="${escapeAttr(value)}" />
              <span class="target-date-grid">
                <input type="text" class="target-date-input target-date-year ${isProblem ? "is-problem" : ""}" data-date-field="${escapeAttr(fieldKey)}" data-date-part="year" value="${escapeAttr(year)}" maxlength="4" placeholder="${isMixed ? MULTI_EDIT_MIXED_PLACEHOLDER : ""}" />
                <span class="target-date-unit">年</span>
                <input type="text" class="target-date-input target-date-month ${isProblem ? "is-problem" : ""}" data-date-field="${escapeAttr(fieldKey)}" data-date-part="month" value="${escapeAttr(month)}" maxlength="2" />
                <span class="target-date-unit">月</span>
                <input type="text" class="target-date-input target-date-day ${isProblem ? "is-problem" : ""}" data-date-field="${escapeAttr(fieldKey)}" data-date-part="day" value="${escapeAttr(day)}" maxlength="2" />
                <span class="target-date-unit">日</span>
              </span>
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

  return {
    renderSourceFieldList,
    renderTargetFieldForm,
    applyTargetFieldProblemStyles,
  };
}
