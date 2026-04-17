export async function handleExcelSingleBranch(deps = {}) {
  const {
    item,
    forceAsExcel,
    isExcelItem,
    renderQueue,
    uploadFile,
    runExcelInspect,
    buildExcelRecordItems,
    applyAutoTemplateMatch,
    state,
    renderTemplateSelect,
    progressCallback,
  } = deps;
  const reportProgress = (phase, progress, message = "") => {
    if (typeof progressCallback !== "function") return;
    progressCallback(phase, progress, message);
  };
  if (!(forceAsExcel || isExcelItem(item))) return false;
  reportProgress("upload", 30, "上传文件中");
  item.status = "processing";
  item.message = "记录计数中";
  renderQueue();
  if (!item.fileId) {
    const up = await uploadFile(item.file);
    item.fileId = up.file_id;
  }
  reportProgress("inspect", 60, "Excel记录计数中");
  const inspect = await runExcelInspect(item.fileId, item.templateName || "");
  const recordRows = buildExcelRecordItems(item, inspect);
  if (!recordRows.length) {
    item.recordCount = inspect.total_rows || 0;
    item.category = "Excel批量";
    item.status = "error";
    item.message = (inspect.errors && inspect.errors[0]) || "Excel 未识别到有效记录";
    renderQueue();
    reportProgress("done", 100, "识别失败");
    return true;
  }
  reportProgress("match", 85, "模板匹配中");
  for (const recordItem of recordRows) {
    if (!recordItem.templateName) await applyAutoTemplateMatch(recordItem, { force: true });
  }
  const index = state.queue.findIndex((x) => x.id === item.id);
  if (index >= 0) {
    state.queue.splice(index, 1, ...recordRows);
    state.activeId = recordRows[0].id;
  }
  renderQueue();
  renderTemplateSelect();
  reportProgress("done", 100, "识别完成");
  return true;
}
