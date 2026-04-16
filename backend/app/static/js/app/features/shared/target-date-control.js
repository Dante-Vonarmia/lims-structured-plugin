export function resolveTargetDateMode(fieldKey = "", fieldLabel = "") {
  const key = String(fieldKey || "").trim();
  const label = String(fieldLabel || "").trim();
  if (key === "manufacture_date" || label === "制造年月") return "year_month";
  if (key === "last_inspection_date" || key === "next_inspection_date" || label === "上次检验日期" || label === "下次检验日期") {
    return "month_day";
  }
  return "full_date";
}

export function parseTargetDateParts(value, mode = "full_date", parseDateParts = null) {
  const text = String(value || "").trim();
  if (!text) return { year: "", month: "", day: "" };

  if (mode === "full_date" && typeof parseDateParts === "function") {
    const full = parseDateParts(text);
    if (full) {
      return {
        year: String(full.year || ""),
        month: String(full.month || ""),
        day: String(full.day || ""),
      };
    }
  }

  if (mode === "year_month") {
    const ymCn = text.match(/^\s*(\d{1,4})\s*年\s*(\d{1,2})\s*月?\s*$/);
    if (ymCn) {
      return {
        year: String(ymCn[1] || ""),
        month: String(Number(ymCn[2] || 0) || "").padStart(2, "0"),
        day: "",
      };
    }
    const ymDot = text.match(/^\s*(\d{1,4})\s*[.\-/、]\s*(\d{1,2})\s*$/);
    if (ymDot) {
      return {
        year: String(ymDot[1] || ""),
        month: String(Number(ymDot[2] || 0) || "").padStart(2, "0"),
        day: "",
      };
    }
  }

  if (mode === "month_day") {
    const mdCn = text.match(/^\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*$/);
    if (mdCn) {
      return {
        year: "",
        month: String(Number(mdCn[1] || 0) || "").padStart(2, "0"),
        day: String(Number(mdCn[2] || 0) || "").padStart(2, "0"),
      };
    }
    const mdDot = text.match(/^\s*([zZ]?\d{1,2})\s*[.\-/、]\s*(\d{1,2})\s*$/);
    if (mdDot) {
      return {
        year: "",
        month: String(Number(String(mdDot[1] || "").replace(/^[zZ]/, "2")) || "").padStart(2, "0"),
        day: String(Number(mdDot[2] || 0) || "").padStart(2, "0"),
      };
    }
  }

  const fallbackCn = text.match(/^\s*(?:(\d{1,4})\s*年)?\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日?)?\s*$/);
  if (fallbackCn) {
    return {
      year: String(fallbackCn[1] || ""),
      month: String(Number(fallbackCn[2] || 0) || "").padStart(2, "0"),
      day: fallbackCn[3] ? String(Number(fallbackCn[3] || 0) || "").padStart(2, "0") : "",
    };
  }
  return { year: "", month: "", day: "" };
}

export function isTargetDateComplete(parts = {}, mode = "full_date") {
  const year = String(parts.year || "").trim();
  const month = String(parts.month || "").trim();
  const day = String(parts.day || "").trim();
  if (mode === "year_month") return !!(year && month);
  if (mode === "month_day") return !!(month && day);
  return !!(year && month && day);
}

export function formatTargetDateText(parts = {}, mode = "full_date") {
  const year = String(parts.year || "").trim();
  const month = String(parts.month || "").trim();
  const day = String(parts.day || "").trim();
  if (mode === "year_month") {
    if (!year || !month) return "";
    return `${year}年${month.padStart(2, "0")}月`;
  }
  if (mode === "month_day") {
    if (!month || !day) return "";
    return `${month.padStart(2, "0")}月${day.padStart(2, "0")}日`;
  }
  if (!year || !month || !day) return "";
  return `${year}年${month.padStart(2, "0")}月${day.padStart(2, "0")}日`;
}

export function renderTargetDateControl({
  fieldKey = "",
  fieldLabel = "",
  value = "",
  isProblem = false,
  isMixed = false,
  suggestionParts = {},
  parseDateParts = null,
  escapeAttr = (x) => String(x || ""),
  escapeHtml = (x) => String(x || ""),
  mixedPlaceholder = "",
} = {}) {
  const mode = resolveTargetDateMode(fieldKey, fieldLabel);
  const parts = parseTargetDateParts(value, mode, parseDateParts);
  const showYear = mode !== "month_day";
  const showDay = mode !== "year_month";
  return `
    <input type="hidden" data-field="${escapeAttr(fieldKey)}" data-date-mode="${escapeAttr(mode)}" value="${escapeAttr(value)}" />
    <span class="target-date-grid" data-date-mode="${escapeAttr(mode)}">
      ${showYear ? `<input type="text" class="target-date-input target-date-year ${isProblem ? "is-problem" : ""}" data-date-field="${escapeAttr(fieldKey)}" data-date-mode="${escapeAttr(mode)}" data-date-part="year" value="${escapeAttr(parts.year || "")}" maxlength="4" placeholder="${escapeAttr(isMixed ? mixedPlaceholder : String(suggestionParts.year || ""))}" /><span class="target-date-unit">年</span>` : ""}
      <input type="text" class="target-date-input target-date-month ${isProblem ? "is-problem" : ""}" data-date-field="${escapeAttr(fieldKey)}" data-date-mode="${escapeAttr(mode)}" data-date-part="month" value="${escapeAttr(parts.month || "")}" maxlength="2" placeholder="${escapeAttr(String(suggestionParts.month || ""))}" />
      <span class="target-date-unit">月</span>
      ${showDay ? `<input type="text" class="target-date-input target-date-day ${isProblem ? "is-problem" : ""}" data-date-field="${escapeAttr(fieldKey)}" data-date-mode="${escapeAttr(mode)}" data-date-part="day" value="${escapeAttr(parts.day || "")}" maxlength="2" placeholder="${escapeAttr(String(suggestionParts.day || ""))}" /><span class="target-date-unit">日</span>` : ""}
    </span>
  `;
}
