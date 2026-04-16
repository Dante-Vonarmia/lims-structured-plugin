import { getAliasedFieldValue } from "../shared/template-info-utils.js";

export function createGenerationWorkflowFeature(deps = {}) {
  const {
    state,
    isExcelItem,
    uploadFile,
    processItem,
    ensureSourceFileId,
    renderQueue,
    getSelectedNormalItems,
    validateItemForGeneration,
    buildCategoryMessage,
    fetchJson,
    persistTemplateDefaultMapping,
  } = deps;

  function sanitizeDownloadBaseName(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    return text.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
  }

  function stripExt(name) {
    const text = String(name || "").trim();
    if (!text) return "";
    const idx = text.lastIndexOf(".");
    if (idx <= 0) return text;
    return text.slice(0, idx);
  }

  function buildReportFileName(item, outputFormat) {
    const sourceBase = sanitizeDownloadBaseName(stripExt(item.sourceFileName || item.fileName || ""));
    const deviceBase = sanitizeDownloadBaseName((item.fields && item.fields.device_name) || "");
    const fallbackBase = sanitizeDownloadBaseName(stripExt(item.templateName || "")) || "report";
    const baseName = sourceBase || deviceBase || fallbackBase;
    const ext = String(outputFormat || "docx").replace(/^\./, "").trim().toLowerCase() || "docx";
    return `${baseName}.${ext}`;
  }

  async function generateItem(item, generateMode = "certificate_template") {
    if (isExcelItem(item)) throw new Error("Excel 文件请用 Excel 批量生成");
    if (!item.isRecordRow && (!item.fileId || item.status === "pending")) await processItem(item);
    if (item.isRecordRow && !item.fileId) await ensureSourceFileId(item);
    const isModifyCertificate = generateMode === "source_file";
    if (!isModifyCertificate && !item.templateName) throw new Error("未选择模板");
    const validation = validateItemForGeneration(item, generateMode);
    const incompleteSummary = validation.ok ? "" : String(validation.summary || "");
    if (!validation.ok) {
      item.status = "incomplete";
      item.message = buildCategoryMessage(item, `字段不全：${incompleteSummary}（可继续生成）`);
      renderQueue();
    }
    const fieldsForGenerate = {
      ...(item.fields || {}),
    };
    const selectedNormalItems = typeof getSelectedNormalItems === "function" ? getSelectedNormalItems() : [];
    const scopeItems = selectedNormalItems.length > 1 ? selectedNormalItems : [item];
    const normalizeToIsoDate = (raw) => {
      const text = String(raw || "").trim();
      if (!text) return "";
      let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
      if (m) return `${m[1]}-${String(Number(m[2] || 0)).padStart(2, "0")}-${String(Number(m[3] || 0)).padStart(2, "0")}`;
      m = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
      if (m) return `${m[1]}-${String(Number(m[2] || 0)).padStart(2, "0")}-${String(Number(m[3] || 0)).padStart(2, "0")}`;
      return "";
    };
    const pickNonEmpty = (rowFields, keys) => {
      const src = (rowFields && typeof rowFields === "object") ? rowFields : {};
      for (const key of keys) {
        const val = String(src[key] || "").trim();
        if (val) return val;
      }
      return "";
    };
    const taskTemplateInfo = (state.taskContext && state.taskContext.template_info && typeof state.taskContext.template_info === "object")
      ? state.taskContext.template_info
      : {};
    const schemaRules = (state.taskContext && state.taskContext.import_template_schema && state.taskContext.import_template_schema.rules && typeof state.taskContext.import_template_schema.rules === "object")
      ? state.taskContext.import_template_schema.rules
      : {};
    const schemaColumns = (state.taskContext && state.taskContext.import_template_schema && Array.isArray(state.taskContext.import_template_schema.columns))
      ? state.taskContext.import_template_schema.columns
      : [];
    const findSchemaKeyByLabel = (patterns = []) => {
      for (const col of schemaColumns) {
        const key = String((col && col.key) || "").trim();
        const label = String((col && col.label) || "").trim();
        if (!key || !label) continue;
        if (patterns.some((p) => label.includes(p))) return key;
      }
      return "";
    };
    const serialFromLabelKey = findSchemaKeyByLabel(["气瓶编号", "出厂编号", "瓶号"]);
    const makerFromLabelKey = findSchemaKeyByLabel(["制造单位代码", "制造单位代号", "制造单位", "制造代码"]);
    const nextFromLabelKey = findSchemaKeyByLabel(["下次检验日期", "下次检验", "下检日期"]);
    const serialCandidates = [serialFromLabelKey, "factory_serial_no", "serial_no", "device_code", "col_05"].filter(Boolean);
    const makerCandidates = [makerFromLabelKey, "manufacturer_code", "maker_code", "manufacturer", "col_04"].filter(Boolean);
    const nextCandidates = [nextFromLabelKey, "next_inspection_date", "next_check_date", "col_33"].filter(Boolean);
    const appendixRows = scopeItems.map((row, idx) => {
      const rowFields = (row && row.fields && typeof row.fields === "object") ? row.fields : {};
      const rowNo = Number(row && row.rowNumber) || idx + 1;
      return {
        rowNo,
        serialNo: pickNonEmpty(rowFields, serialCandidates),
        makerCode: pickNonEmpty(rowFields, makerCandidates),
        nextDate: normalizeToIsoDate(pickNonEmpty(rowFields, nextCandidates)),
      };
    }).filter((x) => x.serialNo || x.makerCode || x.nextDate);
    const existingAppendixRows = String(fieldsForGenerate.appendix1_rows_text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => String(line || "").trim())
      .filter(Boolean);
    const shouldResetAppendixRows = scopeItems.length > 1 && existingAppendixRows.length !== appendixRows.length;
    if ((shouldResetAppendixRows || !String(fieldsForGenerate.appendix1_rows_text || "").trim()) && appendixRows.length) {
      fieldsForGenerate.appendix1_rows_text = appendixRows.map((x) => [x.serialNo, x.makerCode, x.nextDate].join("\t")).join("\n");
    }
    if (scopeItems.length > 1) {
      const selectedCount = String(scopeItems.length);
      fieldsForGenerate.selected_rows = selectedCount;
      fieldsForGenerate.cylinder_total_count = selectedCount;
    }
    const outputBundleId = String((state.taskContext && state.taskContext.output_bundle_id) || "").trim();
    const defaultBundleTemplateName = outputBundleId ? `bundle:${outputBundleId}` : "";
    const effectiveTemplateName = String(item.templateName || "").trim() || defaultBundleTemplateName;
    if (!effectiveTemplateName) throw new Error("未选择模板");
    const payload = {
      template_name: effectiveTemplateName,
      source_file_id: item.fileId || null,
      source_file_as_template: false,
      fields: {
        info_title: String(fieldsForGenerate.info_title || taskTemplateInfo.info_title || ""),
        file_no: String(fieldsForGenerate.file_no || taskTemplateInfo.file_no || ""),
        inspect_standard: String(fieldsForGenerate.inspect_standard || taskTemplateInfo.inspect_standard || ""),
        record_no: String(fieldsForGenerate.record_no || taskTemplateInfo.record_no || ""),
        submit_org: getAliasedFieldValue({ fields: fieldsForGenerate, taskTemplateInfo, key: "submit_org", schemaRules }),
        submit_org_name: String(fieldsForGenerate.submit_org_name || getAliasedFieldValue({ fields: fieldsForGenerate, taskTemplateInfo, key: "submit_org", schemaRules }) || ""),
        ...fieldsForGenerate,
        raw_record: fieldsForGenerate.raw_record || item.rawText || "",
      },
    };
    const data = await fetchJson("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    item.reportId = data.report_id;
    item.reportDownloadUrl = data.download_url;
    item.reportFileName = buildReportFileName(item, data.output_format);
    item.reportGenerateMode = generateMode;
    const modeReports = item.modeReports && typeof item.modeReports === "object" ? { ...item.modeReports } : {};
    modeReports[generateMode] = {
      reportId: item.reportId,
      reportDownloadUrl: item.reportDownloadUrl,
      reportFileName: item.reportFileName,
    };
    item.modeReports = modeReports;
    if (item.templateUserSelected) {
      await persistTemplateDefaultMapping(item, item.templateName);
    }
    if (incompleteSummary) {
      item.status = "incomplete";
      item.message = buildCategoryMessage(item, `已生成（字段不全：${incompleteSummary}）`);
    } else {
      item.status = "generated";
      item.message = "已生成";
    }
    renderQueue();
    return data;
  }

  return { generateItem };
}
