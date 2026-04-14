import { buildRowRecordsFromTableCells } from "./table-slot-parser.js";

export function createRecognitionWorkflowFeature(deps = {}) {
  const {
    state,
    isExcelItem,
    createEmptyFields,
    uploadFile,
    runExcelInspect,
    buildExcelRecordItems,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    runOcr,
    extFromName,
    splitRecordBlocks,
    runInstrumentTableExtract,
    appendLog,
    runGeneralCheckStructureExtract,
    runExtract,
    applyStructuredMeasurementItems,
    inferCategory,
    extractTemplateCode,
    buildCategoryMessage,
    resolveSourceCode,
    buildMultiDeviceWordItems,
  } = deps;

  const DATA_ROW_RE = /^\s*[zZ]?\d{1,2}(?:\s*[./-]\s*\d{1,2})?\b/;

  function getSchemaColumns() {
    const schema = (state.taskContext && state.taskContext.import_template_schema && typeof state.taskContext.import_template_schema === "object")
      ? state.taskContext.import_template_schema
      : { columns: [] };
    return Array.isArray(schema.columns) ? schema.columns : [];
  }

  function getSchemaRules() {
    const schema = (state.taskContext && state.taskContext.import_template_schema && typeof state.taskContext.import_template_schema === "object")
      ? state.taskContext.import_template_schema
      : { rules: {} };
    const rules = (schema && typeof schema.rules === "object" && schema.rules) ? schema.rules : {};
    return rules;
  }

  function splitTableDataLines(rawText, rules = {}) {
    const lines = String(rawText || "")
      .split(/\r?\n/)
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    if (!lines.length) return [];
    const rowRules = (rules && typeof rules.row_rules === "object" && rules.row_rules) ? rules.row_rules : {};
    const minTokens = Number(rowRules.min_tokens || 6);
    const hasDateToken = (line) => /(?:^|\s)[zZ]?\d{1,2}\s*[./-]\s*\d{1,2}\b/.test(String(line || ""));
    const isWeakRowLike = (line) => {
      const tokens = String(line || "").split(/\s+/).filter(Boolean);
      if (tokens.length < minTokens) return false;
      const numericish = tokens.filter((t) => /[\d]/.test(t)).length;
      return numericish >= Math.max(3, Math.floor(minTokens / 3));
    };

    const firstDataIdx = lines.findIndex((line) => DATA_ROW_RE.test(line) || hasDateToken(line));
    if (firstDataIdx >= 0) {
      const rows = [];
      for (let i = firstDataIdx; i < lines.length; i += 1) {
        const line = lines[i];
        if (DATA_ROW_RE.test(line) || hasDateToken(line) || isWeakRowLike(line)) {
          rows.push(line);
          continue;
        }
        if (rows.length) break;
      }
      if (rows.length) return rows;
    }

    const dataOnly = lines.filter((line) => {
      if (!(DATA_ROW_RE.test(line) || hasDateToken(line))) return false;
      const tokens = line.split(/\s+/).filter(Boolean);
      return tokens.length >= minTokens;
    });
    if (dataOnly.length) return dataOnly;
    return [];
  }

  function mapLineToSchemaFields(line, columns, rules = {}) {
    const cols = Array.isArray(columns) ? columns : [];
    const rawLine = String(line || "").trim();
    const fieldRules = (rules && typeof rules.field_rules === "object" && rules.field_rules) ? rules.field_rules : {};
    const getFieldRule = (label, key) => {
      const byLabel = fieldRules[String(label || "").trim()];
      if (byLabel && typeof byLabel === "object") return byLabel;
      const byKey = fieldRules[String(key || "").trim()];
      return byKey && typeof byKey === "object" ? byKey : {};
    };
    const detectValveSelection = (rule = {}) => {
      const choices = Array.isArray(rule.choices) ? rule.choices : [];
      const matched = choices.filter((choice) => {
        const tokens = Array.isArray(choice && choice.tokens) ? choice.tokens : [];
        return tokens.some((token) => {
          const text = String(token || "").trim();
          return text && rawLine.includes(text);
        });
      });
      if (matched.length > 1) return String(rule.multi_label || "").trim() || matched.map((x) => String(x.label || "").trim()).filter(Boolean).join("/");
      if (matched.length === 1) return String((matched[0] && matched[0].label) || "").trim();
      const hasCal = /(校阀|校调|校調|收阀|收调|政调|农调|回校)/i.test(rawLine);
      const hasSwap = /(换阀|換阀|换间|换询|换具|换惘|換間|换网)/i.test(rawLine);
      if (hasCal && hasSwap) return "校阀/换阀";
      if (hasCal) return "校阀";
      if (hasSwap) return "换阀";
      return "";
    };
    const detectDate = () => {
      const m = rawLine.match(/\b([zZ]?\d{1,2})\s*[.\-/、]\s*(\d{1,2})\b/);
      if (!m) return "";
      const mm = String(m[1] || "").replace(/^[zZ]/, "2");
      const dd = String(m[2] || "");
      return `${mm}.${dd}`;
    };
    const normalizeDateToken = (token) => {
      const t = String(token || "").trim();
      if (!t) return "";
      const m = t.match(/([zZ]?\d{1,2})\s*[.\-/、]\s*(\d{1,2})/);
      if (!m) return "";
      const mm = String(m[1] || "").replace(/^[zZ]/, "2");
      const dd = String(m[2] || "");
      return `${mm}.${dd}`;
    };
    const normalizeTextToken = (token, rule = {}) => {
      let t = String(token || "").trim();
      const normalize = (rule && typeof rule.normalize === "object" && rule.normalize) ? rule.normalize : {};
      if (normalize.fullwidth_to_halfwidth) {
        t = t.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248)).replace(/\u3000/g, " ");
      }
      if (normalize.o_to_0) t = t.replace(/[oO]/g, "0");
      if (normalize.l_to_1) t = t.replace(/[lI]/g, "1");
      if (normalize.trim !== false) t = t.trim();
      return t;
    };
    const cleaned = rawLine
      .replace(/(口|回|□|▢)?\s*(校阀|校调|校調|收阀|收调|政调|农调|回校)\s*/gi, " ")
      .replace(/(口|回|□|▢)?\s*(换阀|換阀|换间|换询|换具|换惘|換間|换网)\s*/gi, " ")
      .replace(/[√✓]/g, " V ")
      .replace(/[，,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const mapped = {};
    if (!cols.length || !tokens.length) return mapped;
    const dateText = detectDate();
    const isNumericLikeLabel = (label) => {
      const x = String(label || "");
      return /(MPa|kg|mL|mm|min|%|重量|容积|压力|时间|变形|损失率|壁厚|日期)/i.test(x);
    };
    const normalizeNumericToken = (token) => {
      const t = String(token || "").trim();
      if (!t) return "";
      let x = t
        .replace(/[oO]/g, "0")
        .replace(/[lI]/g, "1")
        .replace(/[，]/g, ".")
        .replace(/。/g, ".")
        .replace(/[^\d.+\-]/g, "");
      if (!x) return "";
      x = x.replace(/^\.+/, "").replace(/\.+$/, "");
      return x;
    };
    const isLikelyOwnerBlankCodeToken = (token) => {
      const t = String(token || "").trim();
      if (!t) return false;
      if (/[0-9\u4e00-\u9fff]/.test(t)) return false;
      return /^[A-Za-z]{1,3}$/.test(t);
    };
    const isMarkerToken = (token) => {
      const t = String(token || "").trim();
      return t === "V" || t === "v" || t === "/" || t === "／" || t === "\\" || t === "＼";
    };
    const cursor = { value: 0 };
    const peekToken = (offset = 0, opts = {}) => {
      const allowMarkers = !!opts.allowMarkers;
      let idx = cursor.value;
      let seen = 0;
      while (idx < tokens.length) {
        const t = String(tokens[idx] || "").trim();
        idx += 1;
        if (!t) continue;
        if (!allowMarkers && isMarkerToken(t)) continue;
        if (seen === offset) return t;
        seen += 1;
      }
      return "";
    };
    const consumeToken = (opts = {}) => {
      const allowMarkers = !!opts.allowMarkers;
      while (cursor.value < tokens.length) {
        const t = String(tokens[cursor.value] || "").trim();
        cursor.value += 1;
        if (!t) continue;
        if (!allowMarkers && isMarkerToken(t)) continue;
        return t;
      }
      return "";
    };
    const scoreTokenForColumn = (token, col, rule = {}) => {
      const value = String(token || "").trim();
      if (!value) return 0;
      const label = String((col && col.label) || "").trim();
      const ruleType = String((rule && rule.type) || "").trim();
      if (ruleType === "optional_blank" || label === "检验员" || label === "审核员") return 0;
      if (ruleType === "checkbox_choice" || label === "瓶阀检验") return 0;
      if (ruleType === "date" || label === "检验日期") return normalizeDateToken(value) ? 4 : 0;
      if (ruleType === "date_or_dash" || label === "上次检验日期") {
        const dashTokens = Array.isArray(rule.dash_tokens) ? rule.dash_tokens.map((x) => String(x || "")).filter(Boolean) : ["/", "／", "\\", "＼"];
        return (normalizeDateToken(value) || dashTokens.includes(value)) ? 4 : 0;
      }
      if (ruleType === "number") return normalizeNumericToken(normalizeTextToken(value, rule)) ? 3 : 0;
      if (ruleType === "text") {
        const normalized = normalizeTextToken(value, rule);
        const choices = Array.isArray(rule.choices) ? rule.choices.map((x) => String((x && x.label) || "").trim()).filter(Boolean) : [];
        if (!choices.length) return normalized ? 1 : 0;
        return choices.includes(normalized) ? 4 : 0;
      }
      if (ruleType === "code" || ruleType === "loose_text" || label === "产权代码编号") {
        const normalized = normalizeTextToken(value, rule);
        if (!normalized) return 0;
        // Owner-code blank is legal; when token clearly belongs to medium choices,
        // prefer leaving this slot empty to avoid left-shifting subsequent columns.
        if ((label === "产权代码编号" || ruleType === "code") && ["Ar", "O2", "N2", "CO2"].includes(normalized)) return 1;
        const pattern = String(rule.pattern || "").trim();
        if (pattern) {
          try {
            return new RegExp(pattern).test(normalized) ? 3 : 0;
          } catch {
            return 1;
          }
        }
        const maxLen = Number(rule.max_len || 16);
        const lim = Number.isFinite(maxLen) ? maxLen : 16;
        return new RegExp(`^[A-Za-z0-9一-龥\\-]{2,${lim}}$`).test(normalized) ? 2 : 0;
      }
      if (isNumericLikeLabel(label)) return normalizeNumericToken(normalizeTextToken(value, rule)) ? 2 : 0;
      return normalizeTextToken(value, rule) ? 1 : 0;
    };
    const findNextConsumableColumn = (startIdx) => {
      for (let i = startIdx; i < cols.length; i += 1) {
        const col = cols[i] || {};
        const key = String(col.key || "").trim();
        const label = String(col.label || "").trim();
        if (!key) continue;
        const rule = getFieldRule(label, key);
        const ruleType = String(rule.type || "").trim();
        if (ruleType === "optional_blank" || label === "检验员" || label === "审核员") continue;
        if (ruleType === "checkbox_choice" || label === "瓶阀检验") continue;
        return { col, rule, index: i };
      }
      return null;
    };
    const shouldReserveBlankSlot = (colIdx, token, currentCol, currentRule, allowMarkers) => {
      const currentScore = scoreTokenForColumn(token, currentCol, currentRule);
      const next = findNextConsumableColumn(colIdx + 1);
      if (!next) return false;
      const nextScore = scoreTokenForColumn(token, next.col, next.rule);
      // If current token has weak compatibility with current slot but strongly
      // matches the next slot, keep current slot blank and do not consume token.
      if (nextScore >= 3 && nextScore > currentScore) {
        const lookahead = peekToken(1, { allowMarkers });
        const lookaheadScore = scoreTokenForColumn(lookahead, currentCol, currentRule);
        if (lookaheadScore >= currentScore) return true;
      }
      return false;
    };
    for (let i = 0; i < cols.length; i += 1) {
      const col = cols[i] || {};
      const key = String(col.key || "").trim();
      const label = String(col.label || "").trim();
      const rule = getFieldRule(label, key);
      const ruleType = String(rule.type || "").trim();
      if (!key) continue;
      if (ruleType === "date" || label === "检验日期") {
        const token = peekToken(0, { allowMarkers: true });
        if (!token || shouldReserveBlankSlot(i, token, col, rule, true)) {
          mapped[key] = dateText || "";
          continue;
        }
        consumeToken({ allowMarkers: true });
        mapped[key] = normalizeDateToken(token) || dateText || "";
        continue;
      }
      if (ruleType === "date_or_dash" || label === "上次检验日期") {
        const token = peekToken(0, { allowMarkers: true });
        if (!token || shouldReserveBlankSlot(i, token, col, rule, true)) {
          mapped[key] = "";
          continue;
        }
        consumeToken({ allowMarkers: true });
        const dashTokens = Array.isArray(rule.dash_tokens) ? rule.dash_tokens.map((x) => String(x || "")).filter(Boolean) : ["/", "／", "\\", "＼"];
        const dashHit = dashTokens.some((mark) => token === mark);
        mapped[key] = dashHit ? "-" : (normalizeDateToken(token) || "");
        continue;
      }
      if (ruleType === "checkbox_choice" || label === "瓶阀检验") {
        mapped[key] = detectValveSelection(rule) || "";
        continue;
      }
      if (ruleType === "optional_blank" || label === "检验员" || label === "审核员") {
        mapped[key] = "";
        continue;
      }
      if (ruleType === "code" || ruleType === "loose_text" || label === "产权代码编号") {
        const token = peekToken();
        if (!token || shouldReserveBlankSlot(i, token, col, rule, false)) {
          mapped[key] = "";
          continue;
        }
        const normalizedPreview = normalizeTextToken(token, rule);
        if (label === "产权代码编号" && isLikelyOwnerBlankCodeToken(normalizedPreview)) {
          mapped[key] = "";
          continue;
        }
        consumeToken();
        const normalized = normalizeTextToken(token, rule);
        const maxLen = Number(rule.max_len || 16);
        const pattern = String(rule.pattern || "").trim();
        if (pattern) {
          const reg = new RegExp(pattern);
          mapped[key] = reg.test(normalized) ? normalized : "";
        } else {
          mapped[key] = new RegExp(`^[A-Za-z0-9一-龥\\-]{2,${Number.isFinite(maxLen) ? maxLen : 16}}$`).test(normalized) ? normalized : "";
        }
        continue;
      }
      const token = peekToken();
      if (!token || shouldReserveBlankSlot(i, token, col, rule, false)) {
        mapped[key] = "";
        continue;
      }
      if (ruleType === "number") {
        consumeToken();
        mapped[key] = normalizeNumericToken(normalizeTextToken(token, rule)) || "";
        continue;
      }
      if (ruleType === "text") {
        const normalized = normalizeTextToken(token, rule);
        const choices = Array.isArray(rule.choices) ? rule.choices.map((x) => String((x && x.label) || "").trim()).filter(Boolean) : [];
        if (choices.length && !choices.includes(normalized)) {
          mapped[key] = "";
          continue;
        }
        consumeToken();
        mapped[key] = normalized;
        continue;
      }
      consumeToken();
      mapped[key] = isNumericLikeLabel(label) ? (normalizeNumericToken(normalizeTextToken(token, rule)) || token) : normalizeTextToken(token, rule);
    }
    return mapped;
  }

  function applySchemaRulesToMappedFields(mappedInput, columns, rules = {}) {
    const cols = Array.isArray(columns) ? columns : [];
    const mapped = (mappedInput && typeof mappedInput === "object") ? mappedInput : {};
    const fieldRules = (rules && typeof rules.field_rules === "object" && rules.field_rules) ? rules.field_rules : {};
    const getFieldRule = (label, key) => {
      const byLabel = fieldRules[String(label || "").trim()];
      if (byLabel && typeof byLabel === "object") return byLabel;
      const byKey = fieldRules[String(key || "").trim()];
      return byKey && typeof byKey === "object" ? byKey : {};
    };
    const normalizeDateToken = (token) => {
      const t = String(token || "").trim();
      if (!t) return "";
      const m = t.match(/([zZ]?\d{1,2})\s*[.\-/、]\s*(\d{1,2})/);
      if (!m) return "";
      const mm = String(m[1] || "").replace(/^[zZ]/, "2");
      const dd = String(m[2] || "");
      return `${mm}.${dd}`;
    };
    const normalizeTextToken = (token, rule = {}) => {
      let t = String(token || "").trim();
      const normalize = (rule && typeof rule.normalize === "object" && rule.normalize) ? rule.normalize : {};
      if (normalize.fullwidth_to_halfwidth) {
        t = t.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248)).replace(/\u3000/g, " ");
      }
      if (normalize.o_to_0) t = t.replace(/[oO]/g, "0");
      if (normalize.l_to_1) t = t.replace(/[lI]/g, "1");
      if (normalize.trim !== false) t = t.trim();
      return t;
    };
    const normalizeNumericToken = (token) => {
      const t = String(token || "").trim();
      if (!t) return "";
      let x = t
        .replace(/[oO]/g, "0")
        .replace(/[lI]/g, "1")
        .replace(/[，]/g, ".")
        .replace(/。/g, ".")
        .replace(/[^\d.+\-]/g, "");
      if (!x) return "";
      x = x.replace(/^\.+/, "").replace(/\.+$/, "");
      return x;
    };
    const output = { ...mapped };
    for (let i = 0; i < cols.length; i += 1) {
      const col = cols[i] || {};
      const key = String(col.key || "").trim();
      const label = String(col.label || "").trim();
      if (!key) continue;
      const rule = getFieldRule(label, key);
      const ruleType = String(rule.type || "").trim();
      const rawValue = String(mapped[key] ?? mapped[label] ?? "").trim();
      if (!rawValue && ruleType !== "optional_blank") {
        output[key] = "";
        continue;
      }

      if (ruleType === "optional_blank" || label === "检验员" || label === "审核员") {
        output[key] = "";
        continue;
      }
      if (ruleType === "date" || label === "检验日期") {
        output[key] = normalizeDateToken(rawValue);
        continue;
      }
      if (ruleType === "date_or_dash" || label === "上次检验日期") {
        const normalized = normalizeDateToken(rawValue);
        output[key] = normalized || (/^[\\/／-]$/.test(rawValue) ? "-" : "");
        continue;
      }
      if (ruleType === "checkbox_choice" || label === "瓶阀检验") {
        const choices = Array.isArray(rule.choices) ? rule.choices : [];
        const labels = choices.map((x) => String((x && x.label) || "").trim()).filter(Boolean);
        output[key] = labels.includes(rawValue) ? rawValue : "";
        continue;
      }
      if (ruleType === "number") {
        output[key] = normalizeNumericToken(rawValue);
        continue;
      }
      if (ruleType === "code" || ruleType === "loose_text" || label === "产权代码编号") {
        const normalized = normalizeTextToken(rawValue, rule);
        const pattern = String(rule.pattern || "").trim();
        const maxLen = Number(rule.max_len || 16);
        if (pattern) {
          output[key] = new RegExp(pattern).test(normalized) ? normalized : "";
        } else {
          const lim = Number.isFinite(maxLen) ? maxLen : 16;
          output[key] = new RegExp(`^[A-Za-z0-9一-龥\\-]{2,${lim}}$`).test(normalized) ? normalized : "";
        }
        continue;
      }
      if (ruleType === "text") {
        const normalized = normalizeTextToken(rawValue, rule);
        const choices = Array.isArray(rule.choices) ? rule.choices.map((x) => String((x && x.label) || "").trim()).filter(Boolean) : [];
        output[key] = choices.length ? (choices.includes(normalized) ? normalized : "") : normalized;
        continue;
      }
      output[key] = normalizeTextToken(rawValue, rule);
    }
    return output;
  }

  function applyCarryForwardRows(rows, columns, rules = {}) {
    const items = Array.isArray(rows) ? rows : [];
    const cols = Array.isArray(columns) ? columns : [];
    const fieldRules = (rules && typeof rules.field_rules === "object" && rules.field_rules) ? rules.field_rules : {};
    const carryCols = cols
      .map((col) => {
        const key = String((col && col.key) || "").trim();
        const label = String((col && col.label) || "").trim();
        const byLabel = fieldRules[label];
        const byKey = fieldRules[key];
        const rule = (byLabel && typeof byLabel === "object") ? byLabel : ((byKey && typeof byKey === "object") ? byKey : {});
        return { key, rule };
      })
      .filter((x) => x.key && String((x.rule && x.rule.empty_strategy) || "").trim() === "carry_forward");
    if (!carryCols.length || !items.length) return;
    const cache = {};
    for (let i = 0; i < items.length; i += 1) {
      const row = items[i];
      if (!row || typeof row !== "object") continue;
      row.fields = row.fields && typeof row.fields === "object" ? row.fields : {};
      row.recognizedFields = row.recognizedFields && typeof row.recognizedFields === "object" ? row.recognizedFields : {};
      for (let j = 0; j < carryCols.length; j += 1) {
        const key = carryCols[j].key;
        const value = String((row.recognizedFields[key] ?? row.fields[key] ?? "")).trim();
        if (value) {
          cache[key] = value;
          continue;
        }
        if (cache[key]) {
          row.fields[key] = cache[key];
          row.recognizedFields[key] = cache[key];
        }
      }
    }
  }

  function waitMs(ms) {
    const n = Number(ms);
    return new Promise((resolve) => setTimeout(resolve, Number.isFinite(n) ? Math.max(0, n) : 0));
  }

  async function replaceSourceWithRowsProgressively(sourceItem, recordRows, stageLabel) {
    const rows = Array.isArray(recordRows) ? recordRows : [];
    const index = state.queue.findIndex((x) => x.id === sourceItem.id);
    if (index < 0) return;
    state.queue.splice(index, 1);
    renderQueue();
    renderTemplateSelect();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row.templateName) await applyAutoTemplateMatch(row, { force: true });
      row.message = `${stageLabel} ${i + 1}/${rows.length}`;
      state.queue.splice(index + i, 0, row);
      if (i === 0) state.activeId = row.id;
      renderQueue();
      renderTemplateSelect();
      await waitMs(26);
    }
  }

  async function processItem(item) {
    const forcedMode = String(item && item.recognitionOverride ? item.recognitionOverride : "").trim().toLowerCase();
    const forceAsExcel = forcedMode === "excel";
    const forceAsWord = forcedMode === "word";
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
    if (forceAsExcel && !isExcelItem(item)) {
      item.status = "processing";
      item.message = "按XLS单条识别中";
      item.reportId = "";
      item.reportDownloadUrl = "";
      item.reportFileName = "";
      item.reportGenerateMode = "";
      item.modeReports = {};
      renderQueue();
      if (!item.fileId) {
        const up = await uploadFile(item.file);
        item.fileId = up.file_id;
      }
      const ocr = await runOcr(item.fileId);
      item.rawText = ocr.raw_text || "";
      item.ocrStructured = (ocr && ocr.structured) || {};
      const fields = await runExtract(item.rawText);
      const mergedFields = {
        ...createEmptyFields(),
        ...fields,
        raw_record: item.rawText || "",
        source_profile: "forced_excel_single",
        source_profile_label: "强制XLS-单条",
      };
      const inspect = {
        records: [
          {
            sheet_name: "FORCED",
            row_number: 1,
            row_name: mergedFields.device_name || mergedFields.device_code || "row_1",
            template_name: "",
            fields: mergedFields,
          },
        ],
      };
      const recordRows = buildExcelRecordItems(item, inspect);
      if (!recordRows.length) {
        item.recordCount = 1;
        item.category = "Excel批量";
        item.status = "error";
        item.message = "按XLS单条识别失败";
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
      appendLog(`强制XLS单条识别完成 ${item.fileName}：${recordRows.length} 条`);
      renderQueue();
      renderTemplateSelect();
      return;
    }
    if (forceAsExcel || isExcelItem(item)) {
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
    item.reportGenerateMode = "";
    item.modeReports = {};
    renderQueue();

    if (!item.fileId) {
      const up = await uploadFile(item.file);
      item.fileId = up.file_id;
    }

    item.message = "识别中";
    renderQueue();
    const ocr = await runOcr(item.fileId);
    item.rawText = ocr.raw_text || "";
    item.ocrStructured = (ocr && ocr.structured) || {};
    const schemaColumns = getSchemaColumns();
    const schemaRules = getSchemaRules();
    const structuredRowsRaw = Array.isArray(item.ocrStructured && item.ocrStructured.row_records)
      ? item.ocrStructured.row_records
      : [];
    const tableCells = Array.isArray(item.ocrStructured && item.ocrStructured.table_cells)
      ? item.ocrStructured.table_cells
      : [];
    let structuredRows = structuredRowsRaw;
    const reviewQueue = Array.isArray(item.ocrStructured && item.ocrStructured.review_queue)
      ? item.ocrStructured.review_queue
      : [];
    if (schemaColumns.length) {
      if (!structuredRows.length && tableCells.length) {
        const builtRows = buildRowRecordsFromTableCells({
          tableCells,
          columns: schemaColumns,
          xLines: [],
        });
        if (Array.isArray(builtRows) && builtRows.length) structuredRows = builtRows;
      }
      if (structuredRows.length) {
        const totalCellCount = Math.max(1, structuredRows.length * Math.max(1, schemaColumns.length));
        let doneCellCount = 0;
        const progressStep = Math.max(1, Math.floor(totalCellCount / 12));
        const recordRows = [];
        for (let idx = 0; idx < structuredRows.length; idx += 1) {
          const rowItem = structuredRows[idx];
          const rowNumber = Number((rowItem && rowItem.row) || 0) || (idx + 1);
          const rowFields = (rowItem && typeof rowItem.fields === "object" && rowItem.fields) ? rowItem.fields : {};
          const rawRecord = String((rowItem && rowItem.raw_record) || "").trim();
          const mapped = {};
          for (let colIdx = 0; colIdx < schemaColumns.length; colIdx += 1) {
            const col = schemaColumns[colIdx];
            const key = String((col && col.key) || "").trim();
            if (!key) {
              doneCellCount += 1;
              continue;
            }
            const colKey = `col_${String(colIdx + 1).padStart(2, "0")}`;
            const label = String((col && col.label) || "").trim();
            mapped[key] = String(rowFields[colKey] || rowFields[label] || "").trim();
            doneCellCount += 1;
            if (doneCellCount === 1 || doneCellCount === totalCellCount || (doneCellCount % progressStep) === 0) {
              item.message = `行列对齐中 ${doneCellCount}/${totalCellCount}`;
              renderQueue();
              await waitMs(0);
            }
          }
          const normalizedMapped = applySchemaRulesToMappedFields(mapped, schemaColumns, schemaRules);
          const mergedFields = { ...createEmptyFields(), ...normalizedMapped, raw_record: rawRecord };
          const firstColKey = String((schemaColumns[0] && schemaColumns[0].key) || "").trim();
          const secondColKey = String((schemaColumns[1] && schemaColumns[1].key) || "").trim();
          const recordName = String(mergedFields[firstColKey] || mergedFields[secondColKey] || `row_${rowNumber}`).trim();
          const rowReviewQueue = reviewQueue.filter((x) => Number((x && x.row) || 0) === rowNumber);
          const recordRow = {
            id: `${item.id}-t${rowNumber}-${Math.random().toString(16).slice(2, 8)}`,
            file: item.file,
            fileName: item.fileName,
            sourceFileName: item.sourceFileName || item.fileName,
            recordName,
            rowNumber,
            sheetName: "",
            isRecordRow: true,
            sourceType: item.sourceType,
            fileId: item.fileId,
            rawText: rawRecord,
            sourceCode: resolveSourceCode({ ...item, fields: mergedFields }),
            recordCount: 1,
            category: inferCategory({ ...item, fields: mergedFields }),
            fields: mergedFields,
            recognizedFields: { ...mergedFields },
            templateName: "",
            matchedBy: "",
            templateUserSelected: false,
            status: "ready",
            message: rowReviewQueue.length ? `表格行已载入（待复核 ${rowReviewQueue.length} 项）` : "表格行已载入",
            reportId: "",
            reportDownloadUrl: "",
            reportFileName: "",
            reportGenerateMode: "",
            modeReports: {},
            generalCheckStruct: null,
            reviewQueue: rowReviewQueue,
          };
          recordRows.push(recordRow);
        }
        await replaceSourceWithRowsProgressively(item, recordRows, "表格行识别");
        appendLog(`结构化表格拆分完成 ${item.fileName}：${recordRows.length} 行`);
        return;
      }
      const dataLines = splitTableDataLines(item.rawText, schemaRules);
      if (dataLines.length) {
        const recordRows = dataLines.map((line, idx) => {
          const mapped = mapLineToSchemaFields(line, schemaColumns, schemaRules);
          const normalizedMapped = applySchemaRulesToMappedFields(mapped, schemaColumns, schemaRules);
          const mergedFields = { ...createEmptyFields(), ...normalizedMapped, raw_record: line };
          const rowNumber = idx + 1;
          const firstColKey = String((schemaColumns[0] && schemaColumns[0].key) || "").trim();
          const secondColKey = String((schemaColumns[1] && schemaColumns[1].key) || "").trim();
          const recordName = String(mergedFields[firstColKey] || mergedFields[secondColKey] || `row_${rowNumber}`).trim();
          return {
            id: `${item.id}-t${rowNumber}-${Math.random().toString(16).slice(2, 8)}`,
            file: item.file,
            fileName: item.fileName,
            sourceFileName: item.sourceFileName || item.fileName,
            recordName,
            rowNumber,
            sheetName: "",
            isRecordRow: true,
            sourceType: item.sourceType,
            fileId: item.fileId,
            rawText: line,
            sourceCode: resolveSourceCode({ ...item, fields: mergedFields }),
            recordCount: 1,
            category: inferCategory({ ...item, fields: mergedFields }),
            fields: mergedFields,
            recognizedFields: { ...mergedFields },
            templateName: "",
            matchedBy: "",
            templateUserSelected: false,
            status: "ready",
            message: "表格行已载入",
            reportId: "",
            reportDownloadUrl: "",
            reportFileName: "",
            reportGenerateMode: "",
            modeReports: {},
            generalCheckStruct: null,
          };
        });
        await replaceSourceWithRowsProgressively(item, recordRows, "文本行识别");
        appendLog(`表格拆分完成 ${item.fileName}：${recordRows.length} 行`);
        return;
      }
      item.fields = { ...createEmptyFields(), raw_record: item.rawText || "" };
      item.recognizedFields = { ...item.fields };
      item.status = "ready";
      item.message = "未识别到表格数据行";
      renderQueue();
      renderTemplateSelect();
      return;
    }

    const ext = extFromName(item.fileName || "");

    if (ext === ".docx") {
      const docxStruct = (item.ocrStructured && item.ocrStructured.docx) || {};
      const embeddedExcelCount = Number(docxStruct.embedded_excel_count || 0);
      const chartCount = Number(docxStruct.chart_count || 0);
      if (embeddedExcelCount > 0 || chartCount > 0) {
        appendLog(`DOCX内嵌对象检测 ${item.fileName}：Excel=${embeddedExcelCount} 图表=${chartCount}`);
      }
    }
    const blocks = (ext === ".docx" || forceAsWord) ? [item.rawText] : splitRecordBlocks(item.rawText);
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
        const tableModel = structRes && structRes.table && typeof structRes.table === "object" ? structRes.table : null;
        const hasSingle = !!(tableModel && Array.isArray(tableModel.cells) && tableModel.cells.length);
        const hasMulti = !!(tableModel && Array.isArray(tableModel.tables) && tableModel.tables.length);
        if (hasSingle || hasMulti) {
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
          reportGenerateMode: "",
          modeReports: {},
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

  return { processItem };
}
