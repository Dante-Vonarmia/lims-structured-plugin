export function getSchemaColumnsFromState(state) {
  const schema = (state && state.taskContext && state.taskContext.import_template_schema && typeof state.taskContext.import_template_schema === "object")
    ? state.taskContext.import_template_schema
    : { columns: [] };
  return Array.isArray(schema.columns) ? schema.columns : [];
}

export function getSchemaRulesFromState(state) {
  const schema = (state && state.taskContext && state.taskContext.import_template_schema && typeof state.taskContext.import_template_schema === "object")
    ? state.taskContext.import_template_schema
    : { rules: {} };
  const rules = (schema && typeof schema.rules === "object" && schema.rules) ? schema.rules : {};
  return rules;
}

export function normalizeMonthDayToken(token) {
  const t = String(token || "").trim();
  if (!t) return "";
  const m = t.match(/([zZ]?\d{1,2})\s*[.\-/、]\s*(\d{1,2})/);
  if (!m) return "";
  const mmRaw = String(m[1] || "").replace(/^[zZ]/, "2");
  const ddRaw = String(m[2] || "");
  const mm = Number(mmRaw);
  const dd = Number(ddRaw);
  if (!Number.isFinite(mm) || !Number.isFinite(dd)) return "";
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  return `${mm}.${dd}`;
}

export function getSchemaGroupsFromState(state, columns = []) {
  const schema = (state && state.taskContext && state.taskContext.import_template_schema && typeof state.taskContext.import_template_schema === "object")
    ? state.taskContext.import_template_schema
    : { groups: [] };
  const schemaGroups = Array.isArray(schema.groups) ? schema.groups : [];
  if (schemaGroups.length) {
    return schemaGroups.map((group, idx) => {
      const groupName = String((group && group.name) || "").trim() || `分组${idx + 1}`;
      const groupCols = Array.isArray(group && group.columns) ? group.columns : [];
      const cols = groupCols
        .map((col) => ({
          index: Number((col && col.index) || 0),
          key: String((col && col.key) || "").trim(),
          label: String((col && col.label) || "").trim(),
          group: groupName,
        }))
        .filter((col) => col.key);
      return { key: `group_${idx + 1}`, name: groupName, columns: cols };
    }).filter((x) => Array.isArray(x.columns) && x.columns.length);
  }
  const cols = Array.isArray(columns) ? columns : [];
  const map = new Map();
  cols.forEach((col, idx) => {
    const groupName = String((col && col.group) || "").trim() || "未分组";
    if (!map.has(groupName)) map.set(groupName, []);
    map.get(groupName).push({
      index: Number((col && col.index) || idx),
      key: String((col && col.key) || "").trim(),
      label: String((col && col.label) || "").trim(),
      group: groupName,
    });
  });
  return Array.from(map.entries()).map(([name, groupCols], idx) => ({
    key: `group_${idx + 1}`,
    name: String(name || "").trim() || `分组${idx + 1}`,
    columns: groupCols.filter((x) => x.key),
  })).filter((x) => Array.isArray(x.columns) && x.columns.length);
}

export function buildFieldRuleResolver(rules = {}) {
  const fieldRules = (rules && typeof rules.field_rules === "object" && rules.field_rules) ? rules.field_rules : {};
  return (label, key) => {
    const byLabel = fieldRules[String(label || "").trim()];
    if (byLabel && typeof byLabel === "object") return byLabel;
    const byKey = fieldRules[String(key || "").trim()];
    return byKey && typeof byKey === "object" ? byKey : {};
  };
}

