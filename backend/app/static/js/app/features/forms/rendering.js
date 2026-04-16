import { createSourceFieldComponents } from "../components/source-field/index.js";
import { createBooleanFieldControlRenderer } from "../components/target-field/renderers/boolean-field-control.js";
import { createDateFieldControlRenderer } from "../components/target-field/renderers/date-field-control.js";
import { resolveFieldDefaultValue } from "../shared/field-default-value-policy.js";
import { normalizeDisplayText } from "../shared/field-display-utils.js";
import { getSignatureImageUrlByValue, getSignatureRoleForField, listSignatureNamesByRole } from "../shared/signature-field-utils.js";
import { getTemplateInfoValue } from "../shared/template-info-utils.js";
import { resolveSchemaFieldLabel } from "../shared/schema-field-meta-utils.js";

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
    getFieldSuggestion,
    formatSuggestionLabel,
    escapeHtml,
    escapeAttr,
  } = deps;
  const {
    resolveDisplayFieldState,
    resolveSchemaGroups,
    resolveInfoFields,
    renderSourceFieldRow,
  } = createSourceFieldComponents({
    escapeHtml,
    escapeAttr,
    parseDateParts,
    getSignatureImageUrl: (name) => getSignatureImageUrlByValue(state.signatures, name),
  });
  const { renderBooleanFieldControl } = createBooleanFieldControlRenderer({
    escapeAttr,
    escapeHtml,
  });
  const { renderDateFieldControl } = createDateFieldControlRenderer({
    escapeAttr,
    escapeHtml,
    parseDateParts,
    mixedPlaceholder: MULTI_EDIT_MIXED_PLACEHOLDER,
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

    const taskTemplateInfo = (state.taskContext && state.taskContext.template_info && typeof state.taskContext.template_info === "object")
      ? state.taskContext.template_info
      : {};
    const sourceFields = (item && item.fields && typeof item.fields === "object") ? item.fields : {};
    if (!String(sourceFields.record_no || "").trim() && String(taskTemplateInfo.record_no || "").trim()) {
      sourceFields.record_no = String(taskTemplateInfo.record_no || "").trim();
    }
    if (!String(taskTemplateInfo.record_no || "").trim() && String(sourceFields.record_no || "").trim()) {
      taskTemplateInfo.record_no = String(sourceFields.record_no || "").trim();
      if (state.taskContext && typeof state.taskContext === "object") {
        state.taskContext.template_info = taskTemplateInfo;
      }
    }
    const schemaRules = (taskSchema && taskSchema.rules && typeof taskSchema.rules === "object") ? taskSchema.rules : {};
    const infoFields = resolveInfoFields(schemaRules);

    const fieldByKey = new Map();
    schemaColumns.forEach((col) => {
      const key = String((col && col.key) || "").trim();
      if (!key) return;
      fieldByKey.set(key, col);
    });
    const schemaGroups = resolveSchemaGroups(schemaColumns, schemaGroupsRaw);
    const {
      itemFields,
      itemTypedFields,
      fieldPipeline,
      groupPipeline,
    } = resolveDisplayFieldState({
      item,
      schemaColumns,
      schemaGroups,
      schemaRules,
    });

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
          ${collapsed ? "" : `<div class="source-recog-block source-recog-block-formatted"><table class="source-recog-block-table source-field-table"><tbody>${rows || '<tr><td class="source-recog-empty"></td><td></td></tr>'}</tbody></table></div>`}
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
          const value = getTemplateInfoValue({
            item,
            taskTemplateInfo,
            key: field.key,
            schemaRules,
          });
          return `
            <tr class="source-field-row">
              <td class="source-field-col-key">${escapeHtml(field.label)}</td>
              <td class="source-field-col-value"><span class="source-field-value ${value ? "" : "source-recog-empty"}">${value ? escapeHtml(value) : ""}</span></td>
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
    const signDateKeys = [
      "inspector_sign_date",
      "reviewer_sign_date",
      "approver_sign_date",
      "company_sign_date",
    ];
    const formatTodayCnDate = () => {
      const now = new Date();
      if (Number.isNaN(now.getTime())) return "";
      const y = String(now.getFullYear()).padStart(4, "0");
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return `${y}年${m}月${d}日`;
    };
    const ensureDefaultSignDates = (fieldsObj) => {
      if (!fieldsObj || typeof fieldsObj !== "object") return;
      const todayText = formatTodayCnDate();
      if (!todayText) return;
      signDateKeys.forEach((key) => {
        if (String(fieldsObj[key] || "").trim()) return;
        fieldsObj[key] = todayText;
      });
    };
    ensureDefaultSignDates(f);
    if (isMultiMode) {
      multiItems.forEach((row) => {
        if (!row || typeof row !== "object") return;
        if (!row.fields || typeof row.fields !== "object") row.fields = createEmptyFields();
        ensureDefaultSignDates(row.fields);
      });
    }
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
    const taskTemplateInfo = (state.taskContext && state.taskContext.template_info && typeof state.taskContext.template_info === "object")
      ? state.taskContext.template_info
      : {};
    const taskSchema = (state.taskContext && state.taskContext.import_template_schema && typeof state.taskContext.import_template_schema === "object")
      ? state.taskContext.import_template_schema
      : { columns: [] };
    const taskSchemaRules = (taskSchema && taskSchema.rules && typeof taskSchema.rules === "object")
      ? taskSchema.rules
      : {};
    const infoFields = resolveInfoFields(taskSchemaRules);
    const schemaColumns = Array.isArray(taskSchema.columns) ? taskSchema.columns : [];
    const parseAppendixRowsText = (valueText) => String(valueText || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => String(line || "").trim())
      .filter(Boolean)
      .map((line, idx) => {
        const parts = line.includes("\t")
          ? line.split("\t")
          : line.split(",").map((x) => String(x || "").trim());
        return {
          rowNo: idx + 1,
          serialNo: String(parts[0] || "").trim(),
          makerCode: String(parts[1] || "").trim(),
          nextDate: String(parts[2] || "").trim(),
        };
      })
      .filter((x) => x.serialNo || x.makerCode || x.nextDate);
    const getFieldView = (fieldKey) => {
      if (isMultiMode) {
        const merged = getSharedFieldValue(multiItems, fieldKey);
        if (merged === null) return { value: "", mixed: true };
        return { value: normalizeDisplayText(merged), mixed: false };
      }
      const currentValue = normalizeDisplayText(f[fieldKey]);
      if (currentValue && !/undefined/i.test(currentValue)) return { value: currentValue, mixed: false };
      return { value: "", mixed: false };
    };
    const renderFloatingMemoryHint = (label) => label
      ? `<span class="field-memory-floating-hint" aria-hidden="true">Tab 使用上次：${escapeHtml(label)}</span>`
      : "";
    const shouldShowSuggestion = (value, isMixed = false) => !!String(value || "").trim() && !isMixed;
    const renderTextControlWithHint = ({ fieldKey, value, placeholder, isProblem, suggestionLabel, listId = "" }) => `
          <label class="source-form-item slot-field ${isProblem ? "is-problem" : ""}">
            <span>${escapeHtml(fieldKey.label)}</span>
            <span class="field-memory-inline-wrap">
              <input type="text" class="${isProblem ? "is-problem" : ""}" data-field="${escapeAttr(fieldKey.key)}" value="${escapeAttr(value)}" ${listId ? `list="${escapeAttr(listId)}"` : ""} placeholder="${escapeAttr(placeholder)}" />
              ${renderFloatingMemoryHint(suggestionLabel)}
            </span>
          </label>
        `;
    const renderFieldControl = (field) => {
      const fieldView = getFieldView(field.key);
      let value = normalizeDisplayText(fieldView.value);
      const isMixed = !!fieldView.mixed;
      const fieldKey = String(field.key || "").trim();
      const fieldLabel = String(field.label || "").trim();
      const defaultValue = resolveFieldDefaultValue({ field, value, isMixed });
      if (defaultValue) {
        value = defaultValue;
        if (!item.fields || typeof item.fields !== "object") item.fields = createEmptyFields();
        item.fields[fieldKey] = defaultValue;
      }
      const isProblem = problemKeys.has(field.key);
      const fieldSuggestion = isMultiMode ? "" : getFieldSuggestion(field.key, value);
      const fieldSuggestionLabel = shouldShowSuggestion(value, isMixed) ? formatSuggestionLabel(fieldSuggestion) : "";
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
              <input type="text" data-field="basis_standard_item" data-index="${idx}" value="${escapeAttr(itemValue)}" placeholder="${escapeAttr(isMultiMode ? "" : getFieldSuggestion("basis_standard_item", itemValue))}" />
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
              ${String(f.basis_standard || "").trim() && fieldSuggestionLabel ? `<div class="field-memory-hint">Tab 使用上次：${escapeHtml(fieldSuggestionLabel)}</div>` : ""}
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
      const cellSuggestion = isMultiMode ? "" : getFieldSuggestion(`measurement_item_cell:${colIdx}`, cell);
      return `<td><input type="text" ${colAttrs.join(" ")} value="${escapeAttr(cell)}" placeholder="${escapeAttr(cellSuggestion)}" /></td>`;
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
      if (field.key === "appendix1_rows_text") {
        const normalizeToIsoDate = (raw) => {
          const text = String(raw || "").trim();
          if (!text) return "";
          let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
          if (m) {
            const mm = String(Number(m[2] || 0)).padStart(2, "0");
            const dd = String(Number(m[3] || 0)).padStart(2, "0");
            return `${m[1]}-${mm}-${dd}`;
          }
          m = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
          if (m) {
            const mm = String(Number(m[2] || 0)).padStart(2, "0");
            const dd = String(Number(m[3] || 0)).padStart(2, "0");
            return `${m[1]}-${mm}-${dd}`;
          }
          return "";
        };
        const pickNonEmpty = (rowFields, keys) => {
          const src = (rowFields && typeof rowFields === "object") ? rowFields : {};
          for (const key of keys) {
            const text = String(src[key] || "").trim();
            if (text) return text;
          }
          return "";
        };
        const findSchemaKeyByLabel = (patterns = []) => {
          const cols = Array.isArray(schemaColumns) ? schemaColumns : [];
          for (const col of cols) {
            const key = String((col && col.key) || "").trim();
            const label = resolveSchemaFieldLabel({
              key,
              label: String((col && col.label) || "").trim(),
              schemaRules: taskSchemaRules,
            });
            if (!key || !label) continue;
            if (patterns.some((p) => label.includes(p))) return key;
          }
          return "";
        };
        const serialFromLabelKey = findSchemaKeyByLabel(["气瓶编号", "出厂编号", "瓶号"]);
        const makerFromLabelKey = findSchemaKeyByLabel(["制造单位代码", "制造单位代号", "制造单位", "制造代码"]);
        const nextFromLabelKey = findSchemaKeyByLabel(["下次检验日期", "下次检验", "下检日期"]);
        const serialCandidates = [serialFromLabelKey, "factory_serial_no", "serial_no", "device_code", "col_05"].filter(Boolean);
        const makerCandidates = [makerFromLabelKey, "manufacturer_code", "maker_code", "manufacturer", "col_04"].filter(Boolean);
        const nextCandidates = [nextFromLabelKey, "next_inspection_date", "next_check_date", "col_33"].filter(Boolean);
        const derivedRows = multiItems.map((row, idx) => {
          const rowFields = (row && row.fields && typeof row.fields === "object") ? row.fields : {};
          const rowNo = Number(row && row.rowNumber) || idx + 1;
          const serialNo = pickNonEmpty(rowFields, serialCandidates);
          const makerCode = pickNonEmpty(rowFields, makerCandidates);
          const nextDate = normalizeToIsoDate(pickNonEmpty(rowFields, nextCandidates));
          return { rowNo, serialNo, makerCode, nextDate };
        }).filter((x) => x.serialNo || x.makerCode || x.nextDate);
        const existingRows = parseAppendixRowsText(fieldView.value).map((x, idx) => ({
          rowNo: idx + 1,
          serialNo: String(x.serialNo || "").trim(),
          makerCode: String(x.makerCode || "").trim(),
          nextDate: normalizeToIsoDate(x.nextDate),
        }));
        const appendixRows = derivedRows.length ? derivedRows : existingRows;
        const appendixValue = appendixRows.map((x) => [x.serialNo, x.makerCode, x.nextDate].join("\t")).join("\n");
        if (!item.fields || typeof item.fields !== "object") item.fields = createEmptyFields();
        item.fields.appendix1_rows_text = appendixValue;
        if (isMultiMode) {
          multiItems.forEach((row) => {
            if (!row || typeof row !== "object") return;
            if (!row.fields || typeof row.fields !== "object") row.fields = createEmptyFields();
            row.fields.appendix1_rows_text = appendixValue;
          });
        }
        const tableHead = `
          <tr>
            <th style="width:52px;">#</th>
            <th>气瓶编号</th>
            <th>制造单位代码</th>
            <th>下次检验日期</th>
          </tr>
        `;
        const tableBody = appendixRows.map((x) => `
          <tr data-appendix-row="${x.rowNo}">
            <td>${x.rowNo}</td>
            <td><input type="text" data-field="appendix1_cell" data-col="serial_no" value="${escapeAttr(x.serialNo)}" placeholder="气瓶编号" /></td>
            <td><input type="text" data-field="appendix1_cell" data-col="maker_code" value="${escapeAttr(x.makerCode)}" placeholder="制造单位代码" /></td>
            <td>
              <span class="target-date-grid">
                <input type="text" class="target-date-input target-date-year" data-field="appendix1_cell_date_part" data-col="next_date" data-part="year" value="${escapeAttr((parseDateParts(x.nextDate) || {}).year || "")}" maxlength="4" placeholder="YYYY" />
                <span class="target-date-unit">年</span>
                <input type="text" class="target-date-input target-date-month" data-field="appendix1_cell_date_part" data-col="next_date" data-part="month" value="${escapeAttr((parseDateParts(x.nextDate) || {}).month || "")}" maxlength="2" placeholder="MM" />
                <span class="target-date-unit">月</span>
                <input type="text" class="target-date-input target-date-day" data-field="appendix1_cell_date_part" data-col="next_date" data-part="day" value="${escapeAttr((parseDateParts(x.nextDate) || {}).day || "")}" maxlength="2" placeholder="DD" />
                <span class="target-date-unit">日</span>
              </span>
            </td>
          </tr>
        `).join("");
        return `
          <label class="source-form-item slot-field wide ${isProblem ? "is-problem" : ""}">
            <span>${escapeHtml(field.label)}</span>
            <div class="source-recog-block source-recog-block-formatted">
              <table class="source-recog-block-table schema-record-table schema-record-table--appendix">
                <thead>${tableHead}</thead>
                <tbody>${tableBody || '<tr><td></td><td></td><td></td><td></td></tr>'}</tbody>
              </table>
            </div>
            <textarea data-field="${escapeAttr(field.key)}" style="display:none;" rows="1">${escapeHtml(appendixValue)}</textarea>
          </label>
        `;
      }
      if (fieldKey === "selected_rows" || fieldKey === "cylinder_total_count") {
        const selectedCount = Math.max(1, (isMultiMode ? multiItems.length : 1));
        const autoValue = String(selectedCount);
        if (!item.fields || typeof item.fields !== "object") item.fields = createEmptyFields();
        item.fields[fieldKey] = autoValue;
        if (fieldKey !== "selected_rows") item.fields.selected_rows = autoValue;
        if (fieldKey !== "cylinder_total_count") item.fields.cylinder_total_count = autoValue;
        if (isMultiMode) {
          multiItems.forEach((row) => {
            if (!row || typeof row !== "object") return;
            if (!row.fields || typeof row.fields !== "object") row.fields = createEmptyFields();
            row.fields[fieldKey] = autoValue;
            if (fieldKey !== "selected_rows") row.fields.selected_rows = autoValue;
            if (fieldKey !== "cylinder_total_count") row.fields.cylinder_total_count = autoValue;
          });
        }
        return `
          <label class="source-form-item slot-field ${isProblem ? "is-problem" : ""}">
            <span>${escapeHtml(field.label)}</span>
            <input type="text" data-field="${escapeAttr(fieldKey)}" value="${escapeAttr(autoValue)}" readonly />
          </label>
        `;
      }
      const isDateField = [
        "manufacture_date",
        "last_inspection_date",
        "next_inspection_date",
        "receive_date",
        "calibration_date",
        "release_date",
        "inspector_sign_date",
        "reviewer_sign_date",
        "approver_sign_date",
        "company_sign_date",
      ].includes(fieldKey)
        || ["制造年月", "上次检验日期", "下次检验日期", "收样日期", "校准日期", "发布日期"].includes(fieldLabel);
      if (isDateField) {
        const dateSuggestion = shouldShowSuggestion(value, isMixed) && !isMultiMode ? getFieldSuggestion(fieldKey, value) : "";
        return renderDateFieldControl({
          fieldKey,
          fieldLabel,
          value,
          isProblem,
          isMixed,
          suggestion: dateSuggestion,
        });
      }
      if (field.multiline) {
        const rows = Number(field.rows || 3);
        return `
            <label class="source-form-item slot-field wide ${isProblem ? "is-problem" : ""}">
              <span>${escapeHtml(field.label)}</span>
              <span class="field-memory-inline-wrap field-memory-inline-wrap-textarea">
                <textarea class="${isProblem ? "is-problem" : ""}" data-field="${escapeAttr(field.key)}" rows="${rows}" placeholder="${escapeAttr(isMixed ? MULTI_EDIT_MIXED_PLACEHOLDER : fieldSuggestion)}">${escapeHtml(value)}</textarea>
                ${renderFloatingMemoryHint(fieldSuggestionLabel)}
              </span>
            </label>
          `;
      }
      const booleanFieldKeys = Array.isArray(item && item.booleanFieldKeys) ? item.booleanFieldKeys : [];
      const normalizedValue = String(value || "").trim().toLowerCase();
      const isBooleanField = booleanFieldKeys.includes(fieldKey)
        || normalizedValue === "true"
        || normalizedValue === "false";
      if (isBooleanField) {
        const booleanSuggestion = normalizedValue && !isMultiMode ? getFieldSuggestion(fieldKey, normalizedValue) : "";
        return renderBooleanFieldControl({
          fieldKey,
          fieldLabel: field.label,
          checked: normalizedValue === "true",
          isProblem,
          suggestionLabel: formatSuggestionLabel(booleanSuggestion, "boolean"),
        });
      }
      const signatureRole = getSignatureRoleForField(field.key);
      const dynamicSignatureOptions = signatureRole
        ? listSignatureNamesByRole(state.signatures, signatureRole)
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
            <span class="field-memory-inline-wrap">
              <input type="text" class="${isProblem ? "is-problem" : ""}" data-field="${escapeAttr(field.key)}" value="${escapeAttr(value)}" list="${escapeAttr(dataListId)}" placeholder="${escapeAttr(isMixed ? MULTI_EDIT_MIXED_PLACEHOLDER : fieldSuggestion)}" />
              ${renderFloatingMemoryHint(fieldSuggestionLabel)}
            </span>
            <datalist id="${escapeAttr(dataListId)}">${optionsHtml}</datalist>
          </label>
        `;
      }
      return renderTextControlWithHint({
        fieldKey: { key: field.key, label: field.label },
        value,
        placeholder: isMixed ? MULTI_EDIT_MIXED_PLACEHOLDER : fieldSuggestion,
        isProblem,
        suggestionLabel: fieldSuggestionLabel,
      });
    };

    const targetGroupScope = `target:${item.id || item.fileName || ""}`;
    const templateInfoControlsHtml = isMultiMode
      ? ""
      : infoFields.map((field) => {
        const fieldKey = String((field && field.key) || "").trim();
        const fieldLabel = String((field && field.label) || "").trim();
        const value = String(taskTemplateInfo[fieldKey] || "").trim();
        const suggestion = shouldShowSuggestion(value) ? getFieldSuggestion(fieldKey, value) : "";
        const suggestionLabel = shouldShowSuggestion(value) ? formatSuggestionLabel(suggestion) : "";
        return `
          <label class="source-form-item slot-field">
            <span>${escapeHtml(fieldLabel)}</span>
            <span class="field-memory-inline-wrap">
              <input type="text" data-template-info="${escapeAttr(fieldKey)}" value="${escapeAttr(value)}" placeholder="${escapeAttr(suggestion)}" />
              ${renderFloatingMemoryHint(suggestionLabel)}
            </span>
          </label>
        `;
      }).join("");
    const appendixFieldKeySet = new Set(["appendix1_rows_text"]);
    const reportBodyPreferredKeys = new Set([
      "report_owner_name",
      "ownership_code",
      "inspect_standard",
      "gas_type",
      "filling_medium",
      "selected_rows",
      "cylinder_total_count",
      "qualified_count",
      "valve_replaced_count",
      "valve_vendor_name",
      "scrap_count",
      "report_date",
      "submit_org_name",
    ]);
    const appendixFields = templateFields.filter((field) => appendixFieldKeySet.has(String((field && field.key) || "").trim()));
    const reportBodyFields = templateFields.filter((field) => {
      const key = String((field && field.key) || "").trim();
      if (!key || appendixFieldKeySet.has(key)) return false;
      return reportBodyPreferredKeys.has(key);
    });
    const signoffFields = templateFields.filter((field) => {
      const key = String((field && field.key) || "").trim();
      if (!key || appendixFieldKeySet.has(key)) return false;
      return !reportBodyPreferredKeys.has(key);
    });
    const renderFieldGroup = (groupTitle, fields, groupIndex, extraHtml = "") => {
      const controlsHtml = fields.map((field) => renderFieldControl(field)).join("");
      if (!controlsHtml && !extraHtml) return "";
      const groupKey = `${targetGroupScope}:${groupIndex}:${groupTitle}`;
      const collapsed = !!state.targetFieldGroupCollapsed[groupKey];
      const toggleHtml = `<button type="button" class="source-recog-group-toggle" data-group-toggle="1" data-group-key="${escapeAttr(groupKey)}" aria-expanded="${collapsed ? "false" : "true"}" title="${collapsed ? "展开" : "收起"}">${collapsed ? "▶" : "▼"}</button>`;
      const bodyHtml = `${controlsHtml ? `<div class="source-form-grid">${controlsHtml}</div>` : ""}${extraHtml || ""}`;
      return `
        <div class="source-recog-group ${collapsed ? "is-collapsed" : ""}">
          <div class="source-recog-group-title">
            ${toggleHtml}
            <span class="source-recog-group-title-text">${escapeHtml(groupTitle)}</span>
          </div>
          ${collapsed ? "" : bodyHtml}
        </div>
      `;
    };
    const groupedHtml = [
      renderFieldGroup("基础信息", [], -1, templateInfoControlsHtml ? `<div class="source-form-grid">${templateInfoControlsHtml}</div>` : ""),
      renderFieldGroup("报告正文字段", reportBodyFields, 0, ""),
      renderFieldGroup("签字与落款字段", signoffFields, 1, ""),
      renderFieldGroup("附件一字段", appendixFields, 2, ""),
    ].filter(Boolean).join("");

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
