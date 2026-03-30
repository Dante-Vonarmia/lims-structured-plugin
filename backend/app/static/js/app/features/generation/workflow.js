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
        instrument_catalog_names: state.instrumentCatalogNames.join("\n"),
        instrument_catalog_rows_json: JSON.stringify(state.instrumentCatalogRows || []),
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
    item.reportFileName = item.sourceFileName || item.fileName || item.templateName || "report.docx";
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
