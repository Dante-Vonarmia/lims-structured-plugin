export function createMatchingValidationFeature(deps = {}) {
  const {
    TEMPLATE_GENERATION_RULES,
    TEMPLATE_REQUIRED_FIELDS,
    normalizeValidationToken,
  } = deps;

  function isPlaceholderValue(value) {
    const text = String(value || "").trim();
    if (!text) return true;
    return /^[-/—–_]+$/.test(text);
  }

  function hasMeaningfulValue(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    if (isPlaceholderValue(text)) return false;
    const token = normalizeValidationToken(text);
    if (!token) return false;
    return !new Set([
      "instrumentname", "devicename", "equipmentname", "modelspecification", "instrumentserialnumber",
      "serialnumber", "manufacturer", "client", "器具名称", "设备名称", "仪器名称",
      "型号规格", "型号", "编号", "器具编号", "设备编号", "生产厂商", "制造厂商", "厂家", "厂商",
    ]).has(token);
  }

  function countMeasurementItems(fields) {
    const countText = String((fields && fields.measurement_item_count) || "").trim();
    const parsed = Number.parseInt(countText, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const raw = String((fields && fields.measurement_items) || "");
    return raw.split("\n").map((x) => x.trim()).filter(Boolean).length;
  }

  function resolveTemplateGenerationRule(templateName) {
    const name = String(templateName || "");
    return TEMPLATE_GENERATION_RULES.find((rule) => rule.pattern.test(name)) || TEMPLATE_GENERATION_RULES[TEMPLATE_GENERATION_RULES.length - 1];
  }

  function resolveTemplateRequiredFields(item) {
    if (!item || !item.templateName) return [];
    const rule = resolveTemplateGenerationRule(item.templateName);
    const id = String((rule && rule.id) || "default").trim();
    const fields = TEMPLATE_REQUIRED_FIELDS[id];
    return Array.isArray(fields) ? fields : [];
  }

  function validateItemForGeneration(item, generateMode = "certificate_template") {
    if (!item || generateMode === "source_file") return { ok: true, summary: "", issues: [] };
    const fields = item.fields || {};
    const issues = [];

    if (!item.templateName) issues.push("模板");
    if (!hasMeaningfulValue(fields.device_name)) issues.push("器具名称");
    if (!(hasMeaningfulValue(fields.device_model) || hasMeaningfulValue(fields.device_code))) issues.push("型号规格或器具编号");
    if (!hasMeaningfulValue(fields.manufacturer)) issues.push("生产厂商");

    const groupCount = Number.parseInt(String(fields.device_group_count || "0"), 10) || 0;
    if (groupCount > 1) issues.push(`来源文件包含${groupCount}组器具信息（需拆分后再生成）`);

    return {
      ok: issues.length === 0,
      issues,
      summary: issues.join("、"),
    };
  }

  return {
    isPlaceholderValue,
    hasMeaningfulValue,
    countMeasurementItems,
    resolveTemplateGenerationRule,
    resolveTemplateRequiredFields,
    validateItemForGeneration,
  };
}
