export function resolveSchemaGroups(schemaColumns = [], schemaGroupsRaw = []) {
  const cols = Array.isArray(schemaColumns) ? schemaColumns : [];
  const groupsRaw = Array.isArray(schemaGroupsRaw) ? schemaGroupsRaw : [];
  if (groupsRaw.length) {
    return groupsRaw.map((group, idx) => ({
      key: `schema-group-${idx + 1}`,
      name: String((group && group.name) || "").trim() || `分组${idx + 1}`,
      columns: Array.isArray(group && group.columns) ? group.columns : [],
    }));
  }
  const map = new Map();
  cols.forEach((col) => {
    const name = String((col && col.group) || "").trim() || "未分组";
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(col);
  });
  return Array.from(map.entries()).map(([name, columns], idx) => ({
    key: `schema-group-${idx + 1}`,
    name,
    columns,
  }));
}

