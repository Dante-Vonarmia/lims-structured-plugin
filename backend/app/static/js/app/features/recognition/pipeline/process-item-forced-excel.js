export async function handleForcedExcelSingleBranch(deps = {}) {
  const {
    item,
    forceAsExcel,
    isExcelItem,
    renderQueue,
    uploadFile,
    runOcr,
    runExtract,
    createEmptyFields,
    buildExcelRecordItems,
    applyAutoTemplateMatch,
    state,
    appendLog,
    renderTemplateSelect,
  } = deps;

  if (!(forceAsExcel && !isExcelItem(item))) return false;

  item.status = "processing";
  item.message = "按XLS单条识别中";
  item.reportId = "";
  item.reportDownloadUrl = "";
  item.reportFileName = "";
  item.reportGenerateMode = "";
  item.modeReports = {};
  renderQueue();
  if (!item.fileId) {
    const up = await uploadFile(item.file);
    item.fileId = up.file_id;
  }
  const ocr = await runOcr(item.fileId);
  item.rawText = ocr.raw_text || "";
  item.ocrStructured = (ocr && ocr.structured) || {};
  const fields = await runExtract(item.rawText);
  const mergedFields = {
    ...createEmptyFields(),
    ...fields,
    raw_record: item.rawText || "",
    source_profile: "forced_excel_single",
    source_profile_label: "强制XLS-单条",
  };
  const inspect = {
    records: [
      {
        sheet_name: "FORCED",
        row_number: 1,
        row_name: mergedFields.device_name || mergedFields.device_code || "row_1",
        template_name: "",
        fields: mergedFields,
      },
    ],
  };
  const recordRows = buildExcelRecordItems(item, inspect);
  if (!recordRows.length) {
    item.recordCount = 1;
    item.category = "Excel批量";
    item.status = "error";
    item.message = "按XLS单条识别失败";
    renderQueue();
    return true;
  }
  for (const recordItem of recordRows) {
    if (!recordItem.templateName) await applyAutoTemplateMatch(recordItem, { force: true });
  }
  const index = state.queue.findIndex((x) => x.id === item.id);
  if (index >= 0) {
    state.queue.splice(index, 1, ...recordRows);
    state.activeId = recordRows[0].id;
  }
  appendLog(`强制XLS单条识别完成 ${item.fileName}：${recordRows.length} 条`);
  renderQueue();
  renderTemplateSelect();
  return true;
}
