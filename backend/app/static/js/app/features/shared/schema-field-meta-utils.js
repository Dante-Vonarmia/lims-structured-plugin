function normalizeFieldKey(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return String(value || "").trim();
}

export function getFieldMetaByKey(schemaRules = {}) {
  const fromFields = {};
  const fields = (schemaRules && typeof schemaRules.fields === "object" && schemaRules.fields)
    ? schemaRules.fields
    : {};
  Object.entries(fields).forEach(([rawKey, rawMeta]) => {
    const key = normalizeFieldKey(rawKey);
    if (!key || !rawMeta || typeof rawMeta !== "object") return;
    fromFields[key] = {
      label: normalizeText(rawMeta.label),
      group: normalizeText(rawMeta.group),
      index: Number(rawMeta.index) || 0,
    };
  });

  const rawLegacy = (schemaRules && typeof schemaRules.field_meta_by_key === "object" && schemaRules.field_meta_by_key)
    ? schemaRules.field_meta_by_key
    : {};
  const output = {};
  Object.entries(rawLegacy).forEach(([rawKey, rawMeta]) => {
    const key = normalizeFieldKey(rawKey);
    if (!key || !rawMeta || typeof rawMeta !== "object") return;
    output[key] = {
      label: normalizeText(rawMeta.label),
      group: normalizeText(rawMeta.group),
      index: Number(rawMeta.index) || 0,
    };
  });
  return { ...output, ...fromFields };
}

export function resolveSchemaFieldLabel({ key = "", label = "", schemaRules = {} } = {}) {
  const normalizedKey = normalizeFieldKey(key);
  const normalizedLabel = normalizeText(label);
  const meta = getFieldMetaByKey(schemaRules);
  const byKey = normalizedKey ? meta[normalizedKey] : null;
  const mappedLabel = normalizeText(byKey && byKey.label);
  return mappedLabel || normalizedLabel || normalizedKey;
}

export function normalizeImportTemplateSchemaPayload(schema = {}) {
  const rules = (schema && typeof schema.rules === "object") ? schema.rules : {};
  const metaByKey = getFieldMetaByKey(rules);
  const columnsRaw = Array.isArray(schema.columns) ? schema.columns : [];
  const columns = columnsRaw.map((col, idx) => {
    const key = normalizeFieldKey(col && col.key);
    const meta = key ? metaByKey[key] : null;
    return {
      ...(col && typeof col === "object" ? col : {}),
      index: Number((col && col.index) || (meta && meta.index) || idx),
      key,
      label: normalizeText((meta && meta.label) || (col && col.label) || key),
      group: normalizeText((meta && meta.group) || (col && col.group) || "未分组"),
    };
  }).filter((col) => col.key);

  const groupsRaw = Array.isArray(schema.groups) ? schema.groups : [];
  const groups = groupsRaw.map((group, idx) => {
    const groupName = normalizeText(group && group.name) || `分组${idx + 1}`;
    const groupColumnsRaw = Array.isArray(group && group.columns) ? group.columns : [];
    const groupColumns = groupColumnsRaw.map((col, colIdx) => {
      const key = normalizeFieldKey(col && col.key);
      const meta = key ? metaByKey[key] : null;
      return {
        ...(col && typeof col === "object" ? col : {}),
        index: Number((col && col.index) || (meta && meta.index) || colIdx),
        key,
        label: normalizeText((meta && meta.label) || (col && col.label) || key),
        group: normalizeText((meta && meta.group) || (col && col.group) || groupName),
      };
    }).filter((col) => col.key);
    return {
      ...(group && typeof group === "object" ? group : {}),
      name: groupName,
      columns: groupColumns,
    };
  });

  return {
    template_name: normalizeText(schema && schema.template_name),
    columns,
    groups,
    rules,
  };
}
