export function resolveInfoFields(schemaRules) {
  const info = schemaRules && Array.isArray(schemaRules.info_fields) ? schemaRules.info_fields : [];
  return info.map((item) => {
    if (typeof item === "string") {
      const key = String(item || "").trim();
      return key ? { key, label: key } : null;
    }
    if (!item || typeof item !== "object") return null;
    const key = String(item.key || "").trim();
    const label = String(item.label || "").trim() || key;
    return key ? { key, label } : null;
  }).filter(Boolean);
}

