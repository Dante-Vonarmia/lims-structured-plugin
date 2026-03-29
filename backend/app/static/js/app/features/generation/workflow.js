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
    if (generateMode === "source_file") {
      if (!item.fileId) {
        const up = await uploadFile(item.file);
        item.fileId = up.file_id;
      }
      if (!item.fileId) throw new Error("证书模板来源文件未上传，无法生成");
      item.reportId = `source_${item.fileId}`;
      item.reportDownloadUrl = `/api/upload/${item.fileId}/download`;
      item.reportFileName = item.fileName || "source_file";
      item.status = "generated";
      item.message = "已导出证书模板来源文件（未套模板）";
      renderQueue();
      return { report_id: item.reportId, download_url: item.reportDownloadUrl };
    }
    if (!item.templateName) throw new Error("未选择模板");
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
      template_name: item.templateName,
      source_file_id: item.fileId || null,
      fields: {
        ...fieldsForGenerate,
        instrument_catalog_names: state.instrumentCatalogNames.join("\n"),
        instrument_catalog_rows_json: JSON.stringify(state.instrumentCatalogRows || []),
        raw_record: item.rawText || fieldsForGenerate.raw_record || "",
      },
    };
    const data = await fetchJson("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    item.reportId = data.report_id;
    item.reportDownloadUrl = data.download_url;
    item.reportFileName = item.templateName || "report.docx";
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
