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
  } = deps;
  if (!(forceAsExcel || isExcelItem(item))) return false;
  item.status = "processing";
  item.message = "记录计数中";
  renderQueue();
  if (!item.fileId) {
    const up = await uploadFile(item.file);
    item.fileId = up.file_id;
  }
  const inspect = await runExcelInspect(item.fileId, item.templateName || "");
  const recordRows = buildExcelRecordItems(item, inspect);
  if (!recordRows.length) {
    item.recordCount = inspect.total_rows || 0;
    item.category = "Excel批量";
    item.status = "error";
    item.message = (inspect.errors && inspect.errors[0]) || "Excel 未识别到有效记录";
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
  renderQueue();
  renderTemplateSelect();
  return true;
}