export function buildWaitingFieldPipeline(columns = [], rules = {}) {
  const cols = Array.isArray(columns) ? columns : [];
  const getFieldRule = buildFieldRuleResolver(rules);
  const pipeline = {};
  for (let i = 0; i < cols.length; i += 1) {
    const col = cols[i] || {};
    const key = String(col.key || "").trim();
    const label = String(col.label || "").trim();
    const group = String(col.group || "").trim() || "未分组";
    if (!key) continue;
    const rule = getFieldRule(label, key);
    const required = !!rule.required;
    const allowEmpty = (typeof rule.allow_empty === "boolean")
      ? !!rule.allow_empty
      : ((typeof rule.allowEmpty === "boolean") ? !!rule.allowEmpty : (!required || String(rule.type || "").trim() === "optional_blank"));
    pipeline[key] = {
      key,
      label,
      group,
      type: String(rule.type || "string"),
      required,
      allowEmpty,
      parseStrategy: String(rule.parse_strategy || rule.parseStrategy || "from runtime"),
      normalizeStrategy: String(rule.normalize_strategy || rule.normalizeStrategy || "from runtime"),
      displayStrategy: String(rule.display_strategy || rule.displayStrategy || "from runtime"),
      validateRules: (rule.validate_rules && typeof rule.validate_rules === "object")
        ? rule.validate_rules
        : ((rule.validateRules && typeof rule.validateRules === "object") ? rule.validateRules : {}),
      regionHint: String(rule.region_hint || rule.regionHint || ""),
      blockHint: String(rule.block_hint || rule.blockHint || ""),
      expectedPattern: String(rule.expected_pattern || rule.expectedPattern || ""),
      forbiddenPattern: String(rule.forbidden_pattern || rule.forbiddenPattern || ""),
      rawValue: "",
      typedValue: null,
      normalizedValue: "",
      displayValue: "",
      errors: [],
      warnings: [],
      status: "waiting",
    };
  }
  return pipeline;
}

export function buildWaitingGroupPipeline(schemaGroups = []) {
  const groups = Array.isArray(schemaGroups) ? schemaGroups : [];
  const output = {};
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i] || {};
    const name = String(group.name || "").trim();
    if (!name) continue;
    output[name] = {
      key: String(group.key || `group_${i + 1}`),
      name,
      status: "waiting",
      total: Array.isArray(group.columns) ? group.columns.length : 0,
      parsed: 0,
      warning: 0,
      failed: 0,
    };
  }
  return output;
}

export function validateFieldStage(stage) {
  const next = stage && typeof stage === "object" ? { ...stage } : {};
  const rawValue = String(next.rawValue || "").trim();
  const normalizedValue = String(next.normalizedValue || "").trim();
  const allowEmpty = !!next.allowEmpty;
  const required = !!next.required;
  const warnings = [];
  const errors = [];
  if (next.expectedPattern && normalizedValue) {
    try {
      const reg = new RegExp(String(next.expectedPattern));
      if (!reg.test(normalizedValue)) warnings.push(`不匹配 expectedPattern: ${next.expectedPattern}`);
    } catch {
      warnings.push("expectedPattern 非法，已跳过");
    }
  }
  if (next.forbiddenPattern && normalizedValue) {
    try {
      const reg = new RegExp(String(next.forbiddenPattern));
      if (reg.test(normalizedValue)) errors.push(`命中 forbiddenPattern: ${next.forbiddenPattern}`);
    } catch {
      warnings.push("forbiddenPattern 非法，已跳过");
    }
  }
  if (!normalizedValue) {
    if (rawValue) errors.push("解析失败");
    else if (required && !allowEmpty) errors.push("必填字段为空");
  }
  next.errors = errors;
  next.warnings = warnings;
  if (errors.length) next.status = "failed";
  else if (warnings.length) next.status = "warning";
  else if (!normalizedValue && !rawValue) next.status = "waiting";
  else next.status = "parsed";
  if (!next.displayValue) next.displayValue = normalizedValue || rawValue || "";
  return next;
}

export function syncPipelineFromFields(row) {
  if (!row || typeof row !== "object") return;
  const fields = (row.fields && typeof row.fields === "object") ? row.fields : {};
  const pipeline = (row.fieldPipeline && typeof row.fieldPipeline === "object") ? row.fieldPipeline : {};
  Object.keys(pipeline).forEach((key) => {
    const value = String(fields[key] || "").trim();
    const cell = pipeline[key] && typeof pipeline[key] === "object" ? pipeline[key] : null;
    if (!cell) return;
    if (!value) return;
    cell.normalizedValue = value;
    if (!String(cell.displayValue || "").trim()) cell.displayValue = value;
    if (!Array.isArray(cell.errors) || !cell.errors.length) {
      if (!Array.isArray(cell.warnings) || !cell.warnings.length) cell.status = "parsed";
    }
  });
}

