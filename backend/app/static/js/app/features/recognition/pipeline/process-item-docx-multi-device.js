export async function handleDocxMultiDevicePath(deps = {}) {
  const {
    ext,
    item,
    state,
    buildMultiDeviceWordItems,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    appendLog,
  } = deps;

  if (ext !== ".docx") {
    return false;
  }

  const groupItems = buildMultiDeviceWordItems(item, item.fields || {});
  if (groupItems.length > 1) {
    item.recordCount = groupItems.length;
    for (const row of groupItems) {
      await applyAutoTemplateMatch(row, { force: true });
    }
    const index = state.queue.findIndex((x) => x.id === item.id);
    if (index >= 0) {
      state.queue.splice(index, 1, ...groupItems);
      state.activeId = groupItems[0].id;
    }
    renderQueue();
    renderTemplateSelect();
    appendLog(`多气瓶拆分完成 ${item.fileName}：${groupItems.length} 条`);
    return true;
  }

  return false;
}
