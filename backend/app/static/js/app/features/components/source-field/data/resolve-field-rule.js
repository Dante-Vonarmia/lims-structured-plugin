export function resolveFieldRule(schemaRules, col) {
  const fields = (schemaRules && typeof schemaRules.fields === "object" && schemaRules.fields)
    ? schemaRules.fields
    : {};
  const fieldRulesByKey = (schemaRules && typeof schemaRules.field_rules_by_key === "object" && schemaRules.field_rules_by_key)
    ? schemaRules.field_rules_by_key
    : {};
  const fieldRules = (schemaRules && typeof schemaRules.field_rules === "object" && schemaRules.field_rules)
    ? schemaRules.field_rules
    : {};
  const key = String((col && col.key) || "").trim();
  const label = String((col && col.label) || "").trim();
  if (key && fields[key] && typeof fields[key] === "object") {
    const { label: _label, index: _index, group: _group, ...rule } = fields[key];
    return rule;
  }
  if (key && fieldRulesByKey[key] && typeof fieldRulesByKey[key] === "object") return fieldRulesByKey[key];
  if (label && fieldRules[label] && typeof fieldRules[label] === "object") return fieldRules[label];
  if (key && fieldRules[key] && typeof fieldRules[key] === "object") return fieldRules[key];
  return {};
}
