export function isBooleanTrueValue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function isBooleanFalseValue(value) {
  return String(value || "").trim().toLowerCase() === "false";
}

export function isBooleanTextValue(value) {
  return isBooleanTrueValue(value) || isBooleanFalseValue(value);
}

export function renderBooleanDisplayHtml(value, emptyHtml = '<span class="source-recog-empty">（空）</span>') {
  if (isBooleanTrueValue(value)) {
    return '<span class="source-field-value">✓</span>';
  }
  if (isBooleanFalseValue(value)) {
    return emptyHtml;
  }
  return "";
}
