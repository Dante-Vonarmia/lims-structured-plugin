function composeDateText(parts) {
  const year = String((parts && parts.year) || "");
  const month = String((parts && parts.month) || "");
  const day = String((parts && parts.day) || "");
  if (!year && !month && !day) return "";
  return `${year}${year ? "年" : ""}${month ? `${month}月` : ""}${day ? `${day}日` : ""}`;
}

function isCompleteDateParts(parts) {
  return !!(parts && parts.year && parts.month && parts.day);
}

function parseDateTextParts(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const m = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const year = String(m[1] || "");
  const month = String(Number.parseInt(m[2] || "0", 10) || 0).padStart(2, "0");
  const day = String(Number.parseInt(m[3] || "0", 10) || 0).padStart(2, "0");
  if (!year || month === "00" || day === "00") return null;
  return { year, month, day };
}

function syncDateMeta(field) {
  const next = { ...(field || {}) };
  next.value = composeDateText(next);
  next.exact = isCompleteDateParts(next);
  return next;
}

function normalizeDateFields(fields = {}) {
  return {
    receive_date: syncDateMeta((fields && fields.receive_date) || {}),
    calibration_date: syncDateMeta((fields && fields.calibration_date) || {}),
    release_date: syncDateMeta((fields && fields.release_date) || {}),
  };
}

function mergeDateFieldPatch(current = {}, patch = {}) {
  const next = { ...current };
  Object.entries(patch).forEach(([key, value]) => {
    if (!key) return;
    next[key] = syncDateMeta({ ...(next[key] || {}), ...(value || {}) });
  });
  return next;
}

export function createDateLinkageRules(deps = {}) {
  const shiftDateText = deps && deps.shiftDateText;
  return [
    {
      id: "sync-receive-calibration-part",
      when: (ctx = {}) => {
        const changedField = String(ctx.changedField || "");
        const changedPart = String(ctx.changedPart || "");
        const isPairField = changedField === "receive_date" || changedField === "calibration_date";
        const isDatePart = changedPart === "year" || changedPart === "month" || changedPart === "day";
        return isPairField && isDatePart;
      },
      apply: (ctx = {}, current = {}) => {
        const changedField = String(ctx.changedField || "");
        const changedPart = String(ctx.changedPart || "");
        const pairField = changedField === "receive_date" ? "calibration_date" : "receive_date";
        const changed = current[changedField] || {};
        return {
          [pairField]: {
            [changedPart]: String(changed[changedPart] || ""),
          },
        };
      },
    },
    {
      id: "release-plus-one-day",
      when: (ctx = {}, current = {}) => {
        const changedField = String(ctx.changedField || "");
        if (!(changedField === "receive_date" || changedField === "calibration_date")) return false;
        if (typeof shiftDateText !== "function") return false;
        const base = current[changedField] || {};
        return isCompleteDateParts(base);
      },
      apply: (ctx = {}, current = {}) => {
        const changedField = String(ctx.changedField || "");
        const base = current[changedField] || {};
        const baseDateText = composeDateText(base);
        const shifted = String(shiftDateText(baseDateText, 1) || "");
        const releaseParts = parseDateTextParts(shifted);
        if (!releaseParts) return {};
        return {
          release_date: releaseParts,
        };
      },
    },
  ];
}

export function applyDateLinkageRules(input = {}) {
  const ctx = {
    changedField: String(input.changedField || ""),
    changedPart: String(input.changedPart || ""),
  };
  const rules = createDateLinkageRules({ shiftDateText: input.shiftDateText });
  let current = normalizeDateFields(input.fields || {});
  rules.forEach((rule) => {
    if (!rule || typeof rule.when !== "function" || typeof rule.apply !== "function") return;
    if (!rule.when(ctx, current)) return;
    const patch = rule.apply(ctx, current);
    current = mergeDateFieldPatch(current, patch);
  });
  return current;
}

