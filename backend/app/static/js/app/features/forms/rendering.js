import { createSourceFieldComponents } from "../components/source-field/index.js";

export function createFormRenderingFeature(deps = {}) {
  const {
    $,
    state,
    MULTI_EDIT_DISABLED_FIELD_KEYS,
    MULTI_EDIT_MIXED_PLACEHOLDER,
    createEmptyFields,
    getSelectedNormalItems,
    getProblemFieldKeys,
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
  const {
    resolveSchemaGroups,
    resolveInfoFields,
    renderSourceFieldRow,
  } = createSourceFieldComponents({
    escapeHtml,
    escapeAttr,
    parseDateParts,
  });

  function renderSourceFieldList(item) {
    const el = $("sourceFieldList");
    if (!el) return;
    if (!item) {
      el.innerHTML = '<div class="placeholder">识别字段未加载</div>';
      return;
    }
    const taskSchema = (state.taskContext && state.taskContext.import_template_schema && typeof state.taskContext.import_template_schema === "object")
      ? state.taskContext.import_template_schema
      : { template_name: "", columns: [], groups: [] };
    const schemaColumns = Array.isArray(taskSchema.columns) ? taskSchema.columns : [];
    const schemaGroupsRaw = Array.isArray(taskSchema.groups) ? taskSchema.groups : [];
    if (!schemaColumns.length) {
      el.innerHTML = '<div class="placeholder">模板字段结构未加载</div>';
      return;
    }

    const fieldPipeline = (item && item.fieldPipeline && typeof item.fieldPipeline === "object") ? item.fieldPipeline : {};
    const itemFields = (item && item.fields && typeof item.fields === "object") ? item.fields : {};
    const itemTypedFields = (item && item.typedFields && typeof item.typedFields === "object") ? item.typedFields : {};
    const groupPipeline = (item && item.groupPipeline && typeof item.groupPipeline === "object") ? item.groupPipeline : {};
    const taskTemplateInfo = (state.taskContext && state.taskContext.template_info && typeof state.taskContext.template_info === "object")
      ? state.taskContext.template_info
      : {};
    const schemaRules = (taskSchema && taskSchema.rules && typeof taskSchema.rules === "object") ? taskSchema.rules : {};
    const infoFields = resolveInfoFields(schemaRules);

    const fieldByKey = new Map();
    schemaColumns.forEach((col) => {
      const key = String((col && col.key) || "").trim();
      if (!key) return;
      fieldByKey.set(key, col);
    });
    const schemaGroups = resolveSchemaGroups(schemaColumns, schemaGroupsRaw);

    const groupHtml = schemaGroups.map((group, idx) => {
      const groupName = String(group.name || "").trim() || `分组${idx + 1}`;
      const columns = Array.isArray(group.columns) ? group.columns : [];
      const rows = columns
        .map((col) => {
          const key = String((col && col.key) || "").trim();
          return fieldByKey.get(key) || col;
        })
        .map((col) => renderSourceFieldRow({
          col,
          itemFields,
          itemTypedFields,
          fieldPipeline,
          schemaRules,
        }))
        .filter(Boolean)
        .join("");
      const groupState = groupPipeline[groupName] && typeof groupPipeline[groupName] === "object" ? groupPipeline[groupName] : null;
      const groupStatus = String((groupState && groupState.status) || "").trim() || "waiting";
      const groupSummary = groupState
        ? `parsed ${Number(groupState.parsed || 0)} / warning ${Number(groupState.warning || 0)} / failed ${Number(groupState.failed || 0)}`
        : "";
      const sourceGroupScope = `source:${item.id || item.fileName || ""}`;
      const groupKey = `${sourceGroupScope}:${idx}:${groupName}`;
      const collapsed = !!state.sourceFieldGroupCollapsed[groupKey];
      const toggleHtml = `<button type="button" class="source-recog-group-toggle" data-group-toggle="1" data-group-key="${escapeAttr(groupKey)}" aria-expanded="${collapsed ? "false" : "true"}" title="${collapsed ? "展开" : "收起"}">${collapsed ? "▶" : "▼"}</button>`;
      return `
        <div class="source-recog-group ${collapsed ? "is-collapsed" : ""}">
          <div class="source-recog-group-title">
            ${toggleHtml}
            <span class="source-recog-group-title-text">${escapeHtml(groupName)}</span>
            <span class="source-group-status source-group-status-${escapeAttr(groupStatus)}">${escapeHtml(groupStatus)}</span>
            ${groupSummary ? `<span class="source-group-summary">${escapeHtml(groupSummary)}</span>` : ""}
          </div>
          ${collapsed ? "" : `<div class="source-recog-block source-recog-block-formatted"><table class="source-recog-block-table source-field-table"><tbody>${rows || '<tr><td class="source-recog-empty">（空）</td><td></td></tr>'}</tbody></table></div>`}
        </div>
      `;
    }).join("");

    const sourceName = String(item.sourceFileName || item.fileName || "").trim();
    const rowText = item.isRecordRow ? `行 ${Number(item.rowNumber || 0) || 1}` : "待拆行";
    const sourceGroupScope = `source:${item.id || item.fileName || ""}`;
    const infoGroupHtml = infoFields.length
      ? (() => {
        const infoGroupTitle = "基础信息";
        const infoGroupKey = `${sourceGroupScope}:info:${infoGroupTitle}`;
        const infoCollapsed = !!state.sourceFieldGroupCollapsed[infoGroupKey];
        const infoToggleHtml = `<button type="button" class="source-recog-group-toggle" data-group-toggle="1" data-group-key="${escapeAttr(infoGroupKey)}" aria-expanded="${infoCollapsed ? "false" : "true"}" title="${infoCollapsed ? "展开" : "收起"}">${infoCollapsed ? "▶" : "▼"}</button>`;
        const infoRowsHtml = infoFields.map((field) => {
          const value = String(taskTemplateInfo[field.key] || "").trim();
          return `
            <tr class="source-field-row">
              <td class="source-field-col-key">${escapeHtml(field.label)}</td>
              <td class="source-field-col-value"><span class="source-field-value ${value ? "" : "source-recog-empty"}">${value ? escapeHtml(value) : "（空）"}</span></td>
            </tr>
          `;
        }).join("");
        return `
          <div class="source-recog-group ${infoCollapsed ? "is-collapsed" : ""}">
            <div class="source-recog-group-title">
              ${infoToggleHtml}
              <span class="source-recog-group-title-text">${escapeHtml(infoGroupTitle)}</span>
            </div>
            ${infoCollapsed ? "" : `<div class="source-recog-block source-recog-block-formatted"><table class="source-recog-block-table source-field-table"><tbody>${infoRowsHtml}</tbody></table></div>`}
          </div>
        `;
      })()
      : "";
    el.innerHTML = `
      <div class="source-recog-group">
        <div class="source-recog-group-title">
          <span class="source-recog-group-title-text">模板字段分组识别</span>
          <span class="source-group-summary">${escapeHtml(sourceName)} / ${escapeHtml(rowText)}</span>
        </div>
      </div>
      ${infoGroupHtml}
      ${groupHtml || '<div class="source-recog-block">模板分组未定义</div>'}
    `;
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
    const templateFields = (resolved && Array.isArray(resolved.fields)) ? resolved.fields : [];
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
          return `
              <label class="source-form-item slot-field wide">
                <div class="measurement-toolbar">
                  <span class="measurement-toolbar-hint">多选模式下该字段不可批量一键处理，请逐条检查</span>
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
      return `<td><input type="text" ${colAttrs.join(" ")} value="${escapeAttr(cell)}" /></td>`;
    }).join("")}
            </tr>
          `).join("");
        return `
            <label class="source-form-item slot-field wide ${isProblem ? "is-problem" : ""}">
              <span>${escapeHtml(field.label)}</span>
              <div class="measurement-toolbar">
                <span class="measurement-toolbar-hint">已识别信息已自动带入；可直接编辑修正</span>
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
      const signatureRoleByField = {
        inspector_sign_image: "inspector",
        reviewer_sign_image: "reviewer",
        approver_sign_image: "approver",
      };
      const signatureRole = signatureRoleByField[String(field.key || "")] || "";
      const dynamicSignatureOptions = signatureRole
        ? Array.from(new Set((Array.isArray(state.signatures) ? state.signatures : [])
          .filter((x) => {
            const role = String((x && x.role) || "").trim();
            return !role || role === signatureRole;
          })
          .map((x) => String((x && x.name) || "").trim())
          .filter(Boolean)))
        : [];
      const mergedOptions = Array.isArray(field.options) && field.options.length
        ? field.options
        : dynamicSignatureOptions;
      const hasOptions = Array.isArray(mergedOptions) && mergedOptions.length > 0;
      if (hasOptions) {
        const dataListId = `target-options-${String(item.id || "").replace(/[^a-zA-Z0-9_-]/g, "_")}-${String(field.key || "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        const optionsHtml = mergedOptions
          .map((option) => `<option value="${escapeAttr(String(option || ""))}"></option>`)
          .join("");
        return `
          <label class="source-form-item slot-field ${isProblem ? "is-problem" : ""}">
            <span>${escapeHtml(field.label)}</span>
            <input type="text" class="${isProblem ? "is-problem" : ""}" data-field="${escapeAttr(field.key)}" value="${escapeAttr(value)}" list="${escapeAttr(dataListId)}" placeholder="${isMixed ? MULTI_EDIT_MIXED_PLACEHOLDER : ""}" />
            <datalist id="${escapeAttr(dataListId)}">${optionsHtml}</datalist>
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
    const controlsHtml = templateFields.map((field) => renderFieldControl(field)).join("");
    const groupTitle = "模板字段";
    const groupKey = `${targetGroupScope}:0:${groupTitle}`;
    const collapsed = !!state.targetFieldGroupCollapsed[groupKey];
    const toggleHtml = `<button type="button" class="source-recog-group-toggle" data-group-toggle="1" data-group-key="${escapeAttr(groupKey)}" aria-expanded="${collapsed ? "false" : "true"}" title="${collapsed ? "展开" : "收起"}">${collapsed ? "▶" : "▼"}</button>`;
    const groupedHtml = controlsHtml ? `
        <div class="source-recog-group ${collapsed ? "is-collapsed" : ""}">
          <div class="source-recog-group-title">
            ${toggleHtml}
            <span class="source-recog-group-title-text">${escapeHtml(groupTitle)}</span>
          </div>
          ${collapsed ? "" : `<div class="source-form-grid">${controlsHtml}</div>`}
        </div>
      ` : "";

    const noteParts = [];
    if (noteTextBase) noteParts.push(noteTextBase);
    if (loading) noteParts.push("模板字段加载中...");
    if (note) noteParts.push(note);
    const noteText = noteParts.join(" ");
    if (!templateFields.length) {
      const emptyMessage = loading ? "模板字段加载中..." : (note || "模板字段未加载");
      $("targetFieldForm").innerHTML = `<div class="placeholder">${escapeHtml(emptyMessage)}</div>`;
      return;
    }

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
