export function createMatchingWorkflowFeature(deps = {}) {
  const {
    state,
    extFromName,
    isExcelExt,
    isExcelItem,
    runTemplateMatch,
    runTemplateFeedback,
    resolveBlankTemplateName,
    validateItemForGeneration,
    applyIncompleteState,
    appendLog,
    getTaskDefaultTemplateName,
  } = deps;

  function inferCategory(item) {
    const ext = extFromName(item && item.fileName ? item.fileName : "");
    if (isExcelExt(ext)) return "Excel批量";
    const fields = (item && item.fields) || {};
    const name = (fields.device_name || "").trim();
    if (name) return name;
    const code = item && item.sourceCode ? item.sourceCode.toUpperCase() : "";
    if (code) return `代号:${code}`;
    return "未分类";
  }

  function resolveSourceProfileLabel(item) {
    const fields = (item && item.fields) || {};
    const explicit = String(fields.source_profile_label || "").trim();
    if (explicit) return explicit;
    const profile = String(fields.source_profile || "").trim();
    if (!profile) return "";
    if (profile === "excel_row") return "Excel行";
    if (profile === "multi_device_baseinfo_word") return "多基础信息Word";
    if (profile === "template_form_word") return "模板单记录Word";
    if (profile === "single_device_with_scope") return "单设备含范围";
    if (profile === "single_device_general") return "单设备通用";
    if (profile === "multi_device_baseinfo_word_split") return "多基础信息Word-拆分";
    return profile;
  }

  function buildCategoryMessage(item, suffix) {
    const category = (item && item.category) || "未分类";
    const profile = resolveSourceProfileLabel(item);
    const profileText = profile ? `；形态:${profile}` : "";
    return `分类:${category}${profileText}；${suffix}`;
  }

  function getTemplateMatchRawText(item) {
    if (!item) return "";
    const fields = item.fields || {};
    const hasBaseDeviceName = !!String(fields.device_name || "").trim();
    if (hasBaseDeviceName) {
      return [
        fields.device_name || "",
        fields.device_model || "",
        fields.device_code || "",
        item.fileName || "",
        item.sourceCode || "",
      ].filter(Boolean).join("\n");
    }
    return [
      item.rawText || "",
      fields.raw_record || "",
      fields.device_name || "",
      fields.device_model || "",
      fields.device_code || "",
      item.sourceCode || "",
    ].filter(Boolean).join("\n");
  }

  async function persistTemplateDefaultMapping(item, templateName) {
    if (!item) return;
    const normalizedTemplate = String(templateName || "").trim();
    if (!normalizedTemplate) return;
    const fields = item.fields || {};
    try {
      await runTemplateFeedback({
        template_name: normalizedTemplate,
        raw_text: getTemplateMatchRawText(item),
        file_name: String(item.fileName || ""),
        device_name: String(fields.device_name || ""),
        device_model: String(fields.device_model || ""),
        device_code: String(fields.device_code || ""),
        manufacturer: String(fields.manufacturer || ""),
        save_pending: false,
      });
    } catch (error) {
      appendLog(`默认模板保存失败：${error.message || "unknown"}`);
    }
  }

  async function applyAutoTemplateMatch(item, { force = false } = {}) {
    if (!item || isExcelItem(item)) return false;
    if (!force && item.templateName) return true;

    let matchedTemplate = "";
    let matchedBy = "";
    const rawText = getTemplateMatchRawText(item);
    const matchFileNameHint = (item && item.isRecordRow && item.fields && item.fields.device_name)
      ? String(item.fields.device_name || "").trim()
      : (item.fileName || "");
    try {
      const fields = (item && item.fields) || {};
      const data = await runTemplateMatch(rawText, matchFileNameHint, {
        device_name: String(fields.device_name || ""),
        device_code: String(fields.device_code || ""),
      });
      if (data && data.matched_template && state.templates.includes(data.matched_template)) {
        matchedTemplate = data.matched_template;
        matchedBy = data.matched_by || "";
      }
    } catch (error) {
      appendLog(`模板匹配失败 ${item.fileName}：${error.message || "unknown"}`);
    }

    if (!matchedTemplate) {
      const taskDefaultTemplateName = typeof getTaskDefaultTemplateName === "function"
        ? String(getTaskDefaultTemplateName() || "").trim()
        : "";
      if (taskDefaultTemplateName && state.templates.includes(taskDefaultTemplateName)) {
        matchedTemplate = taskDefaultTemplateName;
        matchedBy = "task:export_default";
      }
    }

    if (!matchedTemplate) {
      const blankName = resolveBlankTemplateName();
      if (blankName) {
        matchedTemplate = blankName;
        matchedBy = "fallback:blank";
      }
    }

    item.templateName = matchedTemplate || "";
    item.matchedBy = matchedBy || "";
    item.templateUserSelected = false;
    item.status = "ready";
    if (matchedTemplate) {
      const validation = validateItemForGeneration(item, "certificate_template");
      if (!validation.ok) {
        applyIncompleteState(item, validation);
        if (item.matchedBy) item.message += `（${item.matchedBy}）`;
        return false;
      }
      item.message = buildCategoryMessage(item, "模板已自动命中");
      if (item.matchedBy) item.message += `（${item.matchedBy}）`;
      return true;
    }
    item.message = buildCategoryMessage(item, "识别完成，待匹配模板");
    return false;
  }

  return {
    inferCategory,
    resolveSourceProfileLabel,
    buildCategoryMessage,
    getTemplateMatchRawText,
    persistTemplateDefaultMapping,
    applyAutoTemplateMatch,
  };
}
