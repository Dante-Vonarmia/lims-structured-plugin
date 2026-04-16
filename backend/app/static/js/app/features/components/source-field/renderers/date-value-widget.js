export function createDateValueWidgetRenderer(deps = {}) {
  const { escapeHtml, parseDateParts } = deps;

  function parseLooseDatePartsNoInference(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const full = parseDateParts(text);
    if (full) return full;
    const yearless = text.match(/^\s*([zZ]?\d{1,2})\s*[.\-/、]\s*(\d{1,2})\s*$/);
    if (yearless) {
      const monthRaw = Number(String(yearless[1] || "").replace(/^[zZ]/, "2")) || 0;
      const dayRaw = Number(yearless[2] || "") || 0;
      if (monthRaw < 1 || monthRaw > 12 || dayRaw < 1 || dayRaw > 31) return null;
      return { year: "", month: String(monthRaw).padStart(2, "0"), day: String(dayRaw).padStart(2, "0") };
    }
    const cn = text.match(/^\s*(?:(\d{2,4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*$/);
    if (cn) {
      const monthRaw = Number(cn[2] || "") || 0;
      const dayRaw = Number(cn[3] || "") || 0;
      if (monthRaw < 1 || monthRaw > 12 || dayRaw < 1 || dayRaw > 31) return null;
      const yRaw = String(cn[1] || "").trim();
      return {
        year: yRaw ? String(Number(yRaw) || "") : "",
        month: String(monthRaw).padStart(2, "0"),
        day: String(dayRaw).padStart(2, "0"),
      };
    }
    const ymd = text.match(/^\s*(\d{2,4})\s*[.\-/、]\s*(\d{1,2})\s*[.\-/、]\s*(\d{1,2})\s*$/);
    if (!ymd) return null;
    const monthRaw = Number(ymd[2] || "") || 0;
    const dayRaw = Number(ymd[3] || "") || 0;
    if (monthRaw < 1 || monthRaw > 12 || dayRaw < 1 || dayRaw > 31) return null;
    const yRaw = String(ymd[1] || "").trim();
    return {
      year: yRaw ? String(Number(yRaw) || "") : "",
      month: String(monthRaw).padStart(2, "0"),
      day: String(dayRaw).padStart(2, "0"),
    };
  }

  function renderDateValueWidget(valueText) {
    const dateParts = parseLooseDatePartsNoInference(valueText);
    if (!dateParts) return "";
    const year = String(dateParts.year || "").trim();
    const month = String(dateParts.month || "").trim();
    const day = String(dateParts.day || "").trim();
    const isoText = year && month && day ? `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : "";
    if (isoText) {
      return `<span class="source-field-value">${escapeHtml(isoText)}</span>`;
    }
    return `
      <span class="calib-date-grid source-date-grid">
        ${year ? `<span class="calib-date-part">${escapeHtml(year)}</span><span class="calib-date-unit">年</span>` : ""}
        ${month ? `<span class="calib-date-part">${escapeHtml(month)}</span><span class="calib-date-unit">月</span>` : ""}
        ${day ? `<span class="calib-date-part">${escapeHtml(day)}</span><span class="calib-date-unit">日</span>` : ""}
      </span>
    `;
  }

  return {
    renderDateValueWidget,
  };
}
