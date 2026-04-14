import { buildFieldRuleResolver, normalizeMonthDayToken } from "./schema-utils.js";

const DATA_ROW_RE = /^\s*[zZ]?\d{1,2}(?:\s*[./-]\s*\d{1,2})?\b/;

export function splitTableDataLines(rawText, rules = {}) {
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

export function mapLineToSchemaFields(line, columns, rules = {}) {
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
  const normalizeDateToken = (token) => normalizeMonthDayToken(token);
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
    mapped[key] = normalizeTextToken(token, rule);
  }
  return mapped;
}

export function applySchemaRulesToMappedFields(mappedInput, columns, rules = {}) {
  const cols = Array.isArray(columns) ? columns : [];
  const mapped = (mappedInput && typeof mappedInput === "object") ? mappedInput : {};
  const fieldRules = (rules && typeof rules.field_rules === "object" && rules.field_rules) ? rules.field_rules : {};
  const getFieldRule = (label, key) => {
    const byLabel = fieldRules[String(label || "").trim()];
    if (byLabel && typeof byLabel === "object") return byLabel;
    const byKey = fieldRules[String(key || "").trim()];
    return byKey && typeof byKey === "object" ? byKey : {};
  };
  const result = {};
  for (let i = 0; i < cols.length; i += 1) {
    const col = cols[i] || {};
    const key = String(col.key || "").trim();
    const label = String(col.label || "").trim();
    if (!key) continue;
    const rule = getFieldRule(label, key);
    const ruleType = String(rule.type || "").trim();
    let value = String(mapped[key] || "").trim();
    if (!value) {
      result[key] = "";
      continue;
    }
    if (ruleType === "number") {
      value = value
        .replace(/[oO]/g, "0")
        .replace(/[lI]/g, "1")
        .replace(/[，]/g, ".")
        .replace(/。/g, ".")
        .replace(/[^\d.+\-]/g, "")
        .replace(/^\.+/, "")
        .replace(/\.+$/, "");
      result[key] = value;
      continue;
    }
    if (ruleType === "date" || ruleType === "date_or_dash") {
      if (ruleType === "date_or_dash" && value === "-") {
        result[key] = value;
        continue;
      }
      const dateNormalized = normalizeMonthDayToken(value);
      result[key] = dateNormalized || "";
      continue;
    }
    if (ruleType === "checkbox_choice") {
      result[key] = value;
      continue;
    }
    const normalize = (rule && typeof rule.normalize === "object" && rule.normalize) ? rule.normalize : {};
    if (normalize.fullwidth_to_halfwidth) {
      value = value.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248)).replace(/\u3000/g, " ");
    }
    if (normalize.o_to_0) value = value.replace(/[oO]/g, "0");
    if (normalize.l_to_1) value = value.replace(/[lI]/g, "1");
    if (normalize.trim !== false) value = value.trim();
    result[key] = value;
  }
  return result;
}

export function buildTypedFieldsFromMapped(mappedInput, columns, rules = {}) {
  const cols = Array.isArray(columns) ? columns : [];
  const mapped = (mappedInput && typeof mappedInput === "object") ? mappedInput : {};
  const getFieldRule = buildFieldRuleResolver(rules);
  const typed = {};
  for (let i = 0; i < cols.length; i += 1) {
    const col = cols[i] || {};
    const key = String(col.key || "").trim();
    const label = String(col.label || "").trim();
    if (!key) continue;
    const rule = getFieldRule(label, key);
    const ruleType = String(rule.type || "").trim();
    const value = String(mapped[key] || "").trim();
    if (!value) continue;
    if (ruleType === "number") {
      const n = Number(value);
      typed[key] = {
        type: "number",
        raw: value,
        value: Number.isFinite(n) ? n : null,
        display: value,
      };
      continue;
    }
    if (ruleType === "date") {
      const m = value.match(/^\s*(\d{1,2})\.(\d{1,2})\s*$/);
      if (m) {
        const nowYear = new Date().getFullYear();
        const mm = String(Number(m[1] || "0") || "").padStart(2, "0");
        const dd = String(Number(m[2] || "0") || "").padStart(2, "0");
        typed[key] = {
          type: "date",
          raw: value,
          inferredYear: true,
          year: nowYear,
          month: mm,
          day: dd,
          isoDate: `${nowYear}-${mm}-${dd}`,
          display: `${nowYear}年${mm}月${dd}日`,
        };
      }
      continue;
    }
    if (ruleType === "date_or_dash") {
      if (value === "-") {
        typed[key] = { type: "date_or_dash", dash: true, raw: value, display: value };
      } else {
        const m = value.match(/^\s*(\d{1,2})\.(\d{1,2})\s*$/);
        if (m) {
          const nowYear = new Date().getFullYear();
          const mm = String(Number(m[1] || "0") || "").padStart(2, "0");
          const dd = String(Number(m[2] || "0") || "").padStart(2, "0");
          typed[key] = {
            type: "date_or_dash",
            dash: false,
            raw: value,
            inferredYear: true,
            year: nowYear,
            month: mm,
            day: dd,
            isoDate: `${nowYear}-${mm}-${dd}`,
            display: `${nowYear}年${mm}月${dd}日`,
          };
        }
      }
      continue;
    }
    if (ruleType === "checkbox_choice") {
      typed[key] = {
        type: "checkbox_choice",
        raw: value,
        display: value,
      };
      continue;
    }
    typed[key] = {
      type: ruleType || "string",
      raw: value,
      value,
      display: value,
    };
  }
  return typed;
}

export function applyCarryForwardRows(rows, columns, rules = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const cols = Array.isArray(columns) ? columns : [];
  if (!list.length || !cols.length) return list;
  const fieldRules = (rules && typeof rules.field_rules === "object" && rules.field_rules) ? rules.field_rules : {};
  const carryKeys = cols
    .map((col) => {
      const key = String((col && col.key) || "").trim();
      const label = String((col && col.label) || "").trim();
      const byLabel = fieldRules[label];
      const byKey = fieldRules[key];
      const rule = (byLabel && typeof byLabel === "object") ? byLabel : ((byKey && typeof byKey === "object") ? byKey : {});
      return String((rule && rule.empty_strategy) || "").trim().toLowerCase() === "carry_forward" ? key : "";
    })
    .filter(Boolean);
  if (!carryKeys.length) return list;
  const lastSeen = {};
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (!row || typeof row !== "object") continue;
    if (!row.fields || typeof row.fields !== "object") row.fields = {};
    if (!row.recognizedFields || typeof row.recognizedFields !== "object") row.recognizedFields = {};
    carryKeys.forEach((key) => {
      const cur = String(row.fields[key] || "").trim();
      if (cur) {
        lastSeen[key] = cur;
      } else if (String(lastSeen[key] || "").trim()) {
        row.fields[key] = lastSeen[key];
        row.recognizedFields[key] = lastSeen[key];
      }
    });
  }
  return list;
}

