const FIELD_MEMORY_STORAGE_KEY = "lims.target-field-memory.v1";
const FIELD_MEMORY_LIMIT = 8;

function normalizeString(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeStoredPayload(raw) {
  if (!raw || typeof raw !== "object") return {};
  const normalized = {};
  Object.entries(raw).forEach(([key, value]) => {
    const fieldKey = normalizeString(key);
    if (!fieldKey || !Array.isArray(value)) return;
    const seen = new Set();
    const items = [];
    value.forEach((entry) => {
      const text = normalizeString(entry);
      if (!text || seen.has(text)) return;
      seen.add(text);
      items.push(text);
    });
    if (items.length) normalized[fieldKey] = items.slice(0, FIELD_MEMORY_LIMIT);
  });
  return normalized;
}

function parseDateText(value) {
  const text = normalizeString(value);
  if (!text) return null;
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    return {
      year: String(iso[1] || ""),
      month: String(iso[2] || "").padStart(2, "0"),
      day: String(iso[3] || "").padStart(2, "0"),
    };
  }
  const zh = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (zh) {
    return {
      year: String(zh[1] || ""),
      month: String(zh[2] || "").padStart(2, "0"),
      day: String(zh[3] || "").padStart(2, "0"),
    };
  }
  return null;
}

function formatDateText(parts) {
  const year = normalizeString(parts && parts.year);
  const month = normalizeString(parts && parts.month);
  const day = normalizeString(parts && parts.day);
  if (!year && !month && !day) return "";
  if (!year || !month || !day) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function valuesMatch(currentValue, candidate) {
  return normalizeString(currentValue) === normalizeString(candidate);
}

function findSuggestion(entries, currentValue) {
  const current = normalizeString(currentValue);
  if (!Array.isArray(entries) || !entries.length) return "";
  if (!current) return normalizeString(entries[0] || "");
  const lower = current.toLowerCase();
  const prefixMatch = entries.find((entry) => {
    const text = normalizeString(entry);
    return text && !valuesMatch(current, text) && text.toLowerCase().startsWith(lower);
  });
  if (prefixMatch) return normalizeString(prefixMatch);
  const firstDifferent = entries.find((entry) => !valuesMatch(current, entry));
  return normalizeString(firstDifferent || "");
}

export function createFieldMemoryFeature(deps = {}) {
  const { state } = deps;

  function ensureMemoryStore() {
    if (!state.fieldMemory || typeof state.fieldMemory !== "object") {
      state.fieldMemory = {};
    }
    return state.fieldMemory;
  }

  function loadFieldMemory() {
    try {
      const raw = window.localStorage.getItem(FIELD_MEMORY_STORAGE_KEY);
      if (!raw) {
        state.fieldMemory = {};
        return;
      }
      state.fieldMemory = normalizeStoredPayload(JSON.parse(raw));
    } catch (_) {
      state.fieldMemory = {};
    }
  }

  function persistFieldMemory() {
    try {
      window.localStorage.setItem(FIELD_MEMORY_STORAGE_KEY, JSON.stringify(ensureMemoryStore()));
    } catch (_) {
      // noop
    }
  }

  function buildMemoryKeyFromTarget(target) {
    if (!(target instanceof HTMLElement)) return "";
    const templateInfoKey = normalizeString(target.getAttribute("data-template-info"));
    if (templateInfoKey) return templateInfoKey;
    const dateField = normalizeString(target.getAttribute("data-date-field"));
    if (dateField) return dateField;
    const key = normalizeString(target.getAttribute("data-field"));
    if (!key) return "";
    if (key === "measurement_item_cell" || key === "general_check_cell") {
      const col = normalizeString(target.getAttribute("data-col"));
      return col ? `${key}:${col}` : key;
    }
    return key;
  }

  function readDateValue(fieldKey, formRoot) {
    const root = formRoot instanceof HTMLElement ? formRoot : document;
    const hidden = root.querySelector(`input[type="hidden"][data-field="${fieldKey}"]`);
    if (hidden instanceof HTMLInputElement && normalizeString(hidden.value)) {
      return normalizeString(hidden.value);
    }
    const year = root.querySelector(`input[data-date-field="${fieldKey}"][data-date-part="year"]`);
    const month = root.querySelector(`input[data-date-field="${fieldKey}"][data-date-part="month"]`);
    const day = root.querySelector(`input[data-date-field="${fieldKey}"][data-date-part="day"]`);
    return formatDateText({
      year: year instanceof HTMLInputElement ? year.value : "",
      month: month instanceof HTMLInputElement ? month.value : "",
      day: day instanceof HTMLInputElement ? day.value : "",
    });
  }

  function readValueFromTarget(target, formRoot) {
    if (!(target instanceof HTMLElement)) return "";
    const dateField = normalizeString(target.getAttribute("data-date-field"));
    if (dateField) return readDateValue(dateField, formRoot);
    if (target instanceof HTMLInputElement) {
      if (target.type === "checkbox") return target.checked ? "true" : "false";
      return normalizeString(target.value);
    }
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return normalizeString(target.value);
    }
    if (target.getAttribute("contenteditable") === "true") {
      return normalizeString(target.textContent);
    }
    return "";
  }

  function rememberFieldValue(memoryKey, value) {
    const key = normalizeString(memoryKey);
    const text = normalizeString(value);
    if (!key || !text) return;
    const store = ensureMemoryStore();
    const current = Array.isArray(store[key]) ? store[key].map((x) => normalizeString(x)).filter(Boolean) : [];
    const next = [text].concat(current.filter((x) => x !== text)).slice(0, FIELD_MEMORY_LIMIT);
    store[key] = next;
    persistFieldMemory();
  }

  function rememberFieldValueFromTarget(target, formRoot) {
    const memoryKey = buildMemoryKeyFromTarget(target);
    const value = readValueFromTarget(target, formRoot);
    rememberFieldValue(memoryKey, value);
  }

  function getFieldSuggestion(memoryKey, currentValue = "") {
    const key = normalizeString(memoryKey);
    if (!key) return "";
    const store = ensureMemoryStore();
    return findSuggestion(store[key], currentValue);
  }

  function formatSuggestionLabel(value, type = "text") {
    const text = normalizeString(value);
    if (!text) return "";
    if (type === "boolean") {
      return text === "true" ? "✓" : "留空";
    }
    return text;
  }

  function applySuggestionToTarget(target, suggestion, formRoot) {
    if (!(target instanceof HTMLElement)) return false;
    const text = normalizeString(suggestion);
    if (!text) return false;
    const dateField = normalizeString(target.getAttribute("data-date-field"));
    if (dateField) {
      const parts = parseDateText(text);
      if (!parts) return false;
      const root = formRoot instanceof HTMLElement ? formRoot : document;
      const hidden = root.querySelector(`input[type="hidden"][data-field="${dateField}"]`);
      const year = root.querySelector(`input[data-date-field="${dateField}"][data-date-part="year"]`);
      const month = root.querySelector(`input[data-date-field="${dateField}"][data-date-part="month"]`);
      const day = root.querySelector(`input[data-date-field="${dateField}"][data-date-part="day"]`);
      if (year instanceof HTMLInputElement) year.value = parts.year;
      if (month instanceof HTMLInputElement) month.value = parts.month;
      if (day instanceof HTMLInputElement) day.value = parts.day;
      if (hidden instanceof HTMLInputElement) {
        hidden.value = formatDateText(parts);
        hidden.dispatchEvent(new Event("input", { bubbles: true }));
        hidden.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }
    if (target instanceof HTMLInputElement) {
      if (target.type === "checkbox") {
        target.checked = text === "true";
      } else {
        target.value = text;
      }
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      target.value = text;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    if (target.getAttribute("contenteditable") === "true") {
      target.textContent = text;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }

  function acceptSuggestionFromTarget(target, formRoot) {
    const memoryKey = buildMemoryKeyFromTarget(target);
    const currentValue = readValueFromTarget(target, formRoot);
    if (!currentValue) return false;
    const suggestion = getFieldSuggestion(memoryKey, currentValue);
    if (!suggestion) return false;
    return applySuggestionToTarget(target, suggestion, formRoot);
  }

  return {
    loadFieldMemory,
    rememberFieldValue,
    rememberFieldValueFromTarget,
    getFieldSuggestion,
    formatSuggestionLabel,
    acceptSuggestionFromTarget,
  };
}
