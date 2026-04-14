export function resolveFieldRule(schemaRules, col) {
  const fieldRules = (schemaRules && typeof schemaRules.field_rules === "object" && schemaRules.field_rules)
    ? schemaRules.field_rules
    : {};
  const key = String((col && col.key) || "").trim();
  const label = String((col && col.label) || "").trim();
  if (label && fieldRules[label] && typeof fieldRules[label] === "object") return fieldRules[label];
  if (key && fieldRules[key] && typeof fieldRules[key] === "object") return fieldRules[key];
  return {};
}

