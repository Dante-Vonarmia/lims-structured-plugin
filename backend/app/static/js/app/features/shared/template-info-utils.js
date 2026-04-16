import { normalizeDisplayText } from "./field-display-utils.js";

export function normalizeTaskTemplateInfo(raw) {
  const src = (raw && typeof raw === "object") ? raw : {};
  return {
    info_title: normalizeDisplayText(src.info_title),
    file_no: normalizeDisplayText(src.file_no),
    inspect_standard: normalizeDisplayText(src.inspect_standard),
    record_no: normalizeDisplayText(src.record_no),
    submit_org: normalizeDisplayText(src.submit_org),
  };
}

function listAliasKeys(schemaRules, key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return [];
  const rules = (schemaRules && typeof schemaRules === "object") ? schemaRules : {};
  const aliasMap = (rules.aliases && typeof rules.aliases === "object") ? rules.aliases : {};
  const aliases = [];
  const seen = new Set([normalizedKey]);
  const pushAlias = (value) => {
    const aliasKey = String(value || "").trim();
    if (!aliasKey || seen.has(aliasKey)) return;
    seen.add(aliasKey);
    aliases.push(aliasKey);
  };
  const direct = Array.isArray(aliasMap[normalizedKey]) ? aliasMap[normalizedKey] : [];
  direct.forEach(pushAlias);
  Object.entries(aliasMap).forEach(([canonicalKey, aliasList]) => {
    if (!Array.isArray(aliasList)) return;
    if (!aliasList.map((x) => String(x || "").trim()).includes(normalizedKey)) return;
    pushAlias(canonicalKey);
  });
  return aliases;
}

function resolveAliasedValue(source, keys) {
  const src = (source && typeof source === "object") ? source : {};
  for (const key of keys) {
    const value = normalizeDisplayText(src[key]);
    if (value) return value;
  }
  return "";
}

export function getAliasedFieldValue({ fields, taskTemplateInfo, key, schemaRules }) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return "";
  const aliases = listAliasKeys(schemaRules, normalizedKey);
  const candidates = [normalizedKey, ...aliases];
  const rowValue = resolveAliasedValue(fields, candidates);
  if (rowValue) return rowValue;
  return resolveAliasedValue(taskTemplateInfo, candidates);
}

export function getTemplateInfoValue({ item, taskTemplateInfo, key, schemaRules }) {
  const rowFields = (item && item.fields && typeof item.fields === "object") ? item.fields : {};
  return getAliasedFieldValue({
    fields: rowFields,
    taskTemplateInfo,
    key,
    schemaRules,
  });
}
