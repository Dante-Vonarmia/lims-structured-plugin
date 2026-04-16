import { buildFieldRuleResolver, normalizeMonthDayToken } from "./schema-utils.js";
import { parseManufactureYearMonthToken } from "./field-normalizers.js";

const DATA_ROW_RE = /^\s*[zZ]?\d{1,2}(?:\s*[./-]\s*\d{1,2})?\b/;
const CHUNK_GROUP_ORDER = [
  "钢印标记检查及余气处理",
  "外观及螺纹检查",
  "重量与容积测定",
  "水压试验",
  "气密性试验",
  "结果评定",
];

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

function mapLineToSchemaFieldsInternal(line, columns, rules = {}) {
  const cols = Array.isArray(columns) ? columns : [];
  const rawLine = String(line || "").trim();
  const getFieldRule = buildFieldRuleResolver(rules);
  const detectValveSelection = (rule = {}) => {
    const escapeReg = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasTokenPattern = (tokens, markerPattern) => {
      return tokens.some((token) => {
        const text = String(token || "").trim();
        if (!text) return false;
        const reg = new RegExp(`${markerPattern}\\s*${escapeReg(text)}`, "i");
        return reg.test(rawLine);
      });
    };
    const choices = Array.isArray(rule.choices) ? rule.choices : [];
    const analyzed = choices.map((choice) => {
      const tokens = Array.isArray(choice && choice.tokens) ? choice.tokens : [];
      const hit = tokens.some((token) => {
        const text = String(token || "").trim();
        return text && rawLine.includes(text);
      });
      const checked = hasTokenPattern(tokens, "(?:☑|√|✓|V|v)");
      const unchecked = hasTokenPattern(tokens, "(?:□|口|☐|◻)");
      return {
        label: String((choice && choice.label) || "").trim(),
        hit,
        checked,
        unchecked,
      };
    });
    const checkedHits = analyzed.filter((x) => x.checked);
    if (checkedHits.length === 1) return { value: checkedHits[0].label, warning: "" };
    if (checkedHits.length > 1) {
      return { value: "", warning: "瓶阀检验冲突：同一行同时命中“校阀”和“换阀”，已置空" };
    }
    const uncheckedHits = analyzed.filter((x) => x.unchecked);
    const plainHits = analyzed.filter((x) => x.hit);
    if (analyzed.length === 2 && uncheckedHits.length === 1 && plainHits.length >= 1) {
      const picked = analyzed.find((x) => x.label && x.label !== uncheckedHits[0].label && x.hit);
      if (picked) return { value: picked.label, warning: "" };
    }
    if (plainHits.length === 1) return { value: plainHits[0].label, warning: "" };
    if (plainHits.length > 1) {
      return { value: "", warning: "瓶阀检验冲突：同一行同时命中“校阀”和“换阀”，已置空" };
    }
    const hasCal = /(校阀|校调|校調|收阀|收调|政调|农调|回校)/i.test(rawLine);
    const hasSwap = /(换阀|換阀|换间|换询|换具|换惘|換間|换网)/i.test(rawLine);
    if (hasCal && hasSwap) {
      return { value: "", warning: "瓶阀检验冲突：同一行同时命中“校阀”和“换阀”，已置空" };
    }
    if (hasCal) return { value: "校阀", warning: "" };
    if (hasSwap) return { value: "换阀", warning: "" };
    return { value: "", warning: "" };
  };
  const isCheckmarkFieldLabel = (label) => {
    const x = String(label || "").trim();
    return (
      x === "余气处理"
      || x === "外观清理检查"
      || x === "音响检查"
      || x === "内表面检查"
      || x === "瓶口螺纹检查"
      || x === "内部干燥"
      || x === "试验结论"
      || x === "评定结论"
    );
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
  const normalizeMediumToken = (token) => {
    const normalized = String(token || "").trim();
    if (!normalized) return "";
    const upper = normalized.toUpperCase();
    if (upper === "A" || upper === "HR" || upper === "AR" || upper === "AIR" || upper === "A1" || upper === "AI") return "Ar";
    if (upper === "02" || upper === "OZ") return "O2";
    if (upper === "N2") return "N2";
    if (upper === "C02" || upper === "CO2") return "CO2";
    return normalized;
  };
  const isMediumLikeToken = (token, rule = {}) => {
    const normalized = normalizeMediumToken(normalizeTextToken(token, rule));
    if (!normalized) return false;
    const choices = Array.isArray(rule.choices) ? rule.choices.map((x) => String((x && x.label) || "").trim()).filter(Boolean) : [];
    return choices.length ? choices.includes(normalized) : false;
  };
  const cleaned = rawLine
    .replace(/(口|回|□|▢)?\s*(校阀|校调|校調|收阀|收调|政调|农调|回校)\s*/gi, " ")
    .replace(/(口|回|□|▢)?\s*(换阀|換阀|换间|换询|换具|换惘|換間|换网)\s*/gi, " ")
    .replace(/[√✓]/g, " V ")
    .replace(/[，,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const resolveChunkGroupName = (groupName) => {
    const raw = String(groupName || "").trim();
    if (!raw) return "";
    for (let i = 0; i < CHUNK_GROUP_ORDER.length; i += 1) {
      const marker = CHUNK_GROUP_ORDER[i];
      if (raw === marker || raw.includes(marker) || marker.includes(raw)) return marker;
    }
    return raw;
  };
  const isConsumableColumn = (col, rule) => {
    const label = String((col && col.label) || "").trim();
    const ruleType = String((rule && rule.type) || "").trim();
    if (!String((col && col.key) || "").trim()) return false;
    if (ruleType === "optional_blank" || label === "检验员" || label === "审核员") return false;
    if (ruleType === "checkbox_choice" || label === "瓶阀检验") return false;
    return true;
  };
  const buildChunkSegments = () => {
    if (!cols.length) return [];
    const segments = [];
    for (let i = 0; i < cols.length; i += 1) {
      const col = cols[i] || {};
      const groupName = resolveChunkGroupName(col.group || "");
      const prev = segments[segments.length - 1];
      if (!prev || prev.groupName !== groupName) {
        segments.push({ groupName, colStart: i, colEnd: i, consumable: 0, tokenStart: 0, tokenEnd: 0 });
      } else {
        prev.colEnd = i;
      }
    }
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      let count = 0;
      for (let j = seg.colStart; j <= seg.colEnd; j += 1) {
        const c = cols[j] || {};
        const r = getFieldRule(String(c.label || "").trim(), String(c.key || "").trim());
        if (isConsumableColumn(c, r)) count += 1;
      }
      seg.consumable = Math.max(1, count);
    }
    const totalWeight = segments.reduce((sum, seg) => sum + seg.consumable, 0) || 1;
    let consumedWeight = 0;
    let tokenCursor = 0;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      seg.tokenStart = tokenCursor;
      consumedWeight += seg.consumable;
      if (i === segments.length - 1) {
        seg.tokenEnd = tokens.length;
      } else {
        const projected = Math.round((tokens.length * consumedWeight) / totalWeight);
        seg.tokenEnd = Math.max(tokenCursor, Math.min(tokens.length, projected));
      }
      tokenCursor = seg.tokenEnd;
    }
    return segments;
  };
  const chunkSegments = buildChunkSegments();
  const getChunkByColIndex = (colIdx) => {
    for (let i = 0; i < chunkSegments.length; i += 1) {
      const seg = chunkSegments[i];
      if (colIdx >= seg.colStart && colIdx <= seg.colEnd) return seg;
    }
    return chunkSegments[0] || null;
  };
  const mapped = {};
  const trace = [];
  if (!cols.length) return { mapped, trace };
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
    if ((x.match(/\./g) || []).length > 1) {
      const chunks = x.match(/[+\-]?\d+(?:\.\d+)?/g) || [];
      if (chunks.length) x = String(chunks[0] || "");
    }
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
  const normalizeCheckmarkToken = (token) => {
    const t = String(token || "").trim();
    if (!t) return "";
    if (isMarkerToken(t)) return "√";
    if (/(?:√|✓|勾|钩|对|是)/.test(t)) return "√";
    return "";
  };
  const cursor = { value: 0 };
  const peekToken = (offset = 0, opts = {}) => {
    const allowMarkers = !!opts.allowMarkers;
    const maxCursor = Number.isFinite(Number(opts.maxCursor)) ? Number(opts.maxCursor) : tokens.length;
    let idx = cursor.value;
    let seen = 0;
    while (idx < Math.min(tokens.length, maxCursor)) {
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
    const minCursor = Number.isFinite(Number(opts.minCursor)) ? Number(opts.minCursor) : 0;
    const maxCursor = Number.isFinite(Number(opts.maxCursor)) ? Number(opts.maxCursor) : tokens.length;
    if (cursor.value < minCursor) cursor.value = minCursor;
    while (cursor.value < Math.min(tokens.length, maxCursor)) {
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
      const maybeMedium = (label === "充装介质") ? normalizeMediumToken(normalized) : normalized;
      const choices = Array.isArray(rule.choices) ? rule.choices.map((x) => String((x && x.label) || "").trim()).filter(Boolean) : [];
      if (!choices.length) return maybeMedium ? 1 : 0;
      return choices.includes(maybeMedium) ? 4 : 0;
    }
    if (ruleType === "code" || ruleType === "loose_text" || label === "产权代码编号") {
      const normalized = normalizeTextToken(value, rule);
      if (!normalized) return 0;
      if ((label === "产权代码编号" || ruleType === "code") && ["Ar", "O2", "N2", "CO2"].includes(normalized)) return 1;
      if (label === "制造单位代码") {
        if (/^(?=.*[A-Za-z])[A-Za-z0-9一-龥]{1,4}$/.test(normalized)) return 3;
        return 0;
      }
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
  const findNextConsumableColumn = (startIdx, endIdx) => {
    const limit = Number.isFinite(Number(endIdx)) ? Number(endIdx) : (cols.length - 1);
    for (let i = startIdx; i <= limit; i += 1) {
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
  const looksLikeMakerCodeToken = (token) => /^(?=.*[A-Za-z])[A-Za-z0-9一-龥]{1,4}$/.test(String(token || "").trim());
  const looksLikeSerialToken = (token) => /^[A-Za-z0-9一-龥-]{5,24}$/.test(String(token || "").trim());
  const scoreFutureAlignment = (startColIdx, tokenOffset, activeChunk) => {
    const chunkEndCol = activeChunk ? activeChunk.colEnd : (cols.length - 1);
    const next = findNextConsumableColumn(startColIdx, chunkEndCol);
    if (!next) return 0;
    const nextToken = peekToken(tokenOffset, { maxCursor: activeChunk ? activeChunk.tokenEnd : tokens.length });
    const nextScore = scoreTokenForColumn(nextToken, next.col, next.rule);
    const third = findNextConsumableColumn(next.index + 1, chunkEndCol);
    if (!third) return nextScore;
    const thirdToken = peekToken(tokenOffset + 1, { maxCursor: activeChunk ? activeChunk.tokenEnd : tokens.length });
    const thirdScore = scoreTokenForColumn(thirdToken, third.col, third.rule);
    return nextScore + thirdScore;
  };
  const shouldReserveBlankSlot = (colIdx, token, currentCol, currentRule, allowMarkers, activeChunk) => {
    const currentScore = scoreTokenForColumn(token, currentCol, currentRule);
    const chunkEndCol = activeChunk ? activeChunk.colEnd : (cols.length - 1);
    const next = findNextConsumableColumn(colIdx + 1, chunkEndCol);
    if (!next) return false;
    if (
      String((currentCol && currentCol.label) || "").trim() === "产权代码编号"
      && /^[\u4e00-\u9fff]{2,}$/.test(String(token || "").trim())
    ) {
      return false;
    }
    if (String((currentCol && currentCol.label) || "").trim() === "充装介质") {
      const nextToken = peekToken(1, { allowMarkers, maxCursor: activeChunk ? activeChunk.tokenEnd : tokens.length });
      const thirdToken = peekToken(2, { allowMarkers, maxCursor: activeChunk ? activeChunk.tokenEnd : tokens.length });
      if (isMediumLikeToken(token, currentRule)) return false;
      if (looksLikeMakerCodeToken(nextToken) && looksLikeSerialToken(thirdToken) && /^[A-Za-z0-9]{1,4}$/.test(String(token || "").trim())) {
        return false;
      }
    }
    if (
      String((currentCol && currentCol.label) || "").trim() === "产权代码编号"
      && String((next.col && next.col.label) || "").trim() === "充装介质"
      && isMediumLikeToken(token, next.rule)
    ) {
      return true;
    }
    if (
      String((currentCol && currentCol.label) || "").trim() === "产权代码编号"
      && String((next.col && next.col.label) || "").trim() === "充装介质"
    ) {
      const nextToken = peekToken(1, { allowMarkers, maxCursor: activeChunk ? activeChunk.tokenEnd : tokens.length });
      const thirdToken = peekToken(2, { allowMarkers, maxCursor: activeChunk ? activeChunk.tokenEnd : tokens.length });
      if (looksLikeMakerCodeToken(nextToken) && looksLikeSerialToken(thirdToken)) return true;
      const futureAlignmentScore = scoreFutureAlignment(next.index + 1, 1, activeChunk);
      if (currentScore <= 2 && futureAlignmentScore >= 5) return true;
    }
    const nextScore = scoreTokenForColumn(token, next.col, next.rule);
    if (nextScore >= 3 && nextScore > currentScore) {
      const lookahead = peekToken(1, { allowMarkers, maxCursor: activeChunk ? activeChunk.tokenEnd : tokens.length });
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
    const activeChunk = getChunkByColIndex(i);
    if (activeChunk && cursor.value < activeChunk.tokenStart) cursor.value = activeChunk.tokenStart;
    const chunkMinCursor = activeChunk ? activeChunk.tokenStart : 0;
    const chunkMaxCursor = activeChunk ? activeChunk.tokenEnd : tokens.length;
    if (ruleType === "date" || label === "检验日期") {
      const token = peekToken(0, { allowMarkers: true, maxCursor: chunkMaxCursor });
      if (!token || shouldReserveBlankSlot(i, token, col, rule, true, activeChunk)) {
      mapped[key] = dateText || "";
      trace.push({ columnKey: key, columnLabel: label, token: "", mappedValue: mapped[key], reservedBlank: true, ruleType: String(rule.type || "").trim() || "date" });
      continue;
    }
    consumeToken({ allowMarkers: true, minCursor: chunkMinCursor, maxCursor: chunkMaxCursor });
    mapped[key] = normalizeDateToken(token) || dateText || "";
    trace.push({ columnKey: key, columnLabel: label, token, mappedValue: mapped[key], reservedBlank: false, ruleType: String(rule.type || "").trim() || "date" });
    continue;
  }
    if (ruleType === "date_or_dash" || label === "上次检验日期") {
      const token = peekToken(0, { allowMarkers: true, maxCursor: chunkMaxCursor });
      if (!token || shouldReserveBlankSlot(i, token, col, rule, true, activeChunk)) {
      mapped[key] = "";
      trace.push({ columnKey: key, columnLabel: label, token: "", mappedValue: "", reservedBlank: true, ruleType: String(rule.type || "").trim() || "date_or_dash" });
      continue;
    }
    consumeToken({ allowMarkers: true, minCursor: chunkMinCursor, maxCursor: chunkMaxCursor });
      mapped[key] = normalizeDateToken(token) || "";
      trace.push({ columnKey: key, columnLabel: label, token, mappedValue: mapped[key], reservedBlank: false, ruleType: String(rule.type || "").trim() || "date_or_dash" });
      continue;
    }
    if (ruleType === "checkbox_choice" || label === "瓶阀检验") {
      const valve = detectValveSelection(rule);
      mapped[key] = String((valve && valve.value) || "").trim();
      trace.push({
        columnKey: key,
        columnLabel: label,
        token: "",
        mappedValue: mapped[key],
        reservedBlank: false,
        ruleType: "checkbox_choice",
        warning: String((valve && valve.warning) || "").trim(),
      });
      continue;
    }
    if (isCheckmarkFieldLabel(label)) {
      const token = peekToken(0, { allowMarkers: true, maxCursor: chunkMaxCursor });
      if (!token || shouldReserveBlankSlot(i, token, col, rule, true, activeChunk)) {
        mapped[key] = "";
        trace.push({ columnKey: key, columnLabel: label, token: token || "", mappedValue: "", reservedBlank: true, ruleType: "checkmark_text" });
        continue;
      }
      const check = normalizeCheckmarkToken(token);
      if (check) {
        consumeToken({ allowMarkers: true, minCursor: chunkMinCursor, maxCursor: chunkMaxCursor });
        mapped[key] = check;
        trace.push({ columnKey: key, columnLabel: label, token, mappedValue: mapped[key], reservedBlank: false, ruleType: "checkmark_text" });
        continue;
      }
      mapped[key] = "";
      trace.push({ columnKey: key, columnLabel: label, token, mappedValue: "", reservedBlank: true, ruleType: "checkmark_text" });
      continue;
    }
    if (ruleType === "optional_blank" || label === "检验员" || label === "审核员") {
      mapped[key] = "";
      trace.push({ columnKey: key, columnLabel: label, token: "", mappedValue: "", reservedBlank: true, ruleType: "optional_blank" });
      continue;
    }
    if (ruleType === "code" || ruleType === "loose_text" || label === "产权代码编号") {
      const token = peekToken(0, { maxCursor: chunkMaxCursor });
      if (!token || shouldReserveBlankSlot(i, token, col, rule, false, activeChunk)) {
        mapped[key] = "";
        trace.push({ columnKey: key, columnLabel: label, token: token || "", mappedValue: "", reservedBlank: true, ruleType: ruleType || "code" });
        continue;
      }
      const normalizedPreview = normalizeTextToken(token, rule);
      if (label === "制造单位代码" && !/^(?=.*[A-Za-z])[A-Za-z0-9一-龥]{1,4}$/.test(normalizedPreview)) {
        consumeToken({ minCursor: chunkMinCursor, maxCursor: chunkMaxCursor });
        mapped[key] = "";
        trace.push({ columnKey: key, columnLabel: label, token, mappedValue: "", reservedBlank: true, ruleType: ruleType || "code" });
        continue;
      }
      if (
        label === "出厂编号"
        && /^[A-Za-z]{1,3}$/.test(normalizedPreview)
        && /[A-Za-z].*\d|\d.*[A-Za-z]|\d{5,}/.test(String(peekToken(1, { maxCursor: chunkMaxCursor }) || "").trim())
      ) {
        mapped[key] = "";
        trace.push({ columnKey: key, columnLabel: label, token, mappedValue: "", reservedBlank: true, ruleType: ruleType || "code" });
        continue;
      }
      if (label === "产权代码编号" && isLikelyOwnerBlankCodeToken(normalizedPreview)) {
        mapped[key] = "";
        trace.push({ columnKey: key, columnLabel: label, token, mappedValue: "", reservedBlank: true, ruleType: ruleType || "code" });
        continue;
      }
      consumeToken({ minCursor: chunkMinCursor, maxCursor: chunkMaxCursor });
      const normalized = normalizeTextToken(token, rule);
      if (label === "制造单位代码") {
        mapped[key] = /^(?=.*[A-Za-z])[A-Za-z0-9一-龥]{1,4}$/.test(normalized) ? normalized : "";
        trace.push({ columnKey: key, columnLabel: label, token, mappedValue: mapped[key], reservedBlank: false, ruleType: ruleType || "code" });
        continue;
      }
      const maxLen = Number(rule.max_len || 16);
      const pattern = String(rule.pattern || "").trim();
      if (pattern) {
        const reg = new RegExp(pattern);
        mapped[key] = reg.test(normalized) ? normalized : "";
      } else {
        mapped[key] = new RegExp(`^[A-Za-z0-9一-龥\\-]{2,${Number.isFinite(maxLen) ? maxLen : 16}}$`).test(normalized) ? normalized : "";
      }
      trace.push({ columnKey: key, columnLabel: label, token, mappedValue: mapped[key], reservedBlank: false, ruleType: ruleType || "code" });
      continue;
    }
    const token = peekToken(0, { maxCursor: chunkMaxCursor });
    if (!token || shouldReserveBlankSlot(i, token, col, rule, false, activeChunk)) {
      mapped[key] = "";
      trace.push({ columnKey: key, columnLabel: label, token: token || "", mappedValue: "", reservedBlank: true, ruleType: ruleType || "text" });
      continue;
    }
    if (ruleType === "number") {
      consumeToken({ minCursor: chunkMinCursor, maxCursor: chunkMaxCursor });
      mapped[key] = normalizeNumericToken(normalizeTextToken(token, rule)) || "";
      trace.push({ columnKey: key, columnLabel: label, token, mappedValue: mapped[key], reservedBlank: false, ruleType: "number" });
      continue;
    }
    if (ruleType === "text") {
      const normalized = normalizeTextToken(token, rule);
      const normalizedByLabel = (label === "充装介质") ? normalizeMediumToken(normalized) : normalized;
      const choices = Array.isArray(rule.choices) ? rule.choices.map((x) => String((x && x.label) || "").trim()).filter(Boolean) : [];
      if (choices.length && !choices.includes(normalizedByLabel)) {
        if (label === "充装介质") {
          const nextToken = peekToken(1, { maxCursor: chunkMaxCursor });
          const thirdToken = peekToken(2, { maxCursor: chunkMaxCursor });
          if (looksLikeMakerCodeToken(nextToken) && looksLikeSerialToken(thirdToken) && /^[A-Za-z0-9]{1,4}$/.test(normalized)) {
            consumeToken({ minCursor: chunkMinCursor, maxCursor: chunkMaxCursor });
            mapped[key] = normalized;
            trace.push({ columnKey: key, columnLabel: label, token, mappedValue: mapped[key], reservedBlank: false, ruleType: "text" });
            continue;
          }
          const futureAlignmentScore = scoreFutureAlignment(i + 1, 1, activeChunk);
          if (futureAlignmentScore >= 5 && /^[A-Za-z0-9]{1,4}$/.test(normalized)) {
            consumeToken({ minCursor: chunkMinCursor, maxCursor: chunkMaxCursor });
            mapped[key] = normalized;
            trace.push({ columnKey: key, columnLabel: label, token, mappedValue: mapped[key], reservedBlank: false, ruleType: "text" });
            continue;
          }
        }
        mapped[key] = "";
        trace.push({ columnKey: key, columnLabel: label, token, mappedValue: "", reservedBlank: true, ruleType: "text" });
        continue;
      }
      consumeToken({ minCursor: chunkMinCursor, maxCursor: chunkMaxCursor });
      mapped[key] = normalizedByLabel;
      trace.push({ columnKey: key, columnLabel: label, token, mappedValue: mapped[key], reservedBlank: false, ruleType: "text" });
      continue;
    }
    consumeToken({ minCursor: chunkMinCursor, maxCursor: chunkMaxCursor });
    mapped[key] = normalizeTextToken(token, rule);
    trace.push({ columnKey: key, columnLabel: label, token, mappedValue: mapped[key], reservedBlank: false, ruleType: ruleType || "text" });
  }
  return { mapped, trace };
}

export function mapLineToSchemaFields(line, columns, rules = {}) {
  return mapLineToSchemaFieldsInternal(line, columns, rules).mapped;
}

export function mapLineToSchemaFieldsWithTrace(line, columns, rules = {}) {
  return mapLineToSchemaFieldsInternal(line, columns, rules);
}

export function applySchemaRulesToMappedFields(mappedInput, columns, rules = {}) {
  const cols = Array.isArray(columns) ? columns : [];
  const mapped = (mappedInput && typeof mappedInput === "object") ? mappedInput : {};
  const getFieldRule = buildFieldRuleResolver(rules);
  const result = {};
  const isCheckTrueToken = (raw) => {
    const t = String(raw || "").trim();
    if (!t) return false;
    if (["true", "1", "√", "✓", "V", "v"].includes(t)) return true;
    if (/[√✓]/.test(t)) return true;
    return false;
  };
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
    if (label === "制造年月") {
      const ymNormalized = parseManufactureYearMonthToken(value);
      result[key] = ymNormalized ? ymNormalized.normalized : value;
      continue;
    }
    if (ruleType === "date" || ruleType === "date_or_dash") {
      const dateNormalized = normalizeMonthDayToken(value);
      result[key] = dateNormalized || "";
      continue;
    }
    if (ruleType === "checkbox_choice") {
      result[key] = value;
      continue;
    }
    if (ruleType === "check") {
      result[key] = isCheckTrueToken(value) ? "true" : "";
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
  const isCheckTrueToken = (raw) => {
    const t = String(raw || "").trim();
    if (!t) return false;
    if (["true", "1", "√", "✓", "☑", "V", "v"].includes(t)) return true;
    if (/[√✓☑]/.test(t)) return true;
    return false;
  };
  const buildDateTypedValue = (value, type) => {
    const fullCn = value.match(/^\s*(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*$/);
    if (fullCn) {
      const yyyy = String(Number(fullCn[1] || "0") || "").padStart(4, "0");
      const mm = String(Number(fullCn[2] || "0") || "").padStart(2, "0");
      const dd = String(Number(fullCn[3] || "0") || "").padStart(2, "0");
      return {
        type,
        raw: value,
        inferredYear: false,
        year: yyyy,
        month: mm,
        day: dd,
        isoDate: `${yyyy}-${mm}-${dd}`,
        display: `${yyyy}年${mm}月${dd}日`,
      };
    }
    const fullYmd = value.match(/^\s*(\d{2,4})\s*[.\-/、]\s*(\d{1,2})\s*[.\-/、]\s*(\d{1,2})\s*$/);
    if (fullYmd) {
      const yyyy = String(Number(fullYmd[1] || "0") || "").padStart(4, "0");
      const mm = String(Number(fullYmd[2] || "0") || "").padStart(2, "0");
      const dd = String(Number(fullYmd[3] || "0") || "").padStart(2, "0");
      return {
        type,
        raw: value,
        inferredYear: false,
        year: yyyy,
        month: mm,
        day: dd,
        isoDate: `${yyyy}-${mm}-${dd}`,
        display: `${yyyy}年${mm}月${dd}日`,
      };
    }
    const monthDay = value.match(/^\s*(\d{1,2})\.(\d{1,2})\s*$/);
    if (monthDay) {
      const nowYear = new Date().getFullYear();
      const mm = String(Number(monthDay[1] || "0") || "").padStart(2, "0");
      const dd = String(Number(monthDay[2] || "0") || "").padStart(2, "0");
      return {
        type,
        raw: value,
        dash: false,
        inferredYear: true,
        year: nowYear,
        month: mm,
        day: dd,
        isoDate: `${nowYear}-${mm}-${dd}`,
        display: `${nowYear}年${mm}月${dd}日`,
      };
    }
    if (type === "date_or_dash" && value === "-") {
      return {
        type,
        raw: value,
        dash: true,
        display: value,
      };
    }
    return null;
  };
  for (let i = 0; i < cols.length; i += 1) {
    const col = cols[i] || {};
    const key = String(col.key || "").trim();
    const label = String(col.label || "").trim();
    if (!key) continue;
    const rule = getFieldRule(label, key);
    const ruleType = String(rule.type || "").trim();
    const ruleStdType = String(rule.std_type || "").trim();
    const value = String(mapped[key] || "").trim();
    if (!value) continue;
    if (ruleType === "number" || ruleStdType === "number") {
      const n = Number(value);
      typed[key] = {
        type: "number",
        raw: value,
        value: Number.isFinite(n) ? n : null,
        display: value,
      };
      continue;
    }
    if (label === "制造年月") {
      const parsedYearMonth = parseManufactureYearMonthToken(value);
      if (parsedYearMonth) {
        typed[key] = {
          type: "year_month",
          raw: value,
          value: parsedYearMonth.normalized,
          year: parsedYearMonth.yearText,
          month: parsedYearMonth.monthText,
          display: parsedYearMonth.normalized,
          warnings: parsedYearMonth.warning ? [parsedYearMonth.warning] : [],
        };
        continue;
      }
    }
    if (ruleType === "date" || ruleStdType === "date") {
      const typedDate = buildDateTypedValue(value, "date");
      if (typedDate) typed[key] = typedDate;
      continue;
    }
    if (ruleType === "date_or_dash") {
      const typedDate = buildDateTypedValue(value, "date_or_dash");
      if (typedDate) typed[key] = typedDate;
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
    if (ruleType === "check" || (ruleStdType === "check" && ruleType !== "checkbox_choice")) {
      typed[key] = {
        type: "check",
        raw: value,
        value: isCheckTrueToken(value),
        display: value,
      };
      continue;
    }
    if (ruleType === "signature" || ruleStdType === "signature") {
      typed[key] = {
        type: "signature",
        raw: value,
        value,
        display: value,
      };
      continue;
    }
    typed[key] = {
      type: ruleStdType || ruleType || "string",
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
  const getFieldRule = buildFieldRuleResolver(rules);
  const carryKeys = cols
    .map((col) => {
      const key = String((col && col.key) || "").trim();
      const label = String((col && col.label) || "").trim();
      const rule = getFieldRule(label, key);
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
