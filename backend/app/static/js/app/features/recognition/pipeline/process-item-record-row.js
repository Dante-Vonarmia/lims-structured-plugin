export async function handleRecordRowBranch(deps = {}) {
  const {
    item,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
  } = deps;

  if (!item || !item.isRecordRow) return false;
  if (!item.recognizedFields || typeof item.recognizedFields !== "object") {
    item.recognizedFields = { ...(item.fields || {}) };
  }
  item.status = "ready";
  if (!item.templateName) await applyAutoTemplateMatch(item, { force: true });
  else item.message = "记录已就绪，可生成";
  renderQueue();
  renderTemplateSelect();
  return true;
}
