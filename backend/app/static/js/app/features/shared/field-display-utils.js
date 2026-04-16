export function normalizeDisplayText(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text === "undefined" || text === "null") return "";
  return text;
}

export function resolveFieldFallbackValue(fieldKey, rowFields = {}) {
  const fields = (rowFields && typeof rowFields === "object") ? rowFields : {};
  if (fieldKey === "manufacture_date") {
    return normalizeDisplayText(fields.col_11 || fields["制造年月"] || "");
  }
  return "";
}

export function isYearMonthField({ key = "", label = "", typedType = "" } = {}) {
  return label === "制造年月" || key === "manufacture_date" || typedType === "year_month";
}
