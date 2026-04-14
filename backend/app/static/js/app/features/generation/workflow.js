export function createGenerationWorkflowFeature(deps = {}) {
  const {
    state,
    isExcelItem,
    uploadFile,
    processItem,
    ensureSourceFileId,
    renderQueue,
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
    const payload = {
      template_name: isModifyCertificate
        ? (item.sourceFileName || item.fileName || item.templateName || "")
        : item.templateName,
      source_file_id: item.fileId || null,
      source_file_as_template: isModifyCertificate,
      fields: {
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
