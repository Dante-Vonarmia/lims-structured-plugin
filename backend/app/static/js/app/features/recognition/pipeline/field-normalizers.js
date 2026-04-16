export function parseManufactureYearMonthToken(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/[oO]/g, "0")
    .replace(/[lI]/g, "1")
    .replace(/[，。]/g, ".")
    .replace(/[年/-]/g, ".")
    .replace(/月/g, "")
    .replace(/\s+/g, "")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
  const parts = normalized.split(".").filter(Boolean);
  if (parts.length !== 2) return null;
  const left = String(parts[0] || "").trim();
  const right = String(parts[1] || "").trim();
  if (!/^\d{1,4}$/.test(left) || !/^\d{1,4}$/.test(right)) return null;

  const leftNum = Number(left);
  const rightNum = Number(right);
  const padMonth = (n) => String(n).padStart(2, "0");
  const padYear = (text) => {
    const yearText = String(text || "").trim();
    if (!yearText) return "";
    if (yearText.length >= 2) return yearText.slice(-2);
    return yearText.padStart(2, "0");
  };
  const build = (yearText, monthNum, reversed) => ({
    normalized: `${padYear(yearText)}.${padMonth(monthNum)}`,
    yearText: padYear(yearText),
    monthText: padMonth(monthNum),
    reversed,
    warning: reversed ? `制造年月从 ${raw} 自动校正为 ${padYear(yearText)}.${padMonth(monthNum)}` : "",
  });

  if (leftNum >= 0 && leftNum <= 99 && rightNum >= 1 && rightNum <= 12) {
    return build(left, rightNum, false);
  }
  if (leftNum >= 1 && leftNum <= 12 && rightNum >= 0 && rightNum <= 99) {
    return build(right, leftNum, true);
  }
  if (left.length === 4 && rightNum >= 1 && rightNum <= 12) {
    return build(left, rightNum, false);
  }
  if (leftNum >= 1 && leftNum <= 12 && right.length === 4) {
    return build(right, leftNum, true);
  }
  return null;
}
