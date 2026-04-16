import { formatDateFromParts } from "./text-date-utils.js";

export function getTodayDateParts(now = new Date()) {
  const current = now instanceof Date ? now : new Date();
  if (Number.isNaN(current.getTime())) {
    return { year: "", month: "", day: "" };
  }
  return {
    year: String(current.getFullYear()).padStart(4, "0"),
    month: String(current.getMonth() + 1).padStart(2, "0"),
    day: String(current.getDate()).padStart(2, "0"),
  };
}

export function resolveFieldDefaultValue({ field, value, isMixed = false, now = new Date() } = {}) {
  const policy = field && typeof field.defaultValuePolicy === "object" ? field.defaultValuePolicy : null;
  const currentValue = String(value || "").trim();
  if (!policy || isMixed) return "";
  const when = String(policy.when || "empty").trim();
  if (when === "empty" && currentValue) return "";
  const type = String(policy.type || "").trim();
  if (type === "today") {
    return formatDateFromParts(getTodayDateParts(now));
  }
  return "";
}
