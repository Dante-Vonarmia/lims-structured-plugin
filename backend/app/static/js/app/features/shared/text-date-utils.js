export function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text || "";
  return d.innerHTML;
}

export function escapeAttr(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderRichCellHtml(text) {
  const raw = String(text || "");
  const tokenRe = /\[\[DOCX_IMG\|([^\]]+)\]\]/g;
  let html = "";
  let last = 0;
  let m;
  while ((m = tokenRe.exec(raw)) !== null) {
    html += escapeHtml(raw.slice(last, m.index));
    const src = String((m && m[1]) || "").trim();
    if (/^data:image\//i.test(src)) {
      html += `<img class="source-inline-img" src="${escapeAttr(src)}" alt="img" />`;
    } else {
      html += "[图片]";
    }
    last = m.index + m[0].length;
  }
  html += escapeHtml(raw.slice(last));
  return html;
}

export function hasDocxImageToken(text) {
  return /\[\[DOCX_IMG\|/.test(String(text || ""));
}

export function collectDocxImageTokens(text, limit = 2) {
  const source = String(text || "");
  if (!source) return [];
  const maxCount = Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : 2;
  if (!maxCount) return [];
  const re = /\[\[DOCX_IMG\|[^\]]+\]\]/g;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(source)) !== null) {
    const token = String(m[0] || "").trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= maxCount) break;
  }
  return out;
}

export function cleanBlockText(value) {
  return String(value || "").replace(/\r/g, "").replace(/\u00a0/g, " ").trim();
}

export function enrichGeneralCheckWithDocxImages(blockText, rawText) {
  const block = cleanBlockText(blockText || "");
  if (hasDocxImageToken(block)) return block;
  const tokens = collectDocxImageTokens(rawText, 2);
  if (!tokens.length) return block;
  return cleanBlockText([block, ...tokens].filter(Boolean).join("\n"));
}

export function toDateOnlyDisplay(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.replace(/\//g, "-");
  const match = normalized.match(/^(\d{4}-\d{1,2}-\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{1,2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)$/i);
  return match && match[1] ? match[1] : text;
}

export function normalizeValidationToken(value) {
  return String(value || "").toLowerCase().replace(/[\s:：/\\\-_.|*（）()]+/g, "");
}

export function normalizeCatalogToken(value) {
  return normalizeValidationToken(String(value || "").trim());
}

export function normalizeOptionalBlank(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^[\/\\;；|]+$/.test(text)) return "";
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  if (new Set(["receiveddate", "dateforcalibration", "year", "month", "day"]).has(normalized)) return "";
  return text;
}

export function splitRawLines(raw) {
  return cleanBlockText(raw).split("\n").map((x) => x.trim()).filter(Boolean);
}

export function lineMatchesAny(line, patterns = []) {
  if (!line || !Array.isArray(patterns) || !patterns.length) return false;
  return patterns.some((pattern) => pattern && pattern.test(line));
}

export function extractBlockByLine(raw, startPatterns = [], endPatterns = []) {
  const lines = splitRawLines(raw);
  if (!lines.length) return "";
  const startIndex = lines.findIndex((line) => lineMatchesAny(line, startPatterns));
  if (startIndex < 0) return "";
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (!lineMatchesAny(lines[i], endPatterns)) continue;
    endIndex = i;
    break;
  }
  return cleanBlockText(lines.slice(startIndex, endIndex).join("\n"));
}

export function extractAllBlocksByLine(raw, startPatterns = [], endPatterns = []) {
  const lines = splitRawLines(raw);
  if (!lines.length) return "";
  const blocks = [];
  let idx = 0;
  while (idx < lines.length) {
    if (!lineMatchesAny(lines[idx], startPatterns)) {
      idx += 1;
      continue;
    }
    let endIndex = lines.length;
    for (let i = idx + 1; i < lines.length; i += 1) {
      if (!lineMatchesAny(lines[i], endPatterns)) continue;
      endIndex = i;
      break;
    }
    const block = cleanBlockText(lines.slice(idx, endIndex).join("\n"));
    if (block) blocks.push(block);
    idx = endIndex < lines.length ? endIndex + 1 : lines.length;
  }
  return cleanBlockText(blocks.join("\n"));
}

export function parseDateFromLabelText(text, labelPattern) {
  const source = String(text || "");
  if (!source.trim()) return "";
  const re = new RegExp(`${labelPattern}[\\s\\S]{0,240}?(\\d{4})\\s*[^\\d]{0,20}(\\d{1,2})\\s*[^\\d]{0,20}(\\d{1,2})`, "i");
  const m = source.match(re);
  if (!m) return "";
  const y = String(m[1] || "").trim();
  const mm = String(Number.parseInt(m[2] || "0", 10) || 0).padStart(2, "0");
  const dd = String(Number.parseInt(m[3] || "0", 10) || 0).padStart(2, "0");
  if (!y || mm === "00" || dd === "00") return "";
  return `${y}年${mm}月${dd}日`;
}

export function parseDateParts(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const m = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const year = String(m[1] || "").trim();
  const month = String(Number.parseInt(m[2] || "0", 10) || 0).padStart(2, "0");
  const day = String(Number.parseInt(m[3] || "0", 10) || 0).padStart(2, "0");
  if (!year || month === "00" || day === "00") return null;
  return { year, month, day };
}

export function isCompleteDateText(value) {
  return !!parseDateParts(value);
}

export function formatDateFromParts(parts) {
  if (!parts || !parts.year || !parts.month || !parts.day) return "";
  return `${parts.year}年${parts.month}月${parts.day}日`;
}

export function shiftDateText(value, deltaDays) {
  const parts = parseDateParts(value);
  if (!parts) return "";
  const y = Number.parseInt(parts.year, 10);
  const m = Number.parseInt(parts.month, 10);
  const d = Number.parseInt(parts.day, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return "";
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0));
  return formatDateFromParts({
    year: String(dt.getUTCFullYear()).padStart(4, "0"),
    month: String(dt.getUTCMonth() + 1).padStart(2, "0"),
    day: String(dt.getUTCDate()).padStart(2, "0"),
  });
}

export function inferDateTriplet(input = {}) {
  let receiveDate = isCompleteDateText(input.receiveDate) ? input.receiveDate : "";
  let calibrationDate = isCompleteDateText(input.calibrationDate) ? input.calibrationDate : "";
  let releaseDate = isCompleteDateText(input.releaseDate) ? input.releaseDate : "";

  if (!receiveDate && calibrationDate) receiveDate = calibrationDate;
  if (!calibrationDate && receiveDate) calibrationDate = receiveDate;

  const baseDate = calibrationDate || receiveDate;
  if (!releaseDate && baseDate) releaseDate = shiftDateText(baseDate, 1);

  if (!receiveDate && !calibrationDate && releaseDate) {
    const prev = shiftDateText(releaseDate, -1);
    if (prev) {
      receiveDate = prev;
      calibrationDate = prev;
    }
  }
  if (!receiveDate && calibrationDate) receiveDate = calibrationDate;
  if (!calibrationDate && receiveDate) calibrationDate = receiveDate;

  return { receiveDate, calibrationDate, releaseDate };
}
