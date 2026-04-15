export async function handleFinalizeMatchPath(deps = {}) {
  const { item, applyAutoTemplateMatch, renderQueue, renderTemplateSelect } = deps;

  item.message = "识别结果整理中";
  renderQueue();
  item.templateName = "";
  item.matchedBy = "";
  item.templateUserSelected = false;
  await applyAutoTemplateMatch(item, { force: true });
  renderQueue();
  renderTemplateSelect();
}
