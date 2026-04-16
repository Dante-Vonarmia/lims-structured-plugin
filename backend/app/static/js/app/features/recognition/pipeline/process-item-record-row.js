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
  if (!item.fields || typeof item.fields !== "object") {
    item.fields = { ...(item.recognizedFields || {}) };
  } else {
    Object.entries(item.recognizedFields).forEach(([key, value]) => {
      const current = item.fields[key];
      const currentHasValue = Array.isArray(current) ? current.length > 0 : !!String(current == null ? "" : current).trim();
      if (currentHasValue) return;
      const nextHasValue = Array.isArray(value) ? value.length > 0 : !!String(value == null ? "" : value).trim();
      if (!nextHasValue) return;
      item.fields[key] = Array.isArray(value) ? [...value] : value;
    });
  }
  item.status = "ready";
  if (!item.templateName) await applyAutoTemplateMatch(item, { force: true });
  else item.message = "记录已就绪，可生成";
  renderQueue();
  renderTemplateSelect();
  return true;
}
